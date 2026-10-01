import type { On, TurnStepChunk } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const BAND = {
  plugin: 'whats-agent-doing',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const DONE = {
  answer: 'All fixed.',
  durationMs: 1000,
  isAborted: false,
  reason: 'answer',
  category: null,
  explanation: null,
} as const

const STEP = { turnId: 't1', model: 'claude-opus-5-5', messageCount: 1 } as const

/**
 * Seats the engine beneath the plugin: a clock, turns, a model whose steps
 * yield `script[index]`, and tools that answer `toolAnswer`. `seen` keeps
 * what the box said at each `look()` a step or a tool takes.
 */
function seat(on: On, script: readonly (readonly TurnStepChunk[])[]) {
  const box = {
    read: async () => '',
    seen: [] as string[],
    toolAnswer: { deny: 'stubbed in the test' } as { deny: string },
    onTool: async () => {},
  }

  const clock = mock.clock(on, { now: 1_000_000 })

  const look = async () => {
    box.seen.push(await box.read())
  }

  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))

  on('turn.step', async function* ($, e) {
    for (const chunk of script[e.index] ?? []) {
      yield chunk
      await clock.advance(300)
      await look()
    }

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: e.index + 1 < script.length ? 'tool_use' : 'end_turn',
      usage: null,
    } as const
  })

  on('tool.call', async () => {
    await box.onTool()
    await look()

    return box.toolAnswer
  })

  return { box, clock }
}

async function mount($: Engine, box: { read: () => Promise<string> }) {
  const ui = await $.ui.mount(BAND)

  box.read = async () => (await ui.find({ key: 'activity' }))?.text ?? ''

  return ui
}

async function step($: Engine, index: number) {
  for await (const _ of $.turn.step({ ...STEP, index })) {
    // drained: the beneath hook looks at the box between chunks
  }
}

describe('register', () => {
  test('the box says idle before any turn, its triangle closed', async ($, on) => {
    mock.clock(on)

    const ui = await $.ui.mount(BAND)
    const text = (await ui.find({ key: 'activity' }))?.text ?? ''

    expect(text).toContain('Idle')
    expect(text).toContain('▸')
  })

  test('a turn reads, thinks, prepares, runs, reviews, writes and ends', async ($, on) => {
    const { box } = seat(on, [
      [
        { kind: 'thinking', index: 0, text: 'The config looks off. I should check the loader first' },
        { kind: 'tool', index: 1, id: 'tu1', name: 'Read' },
        { kind: 'input', index: 1, json: '{"file_path": "src/app.ts"' },
      ],
      [{ kind: 'text', index: 0, text: 'All fixed now, the loader reads it.' }],
    ])

    await mount($, box)

    const { turnId } = await $.turn.start({ text: 'fix the config', turnId: 't1' })

    expect(await box.read()).toContain('Reading your prompt')

    await step($, 0)

    expect(box.seen[0]).toContain('Thinking: I should check the loader first')
    expect(box.seen[1]).toContain('Reading your prompt')
    expect(box.seen[2]).toContain('Reading app.ts')
    expect(box.seen.join(' ')).not.toContain('Preparing')

    await $.tool.call({ tool: 'Read', file_path: 'src/app.ts' })

    expect(box.seen[3]).toContain('Reading app.ts')
    expect(await box.read()).toContain('Reviewing the results of 1 action')

    await step($, 1)

    expect(box.seen[4]).toContain('Writing the reply · 7 words')

    await $.turn.complete({ ...DONE, turnId })

    expect(await box.read()).toContain('Idle · last turn done in')
  })

  test('the triangle opens the history of the turn', async ($, on) => {
    const { box } = seat(on, [
      [{ kind: 'thinking', index: 0, text: 'Look at the file.' }],
      [{ kind: 'text', index: 0, text: 'Done.' }],
    ])

    const ui = await mount($, box)

    const { turnId } = await $.turn.start({ text: 'fix the config', turnId: 't1' })

    await step($, 0)
    await $.tool.call({ tool: 'Read', file_path: 'src/app.ts' })
    await step($, 1)
    await $.turn.complete({ ...DONE, turnId })

    expect(await ui.find({ key: 'history' })).toBeUndefined()

    await ui.press({ key: 'toggle' })

    const history = (await ui.find({ key: 'history' }))?.text ?? ''

    expect(history).toContain('fix the config')
    expect(history).toContain('Thought (4 words)')
    expect(history).toContain('⊘ Reading app.ts')
    expect(history).toContain('Wrote the reply (1 word)')
    expect(history).toContain('Done in')
    expect((await ui.find({ key: 'activity' }))?.text).toContain('▾')
  })

  test('thinking with no thought text keeps the last action', async ($, on) => {
    const { box } = seat(on, [
      [{ kind: 'thinking', index: 0, text: '' }],
      [{ kind: 'thinking', index: 0, text: '' }],
    ])

    await mount($, box)
    await $.turn.start({ text: 'fix the config', turnId: 't1' })
    await step($, 0)
    await $.tool.call({ tool: 'Read', file_path: 'src/app.ts' })
    await step($, 1)

    expect(box.seen[0]).toContain('Reading your prompt')
    expect(box.seen[2]).toContain('Reading app.ts')
    expect(box.seen.join(' ')).not.toContain('Thinking')
  })

  test('a command being written shows its description, never the command', async ($, on) => {
    const { box } = seat(on, [
      [
        { kind: 'tool', index: 0, id: 'tu1', name: 'Bash' },
        { kind: 'input', index: 0, json: '{"command": "npm test --silent"' },
        { kind: 'input', index: 0, json: ', "description": "Run the tests"' },
      ],
    ])

    await mount($, box)
    await $.turn.start({ text: 'test it', turnId: 't1' })
    await step($, 0)

    expect(box.seen[1]).toContain('Reading your prompt')
    expect(box.seen[2]).toContain('Run the tests')
    expect(box.seen.join(' ')).not.toContain('npm test')
  })

  test('control characters in a label never take the box down', async ($, on) => {
    const { box } = seat(on, [])
    const ui = await mount($, box)
    const esc = String.fromCharCode(27)
    const bel = String.fromCharCode(7)
    const rlo = String.fromCharCode(0x202e)

    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: `src/${esc}]0;title${bel}${esc}[31m${rlo}red.ts` })
    await $.tool.call({ tool: 'Read', file_path: `src/${'x'.repeat(200000)}.ts` })
    await ui.press({ key: 'toggle' })

    const history = (await ui.find({ key: 'history' }))?.text ?? ''

    expect(box.seen[0]).toContain('Reading')
    expect(box.seen[0]).toContain('red.ts')
    expect(box.seen[0]).not.toContain(esc)
    expect(box.seen[0]).not.toContain(rlo)
    expect(box.seen[1]?.length ?? 0).toBeLessThan(400)
    expect(history).toContain('red.ts')
  })

  test('a call waiting on a permission prompt says so', async ($, on) => {
    const { box } = seat(on, [])

    box.onTool = async () => {
      await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } })
    }

    await mount($, box)
    await $.turn.start({ text: 'test it', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })

    expect(box.seen[0]).toContain('Waiting for your approval: Run the tests')
  })
})