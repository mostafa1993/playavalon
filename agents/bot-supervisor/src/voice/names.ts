/**
 * A bot's name in what people said (plan 2026-11-20 lobby talk, D3): speech
 * recognition writes Persian with variant letters (ي/ی, ك/ک), joiners and the
 * odd diacritic, and spells names differently (کوروش, کورش, کروش; پریسا once
 * as پلیسا); a bot's config lists the spellings it answers to, and a word with
 * one letter changed from a listed name of five letters or more counts too (not
 * one letter added or left out: پریا is another name).
 */

/** Persian text in one form: Persian ی and ک, no joiners or diacritics, lower case. */
export function normalizeFa(text: string): string {
  return text
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‍ً-ْٰ]/g, '');
}

/** Whether `text` holds any of `names` (or, for a name of 5+ letters, a word with one letter changed). */
export function mentions(text: string, names: readonly string[]): boolean {
  const t = normalizeFa(text);
  const words = t.split(/[^\p{L}]+/u).filter(Boolean);
  return names.some((n) => {
    const name = normalizeFa(n).trim();
    if (name.length < 2) return false;
    if (t.includes(name)) return true;
    return name.length >= 5 && words.some((w) => oneOff(w, name));
  });
}

/** Whether two words of the same length differ in exactly one letter. */
export function oneOff(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differ = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) differ += 1;
  return differ === 1;
}
