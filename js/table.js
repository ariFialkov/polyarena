// Pregame betting table. Each corner (red / blue) gets a live 3D cutout of
// its fighter warming up (rendered by PortraitStudio into canvas.cutout),
// the big WIN zone and its method pockets; shared props run down the
// center under a live red-vs-blue money split. Zones show their pool and
// bettor count and carry heat / crowd / streak badges set by main.js.

import { el, fmtOdds, fmtMoney, randRange } from './util.js';
import { record } from './fighters.js';
import { shortName } from './hud.js';
import { sfx } from './audio.js';

export const CHIP_VALUES = [1, 5, 25, 100, 500];
export const CHIP_COLORS = { 1: '#8d9db6', 5: '#e0244f', 25: '#1fbf6a', 100: '#2b3a5c', 500: '#8e3cff' };

export class Table {
  constructor(root, callbacks) {
    this.root = root;
    this.cb = callbacks;          // { onPlayerBet(market, amount) -> bool }
    this.selectedChip = 25;
    this.zones = new Map();       // market.id -> zone record
    this.cut = {};                // side -> canvas
  }

  build(match) {
    this.match = match;
    this.root.innerHTML = '';
    this.zones.clear();
    const mk = id => match.market(id);
    const halfA = this.buildHalf(match.A, 'A', mk('A_WIN'), [mk('A_KO'), mk('A_DEC')]);
    const halfB = this.buildHalf(match.B, 'B', mk('B_WIN'), [mk('B_KO'), mk('B_DEC')]);

    const center = el('div', 'table-center side-C');
    center.append(el('div', 'center-title', 'PROP BETS'));
    const split = el('div', 'split');
    split.innerHTML = `<div class="split-nums"><span class="a">50%</span><span class="b">50%</span></div>
      <div class="split-bar"><div class="a" style="flex-grow:1"></div><div class="b" style="flex-grow:1"></div></div>
      <div class="split-cap">MONEY ON EACH CORNER</div>`;
    this.splitEl = split;
    center.append(split);
    for (const id of ['DIST', 'FATAL', 'OVER', 'UNDER', 'KO_R1', 'KO_R2', 'KO_R3']) {
      center.append(this.buildZone(mk(id), 'pocket pocket-center'));
    }
    this.root.append(halfA, center, halfB);
  }

  buildHalf(f, side, winMarket, props) {
    const half = el('div', `table-half side-${side}`);

    const wrap = el('div', 'cut-wrap');
    wrap.append(el('div', 'cut-bg'));
    wrap.append(el('div', 'cut-mark', shortName(f).toUpperCase()));
    const cv = el('canvas', 'cutout');
    this.cut[side] = cv;
    wrap.append(cv);
    wrap.append(el('div', 'corner-tag', side === 'A' ? 'RED CORNER' : 'BLUE CORNER'));
    const plate = el('div', 'fighter-plate');
    plate.append(el('div', 'fp-nick', shortName(f).toUpperCase()));
    plate.append(el('div', 'fp-name', f.name));
    plate.append(el('div', 'fp-meta', `${f.style} · ${record(f)} · ✦ ${f.special.name}`));
    const stats = el('div', 'fp-stats');
    for (const [k, lab] of [['power', 'PWR'], ['speed', 'SPD'], ['chin', 'CHIN'], ['defense', 'DEF']]) {
      const s = el('div', 'fp-stat');
      s.innerHTML = `<span>${lab}</span><i style="--v:${f[k]}%"></i>`;
      stats.append(s);
    }
    plate.append(stats);
    wrap.append(plate);
    half.append(wrap);

    const zones = el('div', 'zones');
    const win = this.buildZone(winMarket, 'zone-win', `${shortName(f).toUpperCase()} WINS`);
    zones.append(win);
    const pockets = el('div', 'pockets');
    for (const m of props) pockets.append(this.buildZone(m, 'pocket'));
    zones.append(pockets);
    half.append(zones);
    return half;
  }

  buildZone(market, cls, label) {
    const z = el('div', `bet-zone ${cls}`);
    z.dataset.market = market.id;
    const head = el('div', 'zone-head');
    head.append(el('div', 'zone-label', label || market.label));
    head.append(el('div', 'zone-prob', (market.prob * 100).toFixed(1) + '% chance'));
    z.append(head);
    z.append(el('div', 'zone-odds', fmtOdds(market.payout)));
    const pool = el('div', 'zone-pool');
    pool.innerHTML = '<span class="pv">$0</span><div class="bar"><i></i></div><span class="pn">0</span>';
    z.append(pool);
    const badges = el('div', 'badges');
    z.append(badges);
    const chips = el('div', 'chip-area');
    z.append(chips);
    z.addEventListener('click', () => this.tapZone(market, z));
    this.zones.set(market.id, {
      el: z, market, chips, badges,
      poolVal: pool.querySelector('.pv'), poolBar: pool.querySelector('.bar i'), poolN: pool.querySelector('.pn'),
      badgeKey: '',
    });
    return z;
  }

  tapZone(market, zoneEl) {
    if (this.locked) return;
    const amount = this.selectedChip;
    if (this.cb.onPlayerBet(market, amount)) {
      this.dropChip(market.id, amount, null);
      this.floatAmt(market.id, '+' + fmtMoney(amount), 'YOU');
      sfx.chip();
    }
  }

  // owner: null = player, else bot
  dropChip(id, amount, owner) {
    const z = this.zones.get(id);
    if (!z) return;
    const chip = el('div', 'chip');
    const color = owner ? owner.color : CHIP_COLORS[amount] || '#e0244f';
    chip.style.background = color;
    chip.style.setProperty('--cc', color);
    chip.textContent = owner ? owner.avatar : (amount >= 1000 ? '1k' : amount);
    chip.style.left = randRange(6, 80) + '%';
    chip.style.top = randRange(8, 62) + '%';
    chip.style.setProperty('--rot', randRange(-14, 14) + 'deg');
    if (owner) chip.title = `${owner.name}: ${fmtMoney(amount)}`;
    z.chips.append(chip);
    if (z.chips.children.length > 12) z.chips.removeChild(z.chips.firstChild);
    z.el.classList.remove('flash'); void z.el.offsetWidth; z.el.classList.add('flash');
  }

  floatAmt(id, text, who) {
    const z = this.zones.get(id);
    if (!z) return;
    const f = el('div', 'float-amt');
    f.innerHTML = `${text}<small>${who || ''}</small>`;
    f.style.left = randRange(35, 65) + '%';
    f.style.top = '30%';
    z.el.append(f);
    setTimeout(() => f.remove(), 1400);
  }

  setPool(id, pool, bettors, share) {
    const z = this.zones.get(id);
    if (!z) return;
    z.poolVal.textContent = fmtMoney(pool);
    z.poolN.textContent = bettors + (bettors === 1 ? ' bettor' : ' bettors');
    z.poolBar.style.width = Math.round(Math.min(1, share) * 100) + '%';
  }

  setBadges(id, list) {
    const z = this.zones.get(id);
    if (!z) return;
    const key = list.map(b => b.cls + b.text).join('|');
    if (key === z.badgeKey) return;
    z.badgeKey = key;
    z.badges.innerHTML = '';
    for (const b of list) z.badges.append(el('span', 'badge ' + b.cls, b.text));
    z.el.classList.toggle('is-hot', list.some(b => b.cls === 'hot'));
    z.el.classList.toggle('is-crowd', list.some(b => b.cls === 'crowd'));
  }

  setSplit(a, b) {
    const tot = a + b;
    const pa = tot ? a / tot : 0.5;
    this.splitEl.querySelector('.split-bar .a').style.flexGrow = Math.max(0.02, pa);
    this.splitEl.querySelector('.split-bar .b').style.flexGrow = Math.max(0.02, 1 - pa);
    this.splitEl.querySelector('.split-nums .a').textContent = Math.round(pa * 100) + '%';
    this.splitEl.querySelector('.split-nums .b').textContent = Math.round((1 - pa) * 100) + '%';
  }

  zoneEl(id) { const z = this.zones.get(id); return z && z.el; }

  clearPlayerChips() {
    for (const z of this.zones.values()) {
      z.chips.querySelectorAll('.chip').forEach(c => { if (!c.title) c.remove(); });
    }
  }

  setLocked(v) {
    this.locked = v;
    this.root.classList.toggle('locked', v);
  }
}

export function buildChipTray(root, table, callbacks) {
  root.innerHTML = '';
  const chips = el('div', 'tray-chips');
  for (const v of CHIP_VALUES) {
    const c = el('button', 'tray-chip', v >= 1000 ? '1k' : String(v));
    c.style.background = CHIP_COLORS[v];
    c.style.setProperty('--cc', CHIP_COLORS[v]);
    if (v === table.selectedChip) c.classList.add('sel');
    c.addEventListener('click', () => {
      table.selectedChip = v;
      chips.querySelectorAll('.tray-chip').forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
      sfx.tick();
      if (callbacks.onChip) callbacks.onChip(v);
    });
    chips.append(c);
  }
  root.append(chips);
  const actions = el('div', 'tray-actions');
  const undo = el('button', 'tray-btn', 'UNDO');
  undo.addEventListener('click', callbacks.onUndo);
  const clear = el('button', 'tray-btn', 'CLEAR');
  clear.addEventListener('click', callbacks.onClear);
  actions.append(undo, clear);
  root.append(actions);
}
