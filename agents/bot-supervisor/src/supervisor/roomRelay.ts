/**
 * RoomRelay — one room's hearing, shared by its smart bots (plan row G).
 *
 * The room's ears process transcribes each person's turn once, and the
 * assassin-phase discussion; the supervisor relays every piece to each smart
 * bot of the room. A bot's own words reach the other bots as the exact text it
 * spoke, never transcribed back from its synthesized voice. Everything heard is
 * kept, and a bot that (re)starts gets it all when it says it is ready.
 */

/** Something said in the room, as the bots receive it. */
export type Heard =
  | { type: 'turn'; quest: number; round: number; speaker: string; text: string }
  | { type: 'discussion'; speaker: string; text: string };

/** What a smart bot sends the supervisor. */
export type FromBot =
  | { type: 'ready' }
  | { type: 'said'; quest: number; round: number; speaker: string; text: string }
  | { type: 'discussed'; speaker: string; text: string };

export interface BotPeer {
  send(message: Heard): void;
}

export class RoomRelay {
  private readonly heard: Heard[] = [];
  private readonly bots = new Map<string, BotPeer>();

  /** A smart bot of the room; it gets the backlog once it says it is ready. */
  addBot(username: string, peer: BotPeer): void {
    this.bots.set(username, peer);
  }

  removeBot(username: string): void {
    this.bots.delete(username);
  }

  get botCount(): number {
    return this.bots.size;
  }

  /** From the room's ears: kept, and sent to every bot. */
  fromEars(message: Heard): void {
    this.heard.push(message);
    for (const peer of this.bots.values()) peer.send(message);
  }

  /** From a bot: "ready" gets the backlog; its own words go to the others. */
  fromBot(username: string, message: FromBot): void {
    const peer = this.bots.get(username);
    if (message.type === 'ready') {
      if (peer) for (const m of this.heard) peer.send(m);
      return;
    }
    const heard: Heard =
      message.type === 'said'
        ? { type: 'turn', quest: message.quest, round: message.round, speaker: message.speaker, text: message.text }
        : { type: 'discussion', speaker: message.speaker, text: message.text };
    this.heard.push(heard);
    for (const [name, other] of this.bots) if (name !== username) other.send(heard);
  }
}
