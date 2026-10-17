export type CardEffect =
  | { type: 'COLLECT'; amount: number }
  | { type: 'PAY'; amount: number }
  | { type: 'PAY_EACH_PLAYER'; amount: number }
  | { type: 'COLLECT_EACH_PLAYER'; amount: number }
  | { type: 'PAY_LEFT_PLAYER'; amount: number }
  | { type: 'ADVANCE_TO'; spaceId: number }
  | { type: 'ADVANCE_TO_NEAREST_TRANSIT' }
  | { type: 'ADVANCE_TO_NEAREST_UTILITY' }
  | { type: 'GET_OUT_OF_JAIL_FREE' }
  | { type: 'GO_TO_JAIL' }
  | { type: 'PAY_PER_BUILDING'; perKiosk: number; perPlot: number };

export interface CardDef {
  text: string;
  effect: CardEffect;
}

export const HARAMBEE_CARDS: CardDef[] = [
  { text: 'Mpesa cashback bonus! Receive KES 2,000 from mobile money rewards.', effect: { type: 'COLLECT', amount: 2_000 } },
  { text: 'Speeding infraction on the Nairobi Expressway. Pay a fine of KES 5,000.', effect: { type: 'PAY', amount: 5_000 } },
  { text: 'Your side-hustle expands successfully. Collect KES 4,000 from every active player.', effect: { type: 'COLLECT_EACH_PLAYER', amount: 4_000 } },
  { text: 'Wrongful parking citation by Kanjo squads. Pay KES 3,000 to resolve the case.', effect: { type: 'PAY', amount: 3_000 } },
  { text: 'Boda Boda accident repairs. Pay KES 1,500.', effect: { type: 'PAY', amount: 1_500 } },
  { text: 'You win the national sports lottery! Collect KES 10,000 from the bank.', effect: { type: 'COLLECT', amount: 10_000 } },
  { text: 'Advance to GO (Collect KES 20,000 salary).', effect: { type: 'ADVANCE_TO', spaceId: 0 } },
  { text: 'Advance to Nairobi CBD (Moi Avenue). If you pass GO, collect your salary.', effect: { type: 'ADVANCE_TO', spaceId: 39 } },
  { text: 'Advance to the nearest Transit Link — buy it if unowned, or pay double rent if owned.', effect: { type: 'ADVANCE_TO_NEAREST_TRANSIT' } },
  { text: 'Advance to the nearest Utility — buy it if unowned, or roll dice and pay 10x the roll if owned.', effect: { type: 'ADVANCE_TO_NEAREST_UTILITY' } },
  { text: 'Free Harambee Pass — get out of Kanjo Custody free. Keep until needed, or trade it.', effect: { type: 'GET_OUT_OF_JAIL_FREE' } },
  { text: 'Go directly to Kanjo Custody. Do not pass GO, do not collect salary.', effect: { type: 'GO_TO_JAIL' } },
  { text: 'General road maintenance levy: Pay KES 2,500 per Kiosk and KES 10,000 per Plot/Flat you own.', effect: { type: 'PAY_PER_BUILDING', perKiosk: 2_500, perPlot: 10_000 } },
  { text: 'Bank error in your favor. Collect KES 3,000.', effect: { type: 'COLLECT', amount: 3_000 } },
  { text: "You've been elected chairperson of the local Harambee committee. Pay each player KES 1,000.", effect: { type: 'PAY_EACH_PLAYER', amount: 1_000 } },
  { text: 'Inherit a small parcel of land from a relative upcountry. Collect KES 5,000.', effect: { type: 'COLLECT', amount: 5_000 } },
];

export const CHAMA_CARDS: CardDef[] = [
  { text: 'Chama investment cycle payout matures! Collect KES 15,000 from the central vault.', effect: { type: 'COLLECT', amount: 15_000 } },
  { text: "It's your turn to host the welfare meeting. Pay KES 1,000 to each player for refreshments.", effect: { type: 'PAY_EACH_PLAYER', amount: 1_000 } },
  { text: 'Land rates updated in Ruiru. Pay KES 4,000 per Kiosk and KES 11,500 per Plot owned.', effect: { type: 'PAY_PER_BUILDING', perKiosk: 4_000, perPlot: 11_500 } },
  { text: 'School fees contributions required for a relative. Pay KES 5,000.', effect: { type: 'PAY', amount: 5_000 } },
  { text: 'Harambee donation contribution. Pay KES 2,000 into the center of the board.', effect: { type: 'PAY', amount: 2_000 } },
  { text: 'Successful group investment in real estate options. Collect KES 7,500.', effect: { type: 'COLLECT', amount: 7_500 } },
  { text: 'Advance to GO (Collect KES 20,000 salary).', effect: { type: 'ADVANCE_TO', spaceId: 0 } },
  { text: "Your chama's table banking round pays out. Collect KES 10,000.", effect: { type: 'COLLECT', amount: 10_000 } },
  { text: 'Free Chama Pass — get out of Kanjo Custody free. Keep until needed, or trade it.', effect: { type: 'GET_OUT_OF_JAIL_FREE' } },
  { text: 'Go directly to Kanjo Custody. Do not pass GO, do not collect salary.', effect: { type: 'GO_TO_JAIL' } },
  { text: 'Medical emergency harambee contribution required. Pay KES 3,000.', effect: { type: 'PAY', amount: 3_000 } },
  { text: 'Your chama wins a group tender. Collect KES 6,000 from the bank.', effect: { type: 'COLLECT', amount: 6_000 } },
  { text: 'Audit reveals a shortfall in group funds — pay KES 2,500 to the chama treasury.', effect: { type: 'PAY', amount: 2_500 } },
  { text: 'You are named this year’s chama treasurer. Collect KES 1,000 from every member (player).', effect: { type: 'COLLECT_EACH_PLAYER', amount: 1_000 } },
  { text: 'Merry-go-round contribution cycle. Pay KES 2,000 to the player on your left.', effect: { type: 'PAY_LEFT_PLAYER', amount: 2_000 } },
  { text: 'Group savings matured early. Collect KES 4,500.', effect: { type: 'COLLECT', amount: 4_500 } },
];
