import type { ToolCallInput } from 'claude-code'

const MAX_DETAIL_CHARS = 60

/**
 * Says in a few words what a tool call is doing, for the activity box.
 *
 * @param e the `tool.call` input
 * @returns a short label such as `Reading register.tsx`
 */
export function activityOf(e: ToolCallInput): string {
  const args = e as unknown as Record<string, unknown>

  const arg = (key: string): string => {
    const value = args[key]

    return typeof value === 'string' ? clip(oneLine(value)) : ''
  }

  const file = (key: string): string => baseName(arg(key))

  // A string: the declared names are only the tools of the session that
  // wrote the types, and other sessions have others (Grep, Glob, ...).
  const tool: string = e.tool

  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return arg('description') || `Running ${arg('command')}`
    case 'Read':
      return `Reading ${file('file_path')}`
    case 'Edit':
      return `Editing ${file('file_path')}`
    case 'Write':
      return `Writing ${file('file_path')}`
    case 'NotebookEdit':
      return `Editing ${file('notebook_path')}`
    case 'Grep':
      return `Searching for "${arg('pattern')}"`
    case 'Glob':
      return `Finding files ${arg('pattern')}`
    case 'WebFetch':
      return `Fetching ${hostOf(arg('url'))}`
    case 'WebSearch':
      return `Searching the web for "${arg('query')}"`
    case 'Agent':
    case 'Task':
      return `Running an agent: ${arg('description')}`
    case 'TodoWrite':
      return 'Updating the todo list'
    case 'AskUserQuestion':
      return 'Waiting for your answer'
    case 'Skill':
      return `Using the ${arg('skill')} skill`
  }

  if (tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = tool.split('__')

    return `Using ${server}: ${name}`
  }

  return `Using ${tool}`
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function clip(text: string): string {
  return text.length > MAX_DETAIL_CHARS
    ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…`
    : text
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
