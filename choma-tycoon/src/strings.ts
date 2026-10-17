// strings.ts — every word the player sees.
import type { FeedbackCode, Ingredient } from './game/types';

export const S = {
  title: 'Choma Tycoon',
  tagline: 'Nairobi Street Food Challenge',
  intro:
    'Wire up your vibanda cart. Serve the right order before customers lose it — and before Kanjo catches you slipping.',
  start: 'Anza Biashara!',
  howToPlay: [
    'Gusa mteja (customer) unayemhudumia, kisha bonyeza ingredients kwa mpangilio sahihi.',
    'Ukimaliza order, bonyeza "Leta Hiyo!" kuiserve. Ukikosea, "Futa" inarudisha tray yako kwa zero.',
    'Kila mteja ana patience bar — ikiisha, anaondoka na hasira (na unapoteza points).',
    'Serving order moja inaongeza +3s kwenye saa yako.',
    'Kanjo wakija, bonyeza na ushikilie "PACK UP & HIDE" kwa sekunde 3 ndio uepuke faini!',
  ],
  ingredient: (i: Ingredient): string =>
    ({
      EGG: 'Boiled Egg',
      KACHUMBARI: 'Kachumbari',
      SMOKIE: 'Smokie',
      MAIZE: 'Maize',
      LIME_CHILLI: 'Lime-Chilli Rub',
      MUTURA_MEAT: 'Charcoal Meat',
      TOMATO_SAUCE: 'Tomato Sauce',
      CHILLI_SAUCE: 'Chilli Sauce',
    })[i],
  ingredientEmoji: (i: Ingredient): string =>
    ({
      EGG: '🥚',
      KACHUMBARI: '🥗',
      SMOKIE: '🌭',
      MAIZE: '🌽',
      LIME_CHILLI: '🌶️',
      MUTURA_MEAT: '🍢',
      TOMATO_SAUCE: '🍅',
      CHILLI_SAUCE: '🔥',
    })[i],
  feedback: (code: FeedbackCode): string =>
    ({
      INGREDIENT_OK: 'Sawa!',
      ORDER_READY: 'Tayari kuletwa!',
      WRONG_INGREDIENT: 'Mchanganyiko mbaya!',
      SERVED: 'Leta Hiyo! Order imeenda!',
      ANGRY_LEAVE: 'Mteja ameondoka hasira!',
      RAID_FINE: 'Umetozwa faini na Kanjo!',
      RAID_SAFE: 'Umejificha salama!',
    })[code],
  serve: 'Leta Hiyo!',
  clear: 'Futa',
  selectFirst: 'Chagua mteja kwanza!',
  score: 'Score',
  highScore: 'High Score',
  timeLeft: 'Muda',
  packUpAndHide: 'PACK UP & HIDE',
  kanjoWarning: 'KANJO WANAJA!',
  kanjoSub: '(Kanjo are coming — hide the cart!)',
  hidingNow: 'Umejificha... subiri wapite',
  gameOver: 'Umeshikwa na Kanjo!',
  gameOverSub: (score: number) => `Umeuza chakula cha points ${score}. Jaribu tena, bro.`,
  newHighScore: 'REKODI MPYA!',
  playAgain: 'Jaribu Tena',
  backToMenu: 'Menu',
  sound: (on: boolean) => (on ? 'Sauti: on' : 'Sauti: off'),
  levelLabel: 'Level',
  level: (n: number) => `Level ${n}`,
  ready: 'TAYARI!',
};
