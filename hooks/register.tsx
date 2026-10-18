import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { briefingPrompt, chunks, lastTurn, parseBriefing, systemPrompt } from './briefing'
import type { Lang, Length } from './briefing'
import { synthesizeRetrying } from './elevenlabs'
import type { ElevenLabsRequest } from './elevenlabs'

const isSpeaking = atom({ plugin: 'jarvis', key: 'isSpeaking' } as const, false)

// Module state: a reload starts silent and reads the key again.
const voice: { current?: AbortController; apiKey?: string } = {}

const option = (options: PluginOptions, key: string, fallback: string): string => {
  const value = options[key]

  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

const lengthFrom = (args: string, fallback: Length): Length => {
  const word = args.trim().toLowerCase()
  if (word === 'kurz' || word === 'short') {
    return 'short'
  }
  if (word === 'normal' || word === 'lang' || word === 'long') {
    return 'normal'
  }

  return fallback
}

export const register: Register = (on, options) => {
  const model = option(options, 'model', 'haiku')
  const length: Length = option(options, 'length', 'normal') === 'short' ? 'short' : 'normal'
  const isChunked = options.chunked !== false
  const provider = option(options, 'provider', 'elevenlabs')
  const elevenModel = option(options, 'elevenModel', 'eleven_v4')
  const elevenVoices: Record<Lang, string> = {
    de: option(options, 'elevenVoiceDe', 'yxa1FRMiemMJZYjqarqk'),
    en: option(options, 'elevenVoiceEn', 'BNgbHR0DNeZixGQVzloa'),
  }
  const passEntry = option(options, 'apiKeyPassEntry', 'services/elevenlabs/api-key')
  const systemVoices: Record<Lang, string> = {
    de: option(options, 'systemVoiceDe', 'Anna'),
    en: option(options, 'systemVoiceEn', 'Samantha'),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'jarvis',
      description: 'Speak a briefing of the last answer: gist, next step, open decisions',
      argumentHint: '[kurz|normal]',
    })

    return next(e)
  })

  on('command.run', { command: 'jarvis' }, async ($, e) => {
    stop($)

    const turn = lastTurn(await $.session.messages())
    if (turn === null) {
      return { text: 'Noch keine Antwort, die ich zusammenfassen könnte.' }
    }

    const reply = await $.model.complete({
      model,
      system: systemPrompt(lengthFrom(e.args, length)),
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

    let fallback = ''
    if (provider === 'elevenlabs') {
      const controller = new AbortController()
      voice.current = controller
      await update($, isSpeaking, () => true)
      try {
        const key = await loadKey($, passEntry)
        const parts = isChunked ? chunks(speech) : [speech]
        const pending = synthesizeAll($, parts, { key, voiceId: elevenVoices[lang], model: elevenModel, lang }, controller.signal)
        await pending[0]
        if (!controller.signal.aborted) {
          void playAll($, controller, pending)
        }

        return { text: speech }
      } catch (error) {
        fallback = error instanceof Error ? error.message : String(error)
        // The system voice cannot be interrupted, so the band never offers a Stop for it.
        await settle($, controller)
      }
    }

    void $.audio
      .speak(speech, { voice: systemVoices[lang] })
      .catch((error: unknown) => $.ui.toast(`jarvis: ${String(error)}`))

    return { text: fallback ? `${speech}\n\n(Systemstimme – ${fallback})` : speech }
  }).catch(() => ({ text: 'Jarvis ist gestolpert, Details im Debug-Log (claude --debug).' }))

  on('prompt.edit', ($, e, next) => {
    stop($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isSpeaking))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>🔊 Jarvis spricht – tippen oder </Text>
        <Button key="stop" label="Stop" hotkey="s" onPress={() => stop($)} />
      </Box>
    )
  })
}

function stop($: EngineInterface): void {
  if (voice.current === undefined) {
    return
  }
  voice.current.abort()
  voice.current = undefined
  void update($, isSpeaking, () => false)
}

async function settle($: EngineInterface, controller: AbortController): Promise<void> {
  if (voice.current === controller) {
    voice.current = undefined
    await update($, isSpeaking, () => false)
  }
}

// Two in flight: chunk i starts once chunk i-2 is done, leaving one of the plan's three slots free.
const MAX_IN_FLIGHT = 2

function synthesizeAll(
  $: EngineInterface,
  parts: readonly string[],
  base: Omit<ElevenLabsRequest, 'text' | 'previousText' | 'nextText'>,
  signal: AbortSignal,
): Promise<string>[] {
  const pending: Promise<string>[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const request: ElevenLabsRequest = { ...base, text: parts[i] ?? '', previousText: parts[i - 1], nextText: parts[i + 1] }
    const slot = pending[i - MAX_IN_FLIGHT]
    const audio =
      slot === undefined
        ? synthesizeRetrying($, request)
        : slot.then(() => (signal.aborted ? Promise.reject(new Error('gestoppt')) : synthesizeRetrying($, request)))
    // Awaited later by playAll; after a stop nobody awaits it, which must not surface as unhandled.
    audio.catch(() => undefined)
    pending.push(audio)
  }

  return pending
}

async function playAll($: EngineInterface, controller: AbortController, pending: readonly Promise<string>[]): Promise<void> {
  try {
    for (const next of pending) {
      const audio = await next
      if (controller.signal.aborted) {
        return
      }
      await $.audio.play({ base64: audio, mime: 'audio/mpeg' }, { signal: controller.signal })
      if (controller.signal.aborted) {
        return
      }
    }
  } catch (error) {
    $.ui.toast(`jarvis: ${String(error)}`)
  } finally {
    await settle($, controller)
  }
}

async function loadKey($: EngineInterface, passEntry: string): Promise<string> {
  voice.apiKey ??= (await $.env.get('ELEVENLABS_API_KEY'))?.trim() || (await passShow($, passEntry))

  return voice.apiKey
}

async function passShow($: EngineInterface, entry: string): Promise<string> {
  for (const bin of ['pass', '/opt/homebrew/bin/pass']) {
    try {
      const { exitCode, stdout } = await $.process.run([bin, 'show', entry], { timeoutMs: 20000 })
      const key = stdout.split('\n')[0]?.trim()
      if (exitCode === 0 && key) {
        return key
      }
    } catch {
      // try the next location
    }
  }
  throw new Error(`kein API-Key (ELEVENLABS_API_KEY oder pass ${entry})`)
}
