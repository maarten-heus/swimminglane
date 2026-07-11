// Claude-playtester voor het Zwembad-spel.
//
// Doet twee dingen:
//   1) SPEELT het spel (snel model beslist per zet, aangestuurd via window.__agent)
//   2) BEKRITISEERT het spel (sterk model bekijkt metrics + screenshots en geeft
//      concrete verbeterpunten -> feedback.md)
//
// Vereist: Node 18+, `npm install`, en een ANTHROPIC_API_KEY in de omgeving.
// Draaien:  node play.mjs

import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, resolve, join } from "path";
import { writeFileSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- config ----------------------------------------------------------------
const MODEL_FAST = "claude-haiku-4-5";   // snelle zet-beslisser
const MODEL_STRONG = "claude-opus-4-8";  // grondige criticus
const GAME_PATH = resolve(__dirname, "..", "swimminglane.html");
const SEED = 12345;                      // reproduceerbare run
const MAX_DECISIONS = 120;               // aantal model-zetten (kostenbudget)
const FRAMES_PER_DECISION = 12;          // ~0.2s speeltijd per zet
const SHOTS_DIR = join(__dirname, "shots");
const MAX_CRITIQUE_IMAGES = 5;

const client = new Anthropic(); // leest ANTHROPIC_API_KEY

// ---- speel-tool (gestructureerde output) ------------------------------------
const ACTION_TOOL = {
  name: "choose_action",
  description:
    "Kies de volgende zet voor de speler in deze frame. Precies één actie.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["space", "up", "down", "left", "right", "wait", "twist"],
        description:
          "space = spring in het water (op de rand) of duik (in het water); " +
          "up/down = sneller/langzamer; left/right = wissel subbaan; " +
          "wait = niets doen; twist = eenmalige Russian Ball Twist"
      },
      reason: { type: "string", description: "korte reden (max 8 woorden)" }
    },
    required: ["action"]
  }
};

const PLAY_SYSTEM = `Je bent een testspeler van een 2D-zwembadspel op een canvas.
Doel: zwem heen en weer in je baan om het doelaantal lengtes (lanesTarget in de state) te halen en zo naar het volgende level te gaan.
Regels:
- De speler start op de RAND; druk 'space' om in het water te springen.
- In het water: 'up' = sneller, 'down' = langzamer. Je zwemt automatisch door.
- 'left'/'right' wisselt van subbaan binnen je baan. Een WITTE lijn tussen banen oversteken geeft straf, TENZIJ je duikt.
- 'space' terwijl je zwemt = DUIK: ~1s onkwetsbaar, ideaal om onder tegemoetkomende zwemmers of de eindbaas-linie door te gaan.
- Botsen met andere zwemmers geeft straf (te veel botsingen = game over).
- 'twist' is een eenmalige move die een nabije zwemmer uitschakelt; bewaar 'm of gebruik 'm bij dreigende botsing.
Je krijgt elke beurt een compacte JSON-toestand. Kies telkens één actie met choose_action. Speel voorzichtig maar maak vooruitgang.`;

// ---- helpers ----------------------------------------------------------------
function compactState(s) {
  // alleen wat de speler nu nodig heeft: minder tokens, snellere/goedkopere calls
  const p = s.player;
  const near = s.swimmers
    .filter(sw => Math.abs(sw.subLane - p.subLane) <= 1)
    .map(sw => ({ type: sw.type, dSub: sw.subLane - p.subLane, dy: Math.round(sw.y - p.y), v: sw.speedY }))
    .sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy))
    .slice(0, 8);

  return {
    level: s.levelLabel,
    lanesThisLevel: s.lanesThisLevel,
    lanesTarget: s.lanesTarget,
    hits: `${s.hits}/${s.maxHits}`,
    timeLeft: s.timeLeft,
    player: {
      lane: p.lane, subLane: p.subLane,
      swimming: p.swimming, speedY: +p.speedY.toFixed(2),
      diving: p.isDiving, divesLeft: p.divesLeft, penalty: p.penaltyTimer
    },
    twistAvailable: !s.russianBallTwistUsed,
    nearbySwimmers: near
  };
}

async function decideAction(state) {
  const msg = await client.messages.create({
    model: MODEL_FAST,
    max_tokens: 256,
    system: PLAY_SYSTEM,
    tools: [ACTION_TOOL],
    tool_choice: { type: "tool", name: "choose_action" },
    messages: [
      { role: "user", content: "Toestand:\n" + JSON.stringify(compactState(state)) }
    ]
  });
  const block = msg.content.find(b => b.type === "tool_use");
  return block ? block.input : { action: "wait", reason: "geen actie" };
}

async function run() {
  mkdirSync(SHOTS_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 720, height: 1000 } });
  await page.goto(pathToFileURL(GAME_PATH).href);

  await page.waitForFunction(() => !!window.__agent, { timeout: 10000 });
  await page.evaluate((seed) => { window.__agent.seed(seed); window.__agent.enable(); }, SEED);

  const press = (a) => page.evaluate((x) => window.__agent.press(x), a);
  const step = (n) => page.evaluate((x) => window.__agent.step(x), n);
  const getState = () => page.evaluate(() => window.__agent.getState());

  const shots = [];
  const trace = [];
  const actionCounts = {};

  async function snap(tag) {
    if (shots.length >= 40) return;
    const buf = await page.screenshot({ type: "png" });
    const file = join(SHOTS_DIR, `${String(shots.length).padStart(3, "0")}-${tag}.png`);
    writeFileSync(file, buf);
    shots.push({ tag, base64: buf.toString("base64") });
  }

  await snap("start");

  let decisions = 0;
  let lastLevel = null;

  while (decisions < MAX_DECISIONS) {
    let state = await getState();

    if (state.gameFinished) break;

    // overgangsschermen: intro/level-cleared wegklikken; comic laten aflopen
    if (state.overlay) {
      if (!state.overlay.comic) await press("space");
      await step(20);
      continue;
    }

    // screenshot bij elke nieuwe level-start
    if (state.level !== lastLevel) {
      lastLevel = state.level;
      await snap(`level-${state.level}`);
    }

    let choice;
    try {
      choice = await decideAction(state);
    } catch (err) {
      console.error("model-call faalde:", err.message);
      choice = { action: "wait" };
    }

    // "twist" -> b-toets; "wait" = niets drukken
    const key = choice.action === "twist" ? "b" : choice.action;
    if (key !== "wait") await press(key);
    state = await step(FRAMES_PER_DECISION);

    actionCounts[choice.action] = (actionCounts[choice.action] || 0) + 1;
    trace.push({
      d: decisions,
      level: state.level,
      lanes: `${state.lanesThisLevel}/${state.lanesTarget}`,
      hits: state.hits,
      timeLeft: state.timeLeft,
      action: choice.action,
      reason: choice.reason || ""
    });

    decisions++;
    if (decisions % 10 === 0) {
      await snap(`d${decisions}`);
      console.log(
        `zet ${decisions} | level ${state.level} | banen ${state.lanesThisLevel}/${state.lanesTarget} | botsingen ${state.hits}/${state.maxHits}`
      );
    }
  }

  await snap("end");
  const finalState = await getState();
  console.log("\nspel klaar. metrics:", JSON.stringify(finalState.metrics));

  // ---- kritiek van het sterke model -----------------------------------------
  const critiqueImages = pickSpread(shots, MAX_CRITIQUE_IMAGES);
  const content = [];
  for (const shot of critiqueImages) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: shot.base64 } });
    content.push({ type: "text", text: `screenshot: ${shot.tag}` });
  }
  content.push({
    type: "text",
    text:
      "Dit is een 2D-zwembad-dodge-spel (canvas). Hierboven staan screenshots uit één speelsessie.\n\n" +
      "Eindmetrics:\n" + JSON.stringify(finalState.metrics, null, 2) + "\n\n" +
      "Bereikt level: " + finalState.levelLabel + ", botsingen totaal (speler): " +
      finalState.metrics.playerHits + "\n\n" +
      "Zet-verdeling: " + JSON.stringify(actionCounts) + "\n\n" +
      "Laatste zetten (staart van de trace):\n" +
      JSON.stringify(trace.slice(-25), null, 2) + "\n\n" +
      "Geef als game-designer concrete, geprioriteerde verbeterpunten. Groepeer in: " +
      "1. Moeilijkheid/balans, 2. Besturing/gevoel, 3. Visueel/UX, 4. Mogelijke bugs. " +
      "Wees specifiek: verwijs naar metrics of wat je op de screenshots ziet. Kort en bruikbaar."
  });

  console.log("\nfeedback ophalen bij", MODEL_STRONG, "...");
  const critique = await client.messages.create({
    model: MODEL_STRONG,
    max_tokens: 4000,
    messages: [{ role: "user", content }]
  });
  const feedback = critique.content.filter(b => b.type === "text").map(b => b.text).join("\n");

  const out = join(__dirname, "feedback.md");
  writeFileSync(
    out,
    `# Playtest-feedback (${new Date().toISOString()})\n\n` +
      `Bereikt level: ${finalState.levelLabel} · Speler-botsingen: ${finalState.metrics.playerHits} · ` +
      `Zwemmer-botsingen: ${finalState.metrics.swimmerCollisions}\n\n` +
      `Levels gehaald: ${JSON.stringify(finalState.metrics.levelsCleared)}\n\n---\n\n` +
      feedback + "\n"
  );
  console.log("feedback geschreven naar", out);
  console.log("screenshots in", SHOTS_DIR);

  await browser.close();
}

function pickSpread(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
