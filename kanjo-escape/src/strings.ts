// strings.ts — every word the player sees.
import type { OutcomeReason, Side } from './game/types';

export const S = {
  title: 'Kanjo Escape',
  tagline: 'Mzigo kichwani, Kanjo nyuma yako.',
  playHawker: 'Cheza kama Hawker',
  playHawkerSub: 'Fika stage bila kushikwa',
  playKanjo: 'Cheza kama Kanjo',
  playKanjoSub: 'Mshike kabla a-escape',
  rulesTitle: 'Sheria',
  rules: [
    'Hawker husonga junction moja kila raundi, kwa siri. Alleys zinaruhusiwa.',
    'Kanjo huona tu kama hawker alipita barabara au alley.',
    'Raundi ya 3, 6, 9...: “Wale wale!” Hawker anaonekana.',
    'Pickup: hatua 2, barabara tu. Askari wa miguu: hatua 1, alleys sawa.',
    'Askari hawaruhusiwi kuingia stage. Askari akikanyaga hawker, ameshikwa.',
  ],

  round: (r: number, max: number) => `Raundi ${r}/${max}`,
  nextReveal: (n: number) => (n === 0 ? 'Wale wale raundi hii!' : `Wale wale baada ya raundi ${n}`),
  hawkerTurn: 'Ficha mzigo! Sonka chap chap kabla wakuone.',
  hawkerTurnReveal: 'Tahadhari: utaonekana baada ya hatua hii!',
  kanjoTurnYou: 'Chagua askari, kisha junction ya kwenda.',
  aiThinking: 'Kanjo wanapanga...',
  hawkerHiding: 'Hawker anajificha...',
  hawkerMovedVia: (via: 'ROAD' | 'ALLEY') =>
    via === 'ALLEY' ? 'Hawker ameingia alley!' : 'Hawker amepita barabarani.',
  waleWale: 'Wale wale!',
  endTurn: 'Maliza zamu',
  hold: 'Baki hapo',
  intel: 'Ujasusi',
  intelHint: '? = mahali hawker anaweza kuwa',
  trail: 'Nyayo za hawker',
  squad: 'Kikosi cha Kanjo',
  lastSeen: (r: number) => `Alionekana R${r}`,
  moved: 'amesonga',
  ready: 'tayari',
  truck: 'Pickup',
  foot: 'Askari',
  sound: (on: boolean) => (on ? 'Sauti: on' : 'Sauti: off'),
  menu: 'Menu kuu',
  rematch: 'Cheza tena',
  cantGo: 'Hapo huwezi!',
  selectUnit: 'Chagua askari kwanza.',
  missed: 'Hakuna mtu hapo.',
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
