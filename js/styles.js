// Fighting styles: which Mixamo clips (js/anim.js library) each fighter uses.
//
// The choreography (js/sim.js) only says "a punch / an elbow / a kick / a
// sweep / the finisher lands at t"; a style kit turns that into a fighter's
// signature move set so every character moves recognisably:
//
//   idle      fight stance loop          lobby     lobby stance (default idle)
//   fast      jabs / quick shots         power     heavy hands, elbows, knees
//   kick      kicks                      sweep     low sweeps
//   finisher  the KO blow ('takedown' = grappling KO with the victim's fall)
//   kickBias  chance a scripted kick stays a kick (else it becomes power)
//   kickLove  chance a scripted hand strike becomes a kick
//   block     guard clips (blocked strikes)    dodge  evasions
//   special   { clip, from } signature special motion (fireball release,
//             flying-kick impact, slam, or the teleport strike)
//   taunt / intro / victory / warmup: personality clips

import { rand, pick } from './util.js';
import { clipMeta } from './anim.js';

const K = {
  // Donnie "The Don" Thump: wide-stance showman. Short jabs to the body,
  // big looping haymakers, almost never kicks; points his fireball.
  thump: {
    idle: 'idle_proud',
    fast: ['body_jab', 'chest_jabs', 'jab'],
    power: ['haymaker', 'haymaker2', 'overhand', 'lunge_overhand'],
    kick: ['kick_low'], kickBias: 0.15,
    sweep: [],
    finisher: ['haymaker', 'overhand'],
    block: ['block_cover', 'block_high'], dodge: ['dodge_lean'],
    special: { clip: 'cast_push' },
    taunt: ['emote_point', 'emote_angry'], intro: 'emote_point',
    victory: ['emote_come_on', 'emote_point'],
    warmup: ['emote_arm_stretch', 'emote_point', 'emote_angry'],
  },
  // Zoltan "Ibra": kick-first taekwondo with a footballer's header.
  zoltan: {
    idle: 'idle_kickboxer',
    fast: ['jab', 'jab_fast', 'kick_snap'],
    power: ['headbutt', 'kick_crescent', 'cross'],
    kick: ['kick_high', 'kick_round', 'kick_spin_hook', 'kick_high2', 'kick_lead', 'kick_jump_high'],
    kickBias: 1, kickLove: 0.4,
    sweep: ['sweep_spin'],
    finisher: ['kick_high', 'kick_spin_hook', 'kick_jump_high'],
    block: ['block_parry', 'block_high'], dodge: ['dodge_lean', 'dodge_slip'],
    special: { clip: 'kick_jump_scissor' },
    taunt: ['emote_come_on'], intro: 'emote_neck_stretch',
    victory: ['emote_battlecry'],
    warmup: ['emote_neck_stretch', 'emote_arm_stretch', 'emote_come_on'],
  },
  // Duane "The Boulder": heavyweight brawler-wrestler. Body hooks, elbows,
  // the big boot, and he finishes on the mat.
  boulder: {
    idle: 'idle_mma',
    fast: ['jab', 'lunge_straight', 'hook_lead'],
    power: ['hook_body', 'overhand', 'elbow_step', 'headbutt', 'haymaker2'],
    kick: ['kick_push'], kickBias: 0.5,
    sweep: ['sweep_drop'],
    finisher: ['takedown'],
    block: ['block_forearm', 'block_cover'], dodge: ['dodge_duck'],
    special: { clip: 'jump', impact: 0.84 },   // lands the Boulder Bomb
    taunt: ['emote_chest_thump'], intro: 'emote_chest_thump',
    victory: ['emote_battlecry', 'emote_chest_thump'],
    warmup: ['emote_chest_thump', 'emote_neck_stretch', 'emote_arm_stretch'],
  },
  // Simone "Twist" Skyles: all acrobatics: butterflies, flips, jump kicks.
  skyles: {
    idle: 'idle_boxer',
    fast: ['jab_fast', 'kick_snap', 'kick_lead'],
    power: ['kick_crescent', 'kick_jump_front', 'kick_jump_switch'],
    kick: ['flip_kick', 'butterfly', 'kick_jump_high', 'kick_high2', 'kick_round', 'kick_crescent'],
    kickBias: 1, kickLove: 0.5,
    sweep: ['sweep_spin'],
    finisher: ['flip_kick', 'kick_jump_high'],
    block: ['block_parry'], dodge: ['dodge_slip', 'dodge_duck', 'dodge_lean'],
    special: { clip: 'butterfly' },
    taunt: ['emote_shimmy'], intro: 'emote_flourish',
    victory: ['emote_flourish', 'emote_sway'],
    warmup: ['emote_arm_stretch', 'emote_flourish', 'emote_shimmy'],
  },
  // Hillary "Madam" Quinton: composed counter-striker behind a tight guard.
  quinton: {
    idle: 'idle_martial',
    fast: ['chest_jabs', 'jab', 'jab_fast'],
    power: ['cross', 'elbow_fast', 'uppercut'],
    kick: ['kick_low', 'kick_snap'], kickBias: 0.5,
    sweep: ['sweep_drop'],
    finisher: ['uppercut', 'cross'],
    block: ['block_cover', 'block_inward', 'block_parry'], dodge: ['dodge_lean'],
    special: { clip: 'elbow_fast' },
    taunt: ['emote_point'], intro: 'emote_reach',
    victory: ['emote_flourish', 'emote_reach'],
    warmup: ['emote_neck_stretch', 'emote_point', 'emote_reach'],
  },
  // Sai "Oppa" Park: bouncy low kicks and stomps; dances between exchanges.
  sai: {
    idle: 'idle_brawler',
    fast: ['chest_jabs', 'elbow_fast', 'jab'],
    power: ['kick_push', 'haymaker2'],
    kick: ['kick_low', 'kick_low2', 'kick_push', 'kick_side_low'], kickBias: 1, kickLove: 0.3,
    sweep: ['sweep_drop'],
    finisher: ['kick_push', 'kick_axe'],
    block: ['block_high'], dodge: ['dodge_slip', 'dodge_duck'],
    special: { clip: 'kick_axe' },
    taunt: ['emote_sway', 'emote_shimmy'], intro: 'emote_sway',
    victory: ['emote_sway'],
    warmup: ['emote_sway', 'emote_shimmy', 'emote_arm_stretch'],
  },
  // CiCi "Frost" Spice: slick boxer: snapping jabs, hooks, uppercuts.
  spice: {
    idle: 'idle_boxer',
    fast: ['jab_fast', 'jab', 'hook_lead'],
    power: ['cross', 'hook_short', 'uppercut', 'knee_lead'],
    kick: ['knee_lead', 'kick_snap'], kickBias: 0.4,
    sweep: ['sweep_drop'],
    finisher: ['uppercut', 'hook_short'],
    block: ['block_high', 'block_parry'], dodge: ['dodge_slip', 'dodge_duck'],
    special: { clip: 'cast_wide' },
    taunt: ['emote_whatever'], intro: 'emote_whatever',
    victory: ['emote_shimmy', 'emote_whatever'],
    warmup: ['emote_shimmy', 'emote_whatever', 'emote_neck_stretch'],
  },
  // Gene "The Demon" Summons: feral shock-rock headbanger: headbutts,
  // elbows, knees; spits blood.
  summons: {
    idle: 'idle_feral',
    fast: ['elbow_fast', 'jab', 'hook_lead'],
    power: ['headbutt', 'elbow_step', 'knee', 'haymaker'],
    kick: ['kick_front', 'knee'], kickBias: 0.7,
    sweep: ['sweep_spin'],
    finisher: ['headbutt', 'haymaker', 'knee'],
    block: ['block_forearm'], dodge: ['dodge_lean'],
    special: { clip: 'headbutt', from: 'head' },
    taunt: ['emote_battlecry', 'emote_headbang'], intro: 'emote_battlecry',
    victory: ['emote_headbang'],
    warmup: ['emote_headbang', 'emote_neck_stretch', 'emote_battlecry'],
  },
  // Napoleon "Le Petit": bayonet lunges and low line kicks, flying finish.
  blownapart: {
    idle: 'idle_martial',
    fast: ['lunge_straight', 'jab'],
    power: ['lunge_overhand', 'elbow_step2', 'cross'],
    kick: ['kick_low', 'kick_side_low'], kickBias: 0.6,
    sweep: ['sweep_drop'],
    finisher: ['superman', 'lunge_overhand'],
    block: ['block_inward', 'block_high'], dodge: ['dodge_duck'],
    special: { clip: 'cast_crouch' },
    taunt: ['emote_salute'], intro: 'emote_salute',
    victory: ['emote_salute'],
    warmup: ['emote_salute', 'emote_point', 'emote_arm_stretch'],
  },
  // Joe "Tiger King" Chaotic: wild swings, knees and dropkicks.
  chaotic: {
    idle: 'idle_brawler',
    fast: ['chest_jabs', 'hook_lead', 'jab'],
    power: ['haymaker2', 'haymaker', 'knee'],
    kick: ['drop_kick', 'kick_front', 'knee'], kickBias: 0.6,
    sweep: ['sweep_drop'],
    finisher: ['drop_kick', 'haymaker2'],
    block: ['block_cover'], dodge: ['dodge_duck'],
    special: { clip: 'superman' },
    taunt: ['emote_headbang', 'emote_fist_shake'], intro: 'emote_fist_shake',
    victory: ['emote_chest_thump'],
    warmup: ['emote_fist_shake', 'emote_headbang', 'emote_chest_thump'],
  },
  // Gordon "Chef" Slamsey: furious chopping overhands and elbows; flings plates.
  slamsey: {
    idle: 'idle_brawler',
    fast: ['chest_jabs', 'elbow_fast', 'jab'],
    power: ['haymaker', 'lunge_overhand', 'overhand'],
    kick: ['kick_snap'], kickBias: 0.35,
    sweep: ['sweep_drop'],
    finisher: ['haymaker', 'lunge_overhand'],
    block: ['block_forearm', 'block_high'], dodge: ['dodge_lean'],
    special: { clip: 'throw_backhand' },
    taunt: ['emote_angry', 'emote_fist_shake'], intro: 'emote_angry',
    victory: ['emote_come_on'],
    warmup: ['emote_angry', 'emote_fist_shake', 'emote_arm_stretch'],
  },
  // Wolfgang "Amadeus": elegant, leggy: crescents, side kicks, axe kicks.
  wolfgang: {
    idle: 'idle_martial', lobby: 'idle_relaxed',
    fast: ['jab', 'kick_snap', 'kick_lead'],
    power: ['kick_side', 'kick_axe', 'kick_front'],
    kick: ['kick_crescent', 'kick_side', 'kick_front', 'kick_axe', 'kick_high'], kickBias: 1, kickLove: 0.35,
    sweep: ['sweep_spin'],
    finisher: ['kick_crescent', 'kick_axe'],
    block: ['block_parry', 'block_inward'], dodge: ['dodge_slip'],
    special: { clip: 'kick_side' },
    taunt: ['emote_bow'], intro: 'emote_bow',
    victory: ['emote_bow', 'emote_flourish'],
    warmup: ['emote_flourish', 'emote_bow', 'emote_arm_stretch'],
  },
  // Nikola "AC" Teslash: precise, linear: stop kicks, quick hands, casts.
  teslash: {
    idle: 'idle_kickboxer', lobby: 'idle_relaxed',
    fast: ['jab_fast', 'elbow_fast', 'kick_snap'],
    power: ['kick_side_low', 'cross', 'elbow_step2'],
    kick: ['kick_side_low', 'kick_side', 'kick_lead'], kickBias: 0.8,
    sweep: ['sweep_spin'],
    finisher: ['kick_side', 'cross'],
    block: ['block_parry', 'block_high'], dodge: ['dodge_slip'],
    special: { clip: 'cast_two_hand' },
    taunt: ['emote_neck_stretch'], intro: 'cast_big',
    victory: ['cast_wide'],
    warmup: ['cast_big', 'emote_neck_stretch', 'emote_arm_stretch'],
  },
  // Melon "Technoking" Tusk: awkward, arms-down meme fighter.
  tusk: {
    idle: 'idle_relaxed',
    fast: ['body_jab', 'chest_jabs'],
    power: ['haymaker2', 'lunge_straight'],
    kick: ['kick_low', 'kick_snap'], kickBias: 0.5,
    sweep: ['sweep_drop'],
    finisher: ['haymaker2', 'sweep_drop'],
    block: ['block_cover'], dodge: ['dodge_duck', 'dodge_lean'],
    special: { clip: 'throw_overhand' },
    taunt: ['emote_point'], intro: 'emote_reach',
    victory: ['emote_reach', 'emote_point'],
    warmup: ['emote_point', 'emote_whatever', 'emote_reach'],
  },
  // Odysseus "Nobody": pankration: the Sparta kick, elbows, knees, clinch
  // headbutts, and a takedown to finish.
  odysseus: {
    idle: 'idle_mma',
    fast: ['jab', 'cross', 'knee_lead'],
    power: ['elbow_step3', 'overhand', 'headbutt', 'knee'],
    kick: ['kick_push', 'kick_mid'], kickBias: 0.7,
    sweep: ['sweep_spin'],
    finisher: ['takedown', 'kick_push'],
    block: ['block_forearm', 'block_inward'], dodge: ['dodge_duck'],
    special: { clip: 'elbow_step3' },
    taunt: ['emote_battlecry'], intro: 'emote_battlecry',
    victory: ['emote_battlecry', 'emote_chest_thump'],
    warmup: ['emote_battlecry', 'emote_neck_stretch', 'emote_arm_stretch'],
  },
};

const GENERIC = {
  idle: 'idle_boxer',
  fast: ['jab', 'jab_fast', 'cross'],
  power: ['hook_lead', 'overhand', 'elbow_fast', 'knee'],
  kick: ['kick_low', 'kick_mid', 'kick_round', 'kick_snap'], kickBias: 0.7,
  sweep: ['sweep_drop'],
  finisher: ['uppercut', 'kick_high'],
  block: ['block_high', 'block_cover'], dodge: ['dodge_lean', 'dodge_duck'],
  special: { clip: 'cast_push' },
  taunt: ['emote_come_on'], intro: 'emote_come_on',
  victory: ['emote_battlecry'],
  warmup: ['emote_arm_stretch', 'emote_neck_stretch', 'emote_come_on'],
};

export function kitFor(def) {
  const k = (def && K[def.id]) || {};
  return { ...GENERIC, ...k, lobby: k.lobby || k.idle || GENERIC.idle };
}

// which pool a scripted strike type draws from
export const POOL_OF = {
  punch: 'fast', palm: 'power', backfist: 'power', elbow: 'power',
  roundhouse: 'kick', snapkick: 'kick', spinkick: 'kick', sweep: 'sweep',
  uppercut: 'finisher',
};

// Pick the clip for a scripted strike.
//   window: seconds until the hit must land (the clip may be played up to
//           ~2.4x speed to make it); opener: the fighter has room to travel
//           (lunging/jumping clips are only used to open an exchange);
//   heavy:  a big blow (pre-KO); recent: clips to avoid repeating.
export function chooseMove(kit, type, { window = 1, opener = false, heavy = false, recent = [] } = {}) {
  let pool = POOL_OF[type] || 'fast';
  if (pool === 'kick' && rand() > (kit.kickBias != null ? kit.kickBias : 0.7)) pool = 'power';
  else if ((pool === 'fast' || pool === 'power') && rand() < (kit.kickLove || 0)) pool = 'kick';
  if (heavy && pool === 'fast') pool = rand() < 0.5 ? 'power' : 'kick';
  const fits = id => {
    const m = clipMeta(id);
    if (!m || !m.impact) return false;
    if (m.impact > window * 2.4) return false;
    return opener || pool === 'finisher' || (m.travel || 0) <= 70;
  };
  for (const p of [pool, 'power', 'fast', 'kick']) {
    const ids = (kit[p] || []).filter(fits);
    if (!ids.length) continue;
    const fresh = ids.filter(id => !recent.includes(id));
    return pick(fresh.length ? fresh : ids);
  }
  // nothing fits the window: the quickest clip the fighter owns
  const all = [...kit.fast, ...kit.power, ...kit.kick].filter(id => clipMeta(id));
  all.sort((a, b) => clipMeta(a).impact - clipMeta(b).impact);
  return all[0] || 'jab';
}

export { K as KITS };
