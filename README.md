# jarvis

Claude-Code-Mod: `/jarvis` liest ein gesprochenes Briefing der letzten Antwort vor –
Lage in ein, zwei Sätzen, was als Nächstes zu tun ist, welche Entscheidungen offen sind
(mit Empfehlung, falls die Antwort eine gab). Spricht nie von selbst, damit mehrere
offene Sessions sich nicht gegenseitig zuquatschen.

## Ablauf

1. `$.session.messages()` – die letzte Runde: alle Assistant-Texte seit dem letzten
   echten Prompt, plus der Prompt selbst als Kontext.
2. `$.model.complete` (Default `haiku`) schreibt daraus ein Briefing fürs Ohr:
   Sprachcode in Zeile 1, dann reiner Sprechtext ohne Markdown, Pfade, Code.
3. `$.audio.speak` mit der Systemstimme (`say` auf macOS), Stimme je nach Sprache.
   Das Briefing steht zusätzlich als Command-Ausgabe im Transkript.

## Laden

Für eine Session:

```sh
claude --plugin-dir ~/.claude/mods/jarvis
```

Dauerhaft: den Pfad in `CLAUDE_CODE_PLUGIN_DIRS` setzen (Prozess-Env oder `env`-Block
der maschinen-lokalen `~/.claude/settings.json`).

## Einstellungen

Unter `pluginConfigs.jarvis` in den Settings bzw. im `/config`-Menü:

| Feld | Default | Bedeutung |
| --- | --- | --- |
| `model` | `haiku` | Modell fürs Briefing |
| `voiceDe` | `Anna` | Stimme für deutsche Briefings |
| `voiceEn` | `Samantha` | Stimme für englische Briefings |

Installierte Stimmen: `say -v '?'`.

## Entwickeln

```sh
claude plugin validate ~/.claude/mods/jarvis
claude plugin test ~/.claude/mods/jarvis
```

## Grenzen

- Eine laufende Ansage lässt sich nicht abbrechen (`$.audio.speak` nimmt kein Signal);
  `killall say` stoppt sie – und jede andere `say`-Ausgabe auf dem Rechner.
- Sieht nur die letzte Runde. Entscheidungen, die weiter zurück offen geblieben sind,
  kennt das Briefing nicht (`$.model.fork` über das ganze Transkript wäre der Ausbau,
  kostet aber das Session-Modell).
- Systemstimme only; auf Linux/Windows ohne Synthesizer schlägt `speak` fehl
  und meldet sich per Toast.
