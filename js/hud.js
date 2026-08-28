// In-fight HUD: HP bars / clock / round, live-prop huddles on each flank,
// collapsible bet slip with cash-outs, bot activity toasts, big announcements.

import { el, $, fmtOdds, fmtMoney, fmtClock, clamp } from './util.js';

export class Hud {
  constructor(cb) {
    this.cb = cb; // { onLiveBet(market), onCashout(bet) }
    this.hpEls = [$('#hpA .hp-fill'), $('#hpB .hp-fill')];
    this.hpShown = [1, 1];
    this.hpTarget = [1, 1];
    this.nameEls = [$('#hpA .hp-name'), $('#hpB .hp-name')];
    this.clockEl = $('#clock');
    this.roundEl = $('#roundLabel');
    this.bankEl = $('#bankroll');
    this.slipList = $('#slipList');
    this.slipCount = $('#slipCount');
    this.huddles = [$('#huddleL'), $('#huddleR')];
    this.toastBox = $('#toasts');
    this.announceEl = $('#announce');

    $('#slipToggle').addEventListener('click', () => {
      $('#betslip').classList.toggle('open');
    });
  }

  setMatch(match) {
    this.match = match;
    this.nameEls[0].textContent = shortName(match.A);
    this.nameEls[1].textContent = shortName(match.B);
    this.hpShown = [1, 1];
    this.hpTarget = [1, 1];
    this.hpEls[0].style.transform = 'scaleX(1)';
    this.hpEls[1].style.transform = 'scaleX(1)';
  }

  setHp(i, v) { this.hpTarget[i] = clamp(v, 0, 1); }

  tick(dt) {
    for (let i = 0; i < 2; i++) {
      const d = this.hpTarget[i] - this.hpShown[i];
      if (Math.abs(d) > 0.0005) {
        this.hpShown[i] += d * Math.min(1, dt * 5);
        const v = this.hpShown[i];
        this.hpEls[i].style.transform = `scaleX(${v})`;
        this.hpEls[i].style.background = v > 0.5
          ? 'linear-gradient(90deg,#37e08b,#8cf0b8)'
          : v > 0.25 ? 'linear-gradient(90deg,#ffd75e,#ffb84d)' : 'linear-gradient(90deg,#ff5a3c,#ff8266)';
      }
    }
  }

  setClock(gameSecsLeft, round) {
    this.clockEl.textContent = fmtClock(gameSecsLeft);
    this.roundEl.textContent = round ? `RD ${round}` : '';
  }

  setBankroll(v, delta = 0) {
    this.bankEl.textContent = fmtMoney(v);
    if (delta) {
      this.bankEl.classList.remove('bump-up', 'bump-down');
      void this.bankEl.offsetWidth;
      this.bankEl.classList.add(delta > 0 ? 'bump-up' : 'bump-down');
    }
  }

  // ---- live prop huddles ----
  renderLiveMarkets(markets, chipValue) {
    const side = { A: [], B: [], C: [] };
    for (const m of markets) side[m.side || 'C'].push(m);
    const left = [...side.A, ...side.C.slice(0, Math.ceil(side.C.length / 2))];
    const right = [...side.B, ...side.C.slice(Math.ceil(side.C.length / 2))];
    this.fillHuddle(this.huddles[0], left, chipValue);
    this.fillHuddle(this.huddles[1], right, chipValue);
  }

  fillHuddle(box, markets, chipValue) {
    // update in place where possible to avoid tap-eating rebuilds
    const seen = new Set();
    for (const m of markets) {
      seen.add(m.id);
      let btn = box.querySelector(`[data-mid="${m.id}"]`);
      if (!btn) {
        btn = el('button', 'live-prop');
        btn.dataset.mid = m.id;
        btn.append(el('span', 'lp-label', m.label));
        btn.append(el('span', 'lp-odds', ''));
        btn.addEventListener('click', () => this.cb.onLiveBet(btn._m));
        box.append(btn);
      }
      btn._m = m;
      btn.querySelector('.lp-odds').textContent = fmtOdds(m.payout) + ' · bet $' + chipValue;
    }
    box.querySelectorAll('.live-prop').forEach(b => { if (!seen.has(b.dataset.mid)) b.remove(); });
  }

  clearHuddles() {
    this.huddles.forEach(h => (h.innerHTML = ''));
  }

  // ---- bet slip ----
  renderSlip(bets, liveValues) {
    this.slipCount.textContent = bets.length;
    this.slipList.innerHTML = '';
    if (!bets.length) {
      this.slipList.append(el('div', 'slip-empty', 'No bets yet'));
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
        const btn = el('button', 'cashout-btn', `CASH OUT ${fmtMoney(v)}`);
        if (v <= 0) btn.disabled = true;
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

  // ---- toasts (bot + player activity) ----
  toast(html, cls = '') {
    const t = el('div', 'toast ' + cls);
    t.innerHTML = html;
    this.toastBox.append(t);
    while (this.toastBox.children.length > 4) this.toastBox.removeChild(this.toastBox.firstChild);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3800);
  }

  botToast(bot, text) {
    this.toast(
      `<span class="t-avatar" style="background:${bot.color}">${bot.avatar}</span><b>${bot.name}</b> ${text}`,
      'bot-toast'
    );
  }

  // ---- big center announcements ----
  announce(text, cls = '', holdMs = 1600) {
    const a = el('div', 'announce-text ' + cls, text);
    this.announceEl.append(a);
    setTimeout(() => { a.classList.add('out'); setTimeout(() => a.remove(), 600); }, holdMs);
  }
}

export function shortName(f) {
  const nick = f.name.split('"')[1];
  return nick || f.name.split(' ')[0];
}
