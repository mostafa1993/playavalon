/**
 * Which bots a room gets. The smart bots come first, in random order, so a
 * room asking for one bot gets any of the four, not always the same one;
 * smart bots already running for another room come after the free ones (a
 * bot still waiting in another lobby can't join a second one). The rule bots
 * follow, by their `order`.
 */

export interface BotSlot {
  username: string;
  smart: boolean;
}

/** `needed` bots from `eligible` (sorted by `order`); `busy`: usernames running for another room. */
export function pickBots<T extends BotSlot>(
  eligible: readonly T[],
  needed: number,
  busy: ReadonlySet<string>,
  random: () => number = Math.random,
): T[] {
  const smart = shuffled(eligible.filter((c) => c.smart), random);
  const free = smart.filter((c) => !busy.has(c.username));
  const taken = smart.filter((c) => busy.has(c.username));
  const rule = eligible.filter((c) => !c.smart);
  return [...free, ...taken, ...rule].slice(0, Math.max(0, needed));
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
