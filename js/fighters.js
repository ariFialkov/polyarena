// Fighter bank: pop-culture parody caricatures (names changed, resemblance
// intentionally stylized). Stats are 0-100 and feed the generative model:
//   power/speed/defense/chin/stamina/aggression/flair (fatality odds).
// `look` drives the character rig (js/charrig.js); `trunks` is the portrait
// color and `accent` colors that fighter's special VFX. `model` names an
// imported rigged GLB in assets/models/ (falls back to the procedural rig).

import { pick, randInt } from './util.js';

export const FIGHTERS = [
  {
    id: 'thump', model: 'the_don', name: 'Donnie "The Don" Thump', origin: 'The Golden Tower', style: 'Executive Orders',
    special: { kind: 'fireball', name: "You're Fired!" },
    skin: '#f0a060', trunks: '#16305e', accent: '#ff7020', hair: '#f5d76a',
    power: 72, speed: 45, defense: 52, chin: 74, stamina: 48, aggression: 88, flair: 85,
    look: { skin: '#f0a060', hairColor: '#f5d76a', hair: 'combover', brows: 'angry', browColor: '#d8b850', jaw: 0.06,
      outfit: 'suit', top: '#16305e', bottom: '#14284e', shoe: '#1a1a20', shirt: '#f2f2f4', tieColor: '#d42030',
      h: 1.04, belly: 0.28 },
  },
  {
    id: 'zoltan', model: 'ibra', name: 'Zoltan "Ibra" Kadabra', origin: 'Malmö', style: 'Bendy-Kick Taekwondo',
    special: { kind: 'flyingkick', name: 'Ibra Volley' },
    skin: '#dfb691', trunks: '#ffd327', accent: '#ffd000', hair: '#241a12',
    power: 84, speed: 82, defense: 58, chin: 70, stamina: 76, aggression: 82, flair: 88,
    look: { skin: '#dfb691', hairColor: '#241a12', hair: 'ponytail', facial: 'fullbeard', nose: 1.55,
      outfit: 'jersey', number: '10', top: '#ffd327', bottom: '#1c4a9c', sock: '#ffd327', shoe: '#e8e8ee',
      h: 1.12, bulk: 1.02 },
  },
  {
    id: 'boulder', name: 'Duane "The Boulder" Rockson', origin: 'Hollywood', style: 'Heavyweight Charisma',
    special: { kind: 'shockwave', name: 'Boulder Bomb' },
    skin: '#7a5236', trunks: '#23262e', accent: '#e8a040', hair: '#241a10',
    power: 96, speed: 58, defense: 64, chin: 92, stamina: 70, aggression: 76, flair: 62,
    look: { skin: '#7a5236', hairColor: '#241a10', hair: 'bald', brows: 'raised', facial: 'goatee',
      outfit: 'bare', bottom: '#23262e', shoe: '#14161c',
      h: 1.15, bulk: 1.32, shoulders: 1.18 },
  },
  {
    id: 'skyles', name: 'Simone "Twist" Skyles', origin: 'Columbus', style: 'G.O.A.T. Gymnastics-Fu',
    special: { kind: 'flyingkick', name: 'Quad Twist' },
    skin: '#8a5a3c', trunks: '#6a1fd0', accent: '#c9a2ff', hair: '#181008',
    power: 56, speed: 98, defense: 74, chin: 56, stamina: 94, aggression: 58, flair: 92,
    look: { skin: '#8a5a3c', hairColor: '#181008', hair: 'bun',
      outfit: 'leotard', top: '#6a1fd0', trim: '#e8c040', bottom: '#6a1fd0', shoe: '#f0f0f2',
      h: 0.86, bulk: 0.92 },
  },
  {
    id: 'quinton', model: 'madam', name: 'Hillary "Madam" Quinton', origin: 'Chappaqua', style: 'Filibuster-Fu',
    special: { kind: 'teleport', name: 'Redacted Rush' },
    skin: '#f0cdb2', trunks: '#2a5a9c', accent: '#7ab8ff', hair: '#e8d28a',
    power: 54, speed: 56, defense: 90, chin: 76, stamina: 72, aggression: 52, flair: 45,
    look: { skin: '#f0cdb2', hairColor: '#e8d28a', hair: 'bob',
      outfit: 'pantsuit', top: '#2a5a9c', bottom: '#24507e', shoe: '#1a1a20', shirt: '#f2f2f4',
      extras: ['pearls'], h: 0.98 },
  },
  {
    id: 'sai', model: 'oppa', name: 'Sai "Oppa" Park', origin: 'Gangnam District', style: 'Invisible-Horse Style',
    special: { kind: 'shockwave', name: 'Pony Stomp' },
    skin: '#eac094', trunks: '#14161c', accent: '#40c8ff', hair: '#14100e',
    power: 64, speed: 76, defense: 58, chin: 66, stamina: 84, aggression: 70, flair: 80,
    look: { skin: '#eac094', hairColor: '#14100e', hair: 'flat',
      outfit: 'suit', top: '#14161c', bottom: '#101218', shoe: '#0c0c12', shirt: '#f2f2f4',
      extras: ['sunglasses', 'bowtie'], h: 0.97, belly: 0.16 },
  },
  {
    id: 'spice', model: 'frost', name: 'CiCi "Frost" Spice', origin: 'The Bronx', style: 'Drill Flow',
    special: { kind: 'fireball', name: 'Cold Bars' },
    skin: '#9c6844', trunks: '#8ae0ff', accent: '#8ae0ff', hair: '#c05a28',
    power: 52, speed: 86, defense: 56, chin: 52, stamina: 78, aggression: 74, flair: 82,
    look: { skin: '#9c6844', hairColor: '#c05a28', hair: 'afro',
      outfit: 'crop', top: '#8ae0ff', bottom: '#2a2e40', shoe: '#f0f0f2',
      extras: ['chain'], h: 0.9 },
  },
  {
    id: 'summons', name: 'Gene "The Demon" Summons', origin: 'Rock City', style: 'Shock-Rock Kabuki',
    special: { kind: 'fireball', name: 'Blood Spit' },
    skin: '#e0c0a8', trunks: '#14141c', accent: '#ff2030', hair: '#0c0a10',
    power: 78, speed: 54, defense: 62, chin: 82, stamina: 58, aggression: 84, flair: 98,
    look: { skin: '#e0c0a8', hairColor: '#0c0a10', hair: 'long', brows: 'angry', browColor: '#0c0a10',
      facepaint: 'demon', outfit: 'demon', top: '#14141c', bottom: '#14141c', shoe: '#2a2e3a',
      extras: ['tongue'], h: 1.06, bulk: 1.05 },
  },
  {
    id: 'blownapart', model: 'le_petit', name: 'Napoleon "Le Petit" Blownapart', origin: 'Corsica', style: 'Grande Armée Fisticuffs',
    special: { kind: 'shockwave', name: 'Cannonade' },
    skin: '#e8c49e', trunks: '#1c2c5e', accent: '#ffcf50', hair: '#2c2018',
    power: 66, speed: 62, defense: 84, chin: 74, stamina: 66, aggression: 90, flair: 55,
    look: { skin: '#e8c49e', hairColor: '#2c2018', hair: 'cap', brows: 'angry',
      outfit: 'military', top: '#1c2c5e', panel: '#e8e2d0', bottom: '#e8e2d0', shoe: '#1a1a20',
      extras: ['bicorne', 'epaulettes'], h: 0.84, belly: 0.12 },
  },
  {
    id: 'chaotic', name: 'Joe "Tiger King" Chaotic', origin: 'Wynnewood', style: 'Big-Cat Brawling',
    special: { kind: 'flyingkick', name: 'Tiger Pounce' },
    skin: '#e0b090', trunks: '#d86a18', accent: '#ff9020', hair: '#e8c86a',
    power: 58, speed: 66, defense: 46, chin: 64, stamina: 62, aggression: 94, flair: 90,
    look: { skin: '#e0b090', hairColor: '#e8c86a', hair: 'mullet', facial: 'handlebar', facialColor: '#d8b85a',
      outfit: 'tee', logo: '🐯', top: '#d86a18', bottom: '#3a3226', shoe: '#2a241c',
      h: 1.0 },
  },
  {
    id: 'slamsey', model: 'chef', name: 'Gordon "Chef" Slamsey', origin: 'London', style: 'Kitchen Nightmare-Fu',
    special: { kind: 'fireball', name: "It's RAW!" },
    skin: '#ecbfa2', trunks: '#f0f0f2', accent: '#ff6020', hair: '#e8d8b0',
    power: 74, speed: 64, defense: 56, chin: 72, stamina: 66, aggression: 96, flair: 72,
    look: { skin: '#ecbfa2', hairColor: '#e8d8b0', hair: 'cap', brows: 'angry', browColor: '#c8a878', jaw: 0.08,
      outfit: 'chef', top: '#f0f0f2', bottom: '#202126', shoe: '#16161c',
      h: 1.05 },
  },
  {
    id: 'wolfgang', model: 'amadeus', name: 'Wolfgang "Amadeus" Beatdown', origin: 'Salzburg', style: 'Rondo alla Smacka',
    special: { kind: 'teleport', name: 'Allegro Step' },
    skin: '#f2d8c0', trunks: '#a02030', accent: '#ffb8e8', hair: '#ece8e2',
    power: 48, speed: 90, defense: 68, chin: 54, stamina: 74, aggression: 48, flair: 86,
    look: { skin: '#f2d8c0', hairColor: '#ece8e2', hair: 'wig',
      outfit: 'frock', top: '#a02030', panel: '#e8d8b8', bottom: '#e8e2d4', shoe: '#2a2024',
      extras: ['cravat'], h: 0.96 },
  },
  {
    id: 'teslash', model: 'ac', name: 'Nikola "AC" Teslash', origin: 'Smiljan', style: 'Alternating Current Arts',
    special: { kind: 'fireball', name: 'Coil Discharge' },
    skin: '#e6c8ae', trunks: '#23252e', accent: '#70e8ff', hair: '#17130f',
    power: 72, speed: 72, defense: 66, chin: 56, stamina: 74, aggression: 56, flair: 76,
    look: { skin: '#e6c8ae', hairColor: '#17130f', hair: 'cap', facial: 'mustache',
      outfit: 'suit', top: '#23252e', bottom: '#1c1e26', shoe: '#14141a', shirt: '#f2f2f4', tieColor: '#3a3e4c',
      h: 1.1, bulk: 0.85 },
  },
  {
    id: 'tusk', model: 'technoking', name: 'Melon "Technoking" Tusk', origin: 'Boca Chica', style: 'Meme-Jitsu',
    special: { kind: 'fireball', name: 'Mars Shot' },
    skin: '#ecc4a4', trunks: '#17181e', accent: '#ff5030', hair: '#4a3524',
    power: 60, speed: 62, defense: 60, chin: 64, stamina: 86, aggression: 74, flair: 80,
    look: { skin: '#ecc4a4', hairColor: '#4a3524', hair: 'cap', jaw: 0.05,
      outfit: 'tee', logo: 'X', logoColor: '#f2f2f4', top: '#17181e', bottom: '#2a3444', shoe: '#3a3e46',
      h: 1.03, belly: 0.12 },
  },
  {
    id: 'odysseus', name: 'Odysseus "Nobody" of Ithaca', origin: 'Ithaca', style: 'Polymetis Pankration',
    special: { kind: 'teleport', name: 'Trojan Trick' },
    skin: '#caa06c', trunks: '#c09040', accent: '#e8b040', hair: '#2e2014',
    power: 78, speed: 70, defense: 80, chin: 78, stamina: 82, aggression: 64, flair: 68,
    look: { skin: '#caa06c', hairColor: '#2e2014', hair: 'cap', facial: 'fullbeard',
      outfit: 'armor', top: '#b08034', bottom: '#7a5a2c', shoe: '#5a4224',
      extras: ['helm', 'cape'], h: 1.05, bulk: 1.08 },
  },
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
