# jarvis

Claude-Code-Mod: `/jarvis` liest ein gesprochenes Briefing der letzten Antwort vor –
Lage in ein, zwei Sätzen, was als Nächstes zu tun ist, welche Entscheidungen offen sind
(mit Empfehlung, falls die Antwort eine gab). Spricht nie von selbst, damit mehrere
offene Sessions sich nicht gegenseitig zuquatschen.

## Ablauf

1. `$.session.messages()` – die letzte Runde: alle Assistant-Texte seit dem letzten
   echten Prompt, plus der Prompt selbst als Kontext.
2. `$.model.complete` (Default `haiku`) schreibt daraus ein Briefing fürs Ohr:
   Sprachcode in Zeile 1, dann reiner Sprechtext; Markdown, Code, URLs und Pfade
   werden zusätzlich herausgefiltert.
3. ElevenLabs (`/v1/text-to-speech/{voice}/with-timestamps`, liefert die MP3 als
   base64 – `$.http.fetch` liest nur Text) → `$.audio.play`. Stimme je Sprache.
4. Schlägt ElevenLabs fehl (kein Key, HTTP-Fehler), spricht die Systemstimme (`say`)
   und die Command-Ausgabe nennt den Grund.

Das Briefing steht zusätzlich als Command-Ausgabe im Transkript.

## Unterbrechen

- **Tippen im Prompt** stoppt die Stimme sofort (`prompt.edit`).
- Solange Jarvis spricht, steht über dem Prompt **„🔊 Jarvis spricht – tippen oder [Stop]"**:
  klicken, oder `ctrl+x tab` und `s`.
- Ein neues `/jarvis` beendet das laufende Briefing vorher.
- Die Systemstimme (Fallback oder `provider: system`) lässt sich nicht unterbrechen;
  die Leiste erscheint dann nicht.

## Laden

Für eine Session:

```sh
claude --plugin-dir ~/.claude/mods/jarvis
```

Dauerhaft: den Pfad in `CLAUDE_CODE_PLUGIN_DIRS` setzen (Prozess-Env oder `env`-Block
der maschinen-lokalen `~/.claude/settings.json`).

## API-Key

Reihenfolge: `ELEVENLABS_API_KEY` aus der Umgebung, sonst die erste Zeile von
`pass show services/elevenlabs/api-key` (Eintrag per `apiKeyPassEntry` änderbar).
Der Key wird pro Mod-Ladung einmal gelesen.

## Einstellungen

Unter `pluginConfigs.jarvis.options` in den Settings bzw. im `/config`-Menü:

| Feld | Default | Bedeutung |
| --- | --- | --- |
| `model` | `haiku` | Modell fürs Briefing |
| `provider` | `elevenlabs` | `elevenlabs` (mit Fallback) oder `system` |
| `elevenModel` | `eleven_flash_v2_5` | ElevenLabs-Modell; Flash kostet die Hälfte, `eleven_v4` klingt am besten |
| `elevenVoiceDe` | `yxa1FRMiemMJZYjqarqk` | Jonas – dry and factual |
| `elevenVoiceEn` | `BNgbHR0DNeZixGQVzloa` | David – Deep and Engaging Storyteller (britisch) |
| `apiKeyPassEntry` | `services/elevenlabs/api-key` | pass-Eintrag mit dem Key |
| `systemVoiceDe` | `Anna` | Fallback-Stimme Deutsch (`say -v '?'`) |
| `systemVoiceEn` | `Samantha` | Fallback-Stimme Englisch |

Stimmen-IDs des eigenen Accounts:
`curl -s "https://api.elevenlabs.io/v2/voices?page_size=100" -H "xi-api-key: $KEY" | jq -r '.voices[] | [.voice_id, .name] | @tsv'`

`language_code` geht nur an Modelle, die ihn annehmen (Flash, Turbo); `eleven_multilingual_v2`
lehnt ihn ab.

## Kosten

Ein Briefing hat etwa 600–900 Zeichen. Flash rechnet halbe Credits: Starter (90k Credits)
reicht für grob 200 Briefings im Monat. Ein wiederholtes `/jarvis` auf dieselbe Antwort
synthetisiert neu.

## Entwickeln

```sh
claude plugin validate ~/.claude/mods/jarvis
claude plugin test ~/.claude/mods/jarvis
```

Funktionen, die `$` bekommen, müssen auf oberster Ebene als `function`-Deklaration stehen
(importierte ebenso) – sonst lädt das Modul nicht.

## Grenzen

- Sieht nur die letzte Runde. Entscheidungen, die weiter zurück offen geblieben sind,
  kennt das Briefing nicht (`$.model.fork` über das ganze Transkript wäre der Ausbau,
  kostet aber das Session-Modell).
- Die Audio-Wiedergabe läuft über `afplay`, also nur auf macOS.
