# Playtest notes

Shared feedback file for the **Zwembad** game (`swimminglane.html`).

- The **playtester** subagent plays the game (via the Playwright MCP browser) and
  **appends** its findings below.
- A **developer** session reads this file and implements the improvements.

Newest entries at the bottom.

---

## Playtest 2026-07-11T17:25Z
Reached level: 3 (game over) · player hits: 12 · swimmer collisions: 17 · levels cleared: [0 @79s, 1 @61s, 2 @62s]
Second confirmatory run (seed 999, clean center-lane play): cleared [0 @79s, 1 @71s, 0 hits], game over in level 2 at **1/5 lanes** · player hits 5 · swimmer collisions 13.

Method: driven via `window.__agent` (frame-stepped), seeds 12345 and 999. Two full runs plus targeted mechanic tests (dive, lane-line penalty, Russian Ball Twist, collision). Served over local HTTP because the Playwright MCP blocks `file://` (see UX note 5 below).

### 1. Difficulty / balance
- **Massive difficulty cliff between level 1 and level 2 — the #1 problem.** Level 1 is trivially clearable: holding the centre sub-lane (never changing lane) I cleared it with **0 hits and all 3 dives unused** (auto-dive never even triggered). The very next level, using the *same* strategy, was a game-over at **1/5 lanes with 5 hits** in ~7 seconds. Two independent seeds both died in level 2/3 at 0-1 lanes. There is no smooth ramp: L1 ≈ free, L2+ ≈ wall.
- **Root cause: swimmer density is too high for the dive budget.** Levels 2-3 have ~12-15 swimmers concurrently in a 4-lane pool, so even your own sub-lane has oncoming swimmers you must pass. You only get **3 dives per level** and each dive lasts ~1s, so you cannot dive under all same-lane traffic across 5 lengths. Once you take one hit the penalty slows you (speedY ~2 -> ~0.8), which keeps you in the danger zone longer and snowballs into more hits (event log: L3 went hits 1->5 in ~437 frames).
- **Time pressure is a non-factor; hits are everything.** Every level gives 90s and clears left ~60-71s on the clock. The 90s timer is essentially free — all tension is the 5-hit budget. Either shorten the timer or lower density so the hit budget is the intended challenge, not an instant-loss.
- **Crossing a white lane line costs a full hit AND blocks the move.** In my test, pressing toward the next lane while not diving incremented `hits` (toward the 5-hit game over) *and* bounced the player back to the original sub-lane. So a mistimed lane change is punished twice (penalty + no progress) and is as lethal as hitting a swimmer. Consider making a line-cross a speed/time penalty rather than a "hit" toward game-over, or at least let the movement complete.
- Suggested tuning: ramp swimmer count more gently (e.g. L1=4, L2=6, L3=8 concurrent instead of ~12 from L2), and/or give dives that partially regenerate per length, and/or raise maxHits for early levels.

### 2. Controls / feel
- **`up`/`down` speed changes don't persist.** After pressing `up` (faster), `speedY` returned to the base value (~2) on the next read — the input seems to be a one-frame nudge, not a held/toggled state. A player expecting "hold up to sprint" gets nothing sticky. Clarify whether it's momentary or make it a sustained speed setting.
- **Dive is the core survival tool but is scarce (3/level) and there is no cooldown/recharge feedback.** Combined with the density issue, this is the crux of the difficulty. A visible dive meter and maybe a slow recharge would help skill expression.
- Diving correctly grants ~1s invulnerability and lets you cross lane lines penalty-free (verified: crossed a sub-lane while diving with no penalty). That part feels good — the problem is quantity, not the mechanic.
- Russian Ball Twist (`b`) works and is a fun one-shot: nice 3-panel comic, removes ~2 nearby swimmers, and correctly locks to once **per whole game** (HUD shows "TWIST: op" and it did not reset between levels). Minor: the comic plays ~5 real seconds for a payoff of removing only 2 of ~12 swimmers — feels a touch long / low-impact. Either speed the comic up or make it clear more swimmers.

### 3. Visual / UX
- **Text encoding is broken (mojibake).** `swimminglane.html` has **no `<meta charset="utf-8">`** in its `<head>`. On the intro/instruction screen the em-dashes render as `â€"` and the arrow-key glyphs render as `â†'`/`â†"`/`â†‘`. This will happen under `file://` and any server that doesn't force a UTF-8 charset. Fix: add `<meta charset="utf-8">`.
- **Intro/instruction overlay overlaps the HUD panels.** On the OEFENBAAN screen the instruction text ("wissel van baan", "springen in het water", etc.) is drawn on top of the ZWEMBAD/LEVEL/SPELER HUD boxes, producing overlapping, unreadable text. The level-start overlays (LEVEL 1/2/3) don't have this problem, so it's specific to the multi-line intro. Make the intro a proper modal that hides/dims the HUD.
- **Swimmers are drawn outside the pool rectangle.** In multiple screenshots (levels 1, 2, 3 and both game-over screens) swimmers that reach a lane end appear as sprites floating to the **right of the pool and below it**, overlapping the legend text and the KASSA. Looks like they aren't clipped to the pool bounds / aren't turning at the wall on time. Clip rendering to the pool or turn/despawn them at the end wall.
- **Player shares a colour with a swimmer type.** The player is a blue block and the "BLAUW langzamer" swimmers are also blue; at a glance the player is hard to pick out (and easy to confuse with the langzamer type). Give the player a distinct outline/colour.
- **Game-over screen has no instructions.** "BADMEESTER: ERUIT!" appears with no "press SPACE to retry / restart" prompt. Pressing space set `gameFinished:true` (whole game ends, restart from scratch). Players won't know what to do or that there's no per-level retry. Add a clear prompt and consider a checkpoint/continue.
- Positives: the MSX/pixel look is charming, the collision "stofwolk" (dust cloud with fists/stars) is clear and satisfying feedback, the KASSA + lockers set dressing is a nice touch, and the swimmer-type legend is readable once the charset is fixed. HUD (BANEN x/5, TIJD, BOTSINGEN, STRAF, DUIKEN, TWIST) is informative.

### 4. Possible bugs
- No `<meta charset>` -> mojibake for `—` and arrow glyphs (see 3).
- Swimmers rendered outside the pool bounds at lane ends (see 3) — consistent across levels.
- Lane-line cross bounces the player back *and* still charges a hit (see 1) — at minimum feels like a double-punish bug.
- Metric mismatch worth checking: `swimmerCollisions` (17 / 13) is consistently **higher** than `playerHits` (12 / 5). If collisions during dive i-frames or repeated contact are being counted in one metric but not the other, confirm that's intended — otherwise the collision counter may be over-counting.
- `up`/`down` don't produce a lasting speed change (see 2) — may be intended, but reads as unresponsive.
- Agent-API note (not a game bug): the `swimmers[].type` field only shows the new per-level type once it has actually spawned; early in a level everything reads `"ordinary"` even when orange/blue sprites are already visible. Types do eventually appear (saw `"slower"` in L3). Fine, just be aware when reading state early.

### Top 3 suggestions
1. **Flatten the L1->L2 difficulty cliff.** Ramp concurrent swimmer count gently (e.g. 4/6/8 instead of ~12 from L2), and rethink the dive economy (visible meter + partial recharge, or more dives) so a skilled centre-lane player can actually cross a crowded pool 5 times. Right now L1 is free and L2 is an instant wall.
2. **Add `<meta charset="utf-8">` and fix the two layout bugs** (intro text overlapping the HUD; swimmers rendered outside the pool). These are cheap fixes with high polish payoff.
3. **Make lane-line crossing a soft penalty, not a game-over "hit," and add a game-over retry prompt.** Charging a full hit for a lane change (while also blocking the move) plus no restart guidance makes the game feel unfair when you die.
