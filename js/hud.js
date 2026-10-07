// In-fight HUD: MK-style health bars with a lagging damage trail, neon round
// timer + pips, combo counter, special-move banners, live-prop huddles with
// odds-movement flashes, bet slip with cash-outs, toasts and announcements.

import { el, $, fmtOdds, fmtMoney, clamp } from './util.js';

export class Hud {
  constructor(cb) {
    this.cb = cb; // { onLiveBet(market), onCashout(bet) }
    this.hp = [$('#hpA'), $('#hpB')];
    this.fill = this.hp.map(h => h.querySelector('.hp-fill'));
    this.trail = this.hp.map(h => h.querySelector('.hp-trail'));
    this.bar = this.hp.map(h => h.querySelector('.hp-bar'));
    this.hpVal = [1, 1];
    this.clockEl = $('#clock');
    this.roundEl = $('#roundLabel');
    this.pips = [...document.querySelectorAll('#roundPips i')];
    this.bankEl = $('#bankroll');
    this.slipList = $('#slipList');
    this.slipCount = $('#slipCount');
    this.huddles = [$('#huddleL'), $('#huddleR')];
    this.toastBox = $('#toasts');
    this.announceEl = $('#announce');
    this.combo = [$('#comboA'), $('#comboB')];
    this.comboTimer = [0, 0];
    this.lastOdds = new Map();

    $('#slipToggle').addEventListener('click', () => $('#betslip').classList.toggle('open'));
  }

  setMatch(match) {
    this.match = match;
    this.hp[0].querySelector('.hp-name').textContent = shortName(match.A).toUpperCase();
    this.hp[1].querySelector('.hp-name').textContent = shortName(match.B).toUpperCase();
    this.hp[0].querySelector('.hp-sub').textContent = '✦ ' + match.A.special.name;
    this.hp[1].querySelector('.hp-sub').textContent = '✦ ' + match.B.special.name;
    this.lastOdds.clear();
    for (const i of [0, 1]) this.setHp(i, 1, true);
  }

  setHp(i, v, instant = false) {
    v = clamp(v, 0, 1);
    const dropped = v < this.hpVal[i] - 0.002;
    this.hpVal[i] = v;
    this.fill[i].style.transform = `scaleX(${v})`;
    this.fill[i].classList.toggle('mid', v <= 0.5 && v > 0.25);
    this.fill[i].classList.toggle('low', v <= 0.25);
    if (instant) {
      this.trail[i].style.transition = 'none';
      this.trail[i].style.transform = `scaleX(${v})`;
      void this.trail[i].offsetWidth;
      this.trail[i].style.transition = '';
    } else {
      this.trail[i].style.transform = `scaleX(${v})`;
    }
    if (dropped && !instant) {
      this.bar[i].classList.remove('hit'); void this.bar[i].offsetWidth; this.bar[i].classList.add('hit');
    }
  }

  setClock(secsLeft, round) {
    const s = Math.max(0, Math.ceil(secsLeft));
    this.clockEl.textContent = s;
    this.clockEl.classList.toggle('low', s <= 5 && round > 0);
    if (round) this.roundEl.textContent = 'ROUND ' + round;
    this.pips.forEach((p, i) => p.classList.toggle('on', i < round));
  }

  setBankroll(v, delta = 0) {
    this.bankEl.textContent = fmtMoney(v);
    if (delta) {
      this.bankEl.classList.remove('bump-up', 'bump-down');
      void this.bankEl.offsetWidth;
      this.bankEl.classList.add(delta > 0 ? 'bump-up' : 'bump-down');
    }
  }

  // ---- combo counter ----
  comboHit(side, n) {
    const c = this.combo[side];
    if (n < 2) return;
    c.innerHTML = `<b>${n}</b><span>HIT COMBO</span>`;
    c.classList.add('on');
    c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
    clearTimeout(this.comboTimer[side]);
    this.comboTimer[side] = setTimeout(() => c.classList.remove('on'), 1100);
  }

  specialBanner(side, name, who) {
    const box = $('#specialBanner');
    const s = el('div', 'sp-strip from-' + (side === 0 ? 'A' : 'B'));
    s.style.setProperty('--from', side === 0 ? '-100%' : '100%');
    s.innerHTML = `<div class="sp-name">${name.toUpperCase()}!</div><div class="sp-who">${who.toUpperCase()}</div>`;
    box.append(s);
    setTimeout(() => s.remove(), 1700);
  }

  // ---- live prop huddles ----
  renderLiveMarkets(markets, chipValue) {
    const side = { A: [], B: [], C: [] };
    for (const m of markets) side[m.side || 'C'].push(m);
    const half = Math.ceil(side.C.length / 2);
    this.fillHuddle(this.huddles[0], [...side.A, ...side.C.slice(0, half)], chipValue);
    this.fillHuddle(this.huddles[1], [...side.B, ...side.C.slice(half)], chipValue);
  }

  fillHuddle(box, markets, chipValue) {
    const seen = new Set();
    for (const m of markets) {
      seen.add(m.id);
      let btn = box.querySelector(`[data-mid="${m.id}"]`);
      if (!btn) {
        btn = el('button', 'live-prop side-' + (m.side || 'C'));
        btn.dataset.mid = m.id;
        btn.append(el('span', 'lp-label', m.label));
        btn.append(el('span', 'lp-odds', ''));
        btn.append(el('span', 'lp-stake', ''));
        btn.addEventListener('click', () => this.cb.onLiveBet(btn._m));
        box.append(btn);
      }
      btn._m = m;
      btn.querySelector('.lp-odds').textContent = fmtOdds(m.payout);
      btn.querySelector('.lp-stake').textContent = 'TAP · BET $' + chipValue;
      const prev = this.lastOdds.get(m.id);
      if (prev && Math.abs(prev - m.payout) > 0.04) {
        btn.classList.remove('up', 'down'); void btn.offsetWidth;
        btn.classList.add(m.payout > prev ? 'up' : 'down');
      }
      this.lastOdds.set(m.id, m.payout);
    }
    box.querySelectorAll('.live-prop').forEach(b => { if (!seen.has(b.dataset.mid)) b.remove(); });
  }

  flashLive(id) {
    const b = document.querySelector(`.live-prop[data-mid="${id}"]`);
    if (!b) return null;
    b.classList.remove('botbet'); void b.offsetWidth; b.classList.add('botbet');
    return b;
  }

  clearHuddles() {
    this.huddles.forEach(h => (h.innerHTML = ''));
    this.lastOdds.clear();
  }

  // ---- bet slip ----
  renderSlip(bets, liveValues) {
    this.slipCount.textContent = bets.length;
    const prevVals = this.prevCash || new Map();
    this.prevCash = new Map();
    this.slipList.innerHTML = '';
    if (!bets.length) {
      this.slipList.append(el('div', 'slip-empty', 'No bets yet — tap a zone to play'));
      return;
    }
    for (const bet of bets) {
      const row = el('div', 'slip-row' + (bet.status !== 'open' ? ' ' + bet.status : ''));
      const main = el('div', 'slip-main');
      main.append(el('div', 'slip-label', bet.label));
      main.append(el('div', 'slip-stake', `${fmtMoney(bet.stake)} @ ${fmtOdds(bet.payout)} → ${fmtMoney(bet.stake * bet.payout)}`));
      row.append(main);
      if (bet.status === 'open' && liveValues && liveValues.has(bet)) {
        const v = liveValues.get(bet);
        const btn = el('button', 'cashout-btn', `CASH ${fmtMoney(v)}`);
        if (v <= 0) btn.disabled = true;
        if (prevVals.has(bet) && v > prevVals.get(bet) + 0.5) btn.classList.add('up');
        this.prevCash.set(bet, v);
        btn.addEventListener('click', () => this.cb.onCashout(bet));
        row.append(btn);
      } else if (bet.status === 'won') {
        row.append(el('div', 'slip-result win', '+' + fmtMoney(bet.stake * bet.payout)));
      } else if (bet.status === 'lost') {
        row.append(el('div', 'slip-result loss', 'LOST'));
      } else if (bet.status === 'cashed') {
        row.append(el('div', 'slip-result cashed', 'CASHED ' + fmtMoney(bet.cashed)));
      }
      this.slipList.append(row);
    }
  }

  // ---- toasts ----
  toast(html, cls = '', color) {
    const t = el('div', 'toast ' + cls);
    if (color) t.style.setProperty('--c', color);
    t.innerHTML = html;
    this.toastBox.append(t);
    while (this.toastBox.children.length > 4) this.toastBox.removeChild(this.toastBox.firstChild);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3600);
  }

  botToast(bot, text) {
    this.toast(`<span class="t-avatar" style="--c:${bot.color}">${bot.avatar}</span><span><b>${bot.name}</b> ${text}</span>`, 'bot-toast', bot.color);
  }

  // ---- big center announcements ----
  announce(text, cls = '', holdMs = 1600, sub = '') {
    const a = el('div', 'announce-text ' + cls);
    a.textContent = text;
    if (sub) a.append(el('small', '', sub));
    this.announceEl.append(a);
    setTimeout(() => { a.classList.add('out'); setTimeout(() => a.remove(), 600); }, holdMs);
  }
}

export function shortName(f) {
  const nick = f.name.split('"')[1];
  return nick || f.name.split(' ')[0];
}
