/**
 * Store-layer shared tokenization + BM25 score helpers.
 *
 * These were historically defined in `sqlite.ts` and imported across the
 * codebase (`memory-search`, `conversation-search`, `skill-store`, `l1-dedup`,
 * `auto-recall`). They are backend-agnostic — the SQLite FTS5 path, the TCVDB
 * sparse-vector path, and the MongoDB `$search` path all need the same Chinese
 * word segmentation so that write-side and query-side tokens line up.
 *
 * Canonical location is here; `sqlite.ts` re-exports for backward compatibility.
 *
 * Design (D6): we pre-segment Chinese with jieba `cutForSearch` and store the
 * space-joined tokens in a `tokens` field. Lucene / FTS5 then use a plain
 * whitespace tokenizer and never re-segment, keeping all three backends aligned.
 *
 * jieba emits every character outside CJK and ASCII as its own token, so words
 * in other scripts bypass it and stay whole; Russian words are also stemmed.
 */

import { createRequire } from "node:module";
import { stemRussian } from "./stem-ru.js";

const require = createRequire(import.meta.url);

/**
 * Bump whenever the tokens produced for the same text change: stores compare it
 * with the stored value and rebuild their keyword index on a mismatch.
 */
export const FTS_TOKENIZER_VERSION = 2;

// ── Chinese word segmentation (jieba) ──
// Lazy-loaded singleton: initialised on first call. If @node-rs/jieba is
// unavailable, falls back to Unicode-regex splitting.

interface JiebaInstance {
  cutForSearch(text: string, hmm: boolean): string[];
}

let _jieba: JiebaInstance | null | undefined; // undefined = not yet tried

function getJieba(): JiebaInstance | null {
  if (_jieba !== undefined) return _jieba;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Jieba } = require("@node-rs/jieba");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dict } = require("@node-rs/jieba/dict");
    _jieba = Jieba.withDict(dict) as JiebaInstance;
  } catch {
    _jieba = null; // mark as unavailable — won't retry
  }
  return _jieba;
}

/**
 * Common Chinese stop-words that add noise to keyword queries.
 * Kept small on purpose — only high-frequency function words.
 */
export const ZH_STOP_WORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
  "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那",
  "吗", "吧", "呢", "啊", "呀", "哦", "嗯",
]);

/**
 * Russian function words that add noise to keyword queries, a subset of the
 * Snowball list. Checked before stemming, on the query side only.
 */
export const RU_STOP_WORDS = new Set([
  "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то", "все", "она", "так",
  "его", "но", "да", "ты", "к", "у", "же", "вы", "за", "бы", "по", "только", "ее", "её", "мне",
  "было", "вот", "от", "меня", "еще", "ещё", "нет", "о", "из", "ему", "теперь", "когда", "даже",
  "ну", "вдруг", "ли", "если", "уже", "или", "ни", "быть", "был", "него", "до", "вас", "нибудь",
  "опять", "уж", "вам", "ведь", "там", "потом", "себя", "ничего", "ей", "может", "они", "тут",
  "где", "есть", "это", "надо", "ней", "для", "мы", "тебя", "их", "чем", "была", "сам", "чтоб", "без",
  "будто", "чего", "раз", "тоже", "себе", "под", "будет", "ж", "тогда", "кто", "этот", "того",
  "потому", "этого", "какой", "совсем", "ним", "здесь", "этом", "один", "почти", "мой", "тем",
  "чтобы", "нее", "неё", "сейчас", "были", "куда", "зачем", "всех", "никогда", "можно", "при",
  "наконец", "об", "другой", "хоть", "после", "над", "больше", "тот", "через", "эти", "нас", "про",
  "всего", "них", "какая", "много", "разве", "эту", "моя", "впрочем", "свою", "этой", "перед",
  "иногда", "лучше", "чуть", "том", "нельзя", "такой", "им", "более", "всегда", "конечно", "всю",
  "между",
]);

// A run of letters, marks and digits outside Han, kana and Hangul. Only runs with
// a non-ASCII character bypass jieba: ASCII words keep their existing tokens, and
// kana and Hangul keep going through it as per-character tokens.
const NON_CJK_WORD =
  /(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\p{L}\p{M}\p{N}_])+/gu;
const NON_ASCII = /[^\x00-\x7F]/;
const RUSSIAN_WORD = /^[а-яё]+$/;

function cutChunk(chunk: string): string[] {
  const jieba = getJieba();
  if (jieba) return jieba.cutForSearch(chunk, true);
  return chunk.match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/**
 * Split text into index tokens: non-ASCII words stay whole, Russian ones stemmed,
 * and everything between them goes through jieba or its regex fallback.
 */
function segmentText(raw: string, dropStopWords: boolean): string[] {
  const tokens: string[] = [];
  let cursor = 0;
  for (const match of raw.matchAll(NON_CJK_WORD)) {
    const word = match[0];
    if (!NON_ASCII.test(word)) continue;
    const start = match.index ?? 0;
    if (start > cursor) tokens.push(...cutChunk(raw.slice(cursor, start)));
    cursor = start + word.length;

    const lower = word.toLowerCase();
    if (!RUSSIAN_WORD.test(lower)) tokens.push(lower);
    else if (!dropStopWords || !RU_STOP_WORDS.has(lower)) tokens.push(stemRussian(lower));
  }
  if (cursor < raw.length) tokens.push(...cutChunk(raw.slice(cursor)));
  return tokens;
}

function queryTokens(raw: string): string[] {
  const tokens = segmentText(raw, true)
    .map((t) => t.trim())
    .filter((t) => {
      if (!t) return false;
      if (!/[\p{L}\p{N}]/u.test(t)) return false;
      if (ZH_STOP_WORDS.has(t)) return false;
      return true;
    });
  return [...new Set(tokens)];
}

/**
 * Build an FTS5 MATCH query from raw text.
 *
 * Uses {@link segmentText}, so the tokens line up with {@link tokenizeForFts}.
 * jieba's search-engine mode (`cutForSearch`) gives accurate Chinese word
 * segmentation; if jieba is not installed, chunks fall back to Unicode-regex
 * splitting.
 *
 * Tokens are OR-joined as quoted FTS5 phrase terms so that a document matching
 * *any* token is returned. BM25 naturally ranks documents that match more
 * tokens higher, so precision is preserved while recall improves.
 *
 * Example (with jieba):
 *   "用户喜欢编程和TypeScript" → '"用户" OR "喜欢" OR "编程" OR "TypeScript"'
 *   "Где хранятся логи Grafana?" → '"хран" OR "лог" OR "Grafana"'
 * Example (fallback):
 *   "旅行计划 API" → '"旅行计划" OR "API"'
 */
export function buildFtsQuery(raw: string): string | null {
  const tokens = queryTokens(raw);
  if (tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" OR ");
}

/**
 * Return the raw keyword tokens (de-duplicated, stop-word filtered) for a query.
 *
 * Unlike {@link buildFtsQuery} (which produces FTS5 MATCH syntax), this yields
 * a plain token array — used by backends whose query language is not FTS5, e.g.
 * MongoDB `$search` where we join tokens with spaces for a whitespace analyzer.
 * Returns `[]` when nothing meaningful remains.
 */
export function extractQueryTokens(raw: string): string[] {
  return queryTokens(raw);
}

/**
 * Tokenize text for keyword indexing (write-side).
 *
 * Joins the {@link segmentText} tokens with spaces. The resulting string is
 * stored in the search `content` / `tokens` column so a whitespace/unicode61
 * tokenizer can split it into meaningful words — including both full words and
 * their sub-words.
 *
 * Example (with jieba):
 *   "用户五月去日本旅行" → "用户 五月 去 日本 旅行"
 *   "人工智能的分支"     → "人工 智能 人工智能 的 分支"
 *   "Базы данных" → "баз дан"
 */
export function tokenizeForFts(raw: string): string {
  return segmentText(raw, false).join(" ");
}

/**
 * Reset jieba state so next call re-initialises. Testing only.
 * @internal
 */
export function _resetJiebaForTest(): void {
  _jieba = undefined;
}

/**
 * Override jieba instance (or set to `null` to force fallback). Testing only.
 * @internal
 */
export function _setJiebaForTest(instance: JiebaInstance | null): void {
  _jieba = instance;
}

/**
 * Convert a SQLite FTS5 BM25 rank (negative = more relevant) to a 0–1 score.
 * Mirrors the formula in openclaw core `hybrid.ts`.
 */
export function bm25RankToScore(rank: number): number {
  if (!Number.isFinite(rank)) return 1 / (1 + 999);
  if (rank < 0) {
    const relevance = -rank;
    return relevance / (1 + relevance);
  }
  return 1 / (1 + rank);
}

/**
 * Convert a MongoDB `$search` `$meta:"searchScore"` (unbounded positive, higher
 * = more relevant) to the same 0–1 scale as SQLite BM25 (D12).
 *
 * SQLite's `bm25RankToScore` maps a *relevance* magnitude via
 * `relevance / (1 + relevance)` (its negative branch). Mongo's searchScore is
 * already a positive relevance, so we feed it through the identical transform.
 * This keeps the downstream `scoreThreshold=0.3` gate meaningful across both
 * backends without touching SQLite or the threshold. Equivalent to
 * `bm25RankToScore(-searchScore)` for searchScore > 0.
 */
export function mongoSearchScoreToScore(searchScore: number): number {
  if (!Number.isFinite(searchScore) || searchScore <= 0) return 0;
  return searchScore / (1 + searchScore);
}
