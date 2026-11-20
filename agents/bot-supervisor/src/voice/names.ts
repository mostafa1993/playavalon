/**
 * A bot's name in what people said (plan 2026-11-20 lobby talk, D3): speech
 * recognition writes Persian with variant letters (ي/ی, ك/ک), joiners and the
 * odd diacritic, and spells names differently (کوروش, کورش, کروش; پریسا once
 * as پلیسا). A bot's config lists the spellings it answers to.
 *
 * A name counts only as a whole word, or with an ending people put on it
 * (پریسا جان, کوروشم, داریوشو): never inside another word (داریش is "you
 * have it", برداریش "pick it up"). A word with one letter changed counts only
 * against the bot's main spelling (its first Persian one) and only for a name
 * of five letters or more.
 */

/** Persian text in one form: Persian ی and ک, no joiners or diacritics, lower case. */
export function normalizeFa(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u200c\u200d\u064b-\u0652\u0670]/g, '');
}

/** Endings a name carries when someone is called: my, the object marker, "dear" (not ـه/ـی: کروشه is a word). */
const ENDINGS = ['', 'م', 'و', 'رو', 'جان', 'جون'];

function words(text: string): string[] {
  return normalizeFa(text).split(/[^\p{L}]+/u).filter(Boolean);
}

/** Whether a word is the name, or the name with an ending. */
function isName(word: string, name: string): boolean {
  return word.startsWith(name) && ENDINGS.includes(word.slice(name.length));
}

/** Whether `text` holds one of `names` as a word (or a word one letter off the main Persian spelling). */
export function mentions(text: string, names: readonly string[]): boolean {
  const ws = words(text);
  const all = names.map(normalizeFa).map((n) => n.trim()).filter((n) => n.length > 1);
  if (ws.some((w) => all.some((n) => isName(w, n)))) return true;
  const main = all.find((n) => /[؀-ۿ]/.test(n));
  return !!main && main.length >= 5 && ws.some((w) => oneOff(w, main));
}

/** Whether two words of the same length differ in exactly one letter. */
export function oneOff(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differ = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) differ += 1;
  return differ === 1;
}
