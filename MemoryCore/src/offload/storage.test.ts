import { describe, expect, it } from "vitest";
import { sanitizeJsonLine } from "./storage.js";

describe("sanitizeJsonLine", () => {
  it("keeps Cyrillic when the second cleaning layer has to run", () => {
    // U+2003 is left by the first layer and is not JSON whitespace, so parsing fails until layer two.
    const line = `{"a":"Привет 中文"}\u2003`;
    expect(JSON.parse(sanitizeJsonLine(line))).toEqual({ a: "Привет 中文" });
  });
});
