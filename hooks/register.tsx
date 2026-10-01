import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, TurnStepChunk } from 'claude-code'

import type {
  ActivityEntry,
  ActivityNow,
  ActivityOutcome,
  ActivityPhase,
} from '../types'
import { activityOf, partialArgsOf } from './activity-of'
import { clip, durationOf, oneLine, plural, sizeOf, thoughtOf, wordsIn } from './text'

const IDLE: ActivityNow = {
  phase: 'idle',
  label: 'Idle, waiting for your prompt',
  sinceMs: 0,
}

const MAX_HISTORY = 100
const MAX_HISTORY_ROWS = 12
const MAX_THOUGHT_CHARS = 70
const MAX_THOUGHT_BUFFER = 2000
const MAX_INPUT_HEAD = 4000
const STREAM_THROTTLE_MS = 250
const TICK_MS = 1000

const now = atom({ plugin: 'whats-claude-doing', key: 'now' } as const, IDLE)

const history = atom(
  { plugin: 'whats-claude-doing', key: 'history' } as const,
  [] as readonly ActivityEntry[],
)

const isExpanded = atom(
  { plugin: 'whats-claude-doing', key: 'isExpanded' } as const,
  false,
)

const PHASE_COLORS: Record<ActivityPhase, string> = {
  idle: 'gray',
  requesting: 'cyan',
  thinking: 'magenta',
  writing: 'green',
  composing: 'blue',
  tool: 'cyan',
  agent: 'cyan',
  approval: 'yellow',
  question: 'yellow',
  compacting: 'blue',
}

const OUTCOME_MARKS: Record<ActivityOutcome, { mark: string; color: string }> = {
  ok: { mark: '✓', color: 'green' },
  error: { mark: '✗', color: 'red' },
  denied: { mark: '⊘', color: 'yellow' },
  interrupted: { mark: '■', color: 'gray' },
}

const KIND_MARKS: Partial<Record<ActivityEntry['kind'], { mark: string; color: string }>> = {
  turn: { mark: '›', color: 'white' },
  thought: { mark: '∴', color: 'magenta' },
  reply: { mark: '✎', color: 'green' },
  compact: { mark: '⇣', color: 'blue' },
}

/** What the model is doing in the main loop, between and around tool calls. */
type ModelPhase = 'idle' | 'requesting' | 'thinking' | 'writing' | 'composing' | 'compacting'

/** A main-loop tool call in flight. */
type Call = {
  tool: string
  label: string
  startMs: number
  isAwaitingApproval: boolean
}

/**
 * The module's live view of the session, from which the headline is drawn:
 * started over on a reload, while the headline and history in `$.state` stay.
 */
type Live = {
  calls: Map<string, Call>
  agents: Map<string, string>
  phase: ModelPhase
  phaseStartMs: number
  turnStartMs: number | null
  turnActions: number
  isFirstRequest: boolean
  resultsToReview: number
  thought: string
  reply: string
  composing: { tool: string; head: string; chars: number } | null
  lastTurn: string | null
  lastPublishMs: number
  trailing: Timer | null
  ticker: Timer | null
}

/**
 * Registers What's Claude Doing: a box above the prompt naming what Claude is
 * doing right now, and, behind its triangle, what it has done.
 *
 * The model's own stream (`turn.step`) says whether it is reading, thinking
 * (the thought's latest sentence), writing the reply or composing a tool's
 * input; `tool.call` says which tool runs, `classic.PermissionRequest` when
 * one waits for approval, and a subagent's calls show under its Agent call.
 *
 * @param on the engine's registrar
 */
export const register: Register = on => {
  const live: Live = {
    calls: new Map(),
    agents: new Map(),
    phase: 'idle',
    phaseStartMs: 0,
    turnStartMs: null,
    turnActions: 0,
    isFirstRequest: false,
    resultsToReview: 0,
    thought: '',
    reply: '',
    composing: null,
    lastTurn: null,
    lastPublishMs: 0,
    trailing: null,
    ticker: null,
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await publish($, live)

    return result
  })

  on('turn.start', async ($, e, next) => {
    if (live.turnStartMs !== null) {
      return next(e)
    }

    live.turnStartMs = await $.clock.now()
    live.turnActions = 0
    live.isFirstRequest = true
    live.resultsToReview = 0
    live.calls.clear()
    live.agents.clear()

    const prompt = oneLine(e.text)

    if (prompt !== '') {
      await remember($, { kind: 'turn', label: clip(prompt, 60), durationMs: null, outcome: 'ok' })
    }

    await enter($, live, 'requesting')

    live.ticker?.cancel()
    live.ticker = $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))

    await publish($, live)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }

    await enter($, live, 'requesting')
    await publish($, live)

    try {
      for await (const chunk of next(e)) {
        await follow($, live, chunk)
        yield chunk
      }
    } finally {
      live.isFirstRequest = false
      live.composing = null
      await enter($, live, 'requesting')
      await publish($, live)
    }
  })

  on('tool.call', async ($, e, next) => {
    const label = activityOf(e.tool, e as unknown as Record<string, unknown>)

    if (e.agentId !== undefined) {
      const agentId = e.agentId

      live.agents.set(agentId, label)
      await publish($, live, false)

      try {
        return await next(e)
      } finally {
        live.agents.set(agentId, 'Thinking')
        await publish($, live, false)
      }
    }

    const startMs = await $.clock.now()

    live.calls.set(e.tool_use_id, { tool: e.tool, label, startMs, isAwaitingApproval: false })
    live.turnActions += 1
    await publish($, live)

    let outcome: ActivityOutcome = 'interrupted'

    try {
      const result = await next(e)

      outcome = result.deny !== undefined ? 'denied' : result.isError ? 'error' : 'ok'

      return result
    } finally {
      live.calls.delete(e.tool_use_id)
      live.resultsToReview += 1

      await remember($, {
        kind: 'tool',
        label,
        durationMs: (await $.clock.now()) - startMs,
        outcome,
      })

      await publish($, live)
    }
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id !== undefined) {
      live.agents.set(e.agent_id, `Waiting for your approval: ${e.tool_name}`)
    } else {
      const waiting = [...live.calls.values()]
        .reverse()
        .find(call => call.tool === e.tool_name && !call.isAwaitingApproval)

      if (waiting) {
        waiting.isAwaitingApproval = true
      }
    }

    await publish($, live)

    return next(e)
  })

  // The run-in-background pill shows only under a call that is running, so
  // its drawing means the person has answered the approval it waited on.
  on('ui.render', { component: 'ToolProgress' }, ($, e, next) => {
    const call = live.calls.get(e.props.tool_use_id)

    if (call?.isAwaitingApproval) {
      call.isAwaitingApproval = false
      $.clock.after(0, () => void publish($, live))
    }

    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    live.agents.delete(e.agent_id)
    await publish($, live, false)

    return next(e)
  })

  on('classic.PreCompact', async ($, e, next) => {
    await enter($, live, 'compacting')
    await publish($, live)

    return next(e)
  })

  on('classic.PostCompact', async ($, e, next) => {
    const durationMs = (await $.clock.now()) - live.phaseStartMs

    live.phase = live.turnStartMs === null ? 'idle' : 'requesting'
    await remember($, { kind: 'compact', label: 'Compacted the conversation', durationMs, outcome: 'ok' })
    await publish($, live)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || live.turnStartMs === null) {
      return next(e)
    }

    const durationMs = (await $.clock.now()) - live.turnStartMs
    const took = durationOf(durationMs)

    const [label, outcome]: [string, ActivityOutcome] =
      e.reason === 'aborted'
        ? [`interrupted after ${took}`, 'interrupted']
        : e.reason === 'error'
          ? [`stopped on an error after ${took}`, 'error']
          : e.reason === 'refusal'
            ? ['declined the request', 'denied']
            : [`done in ${took}, ${plural(live.turnActions, 'action')}`, 'ok']

    await enter($, live, 'idle')
    await remember($, { kind: 'end', label: capitalized(label), durationMs, outcome })

    live.lastTurn = label
    live.turnStartMs = null
    live.calls.clear()
    live.agents.clear()

    live.ticker?.cancel()
    live.ticker = null

    await publish($, live)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text, Button } = $.ui.resolve(e)

    const headline = await read($, now)
    const entries = await read($, history)
    const isOpen = await read($, isExpanded)
    const nowMs = await $.clock.now()

    const isWorking = headline.phase !== 'idle'
    const color = PHASE_COLORS[headline.phase]
    const elapsed = isWorking ? ` · ${durationOf(nowMs - headline.sinceMs)}` : ''

    const rows = Math.min(MAX_HISTORY_ROWS, Math.max(1, e.props.maxRows - 4))
    const shown = entries.slice(-rows)
    const hidden = entries.length - shown.length

    const historyRows = shown.map((entry, i) => {
      const { mark, color: markColor } = KIND_MARKS[entry.kind] ?? OUTCOME_MARKS[entry.outcome]
      const isQuiet = entry.kind === 'thought' || entry.kind === 'end'
      const took = entry.durationMs === null ? '' : `  ${durationOf(entry.durationMs)}`

      return (
        <Box key={`row-${i}`} flexDirection="row">
          <Text color={markColor}>{`${mark} `}</Text>
          <Text bold={entry.kind === 'turn'} dimColor={isQuiet} wrap="truncate-end">
            {entry.label}
          </Text>
          <Text dimColor>{took}</Text>
        </Box>
      )
    })

    const earlier = hidden > 0 ? [<Text dimColor>{`… ${hidden} earlier`}</Text>] : []
    const empty = entries.length === 0 ? [<Text dimColor>No actions yet</Text>] : []

    const body = isOpen
      ? [
          <Box key="history" flexDirection="column" marginTop={1}>
            {earlier}
            {historyRows}
            {empty}
          </Box>,
        ]
      : []

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={isWorking ? color : 'gray'}
        paddingX={1}
        alignSelf="flex-start"
      >
        <Box key="activity" flexDirection="row">
          <Button
            key="toggle"
            plain
            label={isOpen ? '▾' : '▸'}
            onPress={() => update($, isExpanded, open => !open)}
          />
          <Text color={color}>{isWorking ? ' ● ' : ' ○ '}</Text>
          <Text bold>Claude: </Text>
          <Text wrap="truncate-end">{headline.label}</Text>
          <Text dimColor>{elapsed}</Text>
        </Box>
        {body}
      </Box>
    )
  })
}

/** The headline as the live view has it. */
function current(live: Live): ActivityNow {
  if (live.phase === 'compacting') {
    return { phase: 'compacting', label: 'Compacting the conversation', sinceMs: live.phaseStartMs }
  }

  const open = [...live.calls.values()]
  const newest = open.at(-1)

  if (newest) {
    const more = open.length > 1 ? ` (+${open.length - 1} more)` : ''

    if (newest.isAwaitingApproval) {
      return {
        phase: 'approval',
        label: `Waiting for your approval: ${newest.label}${more}`,
        sinceMs: newest.startMs,
      }
    }

    if (newest.tool === 'AskUserQuestion') {
      return { phase: 'question', label: newest.label, sinceMs: newest.startMs }
    }

    const inner = isAgentTool(newest.tool) ? [...live.agents.values()].at(-1) : undefined

    return inner === undefined
      ? { phase: 'tool', label: `${newest.label}${more}`, sinceMs: newest.startMs }
      : { phase: 'agent', label: `${newest.label} › ${inner}${more}`, sinceMs: newest.startMs }
  }

  const sinceMs = live.phaseStartMs

  switch (live.phase) {
    case 'requesting':
      return {
        phase: 'requesting',
        label: live.isFirstRequest
          ? 'Reading your prompt'
          : live.resultsToReview > 0
            ? `Reviewing the results of ${plural(live.resultsToReview, 'action')}`
            : 'Waiting for the model',
        sinceMs,
      }
    case 'thinking': {
      const snippet = thoughtOf(live.thought, MAX_THOUGHT_CHARS)

      return { phase: 'thinking', label: snippet ? `Thinking: ${snippet}` : 'Thinking', sinceMs }
    }
    case 'writing':
      return {
        phase: 'writing',
        label: `Writing the reply · ${plural(wordsIn(live.reply), 'word')}`,
        sinceMs,
      }
    case 'composing': {
      const { composing } = live
      const what = composing
        ? activityOf(composing.tool, partialArgsOf(composing.head))
        : 'a tool call'

      return {
        phase: 'composing',
        label: `Preparing: ${what} · ${sizeOf(composing?.chars ?? 0)}`,
        sinceMs,
      }
    }
    case 'idle':
      return live.lastTurn === null
        ? IDLE
        : { ...IDLE, label: `Idle · last turn ${live.lastTurn}` }
  }
}

/**
 * Writes the headline. A streaming update (`isUrgent` false) lands at most
 * every STREAM_THROTTLE_MS, the last one held on a timer.
 */
async function publish($: EngineInterface, live: Live, isUrgent = true): Promise<void> {
  const nowMs = await $.clock.now()

  if (!isUrgent && nowMs - live.lastPublishMs < STREAM_THROTTLE_MS) {
    live.trailing ??= $.clock.after(STREAM_THROTTLE_MS, () => {
      live.trailing = null
      void publish($, live)
    })

    return
  }

  live.lastPublishMs = nowMs
  const headline = current(live)

  await update($, now, () => headline)
}

async function remember($: EngineInterface, entry: ActivityEntry): Promise<void> {
  await update($, history, entries => [...entries, entry].slice(-MAX_HISTORY))
}

/** Enters a model phase, recording the thinking or reply block it closes. */
async function enter($: EngineInterface, live: Live, next: ModelPhase): Promise<void> {
  if (next === live.phase) {
    return
  }

  const nowMs = await $.clock.now()
  const durationMs = nowMs - live.phaseStartMs

  if (live.phase === 'thinking') {
    const words = wordsIn(live.thought)

    await remember($, {
      kind: 'thought',
      label: words > 0 ? `Thought (${plural(words, 'word')})` : 'Thought',
      durationMs,
      outcome: 'ok',
    })
  }

  if (live.phase === 'writing' && live.reply.trim() !== '') {
    await remember($, {
      kind: 'reply',
      label: `Wrote the reply (${plural(wordsIn(live.reply), 'word')})`,
      durationMs,
      outcome: 'ok',
    })
  }

  if (next === 'thinking') {
    live.thought = ''
  }

  if (next === 'writing') {
    live.reply = ''
  }

  live.phase = next
  live.phaseStartMs = nowMs
}

/** Follows one chunk of the main loop's response. */
async function follow($: EngineInterface, live: Live, chunk: TurnStepChunk): Promise<void> {
  switch (chunk.kind) {
    case 'thinking': {
      const isNew = live.phase !== 'thinking'

      await enter($, live, 'thinking')
      live.resultsToReview = 0
      live.thought = (live.thought + chunk.text).slice(-MAX_THOUGHT_BUFFER)
      await publish($, live, isNew)

      return
    }
    case 'text': {
      const isNew = live.phase !== 'writing'

      await enter($, live, 'writing')
      live.resultsToReview = 0
      live.reply += chunk.text
      await publish($, live, isNew)

      return
    }
    case 'tool':
      await enter($, live, 'composing')
      live.resultsToReview = 0
      live.composing = { tool: chunk.name, head: '', chars: 0 }
      await publish($, live)

      return
    case 'input': {
      const { composing } = live

      if (composing) {
        composing.chars += chunk.json.length

        if (composing.head.length < MAX_INPUT_HEAD) {
          composing.head += chunk.json
        }

        await publish($, live, false)
      }

      return
    }
  }
}

function isAgentTool(tool: string): boolean {
  return tool === 'Agent' || tool === 'Task'
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}