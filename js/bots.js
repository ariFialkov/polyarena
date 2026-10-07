// Bot bettors: the stand-in for multiplayer. Each has a seat on the rail, a
// cosmetic bankroll and a personality that drives what they back:
//   chalk    - favorites (weighted by probability)
//   longshot - big payouts
//   crowd    - piles onto whatever is popular right now (snowballs heat)
//   streak   - chases bet types that have been hitting lately
// All bets reference real market odds. Swap this module for a network feed
// when real players arrive.

import { rand, randRange, pick, randInt } from './util.js';

const NAMES = [
  'RexBets88', 'LuckyLuna', 'ChalkEater', 'DogHunter', 'MsParlay', 'GlassJawJoe',
  'StackDaddy', 'NeonViper', 'DimeLine', 'FadeKing', 'JuiceQueen', 'TiltedTed',
];
const COLORS = ['#ff4d7f', '#b16bff', '#19e3ff', '#3dff9a', '#ff8a1f', '#ffd54a', '#ff3df2', '#5a9cff'];
const STYLES = ['chalk', 'longshot', 'crowd', 'streak', 'chalk', 'crowd'];

export function makeBots(n = 6) {
  const pool = [...NAMES];
  return Array.from({ length: n }, (_, i) => {
    const name = pool.splice(randInt(0, pool.length - 1), 1)[0];
    return { name, color: COLORS[i % COLORS.length], avatar: name[0], stack: randInt(8, 50) * 100, style: STYLES[i % STYLES.length], seat: i };
  });
}

function weighted(items, w) {
  const ws = items.map(w);
  const tot = ws.reduce((s, x) => s + x, 0);
  if (tot <= 0) return pick(items);
  let r = rand() * tot;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// ctx: { pools: Map(id -> $), streak: Set(ids) }
export function chooseTableBet(bot, markets, ctx) {
  let m;
  switch (bot.style) {
    case 'chalk': m = weighted(markets, x => x.prob * x.prob); break;
    case 'longshot': m = weighted(markets, x => Math.min(40, x.payout)); break;
    case 'crowd': m = weighted(markets, x => 1 + (ctx.pools.get(x.id) || 0) / 20); break;
    case 'streak': {
      const hot = markets.filter(x => ctx.streak.has(x.id));
      m = hot.length && rand() < 0.75 ? pick(hot) : weighted(markets, x => x.prob);
      break;
    }
    default: m = pick(markets);
  }
  const base = bot.style === 'longshot' ? [5, 10, 25] : [10, 25, 25, 50, 100];
  const amount = Math.min(pick(base), Math.max(5, Math.floor(bot.stack / 10)));
  return { market: m, amount };
}

// Spread each bot's bets across the window, then a last-call frenzy.
// cb(bot, lastCall) fires per bet; main.js decides the market with live context.
export function scheduleTableBets(bots, windowSecs, cb) {
  const timers = [];
  const at = (s, fn) => timers.push(setTimeout(fn, s * 1000));
  for (const bot of bots) {
    const nBets = randInt(1, 3);
    for (let i = 0; i < nBets; i++) at(randRange(1.2, windowSecs - 10), () => cb(bot, false));
    if (rand() < 0.7) at(randRange(windowSecs - 8.5, windowSecs - 0.8), () => cb(bot, true));
  }
  return () => timers.forEach(clearTimeout);
}

// During the fight, occasionally fire a live prop bet.
export function maybeLiveBet(bots, liveMarkets, dt) {
  if (!liveMarkets.length || rand() > dt / 3.5) return null;
  const bot = pick(bots);
  return { bot, market: pick(liveMarkets), amount: pick([5, 10, 25, 50]) };
}
