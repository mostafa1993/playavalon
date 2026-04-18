/**
 * Maps reaction keys (sent over LiveKit data channel) to their Fluent Emoji PNGs.
 * Keys are short identifiers, not Unicode glyphs, so different platforms render identically.
 */

export interface EmojiReaction {
  key: string;
  src: string;
  label: string;
}

export const EMOJI_REACTIONS: EmojiReaction[] = [
  { key: 'thumbs-up',   src: '/emoji/thumbs-up.png',   label: 'Thumbs up' },
  { key: 'thumbs-down', src: '/emoji/thumbs-down.png', label: 'Thumbs down' },
  { key: 'heart',       src: '/emoji/heart.png',       label: 'Heart' },
  { key: 'joy',         src: '/emoji/joy.png',         label: 'Laugh' },
  { key: 'wow',         src: '/emoji/wow.png',         label: 'Wow' },
  { key: 'cry',         src: '/emoji/cry.png',         label: 'Cry' },
  { key: 'party',       src: '/emoji/party.png',       label: 'Party' },
  { key: 'clap',        src: '/emoji/clap.png',        label: 'Clap' },
];

export const EMOJI_REACTION_BY_KEY = new Map(EMOJI_REACTIONS.map((r) => [r.key, r]));
