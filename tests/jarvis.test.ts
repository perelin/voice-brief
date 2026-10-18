import { describe, expect, mock, test } from 'claude-code/testing'
import type { CommandRunInput, ModelCompleteResult, On, SessionMessage } from 'claude-code'

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

const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const assistant = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] })
const toolResult = (): SessionMessage => ({
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false, result: 'ok' }],
})

type World = {
  prompts: string[]
  spoken: { text: string; voice?: string }[]
  settle: () => Promise<void>
}

const world = (on: On, messages: SessionMessage[], reply: ModelCompleteResult): World => {
  const prompts: string[] = []
  const spoken: { text: string; voice?: string }[] = []
  const clock = mock.clock(on)
  on('session.messages', () => ({ value: messages }))
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)

    return { value: reply }
  })
  on('audio.speak', (_$, e) => {
    spoken.push({ text: e.text, voice: e.voice })

    return { value: { via: 'system' as const } }
  })

  return { prompts, spoken, settle: clock.settle }
}

describe('/jarvis', () => {
  test('speaks a German briefing of the last turn with the German voice', async ($, on) => {
    const w = world(
      on,
      [
        user('Bau mir den Mod'),
        assistant('Ich schaue mir die Typen an.'),
        toolResult(),
        assistant('Fertig. **Entscheide**: Ablage in `skills/` oder `mods/`?'),
      ],
      {
        isAnswered: true,
        text: 'de\nDer Mod steht. Erstens: Ablage in skills oder mods, **Empfehlung** skills.',
        usage,
      },
    )

    const result = await $.command.run(JARVIS)
    await w.settle()

    expect(result.text).toBe('Der Mod steht. Erstens: Ablage in skills oder mods, Empfehlung skills.')
    expect(w.spoken).toEqual([{ text: result.text, voice: 'Anna' }])
    expect(w.prompts[0]).toContain('<question>\nBau mir den Mod\n</question>')
    expect(w.prompts[0]).toContain('Ich schaue mir die Typen an.')
    expect(w.prompts[0]).toContain('Ablage in `skills/` oder `mods/`?')
  })

  test('speaks an English briefing with the configured English voice', { options: { voiceEn: 'Daniel' } }, async ($, on) => {
    const w = world(on, [user('Ship it?'), assistant('Tests pass. Merge or wait?')], {
      isAnswered: true,
      text: 'en\nTests pass. One decision: merge now or wait.',
      usage,
    })

    await $.command.run(JARVIS)
    await w.settle()

    expect(w.spoken).toEqual([{ text: 'Tests pass. One decision: merge now or wait.', voice: 'Daniel' }])
  })

  test('says so and stays silent when there is no answer yet', async ($, on) => {
    const w = world(on, [user('Hallo')], { isAnswered: true, text: 'de\nunused', usage })

    const result = await $.command.run(JARVIS)
    await w.settle()

    expect(result.text).toContain('Noch keine Antwort')
    expect(w.prompts).toEqual([])
    expect(w.spoken).toEqual([])
  })

  test('reports a failed briefing call without speaking', async ($, on) => {
    const w = world(on, [user('Q'), assistant('A')], { isAnswered: false, reason: 'empty-reply', usage })

    const result = await $.command.run(JARVIS)
    await w.settle()

    expect(result.text).toContain('empty-reply')
    expect(w.spoken).toEqual([])
  })

  test('never speaks on its own when a turn ends', async ($, on) => {
    const w = world(on, [user('Q'), assistant('A')], { isAnswered: true, text: 'de\nunused', usage })
    on('turn.complete', () => ({ text: 'A' }))

    await $.turn.complete({ answer: 'A', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    await w.settle()

    expect(w.spoken).toEqual([])
    expect(w.prompts).toEqual([])
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

  test('parseBriefing falls back to guessing the language when the tag is missing', () => {
    expect(parseBriefing('Das ist fertig.').lang).toBe('de')
    expect(parseBriefing('All done.').lang).toBe('en')
  })
})
