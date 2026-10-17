import { BOARD } from './game/board';
import { canBuildOn, getPlayer, totalAssets } from './game/rules';
import { GROUP_COLORS, RULES, type GameState, type PlayerId, type Space } from './game/types';
import { computeIsoBounds, isoCenter, setupHiDPICanvas, spaceIsoPosition, ISO_TILE_H, ISO_TILE_W } from './layout';
import { formatKES, S } from './strings';

export interface TradeDraft {
  to: PlayerId;
  offerProperty: number | null;
  offerCash: number;
  requestProperty: number | null;
  requestCash: number;
}

export interface RenderHandlers {
  onRoll(): void;
  onBuy(): void;
  onDecline(): void;
  onBuildKiosk(spaceId: number): void;
  onSellKiosk(spaceId: number): void;
  onMortgage(spaceId: number): void;
  onUnmortgage(spaceId: number): void;
  onPayJailFine(): void;
  onUseJailFreeCard(deck: 'CHAMA' | 'HARAMBEE'): void;
  onResolveTax(choice: 'FLAT' | 'PERCENT'): void;
  onEndTurn(): void;
  onToggleSound(): void;
  onOpenTrade(): void;
  onCancelTrade(): void;
  onChangeTradeDraft(patch: Partial<TradeDraft>): void;
  onSubmitTrade(): void;
  onRespondTrade(accept: boolean): void;
  onRestart(): void;
}

export interface SetupHandlers {
  onSelectCount(n: number): void;
  onStart(): void;
}

export interface OnlineLobbySeat {
  id: PlayerId;
  ready: boolean;
}

export interface OnlineLobbyHandlers {
  onToggleReady(): void;
  onStartMatch(): void;
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

export class Renderer {
  private setupEl = $<HTMLElement>('setup');
  private setupTaglineEl = $<HTMLElement>('setup-tagline');
  private playerCountEl = $<HTMLElement>('player-count');
  private setupStartEl = $<HTMLButtonElement>('setup-start');
  private gameEl = $<HTMLElement>('game');
  private boardCanvas = $<HTMLCanvasElement>('board');
  private boardCtx: CanvasRenderingContext2D;
  private boardOffsetX: number;
  private boardOffsetY: number;
  private dashboardEl = $<HTMLElement>('dashboard');
  private turnEl = $<HTMLElement>('turn');
  private diceEl = $<HTMLElement>('dice');
  private feedbackEl = $<HTMLElement>('feedback-banner');
  private actionBarEl = $<HTMLElement>('action-bar');
  private soundEl = $<HTMLButtonElement>('sound');
  private modalEl = $<HTMLElement>('modal');
  private modalSheetEl = $<HTMLElement>('modal-sheet');

  constructor() {
    const bounds = computeIsoBounds();
    const pad = 24;
    const buildingHeadroom = 110; // tallest Skyscraper box plus its top face
    const labelSpace = 34; // name + price text below each tile
    const width = bounds.maxX - bounds.minX + ISO_TILE_W + pad * 2;
    const height = bounds.maxY - bounds.minY + ISO_TILE_H + buildingHeadroom + labelSpace + pad * 2;
    this.boardOffsetX = -bounds.minX + ISO_TILE_W / 2 + pad;
    this.boardOffsetY = -bounds.minY + buildingHeadroom + pad;
    this.boardCtx = setupHiDPICanvas(this.boardCanvas, width, height);
  }

  renderSetup(selectedCount: number, handlers: SetupHandlers): void {
    this.setupTaglineEl.textContent = S.tagline;
    this.setupStartEl.textContent = S.setupStart;
    this.playerCountEl.innerHTML = '';
    for (let n = 2; n <= 8; n++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(n);
      btn.setAttribute('aria-pressed', String(n === selectedCount));
      btn.addEventListener('click', () => handlers.onSelectCount(n));
      this.playerCountEl.appendChild(btn);
    }
    this.setupStartEl.onclick = () => handlers.onStart();
    this.soundEl.onclick = () => {}; // bound once in showGame
  }

  renderOnlineLobby(mySeatId: PlayerId | null, seats: OnlineLobbySeat[], handlers: OnlineLobbyHandlers): void {
    this.setupTaglineEl.textContent = 'Mtandaoni — subiri wachezaji wengine, kisha anzisha mchezo.';
    this.playerCountEl.innerHTML = '';
    for (const s of seats) {
      const chip = document.createElement('div');
      chip.textContent = `Seat ${s.id}${s.id === mySeatId ? ' (wewe)' : ''}: ${s.ready ? '✅ Tayari' : '⏳ Bado'}`;
      this.playerCountEl.appendChild(chip);
    }
    const myReady = seats.find((s) => s.id === mySeatId)?.ready ?? false;
    const readyBtn = document.createElement('button');
    readyBtn.type = 'button';
    readyBtn.textContent = myReady ? 'Sio Tayari' : 'Niko Tayari';
    readyBtn.addEventListener('click', () => handlers.onToggleReady());
    this.playerCountEl.appendChild(readyBtn);

    const readyCount = seats.filter((s) => s.ready).length;
    this.setupStartEl.textContent = 'Anzisha Mchezo';
    this.setupStartEl.disabled = readyCount < 2;
    this.setupStartEl.onclick = () => handlers.onStartMatch();
  }

  showGame(): void {
    this.setupEl.hidden = true;
    this.gameEl.hidden = false;
  }

  showLobby(): void {
    this.setupEl.hidden = false;
    this.gameEl.hidden = true;
  }

  render(state: GameState, handlers: RenderHandlers, tradeDraft: TradeDraft | null, muted: boolean, viewerPlayerId: PlayerId | null = null): void {
    this.soundEl.textContent = muted ? '🔇' : '🔊';
    this.soundEl.onclick = () => handlers.onToggleSound();

    const current = getPlayer(state, state.currentTurn);
    this.turnEl.textContent = state.phase === 'GAME_OVER' ? '' : S.turnLabel(current.name);

    this.renderBoard(state);
    this.renderDashboard(state);
    this.renderDice(state);
    this.renderFeedback(state);
    const isMyTurn = viewerPlayerId === null || viewerPlayerId === state.currentTurn;
    this.renderActionBar(state, handlers, tradeDraft, isMyTurn);
    this.renderModal(state, handlers, tradeDraft, viewerPlayerId);
  }

  /** Neutral (non-property) space fills — distinguishes transit/utility from plain road. */
  private static readonly NEUTRAL_FILL: Partial<Record<Space['type'], string>> = {
    GO: '#2a2f3a',
    JAIL: '#2a2f3a',
    FREE_PARKING: '#2a2f3a',
    GO_TO_JAIL: '#3a2a2a',
    TAX: '#3a2a2a',
    CHAMA: '#2a3a33',
    HARAMBEE: '#2a3a33',
    TRANSIT: '#223247',
    UTILITY: '#2e3a2a',
  };

  private renderBoard(state: GameState): void {
    const ctx = this.boardCtx;
    ctx.save();
    ctx.clearRect(0, 0, this.boardCanvas.width, this.boardCanvas.height);

    // asphalt backdrop — canvas.style.{width,height} hold the CSS (unscaled) size set by setupHiDPICanvas
    const w = parseFloat(this.boardCanvas.style.width);
    const h = parseFloat(this.boardCanvas.style.height);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1b2030');
    bg.addColorStop(1, '#14171f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const toScreen = (isoX: number, isoY: number) => ({ x: isoX + this.boardOffsetX, y: isoY + this.boardOffsetY });

    // draw back-to-front so nearer tiles/buildings correctly overlap farther ones
    const ordered = BOARD.map((space) => ({ space, tile: spaceIsoPosition(space.id) })).sort((a, b) => a.tile.depth - b.tile.depth);

    for (const { space, tile } of ordered) {
      const { x: cx, y: cy } = toScreen(tile.x, tile.y);
      const ps = state.properties[space.id];
      ctx.globalAlpha = ps?.mortgaged ? 0.5 : 1;

      const fill = space.group !== undefined ? GROUP_COLORS[space.group] : Renderer.NEUTRAL_FILL[space.type] ?? '#2a2f3a';
      this.drawDiamondTile(ctx, cx, cy, fill);
      if (space.group === undefined) this.drawPotholes(ctx, cx, cy, space.id);

      if (ps && ps.owner !== null) {
        const owner = getPlayer(state, ps.owner);
        if (ps.level > 0) {
          const height = ps.level <= 4 ? 16 + ps.level * 10 : space.group === 7 ? 100 : 72;
          this.drawIsoBuilding(ctx, cx, cy, height, owner.color);
        } else {
          this.drawOwnerFlag(ctx, cx, cy, owner.color);
        }
      }

      this.drawTileLabel(ctx, cx, cy, space);

      const here = state.players.filter((p) => p.position === space.id && !p.bankrupt);
      here.forEach((p, i) => this.drawToken(ctx, cx, cy, p.color, i, here.length));
    }

    ctx.globalAlpha = 1;
    const center = toScreen(isoCenter().x, isoCenter().y);
    ctx.textAlign = 'center';
    ctx.font = "700 20px 'Bungee', sans-serif";
    ctx.fillStyle = '#eef1f7';
    ctx.fillText('SHILLINGS', center.x, center.y - 6);
    ctx.fillStyle = '#ffc23c';
    ctx.fillText('&STAGES', center.x, center.y + 18);

    ctx.restore();
  }

  private drawDiamondTile(ctx: CanvasRenderingContext2D, cx: number, cy: number, fill: string): void {
    const hw = ISO_TILE_W / 2;
    const hh = ISO_TILE_H / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Deterministic "weathered asphalt" blemishes — seeded by space id so they don't jitter between renders. */
  private drawPotholes(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number): void {
    const rng = (n: number) => {
      const v = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 2; i++) {
      const ox = (rng(i) - 0.5) * (ISO_TILE_W * 0.5);
      const oy = (rng(i + 10) - 0.5) * (ISO_TILE_H * 0.4);
      const r = 2 + rng(i + 20) * 2.5;
      ctx.beginPath();
      ctx.ellipse(cx + ox, cy + oy, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawIsoBuilding(ctx: CanvasRenderingContext2D, cx: number, cy: number, height: number, color: string): void {
    const hw = ISO_TILE_W * 0.3;
    const hh = ISO_TILE_H * 0.3;
    const topY = cy - height;
    const left = shadeColor(color, 0.65);
    const right = shadeColor(color, 0.85);

    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(cx - hw, topY);
    ctx.lineTo(cx, topY + hh);
    ctx.lineTo(cx, cy + hh * 0.4);
    ctx.lineTo(cx - hw, cy - hh * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();

    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(cx + hw, topY);
    ctx.lineTo(cx, topY + hh);
    ctx.lineTo(cx, cy + hh * 0.4);
    ctx.lineTo(cx + hw, cy - hh * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = shadeColor(color, 1.1);
    ctx.beginPath();
    ctx.moveTo(cx, topY - hh);
    ctx.lineTo(cx + hw, topY);
    ctx.lineTo(cx, topY + hh);
    ctx.lineTo(cx - hw, topY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawOwnerFlag(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
    const x = cx - ISO_TILE_W * 0.22;
    const y = cy - ISO_TILE_H * 0.12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawToken(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, index: number, count: number): void {
    const spread = Math.min(count, 4);
    const offsetX = (index - (spread - 1) / 2) * 11;
    const x = cx + offsetX;
    const y = cy + ISO_TILE_H * 0.18;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#0f1115';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawTileLabel(ctx: CanvasRenderingContext2D, cx: number, cy: number, space: Space): void {
    const y = cy + ISO_TILE_H / 2 + 11;
    ctx.textAlign = 'center';
    ctx.font = "600 9px 'Barlow Condensed', sans-serif";
    ctx.fillStyle = '#eef1f7';
    ctx.fillText(truncate(space.name, 16), cx, y);
    if (space.price) {
      ctx.font = "9px 'Barlow Condensed', sans-serif";
      ctx.fillStyle = '#8b93a7';
      ctx.fillText(formatKES(space.price), cx, y + 11);
    }
  }

  private renderDashboard(state: GameState): void {
    this.dashboardEl.innerHTML = '';
    for (const p of state.players) {
      const card = document.createElement('div');
      card.className = 'player-card';
      if (p.id === state.currentTurn && state.phase !== 'GAME_OVER') card.classList.add('active');
      if (p.bankrupt) card.classList.add('bankrupt');

      const head = document.createElement('div');
      head.className = 'player-card-head';
      const dot = document.createElement('span');
      dot.className = 'player-dot';
      dot.style.background = p.color;
      head.appendChild(dot);
      const name = document.createElement('span');
      name.textContent = p.name + (p.inJail ? ' 🚔' : '');
      head.appendChild(name);
      const cash = document.createElement('span');
      cash.className = 'player-cash';
      cash.textContent = formatKES(p.cash);
      head.appendChild(cash);
      card.appendChild(head);

      const owned = BOARD.filter((s) => state.properties[s.id]?.owner === p.id);
      const props = document.createElement('div');
      props.className = 'player-props';
      props.textContent = p.bankrupt ? 'Amefilisika' : owned.length ? owned.map((s) => s.name).join(', ') : 'Hana mali bado';
      card.appendChild(props);

      this.dashboardEl.appendChild(card);
    }
  }

  private renderDice(state: GameState): void {
    this.diceEl.textContent = state.dice ? `🎲 ${state.dice[0]} + ${state.dice[1]}` : '';
  }

  private renderFeedback(state: GameState): void {
    const last = state.events[state.events.length - 1];
    this.feedbackEl.textContent = last ? S.event(last) : '';
  }

  private renderActionBar(state: GameState, handlers: RenderHandlers, tradeDraft: TradeDraft | null, isMyTurn: boolean): void {
    this.actionBarEl.innerHTML = '';
    if (tradeDraft) return; // composing a trade; no other actions while the modal is open
    if (!isMyTurn) return; // online spectator view: watch only, it's someone else's turn

    const add = (label: string, onClick: () => void, variant?: 'primary' | 'danger') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      if (variant) btn.classList.add(variant);
      btn.addEventListener('click', onClick);
      this.actionBarEl.appendChild(btn);
    };

    const current = getPlayer(state, state.currentTurn);

    if (state.phase === 'AWAITING_ROLL') {
      add(S.rollDice, handlers.onRoll, 'primary');
      this.addManagementActions(state, current.id, handlers, add);
    } else if (state.phase === 'AWAITING_END_TURN') {
      this.addManagementActions(state, current.id, handlers, add);
      const others = state.players.filter((p) => p.id !== current.id && !p.bankrupt);
      if (others.length > 0) add(S.trade, handlers.onOpenTrade);
      add(S.endTurn, handlers.onEndTurn, 'primary');
    }
  }

  private addManagementActions(
    state: GameState,
    playerId: PlayerId,
    handlers: RenderHandlers,
    add: (label: string, onClick: () => void, variant?: 'primary' | 'danger') => void
  ): void {
    for (const space of BOARD) {
      const ps = state.properties[space.id];
      if (!ps || ps.owner !== playerId) continue;
      if (canBuildOn(state, space.id)) {
        add(`${ps.level === 4 ? S.buildPlot : S.buildKiosk}: ${space.name}`, () => handlers.onBuildKiosk(space.id));
      }
      if (ps.level > 0) {
        add(`${S.sell}: ${space.name}`, () => handlers.onSellKiosk(space.id));
      }
      if (!ps.mortgaged && ps.level === 0) {
        add(`${S.mortgage}: ${space.name}`, () => handlers.onMortgage(space.id));
      }
      if (ps.mortgaged) {
        add(`${S.unmortgage}: ${space.name}`, () => handlers.onUnmortgage(space.id));
      }
    }
  }

  private renderModal(state: GameState, handlers: RenderHandlers, tradeDraft: TradeDraft | null, viewerPlayerId: PlayerId | null): void {
    this.modalSheetEl.innerHTML = '';
    const canAct = viewerPlayerId === null || viewerPlayerId === state.currentTurn;

    if (tradeDraft) {
      this.modalEl.hidden = false;
      this.renderTradeComposer(state, handlers, tradeDraft);
      return;
    }

    switch (state.phase) {
      case 'AWAITING_PROPERTY_DECISION':
        this.modalEl.hidden = false;
        this.renderBuyModal(state, handlers, canAct);
        return;
      case 'AWAITING_TAX_CHOICE':
        this.modalEl.hidden = false;
        this.renderTaxModal(state, handlers, canAct);
        return;
      case 'AWAITING_JAIL_CHOICE':
        this.modalEl.hidden = false;
        this.renderJailModal(state, handlers, canAct);
        return;
      case 'TRADE_PENDING': {
        const canRespond = viewerPlayerId === null || viewerPlayerId === state.pendingTrade?.to;
        this.modalEl.hidden = false;
        this.renderTradeResponseModal(state, handlers, canRespond);
        return;
      }
      case 'GAME_OVER':
        this.modalEl.hidden = false;
        this.renderGameOverModal(state, handlers);
        return;
      default:
        this.modalEl.hidden = true;
    }
  }

  private waitingNote(name: string): HTMLElement {
    const p = document.createElement('p');
    p.textContent = `Inasubiri ${name}...`;
    return p;
  }

  private sheetRow(...buttons: HTMLButtonElement[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';
    buttons.forEach((b) => row.appendChild(b));
    return row;
  }

  private button(label: string, onClick: () => void, variant?: 'primary' | 'danger' | 'ghost'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = variant === 'ghost' ? 'ghost' : variant === 'primary' ? 'primary' : '';
    btn.addEventListener('click', onClick);
    return btn;
  }

  private renderBuyModal(state: GameState, handlers: RenderHandlers, canAct: boolean): void {
    const player = getPlayer(state, state.currentTurn);
    const space = BOARD[player.position];
    const h2 = document.createElement('h2');
    h2.textContent = space.name;
    const p = document.createElement('p');
    p.textContent = `Bei: ${formatKES(space.price!)}`;
    if (!canAct) {
      this.modalSheetEl.append(h2, p, this.waitingNote(player.name));
      return;
    }
    const buyBtn = this.button(S.buy(space.price!), handlers.onBuy, 'primary');
    buyBtn.disabled = player.cash < space.price!;
    this.modalSheetEl.append(h2, p, this.sheetRow(this.button(S.decline, handlers.onDecline, 'ghost'), buyBtn));
  }

  private renderTaxModal(state: GameState, handlers: RenderHandlers, canAct: boolean): void {
    const player = getPlayer(state, state.currentTurn);
    const space = BOARD[player.position];
    const h2 = document.createElement('h2');
    h2.textContent = space.name;
    if (!canAct) {
      this.modalSheetEl.append(h2, this.waitingNote(player.name));
      return;
    }
    const flatAmount = space.taxFlat!;
    const percentAmount = Math.round(totalAssets(state, player.id) * space.taxPercent!);
    this.modalSheetEl.append(
      h2,
      this.sheetRow(
        this.button(S.payFlat(flatAmount), () => handlers.onResolveTax('FLAT')),
        this.button(S.payPercent(percentAmount), () => handlers.onResolveTax('PERCENT'))
      )
    );
  }

  private renderJailModal(state: GameState, handlers: RenderHandlers, canAct: boolean): void {
    const player = getPlayer(state, state.currentTurn);
    const h2 = document.createElement('h2');
    h2.textContent = S.jailChoiceTitle;
    const p = document.createElement('p');
    p.textContent = S.jailChoiceBody;
    if (!canAct) {
      this.modalSheetEl.append(h2, this.waitingNote(player.name));
      return;
    }
    const buttons: HTMLButtonElement[] = [this.button(S.payFine(RULES.jailFine), handlers.onPayJailFine)];
    if (player.freePassCards.chama) buttons.push(this.button(`${S.useFreePass} (Chama)`, () => handlers.onUseJailFreeCard('CHAMA')));
    if (player.freePassCards.harambee) buttons.push(this.button(`${S.useFreePass} (Harambee)`, () => handlers.onUseJailFreeCard('HARAMBEE')));
    buttons.push(this.button(S.rollDice, handlers.onRoll, 'primary'));
    this.modalSheetEl.append(h2, p, this.sheetRow(...buttons));
  }

  private renderTradeResponseModal(state: GameState, handlers: RenderHandlers, canRespond: boolean): void {
    const trade = state.pendingTrade!;
    const from = getPlayer(state, trade.from);
    const to = getPlayer(state, trade.to);
    const h2 = document.createElement('h2');
    h2.textContent = S.tradeProposalTitle(from.name, to.name);
    const p = document.createElement('p');
    const offerNames = trade.offerProperties.map((id) => BOARD[id].name).join(', ') || '—';
    const requestNames = trade.requestProperties.map((id) => BOARD[id].name).join(', ') || '—';
    p.textContent = `${from.name} anatoa: ${offerNames}${trade.offerCash ? ' + ' + formatKES(trade.offerCash) : ''}. Anataka: ${requestNames}${trade.requestCash ? ' + ' + formatKES(trade.requestCash) : ''}.`;
    if (!canRespond) {
      this.modalSheetEl.append(h2, p, this.waitingNote(to.name));
      return;
    }
    this.modalSheetEl.append(
      h2,
      p,
      this.sheetRow(
        this.button(S.declineTrade, () => handlers.onRespondTrade(false), 'ghost'),
        this.button(S.acceptTrade, () => handlers.onRespondTrade(true), 'primary')
      )
    );
  }

  private renderGameOverModal(state: GameState, handlers: RenderHandlers): void {
    const winner = getPlayer(state, state.winner!);
    const h2 = document.createElement('h2');
    h2.textContent = S.gameOverTitle(winner.name);
    this.modalSheetEl.append(h2, this.sheetRow(this.button(S.playAgain, handlers.onRestart, 'primary')));
  }

  private renderTradeComposer(state: GameState, handlers: RenderHandlers, draft: TradeDraft): void {
    const h2 = document.createElement('h2');
    h2.textContent = S.trade;
    this.modalSheetEl.appendChild(h2);

    const from = getPlayer(state, state.currentTurn);
    const targets = state.players.filter((p) => p.id !== from.id && !p.bankrupt);

    const targetSelect = document.createElement('select');
    for (const t of targets) {
      const opt = document.createElement('option');
      opt.value = String(t.id);
      opt.textContent = t.name;
      opt.selected = t.id === draft.to;
      targetSelect.appendChild(opt);
    }
    targetSelect.addEventListener('change', () => handlers.onChangeTradeDraft({ to: Number(targetSelect.value), offerProperty: null, requestProperty: null }));
    this.modalSheetEl.appendChild(targetSelect);

    const myProps = BOARD.filter((s) => state.properties[s.id]?.owner === from.id);
    const theirProps = BOARD.filter((s) => state.properties[s.id]?.owner === draft.to);

    this.modalSheetEl.appendChild(this.propertySelect('Nitoe mali', myProps, draft.offerProperty, (id) => handlers.onChangeTradeDraft({ offerProperty: id })));
    this.modalSheetEl.appendChild(this.cashInput('Nitoe pesa', draft.offerCash, (v) => handlers.onChangeTradeDraft({ offerCash: v })));
    this.modalSheetEl.appendChild(this.propertySelect('Nataka mali', theirProps, draft.requestProperty, (id) => handlers.onChangeTradeDraft({ requestProperty: id })));
    this.modalSheetEl.appendChild(this.cashInput('Nataka pesa', draft.requestCash, (v) => handlers.onChangeTradeDraft({ requestCash: v })));

    this.modalSheetEl.appendChild(
      this.sheetRow(
        this.button('Ghairi', handlers.onCancelTrade, 'ghost'),
        this.button('Pendekeza', handlers.onSubmitTrade, 'primary')
      )
    );
  }

  private propertySelect(label: string, options: { id: number; name: string }[], value: number | null, onChange: (id: number | null) => void): HTMLElement {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '4px';
    const select = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— hakuna —';
    select.appendChild(none);
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = String(o.id);
      opt.textContent = o.name;
      opt.selected = o.id === value;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => onChange(select.value === '' ? null : Number(select.value)));
    wrap.appendChild(select);
    return wrap;
  }

  private cashInput(label: string, value: number, onChange: (v: number) => void): HTMLElement {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '4px';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '500';
    input.value = String(value);
    input.addEventListener('change', () => onChange(Math.max(0, Number(input.value) || 0)));
    wrap.appendChild(input);
    return wrap;
  }
}

function shadeColor(hex: string, factor: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 0xff) * factor);
  const g = clamp(((n >> 8) & 0xff) * factor);
  const b = clamp((n & 0xff) * factor);
  return `rgb(${r},${g},${b})`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
