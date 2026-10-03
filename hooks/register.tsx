import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, Timer, TurnCompleteReason, TurnStepChunk } from 'claude-code'

import type {
  ActivityAgent,
  ActivityEntry,
  ActivityNow,
  ActivityOutcome,
  ActivityPhase,
} from '../types'
import { activityOf, partialArgsOf } from './activity-of'
import { clip, durationOf, oneLine, plural, printable, sizeOf, thoughtOf, wordsAdded } from './text'

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
const LARGE_INPUT_CHARS = 1024
const MAX_LABEL_CHARS = 120
const MAX_AGENT_NAME_CHARS = 40
const MAX_AGENT_ROWS = 6
const STREAM_THROTTLE_MS = 250
const TICK_MS = 1000

const now = atom({ plugin: 'whats-agent-doing', key: 'now' } as const, IDLE)

const history = atom(
  { plugin: 'whats-agent-doing', key: 'history' } as const,
  [] as readonly ActivityEntry[],
)

const team = atom(
  { plugin: 'whats-agent-doing', key: 'agents' } as const,
  [] as readonly ActivityAgent[],
)

const isExpanded = atom(
  { plugin: 'whats-agent-doing', key: 'isExpanded' } as const,
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
 * A subagent at work, from its spawn (or its first call, when the spawn came
 * before a reload) to its stop. `toolUseId` names the Agent call that started
 * it; `activeMs` is when it last did something.
 */
type Agent = {
  name: string
  label: string
  startMs: number
  activeMs: number
  toolUseId: string | null
  isBackground: boolean
}

/**
 * The module's live view of the session, from which the headline is drawn:
 * started over on a reload, while the headline and history in `$.state` stay.
 */
type Live = {
  calls: Map<string, Call>
  agents: Map<string, Agent>
  agentNames: Map<string, string>
  described: Map<string, string>
  phase: ModelPhase
  phaseStartMs: number
  turnStartMs: number | null
  turnActions: number
  isFirstRequest: boolean
  resultsToReview: number
  thought: string
  thoughtWords: number
  isThoughtInWord: boolean
  replyWords: number
  isReplyInWord: boolean
  composing: { tool: string; head: string; chars: number } | null
  lastAction: string | null
  lastTurn: string | null
  lastPublishMs: number
  trailing: Timer | null
  isSweeping: boolean
  ticker: Timer | null
}

/**
 * Registers What's Agent Doing: a box above the prompt naming what Claude is
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
    agentNames: new Map(),
    described: new Map(),
    phase: 'idle',
    phaseStartMs: 0,
    turnStartMs: null,
    turnActions: 0,
    isFirstRequest: false,
    resultsToReview: 0,
    thought: '',
    thoughtWords: 0,
    isThoughtInWord: false,
    replyWords: 0,
    isReplyInWord: false,
    composing: null,
    lastAction: null,
    lastTurn: null,
    lastPublishMs: 0,
    trailing: null,
    isSweeping: false,
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
    live.lastAction = null
    live.calls.clear()

    const prompt = oneLine(e.text)

    if (prompt !== '') {
      await remember($, { kind: 'turn', label: clip(prompt, 60), durationMs: null, outcome: 'ok' })
    }

    await enter($, live, 'requesting')

    keepTicking($, live)
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
      const agent = await agentOf($, live, e.agentId)

      // Kept after the call: the agent's last action stands while it thinks.
      agent.label = label
      agent.activeMs = await $.clock.now()
      await publish($, live, false)

      try {
        return await next(e)
      } finally {
        agent.label = label
        await publish($, live, false)
      }
    }

    const startMs = await $.clock.now()

    live.calls.set(e.tool_use_id, { tool: e.tool, label, startMs, isAwaitingApproval: false })
    live.lastAction = label
    live.turnActions += 1
    await publish($, live)

    let outcome: ActivityOutcome = 'interrupted'

    try {
      const result = await next(e)

      outcome = result.deny !== undefined ? 'denied' : result.isError ? 'error' : 'ok'

      if (isAgentTool(e.tool)) {
        const args = e as unknown as Record<string, unknown>
        const handle = args['name']
        const description = args['description']

        // A named agent runs as a teammate, which the engine lists by the
        // call's `name`; the call's `description` is what to show for it.
        if (typeof handle === 'string' && typeof description === 'string' && oneLine(description) !== '') {
          live.described.set(handle, description)
          void sweep($, live)
        }

        await launched($, live, result.result, description)
      }

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
      const agent = await agentOf($, live, e.agent_id)

      agent.label = `Waiting for your approval: ${agent.label}`
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

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)

    if (result.agentId !== undefined) {
      const startMs = await $.clock.now()
      const name = e.description || e.name || 'Agent'

      live.agentNames.set(result.agentId, name)
      live.agents.set(result.agentId, {
        name,
        label: 'Getting started',
        startMs,
        activeMs: startMs,
        toolUseId: e.tool_use_id,
        isBackground: e.background,
      })
      keepTicking($, live)
      await publish($, live)
    }

    return result
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await finish($, live, e.agent_id, 'ok')

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
    if (e.agentId !== undefined) {
      await finish($, live, e.agentId, outcomeOf(e.reason))

      return next(e)
    }

    if (live.turnStartMs === null) {
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

    keepTicking($, live)
    await publish($, live)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    // The band is one site for every plugin: what the plugins beneath draw
    // stays, under the box, so another mod's band is never hidden.
    const below = await next(e)

    const { Box, Text, Button } = $.ui.resolve(e)

    const headline = await read($, now)
    const entries = await read($, history)
    const working = await read($, team)
    const isOpen = await read($, isExpanded)
    const nowMs = await $.clock.now()

    const isWorking = headline.phase !== 'idle'
    const color = PHASE_COLORS[headline.phase]
    const elapsed = isWorking ? ` · ${durationOf(nowMs - headline.sinceMs)}` : ''

    // One agent the headline names; more, or one beside the main loop's
    // work, get a row each.
    const isTeamListed = working.length > 1 || (working.length === 1 && headline.phase !== 'agent')
    const listed = isTeamListed ? working.slice(-MAX_AGENT_ROWS) : []
    const unlisted = isTeamListed ? working.length - listed.length : 0

    const agentRows = listed.map((agent, i) => (
      <Box key={`agent-${i}`} flexDirection="row">
        <Text color={PHASE_COLORS.agent}>{'◆ '}</Text>
        <Text bold wrap="truncate-end">{printable(agent.name, MAX_AGENT_NAME_CHARS)}</Text>
        <Text wrap="truncate-end">{` › ${printable(agent.label, MAX_LABEL_CHARS)}`}</Text>
        <Text dimColor>{`  ${durationOf(nowMs - agent.sinceMs)}`}</Text>
      </Box>
    ))

    const moreAgents = unlisted > 0 ? [<Text dimColor>{`… ${plural(unlisted, 'more agent')}`}</Text>] : []

    const teamBox = isTeamListed
      ? [
          <Box key="agents" flexDirection="column">
            {agentRows}
            {moreAgents}
          </Box>,
        ]
      : []

    const teamRows = listed.length + moreAgents.length
    const rows = Math.min(MAX_HISTORY_ROWS, Math.max(1, e.props.maxRows - 4 - teamRows))
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
            {printable(entry.label, MAX_LABEL_CHARS)}
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
      <Box flexDirection="column">
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
            <Text wrap="truncate-end">{printable(headline.label, MAX_LABEL_CHARS)}</Text>
            <Text dimColor>{elapsed}</Text>
          </Box>
          {teamBox}
          {body}
        </Box>
        {below}
      </Box>
    )
  })
}

/** The headline as the live view has it. */
function current(live: Live): ActivityNow {
  if (live.phase === 'compacting') {
    return { phase: 'compacting', label: 'Compacting the conversation', sinceMs: live.phaseStartMs }
  }

  const open = [...live.calls.entries()]
  const [newestId, newest] = open.at(-1) ?? []

  if (newestId !== undefined && newest !== undefined) {
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

    const inner = isAgentTool(newest.tool) ? agentUnder(live, newestId)?.label : undefined

    return inner === undefined
      ? { phase: 'tool', label: `${newest.label}${more}`, sinceMs: newest.startMs }
      : { phase: 'agent', label: `${newest.label} › ${inner}${more}`, sinceMs: newest.startMs }
  }

  if (live.phase === 'idle' && live.agents.size > 0) {
    // Between turns, background agents may still be at work.
    const working = [...live.agents.values()]
    const sinceMs = Math.min(...working.map(agent => agent.startMs))
    const busiest = working.reduce((a, b) => (b.activeMs > a.activeMs ? b : a))

    return {
      phase: 'agent',
      label: working.length === 1
        ? `${busiest.name} › ${busiest.label}`
        : `${plural(working.length, 'agent')} working`,
      sinceMs,
    }
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
      // With no thought text to quote, the last action stands, the dot
      // turned to thinking's color; before any, the prompt is what it reads.
      const snippet = thoughtOf(live.thought, MAX_THOUGHT_CHARS)
      const label = snippet ? `Thinking: ${snippet}` : standingLabel(live)

      return { phase: 'thinking', label, sinceMs }
    }
    case 'writing':
      return {
        phase: 'writing',
        label: `Writing the reply · ${plural(live.replyWords, 'word')}`,
        sinceMs,
      }
    case 'composing': {
      // A call is named once its input says what it does: a file tool by
      // its path, a command by its description, which streams after the
      // command itself. Until then the last action stands.
      const { composing } = live
      const args = composing ? partialArgsOf(composing.head) : {}
      const isDescribed = composing !== null && (isShellTool(composing.tool)
        ? typeof args['description'] === 'string'
        : Object.keys(args).length > 0)

      if (!composing || !isDescribed) {
        return { phase: 'composing', label: standingLabel(live), sinceMs }
      }

      const size = composing.chars >= LARGE_INPUT_CHARS ? ` · ${sizeOf(composing.chars)}` : ''

      return { phase: 'composing', label: `${activityOf(composing.tool, args)}${size}`, sinceMs }
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
  const working = [...live.agents.values()].map(agent => ({
    name: agent.name,
    label: agent.label,
    sinceMs: agent.startMs,
  }))

  await update($, now, () => headline)
  await update($, team, () => working)
}

/** The agent at work under `agentId`, taken up if its spawn came before a reload. */
async function agentOf($: EngineInterface, live: Live, agentId: string): Promise<Agent> {
  const known = live.agents.get(agentId)

  if (known) {
    return known
  }

  const startMs = await $.clock.now()
  const agent: Agent = {
    name: live.agentNames.get(agentId) ?? 'Agent',
    label: 'Getting started',
    startMs,
    activeMs: startMs,
    toolUseId: null,
    isBackground: true,
  }

  live.agents.set(agentId, agent)
  keepTicking($, live)

  return agent
}

/**
 * Lets an agent go. A background agent's run is recorded in the history; a
 * foreground one's is its Agent call's row.
 */
async function finish(
  $: EngineInterface,
  live: Live,
  agentId: string,
  outcome: ActivityOutcome,
): Promise<void> {
  const agent = live.agents.get(agentId)

  if (!agent) {
    return
  }

  live.agents.delete(agentId)

  if (agent.isBackground) {
    await remember($, {
      kind: 'tool',
      label: `Agent: ${agent.name}`,
      durationMs: (await $.clock.now()) - agent.startMs,
      outcome,
    })
  }

  keepTicking($, live)
  await publish($, live)
}

/**
 * Names agents first met by their calls, and lets go of agents the engine
 * lists as no longer running, in case their stop never reached the box.
 */
async function sweep($: EngineInterface, live: Live): Promise<void> {
  if (live.agents.size === 0 || live.isSweeping) {
    return
  }

  live.isSweeping = true

  try {
    await sweepListed($, live, await $.agent.list())
  } catch {
    // The list is a backstop; the box keeps going without it.
  } finally {
    live.isSweeping = false
  }
}

async function sweepListed($: EngineInterface, live: Live, listed: readonly AgentInfo[]): Promise<void> {
  const statuses = new Map(listed.map(info => [info.id, info.status]))
  let isRenamed = false

  for (const [agentId, agent] of [...live.agents.entries()]) {
    const status = statuses.get(agentId)

    // An agent first met by its calls is named once the engine lists it.
    if (!live.agentNames.has(agentId)) {
      const handle = listed.find(info => info.id === agentId)?.name
      const described = handle === undefined ? undefined : live.described.get(handle)

      if (described !== undefined) {
        live.agentNames.set(agentId, described)
      }

      const name = described ?? handle

      if (name !== undefined && name !== agent.name) {
        agent.name = name
        isRenamed = true
      }
    }

    if (status !== undefined && status !== 'running') {
      await finish($, live, agentId, status === 'completed' ? 'ok' : status === 'failed' ? 'error' : 'interrupted')
    }
  }

  if (isRenamed) {
    await publish($, live)
  }
}

/**
 * Keeps the elapsed time ticking while a turn runs or an agent works, and
 * stops it once neither does.
 */
function keepTicking($: EngineInterface, live: Live): void {
  const isBusy = live.turnStartMs !== null || live.agents.size > 0

  if (isBusy && live.ticker === null) {
    live.ticker = $.clock.every(TICK_MS, () => {
      $.ui.invalidate('ui.render')
      void sweep($, live)
    })
  } else if (!isBusy && live.ticker !== null) {
    live.ticker.cancel()
    live.ticker = null
  }
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
    const words = live.thoughtWords

    await remember($, {
      kind: 'thought',
      label: words > 0 ? `Thought (${plural(words, 'word')})` : 'Thought',
      durationMs,
      outcome: 'ok',
    })
  }

  if (live.phase === 'writing' && live.replyWords > 0) {
    await remember($, {
      kind: 'reply',
      label: `Wrote the reply (${plural(live.replyWords, 'word')})`,
      durationMs,
      outcome: 'ok',
    })
  }

  if (next === 'thinking') {
    live.thought = ''
    live.thoughtWords = 0
    live.isThoughtInWord = false
  }

  if (next === 'writing') {
    live.replyWords = 0
    live.isReplyInWord = false
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
      const { added, isInWord } = wordsAdded(chunk.text, live.isThoughtInWord)

      live.thought = (live.thought + chunk.text).slice(-MAX_THOUGHT_BUFFER)
      live.thoughtWords += added
      live.isThoughtInWord = isInWord
      await publish($, live, isNew)

      return
    }
    case 'text': {
      const isNew = live.phase !== 'writing'

      await enter($, live, 'writing')
      live.resultsToReview = 0
      const { added, isInWord } = wordsAdded(chunk.text, live.isReplyInWord)

      live.replyWords += added
      live.isReplyInWord = isInWord
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

/**
 * What the box keeps saying while Claude thinks or writes a call it cannot
 * name yet: the turn's last action, or the prompt before there is one.
 */
function standingLabel(live: Live): string {
  return live.lastAction ?? 'Reading your prompt'
}

/**
 * Names a background agent by the Agent call that launched it: the call's
 * short `description`, keyed by the id its result carries (the result's own
 * `description` can hold the whole prompt). Its own calls may already have
 * shown it.
 */
async function launched(
  $: EngineInterface,
  live: Live,
  result: unknown,
  asked: unknown,
): Promise<void> {
  if (typeof result !== 'object' || result === null) {
    return
  }

  const { agentId, description, status } = result as Record<string, unknown>

  if (typeof agentId !== 'string' || status !== 'async_launched') {
    return
  }

  const name = [asked, description].find(
    (text): text is string => typeof text === 'string' && oneLine(text) !== '',
  )

  if (name === undefined) {
    return
  }

  const agent = await agentOf($, live, agentId)

  live.agentNames.set(agentId, name)
  agent.name = name
  await publish($, live)
}

/** The agent an Agent call started, or the one that last did something. */
function agentUnder(live: Live, toolUseId: string): Agent | undefined {
  const working = [...live.agents.values()]

  return working.find(agent => agent.toolUseId === toolUseId)
    ?? working.reduce<Agent | undefined>((a, b) => (a === undefined || b.activeMs > a.activeMs ? b : a), undefined)
}

function outcomeOf(reason: TurnCompleteReason): ActivityOutcome {
  return reason === 'aborted' ? 'interrupted' : reason === 'error' ? 'error' : reason === 'refusal' ? 'denied' : 'ok'
}

function isShellTool(tool: string): boolean {
  return tool === 'Bash' || tool === 'PowerShell'
}

function isAgentTool(tool: string): boolean {
  return tool === 'Agent' || tool === 'Task'
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}