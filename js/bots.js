// Bot bettors: fake multiplayer presence. They drop chips on the table during
// the betting phase and fire live prop bets during the fight. Pure theater —
// their bankrolls are cosmetic — but wired through the same market data so
// their bets always reference real odds. Swappable later for networked players.

import { rand, randRange, pick, randInt } from './util.js';

const NAMES = [
  'RexBets88', 'LuckyLuna', 'ChalkEater', 'DogHunter', 'MsParlay', 'GlassJawJoe',
  'StackDaddy', 'NeonViper', 'DimeLine', 'FadeKing', 'JuiceQueen', 'TiltedTed',
];
const COLORS = ['#ff7043', '#ab47bc', '#26a69a', '#ec407a', '#7e57c2', '#66bb6a', '#ffa726', '#29b6f6'];

export function makeBots(n = 6) {
  const pool = [...NAMES];
  const bots = [];
  for (let i = 0; i < n; i++) {
    const name = pool.splice(randInt(0, pool.length - 1), 1)[0];
    bots.push({ name, color: COLORS[i % COLORS.length], avatar: name[0] });
  }
  return bots;
}

// Schedule pregame chip drops across the betting window.
// cb(bot, market, amount) fires per bet.
export function scheduleTableBets(bots, markets, windowSecs, cb) {
  const timers = [];
  for (const bot of bots) {
    const nBets = randInt(1, 3);
    for (let i = 0; i < nBets; i++) {
      const delay = randRange(1.2, windowSecs - 3) * 1000;
      timers.push(setTimeout(() => {
        // bots slightly favor likelier outcomes, with longshot spice
        const m = rand() < 0.65
          ? weightedPick(markets)
          : pick(markets);
        const amount = pick([5, 10, 25, 25, 50, 100]);
        cb(bot, m, amount);
      }, delay));
    }
  }
  return () => timers.forEach(clearTimeout);
}

function weightedPick(markets) {
  const total = markets.reduce((s, m) => s + m.prob, 0);
  let r = rand() * total;
  for (const m of markets) { r -= m.prob; if (r <= 0) return m; }
  return markets[markets.length - 1];
}

// During the fight, occasionally fire a live prop bet.
// Call each tick; returns a bet event or null.
export function maybeLiveBet(bots, liveMarkets, dt) {
  if (!liveMarkets.length) return null;
  // ~ one bot bet every 7 seconds on average
  if (rand() > dt / 7) return null;
  return {
    bot: pick(bots),
    market: pick(liveMarkets),
    amount: pick([5, 10, 25, 50]),
  };
}
