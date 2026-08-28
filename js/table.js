// Pregame betting table — the "digital craps table" screen.
// Two felt halves (fighter A / fighter B) with a big WIN zone each and prop
// pockets, plus a shared center strip. Player picks a chip denomination and
// taps zones to stack chips; bots' chips appear in their colors.

import { el, $, fmtOdds, fmtMoney, rand, randRange } from './util.js';
import { record } from './fighters.js';
import { sfx } from './audio.js';

export const CHIP_VALUES = [1, 5, 25, 100, 500];
const CHIP_COLORS = { 1: '#8d9db6', 5: '#c0392b', 25: '#27ae60', 100: '#2c3e50', 500: '#8e44ad' };

export class Table {
  constructor(root, callbacks) {
    this.root = root;             // #table
    this.cb = callbacks;          // { onPlayerBet(market, amount) -> bool }
    this.selectedChip = 25;
    this.zones = new Map();       // market.id -> zone element
  }

  // (Re)build the table for a match.
  build(match) {
    this.match = match;
    this.root.innerHTML = '';
    this.zones.clear();

    const mk = id => match.market(id);
    const halfA = this.buildHalf(match.A, 'A', mk('A_WIN'), [mk('A_KO'), mk('A_DEC')]);
    const halfB = this.buildHalf(match.B, 'B', mk('B_WIN'), [mk('B_KO'), mk('B_DEC')]);

    const center = el('div', 'table-center');
    center.append(el('div', 'center-title', 'PROPS'));
    for (const id of ['DIST', 'FATAL', 'OVER', 'UNDER', 'KO_R1', 'KO_R2', 'KO_R3']) {
      center.append(this.buildPocket(mk(id), 'pocket-center'));
    }

    this.root.append(halfA, center, halfB);
  }

  buildHalf(fighter, side, winMarket, props) {
    const half = el('div', `table-half side-${side}`);
    half.style.setProperty('--felt', side === 'A' ? '#7c1f28' : '#1c3a6e');
    half.style.setProperty('--felt-edge', side === 'A' ? '#5a141b' : '#122a52');

    const card = el('div', 'fighter-card');
    const portrait = el('div', 'portrait');
    portrait.style.background = `linear-gradient(160deg, ${fighter.accent}, ${fighter.trunks})`;
    portrait.textContent = fighter.name.split('"')[1] ? fighter.name.split('"')[1][0] : fighter.name[0];
    card.append(portrait);
    const info = el('div', 'fighter-info');
    info.append(el('div', 'fighter-name', fighter.name));
    info.append(el('div', 'fighter-sub', `${fighter.style} · ${fighter.origin} · ${record(fighter)}`));
    card.append(info);
    half.append(card);

    const win = this.buildZone(winMarket, 'zone-win');
    win.prepend(el('div', 'zone-fighter', fighter.name.split('"')[1] || fighter.name.split(' ')[0]));
    half.append(win);

    const pockets = el('div', 'pockets');
    for (const m of props) pockets.append(this.buildPocket(m, 'pocket-side'));
    half.append(pockets);
    return half;
  }

  buildZone(market, cls) {
    const z = el('div', `bet-zone ${cls}`);
    z.dataset.market = market.id;
    z.append(el('div', 'zone-label', market.label));
    z.append(el('div', 'zone-odds', fmtOdds(market.payout)));
    z.append(el('div', 'zone-prob', (market.prob * 100).toFixed(1) + '%'));
    const chips = el('div', 'chip-area');
    z.append(chips);
    z.addEventListener('click', () => this.tapZone(market, z));
    this.zones.set(market.id, z);
    return z;
  }

  buildPocket(market, cls) {
    const z = this.buildZone(market, `pocket ${cls}`);
    return z;
  }

  tapZone(market, zoneEl) {
    if (this.locked) return;
    const amount = this.selectedChip;
    if (this.cb.onPlayerBet(market, amount)) {
      this.dropChip(zoneEl, amount, null);
      sfx.chip();
    }
  }

  // owner: null = player, else bot object
  dropChip(zoneEl, amount, owner) {
    const area = zoneEl.querySelector('.chip-area');
    const chip = el('div', 'chip' + (owner ? ' bot-chip' : ' player-chip'));
    chip.style.background = owner ? owner.color : CHIP_COLORS[amount] || '#c0392b';
    chip.textContent = owner ? owner.avatar : (amount >= 1000 ? '1k' : amount);
    chip.style.left = randRange(8, 72) + '%';
    chip.style.top = randRange(10, 60) + '%';
    chip.style.setProperty('--rot', randRange(-14, 14) + 'deg');
    if (owner) chip.title = `${owner.name}: ${fmtMoney(amount)}`;
    area.append(chip);
    // cap DOM chips per zone
    if (area.children.length > 14) area.removeChild(area.firstChild);
  }

  botBet(market, amount, bot) {
    const z = this.zones.get(market.id);
    if (z) this.dropChip(z, amount, bot);
  }

  clearPlayerChips() {
    this.root.querySelectorAll('.chip.player-chip').forEach(c => c.remove());
  }

  setLocked(v) {
    this.locked = v;
    this.root.classList.toggle('locked', v);
  }
}

// Chip tray (denomination picker) — lives outside the table so it can overlay.
export function buildChipTray(root, table, callbacks) {
  root.innerHTML = '';
  const chips = el('div', 'tray-chips');
  for (const v of CHIP_VALUES) {
    const c = el('button', 'tray-chip', v >= 1000 ? '1k' : String(v));
    c.style.background = CHIP_COLORS[v];
    if (v === table.selectedChip) c.classList.add('sel');
    c.addEventListener('click', () => {
      table.selectedChip = v;
      chips.querySelectorAll('.tray-chip').forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
      sfx.tick();
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
