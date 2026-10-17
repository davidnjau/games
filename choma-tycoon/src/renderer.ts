// ─────────────────────────────────────────────────────────────
// renderer.ts — paints a GameState snapshot into the DOM. Owns no
// game logic and no timers: every frame it's handed the current
// state and redraws from scratch. The only state it keeps for
// itself is "what did I last animate", so repeat feedback events
// can re-trigger a CSS animation.
// ─────────────────────────────────────────────────────────────

import { DISHES, difficultyLevel } from './game/rules';
import { ADDON_INGREDIENTS, RULES, type Customer, type GameState, type Ingredient } from './game/types';
import { S } from './strings';

const ALL_INGREDIENTS: readonly Ingredient[] = [
  'EGG',
  'KACHUMBARI',
  'SMOKIE',
  'MAIZE',
  'LIME_CHILLI',
  'MUTURA_MEAT',
  'TOMATO_SAUCE',
  'CHILLI_SAUCE',
];

export interface RenderHandlers {
  onSelectCustomer(id: string): void;
  onIngredient(ingredient: Ingredient): void;
  onServe(): void;
  onClear(): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Renderer {
  private game = $('game');
  private customersEl = $('customers');
  private trayEl = $('tray');
  private serveBtn = $<HTMLButtonElement>('serve-btn');
  private clearBtn = $<HTMLButtonElement>('clear-btn');
  private ingredientsEl = $('ingredients');
  private feedbackBanner = $('feedback-banner');
  private raidOverlay = $('raid-overlay');
  private raidWarning = $('raid-warning');
  private raidSub = $('raid-sub');
  private hideRingFill = document.getElementById('hide-ring-fill') as unknown as SVGCircleElement;
  private hidingBanner = $('hiding-banner');
  private hudScore = $('hud-score');
  private hudHigh = $('hud-high');
  private timeLeft = $('time-left');
  private level = $('level');
  private timebarFill = $('timebar-fill');

  private lastFeedbackKey = 0;
  private ringCircumference = 2 * Math.PI * 46;

  buildIngredients(handlers: RenderHandlers): void {
    this.ingredientsEl.innerHTML = '';
    for (const ing of ALL_INGREDIENTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ingredient-btn';
      b.dataset.ingredient = ing;
      b.innerHTML = `<span class="ing-emoji">${S.ingredientEmoji(ing)}</span><span class="ing-label">${S.ingredient(ing)}</span>`;
      b.addEventListener('click', () => handlers.onIngredient(ing));
      this.ingredientsEl.appendChild(b);
    }
    this.serveBtn.addEventListener('click', () => handlers.onServe());
    this.clearBtn.addEventListener('click', () => handlers.onClear());
    this.hideRingFill.style.strokeDasharray = `${this.ringCircumference}`;
  }

  render(state: GameState, handlers: RenderHandlers): void {
    const frozen = state.raid.phase === 'HIDING';

    this.hudScore.textContent = String(state.score);
    this.hudHigh.textContent = String(state.highScore);
    this.timeLeft.textContent = `${Math.max(0, Math.ceil(state.timeLeft / 1000))}s`;
    this.level.textContent = S.level(difficultyLevel(state.score) + 1);
    const pct = Math.min(100, (state.timeLeft / RULES.matchDuration) * 100);
    this.timebarFill.style.width = `${pct}%`;
    this.timebarFill.classList.toggle('low', state.timeLeft < 10_000);

    this.renderCustomers(state, handlers);
    this.renderTray(state);
    this.renderFeedback(state);
    this.renderRaid(state);

    this.game.classList.toggle('frozen', frozen);
    this.ingredientsEl.classList.toggle('disabled', frozen || state.phase !== 'PLAYING');
  }

  private renderCustomers(state: GameState, handlers: RenderHandlers): void {
    this.customersEl.innerHTML = '';
    for (const c of state.customers) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `customer-card${c.id === state.selectedCustomer ? ' selected' : ''}`;
      const pct = Math.max(0, (c.patience / c.patienceMax) * 100);
      const low = pct < 30;
      card.innerHTML = `
        <div class="order-bubble">${this.sequenceHtml(c)}</div>
        <div class="dish-name">${DISHES[c.dish].label}</div>
        <div class="patience-bar"><div class="patience-fill${low ? ' low' : ''}" style="width:${pct}%"></div></div>`;
      card.addEventListener('click', () => handlers.onSelectCustomer(c.id));
      this.customersEl.appendChild(card);
    }
  }

  private sequenceHtml(c: Customer): string {
    return c.sequence.map((ing) => `<span class="order-emoji">${S.ingredientEmoji(ing)}</span>`).join('');
  }

  private renderTray(state: GameState): void {
    const customer = state.customers.find((c) => c.id === state.selectedCustomer);
    this.trayEl.innerHTML = '';
    if (!customer) {
      this.trayEl.innerHTML = `<p class="tray-empty">${S.selectFirst}</p>`;
      this.serveBtn.disabled = true;
      return;
    }
    const ready = state.tray.length === customer.sequence.length;
    customer.sequence.forEach((ing, i) => {
      const filled = i < state.tray.length;
      const slot = document.createElement('span');
      slot.className = `tray-slot${filled ? ' filled' : ''}${ADDON_INGREDIENTS.includes(ing) ? ' addon' : ''}`;
      slot.textContent = filled ? S.ingredientEmoji(ing) : '?';
      this.trayEl.appendChild(slot);
    });
    this.trayEl.classList.toggle('ready', ready);
    this.serveBtn.disabled = !ready || state.raid.phase === 'HIDING';
  }

  private renderFeedback(state: GameState): void {
    if (!state.feedback || state.feedback.key === this.lastFeedbackKey) return;
    this.lastFeedbackKey = state.feedback.key;
    this.feedbackBanner.textContent = S.feedback(state.feedback.code);
    // Re-trigger the CSS animation even if the same class was already applied.
    this.feedbackBanner.classList.remove('show-good', 'show-bad');
    void this.feedbackBanner.offsetWidth;
    this.feedbackBanner.classList.add(state.feedback.kind === 'GOOD' ? 'show-good' : 'show-bad');
  }

  private renderRaid(state: GameState): void {
    const { raid } = state;
    this.raidOverlay.hidden = raid.phase !== 'WARNING';
    this.hidingBanner.hidden = raid.phase !== 'HIDING';
    if (raid.phase === 'WARNING') {
      this.raidWarning.textContent = S.kanjoWarning;
      this.raidSub.textContent = S.kanjoSub;
      const holdFrac = raid.holdProgress / RULES.raidHoldRequired;
      this.hideRingFill.style.strokeDashoffset = `${this.ringCircumference * (1 - holdFrac)}`;
    } else if (raid.phase === 'HIDING') {
      this.hidingBanner.textContent = S.hidingNow;
    }
  }

  resetFeedbackTracking(): void {
    this.lastFeedbackKey = 0;
  }
}
