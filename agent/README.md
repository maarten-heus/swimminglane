# Swimminglane playtest-agent

Een Claude-gebaseerde agent die het Zwembad-spel (`../swimminglane.html`) in een
echte browser **speelt** én er **verbeterfeedback** over geeft.

- Snel model (`claude-haiku-4-5`) neemt per zet een beslissing en bestuurt het spel
  via de ingebouwde `window.__agent`-API.
- Sterk model (`claude-opus-4-8`) bekijkt aan het eind de metrics + screenshots en
  schrijft concrete verbeterpunten naar `feedback.md`.

## Hoe het werkt

Het spel is geïnstrumenteerd met een "agent mode" (`window.__agent` in
`swimminglane.html`):

| Functie | Wat het doet |
|---|---|
| `__agent.enable()` | schakelt de rAF-lus uit; het spel wordt door `step()` aangedreven |
| `__agent.seed(n)` | deterministische RNG → herhaalbare runs |
| `__agent.getState()` | gestructureerde momentopname (speler, zwemmers, level, hits, metrics) |
| `__agent.press(a)` | injecteert een toets: `left/right/up/down/space/dive/b/enter` |
| `__agent.step(n)` | stapt n frames vooruit (tijd + spawns lopen op frames) en geeft de nieuwe state |

De harness leest de state, vraagt het snelle model om één actie, drukt die toets,
stapt ~12 frames vooruit, en herhaalt. Screenshots worden onderweg gemaakt
(`shots/`). Aan het eind gaat alles naar het sterke model voor de kritiek.

## Vereisten

- Node.js 18+  (nog niet geïnstalleerd op deze machine — installeer via <https://nodejs.org>)
- Een Anthropic API-key

## Installeren en draaien

```bash
cd agent
npm install
npx playwright install chromium   # eenmalig: haalt de headless browser op

# API-key zetten (PowerShell)
$env:ANTHROPIC_API_KEY = "sk-ant-..."
# of (bash)
export ANTHROPIC_API_KEY="sk-ant-..."

npm run play
```

Resultaat:
- `feedback.md` — de verbeterpunten van het sterke model
- `shots/` — de screenshots uit de sessie

## Knoppen om aan te draaien (bovenin `play.mjs`)

- `MAX_DECISIONS` — hoeveel model-zetten (kosten ↔ diepte van de run)
- `FRAMES_PER_DECISION` — speeltempo per zet
- `SEED` — verander voor een andere, maar reproduceerbare, run
- `MODEL_FAST` / `MODEL_STRONG` — modelkeuze

## Kosten

Elke zet is één call naar het snelle model (Haiku). De kritiek is één call naar
het sterke model (Opus) met een handvol screenshots. `MAX_DECISIONS` bepaalt het
grootste deel van de kosten — begin klein.
