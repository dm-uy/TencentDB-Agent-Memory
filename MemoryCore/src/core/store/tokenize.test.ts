import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetJiebaForTest,
  _setJiebaForTest,
  bm25RankToScore,
  buildFtsQuery,
  extractQueryTokens,
  tokenizeForFts,
} from "./tokenize.js";

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

afterEach(() => {
  _resetJiebaForTest();
});

describe.each([
  ["with jieba", () => _resetJiebaForTest()],
  ["without jieba", () => _setJiebaForTest(null)],
])("Russian text %s", (_name, setup) => {
  it("keeps words whole and stems them", () => {
    setup();
    expect(words(tokenizeForFts("Подключение к базе данных"))).toEqual(["подключен", "к", "баз", "дан"]);
  });

  it("keeps Latin identifiers next to Russian words", () => {
    setup();
    expect(words(tokenizeForFts("Логи Grafana хранятся"))).toEqual(["лог", "Grafana", "хран"]);
  });

  it("drops stop words from the query but not from the index", () => {
    setup();
    expect(buildFtsQuery("Где хранятся логи Grafana?")).toBe('"хран" OR "лог" OR "Grafana"');
    expect(extractQueryTokens("Где хранятся логи")).toEqual(["хран", "лог"]);
    expect(words(tokenizeForFts("где логи"))).toEqual(["где", "лог"]);
  });

  it("returns no query when only stop words remain", () => {
    setup();
    expect(buildFtsQuery("как база")).toBe('"баз"');
    expect(buildFtsQuery("как это где")).toBeNull();
  });

  it("matches an inflected form through FTS5", () => {
    setup();
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE VIRTUAL TABLE t USING fts5(content)");
    const insert = db.prepare("INSERT INTO t (content) VALUES (?)");
    for (const doc of ["Сервис падал из-за истёкшего сертификата", "Отчёты складываем в Google Docs"]) {
      insert.run(tokenizeForFts(doc));
    }
    const rows = db
      .prepare("SELECT rowid AS id, rank FROM t WHERE t MATCH ? ORDER BY rank")
      .all(buildFtsQuery("сертификат истёк")) as Array<{ id: number; rank: number }>;
    expect(rows.map((r) => r.id)).toEqual([1]);
    expect(bm25RankToScore(rows[0].rank)).toBeGreaterThan(0);
    db.close();
  });
});

describe("other scripts with jieba", () => {
  it("segments Chinese as before", () => {
    expect(words(tokenizeForFts("用户五月去日本旅行"))).toEqual(["用户", "五月", "去", "日本", "旅行"]);
    expect(buildFtsQuery("用户喜欢编程和TypeScript")).toBe('"用户" OR "喜欢" OR "编程" OR "TypeScript"');
  });

  it("segments Chinese between Russian words", () => {
    expect(words(tokenizeForFts("базы 用户喜欢 данных"))).toEqual(["баз", "用户", "喜欢", "дан"]);
  });

  it("keeps ASCII tokens as before", () => {
    expect(words(tokenizeForFts("User prefers demo-bot"))).toEqual(["User", "prefers", "demo", "bot", "demo-bot"]);
  });

  it("keeps accented Latin and non-Russian Cyrillic words whole without stemming", () => {
    expect(words(tokenizeForFts("Müller живёт"))).toEqual(["müller", "живет"]);
    expect(words(tokenizeForFts("Қазақстан"))).toEqual(["қазақстан"]);
  });

  it("keeps kana going through jieba", () => {
    expect(words(tokenizeForFts("ひらがな"))).toEqual(["ひ", "ら", "が", "な"]);
  });
});
