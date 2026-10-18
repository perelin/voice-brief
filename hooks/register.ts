import type { PluginOptions, Register } from 'claude-code'

import { SYSTEM, briefingPrompt, lastTurn, parseBriefing } from './briefing'
import type { Lang } from './briefing'

const option = (options: PluginOptions, key: string, fallback: string): string => {
  const value = options[key]

  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export const register: Register = (on, options) => {
  const model = option(options, 'model', 'haiku')
  const voices: Record<Lang, string> = {
    de: option(options, 'voiceDe', 'Anna'),
    en: option(options, 'voiceEn', 'Samantha'),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'jarvis',
      description: 'Speak a briefing of the last answer: gist, next step, open decisions',
    })

    return next(e)
  })

  on('command.run', { command: 'jarvis' }, async $ => {
    const turn = lastTurn(await $.session.messages())
    if (turn === null) {
      return { text: 'Noch keine Antwort, die ich zusammenfassen könnte.' }
    }

    const reply = await $.model.complete({
      model,
      system: SYSTEM,
      prompt: briefingPrompt(turn),
      maxTokens: 600,
      effort: 'low',
      timeoutMs: 30000,
    })
    if (!reply.isAnswered) {
      return { text: `Kein Briefing möglich (${reply.reason}).` }
    }

    const { lang, speech } = parseBriefing(reply.text)
    if (!speech) {
      return { text: 'Das Briefing kam leer zurück.' }
    }

    // Not awaited: the command returns while the voice is still talking.
    void $.audio
      .speak(speech, { voice: voices[lang] })
      .catch((error: unknown) => $.ui.toast(`jarvis: ${String(error)}`))

    return { text: speech }
  }).catch(() => ({ text: 'Jarvis ist gestolpert, Details im Debug-Log (claude --debug).' }))
}
