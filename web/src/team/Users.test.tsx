import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UsersLayout } from "./UsersLayout";
import { MembersPanel } from "./panels/MembersPanel";
import { PoliciesPanel } from "./panels/PoliciesPanel";
import type { TeamRequest } from "./types";

/**
 * The user-management module and the member allowance write path.
 *
 * The transport is a plain function, exactly as the module receives it in
 * production: the module must not know about the console's session (an ESLint
 * boundary enforces that), so the test does not have to fake one either.
 */

const member = {
  id: 2,
  name: "Alice",
  username: "alice",
  role: "member",
  status: "active",
  policy_id: 1,
  policy_ids: [1],
  max_keys: 5,
  max_concurrent: 5,
  rpm: 60,
  allow_routing: false,
  allow_request_preferences: false,
  key_count: 1,
  created_at: "2026-10-02",
  quota_total_tokens: 1000,
  quota_used_tokens: 250,
  quota_total_cost: 10,
  quota_used_cost: 2.5,
};
const policy = {
  id: 1,
  name: "Default",
  models: [],
  member_ids: [],
  all_models: false,
  user_count: 1,
};
const policyDS = {
  id: 2,
  name: "DS",
  models: ["deepseek-chat"],
  member_ids: [21],
  all_models: false,
  user_count: 0,
};
const candidates = [
  { id: 10, model: "gpt-4o", name: "OpenAI primary", enabled: true },
  { id: 11, model: "gpt-4o", name: "OpenAI backup", enabled: true },
  { id: 12, model: "gemini-2.5", name: "Gemini channel", enabled: true },
];
const branding = {
  name: "Meta Gateway",
  accent: "#275b85",
  logo_url: "",
  notice: "",
  login_description: "",
  api_base_url: "",
  show_usage: true,
  show_routing: true,
};

interface Call {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}

function renderUsers({
  role = "owner",
  mode = "team",
  entry = "/users",
  memberOverride,
}: {
  role?: string;
  mode?: "personal" | "team";
  entry?: string;
  memberOverride?: Partial<typeof member>;
} = {}) {
  const calls: Call[] = [];
  const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      path,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (path === "/admin/mode") return { mode, has_owner: true, role } as T;
    if (path === "/admin/team/settings")
      return { settings: { mode, branding }, has_owner: true, role } as T;
    if (path === "/admin/team/users") return [{ ...member, ...memberOverride }] as T;
    if (path === "/admin/team/policies") return [policy, policyDS] as T;
    if (path === "/admin/team/candidates") return candidates as T;
    return [] as T;
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/users" element={<UsersLayout request={request} />}>
              <Route index element={<Navigate to="members" replace />} />
              <Route path="members" element={<MembersPanel />} />
              <Route path="policies" element={<PoliciesPanel />} />
              <Route path="quotas" element={<Navigate to="/users/members" replace />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return calls;
}

describe("user management module", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("meta-gateway.locale", "en");
  });
  afterEach(cleanup);

  // The shared shell owns page navigation; personal mode keeps its setup action
  // inside the user-management page and never mounts team-only boards.
  it("shows the team-mode setup in place of the member board while personal", async () => {
    const calls = renderUsers({ mode: "personal" });
    expect(await screen.findByLabelText("Operating mode")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(calls.some((call) => call.path === "/admin/team/settings")).toBe(false);
  });

  it("opens the member list by default in team mode", async () => {
    renderUsers();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Activity" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Alice/ });
    expect(row.querySelectorAll("time")).toHaveLength(1);
    expect(row.querySelector("time")).toHaveTextContent("—");
    expect(screen.queryByRole("heading", { name: "User management" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bulk import" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New member" })).toBeInTheDocument();
    expect(screen.queryByText(/Manage members, access and quotas/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Member interface" })).not.toBeInTheDocument();
  });

  it("confirms ending a member's sessions in the shared UI dialog", async () => {
    const calls = renderUsers();
    const row = await screen.findByRole("row", { name: /Alice/ });

    fireEvent.click(within(row).getByRole("button", { name: "End all sessions" }));
    let dialog = await screen.findByRole("dialog", { name: "Revoke this user's sessions?" });
    expect(dialog).toHaveTextContent("All login sessions for Alice will end");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.path.endsWith("/revoke-sessions"))).toBe(false);

    fireEvent.click(within(row).getByRole("button", { name: "End all sessions" }));
    dialog = await screen.findByRole("dialog", { name: "Revoke this user's sessions?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "End all sessions" }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.path === "/admin/team/users/2/revoke-sessions" && call.method === "POST",
        ),
      ).toBe(true);
    });
  });

  it("sets token and spend limits for selected members in one bulk request", async () => {
    const calls = renderUsers();
    await screen.findByText("Alice");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alice" }));
    expect(screen.queryByRole("button", { name: "End all sessions" })).toBeInTheDocument();
    const bulkBar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bulkBar).queryByRole("button", { name: "End all sessions" })).toBeNull();
    fireEvent.click(within(bulkBar).getByRole("button", { name: "Adjust quotas" }));

    const dialog = await screen.findByRole("dialog", { name: /Adjust quotas/ });
    fireEvent.change(screen.getByLabelText("Token credit (tokens)"), {
      target: { value: "5000" },
    });
    fireEvent.change(screen.getByLabelText("Spend allowance"), { target: { value: "25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const request = calls.find(
        (call) => call.path === "/admin/team/users/bulk" && call.method === "POST",
      );
      expect(request?.body).toMatchObject({
        ids: [2],
        action: "quota",
        quota_total_tokens: 5000,
        quota_total_cost: 25,
        quota_reset: false,
      });
    });
  });

  it("opens member editing in a dialog with the save action in its footer", async () => {
    renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(dialog).toHaveClass("member-edit-dialog");
    expect(dialog.querySelector(".member-edit-heading")).toBeInTheDocument();
    expect(dialog.querySelector(".member-edit-intro")).not.toBeInTheDocument();
    expect(dialog.querySelectorAll(".member-edit-features > .check")).toHaveLength(2);
    expect(dialog.querySelectorAll(".member-edit-quota-grid > .team-field")).toHaveLength(2);
    expect(dialog.querySelectorAll(".member-edit-limit-grid > .team-field")).toHaveLength(3);
    expect(screen.getByLabelText("Concurrency limit")).toHaveValue(5);
    expect(saveButton).toHaveAttribute("form");
    expect(saveButton.closest('[data-slot="modal-footer"]')).not.toBeNull();
  });

  it("does not repeat the login name in the member heading", async () => {
    renderUsers({ memberOverride: { name: "Alice", username: "Alice" } });
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const heading = await screen.findByText("Alice", { selector: ".member-edit-heading strong" });
    const identity = heading.closest(".member-edit-heading");
    expect(identity?.textContent?.match(/Alice/g)).toHaveLength(1);
    expect(identity?.querySelector(".member-edit-heading__meta")).toHaveTextContent("Member");
  });

  it("redirects the removed quotas page to member management", async () => {
    const calls = renderUsers({ entry: "/users/quotas" });
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/admin/groups")).toBe(false);
  });

  it("selects callable models and filters available channels by model", async () => {
    renderUsers({ entry: "/users/policies" });
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]!);
    const saveButton = await screen.findByRole("button", { name: "Save" });
    expect(saveButton).toHaveAttribute("form", "policy-editor-form");
    expect(saveButton.closest('[data-slot="modal-footer"]')).not.toBeNull();

    const gemini = await screen.findByRole("checkbox", { name: /gemini-2\.5/ });
    expect(screen.queryByRole("textbox", { name: /callable models/i })).not.toBeInTheDocument();
    expect(screen.queryByText("OpenAI primary")).not.toBeInTheDocument();
    fireEvent.click(gemini);

    const geminiGroup = await screen.findByRole("button", { name: /gemini-2\.5/ });
    expect(geminiGroup).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(geminiGroup);
    expect(geminiGroup).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Gemini channel")).toBeInTheDocument();
    expect(screen.queryByText("OpenAI primary")).not.toBeInTheDocument();
    expect(screen.queryByText("#12")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all available channels" }));
    expect(screen.getByRole("checkbox", { name: /Gemini channel/ })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Allow every model" }));
    const openAIGroup = await screen.findByRole("button", { name: /gpt-4o/ });
    fireEvent.click(openAIGroup);
    expect(screen.getByText("OpenAI primary")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all available channels" }));
    expect(screen.getByRole("checkbox", { name: /OpenAI primary/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /OpenAI backup/ })).toBeChecked();
  });

  // The roster keeps money prominent while retaining the token ceiling below it.
  it("shows money and token totals and remaining balances in one quota column", async () => {
    renderUsers();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/10\.00/)).toBeInTheDocument();
    expect(screen.getByText(/7\.50/)).toBeInTheDocument();
    const tokenQuota = document.querySelector(".team-quota-line--tokens")?.textContent;
    expect(tokenQuota).toContain("1,000");
    expect(tokenQuota).toContain("750");
  });

  it("shows and updates each member's concurrency limit", async () => {
    const calls = renderUsers();
    expect(
      await screen.findByText("5", { selector: ".team-concurrency-limit" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const limit = await screen.findByLabelText("Concurrency limit");
    fireEvent.change(limit, { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH");
      expect(patch?.body).toMatchObject({ max_concurrent: 9 });
    });
  });

  it("opens concurrency adjustment from both a member row and bulk actions", async () => {
    const calls = renderUsers();
    const row = await screen.findByRole("row", { name: /Alice/ });
    fireEvent.click(within(row).getByRole("button", { name: "Adjust concurrency" }));
    expect(
      await screen.findByRole("dialog", { name: /Adjust concurrency · Alice/ }),
    ).toHaveTextContent("Current concurrency limit: 5");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.path === "/admin/team/users/2/concurrency" && call.method === "POST",
        ),
      ).toBe(true);
    });

    fireEvent.click(within(row).getByRole("checkbox", { name: "Select Alice" }));
    const bulkBar = screen.getByRole("region", { name: "Bulk actions" });
    fireEvent.click(within(bulkBar).getByRole("button", { name: "Adjust concurrency" }));
    expect(await screen.findByRole("dialog", { name: "Adjust concurrency · 1" })).toHaveTextContent(
      "Add the same number of concurrent requests",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.path === "/admin/team/users/bulk" &&
            call.method === "POST" &&
            call.body?.action === "concurrency",
        ),
      ).toBe(true);
    });
  });

  it("shows one unlimited label when neither quota is capped", async () => {
    renderUsers({ memberOverride: { quota_total_tokens: 0, quota_total_cost: 0 } });
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getAllByText("Unlimited")).toHaveLength(1);
    expect(screen.queryByText("Spend")).not.toBeInTheDocument();
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
  });

  it("saves both budgets from the member's own page", async () => {
    const calls = renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Adjust credit" }));
    const tokens = await screen.findByLabelText("Token credit (tokens)");
    const spend = screen.getByLabelText("Spend allowance");
    fireEvent.change(tokens, { target: { value: "5000" } });
    fireEvent.change(spend, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch?.path).toBe("/admin/team/users/2");
      expect(patch?.body).toMatchObject({
        quota_total_tokens: 5000,
        quota_total_cost: 25,
      });
    });
  });

  it("adds another authorization group to a member without replacing existing groups", async () => {
    const calls = renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const ds = await screen.findByRole("checkbox", { name: "DS" });
    fireEvent.click(ds);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch?.body).toMatchObject({ policy_ids: [1, 2] });
    });
  });
});
