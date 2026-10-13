// Fight choreography: expands a pre-drawn outcome into one timeline of
// presentation events in GAME time (FIGHT_SECS game-seconds; main.js plays
// them at TIME_SCALE so the fight lasts 30 real seconds).
//
// The fight is told as CLASHES: short exchanges (a blocked or slipped
// opener, 1-3 landed shots, sometimes a counter) with neutral breathing room
// between them, plus standalone signature specials. The eventual winner's
// clashes drift later in the fight, so it builds to pressure and a finish.
//
// Everything the markets settle on is honored exactly: each fighter's
// landed strikes, who lands first, every knockdown (`kd`, the victim gets
// back up) and the knockout. Every landed event carries `dmg`, the HP
// fraction it removes, so the health bars land exactly on the scripted end.

import { rand, randRange, randInt, pick, clamp } from './util.js';
import { KD_GAP } from './engine.js';

const STRIKE_TYPES = ['punch', 'punch', 'palm', 'backfist', 'elbow', 'roundhouse', 'snapkick', 'spinkick', 'sweep'];
const HEAVY_TYPES = ['backfist', 'roundhouse', 'spinkick', 'palm', 'elbow'];
const OPENERS = ['punch', 'snapkick', 'punch', 'palm'];
const ENDERS = ['roundhouse', 'spinkick', 'uppercut', 'backfist', 'sweep'];
const KD_BLOWS = ['roundhouse', 'spinkick', 'backfist', 'uppercut', 'palm'];
const HIT_GAP = [3.0, 3.9];       // game secs between blows inside a clash (~0.5-0.65 s real)
const MIN_BREAK = 12;             // game secs of neutral between clashes (~2 s real)
const KO_RESERVE = 12;            // game secs kept clear before the KO finisher
const WEIGHT = { special: 2.6, knockdown: 2.4, heavy: 1.45, normal: 1 };

export function buildScript(outcome, A, B, hp) {
  const defs = [A, B];
  const isKO = outcome.method === 'KO';
  const len = isKO ? outcome.endTime : 180;
  const events = [];

  const reserve = isKO ? Math.min(KO_RESERVE, len * 0.35) : 3;
  const t0 = Math.min(5, len * 0.06);
  const t1 = Math.max(t0 + 0.5, len - reserve);
  const clashes = makeClashes(outcome, defs);
  placeClashes(events, clashes, t0, t1, outcome);
  for (const e of events) e.t = clamp(e.t, Math.min(0.2, len * 0.05), t1);

  if (isKO) {
    // the finish: the winner hunts the hurt fighter down
    const koT = Math.max(len * 0.9, len - 0.01);
    const by = outcome.winner;
    const step = Math.min(2.8, reserve / 4.5);
    for (let i = 3; i >= 1; i--) {
      events.push({ t: koT - i * step, type: 'hurt', by, strike: pick(HEAVY_TYPES), counted: false });
    }
    events.push({ t: koT, type: 'ko', by, strike: 'uppercut' });
  }

  events.sort((a, b) => a.t - b.t);
  if (hp) assignDamage(events, hp.start, hp.end, isKO);
  return { events, endTime: len, outcome };
}

// Split each fighter's landed strikes into clashes.
function makeClashes(outcome, defs) {
  const rem = [...outcome.strikes];
  const list = [];
  let id = 0;
  const winner = outcome.winner;

  // knockdown clashes first: the blow that drops them ends the clash
  for (const kd of outcome.kds) {
    const by = kd.by;
    const n = Math.min(rem[by], randInt(1, 3));
    rem[by] -= n;
    const hits = [];
    if (rand() < 0.4) hits.push(missHit(by, id));
    for (let i = 0; i < n; i++) hits.push({ by, strike: i === n - 1 ? pick(KD_BLOWS) : pick(STRIKE_TYPES), ex: id, kd: i === n - 1 });
    list.push({ hits, by, kdAt: kd.t, id: id++ });
  }

  // signature specials (at most one each; fewer strikes, so they're rarer)
  for (const by of [0, 1]) {
    const d = defs[by];
    if (d && d.special && rem[by] >= 3 && rand() < 0.55) {
      rem[by]--;
      list.push({ special: true, by, id, hits: [{ by, strike: d.special.kind, specialName: d.special.name, ex: id }] });
      id++;
    }
  }

  // whoever lands first gets the opening clash (built before any counter can
  // spend their strikes)
  const first = outcome.first;
  let opener = null;
  if (first >= 0 && rem[first] > 0) {
    const n = Math.min(rem[first], pick([1, 2, 2]));
    rem[first] -= n;
    const hits = [];
    if (rand() < 0.5) hits.push(missHit(first, id));
    for (let i = 0; i < n; i++) hits.push({ by: first, strike: i === 0 ? pick(OPENERS) : pick(STRIKE_TYPES), ex: id });
    opener = { hits, by: first, id: id++ };
    list.push(opener);
  } else if (first >= 0) {
    opener = list.find(c => c.by === first) || null;
  }

  while (rem[0] + rem[1] > 0) {
    const by = rand() < rem[0] / (rem[0] + rem[1]) ? 0 : 1;
    const def = 1 - by;
    const n = Math.min(rem[by], pick([1, 2, 2, 3]));
    rem[by] -= n;
    const hits = [];
    // a blocked or slipped opener sets up most clashes
    if (rand() < 0.5) hits.push(missHit(by, id));
    for (let i = 0; i < n; i++) {
      const strike = i === 0 ? pick(OPENERS) : i === n - 1 && n >= 2 ? pick(ENDERS) : pick(STRIKE_TYPES);
      hits.push({ by, strike, ex: id });
    }
    // the defender fires back: sometimes it lands, sometimes it's stuffed
    if (rem[def] > 0 && rand() < 0.3) {
      rem[def]--;
      hits.push({ by: def, strike: pick(STRIKE_TYPES), ex: id, counter: true });
    } else if (rand() < 0.2) {
      hits.push({ ...missHit(def, id), counter: true });
    }
    list.push({ hits, by, id: id++ });
  }

  // story: the eventual winner's clashes drift later (pressure, then the
  // finish); knockdown clashes sit near their drawn moment
  const bias = outcome.method === 'KO' ? 0.55 : 0.3;
  for (const c of list) c.key = c.kdAt != null ? c.kdAt / 180 * (1 + bias) : rand() + (c.by === winner ? bias : 0);
  list.sort((a, b) => a.key - b.key);

  // whoever lands first opens the fight
  if (opener) list.unshift(...list.splice(list.indexOf(opener), 1));
  return list;
}

function missHit(by, ex) {
  // blocked (guard up) or slipped (dodge, the strike whiffs)
  return { by, strike: pick(OPENERS), miss: true, block: rand() < 0.6, ex };
}

// Lay clashes out across [t0, t1] with neutral breaks in between.
function placeClashes(events, list, t0, t1, outcome) {
  const span = t1 - t0;
  let gap = HIT_GAP;
  const durOf = c => c.special ? 0 : (c.hits.length - 1) * (gap[0] + gap[1]) / 2;
  const kdBusy = list.filter(c => c.kdAt != null).length * KD_GAP;
  let busy = list.reduce((s, c) => s + durOf(c), 0);
  const breaks = Math.max(0, list.length - 1) * MIN_BREAK;
  // crowded (a quick KO)? tighten blows first, then the breaks
  let minBreak = MIN_BREAK;
  if (busy + kdBusy + breaks > span * 0.92) {
    const k = clamp((span * 0.92 - kdBusy - breaks) / Math.max(1, busy), 0.45, 1);
    gap = [HIT_GAP[0] * k, HIT_GAP[1] * k];
    busy *= k;
    if (busy + kdBusy + breaks > span * 0.92) minBreak = Math.max(2, (span * 0.92 - kdBusy - busy) / Math.max(1, list.length - 1));
  }
  const free = Math.max(0, span - busy - kdBusy - minBreak * Math.max(0, list.length - 1));
  const weights = list.map(c => (c.special ? 1.4 : 1) * randRange(0.5, 1.5));
  const wsum = weights.reduce((s, w) => s + w, 0) || 1;
  let t = t0;
  list.forEach((c, i) => {
    t += free * weights[i] / wsum + (i ? minBreak : 0);
    for (const h of c.hits) {
      events.push({
        t, type: h.miss ? 'miss' : 'strike', by: h.by, strike: h.strike, block: h.block,
        counted: !h.miss, specialName: h.specialName, ex: h.ex, counter: h.counter, kd: h.kd,
      });
      t += randRange(gap[0], gap[1]);
    }
    t -= gap[1];
    if (c.kdAt != null) t += KD_GAP;
  });
}

// Spread each victim's scripted HP loss over the hits they take.
function assignDamage(events, hpFrom, hpTo, isKO) {
  for (const victim of [0, 1]) {
    const attacker = 1 - victim;
    const loss = Math.max(0, hpFrom[victim] - hpTo[victim]);
    const hits = events.filter(e => e.by === attacker && (e.type === 'strike' || e.type === 'hurt' || e.type === 'ko'));
    const finisher = hits.filter(e => e.type === 'hurt' || e.type === 'ko');
    const regular = hits.filter(e => e.type === 'strike');
    const finShare = isKO && finisher.length ? 0.38 : 0;
    const w = e => e.specialName ? WEIGHT.special : e.kd ? WEIGHT.knockdown : HEAVY_TYPES.includes(e.strike) ? WEIGHT.heavy : WEIGHT.normal;
    const regW = regular.reduce((s, e) => s + w(e), 0) || 1;
    for (const e of regular) e.dmg = loss * (1 - finShare) * w(e) / regW;
    for (const e of finisher) e.dmg = loss * finShare / finisher.length;
  }
}

// HP script: where each fighter's health ends up.
//   KO loser -> 0 at the KO moment.
//   Decision -> both finish with HP left; the winner visibly higher.
export function buildHpScript(outcome) {
  const win = outcome.winner, lose = 1 - win;
  const end = [0, 0];
  if (outcome.method === 'KO') {
    end[lose] = 0;
    end[win] = randRange(0.4, 0.85);
  } else {
    end[lose] = randRange(0.15, 0.4);
    end[win] = randRange(end[lose] + 0.15, 0.8);
  }
  // nobody loses health to a fighter who never landed
  for (const v of [0, 1]) {
    const by = 1 - v;
    if (!outcome.strikes[by] && !(outcome.method === 'KO' && outcome.winner === by)) end[v] = 1;
  }
  return { start: [1, 1], end };
}
