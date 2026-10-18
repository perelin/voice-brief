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
   Standard ist in Stücken: kurzes erstes Stück (≤ 120 Zeichen), danach Satzgruppen
   bis 400 Zeichen, jeweils mit `previous_text`/`next_text` für die Satzmelodie; die
   Stimme startet, sobald das erste Stück da ist. Höchstens zwei Anfragen gleichzeitig
   (Starter erlaubt drei, eine bleibt für andere Sessions frei); ein 429 wird bis zu
   zweimal wiederholt, bevor die Systemstimme übernimmt.
4. Schlägt ElevenLabs fehl (kein Key, HTTP-Fehler), spricht die Systemstimme (`say`)
   und die Command-Ausgabe nennt den Grund.

Das Briefing steht zusätzlich als Command-Ausgabe im Transkript.

## Unterbrechen

- **Tippen im Prompt** stoppt die Stimme sofort (`prompt.edit`), noch ausstehende Stücke
  werden nicht mehr gespielt (bezahlt sind sie trotzdem, sie wurden schon angefragt).
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
| `length` | `normal` | `normal` (≤ 120 Wörter) oder `short` (≤ 60); `/jarvis kurz` bzw. `/jarvis normal` übersteuert einmalig |
| `chunked` | `true` | in Stücken vertonen, damit die Stimme früher startet |
| `provider` | `elevenlabs` | `elevenlabs` (mit Fallback) oder `system` |
| `elevenModel` | `eleven_v4` | ElevenLabs-Modell, siehe Latenz unten |
| `elevenVoiceDe` | `yxa1FRMiemMJZYjqarqk` | Jonas – dry and factual |
| `elevenVoiceEn` | `BNgbHR0DNeZixGQVzloa` | David – Deep and Engaging Storyteller (britisch) |
| `apiKeyPassEntry` | `services/elevenlabs/api-key` | pass-Eintrag mit dem Key |
| `systemVoiceDe` | `Anna` | Fallback-Stimme Deutsch (`say -v '?'`) |
| `systemVoiceEn` | `Samantha` | Fallback-Stimme Englisch |

Stimmen-IDs des eigenen Accounts:
`curl -s "https://api.elevenlabs.io/v2/voices?page_size=100" -H "xi-api-key: $KEY" | jq -r '.voices[] | [.voice_id, .name] | @tsv'`

`language_code` geht nur an Modelle, die ihn annehmen (Flash, Turbo, v4); `eleven_multilingual_v2`
lehnt ihn ab.

## Latenz und Tempo

Gemessen am 18.10.26 mit Jonas, ein Stück am Stück (776 Zeichen, ≈ 50 s Sprechzeit):

| Modell | Synthese | Tempo (`voice_settings.speed`) |
| --- | --- | --- |
| `eleven_flash_v2_5` | 1,7 s | wirkt (1.15 → ≈ 25 % kürzer) |
| `eleven_v4_turbo` | 4,9 s | wird angenommen, aber ignoriert |
| `eleven_v4` | 10,5 s | wird angenommen, aber ignoriert |

Ein erstes Stück von ≈ 80 Zeichen braucht mit v4 ≈ 1,9 s, mit v4 Turbo ≈ 0,8 s – daher
die Stücke. Dazu kommt die Briefing-Erzeugung durch das `model`.

## Kosten

Ein Briefing hat etwa 300–900 Zeichen. v4 kostet einen Credit pro Zeichen, Flash und
v4 Turbo die Hälfte: Starter (90k Credits) reicht mit v4 für grob 100–150 normale
Briefings im Monat, mit `short` etwa doppelt so viele. Ein wiederholtes `/jarvis` auf
dieselbe Antwort synthetisiert neu.

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
