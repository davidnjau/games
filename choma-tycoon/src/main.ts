// ─────────────────────────────────────────────────────────────
// main.ts — the conductor: menu, the real-time game loop, input,
// sound, and high-score persistence.
//
// Every frame: sample dt → tick(state, dt, rng, holding) → render.
// All state changes funnel through `state = <pure rules fn>(...)`.
// ─────────────────────────────────────────────────────────────

import './style.css';
import { addIngredient, clearTray, createGame, serve, selectCustomer, tick } from './game/rules';
import type { FeedbackCode, GameState, Ingredient } from './game/types';
import { Renderer } from './renderer';
import { Sound } from './audio';
import { S } from './strings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  menu: $('menu'),
  game: $('game'),
  startBtn: $<HTMLButtonElement>('start-btn'),
  toMenu: $<HTMLButtonElement>('to-menu'),
  sound: $<HTMLButtonElement>('sound'),
  howtoList: $('howto-list'),
  feedbackBanner: $('feedback-banner'),
  hideBtn: $<HTMLButtonElement>('hide-btn'),
  hideBtnLabel: $('hide-btn-label'),
  end: $('end'),
  endTitle: $('end-title'),
  endSub: $('end-sub'),
  endHigh: $('end-high'),
  rematch: $<HTMLButtonElement>('rematch'),
  endMenu: $<HTMLButtonElement>('end-menu'),
};

const HIGH_KEY = 'choma-tycoon:high';
const MUTE_KEY = 'choma-tycoon:muted';

const loadHighScore = (): number => {
  try {
    return Number(localStorage.getItem(HIGH_KEY)) || 0;
  } catch {
    return 0;
  }
};
const saveHighScore = (n: number): void => {
  try {
    localStorage.setItem(HIGH_KEY, String(n));
  } catch {
    /* storage unavailable */
  }
};

let highScore = loadHighScore();
let state: GameState = createGame(highScore);
let holding = false;
let last = 0;
let lastSoundKey = 0;
let sirenNextAt = 0;
let endShown = false;

const renderer = new Renderer();
const sound = new Sound();

try {
  sound.muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* storage unavailable */
}

function toast(msg: string): void {
  ui.feedbackBanner.textContent = msg;
  ui.feedbackBanner.classList.remove('show-bad');
  void ui.feedbackBanner.offsetWidth;
  ui.feedbackBanner.classList.add('show-bad');
}

// ── Game flow ────────────────────────────────────────────────

function startGame(): void {
  sound.unlock();
  state = createGame(highScore);
  renderer.resetFeedbackTracking();
  endShown = false;
  lastSoundKey = 0;
  ui.menu.hidden = true;
  ui.game.hidden = false;
  ui.toMenu.hidden = false;
  ui.end.hidden = true;
  last = performance.now();
}

function openMenu(): void {
  ui.game.hidden = true;
  ui.menu.hidden = false;
  ui.toMenu.hidden = true;
}

function showGameOver(): void {
  if (endShown) return;
  endShown = true;
  const isNewHigh = state.score >= highScore && state.score > 0;
  highScore = Math.max(highScore, state.score);
  saveHighScore(highScore);
  ui.endTitle.textContent = S.gameOver;
  ui.endSub.textContent = S.gameOverSub(state.score);
  ui.endHigh.hidden = !isNewHigh;
  ui.endHigh.textContent = S.newHighScore;
  ui.rematch.textContent = S.playAgain;
  ui.endMenu.textContent = S.backToMenu;
  ui.end.hidden = false;
  sound.gameOver();
}

// ── Sound reactions to rules-engine feedback events ─────────────

function soundFor(code: FeedbackCode): void {
  switch (code) {
    case 'INGREDIENT_OK':
    case 'ORDER_READY':
      sound.good();
      break;
    case 'WRONG_INGREDIENT':
      sound.bad();
      break;
    case 'SERVED':
      sound.serve();
      break;
    case 'ANGRY_LEAVE':
      sound.angry();
      break;
    case 'RAID_FINE':
      sound.fine();
      break;
    case 'RAID_SAFE':
      sound.safe();
      break;
  }
}

// ── Input ────────────────────────────────────────────────────

const handlers = {
  onIngredient: (ingredient: Ingredient) => {
    if (!state.selectedCustomer) {
      toast(S.selectFirst);
      sound.bad();
      return;
    }
    state = addIngredient(state, ingredient);
  },
  onSelectCustomer: (id: string) => {
    sound.click();
    state = selectCustomer(state, id);
  },
  onServe: () => {
    state = serve(state);
  },
  onClear: () => {
    sound.click();
    state = clearTray(state);
  },
};

renderer.buildIngredients(handlers);

ui.startBtn.addEventListener('click', startGame);
ui.toMenu.addEventListener('click', openMenu);
ui.endMenu.addEventListener('click', openMenu);
ui.rematch.addEventListener('click', startGame);

ui.sound.addEventListener('click', () => {
  sound.unlock();
  sound.muted = !sound.muted;
  try {
    localStorage.setItem(MUTE_KEY, sound.muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  ui.sound.textContent = S.sound(!sound.muted);
  sound.click();
});

function setHolding(v: boolean): void {
  holding = v;
  ui.hideBtn.classList.toggle('holding', v);
}
ui.hideBtn.addEventListener('pointerdown', () => setHolding(true));
ui.hideBtn.addEventListener('pointerup', () => setHolding(false));
ui.hideBtn.addEventListener('pointerleave', () => setHolding(false));
ui.hideBtn.addEventListener('pointercancel', () => setHolding(false));
ui.hideBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') setHolding(true);
});
ui.hideBtn.addEventListener('keyup', (e) => {
  if (e.key === 'Enter' || e.key === ' ') setHolding(false);
});

// ── Static copy ──────────────────────────────────────────────

function fillStaticText(): void {
  $('brand-sub').textContent = S.tagline;
  $('tagline').textContent = S.tagline;
  $('intro').textContent = S.intro;
  ui.startBtn.textContent = S.start;
  ui.howtoList.innerHTML = S.howToPlay.map((r) => `<li>${r}</li>`).join('');
  $('score-label').textContent = S.score;
  $('high-label').textContent = S.highScore;
  ui.toMenu.textContent = S.backToMenu;
  ui.sound.textContent = S.sound(!sound.muted);
  $('time-label').textContent = S.timeLeft;
  $('level-label').textContent = S.levelLabel;
  ui.hideBtnLabel.textContent = S.packUpAndHide;
  $('clear-btn').textContent = S.clear;
  $('serve-btn').textContent = S.serve;
}

// ── Game loop ────────────────────────────────────────────────

function frame(now: number): void {
  const dt = Math.min(100, now - last);
  last = now;

  if (!ui.game.hidden && state.phase === 'PLAYING') {
    state = tick(state, dt, Math.random, holding);

    if (state.raid.phase === 'WARNING') {
      if (now >= sirenNextAt) {
        sound.siren();
        sirenNextAt = now + 900;
      }
    } else {
      sirenNextAt = 0;
    }

    if (state.feedback && state.feedback.key !== lastSoundKey) {
      lastSoundKey = state.feedback.key;
      soundFor(state.feedback.code);
    }

    if (state.phase === 'GAME_OVER') showGameOver();
  }

  if (!ui.game.hidden) {
    renderer.render(state, handlers);
  }

  requestAnimationFrame(frame);
}

fillStaticText();
openMenu();
requestAnimationFrame(frame);
