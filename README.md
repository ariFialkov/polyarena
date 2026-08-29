# Polyarena

**▶ Play it: https://arifialkov.github.io/polyarena/**

A 2.5D betting fight-simulator PWA. Bots and (eventually) other players gather around a
digital craps-style table, put chips on a rotating card of simulated fights, then watch
the bout play out in a 3D arena — with live in-fight props, cash-outs, KOs and
the occasional Fatality.

Playable on desktop and mobile, installable as a PWA, zero dependencies and no build step.

## Run it

Any static file server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Serve over HTTPS (or localhost) for the service worker / install prompt to activate.

## How a round works

1. **Betting phase (30s)** — the table screen. Each fighter owns half the felt with a big
   *WINS* zone plus *BY KO* / *BY DECISION* pockets; shared props (distance, fatality,
   strike over/under, KO-round) run down the center. Pick a chip, tap a zone. Bot
   bettors drop their own chips and show up in the activity feed.
2. **The table swings open** and the arena is revealed: fighter entrances, tale of the
   tape, countdown, bell.
3. **The fight** — up to 3 rounds of 3:00 game-time at 3× speed (≤ 3 real minutes).
   Live prop huddles flank the arena and re-price every ~1.6s; the collapsible bet slip
   offers cash-out on every open ticket. Bots keep firing live bets to keep the rail noisy.
4. **Result** — KO / decision / fatality sequence, bets settle, bankroll updates,
   and the next randomly-drawn matchup rotates in automatically.

## The 96% RTP engine (`js/engine.js`)

Everything is priced off one generative fight model:

- Each fighter has stats (power, speed, defense, chin, stamina, aggression, flair) that
  drive per-round strike output, per-strike KO probability, decision scoring and
  fatality chance.
- At matchup time the engine runs **30,000 Monte-Carlo simulations** of the model.
  Every market's probability `p` is measured from the sample, and its payout is set to
  `RTP / p` with `RTP = 0.96` — so every bet on the board returns 96% in expectation.
- The **real fight outcome is one more independent draw from the same model**, which
  makes displayed odds and realized results consistent by construction (verified:
  realized RTP ≈ 95.7% over 200k fights; the gap is payout rounding).
- **Live odds** are the same 30k sample conditioned on "fight still in progress at
  game-time t" — so in-fight prices update honestly and live bets also carry 96% RTP.
- **Cash-out** pays `stake × payout × P(win | t) × 0.96`.

The fight you watch is choreography (`js/sim.js`): the pre-drawn outcome is expanded
into a timeline of strikes, knockdowns and HP targets, so the presentation always lands
exactly on the drawn result (winner, method, round, time, strike totals).

## The 3D arena (`js/render3d.js`)

The fight scene is true 3D (Three.js, vendored in `vendor/` — still no build step and
fully offline) with the camera locked front-on and slightly elevated for a 2.5D read.

- **Fighters** are low-poly, flat-shaded humanoids assembled on a named bone hierarchy
  (hips → spine → chest → neck/head, shoulders → elbows, thighs → knees). A procedural
  pose system drives them: every anim state (guard, walk, jab/cross/hook/uppercut/
  roundhouse/knee, hit reacts, block, knockdown, fatality launch, celebration) writes
  per-joint rotation targets that are smoothed each frame. Because the choreography
  layer only talks to named bones and states, the primitive meshes can be swapped for
  skinned glTF rigs later without touching the fight logic.
- **Arena**: modeled ring (canvas-textured mat and apron, sagging rope tubes, posts,
  turnbuckles), ~380-instance low-poly crowd on tiered bleachers with idle/hype bob,
  colored spotlights with volumetric cones, one shadow-casting key light, fog.
- **Camera**: locked forward with subtle breathing, impact shake, a slow-mo punch-in on
  knockdowns, and screen-flash overlays for big moments.
- **FX**: pooled additive particle system (impact sparks, KO bursts, fatality soul
  trail + body dissolve).

## Deploying (GitHub Pages)

`.github/workflows/pages.yml` publishes the repo as a static site on every push to the
default branch (or manually via **Actions → Deploy to GitHub Pages → Run workflow**).
There is no build step — the workflow copies the files, adds `.nojekyll`, and uploads.

**One-time repo setting (required):** Settings → Pages → Build and deployment →
**Source: GitHub Actions**. The workflow tries to enable Pages itself, but the Actions
token is not permitted to create a Pages site, so this toggle has to be flipped by hand
once. After flipping it, re-run the workflow (Actions → Deploy to GitHub Pages →
Run workflow) or push any commit.

All asset paths are relative, so the game runs correctly from the `/polyarena/` subpath
Pages serves it under. Because it ships a service worker, a hard refresh (or closing the
installed PWA and reopening) may be needed to pick up a new deploy; bump `CACHE` in
`sw.js` when you want to force all clients to update.

## Code map

| File | Role |
|---|---|
| `js/engine.js` | Generative fight model, Monte-Carlo odds, markets, live pricing, cash-out |
| `js/sim.js` | Outcome → choreography timeline + HP script |
| `js/render3d.js` | 3D arena (Three.js), bone-rigged low-poly fighters, camera, particles, KO/fatality FX |
| `js/table.js` | Craps-style betting table, chips, chip tray |
| `js/hud.js` | HP/clock HUD, live-prop huddles, bet slip, toasts, announcements |
| `js/bots.js` | Bot bettors (fake multiplayer, swappable for networking later) |
| `js/fighters.js` | Fighter bank + matchmaking |
| `js/main.js` | Phase state machine: betting → intro → rounds → result → repeat |
| `js/audio.js` | WebAudio-synthesized SFX (no assets) |
| `sw.js`, `manifest.webmanifest` | PWA shell caching + install metadata |

## Roadmap hooks

- **Multiplayer**: `bots.js` is the only source of "other players"; replace its three
  entry points (table bets, live bets, presence) with a network feed.
- **Fairness**: outcome is drawn client-side for now; server-side draw + commit-reveal
  slots in at `Match.outcome`.
