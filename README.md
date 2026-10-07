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

1. **Lobby / betting (30s)** — the neon betting table sits over the live 3D stage.
   Each corner shows a live 3D cutout of its fighter running a warm-up loop
   (shadow-boxing, shoulder rolls, flexes, beckons) behind the big *WINS* zone and
   *BY KO* / *BY DECISION* pockets; shared props run down the center under a live
   red-vs-blue **money split**. Bot players sit on the rail at the top: their chips
   fly to the zones they back, zones show pool size and bettor counts, and badges
   flag what's moving — **🔥 HEATING UP** (rapid action), **👥 CROWD PICK** (the
   money favorite), **⚡ HIT N STRAIGHT / ❄ COLD N** (bet types on a run across
   recent fights). Under 10 seconds: LAST CALL, red edge pulse, ticking, shaking
   timer and a bot betting frenzy.
2. **The table swings open**: camera sweep onto the stage, each fighter's close-up
   call-out with their signature special, tale of the tape, 3-2-1, FIGHT.
3. **The fight** — up to 3 rounds of **30 real seconds** each (90s if it goes the
   distance; the engine still models 3:00 game rounds, played at 6×). MK-style
   dynamic camera, fast movement, combo bursts, specials, combo counter and
   per-hit health bars. Live props flank the arena and re-price every ~1.2s with
   odds-movement flashes; the bet slip offers cash-out on every open ticket.
4. **Result** — K.O. / FATALITY / decision sequence, then a result card with the
   winner's live victory pose, your settled tickets, a net ticker, coin/confetti
   showers on a win, and how every bot at the table did. Next fight rotates in.

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

## The 3D arena

The fight scene is true 3D (Three.js, vendored in `vendor/` — no build step, works
offline) presented Mortal-Kombat style.

- **Camera director** (`js/camera.js`): tracks the fighters' midpoint; distance *and*
  field of view follow their separation (tight telephoto when they're toe-to-toe,
  wide when they spread out), with a slow orbit drift, zoom-punches and dutch-tilt
  kicks on impacts, hit-stop on heavy blows, and cinematic modes for the intro
  sweep, fighter close-ups, KO orbit, low fatality angle, lobby flyover and breaks.
- **Movement director** (`js/render3d.js`): fighters dash, backdash, jump, vault
  over each other out of corners, get knocked back, zone (fireball users keep
  range) and reset spacing after every exchange, across stages ~3× wider than
  before. Choreography decides *what* happens and *when*; `main.js` streams the
  next scripted attack to the arena (`anticipate()`), which closes the distance
  just in time so every hit visibly lands.
- **Choreography** (`js/sim.js`): landed strikes are grouped into exchanges (2-5 hit
  combos, sometimes answered by a counter, sometimes a blocked opener) and
  standalone signature specials, with neutral spacing between. Each fighter's
  landed strikes per round still match the drawn outcome exactly, and every hit
  carries its share of the scripted HP loss.
- **Stages** (`js/stages.js`): 7 themed platform arenas — Jungle Temple, Blood
  Keep, Orbital Kolosseum, The White House, Siberian Summit, Sakura Garden,
  Sunset Shores — each with its own sky, fog, lighting, low-poly scenery and
  ambient FX, rotated per match and fully disposed between matches.
- **Specials**: fireball projectiles, teleport strikes, flying kicks and
  ground-slam shockwaves, each with VFX, synth SFX and a move-name banner.

## Characters & imported models

Fighters are pop-culture parody caricatures (`js/fighters.js`). Each one is
animated by a procedural pose system on a named **driver rig**
(`js/fighter.js`); characters with an imported model wear it via the
**retargeter** (`js/models.js`), which copies the driver's limb orientations onto
the model's humanoid skeleton in world space every frame (so it's independent of
each rig's bone-axis conventions) and curls the fingers into fists. Characters
without a model fall back to the procedural caricature rig (`js/charrig.js`).

Imported so far: The Don, Ibra, Frost, Chef, Amadeus.

### Adding a model

1. Put the rigged FBX (standard humanoid bone names — Mixamo-style `Hips`, `Spine`,
   `LeftArm`, … with any `prefix:`) in `assets/models/src/<name>.fbx`.
2. Convert it to a web-ready GLB:
   ```sh
   cd tools && npm install && npm run convert-models -- <name>
   ```
   This extracts the embedded texture (the Blender `.fbm` reference isn't readable
   on the web), welds the triangle soup into indexed geometry, renames bones and
   writes `assets/models/<name>.glb` (~1 MB, texture at 1024²; `MAX_TEX=2048`
   for sharper).
3. Add `model: '<name>'` to the fighter in `js/fighters.js`.

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
| `js/render3d.js` | 3D arena: stage/lights, movement director, specials VFX, particles |
| `js/camera.js` | MK-style camera director |
| `js/fighter.js` | Fighter pose animator (driver rig) + model attachment |
| `js/models.js` | GLB loading/cloning + world-space retargeter |
| `js/charrig.js` | Driver rig + procedural caricature fallback meshes |
| `js/portraits.js` | Live 3D cutouts for the lobby and result card (shares the renderer) |
| `js/fx.js` | Screen-space VFX: chip flights, sparks, embers, coins, confetti |
| `js/stages.js` | 7 themed stage builders + ambient particle systems |
| `js/table.js` | Neon betting table, cutout slots, pools, badges, money split, chip tray |
| `js/hud.js` | Health bars, timer, combo counter, special banners, live props, bet slip |
| `js/bots.js` | Bot players with personalities (chalk/longshot/crowd/streak) |
| `js/fighters.js` | Fighter bank + matchmaking |
| `js/main.js` | Phase state machine, heat/streak tracking, timing |
| `js/audio.js` | WebAudio-synthesized SFX (no assets) |
| `sw.js`, `manifest.webmanifest` | PWA shell caching + install metadata |
| `tools/` | Dev-only FBX → GLB model converter |
| `fonts/` | Bungee, Teko, Rajdhani (SIL OFL, licenses included) |

Testing tip: `?fighters=thump,zoltan&stage=sakura` pins the first match.

## Roadmap hooks

- **Multiplayer**: `bots.js` is the only source of "other players"; replace its three
  entry points (table bets, live bets, presence) with a network feed.
- **Fairness**: outcome is drawn client-side for now; server-side draw + commit-reveal
  slots in at `Match.outcome`.
