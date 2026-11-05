import { describe, expect, it } from "vitest";
import { stemRussian } from "./stem-ru.js";

describe("stemRussian", () => {
  it.each([
    ["ответы", "ответ"],
    ["ответах", "ответ"],
    ["сертификата", "сертификат"],
    ["базами", "баз"],
    ["данных", "дан"],
    ["подключение", "подключен"],
    ["подключения", "подключен"],
    ["хранятся", "хран"],
    ["быстрейший", "быстр"],
    ["радость", "радост"],
    ["сделав", "сдела"],
    ["день", "ден"],
  ])("stems %s to %s", (word, stem) => {
    expect(stemRussian(word)).toBe(stem);
  });

  it("treats ё as е", () => {
    expect(stemRussian("зелёный")).toBe(stemRussian("зеленый"));
  });

  it("leaves a word without a vowel alone", () => {
    expect(stemRussian("врн")).toBe("врн");
  });
});
