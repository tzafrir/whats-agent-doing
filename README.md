# What's Claude Doing

A [Claude Code mod](https://github.com/anthropics/claude-code/blob/main/mods/README.md) that adds a little box above the prompt that always says what Claude is doing right now, and expands to show what it has done.

```
╭────────────────────────────────────────────────────────────────╮
│ ▸ ● Claude: Thinking: …I should check the loader first · 4.2s  │
╰────────────────────────────────────────────────────────────────╯
```

What it says, as Claude works:

| State | Example |
|-------|---------|
| Reading the prompt | `Reading your prompt` |
| Thinking, with the thought's latest sentence | `Thinking: …the hook needs to await next` |
| Composing a tool call, as its input streams | `Preparing: Writing register.tsx · 2.3 KB` |
| Running a tool | `Reading app.ts`, `Run the tests`, `Fetching github.com` |
| A subagent at work | `Running an agent: find the bug › Reading app.ts` |
| Waiting on you | `Waiting for your approval: Run the tests`, `Waiting for your answer` |
| Reading tool results | `Reviewing the results of 3 actions` |
| Writing the reply | `Writing the reply · 120 words` |
| Compacting | `Compacting the conversation` |
| Between turns | `Idle · last turn done in 42s, 6 actions` (or interrupted, stopped on an error, declined) |

Parallel calls show the newest with `(+N more)`, and a timer counts how long the current state has lasted.

Click the triangle (or focus the band with `ctrl+x tab` and press Enter) to expand the history: each prompt, stretch of thinking, tool call (✓ done, ✗ failed, ⊘ denied, ■ interrupted), reply and turn ending, with durations. The history and the toggle live in `$.state`, so they survive a reload. The box steps aside while a survey holds the band; collapse the whole band with `ctrl+x ctrl+a`.

## Use

```
git clone https://github.com/tzafrir/whats-claude-doing
claude --plugin-dir whats-claude-doing
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
| `hooks/register.tsx` | The hooks: the model's stream (`turn.step`), tools (`tool.call`), approvals (`classic.PermissionRequest`), subagents, compaction, turns, and the box's drawing (`ui.render` on `AbovePrompt`) |
| `hooks/activity-of.ts` | Turns a tool call, whole or still streaming, into its short label |
| `hooks/text.ts` | Thought snippets, word counts, sizes, durations |
| `types/index.d.ts` | The `$.state` contract: the headline, the history, the toggle |
| `tests/register.test.tsx` | Idle, a whole turn state by state, the history toggle, an approval wait |

## License

MIT
