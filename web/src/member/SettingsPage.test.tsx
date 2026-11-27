import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { teamText } from "../team/text";
import type { Account } from "../team/types";
import { SettingsPage } from "./SettingsPage";

const account: Account = {
  csrf: "test",
  user: {
    id: 7,
    username: "test",
    name: "Test User",
    role: "member",
    status: "active",
    policy_id: 1,
    policy_ids: [1],
    max_keys: 5,
    max_concurrent: 5,
    rpm: 60,
    allow_routing: true,
    allow_request_preferences: true,
    created_at: "2026-10-12",
    key_count: 0,
    quota_total_tokens: 0,
    quota_used_tokens: 0,
    quota_total_cost: 0,
    quota_used_cost: 0,
  },
  policies: [
    { id: 1, name: "Default", models: [], member_ids: [], all_models: true, user_count: 1 },
  ],
  branding: {
    name: "Gateway",
    logo_url: "",
    accent: "#275b85",
    notice: "",
    login_description: "",
    api_base_url: "",
    show_usage: true,
    show_routing: true,
  },
  credit: {
    total: 0,
    used: 0,
    available: 0,
    unlimited: true,
    cost_total: 0,
    cost_used: 0,
    cost_available: 0,
    cost_unlimited: true,
  },
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("meta-gateway.locale", "en");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(redeemError = false, redemptionsError = false, emptyRedemptions = false) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/me/redeem" && redeemError)
      return new Response(JSON.stringify({ error: "code_invalid" }), { status: 400 });
    if (path === "/me/sessions")
      return new Response(
        JSON.stringify([
          {
            id: "session-1",
            created_at: 1791806400,
            expires_at: 1794400000,
            current: true,
            device: "Chrome · Windows",
            ip_address: "42.200.177.141",
            login_method: "oauth:linuxdo",
            last_active_at: 1791806500,
          },
          {
            id: "session-2",
            created_at: 1791806400,
            expires_at: 1794400000,
            current: false,
            device: "Firefox · Linux",
            ip_address: "57.181.38.31",
            login_method: "password",
            last_active_at: 1791806400,
          },
        ]),
      );
    if (path === "/me/usage/summary")
      return new Response(JSON.stringify({ request_count: 4104, cost: 96.55 }));
    if (path === "/me/redemptions" && redemptionsError)
      return new Response(JSON.stringify({ error: "team_disabled" }), { status: 503 });
    if (path === "/me/redemptions")
      return new Response(
        JSON.stringify(
          emptyRedemptions
            ? []
            : [
                {
                  id: 1,
                  created_at: 1791806400,
                  quota_tokens: 1200,
                  quota_cost: 2.5,
                  quota_concurrent: 2,
                  grant_expires_at: 0,
                  grant_expired: false,
                  target: "account",
                },
              ],
        ),
      );
    if (path === "/me/sessions/session-1" && init?.method === "DELETE")
      return new Response(null, { status: 204 });
    if (path === "/me/sessions/others" && init?.method === "DELETE")
      return new Response(JSON.stringify({ ok: true }));
    return new Response("[]");
  });
  vi.stubGlobal("fetch", fetcher);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const onDisconnected = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SettingsPage account={account} t={teamText("en")} onDisconnected={onDisconnected} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { fetcher, onDisconnected };
}

it("shows personal information, credit and sessions without preference panels", async () => {
  mount();
  expect(screen.queryByRole("heading", { name: "Personal information" })).not.toBeInTheDocument();
  expect(
    screen.queryByText("View your account details, credit and login sessions."),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Test User")).toBeInTheDocument();
  expect(screen.getByText("@test")).toBeInTheDocument();
  expect(screen.getByText("Concurrency limit")).toBeInTheDocument();
  expect(screen.getAllByText("Created")).toHaveLength(1);
  const identity = screen.getByText("Test User").closest<HTMLElement>(".member-identity");
  expect(identity).not.toBeNull();
  expect(within(identity!).queryByText("Token credit")).not.toBeInTheDocument();
  expect(within(identity!).queryByText("Unlimited")).not.toBeInTheDocument();
  expect(within(identity!).queryByText(/Authorization groups/)).not.toBeInTheDocument();
  expect(within(identity!).queryByText("Gateway")).not.toBeInTheDocument();
  expect(await within(identity!).findByText("$96.55")).toBeInTheDocument();
  expect(within(identity!).getByText("4,104")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Token credit" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Redemption history" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View redemption history" })).toHaveClass(
    "button-link",
  );
  expect(
    screen.getByRole("button", { name: "View redemption history" }).closest(".field-label-row"),
  ).toBeInTheDocument();
  expect(screen.queryByText("1,200 tokens · $2.50 · +2 Concurrency limit")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View redemption history" }));
  const dialog = await screen.findByRole("dialog", { name: "Redemption history" });
  expect(dialog).toHaveClass("redemption-history-dialog");
  expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(1);
  expect(await screen.findByText("No expiry")).toBeInTheDocument();
  expect(screen.getByText("1,200 tokens · $2.50 · +2 Concurrency limit")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.getByRole("heading", { name: "Login sessions" })).toBeInTheDocument();
  expect(screen.getByText("Chrome · Windows")).toBeInTheDocument();
  expect(screen.getByText(/42\.200\.177\.141/)).toBeInTheDocument();
  expect(screen.getByText(/OAuth · Linux\.do/)).toBeInTheDocument();
  expect(screen.getByText("Current session")).toBeInTheDocument();
  expect(screen.getAllByText(/Last active:/)).toHaveLength(2);
  expect(screen.queryByText("Request preferences")).not.toBeInTheDocument();
  expect(screen.queryByText("Interface preferences")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  expect(await screen.findAllByRole("button", { name: "Revoke" })).toHaveLength(2);
});

it("loads redemption history only after opening the dialog and shows service errors there", async () => {
  const { fetcher } = mount(false, true);
  expect(fetcher.mock.calls.some(([path]) => path === "/me/redemptions")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "View redemption history" }));
  const dialog = await screen.findByRole("dialog", { name: "Redemption history" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Team service is not enabled");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.getByRole("heading", { name: "Login sessions" })).toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([path]) => path === "/me/redemptions")).toHaveLength(1);
});

it("keeps the redemption history list visible when there are no records", async () => {
  mount(false, false, true);
  fireEvent.click(screen.getByRole("button", { name: "View redemption history" }));
  const dialog = await screen.findByRole("dialog", { name: "Redemption history" });
  expect(await within(dialog).findByRole("table")).toBeInTheDocument();
  expect(within(dialog).getAllByRole("columnheader")).toHaveLength(4);
  expect(
    within(dialog).getByText("No redemption records yet. Completed redemptions will appear here."),
  ).toBeInTheDocument();
});

it("revokes a selected session and reloads the session list", async () => {
  const { fetcher } = mount();
  fireEvent.click((await screen.findAllByRole("button", { name: "Revoke" }))[0]!);
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([path, init]) => path === "/me/sessions/session-1" && init?.method === "DELETE",
      ),
    ).toBe(true),
  );
});

it("signs out other sessions after confirmation", async () => {
  const { fetcher } = mount();
  fireEvent.click(await screen.findByRole("button", { name: "Sign out other sessions" }));
  const dialog = await screen.findByRole("dialog", { name: "Sign out other sessions" });
  expect(
    within(dialog).getByText(
      "Sign out your other login sessions? Those devices will need to sign in again.",
    ),
  ).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign out other sessions" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([path, init]) => path === "/me/sessions/others" && init?.method === "DELETE",
      ),
    ).toBe(true),
  );
});

it("explains an invalid redemption code in plain language", async () => {
  mount(true);
  fireEvent.change(screen.getByLabelText("Redemption code"), {
    target: { value: "11111111" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This redemption code is invalid, expired, or has reached its use limit.",
  );
  expect(screen.queryByText(/code_invalid/)).not.toBeInTheDocument();
});
