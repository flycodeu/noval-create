import { afterEach, describe, expect, it, vi } from 'vitest'
import { AliyunAdapter } from './aliyun.adapter'
import { BaiduAdapter } from './baidu.adapter'
import { OpenAIAdapter } from './openai.adapter'
import type { CallCompletion, ModelRequestEvent } from '../../src/shared/model-call-telemetry'

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const providers = [
  { name: 'aliyun', create: () => new AliyunAdapter('fixture'), frame: (text: string, final: boolean) => ({ output: { choices: [{ message: { content: text }, finish_reason: final ? 'length' : 'null' }] }, usage: { input_tokens: 12, output_tokens: 8 } }) },
  { name: 'baidu', create: () => new BaiduAdapter('fixture', 'fixture'), frame: (text: string, final: boolean) => ({ result: text, is_end: final, is_truncated: final, usage: { prompt_tokens: 12, completion_tokens: 8 } }) },
]

afterEach(() => { vi.unstubAllGlobals() })

describe.each(providers)('$name native telemetry', ({ create, frame }) => {
  it('reports native JSON usage and length exactly once', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/oauth/') ? json({ access_token: 'local-token', expires_in: 3600 }) : json(frame('候选稿', true))))
    const completion = vi.fn()
    expect(await create().chat([{ role: 'user', content: 'fixture' }], { onCompletion: completion })).toBe('候选稿')
    expect(completion).toHaveBeenCalledTimes(1)
    expect(completion).toHaveBeenCalledWith(expect.objectContaining({ finish: 'length', usage: expect.objectContaining({ input: { value: 12, source: 'reported' }, output: { value: 8, source: 'reported' } }) }))
  })

  it('keeps cumulative usage stable across duplicate terminal frames', async () => {
    const frames = [frame('候选', false), frame('', true), frame('', true)]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/oauth/') ? json({ access_token: 'local-token', expires_in: 3600 }) : new Response(frames.map((item) => `data: ${JSON.stringify(item)}\n\n`).join(''))))
    const completions: CallCompletion[] = []
    let text = ''
    await create().stream([{ role: 'user', content: 'fixture' }], { onStream: (chunk) => { text += chunk }, onCompletion: (result) => completions.push(result) })
    expect(text).toBe('候选')
    expect(completions).toHaveLength(1)
    expect(completions[0].usage.output.value).toBe(8)
    expect(completions[0].finish).toBe('length')
  })

  it('rejects an unterminated stream and preserves partial usage in its failed attempt', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/oauth/') ? json({ access_token: 'local-token', expires_in: 3600 }) : new Response(`data: ${JSON.stringify(frame('半段', false))}\n\n`)))
    const completions = vi.fn()
    const events: ModelRequestEvent[] = []
    await expect(create().stream([{ role: 'user', content: 'fixture' }], { onCompletion: completions, requestObserver: { onRequestEnd: (event) => events.push(event) } })).rejects.toMatchObject({ code: 'MODEL_STREAM_INTERRUPTED' })
    expect(completions).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ kind: 'stream', status: 'failed', usage: { input: { value: 12 }, output: { value: 8 } } })
  })
})

it('uses default metering for embeddings but lets explicit task observers take precedence', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ embedding: [1, 2] }], usage: { prompt_tokens: 10, total_tokens: 10 } })))
  const fallback = { onRequestStart: vi.fn(), onRequestEnd: vi.fn() }
  const scoped = { onRequestStart: vi.fn(), onRequestEnd: vi.fn() }
  const adapter = new OpenAIAdapter('fixture').setDefaultRequestObserver(fallback)
  await adapter.embed(['fixture'])
  expect(fallback.onRequestEnd).toHaveBeenCalledWith(expect.objectContaining({ kind: 'embedding', usage: expect.objectContaining({ input: { value: 10, source: 'reported' }, output: { value: null, source: 'unknown' } }) }))
  await adapter.embed(['fixture'], { requestObserver: scoped })
  expect(fallback.onRequestStart).toHaveBeenCalledTimes(1)
  expect(scoped.onRequestStart).toHaveBeenCalledTimes(1)
  expect(scoped.onRequestEnd).toHaveBeenCalledTimes(1)
})
