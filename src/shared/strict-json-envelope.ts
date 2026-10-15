/** Accept a complete JSON code fence, but never salvage JSON from prose or repair it. */
export function parseStrictJsonEnvelope(raw: string): unknown {
  const text = raw.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/iu.exec(text)
  return JSON.parse(fenced ? fenced[1] : text)
}
