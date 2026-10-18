# voice-brief

A Claude Code mod that reads you a short spoken briefing of Claude's last answer when you ask for it: the gist in a sentence or two, what you have to do next, and every decision that is still open, with the recommendation if the answer gave one.

- **Only on demand.** `/voice-brief` speaks; nothing speaks on its own. With several sessions open, they don't talk over each other.
- **Interruptible.** Start typing in the prompt and the voice stops. While it speaks, a band above the prompt offers **Stop**.
- **Made for the ear.** The briefing is written for listening: no markdown, code, paths or URLs; those are left to the terminal.
- **ElevenLabs voice, system voice as fallback.** Without a key, or if ElevenLabs fails, macOS `say` speaks instead and the command output says why.

## Install

In a Claude Code session:

```
/plugin install voice-brief --marketplace perelin/voice-brief
```

Answer `y` to add the marketplace, then pick a scope (user scope for every project). New sessions load the mod; `/plugin` turns it off or on.

To update: `/plugin marketplace update voice-brief`, `/plugin update voice-brief@voice-brief`, then `/reload-plugins` in a running session.

### ElevenLabs API key

The key is read once per load, in this order:

1. `ELEVENLABS_API_KEY` in the environment
2. the first line of `pass show services/elevenlabs/api-key` ([pass](https://www.passwordstore.org/); the entry is the `apiKeyPassEntry` setting)

Without either, the system voice speaks.

## Use

| Command | What it does |
|---|---|
| `/voice-brief` | Brief the last answer at the configured length |
| `/voice-brief short` (or `kurz`) | Up to 60 words, this once |
| `/voice-brief normal` | Up to 120 words, this once |

To stop: type anything in the prompt, press **Stop** in the band above the prompt (click, or `ctrl+x tab` then `s`), or run `/voice-brief` again. The system voice cannot be interrupted, so the band only appears for ElevenLabs.

The briefing is written in the language of the answer (German or English) and also printed as the command's output.

## Settings

In `/config`, or under `pluginConfigs["voice-brief"].options` in settings:

| Setting | Default | What it does |
|---|---|---|
| `model` | `haiku` | Model that writes the briefing |
| `length` | `normal` | `normal` (≤ 120 words) or `short` (≤ 60) |
| `chunked` | `true` | Synthesize in chunks so the voice starts sooner |
| `provider` | `elevenlabs` | `elevenlabs` (with fallback) or `system` |
| `elevenModel` | `eleven_v4` | ElevenLabs model, see below |
| `elevenVoiceDe` | `yxa1FRMiemMJZYjqarqk` | German voice (Jonas – dry and factual) |
| `elevenVoiceEn` | `BNgbHR0DNeZixGQVzloa` | English voice (David – Deep and Engaging Storyteller, British) |
| `apiKeyPassEntry` | `services/elevenlabs/api-key` | pass entry with the key |
| `systemVoiceDe` | `Anna` | German fallback voice (`say -v '?'` lists them) |
| `systemVoiceEn` | `Samantha` | English fallback voice |

The default voices come from the ElevenLabs voice library. To list the voices your account can use:

```sh
curl -s "https://api.elevenlabs.io/v2/voices?page_size=100" -H "xi-api-key: $ELEVENLABS_API_KEY" | jq -r '.voices[] | [.voice_id, .name] | @tsv'
```

## Models, latency, cost

Measured on 18 Oct 2026 with the German default voice, one 776-character briefing (≈ 50 s of speech) in a single request:

| Model | Synthesis | `voice_settings.speed` | Price per 1k characters |
|---|---|---|---|
| `eleven_flash_v2_5` | 1.7 s | works | $0.04 |
| `eleven_v4_turbo` | 4.9 s | accepted, ignored | $0.04 |
| `eleven_v4` | 10.5 s | accepted, ignored | $0.08 |

That is why briefings are spoken in chunks: a short first chunk (≤ 120 characters, ≈ 2 s with v4) gets the voice going while the rest, in groups of sentences up to 400 characters, is still being synthesized. Each request carries its neighbours as `previous_text` / `next_text` to keep the intonation across the cut. At most two requests run at once (the Starter plan allows three and answers `429` beyond that, leaving one for another session); a `429` is retried twice before the system voice takes over. After a stop, no further chunks are requested.

A briefing is roughly 300–900 characters. With `eleven_v4` the Starter plan (90k credits a month) covers about 100–150 normal briefings; `short` doubles that, `eleven_flash_v2_5` doubles it again.

## How it works

1. `$.session.messages()` gives the last turn: every assistant text since the last real prompt, plus that prompt as context.
2. `$.model.complete` turns it into a spoken briefing: the language code on line 1, then plain sentences. Markdown, code, URLs and file paths are filtered out again before speaking.
3. ElevenLabs' `/v1/text-to-speech/{voice}/with-timestamps` returns the MP3 as base64 (a mod's `$.http.fetch` reads text bodies only), played with `$.audio.play` and an `AbortSignal`.
4. A `prompt.edit` hook aborts the playback on the first key; an `AbovePrompt` band shows Stop while it plays.

## Develop

```sh
claude plugin validate .
claude plugin test .
tsc -p .            # once a session has loaded the mod and laid its types
claude --plugin-dir .
```

## Limits

- Only the last turn is briefed. Decisions left open further back are not seen.
- Audio plays through `afplay`, so macOS only.
- Stopped chunks that were already requested are still billed.

## License

MIT
