/**
 * The proofreading checked against the raw transcript (plan row F, D7).
 *
 * The proofreader gets the table's names to fix a misheard one (باشید → بشیر),
 * and with them in hand it also writes a table name where the speaker said
 * something else: a surname or nickname the list doesn't show (رسولی → امیر
 * بشیر), another player's name, or nothing at all. So code aligns the raw and
 * the corrected text word by word. Wherever the correction replaced or added
 * words, each table name it gained there must stand for a raw word in that
 * place (or two run together) that sounds like it — its consonants at most one
 * apart, its letters at most half the name's length apart (باشید/بشیر,
 * احسام/احسان, فرد این/فردین) — and is not another player's name. Latin
 * letters where the raw text has none break it too.
 *
 * Table names are matched in Persian script: a display name in Latin letters
 * is read as Persian spells it (Mostafa: مصطفی, Ehsan: احسان, Bashir: بشیر),
 * each part of it and the whole.
 */

/** A place where the correction breaks the raw text. */
export interface ProofreadBreak {
  /** The raw words in that place ('' when the correction added words). */
  heard: string;
  /** What the correction wrote there. */
  wrote: string;
  /** Table names it wrote there that no raw word in the place sounds like. */
  names: string[];
  /** It wrote Latin letters, and the raw text has none. */
  latin: boolean;
}

export interface ProofreadCheck {
  breaks: ProofreadBreak[];
  /** The correction with each place that breaks put back to the raw words. */
  reverted: string;
}

/** Letters Persian writes alike for one sound, one per sound; marks and joiners dropped. */
const FOLD: Record<string, string> = {
  ي: 'ی', ى: 'ی', ئ: 'ی', ك: 'ک', ة: 'ه', ۀ: 'ه', ؤ: 'و',
  آ: 'ا', أ: 'ا', إ: 'ا', ٱ: 'ا', ع: 'ا', ء: '',
  ص: 'س', ث: 'س', ض: 'ز', ظ: 'ز', ذ: 'ز', ط: 'ت', ح: 'ه', غ: 'ق',
};

function fold(word: string): string {
  return [...word.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '')].map((ch) => FOLD[ch] ?? ch).join('');
}

/** A word's consonants: no vowel letters, no final ه (a vowel there). */
function consonants(folded: string): string {
  return folded.replace(/ه$/, '').replace(/[اوی]/g, '');
}

/** What speech-to-text runs onto a name: رو/را (the object), و (and), هم (too), ه (is), ی, م/ت/ش (my, your, his), جان/جون. */
const SUFFIXES = ['رو', 'را', 'و', 'هم', 'ه', 'ی', 'م', 'ت', 'ش', 'جان', 'جون'];

/** The word and the word without a spoken ending. */
function bases(folded: string): string[] {
  return [folded, ...SUFFIXES.filter((s) => folded.length > s.length + 1 && folded.endsWith(s)).map((s) => folded.slice(0, -s.length))];
}

const LATIN_DIGRAPHS: Record<string, string> = {
  sh: 'ش', ch: 'چ', kh: 'خ', gh: 'ق', zh: 'ژ', ph: 'ف', th: 'ت', ck: 'ک',
  ou: 'و', oo: 'و', ee: 'ی', ey: 'ی', ei: 'ی', ay: 'ی', ai: 'ی', eh: 'ه',
};
const LATIN_LETTERS: Record<string, string> = {
  b: 'ب', p: 'پ', t: 'ت', d: 'د', j: 'ج', c: 'ک', k: 'ک', g: 'گ', f: 'ف', v: 'و', w: 'و',
  q: 'ق', h: 'ه', l: 'ل', m: 'م', n: 'ن', r: 'ر', s: 'س', z: 'ز', x: 'کس', y: 'ی', i: 'ی', u: 'و',
};

/**
 * A name part in Latin letters as Persian spells it, as a pattern over folded
 * letters: short vowels may go unwritten, a first vowel is ا, a last a is ا or
 * ی (مصطفی), a last e is ه.
 */
function latinPattern(part: string): string {
  let out = '';
  for (let i = 0; i < part.length; ) {
    const first = i === 0;
    const pair = part.slice(i, i + 2);
    const last = i === part.length - 1;
    const vowelFirst = 'aeiou'.includes(pair[0]!);
    // A first vowel is ا whatever follows (Aida: آیدا); eh is ه only at the end.
    if (LATIN_DIGRAPHS[pair] && !(first && vowelFirst) && (pair !== 'eh' || i + 2 === part.length)) {
      out += LATIN_DIGRAPHS[pair];
      i += 2;
      continue;
    }
    const ch = part[i]!;
    if (ch === part[i - 1] && !'aeiou'.includes(ch)) {
      i += 1; // a doubled consonant is written once
      continue;
    }
    if ('aeo'.includes(ch)) {
      if (first) out += 'ا';
      else if (last) out += ch === 'a' ? '[ای]' : ch === 'e' ? 'ه' : 'و';
      else out += ch === 'a' ? 'ا?' : ch === 'o' ? 'و?' : '';
    } else if (first && (ch === 'i' || ch === 'u')) {
      out += ch === 'i' ? 'ای' : 'او';
    } else {
      out += LATIN_LETTERS[ch] ?? '';
    }
    i += 1;
  }
  return out;
}

interface NamePart {
  /** The part as the table shows it, lowercased: one id for every player who has it. */
  id: string;
  re: RegExp;
  /** Its id and, for a whole name written as one word, its parts' ids. */
  covers: string[];
}

/** Every part of every display name, and each whole name written as one word. */
function nameParts(displayNames: string[]): NamePart[] {
  const parts = new Map<string, { source: string; covers: string[] }>();
  for (const name of displayNames) {
    const words = name.normalize('NFKD').toLowerCase().replace(/[\p{Mn}\p{Cf}]/gu, '').split(/\s+/);
    const sources = words.map((w) =>
      /\p{Script=Latin}/u.test(w) ? latinPattern(w.replace(/[^a-z]/g, '')) : fold(w)
    );
    words.forEach((w, k) => parts.set(w, { source: sources[k]!, covers: [w] }));
    if (words.length > 1) {
      const whole = words.join('');
      parts.set(whole, { source: sources.join(''), covers: [whole, ...words] });
    }
  }
  return [...parts]
    .filter(([, p]) => p.source.replace(/[^\p{L}]/gu, '').length > 0)
    .map(([id, p]) => ({ id, re: new RegExp(`^(?:${p.source})$`, 'u'), covers: p.covers }));
}

/** The name parts a folded word is (with or without a spoken ending). */
function partsOf(folded: string, parts: NamePart[]): NamePart[] {
  return parts.filter((p) => bases(folded).some((base) => p.re.test(base)));
}

function distance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
}

/** A raw word sounds like a name: one consonant apart at most, and at most half the name's letters. */
function soundsLike(heard: string, name: string): boolean {
  return bases(heard).some(
    (h) =>
      distance(consonants(h), consonants(name)) <= 1 &&
      distance(h, name) <= Math.ceil([...name].length / 2)
  );
}

interface Word {
  text: string;
  key: string;
}

const split = (text: string): Word[] =>
  text.split(/\s+/).filter(Boolean).map((t) => ({ text: t, key: fold(t) }));

interface Hunk {
  raw: [number, number];
  corrected: [number, number];
}

/** The places where two word lists differ, from their longest common subsequence. */
function hunks(a: Word[], b: Word[]): Hunk[] {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i]!.key === b[j]!.key ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i]!.key === b[j]!.key) {
      i += 1;
      j += 1;
      continue;
    }
    const start: [number, number] = [i, j];
    while (
      (i < a.length || j < b.length) &&
      !(i < a.length && j < b.length && a[i]!.key === b[j]!.key)
    ) {
      if (j >= b.length || (i < a.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) i += 1;
      else j += 1;
    }
    out.push({ raw: [start[0], i], corrected: [start[1], j] });
  }
  return out;
}

const LATIN = /\p{Script=Latin}/u;

/**
 * Check a correction against its raw transcript and the table's display names:
 * the places it breaks, and the correction with those places put back to the
 * raw words.
 */
export function checkProofread(raw: string, corrected: string, displayNames: string[]): ProofreadCheck {
  const parts = nameParts(displayNames);
  const a = split(raw);
  const b = split(corrected);
  const latinInRaw = LATIN.test(raw);
  const breaks: ProofreadBreak[] = [];
  const kept: string[] = [];
  let next = 0;

  for (const h of hunks(a, b)) {
    const heardWords = a.slice(...h.raw);
    const wroteWords = b.slice(...h.corrected);
    if (heardWords.map((w) => w.key).join('') === wroteWords.map((w) => w.key).join('')) continue; // spacing only

    // A raw word, or two run together (فرد این), that could stand for a name.
    const sources = heardWords.flatMap((w, k) => {
      const after = heardWords[k + 1];
      return after ? [w.key, w.key + after.key] : [w.key];
    });
    const names = wroteWords.filter((w) => {
      const named = partsOf(w.key, parts).map((p) => p.id);
      if (named.length === 0) return false;
      return !sources.some((s) => {
        const was = partsOf(s, parts).flatMap((p) => p.covers);
        if (was.length > 0) return named.some((id) => was.includes(id)); // that name, respelled; never another
        return bases(w.key).some((name) => soundsLike(s, name));
      });
    });
    const latin = !latinInRaw && wroteWords.some((w) => LATIN.test(w.text));
    if (names.length > 0 || latin) {
      breaks.push({
        heard: heardWords.map((w) => w.text).join(' '),
        wrote: wroteWords.map((w) => w.text).join(' '),
        names: [...new Set(names.map((w) => w.text.replace(/[^\p{L}\p{M}\u200c]/gu, '')))],
        latin,
      });
      kept.push(...b.slice(next, h.corrected[0]).map((w) => w.text), ...heardWords.map((w) => w.text));
      next = h.corrected[1];
    }
  }
  kept.push(...b.slice(next).map((w) => w.text));
  return { breaks, reverted: kept.join(' ') };
}
