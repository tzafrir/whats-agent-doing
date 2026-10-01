# activity-box

A [Claude Code mod](https://github.com/anthropics/claude-code/blob/main/mods/README.md) that adds a little box above the prompt that always says what Claude is doing right now.

```
╭──────────────────────────────────────╮
│ ● Claude: Reading register.tsx · 4s  │
╰──────────────────────────────────────╯
```

- **Thinking** when a turn starts and between tool calls
- The current tool in plain words: `Reading app.ts`, `Editing foo.ts`, `Searching for "x"`, `Fetching github.com`, `Running an agent: …`, or a shell command's own description
- Parallel calls show the newest with `(+N more)`; subagents' inner calls are folded into the main `Running an agent` line
- A seconds counter for the current activity while Claude works
- **Idle, waiting for your prompt** when the turn ends
- Steps aside while a survey holds the band; collapse it with `ctrl+x ctrl+a`

## Use

```
git clone https://github.com/tzafrir/activity-box
claude --plugin-dir activity-box
```

Mods are early access: hooks modules load only where function hooks are enabled, and the API may change between Claude Code releases. The box is drawn in the `AbovePrompt` band, which is terminal only.

## Develop

```
claude plugin validate .
claude plugin test .
```

To typecheck, first run `/plugin-types` in a Claude Code session in this folder (it writes `.claude/types/claude-code.d.ts`), then:

```
npx -p typescript tsc -p tsconfig.json
```

| File | What it does |
|------|--------------|
| `hooks/register.tsx` | The hooks (`turn.start`, `tool.call`, `turn.complete`) and the box's drawing (`ui.render` on `AbovePrompt`) |
| `hooks/activity-of.ts` | Turns a tool call into its short label |
| `tests/register.test.tsx` | Idle before a turn, a whole turn, a shell call's description |

## License

MIT
