// ─────────────────────────────────────────────────────────────
// relay.test.ts — a real end-to-end smoke test: spin up the actual
// relay on an ephemeral HTTP server, connect real `ws` clients, and
// play scripted rounds. No mocks — this is the only way to catch a
// broadcast that accidentally leaks `hawkerNode` to an askari seat,
// since that bug lives in exactly how messages get serialized and
// routed, not in any pure function `rules.test.ts` already covers.
// ─────────────────────────────────────────────────────────────

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { mulberry32 } from '../src/game/ai';
import { askariOptions, hawkerMoves } from '../src/game/rules';
import type { MatchState, PublicState } from '../src/game/types';
import { createKanjoEscapeRelay } from './relay';

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

function startServer(seed: number): Promise<string> {
  server = createServer();
  const wss = createKanjoEscapeRelay(mulberry32(seed));
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  return new Promise((resolve) => {
    server!.listen(0, () => {
      const { port } = server!.address() as { port: number };
      resolve(`ws://localhost:${port}/ws/kanjo-escape`);
    });
  });
}

/**
 * A tiny client that just accumulates every parsed message. `drain()`
 * polls (no dangling listeners/races) until the message count stops
 * growing, then returns everything new since the last drain.
 */
class TestClient {
  ws: WebSocket;
  messages: any[] = [];
  private cursor = 0;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => this.messages.push(JSON.parse(raw.toString())));
  }

  opened(): Promise<void> {
    return new Promise((resolve) => this.ws.once('open', () => resolve()));
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws.close();
  }

  async drain(idleMs = 60): Promise<any[]> {
    let lastLen = -1;
    while (lastLen !== this.messages.length) {
      lastLen = this.messages.length;
      await new Promise((r) => setTimeout(r, idleMs));
    }
    const fresh = this.messages.slice(this.cursor);
    this.cursor = this.messages.length;
    return fresh;
  }
}

const lastState = (msgs: any[]) => msgs.filter((m) => m.type === 'state').at(-1)?.match;

describe('kanjo-escape relay', () => {
  it('a solo hawker gets a full MatchState once the match starts', async () => {
    const url = await startServer(1);
    const hawker = new TestClient(url);
    await hawker.opened();

    let msgs = await hawker.drain();
    expect(msgs.some((m) => m.type === 'assigned' && m.role === null)).toBe(true);

    hawker.send({ type: 'pickRole', role: 'HAWKER' });
    msgs = await hawker.drain();
    expect(msgs.some((m) => m.type === 'assigned' && m.role === 'HAWKER')).toBe(true);

    hawker.send({ type: 'ready' });
    msgs = await hawker.drain();
    const started = lastState(msgs);
    expect(typeof started.hawkerNode).toBe('string');
    expect(msgs.find((m) => m.type === 'state').wallet).toEqual({ coins: 0, hasJailFreeCard: false });

    hawker.close();
  });

  it('rejects a new connection once a match is already running', async () => {
    const url = await startServer(2);
    const hawker = new TestClient(url);
    await hawker.opened();
    await hawker.drain();
    hawker.send({ type: 'pickRole', role: 'HAWKER' });
    await hawker.drain();
    hawker.send({ type: 'ready' });
    await hawker.drain(); // match started

    const latecomer = new TestClient(url);
    await latecomer.opened();
    const msgs = await latecomer.drain();
    expect(msgs.some((m) => m.type === 'error')).toBe(true);

    hawker.close();
    latecomer.close();
  });

  it('an askari seat never receives hawkerNode, through a full scripted match', async () => {
    const url = await startServer(3);
    const hawker = new TestClient(url);
    const askari = new TestClient(url);
    await Promise.all([hawker.opened(), askari.opened()]);
    await Promise.all([hawker.drain(), askari.drain()]); // initial assigned/lobby

    hawker.send({ type: 'pickRole', role: 'HAWKER' });
    askari.send({ type: 'pickRole', role: 'ASKARI_1' });
    let [hMsgs, aMsgs] = await Promise.all([hawker.drain(), askari.drain()]);
    expect(hMsgs.some((m) => m.type === 'assigned' && m.role === 'HAWKER')).toBe(true);
    expect(aMsgs.some((m) => m.type === 'assigned' && m.role === 'ASKARI_1')).toBe(true);

    hawker.send({ type: 'ready' });
    askari.send({ type: 'ready' });
    [hMsgs, aMsgs] = await Promise.all([hawker.drain(), askari.drain()]);

    let hawkerState: MatchState = lastState(hMsgs);
    let askariState: PublicState = lastState(aMsgs);
    expect(hawkerState).toBeDefined();
    expect(askariState).toBeDefined();
    expect('hawkerNode' in askariState).toBe(false);
    for (const m of aMsgs.filter((x) => x.type === 'state')) expect('hawkerNode' in m.match).toBe(false);

    let rounds = 0;
    while (hawkerState.phase !== 'GAME_OVER' && rounds < 40) {
      rounds++;
      if (hawkerState.phase === 'HAWKER_TURN') {
        hawker.send({ type: 'hawkerMove', to: hawkerMoves(hawkerState)[0].to });
      } else if (hawkerState.phase === 'BAIL_DECISION') {
        hawker.send({ type: 'bailDecision', choice: 'decline' }); // empty wallet in this test
      } else if (hawkerState.phase === 'KANJO_TURN') {
        const unit = askariState.askaris.find((a) => a.id === 'askari_1');
        if (unit && !unit.moved) {
          const options = askariOptions(askariState, 'askari_1');
          askari.send(options.length ? { type: 'askariMove', to: options[0].to } : { type: 'holdAskari' });
        }
      }

      const [hBatch, aBatch] = await Promise.all([hawker.drain(), askari.drain()]);
      // Every state broadcast during play must hide the secret — except the
      // final one once the match ends, which intentionally reveals it to
      // everyone (matching local play's "show the hawker's final spot").
      for (const m of aBatch.filter((x) => x.type === 'state' && x.match.phase !== 'GAME_OVER')) {
        expect('hawkerNode' in m.match).toBe(false);
      }
      hawkerState = lastState(hBatch) ?? hawkerState;
      askariState = lastState(aBatch) ?? askariState;
    }

    expect(hawkerState.phase).toBe('GAME_OVER');
    expect(askariState.phase).toBe('GAME_OVER');
    expect('hawkerNode' in askariState).toBe(true); // revealed once the match is over

    hawker.close();
    askari.close();
  });

  it('two human askari seats play alongside one AI-filled seat (askari_3)', async () => {
    const url = await startServer(4);
    const hawker = new TestClient(url);
    const a1 = new TestClient(url);
    const a2 = new TestClient(url);
    await Promise.all([hawker.opened(), a1.opened(), a2.opened()]);
    await Promise.all([hawker.drain(), a1.drain(), a2.drain()]);

    hawker.send({ type: 'pickRole', role: 'HAWKER' });
    a1.send({ type: 'pickRole', role: 'ASKARI_1' });
    a2.send({ type: 'pickRole', role: 'ASKARI_2' });
    await Promise.all([hawker.drain(), a1.drain(), a2.drain()]);

    hawker.send({ type: 'ready' });
    a1.send({ type: 'ready' });
    a2.send({ type: 'ready' });
    const [hMsgs, a1Msgs, a2Msgs] = await Promise.all([hawker.drain(), a1.drain(), a2.drain()]);

    let hawkerState: MatchState = lastState(hMsgs);
    let a1State: PublicState = lastState(a1Msgs);
    let a2State: PublicState = lastState(a2Msgs);
    expect(hawkerState).toBeDefined();
    expect('hawkerNode' in a1State).toBe(false);
    expect('hawkerNode' in a2State).toBe(false);

    let rounds = 0;
    // askari_3 is never driven by a client — if the AI didn't fill it, this
    // would spin forever in KANJO_TURN and the round cap below would trip.
    while (hawkerState.phase !== 'GAME_OVER' && rounds < 40) {
      rounds++;
      if (hawkerState.phase === 'HAWKER_TURN') {
        hawker.send({ type: 'hawkerMove', to: hawkerMoves(hawkerState)[0].to });
      } else if (hawkerState.phase === 'BAIL_DECISION') {
        hawker.send({ type: 'bailDecision', choice: 'decline' });
      } else if (hawkerState.phase === 'KANJO_TURN') {
        for (const [client, state, unitId] of [
          [a1, a1State, 'askari_1'],
          [a2, a2State, 'askari_2'],
        ] as const) {
          const unit = state.askaris.find((a) => a.id === unitId);
          if (unit && !unit.moved) {
            const options = askariOptions(state, unitId);
            client.send(options.length ? { type: 'askariMove', to: options[0].to } : { type: 'holdAskari' });
          }
        }
      }

      const [hBatch, a1Batch, a2Batch] = await Promise.all([hawker.drain(), a1.drain(), a2.drain()]);
      for (const m of [...a1Batch, ...a2Batch].filter((x) => x.type === 'state' && x.match.phase !== 'GAME_OVER')) {
        expect('hawkerNode' in m.match).toBe(false);
      }
      hawkerState = lastState(hBatch) ?? hawkerState;
      a1State = lastState(a1Batch) ?? a1State;
      a2State = lastState(a2Batch) ?? a2State;
    }

    expect(hawkerState.phase).toBe('GAME_OVER'); // only reachable if AI actually moved askari_3 every round

    hawker.close();
    a1.close();
    a2.close();
  });
});
