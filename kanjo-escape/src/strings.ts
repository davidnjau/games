// strings.ts — every word the player sees.
import type { OutcomeReason, Side } from './game/types';

export const S = {
  title: 'Kanjo Escape',
  tagline: 'Mzigo kichwani, Kanjo nyuma yako.',
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
};

/** Win/lose text, written from the human player's point of view. */
export function outcomeText(human: Side, winner: Side, reason: OutcomeReason, place: string) {
  const won = human === winner;
  if (human === 'HAWKER') {
    if (won) return { title: 'UMECHAPA ESCAPE!', sub: 'Umecheza kama wewe boss! Mizigo iko salama.', won };
    if (reason === 'CAUGHT') return { title: 'UMESHIKWA!', sub: `Kanjo wamekukamata ${place}. Mzigo umeenda.`, won };
    if (reason === 'CORNERED') return { title: 'UMEZINGIRWA!', sub: 'Hakuna njia ya kutoroka. Kanjo wamekuzunguka.', won };
    return { title: 'MUDA UMEISHA!', sub: 'Stage zimefungwa. Kanjo wamekuchosha.', won };
  }
  if (won) {
    if (reason === 'CAUGHT') return { title: 'UMEMSHIKA!', sub: `Kazi safi! Mzigo umekamatwa ${place}.`, won };
    if (reason === 'CORNERED') return { title: 'AMEZINGIRWA!', sub: 'Hawker hana pa kwenda. Kazi safi, Kanjo.', won };
    return { title: 'UMEMCHOSHA!', sub: 'Muda umeisha na hawker hajafika stage.', won };
  }
  return { title: 'AMECHAPA ESCAPE!', sub: `Hawker ameingia stage ${place}. Mzigo umepotea.`, won };
}
