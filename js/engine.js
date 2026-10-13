// Betting engine.
//
// A single generative fight model drives EVERYTHING:
//  - Market probabilities are estimated by Monte-Carlo over the model (N samples).
//  - Payouts are set to RTP / p, so every market returns the same 96% RTP.
//  - The real fight outcome is one more independent draw from the same model,
//    which makes displayed odds and realized outcomes consistent by construction.
//  - Live (in-fight) odds are the same sample set conditioned on
//    "fight still in progress at game-time t", keeping live RTP at 96% too.

import { rand, randNormal, clamp } from './util.js';

export const RTP = 0.96;
export const FIGHT_SECS = 180;      // game-time seconds in the one 30-second fight
export const DIST_TIME = FIGHT_SECS + 1; // sentinel endTime for a decision
export const KD_GAP = 30;           // game secs a knockdown needs before anything else (fall + get-up)
const MC_SAMPLES = 30000;
const MIN_PROB = 0.005;
const MAX_PAYOUT = 150;
const KO_SCALE = 7.2;               // per-strike KO odds, tuned for ~40% KOs over one fight
const KD_SCALE = 1.25;              // knockdown odds relative to KO odds

// ---------------------------------------------------------------------------
// Generative model: one fight of FIGHT_SECS game seconds
// ---------------------------------------------------------------------------

// landed strikes expected over the fight (about 5-10 each: clashes, not a brawl)
function strikeMean(f, opp) {
  return Math.max(3, 2.2 + 0.05 * f.speed + 0.035 * f.aggression - 0.02 * opp.defense);
}

function koPerStrike(f, opp) {
  return 0.0055 * KO_SCALE *
    (0.4 + f.power / 90) *
    (1.55 - opp.chin / 105) *
    (1.1 - opp.defense / 250) *
    (0.9 + f.aggression / 500);
}

// Simulate one fight. Returns a detailed outcome object.
//   winner 0 (A) | 1 (B); method 'KO' | 'DEC'; endTime game secs (DIST_TIME
//   for a decision); strikes [A, B] landed; kds [{ by, t }] knockdowns the
//   victim got up from; first: who landed first (-1 if nobody landed).
export function simFight(A, B) {
  const F = [A, B];
  const k = [koPerStrike(A, B), koPerStrike(B, A)];
  const s = [0, 1].map(i => {
    const m = strikeMean(F[i], F[1 - i]);
    return Math.max(0, Math.round(randNormal(m, m * 0.28)));
  });

  // knockout: each landed strike carries a chance; the KO lands somewhere in
  // the back 80% of the fight (nobody gets flattened in the first exchange)
  let winner = -1, method = 'DEC', endTime = DIST_TIME;
  const tKo = [0, 1].map(i => (rand() < 1 - Math.pow(1 - k[i], s[i]) ? FIGHT_SECS * (0.2 + 0.8 * rand()) : Infinity));
  if (tKo[0] < Infinity || tKo[1] < Infinity) {
    winner = tKo[0] <= tKo[1] ? 0 : 1;
    method = 'KO';
    endTime = Math.min(tKo[0], tKo[1]);
    const frac = Math.max(0.12, endTime / FIGHT_SECS);
    for (const i of [0, 1]) s[i] = Math.max(winner === i ? 1 : 0, Math.round(s[i] * frac));
  }

  // knockdowns (the fighter beats the count): at most one each, with room to
  // fall and get up before the next knockdown or the knockout
  const kds = [];
  const fightEnd = Math.min(endTime, FIGHT_SECS);
  for (const i of [0, 1]) {
    if (!s[i] || rand() > 1 - Math.pow(1 - k[i] * KD_SCALE, s[i])) continue;
    kds.push({ by: i, t: 12 + rand() * (FIGHT_SECS - 12) });
  }
  kds.sort((x, y) => x.t - y.t);
  for (let j = kds.length - 1; j >= 0; j--) {
    const ok = kds[j].t + KD_GAP <= fightEnd && (j === 0 || kds[j].t - kds[j - 1].t >= KD_GAP);
    if (!ok) kds.splice(j, 1);
  }

  // first to land: the busier, faster fighter usually gets there first
  let first = -1;
  if (s[0] + s[1] > 0) {
    const w = [0, 1].map(i => s[i] * Math.pow(F[i].speed / 70, 2));
    first = rand() * (w[0] + w[1]) < w[0] ? 0 : 1;
  }

  if (winner === -1) {
    // judges: landed strikes, knockdowns weigh heavy, a little power bias
    const kdPts = i => kds.filter(x => x.by === i).length * 4;
    const scoreA = s[0] + kdPts(0) + randNormal(0, 2) + (A.power - B.power) * 0.015;
    const scoreB = s[1] + kdPts(1) + randNormal(0, 2);
    winner = scoreA >= scoreB ? 0 : 1;
    // you can't win on the cards without landing anything
    if (!s[winner] && s[1 - winner]) winner = 1 - winner;
  }

  const fatality = method === 'KO' && rand() < (0.15 + 0.0045 * F[winner].flair);

  return { winner, method, endTime, fatality, strikes: s, strikesA: s[0], strikesB: s[1], total: s[0] + s[1], kds, first };
}

// ---------------------------------------------------------------------------
// Match: MC sampling + market construction
// ---------------------------------------------------------------------------

export class Match {
  constructor(A, B) {
    this.A = A;
    this.B = B;
    this.n = MC_SAMPLES;
    // Compact per-sample records for probability queries.
    this.sWinner = new Uint8Array(this.n);
    this.sKO = new Uint8Array(this.n);      // 1 if KO
    this.sKD = new Uint8Array(this.n);      // knockdowns scored
    this.sFirst = new Int8Array(this.n);    // who landed first
    this.sFatal = new Uint8Array(this.n);
    this.sEnd = new Float32Array(this.n);   // endTime (game secs, DIST_TIME if decision)
    this.sTotal = new Uint16Array(this.n);  // total landed strikes

    const totals = new Uint16Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const o = simFight(A, B);
      this.sWinner[i] = o.winner;
      this.sKO[i] = o.method === 'KO' ? 1 : 0;
      this.sKD[i] = o.kds.length;
      this.sFirst[i] = o.first;
      this.sFatal[i] = o.fatality ? 1 : 0;
      this.sEnd[i] = o.endTime;
      this.sTotal[i] = o.total;
      totals[i] = o.total;
    }
    // strike line: the half-point that splits the sample closest to 50/50
    // (totals are small integers, so the plain median can be lopsided)
    totals.sort();
    let best = 0.5, bestGap = 2;
    for (let k = totals[0]; k <= totals[this.n - 1]; k++) {
      let over = 0;
      for (let i = 0; i < this.n; i++) if (totals[i] > k) over++;
      const gap = Math.abs(over / this.n - 0.5);
      if (gap < bestGap) { bestGap = gap; best = k + 0.5; }
    }
    this.strikeLine = best;

    this.markets = this.buildMarkets();
    this.outcome = simFight(A, B);                 // THE fight (same distribution)
  }

  prob(pred, minTime = -1) {
    let hit = 0, tot = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.sEnd[i] <= minTime) continue;       // condition: alive at minTime
      tot++;
      if (pred(i)) hit++;
    }
    return tot === 0 ? 0 : hit / tot;
  }

  payoutFor(p) {
    p = clamp(p, MIN_PROB, 1);
    return Math.min(MAX_PAYOUT, Math.round((RTP / p) * 100) / 100);
  }

  buildMarkets() {
    const L = this.strikeLine;
    const defs = [
      { id: 'A_WIN', side: 'A', label: 'WINS', big: true,
        pred: i => this.sWinner[i] === 0, settle: o => o.winner === 0 },
      { id: 'B_WIN', side: 'B', label: 'WINS', big: true,
        pred: i => this.sWinner[i] === 1, settle: o => o.winner === 1 },
      { id: 'A_KO', side: 'A', label: 'BY KO',
        pred: i => this.sWinner[i] === 0 && this.sKO[i] === 1, settle: o => o.winner === 0 && o.method === 'KO' },
      { id: 'B_KO', side: 'B', label: 'BY KO',
        pred: i => this.sWinner[i] === 1 && this.sKO[i] === 1, settle: o => o.winner === 1 && o.method === 'KO' },
      { id: 'A_DEC', side: 'A', label: 'BY DECISION',
        pred: i => this.sWinner[i] === 0 && this.sKO[i] === 0, settle: o => o.winner === 0 && o.method === 'DEC' },
      { id: 'B_DEC', side: 'B', label: 'BY DECISION',
        pred: i => this.sWinner[i] === 1 && this.sKO[i] === 0, settle: o => o.winner === 1 && o.method === 'DEC' },
      { id: 'A_FIRST', side: 'A', label: 'LANDS FIRST',
        pred: i => this.sFirst[i] === 0, settle: o => o.first === 0 },
      { id: 'B_FIRST', side: 'B', label: 'LANDS FIRST',
        pred: i => this.sFirst[i] === 1, settle: o => o.first === 1 },
      { id: 'DIST', side: 'C', label: 'GOES THE DISTANCE',
        pred: i => this.sKO[i] === 0, settle: o => o.method === 'DEC' },
      { id: 'FATAL', side: 'C', label: 'FATALITY FINISH',
        pred: i => this.sFatal[i] === 1, settle: o => o.fatality },
      { id: 'OVER', side: 'C', label: `STRIKES OVER ${L}`,
        pred: i => this.sTotal[i] > L, settle: o => o.total > L },
      { id: 'UNDER', side: 'C', label: `STRIKES UNDER ${L}`,
        pred: i => this.sTotal[i] < L, settle: o => o.total < L },
      { id: 'KD', side: 'C', label: 'KNOCKDOWN SCORED',
        pred: i => this.sKD[i] > 0, settle: o => o.kds.length > 0 },
    ];
    for (const m of defs) {
      m.prob = this.prob(m.pred);
      m.payout = this.payoutFor(m.prob);
    }
    return defs;
  }

  market(id) { return this.markets.find(m => m.id === id); }

  // -------------------------------------------------------------------------
  // Live (in-fight) markets, conditioned on the fight being alive at time t.
  // Each returns { id, label, prob, payout, settle } with payout at 96% RTP
  // of the conditional probability. Returns [] for dead markets (p≈0 or 1).
  // -------------------------------------------------------------------------
  liveMarkets(t) {
    const L = this.strikeLine;
    const defs = [
      { id: 'L_A_WIN', side: 'A', label: `${this.A.name.split(' ')[0]} WINS`,
        pred: i => this.sWinner[i] === 0, settle: o => o.winner === 0 },
      { id: 'L_B_WIN', side: 'B', label: `${this.B.name.split(' ')[0]} WINS`,
        pred: i => this.sWinner[i] === 1, settle: o => o.winner === 1 },
      { id: 'L_KO', side: 'C', label: 'ENDS IN A KO',
        pred: i => this.sKO[i] === 1, settle: o => o.method === 'KO' },
      { id: 'L_DIST', side: 'C', label: 'GOES THE DISTANCE',
        pred: i => this.sKO[i] === 0, settle: o => o.method === 'DEC' },
      { id: 'L_FATAL', side: 'C', label: 'FATALITY',
        pred: i => this.sFatal[i] === 1, settle: o => o.fatality },
      { id: 'L_OVER', side: 'C', label: `STRIKES O ${L}`,
        pred: i => this.sTotal[i] > L, settle: o => o.total > L },
      { id: 'L_UNDER', side: 'C', label: `STRIKES U ${L}`,
        pred: i => this.sTotal[i] < L, settle: o => o.total < L },
    ];
    const out = [];
    for (const m of defs) {
      const p = this.prob(m.pred, t);
      if (p < 0.01 || p > 0.97) continue;
      m.prob = p;
      m.payout = this.payoutFor(p);
      out.push(m);
    }
    return out;
  }

  // Fair cash-out value of a bet given fight time t (96% of fair EV).
  cashoutValue(bet, t) {
    const p = this.prob(bet.pred, t);
    return Math.floor(bet.stake * bet.payout * p * RTP * 100) / 100;
  }
}
