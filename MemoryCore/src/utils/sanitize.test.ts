import { describe, expect, it } from "vitest";
import { shouldExtractL1 } from "./sanitize.js";

describe("shouldExtractL1 content gate", () => {
  it.each(["да", "нет", "Денис", "Омск", "ок", "Mongo", "yes", "好的", "北京", "はい", "네", "42"])(
    "keeps the short reply %s",
    (text) => {
      expect(shouldExtractL1(text)).toBe(true);
    },
  );

  it.each(["👍", "!!!", "...", "—", "???", "？？"])("drops the symbols-only message %s", (text) => {
    expect(shouldExtractL1(text)).toBe(false);
  });
});
