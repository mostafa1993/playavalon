/**
 * Whether a chat message is mostly Persian: the panel draws it right-to-left,
 * and the route marks a cut-off answer in the question's language. A Persian
 * text often starts with a Latin player name, so the first letter can't tell.
 */

const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/g;
const LTR_LETTER = /[A-Za-zÀ-ɏ]/g;

/** 'rtl' when the text has more Persian (Arabic-script) letters than Latin
 *  ones, 'ltr' when fewer; null when it has neither. */
export function textDirection(text: string): 'rtl' | 'ltr' | null {
  const rtl = text.match(RTL_LETTER)?.length ?? 0;
  const ltr = text.match(LTR_LETTER)?.length ?? 0;
  if (rtl === 0 && ltr === 0) return null;
  return rtl > ltr ? 'rtl' : 'ltr';
}
