import { describe, expect, it } from "vitest";
import { pageRelPath, slugify } from "./slug.js";

describe("slugify", () => {
  it.each([
    ["Подключение базы", "подключение-базы"],
    ["Модуль Redis", "модуль-redis"],
    ["Кластер Redis", "кластер-redis"],
    ["Redis", "redis"],
    ["PostgreSQL на Railway", "postgresql-на-railway"],
    ["Redis 主从", "redis-主从"],
    ["主从复制", "主从复制"],
    ["  Hello, World!  ", "hello-world"],
  ])("maps %s to %s", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it("is stable across case for Russian titles", () => {
    expect(slugify("БАЗА данных")).toBe(slugify("база Данных"));
  });

  it("gives Russian entities their own page paths", () => {
    expect(pageRelPath("entity", "Модуль Redis")).toBe("wiki/entities/модуль-redis.md");
    expect(pageRelPath("entity", "Модуль Redis")).not.toBe(pageRelPath("entity", "Кластер Redis"));
  });
});
