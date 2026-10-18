import type { EngineInterface } from 'claude-code'

import type { Lang } from './briefing'

export type ElevenLabsRequest = {
  key: string
  voiceId: string
  model: string
  lang: Lang
  text: string
}

// Only these models take language_code; multilingual_v2 rejects it.
const TAKES_LANGUAGE = /^eleven_(flash|turbo|v4_turbo)/

// with-timestamps answers JSON with the MP3 as base64; $.http.fetch only reads text bodies.
export async function synthesize($: EngineInterface, request: ElevenLabsRequest): Promise<string> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(request.voiceId)}/with-timestamps?output_format=mp3_44100_128`
  const body: Record<string, string> = { text: request.text, model_id: request.model }
  if (TAKES_LANGUAGE.test(request.model)) {
    body.language_code = request.lang
  }

  const response = await $.http.fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': request.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`ElevenLabs ${response.status}${detail(response.text)}`)
  }

  const audio = (JSON.parse(response.text) as { audio_base64?: unknown }).audio_base64
  if (typeof audio !== 'string' || !audio) {
    throw new Error('ElevenLabs lieferte kein Audio')
  }

  return audio
}

const detail = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as { detail?: { message?: unknown } | string }
    const message = typeof parsed.detail === 'string' ? parsed.detail : parsed.detail?.message

    return typeof message === 'string' ? `: ${message.slice(0, 160)}` : ''
  } catch {
    return ''
  }
}
