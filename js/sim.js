// Fight choreography: expands a pre-drawn outcome into a per-round timeline of
// presentation events (strikes, knockdown, fatality) in GAME time, plus an HP
// script so health bars land exactly where the outcome says they should.
//
// Game time runs at 3x real time: each 3:00 round plays out in 60 real seconds.

import { rand, randRange, pick, clamp } from './util.js';
import { ROUND_SECS } from './engine.js';

const STRIKE_TYPES = ['jab', 'cross', 'hook', 'kick', 'knee', 'upper'];

// Build the full fight script from an engine outcome.
// Returns { rounds: [ { events:[...], endTime } ], koEvent|null }
export function buildScript(outcome) {
  const rounds = [];

  for (let r = 1; r <= outcome.endRound; r++) {
    const [sA, sB] = outcome.perRound[r - 1];
    const isEndRound = r === outcome.endRound && outcome.method === 'KO';
    const roundLen = isEndRound ? outcome.endTime - (r - 1) * ROUND_SECS : ROUND_SECS;
    const events = [];

    // Landed strikes, spread over the round (kept clear of the final KO beat).
    addStrikes(events, 0, sA, roundLen - (isEndRound ? 6 : 2), 'A');
    addStrikes(events, 1, sB, roundLen - (isEndRound ? 6 : 2), 'B');

    // Cosmetic misses/blocks for texture (don't count toward totals).
    const flavor = Math.round((sA + sB) * 0.45);
    for (let i = 0; i < flavor; i++) {
      events.push({
        t: randRange(1, Math.max(2, roundLen - 3)),
        type: 'miss', by: rand() < 0.5 ? 0 : 1,
        strike: pick(STRIKE_TYPES),
      });
    }

    if (isEndRound) {
      // A short hurt combo into the finishing blow.
      const koT = roundLen - 0.01;
      const by = outcome.winner;
      for (let i = 3; i >= 1; i--) {
        events.push({ t: koT - i * 1.6, type: 'hurt', by, strike: pick(STRIKE_TYPES), counted: false });
      }
      events.push({ t: koT, type: 'ko', by, strike: pick(['upper', 'hook', 'kick']) });
    }

    events.sort((a, b) => a.t - b.t);
    rounds.push({ round: r, events, endTime: roundLen, isEndRound });
  }

  return { rounds, outcome };
}

function addStrikes(events, by, count, span, tag) {
  for (let i = 0; i < count; i++) {
    events.push({
      t: randRange(1.5, Math.max(2.5, span)),
      type: 'strike', by,
      strike: pick(STRIKE_TYPES),
      counted: true,
    });
  }
}

// HP script: given the outcome, decide each fighter's HP at the end of every
// round so the bars tell the story the result requires.
//   KO loser -> ramps down, hits 0 at the KO moment.
//   Decision -> both finish with HP left; winner visibly higher.
export function buildHpScript(outcome) {
  const win = outcome.winner, lose = 1 - win;
  const hp = [[1, 1]]; // hp[r] = [hpA, hpB] at START of round r+1 (index 0 = start of fight)
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
    const target = [
      lerpTo(prev[0], endHp[0], t, r === nR),
      lerpTo(prev[1], endHp[1], t, r === nR),
    ];
    hp.push(target);
  }
  return { start: hp.slice(0, -1), end: hp.slice(1) };
}

function lerpTo(from, to, t, final) {
  if (final) return to;
  // drift toward target with noise, plus small between-round recovery feel
  const v = from + (to - from) * randRange(0.35, 0.6) + randRange(-0.05, 0.03);
  return clamp(v, Math.min(to + 0.05, from), from);
}
