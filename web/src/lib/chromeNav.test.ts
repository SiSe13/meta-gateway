import { describe, expect, it } from "vitest";
import { CHROME_NAV_ITEMS } from "./chromeNav";
import { MODE_GATED_NAV, modeHiddenNav } from "./topBar";

describe("console navigation registry", () => {
  it("keeps the requested workspaces and pages in one navigation registry", () => {
    expect(CHROME_NAV_ITEMS.find((item) => item.path === "/users")?.group).toBe("users");
    expect(CHROME_NAV_ITEMS.find((item) => item.path === "/users/oauth")?.group).toBe("users");
    expect(CHROME_NAV_ITEMS.find((item) => item.path === "/backups")?.group).toBe("backup");
    expect(CHROME_NAV_ITEMS.find((item) => item.path === "/workbench")).toBeUndefined();
    expect(CHROME_NAV_ITEMS.filter((item) => item.group === "settings")).toEqual([
      expect.objectContaining({ path: "/settings?tab=runtime" }),
    ]);
  });

  // The multi-user area is the one entry hidden by state instead of by a
  // preference; a personal gateway must not carry a board for members it does
  // not have.
  it("hides only the mode-gated entry while the gateway is personal", () => {
    expect(modeHiddenNav("personal")).toEqual([...MODE_GATED_NAV]);
    expect(modeHiddenNav("team")).toEqual([]);
    expect(modeHiddenNav(undefined)).toEqual([...MODE_GATED_NAV]);
    // Every gated path must actually exist in the registry, or the rule would
    // quietly protect nothing.
    for (const path of MODE_GATED_NAV)
      expect(CHROME_NAV_ITEMS.some((item) => item.path === path)).toBe(true);
  });
});

it("reserves personal settings for a team account while retaining deployment settings", async () => {
  const { CHROME_NAV_ITEMS, canAccessNav } = await import("./chromeNav");
  expect(CHROME_NAV_ITEMS.some((item) => item.path === "/account")).toBe(false);
  const users = CHROME_NAV_ITEMS.find((item) => item.path === "/users")!;
  expect(canAccessNav(users, "admin")).toBe(true);
  expect(canAccessNav(users, "member")).toBe(false);
  expect(
    canAccessNav(
      CHROME_NAV_ITEMS.find((item) => item.path === "/settings?tab=runtime")!,
      null,
    ),
  ).toBe(true);
});
