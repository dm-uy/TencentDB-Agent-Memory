/**
 * Russian stemmer: a port of the Snowball algorithm.
 * https://snowballstem.org/algorithms/russian/stemmer.html (BSD-3-Clause)
 *
 * Input must be a lowercase Russian word. Used by the store tokenizer so that
 * inflected forms of a word share one FTS token.
 */

const VOWELS = new Set("аеиоуыэюя");

const byLengthDesc = (suffixes: string[]): string[] =>
  [...suffixes].sort((a, b) => b.length - a.length);

// Suffixes of the "group 1" kind must follow а or я, which stays in the stem.
const GERUND_AFTER_A = new Set(["в", "вши", "вшись"]);
const GERUND = byLengthDesc([...GERUND_AFTER_A, "ив", "ивши", "ившись", "ыв", "ывши", "ывшись"]);

const ADJECTIVE = byLengthDesc([
  "ее", "ие", "ые", "ое", "ими", "ыми", "ей", "ий", "ый", "ой", "ем", "им", "ым", "ом",
  "его", "ого", "ему", "ому", "их", "ых", "ую", "юю", "ая", "яя", "ою", "ею",
]);

const PARTICIPLE_AFTER_A = new Set(["ем", "нн", "вш", "ющ", "щ"]);
const PARTICIPLE = byLengthDesc([...PARTICIPLE_AFTER_A, "ивш", "ывш", "ующ"]);

const REFLEXIVE = ["ся", "сь"];

const VERB_AFTER_A = new Set([
  "ла", "на", "ете", "йте", "ли", "й", "л", "ем", "н", "ло", "но", "ет", "ют", "ны", "ть", "ешь", "нно",
]);
const VERB = byLengthDesc([
  ...VERB_AFTER_A,
  "ила", "ыла", "ена", "ейте", "уйте", "ите", "или", "ыли", "ей", "уй", "ил", "ыл", "им", "ым",
  "ен", "ило", "ыло", "ено", "ят", "ует", "уют", "ит", "ыт", "ены", "ить", "ыть", "ишь", "ую", "ю",
]);

const NOUN = byLengthDesc([
  "а", "ев", "ов", "ие", "ье", "е", "иями", "ями", "ами", "еи", "ии", "и", "ией", "ей", "ой", "ий",
  "й", "иям", "ям", "ием", "ем", "ам", "ом", "о", "у", "ах", "иях", "ях", "ы", "ь", "ию", "ью", "ю",
  "ия", "ья", "я",
]);

const DERIVATIONAL = byLengthDesc(["ост", "ость"]);
const SUPERLATIVE = byLengthDesc(["ейш", "ейше"]);

/** Longest listed suffix lying at or after `limit`, or "" when none matches. */
function matchSuffix(word: string, limit: number, sorted: readonly string[]): string {
  for (const suffix of sorted) {
    if (word.length - suffix.length >= limit && word.endsWith(suffix)) return suffix;
  }
  return "";
}

/** Strip the longest suffix; a group-1 suffix not following а/я fails with no shorter retry. */
function stripGrouped(
  word: string,
  limit: number,
  sorted: readonly string[],
  afterA: ReadonlySet<string>,
): string | null {
  const suffix = matchSuffix(word, limit, sorted);
  if (!suffix) return null;
  const stem = word.slice(0, -suffix.length);
  if (afterA.has(suffix)) {
    const previous = stem.length > limit ? stem[stem.length - 1] : "";
    if (previous !== "а" && previous !== "я") return null;
  }
  return stem;
}

function stripPlain(word: string, limit: number, sorted: readonly string[]): string | null {
  const suffix = matchSuffix(word, limit, sorted);
  return suffix ? word.slice(0, -suffix.length) : null;
}

/** RV starts after the first vowel, R2 after the second vowel/non-vowel pair past it. */
function markRegions(word: string): { rv: number; r2: number } {
  const regions = { rv: word.length, r2: word.length };
  let cursor = 0;
  const passTo = (wantVowel: boolean): boolean => {
    while (cursor < word.length && VOWELS.has(word[cursor]) !== wantVowel) cursor++;
    if (cursor === word.length) return false;
    cursor++;
    return true;
  };
  if (!passTo(true)) return regions;
  regions.rv = cursor;
  if (!passTo(false) || !passTo(true) || !passTo(false)) return regions;
  regions.r2 = cursor;
  return regions;
}

export function stemRussian(input: string): string {
  let word = input.replaceAll("ё", "е");
  const { rv, r2 } = markRegions(word);

  // Step 1: perfective gerund, or else reflexive then adjectival, verb or noun.
  const withoutGerund = stripGrouped(word, rv, GERUND, GERUND_AFTER_A);
  if (withoutGerund !== null) {
    word = withoutGerund;
  } else {
    word = stripPlain(word, rv, REFLEXIVE) ?? word;
    const withoutAdjective = stripPlain(word, rv, ADJECTIVE);
    if (withoutAdjective !== null) {
      word = stripGrouped(withoutAdjective, rv, PARTICIPLE, PARTICIPLE_AFTER_A) ?? withoutAdjective;
    } else {
      word = stripGrouped(word, rv, VERB, VERB_AFTER_A) ?? stripPlain(word, rv, NOUN) ?? word;
    }
  }

  // Step 2: final и.
  if (word.length > rv && word.endsWith("и")) word = word.slice(0, -1);

  // Step 3: derivational ending, wholly inside R2.
  const derivational = matchSuffix(word, rv, DERIVATIONAL);
  if (derivational && word.length - derivational.length >= r2) {
    word = word.slice(0, -derivational.length);
  }

  // Step 4: superlative plus undoubling н, undoubling н alone, or final ь.
  const undouble = (value: string): string =>
    value.length - 2 >= rv && value.endsWith("нн") ? value.slice(0, -1) : value;
  const superlative = matchSuffix(word, rv, SUPERLATIVE);
  if (superlative) return undouble(word.slice(0, -superlative.length));
  if (word.length > rv && word.endsWith("н")) return undouble(word);
  if (word.length > rv && word.endsWith("ь")) return word.slice(0, -1);
  return word;
}
