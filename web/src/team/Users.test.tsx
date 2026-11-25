import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UsersLayout } from "./UsersLayout";
import { MembersPanel } from "./panels/MembersPanel";
import { QuotasPanel } from "./panels/QuotasPanel";
import type { TeamRequest } from "./types";

/**
 * The user-management module: which boards exist, and the two writes that were
 * previously impossible from the console — a member's spend allowance and a
 * tenant group's quotas.
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
const group = {
  name: "default",
  quota_total_tokens: 0,
  quota_used_tokens: 0,
  quota_total_cost: 0,
  quota_used_cost: 0,
  rate_per_minute: 0,
  rate_burst: 0,
};
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
  entry = "/",
}: { role?: string; mode?: "personal" | "team"; entry?: string } = {}) {
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
    if (path === "/admin/team/users") return [member] as T;
    if (path === "/admin/team/policies") return [policy, policyDS] as T;
    if (path === "/admin/groups") return [group] as T;
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
            <Route path="/" element={<UsersLayout request={request} />}>
              <Route index element={<Navigate to="members" replace />} />
              <Route path="members" element={<MembersPanel />} />
              <Route path="quotas" element={<QuotasPanel />} />
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
    expect(screen.queryByRole("heading", { name: "User management" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Manage members, access and quotas/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Member interface" })).not.toBeInTheDocument();
  });

  // The roster used to print the token pool alone, which is why "how much is
  // left" had no answer for a prepaid member: money runs out first.
  it("shows both budgets a member is limited by", async () => {
    renderUsers();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/250 \/ 1,000/)).toBeInTheDocument();
    expect(screen.getByText(/\$2\.50 \/ \$10\.00/)).toBeInTheDocument();
  });

  it("saves both budgets from the member's own page", async () => {
    const calls = renderUsers();
    // Each row now carries an action menu instead of an inline "Manage →" link:
    // the row's own actions (details, credit, danger) live behind one control,
    // which is also what made room for the identity and credit columns.
    fireEvent.click(await screen.findByRole("button", { name: /More actions/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Manage" }));
    const tokens = await screen.findByLabelText("Token credit limit");
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
    fireEvent.click(await screen.findByRole("button", { name: /More actions/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Manage" }));
    const ds = await screen.findByRole("checkbox", { name: "DS" });
    fireEvent.click(ds);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch?.body).toMatchObject({ policy_ids: [1, 2] });
    });
  });

  it("saves a tenant group's quotas in one request", async () => {
    const calls = renderUsers({ entry: "/quotas" });
    expect(await screen.findByText("Tenant group quotas")).toBeInTheDocument();
    // The group row's actions live behind the row menu, and the row arrives with
    // the query, so the trigger is awaited too.
    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    fireEvent.change(await screen.findByLabelText("Token credit limit"), {
      target: { value: "2000000" },
    });
    fireEvent.change(screen.getByLabelText("Spend allowance"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put?.path).toBe("/admin/groups/default");
      // The endpoint replaces the row, so every field travels — sending only
      // what changed would zero the rest.
      expect(put?.body).toMatchObject({
        quota_total_tokens: 2000000,
        quota_total_cost: 50,
        rate_per_minute: 0,
        rate_burst: 0,
      });
    });
  });
});
