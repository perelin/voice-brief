import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type {
  CommandRunInput,
  HttpResponse,
  ModelCompleteResult,
  On,
  PromptEditInput,
  RenderElement,
  SessionMessage,
} from 'claude-code'

import { lastTurn, parseBriefing, toSpeech } from '../hooks/briefing'

const usage = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const JARVIS: CommandRunInput = {
  command: 'jarvis',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
}

const BAND = {
  plugin: 'jarvis',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const JONAS = 'yxa1FRMiemMJZYjqarqk'
const PLAY_MS = 5000

const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const assistant = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] })
const toolResult = (): SessionMessage => ({
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false, result: 'ok' }],
})

const answered = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage })

const audioOk: HttpResponse = {
  status: 200,
  ok: true,
  headers: {},
  text: JSON.stringify({ audio_base64: 'QUJD', alignment: {} }),
}

type Setup = {
  messages?: SessionMessage[]
  reply?: ModelCompleteResult
  http?: HttpResponse
  passExit?: number
}

const world = (on: On, setup: Setup = {}) => {
  const prompts: string[] = []
  const spoken: { text: string; voice?: string }[] = []
  const played: string[] = []
  const requests: { url: string; headers?: Record<string, string>; body: Record<string, string> }[] = []
  const clock = mock.clock(on)
  mock.env(on, {})
  on('session.messages', () => ({ value: setup.messages ?? [user('Q'), assistant('A')] }))
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)

    return { value: setup.reply ?? answered('de\nAlles erledigt. Keine Entscheidungen offen.') }
  })
  on('process.run', () => ({
    value: {
      exitCode: setup.passExit ?? 0,
      stdout: setup.passExit ? '' : 'sk_test\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('http.fetch', (_$, e) => {
    requests.push({ url: e.url, headers: e.init?.headers, body: JSON.parse(e.init?.body ?? '{}') })

    return { value: setup.http ?? audioOk }
  })
  on('audio.play', async (_$, e) => {
    played.push(e.clip.base64 ?? '')
    await clock.sleep(PLAY_MS)

    return { value: undefined }
  })
  on('audio.speak', (_$, e) => {
    spoken.push({ text: e.text, voice: e.voice })

    return { value: { via: 'system' as const } }
  })
  on('command.register', () => ({ value: { command: 'jarvis' } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine-band' }) as RenderElement)
  on('prompt.edit', (_$, e) => ({ text: e.text, cursor: e.cursor }))

  return { prompts, spoken, played, requests, clock }
}

// The kit raises prompt.edit like any engine event, but its typed $ leaves the noun out.
const typeKey = ($: Engine, inputText: string) =>
  ($.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }).edit({
    origin: { kind: 'composer' },
    text: '',
    cursor: 0,
    start: 0,
    end: 0,
    inputText,
  })

const stopButton = async ($: Engine) => {
  const band = await $.ui.mount(BAND)
  const found = await band.find({ key: 'stop' })
  await band.unmount()

  return found
}

describe('/jarvis with ElevenLabs', () => {
  test('speaks a German briefing with the German voice and shows Stop while it plays', async ($, on) => {
    const w = world(on, {
      messages: [
        user('Bau mir den Mod'),
        assistant('Ich schaue mir die Typen an.'),
        toolResult(),
        assistant('Fertig. **Entscheide**: Ablage in `skills/` oder `mods/`?'),
      ],
      reply: answered('de\nDer Mod steht. Erstens: Ablage in skills oder mods, **Empfehlung** skills.'),
    })

    const result = await $.command.run(JARVIS)
    await w.clock.settle()

    expect(result.text).toBe('Der Mod steht. Erstens: Ablage in skills oder mods, Empfehlung skills.')
    expect(w.requests).toHaveLength(1)
    expect(w.requests[0]?.url).toContain(`/v1/text-to-speech/${JONAS}/with-timestamps`)
    expect(w.requests[0]?.headers?.['xi-api-key']).toBe('sk_test')
    expect(w.requests[0]?.body).toEqual({ text: result.text, model_id: 'eleven_flash_v2_5', language_code: 'de' })
    expect(w.played).toEqual(['QUJD'])
    expect(w.spoken).toEqual([])
    expect(w.prompts[0]).toContain('<question>\nBau mir den Mod\n</question>')
    expect(await stopButton($)).toBeDefined()

    await w.clock.advance(PLAY_MS)
    expect(await stopButton($)).toBeUndefined()
  })

  test('uses the configured English voice and leaves out language_code where the model rejects it', {
    options: { elevenVoiceEn: 'voice-en', elevenModel: 'eleven_multilingual_v2' },
  }, async ($, on) => {
    const w = world(on, { reply: answered('en\nTests pass. One decision: merge now or wait.') })

    await $.command.run(JARVIS)
    await w.clock.settle()

    expect(w.requests[0]?.url).toContain('/v1/text-to-speech/voice-en/with-timestamps')
    expect(w.requests[0]?.body).toEqual({
      text: 'Tests pass. One decision: merge now or wait.',
      model_id: 'eleven_multilingual_v2',
    })
  })

  test('typing in the prompt stops the voice', async ($, on) => {
    const w = world(on)
    await $.command.run(JARVIS)
    await w.clock.settle()
    expect(await stopButton($)).toBeDefined()

    await typeKey($, 'a')

    expect(await stopButton($)).toBeUndefined()
  })

  test('the Stop button stops the voice', async ($, on) => {
    const w = world(on)
    await $.command.run(JARVIS)
    await w.clock.settle()

    const band = await $.ui.mount(BAND)
    await band.press({ key: 'stop' })
    expect(await band.find({ key: 'stop' })).toBeUndefined()
    await band.unmount()
  })

  test('falls back to the system voice when ElevenLabs fails, without offering Stop', async ($, on) => {
    const w = world(on, {
      http: { status: 401, ok: false, headers: {}, text: JSON.stringify({ detail: { message: 'invalid key' } }) },
    })

    const result = await $.command.run(JARVIS)
    await w.clock.settle()

    expect(result.text).toContain('Systemstimme – ElevenLabs 401: invalid key')
    expect(w.spoken).toEqual([{ text: 'Alles erledigt. Keine Entscheidungen offen.', voice: 'Anna' }])
    expect(w.played).toEqual([])
    expect(await stopButton($)).toBeUndefined()
  })

  test('falls back to the system voice when no API key is found', async ($, on) => {
    const w = world(on, { passExit: 1 })

    const result = await $.command.run(JARVIS)
    await w.clock.settle()

    expect(result.text).toContain('kein API-Key')
    expect(w.requests).toEqual([])
    expect(w.spoken).toHaveLength(1)
  })
})

describe('/jarvis in general', () => {
  test('provider system speaks with the system voice and never calls ElevenLabs', {
    options: { provider: 'system', systemVoiceEn: 'Daniel' },
  }, async ($, on) => {
    const w = world(on, { reply: answered('en\nAll done.') })

    const result = await $.command.run(JARVIS)
    await w.clock.settle()

    expect(result.text).toBe('All done.')
    expect(w.requests).toEqual([])
    expect(w.spoken).toEqual([{ text: 'All done.', voice: 'Daniel' }])
  })

  test('says so and stays silent when there is no answer yet', async ($, on) => {
    const w = world(on, { messages: [user('Hallo')] })

    const result = await $.command.run(JARVIS)
    await w.clock.settle()

    expect(result.text).toContain('Noch keine Antwort')
    expect(w.prompts).toEqual([])
    expect(w.played).toEqual([])
    expect(w.spoken).toEqual([])
  })

  test('reports a failed briefing call without speaking', async ($, on) => {
    const w = world(on, { reply: { isAnswered: false, reason: 'empty-reply', usage } })

    const result = await $.command.run(JARVIS)
    await w.clock.settle()

    expect(result.text).toContain('empty-reply')
    expect(w.played).toEqual([])
    expect(w.spoken).toEqual([])
  })

  test('never speaks on its own when a turn ends', async ($, on) => {
    const w = world(on)
    on('turn.complete', () => ({ text: 'A' }))

    await $.turn.complete({ answer: 'A', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    await w.clock.settle()

    expect(w.prompts).toEqual([])
    expect(w.played).toEqual([])
    expect(w.spoken).toEqual([])
  })
})

describe('briefing helpers', () => {
  test('lastTurn skips trailing user rows and stops at the prompt', () => {
    const turn = lastTurn([user('alt'), assistant('alt'), user('neu'), assistant('eins'), toolResult(), assistant('zwei'), user('/jarvis')])

    expect(turn).toEqual({ prompt: 'neu', answer: 'eins\n\nzwei' })
  })

  test('toSpeech drops markdown, code and links', () => {
    expect(toSpeech('## Titel\n- **fett** `code`\n```ts\nx()\n```\nsiehe https://x.y/z')).toBe('Titel fett code siehe')
  })

  test('toSpeech drops file paths but keeps the sentence around them', () => {
    expect(toSpeech('Der Bug in src/auth/session.ts und ~/.claude/x.md ist weg, mods/jarvis/hooks auch. Mergen ja/nein, und/oder warten?')).toBe(
      'Der Bug in und ist weg, auch. Mergen ja/nein, und/oder warten?',
    )
  })

  test('parseBriefing falls back to guessing the language when the tag is missing', () => {
    expect(parseBriefing('Das ist fertig.').lang).toBe('de')
    expect(parseBriefing('All done.').lang).toBe('en')
  })
})
