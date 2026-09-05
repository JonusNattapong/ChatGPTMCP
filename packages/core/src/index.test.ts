import { describe, expect, it } from "vitest";
import { builtinCapabilities } from "./index.js";

describe("builtinCapabilities", () => {
  it("keeps capability names unique", () => {
    const names = builtinCapabilities.map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
