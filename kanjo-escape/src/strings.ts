// strings.ts — every word the player sees.
import type { Difficulty, OutcomeReason, Side } from './game/types';
import type { SeatRole } from './net';

export const S = {
  title: 'Kanjo Escape',
  tagline: 'Mzigo kichwani, Kanjo nyuma yako.',
  brandSub: 'Nairobi CBD · Hidden movement',
  modeChip: 'Offline game · AI opponent',
  modeChipOnline: 'Online · multiplayer',
  sectorTag: 'Sector 01 / Central Business District',
  sectorLine: 'Nairobi, Kenya',
  liveOperation: 'Live operation',
  operationClosed: 'Operation closed',
  coords: '01°17\'09.6"S 36°49\'18.0"E · Nairobi County',
  legendRoad: 'Road',
  legendAlley: 'Alley',
  legendStage: 'Matatu stage',
  legendPossible: 'Possible position',
  fullscreen: 'Fullscreen',
  layers: 'Toggle Ujasusi',
  sideHawker: 'Hawker',
  sideKanjo: 'Kanjo squad',
  opPanelLabel: 'Operation panel',
  missionLabel: 'Your mission',
  missionTitle: (side: Side) => (side === 'HAWKER' ? 'Blend in. Get out.' : 'Corner them. Make the catch.'),
  missionDesc: (side: Side) =>
    side === 'HAWKER'
      ? 'Slip through the CBD and reach a matatu stage before Kanjo catches you.'
      : "Track the hawker's trail and seal off every stage before round 15.",
  onYourTail: 'On your tail',
  yourSquad: 'Your squad',
  unitsCount: (n: number) => `${n} unit${n === 1 ? '' : 's'}`,
  availableMoves: 'Available moves',
  optionsCount: (n: number) => `${n} option${n === 1 ? '' : 's'}`,
  noMovesYet: 'Select a unit above to see its moves.',
  aiTurnMoves: 'Kanjo is thinking...',
  gameOverMoves: 'Operation over.',
  nextWhistle: 'Next whistle',
  operationProgress: 'Operation progress',
  whistleRound: 'Whistle round',
  hawkerIsRevealed: 'Hawker is revealed',
  difficultyLabel: 'Noma ya operesheni',
  difficulty: (d: Difficulty) => ({ EASY: 'Rahisi', NORMAL: 'Kawaida', HARD: 'Noma' })[d],
  playHawker: 'Cheza kama Hawker',
  playHawkerSub: 'Usikuwe mamba mslow ushikwe',
  playKanjo: 'Cheza kama Kanjo',
  playKanjoSub: 'Mshike kabla ahepe',
  rulesTitle: 'Kasongo Rules',
  rules: [
    'Hawker humove junction moja kila round, kwa siri. Vichoche (Alleys) hazina issue.',
    'Kanjo huona tu kama hawker alipita kwa rodi ama vichochoro.',
    'round ya 3, 6, 9...: “Oyaah! oyaah!” Hawker amesetiwa.',
    'Pickup: step 2, barabara tu. Askari wa dontire: hatua 1, choche sawa.',
    'Askari hawaruhusiwi kuingia stage. Askari akikanyaga hawker, ameshikwa.',
  ],

  round: (r: number, max: number) => `round ${r}/${max}`,
  nextReveal: (n: number) => (n === 0 ? 'Repeat selecta' : `Change after round ${n}`),
  hawkerTurn: 'Ficha mali! Ishia before wakucheki.',
  hawkerTurnReveal: 'Mamba mslow: utaonekana after hii round!',
  kanjoTurnYou: 'Choose karau, na area unaenda kuchukulia za chai.',
  aiThinking: 'Kanjo wanapanga...',
  hawkerHiding: 'Hawker anaseti mali...',
  hawkerMovedVia: (via: 'ROAD' | 'ALLEY') =>
    via === 'ALLEY' ? 'Hawker ameingia chochoro!' : 'Hawker amepita main.',
  waleWale: 'Oya oya!',
  traffic: 'Foleni! Kanjo wanapata move ya ziada.',
  coins: (n: number) => `${n} coin${n === 1 ? '' : 's'}`,
  coinsEarned: (n: number) => `Umepata ${n} coins!`,
  buyCard: (cost: number) => `Nunua jail-free card (${cost})`,
  cardOwned: 'Una jail-free card',
  bailPrompt: 'Umeshikwa! Una deal?',
  bailSub: (place: string) => `Wamekukamata ${place}. Lipa bail ama cheza card uendelee na story.`,
  payBail: (cost: number) => `Lipa bail (${cost})`,
  useCard: 'Tumia jail-free card',
  giveUp: 'Kata story',
  bailed: 'Umelipa bail — endelea!',
  endTurn: 'Kata hii story',
  hold: 'Turia',
  intel: 'Ujasusi - (Hatujui inamean nini)',
  intelHint: '? = mahali hawker anaweza kuwa',
  trail: 'Its giving Hawker',
  squad: 'Mariamu',
  lastSeen: (r: number) => `Alionekana R${r}`,
  moved: 'ameleft',
  ready: 'ready',
  truck: 'Pickup',
  foot: 'Karau',
  sound: (on: boolean) => (on ? 'Sound: on' : 'Sound: off'),
  menu: 'Menu',
  rematch: 'Rematch',
  cantGo: 'Hapo zii!',
  selectUnit: 'Chagua Karau kwanza.',
  missed: 'Hakuna msee hapo.',

  // Online lobby
  lobbyTagline: 'Pick seat yako. Hawker moja, Kanjo mpaka watatu — AI inajaza iliyobaki.',
  lobbyHint: 'Mshike afande apate ready, Kanjo wote wafike ready, ndo story ianze.',
  roleName: (role: SeatRole) =>
    ({ HAWKER: 'Hawker', ASKARI_1: `${S.truck} 1`, ASKARI_2: S.foot, ASKARI_3: `${S.truck} 2` })[role],
  seatOpen: 'Open',
  seatTaken: 'Imechukuliwa',
  seatReady: 'Ready',
  youPicked: 'Wewe — bonyeza ready',
  youReady: 'Wewe — ready!',
  lobbyReady: 'Niko ready',
  opponentLeft: 'Mchezaji ametoka — rudi lobby.',
  matchFull: 'Mchezo inaendelea — subiri hii imalizike.',
};

/** Win/lose text, written from the human player's point of view. */
export function outcomeText(human: Side, winner: Side, reason: OutcomeReason, place: string) {
  const won = human === winner;
  if (human === 'HAWKER') {
    if (won) return { title: 'UMECHAPA ESCAPE!', sub: 'Umecheza kama bossy! Uko sharp! Mali bado iko on.', won };
    if (reason === 'CAUGHT') return { title: 'UMESHIKWA!', sub: `Kanjo wamekushika ${place}. Mamba mslow!.`, won };
    if (reason === 'CORNERED') return { title: 'UMEZINGIRWA!', sub: 'Waah sa utaduu? Hakuna njia ya kutoroka. Kanjo wako all over.', won };
    return { title: 'MUDA UMEISHA!', sub: 'Stage zimefungwa. Kanjo wamekuchosha.', won };
  }
  if (won) {
    if (reason === 'CAUGHT') return { title: 'UMEMSHIKA!', sub: `Afande Kiptanui, kazi safi, Efidence kwa kalatas! ${place}.`, won };
    if (reason === 'CORNERED') return { title: 'AMEZINGIRWA!', sub: 'Hawker hana pa kwenda. Kazi safi, Kanjo.', won };
    return { title: 'UMEMCHOSHA!', sub: 'Muda umeisha na hawker hajafika stage.', won };
  }
  return { title: 'AMECHAPA ESCAPE!', sub: `Hawker ameingia stage ${place}. Efidence imeenda.`, won };
}
