import { describe, expect, it } from "vitest";
import { SKIP_REQUEST_HEADERS_HOP_BY_HOP, SKIP_REQUEST_HEADERS_WITH_INTERNAL, SKIP_RESPONSE_HEADERS } from "./constants.js";

describe("forwarded headers", () => {
  it.each([
    ["hop-by-hop", SKIP_REQUEST_HEADERS_HOP_BY_HOP],
    ["with internal", SKIP_REQUEST_HEADERS_WITH_INTERNAL],
  ])("the %s request list drops accept-encoding, because responses lose content-encoding", (_name, list) => {
    expect(SKIP_RESPONSE_HEADERS.has("content-encoding")).toBe(true);
    expect(list.has("accept-encoding")).toBe(true);
  });
});
