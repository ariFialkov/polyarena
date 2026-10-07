// Polyarena — main state machine.
// BETTING (30s, neon lobby) -> TRANSITION -> INTRO (camera sweep, fighter
// call-outs, tale of the tape, 3-2-1) -> ROUND x3 (30 real seconds each,
// BREAK between) -> KO / FATALITY / DECISION -> RESULT -> next match.
//
// The engine works in GAME time (3:00 rounds); TIME_SCALE plays a round in
// 30 real seconds, so a fight that goes the distance lasts 90 seconds.

import { $, el, fmtMoney, fmtOdds, clamp, rand } from './util.js';
import { pickMatchup, record, FIGHTERS } from './fighters.js';
import { Match, simFight, ROUND_SECS, NUM_ROUNDS } from './engine.js';
import { buildScript, buildHpScript } from './sim.js';
import { Arena, SPECIALS } from './render3d.js';
import { pickStage, STAGES } from './stages.js';
import { Table, buildChipTray } from './table.js';
import { Hud, shortName } from './hud.js';
import { makeBots, scheduleTableBets, chooseTableBet, maybeLiveBet } from './bots.js';
import { PortraitStudio } from './portraits.js';
import { loadModel } from './models.js';
import { FX } from './fx.js';
import { sfx, setSound, soundOn } from './audio.js';

const BETTING_SECS = 30;
const TIME_SCALE = 6;            // 180 game-seconds per round -> 30 real seconds
const BREAK_SECS = 4;
const RESULT_SECS = 8.5;
const HIST_KEY = 'pa_hist_v1';

const S = {
  phase: 'BOOT',
  bankroll: 1000,
  bets: [],
  match: null,
  script: null,
  hp: null,
  hpNow: [1, 1],
  round: 0,
  roundTime: 0,
  gameTime: 0,
  evIdx: 0,
  strikes: 0,
  bettingLeft: 0,
  lastWhole: 99,
  cancelBots: null,
  liveValues: new Map(),
  pools: new Map(),        // marketId -> { amt, bettors:Set, times:[] }
  combo: { by: -1, n: 0, t: 0 },
  hist: {},                // generic market key -> [hit booleans]
};

let arena, table, hud, bots, studio, fx;
let lastFrame = 0, liveTimer = 0, heatTimer = 0, emberTimer = 0;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  S.bankroll = parseFloat(localStorage.getItem('pa_bankroll') || '1000');
  if (!isFinite(S.bankroll)) S.bankroll = 1000;
  try { S.hist = JSON.parse(localStorage.getItem(HIST_KEY) || '{}'); } catch { S.hist = {}; }
  if (!Object.keys(S.hist).length) seedHistory();

  arena = new Arena($('#arenaCanvas'));
  studio = new PortraitStudio(arena.renderer);
  fx = new FX($('#fxCanvas'), $('#stage'));
  hud = new Hud({ onLiveBet: placeLiveBet, onCashout: cashout });
  table = new Table($('#table'), { onPlayerBet: placeTableBet });
  bots = makeBots(6);
  buildRail();

  buildChipTray($('#chipTray'), table, { onUndo: undoBet, onClear: clearBets });

  $('#skipBtn').addEventListener('click', () => { if (S.phase === 'BETTING') endBetting(); });
  $('#soundBtn').addEventListener('click', () => {
    setSound(!soundOn());
    $('#soundBtn').textContent = soundOn() ? '🔊' : '🔇';
  });
  $('#rebuyBtn').addEventListener('click', () => {
    S.bankroll += 1000;
    saveBank();
    hud.setBankroll(S.bankroll, 1);
    $('#rebuyBtn').hidden = true;
    hud.toast('Rebuy: <b>+$1,000</b> demo credits', 'you-toast');
  });
  window.addEventListener('resize', () => { arena.resize(); fx.resize(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    const b = $('#installBtn');
    b.hidden = false;
    b.onclick = () => { deferredPrompt.prompt(); b.hidden = true; };
  });

  // warm the model cache for everyone who has one
  for (const f of FIGHTERS) if (f.model) loadModel(f.model).catch(() => {});

  hud.setBankroll(S.bankroll);
  window.PA = { arena, state: S, studio, fx }; // debug/console handle
  newMatch();
  requestAnimationFrame(loop);
}

// The house's recent results, so streak badges have history on first visit.
function seedHistory() {
  for (let i = 0; i < 8; i++) {
    const [A, B] = pickMatchup();
    const m = new Match(A, B);
    recordHistory(m, simFight(A, B));
  }
}

function buildRail() {
  const rail = $('#rail');
  rail.innerHTML = '';
  for (const b of bots) {
    const s = el('div', 'seat');
    s.style.setProperty('--c', b.color);
    s.innerHTML = `<div class="av">${b.avatar}</div><div class="nm">${b.name}</div><div class="st">${fmtMoney(b.stack)}</div>`;
    b.el = s;
    rail.append(s);
  }
}

function updateSeat(b, bubble) {
  b.el.querySelector('.st').textContent = fmtMoney(b.stack);
  if (bubble) {
    b.el.classList.remove('bet'); void b.el.offsetWidth; b.el.classList.add('bet');
    b.el.querySelectorAll('.bubble').forEach(x => x.remove());
    const bb = el('div', 'bubble');
    bb.innerHTML = bubble;
    b.el.append(bb);
    setTimeout(() => bb.remove(), 2300);
  }
}

// ---------------------------------------------------------------------------
// Betting phase (lobby)
// ---------------------------------------------------------------------------

// ?fighters=thump,zoltan&stage=sakura pins the first match (demos/testing)
function forcedMatch() {
  const q = new URLSearchParams(location.search);
  const ids = (q.get('fighters') || '').split(',');
  const A = FIGHTERS.find(f => f.id === ids[0]), B = FIGHTERS.find(f => f.id === ids[1]);
  const stage = STAGES.find(s => s.id === q.get('stage'));
  return { pair: A && B && A !== B ? [A, B] : null, stage };
}

function newMatch() {
  const forced = S.firstDone ? {} : forcedMatch();
  S.firstDone = true;
  const [A, B] = forced.pair || pickMatchup();
  S.stage = forced.stage || pickStage();
  S.match = new Match(A, B);
  S.bets = [];
  S.liveValues = new Map();
  S.pools = new Map();
  S.strikes = 0;
  S.round = 0;
  S.gameTime = 0;
  S.hpNow = [1, 1];
  for (const b of bots) b.bets = [];

  document.body.classList.remove('fighting');
  arena.setStage(S.stage);
  arena.setFighters(A, B);
  arena.setMode('lobby');
  hud.setMatch(S.match);
  hud.clearHuddles();
  hud.renderSlip(S.bets, null);
  table.build(S.match);
  table.setLocked(false);
  studio.clear();
  studio.set('A', table.cut.A, A, { side: 'A', yaw: 0.55 });
  studio.set('B', table.cut.B, B, { side: 'B', yaw: -0.55 });
  refreshHeat();

  $('#resultOverlay').classList.remove('show');
  $('#matchBanner').innerHTML = `<b>${shortName(A).toUpperCase()}</b><span class="vs">VS</span><b>${shortName(B).toUpperCase()}</b> · ${S.stage.label}`;
  $('#table').classList.remove('open');
  $('#table').hidden = false;
  $('#chipTray').classList.remove('hidden');
  $('#betDock').classList.remove('hidden', 'warn', 'urgent');
  $('#urgency').classList.remove('on');
  $('#fightHud').classList.add('hidden');
  $('#strikeMeter').classList.add('hidden');
  $('#tape').classList.remove('show');
  $('#rebuyBtn').hidden = S.bankroll >= 1;

  S.phase = 'BETTING';
  S.bettingLeft = BETTING_SECS;
  S.lastWhole = 99;

  S.cancelBots = scheduleTableBets(bots, BETTING_SECS, (bot, lastCall) => {
    if (S.phase !== 'BETTING') return;
    botTableBet(bot, lastCall);
  });

  hud.announce('PLACE YOUR BETS', 'gold', 1900, S.stage.label);
}

function marketDisplay(m) {
  if (m.side === 'A') return `${shortName(S.match.A).toUpperCase()} ${m.label}`;
  if (m.side === 'B') return `${shortName(S.match.B).toUpperCase()} ${m.label}`;
  return m.label;
}

function addPool(id, amt, who) {
  let p = S.pools.get(id);
  if (!p) { p = { amt: 0, bettors: new Set(), times: [] }; S.pools.set(id, p); }
  p.amt += amt;
  p.bettors.add(who);
  p.times.push(performance.now());
  refreshHeat();
}

function botTableBet(bot, lastCall) {
  const markets = S.match.markets;
  const ctx = {
    pools: new Map([...S.pools].map(([k, v]) => [k, v.amt])),
    streak: new Set(markets.filter(m => streakOf(m) >= 2).map(m => m.id)),
  };
  const { market: m, amount } = chooseTableBet(bot, markets, ctx);
  if (bot.stack < amount) return;
  bot.stack -= amount;
  bot.bets.push({ market: m, amount });
  updateSeat(bot, `<b>${fmtMoney(amount)}</b> ${marketDisplay(m)}`);

  const zoneEl = table.zoneEl(m.id);
  if (!zoneEl) return;
  const from = fx.center(bot.el.querySelector('.av'));
  const to = fx.center(zoneEl);
  fx.flyChip(from, to, {
    color: bot.color, label: bot.avatar, dur: lastCall ? 0.45 : 0.7,
    onLand: () => {
      if (S.phase !== 'BETTING') return;
      table.dropChip(m.id, amount, bot);
      table.floatAmt(m.id, '+' + fmtMoney(amount), bot.name);
      addPool(m.id, amount, bot.name);
      sfx.chip();
      if (m.id === 'A_WIN' || m.id === 'A_KO' || m.id === 'A_DEC') studio.react('A');
      if (m.id === 'B_WIN' || m.id === 'B_KO' || m.id === 'B_DEC') studio.react('B');
    },
  });
  if (lastCall || amount >= 100) {
    hud.botToast(bot, `${lastCall ? '<b class="t-amt">LAST CALL</b> · ' : ''}slams <b class="t-amt">${fmtMoney(amount)}</b> on <b>${marketDisplay(m)}</b> @ ${fmtOdds(m.payout)}`);
  }
}

function placeTableBet(market, amount) {
  if (S.phase !== 'BETTING') return false;
  if (amount > S.bankroll) {
    hud.toast('Not enough bankroll', 'you-toast');
    return false;
  }
  S.bankroll -= amount;
  saveBank();
  hud.setBankroll(S.bankroll, -1);
  const existing = S.bets.find(b => !b.live && b.marketId === market.id);
  if (existing) existing.stake += amount;
  else S.bets.push(makeBet(market, amount, false));
  addPool(market.id, amount, 'YOU');
  const z = table.zoneEl(market.id);
  if (z) { const c = fx.center(z); fx.sparks(c.x, c.y, { n: 14, color: '#ffd54a' }); fx.ring(c.x, c.y, { r1: 60 }); }
  hud.renderSlip(S.bets, null);
  return true;
}

function makeBet(market, stake, live) {
  return {
    marketId: market.id,
    label: (live ? 'LIVE · ' : '') + marketDisplay(market),
    stake, payout: market.payout,
    pred: market.pred, settle: market.settle,
    status: 'open', live,
  };
}

function undoBet() {
  if (S.phase !== 'BETTING') return;
  const bet = S.bets.pop();
  if (!bet) return;
  S.bankroll += bet.stake;
  const p = S.pools.get(bet.marketId);
  if (p) p.amt = Math.max(0, p.amt - bet.stake);
  saveBank();
  hud.setBankroll(S.bankroll, 1);
  table.clearPlayerChips();
  for (const b of S.bets) table.dropChip(b.marketId, b.stake, null);
  hud.renderSlip(S.bets, null);
  refreshHeat();
}

function clearBets() {
  if (S.phase !== 'BETTING') return;
  for (const b of S.bets) {
    S.bankroll += b.stake;
    const p = S.pools.get(b.marketId);
    if (p) p.amt = Math.max(0, p.amt - b.stake);
  }
  S.bets = [];
  saveBank();
  hud.setBankroll(S.bankroll, 1);
  table.clearPlayerChips();
  hud.renderSlip(S.bets, null);
  refreshHeat();
}

// ---- heat / crowd / streak badges ----

function favSide() {
  return S.match.market('A_WIN').prob >= S.match.market('B_WIN').prob ? 'A' : 'B';
}

function genericKey(id, fav) {
  const side = id[0];
  if (id.length > 2 && id[1] === '_' && (side === 'A' || side === 'B')) {
    const role = side === fav ? 'FAV' : 'DOG';
    return id.slice(2) + '_' + role;           // WIN_FAV, KO_DOG, DEC_FAV ...
  }
  return id;
}

function recordHistory(match, outcome) {
  const fav = match.market('A_WIN').prob >= match.market('B_WIN').prob ? 'A' : 'B';
  for (const m of match.markets) {
    const k = genericKey(m.id, fav);
    const arr = S.hist[k] || (S.hist[k] = []);
    arr.push(!!m.settle(outcome));
    if (arr.length > 12) arr.shift();
  }
  try { localStorage.setItem(HIST_KEY, JSON.stringify(S.hist)); } catch { /* storage unavailable */ }
}

function runOf(arr, val) {
  let n = 0;
  for (let i = arr.length - 1; i >= 0 && arr[i] === val; i--) n++;
  return n;
}
function streakOf(m) { return runOf(S.hist[genericKey(m.id, favSide())] || [], true); }
function coldOf(m) { return runOf(S.hist[genericKey(m.id, favSide())] || [], false); }

function refreshHeat() {
  if (!S.match) return;
  const now = performance.now();
  let total = 0, top = null, a = 0, b = 0;
  for (const [id, p] of S.pools) {
    total += p.amt;
    if (!top || p.amt > top[1].amt) top = [id, p];
    if (id.startsWith('A_')) a += p.amt;
    if (id.startsWith('B_')) b += p.amt;
  }
  const maxAmt = top ? top[1].amt : 1;
  for (const m of S.match.markets) {
    const p = S.pools.get(m.id);
    const badges = [];
    if (p) {
      p.times = p.times.filter(t => now - t < 6000);
      if (p.times.length >= 3 || (p.times.length >= 2 && p.amt >= 150)) badges.push({ cls: 'hot', text: '🔥 HEATING UP' });
      if (top && top[0] === m.id && p.bettors.size >= 3 && p.amt / total >= 0.28) badges.push({ cls: 'crowd', text: '👥 CROWD PICK' });
      table.setPool(m.id, p.amt, p.bettors.size, p.amt / maxAmt);
    }
    const st = streakOf(m);
    if (st >= 2) badges.push({ cls: 'streak', text: `⚡ HIT ${st} STRAIGHT` });
    else if (coldOf(m) >= 4 && m.prob >= 0.3) badges.push({ cls: 'cold', text: `❄ COLD ${coldOf(m)}` });
    table.setBadges(m.id, badges.slice(0, 2));
  }
  table.setSplit(a, b);
}

function endBetting() {
  if (S.cancelBots) S.cancelBots();
  table.setLocked(true);
  $('#betDock').classList.add('hidden');
  $('#urgency').classList.remove('on');
  S.phase = 'TRANSITION';
  hud.announce('BETS LOCKED', 'red', 1300);
  sfx.bellEnd();
  setTimeout(() => $('#table').classList.add('open'), 300);
  setTimeout(() => {
    $('#table').hidden = true;
    studio.clear();
    document.body.classList.add('fighting');
    startIntro();
  }, 1250);
}

// ---------------------------------------------------------------------------
// Intro / countdown
// ---------------------------------------------------------------------------

function startIntro() {
  S.phase = 'INTRO';
  const { A, B } = S.match;
  $('#fightHud').classList.remove('hidden');
  hud.setClock(ROUND_SECS / TIME_SCALE, 1);
  arena.setMode('intro');

  const tape = $('#tape');
  tape.innerHTML = '';
  const mid = el('div', 'tape-mid');
  mid.append(el('div', 'tape-vs', 'VS'), el('div', 'tape-stage', S.stage.label));
  tape.append(tapeCard(A, 'A'), mid, tapeCard(B, 'B'));

  const at = (s, fn) => setTimeout(fn, s * 1000);
  at(1.0, () => {
    arena.cam('focus', { focus: 0, restart: true });
    arena.fighter(0).play('taunt');
    hud.announce(shortName(A).toUpperCase(), 'red', 1250, '✦ ' + A.special.name);
    sfx.whoosh();
  });
  at(2.35, () => {
    arena.cam('focus', { focus: 1, restart: true });
    arena.fighter(1).play('taunt');
    hud.announce(shortName(B).toUpperCase(), 'blue', 1250, '✦ ' + B.special.name);
    sfx.whoosh();
  });
  at(3.7, () => { arena.cam('wide', { restart: true }); tape.classList.add('show'); });
  at(5.1, () => { tape.classList.remove('show'); startCountdown(); });
}

function tapeCard(f, side) {
  const c = el('div', 'tape-card side-' + side);
  c.append(el('div', 'tape-name', f.name));
  c.append(el('div', 'tape-sub', `${f.style} · ${record(f)}`));
  c.append(el('div', 'tape-special', '✦ ' + f.special.name));
  for (const [k, label] of [['power', 'PWR'], ['speed', 'SPD'], ['chin', 'CHIN'], ['defense', 'DEF']]) {
    const row = el('div', 'tape-stat');
    row.append(el('span', 'ts-label', label));
    const bar = el('div', 'ts-bar');
    const fill = el('div', 'ts-fill');
    fill.style.width = f[k] + '%';
    bar.append(fill);
    row.append(bar);
    c.append(row);
  }
  return c;
}

function startCountdown() {
  S.phase = 'COUNTDOWN';
  arena.setMode('fight');
  let n = 3;
  const step = () => {
    if (n > 0) {
      hud.announce(String(n), 'count', 560);
      sfx.tick();
      n--;
      setTimeout(step, 650);
    } else {
      hud.announce('FIGHT!', 'red big', 900);
      sfx.bell();
      startRound(1);
    }
  };
  step();
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

function startRound(r) {
  if (r === 1) {
    S.hp = buildHpScript(S.match.outcome);
    S.script = buildScript(S.match.outcome, S.match.A, S.match.B, S.hp);
  }
  S.phase = 'ROUND';
  S.round = r;
  S.roundTime = 0;
  S.evIdx = 0;
  S.combo = { by: -1, n: 0, t: 0 };
  S.roundLen = S.script.rounds[r - 1].endTime;
  S.hpNow = [...S.hp.start[r - 1]];
  hud.setHp(0, S.hpNow[0]);
  hud.setHp(1, S.hpNow[1]);
  hud.setClock(ROUND_SECS / TIME_SCALE, r);
  arena.setMode('fight');
  $('#strikeMeter').classList.remove('hidden');
  updateStrikeMeter();
  if (r > 1) {
    hud.announce('ROUND ' + r, 'gold', 1100, 'FIGHT!');
    sfx.bell();
  }
  refreshLive();
}

function updateStrikeMeter() {
  const line = S.match.strikeLine;
  $('#strikeMeter').innerHTML = `STRIKES <b class="${S.strikes > line ? 'ov' : ''}">${S.strikes}</b> · LINE ${line}`;
}

function landHit(ev) {
  const victim = 1 - ev.by;
  if (ev.dmg) {
    S.hpNow[victim] = Math.max(0, S.hpNow[victim] - ev.dmg);
    hud.setHp(victim, S.hpNow[victim]);
  }
  const now = performance.now();
  if (S.combo.by === ev.by && now - S.combo.t < 750) S.combo.n++;
  else S.combo = { by: ev.by, n: 1, t: now };
  S.combo.t = now;
  hud.comboHit(ev.by, S.combo.n);
}

function processRoundEvents() {
  const evs = S.script.rounds[S.round - 1].events;
  while (S.evIdx < evs.length && evs[S.evIdx].t <= S.roundTime) {
    const ev = evs[S.evIdx++];
    switch (ev.type) {
      case 'strike': {
        arena.strike(ev.by, ev.strike, true);
        if (SPECIALS.includes(ev.strike)) {
          const f = ev.by === 0 ? S.match.A : S.match.B;
          if (ev.specialName) hud.specialBanner(ev.by, ev.specialName, shortName(f));
          // specials connect a beat later; apply their damage then
          setTimeout(() => landHit(ev), ev.strike === 'fireball' ? 520 : 330);
        } else {
          sfx.hit();
          landHit(ev);
        }
        S.strikes++;
        updateStrikeMeter();
        break;
      }
      case 'miss':
        arena.strike(ev.by, ev.strike, false);
        if (rand() < 0.5) sfx.whiff();
        break;
      case 'hurt':
        arena.strike(ev.by, ev.strike, true, true);
        sfx.bigHit();
        landHit(ev);
        break;
      case 'ko':
        doKO(ev);
        return;
    }
  }
  // stream the next attack to the movement director
  const next = evs[S.evIdx];
  if (next) arena.anticipate(next.by, (next.t - S.roundTime) / TIME_SCALE, next.strike);
  else arena.anticipate(null);
}

function doKO(ev) {
  const o = S.match.outcome;
  const w = o.winner, l = 1 - w;
  S.phase = 'KOSEQ';
  arena.anticipate(null);
  arena.strike(ev.by, 'uppercut', true, true);
  sfx.bigHit();
  setTimeout(() => {
    arena.setMode('post');
    arena.knockdown(l);
    S.hpNow[l] = 0;
    hud.setHp(l, 0);
    sfx.ko();
    hud.announce('K.O.', 'red big', 2100);
  }, 200);

  setTimeout(() => {
    if (o.fatality) {
      arena.cam('focus', { focus: w, restart: true });
      hud.announce('FINISH THEM!', 'fatality-call', 1700);
      sfx.bellEnd();
      setTimeout(() => {
        arena.fatality(w);
        sfx.fatality();
        hud.announce('FATALITY', 'fatality big', 2500);
        setTimeout(showResult, 2900);
      }, 1800);
    } else {
      arena.celebrate(w);
      sfx.bell();
      hud.announce(shortName(w === 0 ? S.match.A : S.match.B).toUpperCase(), w === 0 ? 'red' : 'blue', 1700, 'WINS');
      setTimeout(showResult, 2100);
    }
  }, 2400);
}

function endRoundByBell() {
  sfx.bellEnd();
  const o = S.match.outcome;
  // land exactly on the scripted round-end health
  S.hpNow = [...S.hp.end[S.round - 1]];
  hud.setHp(0, S.hpNow[0]);
  hud.setHp(1, S.hpNow[1]);
  arena.anticipate(null);
  arena.setMode('break');
  if (S.round >= NUM_ROUNDS) {
    S.phase = 'DECIDE';
    hud.announce('TIME!', 'gold', 1200);
    setTimeout(() => {
      hud.announce("JUDGES' DECISION", '', 1400);
      setTimeout(() => {
        arena.celebrate(o.winner);
        sfx.win();
        hud.announce(shortName(o.winner === 0 ? S.match.A : S.match.B).toUpperCase(), o.winner === 0 ? 'red' : 'blue', 1600, 'WINS BY DECISION');
        setTimeout(showResult, 1900);
      }, 1600);
    }, 1300);
  } else {
    S.phase = 'BREAK';
    S.breakLeft = BREAK_SECS;
    hud.announce(`END OF ROUND ${S.round}`, '', 1300);
    refreshLive();
  }
}

// ---------------------------------------------------------------------------
// Live betting + cashout
// ---------------------------------------------------------------------------

function liveRoundNum() {
  return S.phase === 'BREAK' ? Math.min(S.round + 1, NUM_ROUNDS) : Math.max(1, S.round);
}

function fightAlive() { return S.phase === 'ROUND' || S.phase === 'BREAK'; }

function refreshLive() {
  if (!fightAlive()) return;
  const t = S.gameTime;
  const markets = S.match.liveMarkets(t, liveRoundNum());
  hud.renderLiveMarkets(markets, table.selectedChip);

  S.liveValues = new Map();
  for (const b of S.bets) if (b.status === 'open') S.liveValues.set(b, S.match.cashoutValue(b, t));
  hud.renderSlip(S.bets, S.liveValues);

  const ev = maybeLiveBet(bots, markets, 1.2);
  if (ev && ev.bot.stack >= ev.amount) {
    ev.bot.stack -= ev.amount;
    ev.bot.bets.push({ market: ev.market, amount: ev.amount });
    updateSeat(ev.bot, `LIVE <b>${fmtMoney(ev.amount)}</b> ${ev.market.label}`);
    const btn = hud.flashLive(ev.market.id);
    if (btn) {
      fx.flyChip(fx.center(ev.bot.el.querySelector('.av')), fx.center(btn), { color: ev.bot.color, label: ev.bot.avatar, dur: 0.6 });
    }
    hud.botToast(ev.bot, `live <b class="t-amt">${fmtMoney(ev.amount)}</b> on <b>${ev.market.label}</b> @ ${fmtOdds(ev.market.payout)}`);
  }
}

function placeLiveBet(m) {
  if (!fightAlive()) return;
  const amount = table.selectedChip;
  if (amount > S.bankroll) { hud.toast('Not enough bankroll', 'you-toast'); return; }
  S.bankroll -= amount;
  saveBank();
  hud.setBankroll(S.bankroll, -1);
  S.bets.push(makeBet(m, amount, true));
  sfx.chip();
  const btn = document.querySelector(`.live-prop[data-mid="${m.id}"]`);
  if (btn) { const c = fx.center(btn); fx.sparks(c.x, c.y, { n: 12 }); fx.ring(c.x, c.y, { r1: 50 }); }
  hud.toast(`You bet <b class="t-amt">${fmtMoney(amount)}</b> on <b>${m.label}</b> @ ${fmtOdds(m.payout)}`, 'you-toast');
  hud.renderSlip(S.bets, S.liveValues);
}

function cashout(bet) {
  if (bet.status !== 'open' || !fightAlive()) return;
  const v = S.match.cashoutValue(bet, S.gameTime);
  if (v <= 0) return;
  bet.status = 'cashed';
  bet.cashed = v;
  S.bankroll += v;
  saveBank();
  hud.setBankroll(S.bankroll, 1);
  sfx.cash();
  const c = fx.center($('#bankChip'));
  fx.sparks(c.x, Math.max(10, c.y), { n: 20, color: '#3dff9a' });
  hud.toast(`Cashed out <b class="t-amt">${fmtMoney(v)}</b> on ${bet.label}`, 'you-toast');
  hud.renderSlip(S.bets, S.liveValues);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function showResult() {
  S.phase = 'RESULT';
  const o = S.match.outcome;
  const wDef = o.winner === 0 ? S.match.A : S.match.B;
  const wSide = o.winner === 0 ? 'A' : 'B';
  $('#strikeMeter').classList.add('hidden');

  let winnings = 0;
  for (const b of S.bets) {
    if (b.status !== 'open') continue;
    if (b.settle(o)) { b.status = 'won'; winnings += b.stake * b.payout; } else b.status = 'lost';
  }
  S.bankroll += winnings;
  saveBank();
  hud.setBankroll(S.bankroll, winnings > 0 ? 1 : 0);
  hud.renderSlip(S.bets, null);
  hud.clearHuddles();

  // bots settle too
  const botNets = bots.map(bot => {
    let net = 0;
    for (const x of bot.bets) {
      if (x.market.settle(o)) { const won = x.amount * x.market.payout; bot.stack += won; net += won - x.amount; }
      else net -= x.amount;
    }
    if (bot.stack < 100) bot.stack += 1000; // bots rebuy too
    updateSeat(bot);
    return { bot, net, played: bot.bets.length > 0 };
  });
  recordHistory(S.match, o);

  const net = S.bets.reduce((s, b) =>
    s + (b.status === 'won' ? b.stake * (b.payout - 1) : b.status === 'cashed' ? b.cashed - b.stake : -b.stake), 0);

  const ov = $('#resultOverlay');
  ov.innerHTML = '';
  const box = el('div', 'result-box side-' + wSide);
  const art = el('div', 'result-art side-' + wSide);
  art.append(el('div', 'cut-bg'));
  const cv = el('canvas');
  art.append(cv);
  box.append(art);

  const method = o.fatality ? 'FATALITY' : o.method === 'KO' ? 'KNOCKOUT' : 'DECISION';
  box.append(el('div', 'result-title' + (o.fatality ? ' fatal' : o.method === 'KO' ? '' : ' dec'), method));
  box.append(el('div', 'result-winner', `${wDef.name} WINS`));
  const realT = o.method === 'KO' ? (o.endTime - (o.endRound - 1) * ROUND_SECS) / TIME_SCALE : 0;
  box.append(el('div', 'result-sub', o.method === 'KO'
    ? `ROUND ${o.endRound} · ${realT.toFixed(1)}s IN · ${o.total} STRIKES LANDED`
    : `UNANIMOUS DECISION · ${o.total} STRIKES LANDED`));

  const list = el('div', 'result-bets');
  if (!S.bets.length) list.append(el('div', 'result-none', 'You sat this one out — get some chips down next fight.'));
  for (const b of S.bets) {
    const row = el('div', 'result-bet ' + b.status);
    row.append(el('span', '', b.label));
    row.append(el('span', 'rb-amt',
      b.status === 'won' ? '+' + fmtMoney(b.stake * b.payout)
        : b.status === 'cashed' ? '+' + fmtMoney(b.cashed) : '-' + fmtMoney(b.stake)));
    list.append(row);
  }
  box.append(list);
  if (S.bets.length) {
    const nr = el('div', 'result-net ' + (net > 0.004 ? 'win' : net < -0.004 ? 'loss' : 'even'));
    nr.innerHTML = '<span>ROUND NET</span><b>$0</b>';
    box.append(nr);
    tickNumber(nr.querySelector('b'), net, 1100);
  }
  const rt = el('div', 'result-table');
  for (const { bot, net: bn, played } of botNets) {
    if (!played) continue;
    const s = el('div', 'rt-seat');
    s.innerHTML = `<span class="t-avatar" style="--c:${bot.color}">${bot.avatar}</span>${bot.name} <b class="${bn >= 0 ? 'up' : 'dn'}">${bn >= 0 ? '+' : '−'}${fmtMoney(Math.abs(bn))}</b>`;
    rt.append(s);
  }
  box.append(rt);
  const next = el('div', 'result-next');
  next.innerHTML = `<div class="lbl">NEXT FIGHT LOADING</div><div class="bar"><i style="--dur:${RESULT_SECS}s"></i></div>`;
  box.append(next);
  ov.append(box);
  ov.classList.add('show');

  studio.set('result', cv, wDef, { side: wSide, yaw: wSide === 'A' ? 0.35 : -0.35, anim: 'win' });

  if (winnings > 0) {
    sfx.win();
    setTimeout(() => {
      const c = fx.center(box);
      fx.coins(c.x, c.y + 40, Math.min(80, 20 + Math.round(winnings / 10)));
      fx.confetti(c.x, c.y - 60, 70);
    }, 350);
  } else if (S.bets.length) sfx.lose();

  setTimeout(newMatch, RESULT_SECS * 1000);
}

function tickNumber(node, target, ms) {
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    const v = target * (1 - Math.pow(1 - k, 3));
    node.textContent = (v >= 0 ? '+' : '−') + fmtMoney(Math.abs(v));
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

function saveBank() {
  localStorage.setItem('pa_bankroll', String(Math.round(S.bankroll * 100) / 100));
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function loop(ts) {
  const dt = Math.min(0.1, (ts - lastFrame) / 1000 || 0.016);
  lastFrame = ts;

  switch (S.phase) {
    case 'BETTING': {
      S.bettingLeft -= dt;
      const left = Math.max(0, S.bettingLeft);
      const whole = Math.ceil(left);
      $('#countdown .cd-ring').style.strokeDashoffset = (169.65 * (1 - left / BETTING_SECS)).toFixed(2);
      $('#countdown .cd-num').textContent = whole;
      $('#betDock').classList.toggle('warn', left <= 15 && left > 10);
      $('#betDock').classList.toggle('urgent', left <= 10);
      $('#urgency').classList.toggle('on', left <= 10);
      if (whole !== S.lastWhole) {
        if (whole === 10) hud.announce('LAST CALL!', 'red', 1300, 'BETS CLOSE IN 10');
        if (whole <= 10 && whole > 0) sfx.tick();
        if (whole <= 3 && whole > 0) hud.announce(String(whole), 'count', 600);
        S.lastWhole = whole;
      }
      heatTimer += dt;
      if (heatTimer > 0.5) { heatTimer = 0; refreshHeat(); }
      if (S.bettingLeft <= 0) endBetting();
      break;
    }
    case 'ROUND': {
      const gdt = dt * TIME_SCALE;
      S.roundTime += gdt;
      S.gameTime += gdt;
      processRoundEvents();
      if (S.phase === 'ROUND') {
        hud.setClock((ROUND_SECS - S.roundTime) / TIME_SCALE, S.round);
        if (S.roundTime >= ROUND_SECS) endRoundByBell();
      }
      liveTimer += dt;
      if (liveTimer > 1.2) { liveTimer = 0; refreshLive(); }
      break;
    }
    case 'BREAK': {
      S.breakLeft -= dt;
      hud.setClock(0, S.round);
      liveTimer += dt;
      if (liveTimer > 1.2) { liveTimer = 0; refreshLive(); }
      if (S.breakLeft <= 0) startRound(S.round + 1);
      break;
    }
  }

  arena.update(dt);
  studio.render(dt);            // lobby cutouts / result portrait (shares the arena canvas)
  arena.draw(dt);

  // heat embers rising off hot zones
  if (S.phase === 'BETTING') {
    emberTimer += dt;
    if (emberTimer > 0.08) {
      emberTimer = 0;
      document.querySelectorAll('.bet-zone.is-hot').forEach(z => {
        const c = fx.center(z);
        fx.embers(c.x, c.y - c.h / 2 + 4, c.w * 0.8, { n: 2 });
      });
    }
  }
  fx.update(dt);
  fx.draw();

  requestAnimationFrame(loop);
}

boot();
