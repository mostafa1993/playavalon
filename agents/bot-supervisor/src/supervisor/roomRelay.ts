/**
 * RoomRelay — one room's hearing, shared by its smart bots.
 *
 * The room's ears transcribe each person's turn, live, and each phrase of the
 * assassin discussion as it is said; the supervisor relays every piece to each
 * smart bot of the room. A bot's own words reach the other bots as the exact
 * text it spoke, never transcribed back from its synthesized voice. Everything
 * heard is kept, and a bot that (re)starts gets it all when it says it is
 * ready ("X is talking" is passed on, not kept).
 *
 * In the discussion and the lobby the relay also keeps the floor (plan 2026-11-15-2100, D4):
 * one bot speaks at a time, in the order they asked; a bot that doesn't give
 * the floor back within floorMaxMs loses it.
 */

/** Something said in the room, as the bots receive it. */
export type Heard =
  /** A speaking turn: its place in the order, and the words ('' when nothing was said). */
  | { type: 'turn'; quest: number; round: number; turnIndex: number; speaker: string; text: string }
  /** A line of the assassin discussion. */
  | { type: 'discussion'; speaker: string; text: string; fromBot: boolean }
  /** A line of the lobby's talk, before the game (plan 2026-11-20 lobby talk). */
  | { type: 'lobby'; speaker: string; text: string; fromBot: boolean }
  /** A person is talking right now (the discussion, the lobby). */
  | { type: 'talking'; speaker: string };

/** What the supervisor sends a bot: what was heard, or "the floor is yours". */
export type ToBot = Heard | { type: 'floor' };

/** What a smart bot sends the supervisor. */
export type FromBot =
  | { type: 'ready' }
  | { type: 'said'; quest: number; round: number; turnIndex: number; speaker: string; text: string }
  | { type: 'discussed'; speaker: string; text: string }
  | { type: 'lobby-said'; speaker: string; text: string }
  | { type: 'floor-request' }
  | { type: 'floor-release' };

export interface BotPeer {
  send(message: ToBot): void;
}

export class RoomRelay {
  private readonly heard: Heard[] = [];
  private readonly bots = new Map<string, BotPeer>();
  private floorHolder: string | null = null;
  private readonly floorQueue: string[] = [];
  private floorTimer: ReturnType<typeof setTimeout> | null = null;

  /** Longer than a bot holds it: up to 12 s waiting for quiet, then a reply of up to 20 s. */
  constructor(private readonly floorMaxMs = 45_000) {}

  /** A smart bot of the room; it gets the backlog once it says it is ready. */
  addBot(username: string, peer: BotPeer): void {
    this.bots.set(username, peer);
  }

  removeBot(username: string): void {
    this.bots.delete(username);
    const queued = this.floorQueue.indexOf(username);
    if (queued >= 0) this.floorQueue.splice(queued, 1);
    if (this.floorHolder === username) this.releaseFloor();
  }

  get botCount(): number {
    return this.bots.size;
  }

  /** Who has the floor in the discussion, if a bot does. */
  get floor(): string | null {
    return this.floorHolder;
  }

  /** From the room's ears: kept (unless it is "talking"), and sent to every bot. */
  fromEars(message: Heard): void {
    if (message.type !== 'talking') this.heard.push(message);
    for (const peer of this.bots.values()) peer.send(message);
  }

  /** From a bot: "ready" gets the backlog; its words go to the others; the floor. */
  fromBot(username: string, message: FromBot): void {
    const peer = this.bots.get(username);
    switch (message.type) {
      case 'ready':
        if (peer) for (const m of this.heard) peer.send(m);
        return;
      case 'floor-request':
        if (this.floorHolder === username || this.floorQueue.includes(username)) return;
        this.floorQueue.push(username);
        if (!this.floorHolder) this.grantNext();
        return;
      case 'floor-release':
        if (this.floorHolder === username) this.releaseFloor();
        return;
      case 'said':
      case 'discussed':
      case 'lobby-said': {
        const heard: Heard =
          message.type === 'said'
            ? { type: 'turn', quest: message.quest, round: message.round, turnIndex: message.turnIndex, speaker: message.speaker, text: message.text }
            : message.type === 'discussed'
              ? { type: 'discussion', speaker: message.speaker, text: message.text, fromBot: true }
              : { type: 'lobby', speaker: message.speaker, text: message.text, fromBot: true };
        this.heard.push(heard);
        for (const [name, other] of this.bots) if (name !== username) other.send(heard);
      }
    }
  }

  private releaseFloor(): void {
    if (this.floorTimer) clearTimeout(this.floorTimer);
    this.floorTimer = null;
    this.floorHolder = null;
    this.grantNext();
  }

  private grantNext(): void {
    while (this.floorQueue.length > 0) {
      const next = this.floorQueue.shift()!;
      const peer = this.bots.get(next);
      if (!peer) continue;
      this.floorHolder = next;
      this.floorTimer = setTimeout(() => this.releaseFloor(), this.floorMaxMs);
      peer.send({ type: 'floor' });
      return;
    }
  }
}
