import type { EventCode, GameEvent } from './game/types';

export function formatKES(amount: number): string {
  return `KES ${Math.round(amount).toLocaleString('en-KE')}`;
}

export const S = {
  title: 'Shillings & Stages',
  tagline: 'Nunua mitaa, jenga biashara, epuka Kanjo — Monopoly ya Kenya.',
  setupPrompt: 'Wachezaji wangapi?',
  setupStart: 'Anza Mchezo!',
  sound: (on: boolean) => (on ? 'Sauti: on' : 'Sauti: off'),

  rollDice: 'Rusha Dice',
  buy: (price: number) => `Nunua (${formatKES(price)})`,
  decline: 'Acha',
  buildKiosk: 'Jenga Kiosk',
  buildPlot: 'Jenga Plot/Flat',
  sell: 'Uza Jengo',
  mortgage: 'Weka Rehani',
  unmortgage: 'Toa Rehani',
  trade: 'Fanya Biashara',
  endTurn: 'Maliza Zamu',
  payFine: (amount: number) => `Lipa Faini (${formatKES(amount)})`,
  useFreePass: 'Tumia Free Pass',
  acceptTrade: 'Kubali',
  declineTrade: 'Kataa',
  payFlat: (amount: number) => `Lipa Kiwango (${formatKES(amount)})`,
  payPercent: (amount: number) => `Lipa 10% ya Mali (${formatKES(amount)})`,

  jailChoiceTitle: 'Uko Kanjo Custody',
  jailChoiceBody: 'Lipa faini, tumia Free Pass, au jaribu kurusha doubles ili utoke.',
  tradeProposalTitle: (from: string, to: string) => `${from} anataka kufanya biashara na ${to}`,
  gameOverTitle: (winner: string) => `${winner} Ameshinda!`,
  playAgain: 'Cheza Tena',

  playerLabel: (n: number) => `Player ${n}`,
  cashLabel: 'Pesa',
  turnLabel: (name: string) => `Zamu ya ${name}`,

  event(e: GameEvent): string {
    return eventMessage(e.code, e.data);
  },
};

function eventMessage(code: EventCode, data?: Record<string, string | number>): string {
  const d = data ?? {};
  switch (code) {
    case 'ROLLED':
      return `Umepata ${d.d1} na ${d.d2}.`;
    case 'ROLLED_DOUBLES':
      return 'Doubles! Utarusha tena baada ya zamu hii.';
    case 'PASSED_GO':
      return `Umepita GO — chukua ${formatKES(Number(d.amount))}!`;
    case 'LANDED_UNOWNED':
      return `Nafasi hii haina mwenyewe — bei ni ${formatKES(Number(d.price))}.`;
    case 'BOUGHT_PROPERTY':
      return `Umenunua ${d.name} kwa ${formatKES(Number(d.price))}.`;
    case 'DECLINED_PROPERTY':
      return `Umeacha kununua ${d.name}.`;
    case 'PAID_RENT':
      return `Umelipa kodi ya ${formatKES(Number(d.amount))} kwa ${d.owner}.`;
    case 'COLLECTED_RENT':
      return `Umepokea kodi ya ${formatKES(Number(d.amount))}.`;
    case 'OWN_PROPERTY':
      return 'Umetua kwenye mali yako mwenyewe.';
    case 'BUILT_KIOSK':
      return `Umejenga Kiosk ya ${d.level} kwenye ${d.name}.`;
    case 'BUILT_PLOT':
      return `Umejenga Plot/Flat kwenye ${d.name}!`;
    case 'SOLD_BUILDING':
      return `Umeuza jengo kwenye ${d.name}.`;
    case 'BUILDING_BANK_EMPTY':
      return `Hakuna majengo yaliyobaki benki kwa ${d.name}.`;
    case 'MORTGAGED':
      return `Umeweka ${d.name} rehani, umepata ${formatKES(Number(d.amount))}.`;
    case 'UNMORTGAGED':
      return `Umetoa rehani ya ${d.name} kwa ${formatKES(Number(d.amount))}.`;
    case 'DREW_CHAMA':
      return `Chama Card: ${d.text}`;
    case 'DREW_HARAMBEE':
      return `Harambee Card: ${d.text}`;
    case 'TAX_AUDIT_PENDING':
      return 'KRA wamekuja! Chagua jinsi ya kulipa.';
    case 'PAID_TAX':
      return `Umelipa kodi ya ${formatKES(Number(d.amount))}.`;
    case 'SENT_TO_JAIL':
      return 'Umepelekwa Kanjo Custody!';
    case 'STUCK_IN_JAIL':
      return `Bado uko custody (jaribio la ${d.turns}).`;
    case 'LEFT_JAIL_FINE':
      return 'Umetoka custody kwa kulipa faini.';
    case 'LEFT_JAIL_DOUBLES':
      return 'Umetoka custody kwa doubles!';
    case 'LEFT_JAIL_CARD':
      return 'Umetoka custody kwa Free Pass.';
    case 'FORCED_OUT_OF_JAIL':
      return 'Muda umeisha — umetolewa custody na kulipishwa faini.';
    case 'TRADE_PROPOSED':
      return `Umependekeza biashara na ${d.to}.`;
    case 'TRADE_ACCEPTED':
      return 'Biashara imekubaliwa!';
    case 'TRADE_DECLINED':
      return 'Biashara imekataliwa.';
    case 'BANKRUPT':
      return `${d.name} amefilisika!`;
    case 'GAME_OVER':
      return `Mchezo umeisha — ${d.winner} ameshinda!`;
    default:
      return '';
  }
}
