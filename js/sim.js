// Fight choreography: expands a pre-drawn outcome into per-round timelines of
// presentation events in GAME time (180 game-seconds per round; main.js plays
// them at TIME_SCALE so a round lasts 30 real seconds).
//
// Strikes are grouped into EXCHANGES (MK-style combo bursts of 2-5 hits,
// sometimes answered by a counter) separated by neutral spacing, plus
// standalone signature specials. Each fighter's counted strikes per round
// match the outcome exactly, so strike-total markets stay honest. Every
// landed event carries `dmg`, the HP fraction it removes, so health bars
// drop in hits and land exactly on the scripted round-end values.

import { rand, randRange, randInt, pick, clamp } from './util.js';
import { ROUND_SECS } from './engine.js';

const STRIKE_TYPES = ['punch', 'punch', 'palm', 'backfist', 'elbow', 'roundhouse', 'snapkick', 'spinkick', 'sweep'];
const HEAVY_TYPES = ['backfist', 'roundhouse', 'spinkick', 'palm', 'elbow'];
const OPENERS = ['punch', 'snapkick', 'punch', 'palm'];
const ENDERS = ['roundhouse', 'spinkick', 'uppercut', 'backfist', 'sweep'];
const HIT_GAP = [1.35, 2.0];      // game secs between hits in a combo (~0.22-0.33 s real)
const KO_RESERVE = 8;             // game secs kept clear before the KO finisher
const WEIGHT = { special: 2.6, heavy: 1.45, normal: 1 };

export function buildScript(outcome, A, B, hp) {
  const rounds = [];
  const defs = [A, B];

  for (let r = 1; r <= outcome.endRound; r++) {
    const [sA, sB] = outcome.perRound[r - 1];
    const isEndRound = r === outcome.endRound && outcome.method === 'KO';
    const roundLen = isEndRound ? outcome.endTime - (r - 1) * ROUND_SECS : ROUND_SECS;
    const events = [];

    // short KO rounds compress everything to fit
    const reserve = isEndRound ? Math.min(KO_RESERVE, roundLen * 0.35) : 3;
    const t0 = Math.min(4, roundLen * 0.08);
    const t1 = Math.min(Math.max(t0 + 0.5, roundLen - reserve), roundLen * 0.85);
    const exchanges = makeExchanges([sA, sB], defs);
    placeExchanges(events, exchanges, t0, t1);
    for (const e of events) e.t = clamp(e.t, Math.min(0.2, roundLen * 0.05), t1);

    if (isEndRound) {
      const koT = Math.max(roundLen * 0.9, roundLen - 0.01);
      const by = outcome.winner;
      const step = Math.min(1.5, reserve / 4.5);
      for (let i = 3; i >= 1; i--) {
        events.push({ t: koT - i * step, type: 'hurt', by, strike: pick(HEAVY_TYPES), counted: false });
      }
      events.push({ t: koT, type: 'ko', by, strike: 'uppercut' });
    }

    events.sort((a, b) => a.t - b.t);
    if (hp) assignDamage(events, hp.start[r - 1], hp.end[r - 1], isEndRound);
    rounds.push({ round: r, events, endTime: roundLen, isEndRound });
  }

  return { rounds, outcome };
}

// Split each fighter's landed strikes into combo exchanges.
function makeExchanges(counts, defs) {
  const rem = [...counts];
  const quota = defs.map(d => (d && d.special ? (rand() < 0.55 ? 2 : 1) : 0));
  const list = [];
  let exId = 0;
  while (rem[0] + rem[1] > 0) {
    const by = rand() < rem[0] / (rem[0] + rem[1]) ? 0 : 1;
    const def = 1 - by;
    const id = exId++;
    // standalone signature special
    if (quota[by] > 0 && rem[by] > 0 && rand() < 0.22) {
      quota[by]--; rem[by]--;
      list.push({ special: true, hits: [{ by, strike: defs[by].special.kind, specialName: defs[by].special.name, ex: id }] });
      continue;
    }
    const n = Math.min(rem[by], randInt(2, 5));
    rem[by] -= n;
    const hits = [];
    // sometimes a blocked opener before the combo lands
    if (rand() < 0.35) hits.push({ by, strike: pick(OPENERS), miss: true, ex: id });
    for (let i = 0; i < n; i++) {
      const strike = i === 0 ? pick(OPENERS) : i === n - 1 && n >= 3 ? pick(ENDERS) : pick(STRIKE_TYPES);
      hits.push({ by, strike, ex: id });
    }
    // counter-attack
    if (rem[def] > 0 && rand() < 0.35) {
      const c = Math.min(rem[def], randInt(1, 2));
      rem[def] -= c;
      for (let i = 0; i < c; i++) hits.push({ by: def, strike: pick(STRIKE_TYPES), ex: id, counter: true });
    }
    list.push({ hits });
  }
  // a quota left unused (unlucky rolls) upgrades a single hit
  defs.forEach((d, by) => {
    if (!d || !d.special || list.some(e => e.special && e.hits[0].by === by)) return;
    const ex = list.find(e => !e.special && e.hits.filter(h => h.by === by && !h.miss).length > 2);
    if (!ex) return;
    const h = ex.hits.findIndex(x => x.by === by && !x.miss);
    const [hit] = ex.hits.splice(h, 1);
    list.push({ special: true, hits: [{ ...hit, strike: d.special.kind, specialName: d.special.name }] });
  });
  return list.sort(() => rand() - 0.5);
}

// Lay exchanges out across [t0, t1] with neutral gaps in between.
function placeExchanges(events, list, t0, t1) {
  let gap = HIT_GAP;
  const durOf = ex => ex.special ? 0 : (ex.hits.length - 1) * (gap[0] + gap[1]) / 2;
  let busy = list.reduce((s, ex) => s + durOf(ex), 0);
  const span = t1 - t0;
  // compress combos if the round is crowded
  if (busy > span * 0.6) {
    const k = (span * 0.6) / busy;
    gap = [HIT_GAP[0] * k, HIT_GAP[1] * k];
    busy = span * 0.6;
  }
  const weights = list.map(ex => (ex.special ? 1.6 : 1) * randRange(0.6, 1.4));
  const wsum = weights.reduce((s, w) => s + w, 0) || 1;
  const free = Math.max(0, span - busy);
  let t = t0;
  list.forEach((ex, i) => {
    t += free * weights[i] / wsum;
    for (const h of ex.hits) {
      events.push({
        t, type: h.miss ? 'miss' : 'strike', by: h.by, strike: h.strike,
        counted: !h.miss, specialName: h.specialName, ex: h.ex, counter: h.counter,
      });
      t += randRange(gap[0], gap[1]);
    }
    t -= gap[1];
  });
}

// Spread each victim's scripted HP loss over the hits they take.
function assignDamage(events, hpFrom, hpTo, isEndRound) {
  for (const victim of [0, 1]) {
    const attacker = 1 - victim;
    const loss = Math.max(0, hpFrom[victim] - hpTo[victim]);
    const hits = events.filter(e => e.by === attacker && (e.type === 'strike' || e.type === 'hurt' || e.type === 'ko'));
    const finisher = hits.filter(e => e.type === 'hurt' || e.type === 'ko');
    const regular = hits.filter(e => e.type === 'strike');
    const finShare = isEndRound && finisher.length ? 0.38 : 0;
    const w = e => e.specialName ? WEIGHT.special : HEAVY_TYPES.includes(e.strike) ? WEIGHT.heavy : WEIGHT.normal;
    const regW = regular.reduce((s, e) => s + w(e), 0) || 1;
    for (const e of regular) e.dmg = loss * (1 - finShare) * w(e) / regW;
    for (const e of finisher) e.dmg = loss * finShare / finisher.length;
  }
}

// HP script: given the outcome, decide each fighter's HP at the end of every
// round so the bars tell the story the result requires.
//   KO loser -> ramps down, hits 0 at the KO moment.
//   Decision -> both finish with HP left; winner visibly higher.
export function buildHpScript(outcome) {
  const win = outcome.winner, lose = 1 - win;
  const hp = [[1, 1]];
  const endHp = [0, 0];

  if (outcome.method === 'KO') {
    endHp[lose] = 0;
    endHp[win] = randRange(0.45, 0.85);
  } else {
    endHp[lose] = randRange(0.18, 0.4);
    endHp[win] = randRange(endHp[lose] + 0.15, 0.8);
  }

  const nR = outcome.endRound;
  for (let r = 1; r <= nR; r++) {
    const prev = hp[r - 1];
    const t = r / nR;
    hp.push([
      lerpTo(prev[0], endHp[0], t, r === nR),
      lerpTo(prev[1], endHp[1], t, r === nR),
    ]);
  }
  return { start: hp.slice(0, -1), end: hp.slice(1) };
}

function lerpTo(from, to, t, final) {
  if (final) return to;
  const v = from + (to - from) * randRange(0.35, 0.6) + randRange(-0.05, 0.03);
  return clamp(v, Math.min(to + 0.05, from), from);
}
