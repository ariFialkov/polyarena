// Polyarena — main state machine.
// BETTING -> TRANSITION -> INTRO -> COUNTDOWN -> ROUND(1..3) [BREAK between]
//   -> KO sequence (optionally FATALITY) or DECISION -> RESULT -> next match.
//
// Game clock runs at 3x real time: a 3:00 round plays in 60 real seconds,
// so a full distance fight is 3 real minutes.

import { $, el, fmtMoney, fmtOdds, fmtClock, clamp, lerp, rand } from './util.js';
import { pickMatchup, record } from './fighters.js';
import { Match, RTP, ROUND_SECS, NUM_ROUNDS } from './engine.js';
import { buildScript, buildHpScript } from './sim.js';
import { Arena } from './render.js';
import { Table, buildChipTray } from './table.js';
import { Hud, shortName } from './hud.js';
import { makeBots, scheduleTableBets, maybeLiveBet } from './bots.js';
import { sfx, setSound, soundOn } from './audio.js';

const BETTING_SECS = 30;
const TIME_SCALE = 3;

const S = {
  phase: 'BOOT',
  bankroll: 1000,
  bets: [],
  match: null,
  script: null,
  hp: null,
  round: 0,
  roundTime: 0,       // game secs into current round
  gameTime: 0,        // game secs since fight start
  evIdx: 0,
  strikes: 0,
  bettingLeft: 0,
  cancelBots: null,
  liveValues: new Map(),
  roundHpFrom: [1, 1],
  roundHpTo: [1, 1],
  roundLen: ROUND_SECS,
};

let arena, table, hud, bots;
let lastFrame = 0;
let liveTimer = 0;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  S.bankroll = parseFloat(localStorage.getItem('pa_bankroll') || '1000');
  if (!isFinite(S.bankroll)) S.bankroll = 1000;

  arena = new Arena($('#arenaCanvas'));
  hud = new Hud({ onLiveBet: placeLiveBet, onCashout: cashout });
  table = new Table($('#table'), { onPlayerBet: placeTableBet });
  bots = makeBots(6);

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
    hud.toast('Rebuy: <b>+$1,000</b> demo credits', 'sys-toast');
  });

  window.addEventListener('resize', () => arena.resize());

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    const b = $('#installBtn');
    b.hidden = false;
    b.onclick = () => { deferredPrompt.prompt(); b.hidden = true; };
  });

  hud.setBankroll(S.bankroll);
  newMatch();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Betting phase
// ---------------------------------------------------------------------------

function newMatch() {
  const [A, B] = pickMatchup();
  S.match = new Match(A, B);
  S.bets = [];
  S.liveValues = new Map();
  S.strikes = 0;
  S.round = 0;
  S.gameTime = 0;

  arena.setFighters(A, B);
  hud.setMatch(S.match);
  hud.clearHuddles();
  hud.renderSlip(S.bets, null);
  table.build(S.match);
  table.setLocked(false);

  $('#resultOverlay').classList.remove('show');
  $('#matchBanner').textContent = `${shortName(A).toUpperCase()}  vs  ${shortName(B).toUpperCase()}`;
  $('#strikeInfo').textContent = `O/U ${S.match.strikeLine} strikes`;
  $('#table').classList.remove('open');
  $('#table').hidden = false;
  $('#chipTray').classList.remove('hidden');
  $('#betControls').classList.remove('hidden');
  $('#skipBtn').hidden = false;
  $('#fightHud').classList.add('hidden');
  $('#rebuyBtn').hidden = S.bankroll >= 1;

  S.phase = 'BETTING';
  S.bettingLeft = BETTING_SECS;
  hud.setClock(0, 0);

  S.cancelBots = scheduleTableBets(bots, S.match.markets, BETTING_SECS, (bot, m, amt) => {
    if (S.phase !== 'BETTING') return;
    table.botBet(m, amt, bot);
    hud.botToast(bot, `put ${fmtMoney(amt)} on <b>${marketDisplay(m)}</b> @ ${fmtOdds(m.payout)}`);
    sfx.chip();
  });

  hud.announce('PLACE YOUR BETS', 'gold', 2000);
}

function marketDisplay(m) {
  if (m.side === 'A') return `${shortName(S.match.A).toUpperCase()} ${m.label}`;
  if (m.side === 'B') return `${shortName(S.match.B).toUpperCase()} ${m.label}`;
  return m.label;
}

function placeTableBet(market, amount) {
  if (S.phase !== 'BETTING') return false;
  if (amount > S.bankroll) {
    hud.toast('Not enough bankroll', 'sys-toast');
    return false;
  }
  S.bankroll -= amount;
  saveBank();
  hud.setBankroll(S.bankroll, -1);
  // merge with existing bet on same market at same price
  const existing = S.bets.find(b => !b.live && b.marketId === market.id);
  if (existing) existing.stake += amount;
  else S.bets.push(makeBet(market, amount, false));
  hud.renderSlip(S.bets, null);
  return true;
}

function makeBet(market, stake, live) {
  return {
    marketId: market.id,
    label: (live ? 'LIVE · ' : '') + marketDisplay(market),
    stake,
    payout: market.payout,
    pred: market.pred,
    settle: market.settle,
    status: 'open',
    live,
  };
}

function undoBet() {
  if (S.phase !== 'BETTING') return;
  const bet = S.bets[S.bets.length - 1];
  if (!bet) return;
  S.bets.pop();
  S.bankroll += bet.stake;
  saveBank();
  hud.setBankroll(S.bankroll, 1);
  table.clearPlayerChips();
  redropPlayerChips();
  hud.renderSlip(S.bets, null);
}

function clearBets() {
  if (S.phase !== 'BETTING') return;
  for (const b of S.bets) S.bankroll += b.stake;
  S.bets = [];
  saveBank();
  hud.setBankroll(S.bankroll, 1);
  table.clearPlayerChips();
  hud.renderSlip(S.bets, null);
}

function redropPlayerChips() {
  for (const b of S.bets) {
    const z = table.zones.get(b.marketId);
    if (z) table.dropChip(z, b.stake, null);
  }
}

function endBetting() {
  if (S.cancelBots) S.cancelBots();
  table.setLocked(true);
  $('#skipBtn').hidden = true;
  $('#betControls').classList.add('hidden');
  S.phase = 'TRANSITION';
  hud.announce('BETS LOCKED', 'red', 1400);
  sfx.bellEnd();
  // table swings open to reveal the arena
  setTimeout(() => $('#table').classList.add('open'), 400);
  setTimeout(() => {
    $('#table').hidden = true;
    startIntro();
  }, 1500);
}

// ---------------------------------------------------------------------------
// Intro / countdown
// ---------------------------------------------------------------------------

function startIntro() {
  S.phase = 'INTRO';
  $('#fightHud').classList.remove('hidden');
  hud.setClock(ROUND_SECS, 1);

  const [fa, fb] = [arena.fighter(0), arena.fighter(1)];
  fa.x = -1.5; fb.x = 1.5;
  fa.anim = fb.anim = 'walk';
  S.introT = 0;

  const tape = $('#tape');
  tape.innerHTML = '';
  tape.append(tapeCard(S.match.A, 'A'), el('div', 'tape-vs', 'VS'), tapeCard(S.match.B, 'B'));
  tape.classList.add('show');

  hud.announce(shortName(S.match.A).toUpperCase(), 'gold', 1700);
  setTimeout(() => hud.announce(shortName(S.match.B).toUpperCase(), 'blue', 1700), 1900);
  setTimeout(() => {
    tape.classList.remove('show');
    startCountdown();
  }, 4600);
}

function tapeCard(f, side) {
  const c = el('div', 'tape-card side-' + side);
  c.append(el('div', 'tape-name', f.name));
  c.append(el('div', 'tape-sub', `${f.style} · ${record(f)}`));
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
  let n = 3;
  const step = () => {
    if (n > 0) {
      hud.announce(String(n), 'count', 800);
      sfx.tick();
      n--;
      setTimeout(step, 900);
    } else {
      hud.announce('FIGHT!', 'red big', 1100);
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
    S.script = buildScript(S.match.outcome);
    S.hp = buildHpScript(S.match.outcome);
  }
  S.phase = 'ROUND';
  S.round = r;
  S.roundTime = 0;
  S.evIdx = 0;
  const sr = S.script.rounds[r - 1];
  S.roundLen = sr.endTime;
  S.roundHpFrom = S.hp.start[r - 1];
  S.roundHpTo = S.hp.end[r - 1];
  hud.setHp(0, S.roundHpFrom[0]);
  hud.setHp(1, S.roundHpFrom[1]);
  if (r > 1) {
    hud.announce('ROUND ' + r, 'gold', 1500);
    sfx.bell();
  }
  refreshLive();
}

function processRoundEvents() {
  const evs = S.script.rounds[S.round - 1].events;
  while (S.evIdx < evs.length && evs[S.evIdx].t <= S.roundTime) {
    const ev = evs[S.evIdx++];
    switch (ev.type) {
      case 'strike':
        arena.strike(ev.by, ev.strike, true);
        sfx.hit();
        S.strikes++;
        $('#strikeInfo').textContent = `STRIKES ${S.strikes} · O/U ${S.match.strikeLine}`;
        break;
      case 'miss':
        arena.strike(ev.by, ev.strike, false);
        if (rand() < 0.4) sfx.whiff();
        break;
      case 'hurt':
        arena.strike(ev.by, ev.strike, true, true);
        sfx.bigHit();
        if (ev.counted !== false) S.strikes++;
        break;
      case 'ko':
        doKO(ev);
        return;
    }
  }
}

function doKO(ev) {
  const o = S.match.outcome;
  S.phase = 'KOSEQ';
  arena.strike(ev.by, ev.strike, true, true);
  sfx.bigHit();
  setTimeout(() => {
    arena.knockdown(1 - o.winner);
    hud.setHp(1 - o.winner, 0);
    sfx.ko();
    hud.announce('K.O.!', 'red big', 2200);
  }, 250);

  setTimeout(() => {
    if (o.fatality) {
      hud.announce('FINISH THEM!', 'fatality-call', 1800);
      sfx.bellEnd();
      setTimeout(() => {
        arena.fatality(o.winner);
        sfx.fatality();
        hud.announce('FATALITY', 'fatality big', 2600);
        setTimeout(showResult, 3000);
      }, 2000);
    } else {
      arena.celebrate(o.winner);
      sfx.bell();
      setTimeout(showResult, 2200);
    }
  }, 2600);
}

function endRoundByBell() {
  sfx.bellEnd();
  const o = S.match.outcome;
  if (S.round >= NUM_ROUNDS) {
    S.phase = 'DECIDE';
    hud.announce('FINAL BELL', 'gold', 1800);
    setTimeout(() => {
      hud.announce('TO THE JUDGES…', '', 1800);
      setTimeout(() => {
        arena.celebrate(o.winner);
        sfx.win();
        showResult();
      }, 2200);
    }, 1600);
  } else {
    S.phase = 'BREAK';
    S.breakLeft = 7;
    hud.announce(`END OF ROUND ${S.round}`, '', 1600);
    refreshLive();
  }
}

// ---------------------------------------------------------------------------
// Live betting + cashout
// ---------------------------------------------------------------------------

function liveRoundNum() {
  return S.phase === 'BREAK' ? Math.min(S.round + 1, NUM_ROUNDS) : Math.max(1, S.round);
}

function fightAlive() {
  return S.phase === 'ROUND' || S.phase === 'BREAK';
}

function refreshLive() {
  if (!fightAlive()) return;
  const t = S.gameTime;
  const markets = S.match.liveMarkets(t, liveRoundNum());
  hud.renderLiveMarkets(markets, table.selectedChip);

  S.liveValues = new Map();
  for (const b of S.bets) {
    if (b.status === 'open') S.liveValues.set(b, S.match.cashoutValue(b, t));
  }
  hud.renderSlip(S.bets, S.liveValues);

  // bot live-bet theater
  const ev = maybeLiveBet(bots, markets, 1.6);
  if (ev) {
    hud.botToast(ev.bot, `live bet ${fmtMoney(ev.amount)} on <b>${ev.market.label}</b> @ ${fmtOdds(ev.market.payout)}`);
  }
}

function placeLiveBet(m) {
  if (!fightAlive()) return;
  const amount = table.selectedChip;
  if (amount > S.bankroll) { hud.toast('Not enough bankroll', 'sys-toast'); return; }
  S.bankroll -= amount;
  saveBank();
  hud.setBankroll(S.bankroll, -1);
  S.bets.push(makeBet(m, amount, true));
  sfx.chip();
  hud.toast(`You bet <b>${fmtMoney(amount)}</b> on <b>${m.label}</b> @ ${fmtOdds(m.payout)}`, 'you-toast');
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
  hud.toast(`Cashed out <b>${fmtMoney(v)}</b> on ${bet.label}`, 'you-toast');
  hud.renderSlip(S.bets, S.liveValues);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function showResult() {
  S.phase = 'RESULT';
  const o = S.match.outcome;
  const winner = o.winner === 0 ? S.match.A : S.match.B;

  let winnings = 0, staked = 0;
  for (const b of S.bets) {
    if (b.status !== 'open') continue;
    staked += b.stake;
    if (b.settle(o)) {
      b.status = 'won';
      winnings += b.stake * b.payout;
    } else {
      b.status = 'lost';
    }
  }
  S.bankroll += winnings;
  saveBank();
  hud.setBankroll(S.bankroll, winnings > 0 ? 1 : 0);
  hud.renderSlip(S.bets, null);
  hud.clearHuddles();
  if (winnings > 0) sfx.win(); else if (staked > 0) sfx.lose();

  const ov = $('#resultOverlay');
  ov.innerHTML = '';
  const box = el('div', 'result-box');
  box.append(el('div', 'result-title', o.fatality ? 'FATALITY' : o.method === 'KO' ? 'KNOCKOUT' : 'DECISION'));
  box.append(el('div', 'result-winner', `${winner.name} WINS`));
  box.append(el('div', 'result-sub',
    o.method === 'KO'
      ? `Round ${o.endRound} · ${fmtClock(o.endTime - (o.endRound - 1) * ROUND_SECS)} · ${o.total} strikes landed`
      : `Unanimous decision · ${o.total} strikes landed`));

  const list = el('div', 'result-bets');
  if (S.bets.length === 0) {
    list.append(el('div', 'result-none', 'You sat this one out.'));
  } else {
    for (const b of S.bets) {
      const row = el('div', 'result-bet ' + b.status);
      row.append(el('span', '', b.label));
      row.append(el('span', 'rb-amt',
        b.status === 'won' ? '+' + fmtMoney(b.stake * b.payout)
        : b.status === 'cashed' ? '+' + fmtMoney(b.cashed)
        : '-' + fmtMoney(b.stake)));
      list.append(row);
    }
    const net = S.bets.reduce((s, b) =>
      s + (b.status === 'won' ? b.stake * (b.payout - 1)
        : b.status === 'cashed' ? b.cashed - b.stake
        : -b.stake), 0);
    const netRow = el('div', 'result-net ' + (net >= 0 ? 'win' : 'loss'),
      (net >= 0 ? 'ROUND NET +' : 'ROUND NET −') + fmtMoney(Math.abs(net)).slice(0));
    list.append(netRow);
  }
  box.append(list);
  box.append(el('div', 'result-next', 'Next fight starting…'));
  ov.append(box);
  ov.classList.add('show');

  setTimeout(newMatch, 9000);
}

function saveBank() {
  localStorage.setItem('pa_bankroll', String(Math.round(S.bankroll * 100) / 100));
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function loop(ts) {
  const dt = Math.min(0.05, (ts - lastFrame) / 1000 || 0.016);
  lastFrame = ts;

  switch (S.phase) {
    case 'BETTING': {
      S.bettingLeft -= dt;
      const bar = $('#betTimer .bt-fill');
      bar.style.transform = `scaleX(${clamp(S.bettingLeft / BETTING_SECS, 0, 1)})`;
      $('#betTimer .bt-label').textContent = `Fight starts in ${Math.ceil(Math.max(0, S.bettingLeft))}s`;
      if (S.bettingLeft <= 0) endBetting();
      break;
    }
    case 'INTRO': {
      S.introT += dt;
      const k = clamp(S.introT / 3.5, 0, 1);
      const e = 1 - Math.pow(1 - k, 2);
      arena.fighter(0).x = lerp(-1.5, -0.45, e);
      arena.fighter(1).x = lerp(1.5, 0.45, e);
      if (k >= 1) { arena.fighter(0).anim = arena.fighter(1).anim = 'idle'; }
      break;
    }
    case 'ROUND': {
      const gdt = dt * TIME_SCALE;
      S.roundTime += gdt;
      S.gameTime += gdt;
      processRoundEvents();
      if (S.phase === 'ROUND') {
        // scripted HP drift toward the round's target
        const k = clamp(S.roundTime / S.roundLen, 0, 1);
        hud.setHp(0, lerp(S.roundHpFrom[0], S.roundHpTo[0], k));
        hud.setHp(1, lerp(S.roundHpFrom[1], S.roundHpTo[1], k));
        hud.setClock(ROUND_SECS - S.roundTime, S.round);
        if (S.roundTime >= ROUND_SECS) endRoundByBell();
      }
      liveTimer += dt;
      if (liveTimer > 1.6) { liveTimer = 0; refreshLive(); }
      break;
    }
    case 'BREAK': {
      S.breakLeft -= dt;
      hud.setClock(0, S.round);
      liveTimer += dt;
      if (liveTimer > 1.6) { liveTimer = 0; refreshLive(); }
      if (S.breakLeft <= 0) startRound(S.round + 1);
      break;
    }
  }

  const fighting = ['ROUND', 'KOSEQ', 'DECIDE', 'COUNTDOWN'].includes(S.phase);
  arena.update(dt, S.phase === 'ROUND');
  arena.draw(ts / 1000);
  hud.tick(dt);

  requestAnimationFrame(loop);
}

boot();
