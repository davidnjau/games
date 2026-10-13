// ─────────────────────────────────────────────────────────────
// strings.ts — every word the player sees, in one place.
// Keeping copy out of the logic makes translation (English mode,
// Swahili mode...) a one-file job later.
// ─────────────────────────────────────────────────────────────

import type { SpikeRejection, VehicleType } from './game/types';

export const VEHICLES: Record<VehicleType, { name: string; tagline: string }> = {
  MANYANGA: { name: 'Manyanga', tagline: 'Graffiti, neon na bass nzito' },
  CHAPAA: { name: 'Chapaa', tagline: 'Old school, imedentika lakini inafika' },
  UBER: { name: 'Uber', tagline: 'Safi, smooth, digital cab' },
};

export const S = {
  appTitle: 'Matatu Rush',
  pickTitle: 'Chagua gari lako',
  driver: (n: number) => `Dereva ${n}`,
  start: 'Anza safari',
  turn: (name: string) => `Zamu ya ${name}`,
  drive: 'Dunda',
  spikes: 'Weka spikes',
  undo: 'Rudi',
  soundOn: 'Sauti: on',
  soundOff: 'Sauti: off',
  spikesLeft: 'Mitego zimebaki',
  stepsToStage: 'Hatua hadi stage',
  driveHint: 'Gusa junction iliyowaka utembee.',
  spikesHint: 'Elekeza kwa groove kati ya junctions, kisha bonyeza kuweka block.',
  spikesHintTouch: 'Gusa groove kuona block, gusa tena kuiweka.',
  invalidMove: 'Buda, hapo huwezi!',
  win: 'Umecheza kama wewe!',
  winSub: (name: string) => `${name} amefika stage. Wabebee!`,
  rematch: 'Cheza tena',
  changeRides: 'Badilisha gari',
  turnCount: (n: number) => `Raundi ${Math.ceil(n / 2)}`,
  connecting: 'Inaunganisha...',
  ready: 'Niko tayari',
  readyWaiting: 'Umeko tayari, inasubiri...',
  notYourTurn: 'Subiri zamu yako!',
  opponentLeft: 'Dereva mwenzako ametoka. Inasubiri mwingine...',
  you: 'Wewe',
  yourTurn: 'Zamu yako!',
  rejection: {
    NO_SPIKES: 'Mitego imeisha! Dunda tu.',
    OUT_OF_BOUNDS: 'Buda, hapo huwezi!',
    OVERLAP: 'Hapo kuna block tayari!',
    GRIDLOCK: 'Buda, unamfungia kabisa! Acha njia moja!',
  } satisfies Record<SpikeRejection, string>,
};
