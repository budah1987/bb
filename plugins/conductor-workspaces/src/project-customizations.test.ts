import { describe, expect, it } from "vitest";
import {
  patchProjectCustomization,
  sanitizeProjectCustomizations,
} from "./project-customizations";

describe("sanitizeProjectCustomizations", () => {
  it("keeps valid name and icon entries", () => {
    expect(
      sanitizeProjectCustomizations({
        "proj-1": { name: "Ecto", icon: { kind: "glyph", name: "Rocket" } },
        "proj-2": { icon: { kind: "emoji", value: "🚀" } },
      }),
    ).toEqual({
      "proj-1": { name: "Ecto", icon: { kind: "glyph", name: "Rocket" } },
      "proj-2": { icon: { kind: "emoji", value: "🚀" } },
    });
  });

  it("drops malformed values, blank names, and empty entries", () => {
    expect(
      sanitizeProjectCustomizations({
        "proj-1": { name: "   " },
        "proj-2": { icon: { kind: "glyph" } },
        "proj-3": { icon: { kind: "emoji", value: "" } },
        "proj-4": "nope",
        "proj-5": { name: 7, icon: null },
      }),
    ).toEqual({});
    expect(sanitizeProjectCustomizations(null)).toEqual({});
    expect(sanitizeProjectCustomizations([1, 2])).toEqual({});
  });

  it("trims custom names", () => {
    expect(sanitizeProjectCustomizations({ p: { name: "  bb  " } })).toEqual({
      p: { name: "bb" },
    });
  });
});

describe("patchProjectCustomization", () => {
  it("adds a name override and keeps other projects", () => {
    expect(
      patchProjectCustomization({ other: { name: "Kept" } }, "p", {
        name: "Ecto",
      }),
    ).toEqual({ other: { name: "Kept" }, p: { name: "Ecto" } });
  });

  it("merges an icon into an existing name override", () => {
    expect(
      patchProjectCustomization({ p: { name: "Ecto" } }, "p", {
        icon: { kind: "emoji", value: "👻" },
      }),
    ).toEqual({ p: { name: "Ecto", icon: { kind: "emoji", value: "👻" } } });
  });

  it("clears one field and drops the entry when nothing is left", () => {
    const withBoth = {
      p: {
        name: "Ecto",
        icon: { kind: "glyph", name: "Rocket" },
      },
    } as const;
    expect(
      patchProjectCustomization(withBoth, "p", { name: undefined }),
    ).toEqual({ p: { icon: { kind: "glyph", name: "Rocket" } } });
    expect(
      patchProjectCustomization({ p: { name: "Ecto" } }, "p", {
        name: undefined,
      }),
    ).toEqual({});
    expect(
      patchProjectCustomization({ p: { name: "Ecto" } }, "p", { name: "  " }),
    ).toEqual({});
  });
});
