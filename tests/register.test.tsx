import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'activity-box',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const DONE = {
  answer: 'done',
  durationMs: 1000,
  isAborted: false,
  reason: 'answer',
  category: null,
  explanation: null,
} as const

/**
 * Seats a clock, turns and a stub tool beneath the plugin; the tool records
 * what the box said while the call ran (`read` is set once it is mounted).
 */
function seat(on: On) {
  const box = { read: async () => '', seen: [] as string[] }

  mock.clock(on)

  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  on('tool.call', async () => {
    box.seen.push(await box.read())

    return { deny: 'stubbed in the test' }
  })

  return box
}

describe('register', () => {
  test('the box says idle before any turn', async ($, on) => {
    mock.clock(on)

    const ui = await $.ui.mount(BAND)

    expect((await ui.find({ key: 'activity' }))?.text).toContain('Idle')
  })

  test('the box follows a turn: thinking, the tool, thinking, idle', async ($, on) => {
    const box = seat(on)
    const ui = await $.ui.mount(BAND)

    box.read = async () => (await ui.find({ key: 'activity' }))?.text ?? ''

    const { turnId } = await $.turn.start({ text: 'fix it', turnId: 't1' })

    expect(await box.read()).toContain('Thinking')

    await $.tool.call({ tool: 'Read', file_path: 'C:\\work\\src\\app.ts' })

    expect(box.seen[0]).toContain('Reading app.ts')
    expect(await box.read()).toContain('Thinking')

    await $.turn.complete({ ...DONE, turnId })

    expect(await box.read()).toContain('Idle')
  })

  test('a shell call shows its description over its command', async ($, on) => {
    const box = seat(on)
    const ui = await $.ui.mount(BAND)

    box.read = async () => (await ui.find({ key: 'activity' }))?.text ?? ''

    await $.turn.start({ text: 'test it', turnId: 't2' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })

    expect(box.seen[0]).toContain('Run the tests')
    expect(box.seen[0]).not.toContain('npm test')
  })
})
