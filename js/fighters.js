// Fighter bank. Stats are 0-100 and feed the generative fight model:
//   power  - chance a landed strike hurts/KOs
//   speed  - strike output rate
//   defense- reduces opponent's landed strikes
//   chin   - resistance to being KO'd
//   stamina- late-round output retention
//   aggression - strike output + slight KO risk taken
//   flair  - chance a KO win becomes a Fatality

import { pick, randInt } from './util.js';

export const FIGHTERS = [
  { id: 'volkov',  name: 'Yuri "Iron Bear" Volkov',   origin: 'Siberia',        style: 'Iron Bear Kuen',   special: { kind: 'shockwave', name: 'Seismic Maul' },        skin: '#e8b98c', trunks: '#b3202a', accent: '#ff5a5a', hair: '#3a2a1a', power: 92, speed: 55, defense: 62, chin: 88, stamina: 70, aggression: 74, flair: 40 },
  { id: 'reyes',   name: 'Lola "La Vibora" Reyes',    origin: 'Mexico City',    style: 'Viper Fang',       special: { kind: 'flyingkick', name: 'Viper Lash' },       skin: '#c98e63', trunks: '#0f8a4e', accent: '#37e08b', hair: '#191211', power: 66, speed: 90, defense: 78, chin: 58, stamina: 82, aggression: 68, flair: 55 },
  { id: 'okafor',  name: 'Dez "Thunderclap" Okafor',  origin: 'Lagos',          style: 'Thunder Fist',     special: { kind: 'fireball', name: 'Storm Orb' },   skin: '#6d4530', trunks: '#f2b200', accent: '#ffd75e', hair: '#120d0a', power: 84, speed: 76, defense: 55, chin: 66, stamina: 60, aggression: 90, flair: 72 },
  { id: 'tanaka',  name: 'Kenji "Ghostblade" Tanaka', origin: 'Osaka',          style: 'Ghostblade-ryu',   special: { kind: 'teleport', name: 'Shadow Step' },       skin: '#ecc9a5', trunks: '#2b3aa0', accent: '#6f7dff', hair: '#14141c', power: 70, speed: 88, defense: 84, chin: 60, stamina: 76, aggression: 55, flair: 80 },
  { id: 'brick',   name: 'Marge "The Brick" Malone',  origin: 'Boston',         style: 'Wrecking Style',   special: { kind: 'shockwave', name: 'Demolition Drop' },      skin: '#f0c9b2', trunks: '#5a2d82', accent: '#b070ff', hair: '#b0492c', power: 88, speed: 50, defense: 48, chin: 92, stamina: 66, aggression: 86, flair: 35 },
  { id: 'santos',  name: 'Rafa "O Fantasma" Santos',  origin: 'Rio de Janeiro', style: 'Capoeira Fantasma', special: { kind: 'flyingkick', name: 'Phantom Cyclone' },     skin: '#a5714b', trunks: '#e86a10', accent: '#ffab60', hair: '#241a12', power: 62, speed: 94, defense: 72, chin: 55, stamina: 88, aggression: 62, flair: 90 },
  { id: 'stone',   name: 'Aria "Coldsnap" Stone',     origin: 'Reykjavik',      style: 'Frost Counter',    special: { kind: 'fireball', name: 'Coldsnap Orb' },skin: '#f3d9c2', trunks: '#0e7f8c', accent: '#4fd8e8', hair: '#e8e2d6', power: 74, speed: 72, defense: 92, chin: 70, stamina: 80, aggression: 42, flair: 60 },
  { id: 'khan',    name: 'Zafir "Warhammer" Khan',    origin: 'Karachi',        style: 'Warhammer Thai',   special: { kind: 'fireball', name: 'Hellfire Blast' },    skin: '#b98858', trunks: '#8c1030', accent: '#ff4070', hair: '#171310', power: 90, speed: 68, defense: 58, chin: 74, stamina: 72, aggression: 82, flair: 50 },
  { id: 'dubois',  name: 'Colette "Guillotine" Dubois', origin: 'Marseille',    style: 'Savate Guillotine', special: { kind: 'teleport', name: 'Blade Waltz' },       skin: '#e6b492', trunks: '#1f2430', accent: '#9aa7c7', hair: '#2c1e33', power: 68, speed: 84, defense: 76, chin: 62, stamina: 84, aggression: 58, flair: 76 },
  { id: 'grizz',   name: 'Otto "Grizzly" Berg',       origin: 'Bavaria',        style: 'Grizzly Grapple',  special: { kind: 'shockwave', name: 'Avalanche Slam' },    skin: '#eab88f', trunks: '#4a3418', accent: '#c89b50', hair: '#6b4a24', power: 80, speed: 48, defense: 66, chin: 86, stamina: 58, aggression: 76, flair: 30 },
  { id: 'nyx',     name: 'Petra "Nyx" Kovacs',        origin: 'Budapest',       style: 'Nyx Shadow Arts',  special: { kind: 'teleport', name: 'Void Step' },  skin: '#d9a880', trunks: '#101018', accent: '#e04fff', hair: '#0c0c14', power: 76, speed: 86, defense: 64, chin: 52, stamina: 74, aggression: 78, flair: 95 },
  { id: 'moana',   name: 'Sione "Tsunami" Moana',     origin: 'Nukuʻalofa',     style: 'Tsunami Slugger',  special: { kind: 'shockwave', name: 'Tidal Crush' },      skin: '#8a5c38', trunks: '#0a5a9c', accent: '#5ab4ff', hair: '#100c08', power: 94, speed: 45, defense: 50, chin: 84, stamina: 55, aggression: 92, flair: 45 },
];

let lastPair = [];

// Pick two distinct fighters, avoiding an immediate rematch.
export function pickMatchup() {
  let a, b, guard = 0;
  do {
    a = pick(FIGHTERS);
    b = pick(FIGHTERS);
    guard++;
  } while ((a === b || (lastPair.includes(a.id) && lastPair.includes(b.id))) && guard < 50);
  if (a === b) b = FIGHTERS[(FIGHTERS.indexOf(a) + 1) % FIGHTERS.length];
  lastPair = [a.id, b.id];
  return [a, b];
}

export function record(f) {
  // Cosmetic W-L record, stable per session per fighter.
  if (!f._rec) {
    const w = randInt(9, 31), l = randInt(0, 9);
    f._rec = `${w}-${l} (${randInt(Math.floor(w / 3), w)} KO)`;
  }
  return f._rec;
}
