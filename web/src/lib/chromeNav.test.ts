import { describe, expect, it } from "vitest";
import { CHROME_NAV_GROUPS, CHROME_NAV_ITEMS } from "./chromeNav";
import { MODE_GATED_NAV, modeHiddenNav } from "./topBar";
import { RUNTIME_GROUPS, runtimeMenuEntries } from "../features/ops/runtimeNavigation";

describe("console navigation registry", () => {
  it("orders the top-level workspaces as requested", () => {
    expect(CHROME_NAV_GROUPS.map((group) => group.id)).toEqual([
      "console",
      "users",
      "observations",
      "settings",
      "backup",
    ]);
  });

  it("keeps the requested workspaces and pages in one navigation registry", () => {
    expect(CHROME_NAV_ITEMS.find((item) => item.path === "/users/members")?.group).toBe("users");
    expect(CHROME_NAV_ITEMS.find((item) => item.path === "/users/oauth")?.group).toBe("users");
    expect(CHROME_NAV_ITEMS.find((item) => item.path === "/backups")?.group).toBe("backup");
    expect(CHROME_NAV_ITEMS.find((item) => item.path === "/logs")?.roles).toEqual([
      "owner",
      "admin",
      "member",
    ]);
    expect(CHROME_NAV_ITEMS.find((item) => item.path === "/system-logs")?.roles).toEqual([
      "owner",
      "admin",
    ]);
    expect(CHROME_NAV_ITEMS.find((item) => item.path === "/workbench")).toBeUndefined();
    expect(CHROME_NAV_ITEMS.filter((item) => item.group === "settings")).toEqual([]);
    expect(CHROME_NAV_GROUPS.find((group) => group.id === "settings")?.defaultPath).toContain(
      "section=relay",
    );
    expect(RUNTIME_GROUPS.map((group) => group.sections.length)).toEqual([7, 7, 9]);
    expect(RUNTIME_GROUPS[2]!.sections.map((section) => section.key)).toContain("recovery");
    expect(RUNTIME_GROUPS[2]!.sections.map((section) => section.key)).not.toContain("danger");
    expect(RUNTIME_GROUPS[2]!.sections.map((section) => section.key)).not.toContain("restoreEnv");
    expect(RUNTIME_GROUPS.map((group) => runtimeMenuEntries(group).length)).toEqual([5, 4, 5]);
    expect(
      RUNTIME_GROUPS.flatMap((group) => group.sections.map((section) => section.key)),
    ).not.toContain("checkin");
    expect(
      runtimeMenuEntries(RUNTIME_GROUPS[0]!)
        .find((entry) => entry.key === "routing")
        ?.sections.map((section) => section.key),
    ).toEqual(["routing", "stableFirst", "sticky"]);
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
  const users = CHROME_NAV_ITEMS.find((item) => item.path === "/users/members")!;
  expect(canAccessNav(users, "admin")).toBe(true);
  expect(canAccessNav(users, "member")).toBe(false);
  expect(
    canAccessNav(
      CHROME_NAV_ITEMS.find((item) => item.path === "/system-logs")!,
      null,
    ),
  ).toBe(true);
});
