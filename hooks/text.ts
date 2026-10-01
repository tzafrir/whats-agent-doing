/** Collapses runs of whitespace, newlines included, to single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Cuts `text` to `max` characters, marking the cut with an ellipsis. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * The sentence Claude is thinking right now: the tail of the thought so far,
 * with the sentence before it when the current one has barely started.
 *
 * @param thought the thinking block's text so far
 * @param max the longest snippet, cut from the front
 */
export function thoughtOf(thought: string, max: number): string {
  const flat = oneLine(thought.replace(/[*_`#>]/g, ''))

  if (flat === '') {
    return ''
  }

  const sentences = flat.split(/(?<=[.!?:])\s+/)
  const last = sentences.at(-1) ?? ''
  const before = sentences.at(-2)
  const tail = last.length < 25 && before !== undefined ? `${before} ${last}` : last

  return tail.length > max ? `…${tail.slice(-(max - 1))}` : tail
}

export function wordsIn(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** `840 B`, `2.3 KB`, `1.1 MB`. */
export function sizeOf(chars: number): string {
  if (chars < 1024) {
    return `${chars} B`
  }

  if (chars < 1024 * 1024) {
    return `${(chars / 1024).toFixed(1)} KB`
  }

  return `${(chars / 1024 / 1024).toFixed(1)} MB`
}

/** `0.4s` under ten seconds, `12s` under a minute, `3m 05s` after. */
export function durationOf(ms: number): string {
  const seconds = Math.max(0, ms) / 1000

  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`
  }

  if (seconds < 60) {
    return `${Math.floor(seconds)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)

  return `${minutes}m ${String(rest).padStart(2, '0')}s`
}
