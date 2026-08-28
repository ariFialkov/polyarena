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
export const ROUND_SECS = 180;      // game-time seconds per round
export const NUM_ROUNDS = 3;
export const DIST_TIME = ROUND_SECS * NUM_ROUNDS + 1; // sentinel endTime for a decision
const MC_SAMPLES = 30000;
const MIN_PROB = 0.005;
const MAX_PAYOUT = 150;

// ---------------------------------------------------------------------------
// Generative model
// ---------------------------------------------------------------------------

function strikeMean(f, opp, round) {
  const fatigue = 1 - (round - 1) * 0.13 * (1 - f.stamina / 150);
  const base = 7 + 0.13 * f.speed + 0.09 * f.aggression - 0.06 * opp.defense;
  return Math.max(3, base * fatigue);
}

function koPerStrike(f, opp) {
  return 0.0055 *
    (0.4 + f.power / 90) *
    (1.55 - opp.chin / 105) *
    (1.1 - opp.defense / 250) *
    (0.9 + f.aggression / 500);
}

// Simulate one full fight. Returns a detailed outcome object.
// winner: 0 (A) | 1 (B); method: 'KO' | 'DEC'
export function simFight(A, B) {
  const F = [A, B];
  const kA = koPerStrike(A, B), kB = koPerStrike(B, A);
  const perRound = [];           // [ [strikesA, strikesB], ... ] landed per round
  let winner = -1, method = 'DEC', endRound = NUM_ROUNDS, endTime = DIST_TIME;

  for (let r = 1; r <= NUM_ROUNDS; r++) {
    const mA = strikeMean(A, B, r), mB = strikeMean(B, A, r);
    let sA = Math.max(0, Math.round(randNormal(mA, mA * 0.28)));
    let sB = Math.max(0, Math.round(randNormal(mB, mB * 0.28)));
    const pKoA = 1 - Math.pow(1 - kA, sA); // A knocks B out this round
    const pKoB = 1 - Math.pow(1 - kB, sB);
    const hitA = rand() < pKoA, hitB = rand() < pKoB;
    if (hitA || hitB) {
      const tA = hitA ? rand() * ROUND_SECS : Infinity;
      const tB = hitB ? rand() * ROUND_SECS : Infinity;
      winner = tA <= tB ? 0 : 1;
      method = 'KO';
      endRound = r;
      const t = Math.min(tA, tB);
      endTime = (r - 1) * ROUND_SECS + t;
      // truncate this round's strikes to the elapsed portion
      const frac = Math.max(0.08, t / ROUND_SECS);
      sA = Math.max(winner === 0 ? 1 : 0, Math.round(sA * frac));
      sB = Math.max(winner === 1 ? 1 : 0, Math.round(sB * frac));
      perRound.push([sA, sB]);
      break;
    }
    perRound.push([sA, sB]);
  }

  let strikesA = 0, strikesB = 0;
  for (const [a, b] of perRound) { strikesA += a; strikesB += b; }

  if (winner === -1) {
    const scoreA = strikesA + randNormal(0, 3) + (A.power - B.power) * 0.02;
    const scoreB = strikesB + randNormal(0, 3);
    winner = scoreA >= scoreB ? 0 : 1;
  }

  const flair = F[winner].flair;
  const fatality = method === 'KO' && rand() < (0.15 + 0.0045 * flair);

  return { winner, method, endRound, endTime, fatality, perRound, strikesA, strikesB, total: strikesA + strikesB };
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
    this.sRound = new Uint8Array(this.n);   // end round
    this.sFatal = new Uint8Array(this.n);
    this.sEnd = new Float32Array(this.n);   // endTime (game secs, DIST_TIME if decision)
    this.sTotal = new Uint16Array(this.n);  // total landed strikes

    const totals = new Uint16Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const o = simFight(A, B);
      this.sWinner[i] = o.winner;
      this.sKO[i] = o.method === 'KO' ? 1 : 0;
      this.sRound[i] = o.endRound;
      this.sFatal[i] = o.fatality ? 1 : 0;
      this.sEnd[i] = o.endTime;
      this.sTotal[i] = o.total;
      totals[i] = o.total;
    }
    totals.sort();
    this.strikeLine = totals[this.n >> 1] + 0.5;   // median + .5 => no pushes

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
      { id: 'DIST', side: 'C', label: 'GOES THE DISTANCE',
        pred: i => this.sKO[i] === 0, settle: o => o.method === 'DEC' },
      { id: 'FATAL', side: 'C', label: 'FATALITY FINISH',
        pred: i => this.sFatal[i] === 1, settle: o => o.fatality },
      { id: 'OVER', side: 'C', label: `STRIKES OVER ${L}`,
        pred: i => this.sTotal[i] > L, settle: o => o.total > L },
      { id: 'UNDER', side: 'C', label: `STRIKES UNDER ${L}`,
        pred: i => this.sTotal[i] < L, settle: o => o.total < L },
      { id: 'KO_R1', side: 'C', label: 'KO IN RD 1',
        pred: i => this.sKO[i] === 1 && this.sRound[i] === 1, settle: o => o.method === 'KO' && o.endRound === 1 },
      { id: 'KO_R2', side: 'C', label: 'KO IN RD 2',
        pred: i => this.sKO[i] === 1 && this.sRound[i] === 2, settle: o => o.method === 'KO' && o.endRound === 2 },
      { id: 'KO_R3', side: 'C', label: 'KO IN RD 3',
        pred: i => this.sKO[i] === 1 && this.sRound[i] === 3, settle: o => o.method === 'KO' && o.endRound === 3 },
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
  liveMarkets(t, currentRound) {
    const L = this.strikeLine;
    const roundEnd = currentRound * ROUND_SECS;
    const defs = [
      { id: 'L_A_WIN', side: 'A', label: `${this.A.name.split(' ')[0]} WINS`,
        pred: i => this.sWinner[i] === 0, settle: o => o.winner === 0 },
      { id: 'L_B_WIN', side: 'B', label: `${this.B.name.split(' ')[0]} WINS`,
        pred: i => this.sWinner[i] === 1, settle: o => o.winner === 1 },
      { id: 'L_KO_RD' + currentRound, side: 'C', label: `KO THIS ROUND (${currentRound})`,
        pred: i => this.sKO[i] === 1 && this.sEnd[i] <= roundEnd,
        settle: o => o.method === 'KO' && o.endRound === currentRound },
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
