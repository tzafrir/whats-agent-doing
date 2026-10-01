import type { Register, Timer } from 'claude-code'

import { activityOf } from './activity-of'

const IDLE = 'Idle, waiting for your prompt'
const THINKING = 'Thinking'
const TICK_MS = 1000

/**
 * Registers the activity box: a band above the prompt naming what Claude is
 * doing right now, kept current by the main loop's turns and tool calls.
 *
 * Subagents' own calls are left out; the main loop's Agent call stands for
 * them. Parallel calls show the newest, with a count of the others.
 *
 * @param on the engine's registrar
 */
export const register: Register = on => {
  /** The main loop's tool calls in flight, by tool_use_id, oldest first. */
  const running = new Map<string, string>()

  let isTurnRunning = false
  let sinceMs = 0
  let ticker: Timer | null = null

  const doing = (): string => {
    const labels = [...running.values()]
    const newest = labels.at(-1)

    if (newest === undefined) {
      return isTurnRunning ? THINKING : IDLE
    }

    return labels.length > 1 ? `${newest} (+${labels.length - 1} more)` : newest
  }

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    running.clear()
    sinceMs = await $.clock.now()

    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))

    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    running.set(e.tool_use_id, activityOf(e))
    sinceMs = await $.clock.now()
    $.ui.invalidate('ui.render')

    try {
      return await next(e)
    } finally {
      running.delete(e.tool_use_id)
      sinceMs = await $.clock.now()
      $.ui.invalidate('ui.render')
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    isTurnRunning = false
    running.clear()
    sinceMs = await $.clock.now()

    ticker?.cancel()
    ticker = null

    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    const isWorking = isTurnRunning || e.props.isWorking
    const seconds = Math.max(0, Math.floor(((await $.clock.now()) - sinceMs) / 1000))
    const elapsed = isWorking ? ` · ${seconds}s` : ''

    return (
      <Box
        key="activity"
        borderStyle="round"
        borderColor={isWorking ? 'cyan' : 'gray'}
        paddingX={1}
        alignSelf="flex-start"
      >
        <Text color={isWorking ? 'cyan' : 'gray'}>{isWorking ? '● ' : '○ '}</Text>
        <Text bold>Claude: </Text>
        <Text wrap="truncate-end">{doing()}</Text>
        <Text dimColor>{elapsed}</Text>
      </Box>
    )
  })
}
