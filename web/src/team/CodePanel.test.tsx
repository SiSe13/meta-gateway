import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { teamText } from "./text";
import type { Policy, TeamRequest } from "./types";
import { CodePanel } from "./CodePanel";

const policy: Policy = {
  id: 1,
  name: "Default",
  models: [],
  member_ids: [],
  all_models: false,
  user_count: 0,
};
const secondPolicy: Policy = {
  ...policy,
  id: 2,
  name: "Research",
};

describe("team code panel", () => {
  afterEach(() => cleanup());

  it("opens minting in a dialog and keeps the one-time result there", async () => {
    const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });
      if (path === "/admin/team/codes" && method === "GET") return [] as T;
      if (path === "/admin/team/codes" && method === "POST") {
        return {
          codes: [{ id: 9, code: "MG-ONE-TIME", path: "/console", label: "" }],
        } as T;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <CodePanel request={request} policies={[policy]} locale="en" t={teamText("en")} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Generate codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Generate codes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate codes" }));

    expect(await screen.findByText("MG-ONE-TIME")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "1 codes generated" })).toBeInTheDocument();
    await waitFor(() => {
      expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
        kind: "invite",
        count: 1,
        policy_id: 1,
      });
    });
  });

  it("mints concurrency codes with the requested additional slots", async () => {
    let submitted: Record<string, unknown> | undefined;
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      if (path === "/admin/team/codes" && init?.method !== "POST") return [] as T;
      if (path === "/admin/team/codes" && init?.method === "POST") {
        submitted = JSON.parse(String(init.body));
        return { codes: [{ id: 12, code: "MG-CONCURRENT", path: "/console", label: "" }] } as T;
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <CodePanel request={request} policies={[policy]} locale="en" t={teamText("en")} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Generate codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Generate codes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Kind" }));
    fireEvent.click(await screen.findByRole("option", { name: "Concurrency code" }));
    expect(within(dialog).getByLabelText("Additional concurrent requests")).toHaveValue(1);
    fireEvent.change(within(dialog).getByLabelText("Additional concurrent requests"), {
      target: { value: "4" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate codes" }));

    await waitFor(() => {
      expect(submitted).toMatchObject({ kind: "concurrency", quota_concurrent: 4 });
    });
  });

  it("lets credit codes expire after redemption and submits the separate validity", async () => {
    let submitted: Record<string, unknown> | undefined;
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      if (path === "/admin/team/codes" && init?.method !== "POST") return [] as T;
      if (path === "/admin/team/codes" && init?.method === "POST") {
        submitted = JSON.parse(String(init.body));
        return { codes: [{ id: 12, code: "MG-TEMP-CREDIT", path: "/console", label: "" }] } as T;
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <CodePanel request={request} policies={[policy]} locale="en" t={teamText("en")} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Generate codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Generate codes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Kind" }));
    fireEvent.click(await screen.findByRole("option", { name: "Credit code" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Validity after redemption/ }));
    fireEvent.click(await screen.findByRole("option", { name: "30 days" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate codes" }));

    await waitFor(() => {
      expect(submitted).toMatchObject({ kind: "credit", grant_validity_days: 30 });
    });
  });

  it("offers a permanent redemption window and submits it without an expiry", async () => {
    let submitted: Record<string, unknown> | undefined;
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      if (path === "/admin/team/codes" && init?.method !== "POST") return [] as T;
      if (path === "/admin/team/codes" && init?.method === "POST") {
        submitted = JSON.parse(String(init.body));
        return { codes: [{ id: 13, code: "MG-PERMANENT", path: "/console", label: "" }] } as T;
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <CodePanel request={request} policies={[policy]} locale="en" t={teamText("en")} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Generate codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Generate codes" });
    expect(
      within(dialog).getByRole("img", { name: /Redeem the code within this window/ }),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Redemption window/ }));
    expect(await screen.findByRole("option", { name: "30 days" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Never expires" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate codes" }));

    await waitFor(() => {
      expect(submitted).toMatchObject({ expires_in_hours: 0 });
    });
  });

  it("includes all selected authorization groups in signup codes", async () => {
    let submitted: Record<string, unknown> | undefined;
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      if (path === "/admin/team/codes" && init?.method !== "POST") return [] as T;
      if (path === "/admin/team/codes" && init?.method === "POST") {
        submitted = JSON.parse(String(init.body));
        return { codes: [{ id: 14, code: "MG-MULTI", path: "/console", label: "" }] } as T;
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <CodePanel
            request={request}
            policies={[policy, secondPolicy]}
            locale="en"
            t={teamText("en")}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Generate codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Generate codes" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Research" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate codes" }));

    await waitFor(() => {
      expect(submitted).toMatchObject({ kind: "invite", policy_id: 1, policy_ids: [1, 2] });
    });
  });

  it("shows only credit fields when minting a credit code", async () => {
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      if (path === "/admin/team/codes" && init?.method !== "POST") return [] as T;
      if (path === "/admin/team/codes" && init?.method === "POST") {
        return { codes: [{ id: 13, code: "MG-CREDIT", path: "/console", label: "" }] } as T;
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <CodePanel request={request} policies={[policy]} locale="en" t={teamText("en")} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Generate codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Generate codes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Kind" }));
    fireEvent.click(await screen.findByRole("option", { name: "Credit code" }));

    expect(within(dialog).getByLabelText("Credit (tokens)")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Policy")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Role")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Invitation note")).not.toBeInTheDocument();
  });

  it("reveals and copies an active code from the list", async () => {
    const calls: { path: string; method: string }[] = [];
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ path, method });
      if (path === "/admin/team/codes" && method === "GET") {
        return [
          {
            id: 8,
            kind: "invite",
            label: "",
            note: "",
            policy_id: 1,
            role: "member",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            max_uses: 1,
            used_count: 0,
            quota_tokens: 0,
            quota_cost: 0,
            quota_concurrent: 0,
            revoked: false,
            created_at: "2026-11-27T00:00:00Z",
            prefix: "MG",
            revealable: true,
          },
        ] as T;
      }
      if (path === "/admin/team/codes/8/reveal" && method === "POST") {
        return { code: "MG-REVEAL-LATER" } as T;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <CodePanel request={request} policies={[policy]} locale="en" t={teamText("en")} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog", { name: "View code" });
    expect(await within(dialog).findByText("MG-REVEAL-LATER")).toBeInTheDocument();
    expect(calls).toContainEqual({ path: "/admin/team/codes/8/reveal", method: "POST" });
  });

  it("places a present invitation note after status and shows revoke directly", async () => {
    const calls: { path: string; method: string }[] = [];
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ path, method });
      if (path === "/admin/team/codes" && method === "GET") {
        return [
          {
            id: 3,
            kind: "invite",
            label: "October cohort",
            note: "",
            policy_id: 1,
            role: "member",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            max_uses: 1,
            used_count: 0,
            quota_tokens: 0,
            quota_cost: 0,
            revoked: false,
            created_at: "2026-11-27T00:00:00Z",
            prefix: "MG",
          },
        ] as T;
      }
      return {} as T;
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <CodePanel request={request} policies={[policy]} locale="en" t={teamText("en")} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    const headers = await screen.findAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Kind",
      "Used / limit",
      "Token credit",
      "Status",
      "Invitation note",
      "Actions",
    ]);
    expect(screen.getByText("October cohort")).toBeInTheDocument();
    expect(
      screen.getByText("Older code unavailable; revoke it and generate a new one"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ path: "/admin/team/codes/3", method: "DELETE" }),
    );
  });

  it("hides the invitation note column when all notes are empty", async () => {
    const request: TeamRequest = async <T,>(path: string) => {
      if (path === "/admin/team/codes") {
        return [
          {
            id: 4,
            kind: "credit",
            label: "",
            note: "",
            policy_id: 1,
            role: "member",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            max_uses: 1,
            used_count: 0,
            quota_tokens: 1000,
            quota_cost: 0,
            revoked: false,
            created_at: "2026-11-27T00:00:00Z",
            prefix: "MG",
          },
        ] as T;
      }
      return {} as T;
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <CodePanel request={request} policies={[policy]} locale="en" t={teamText("en")} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Invitation note" })).not.toBeInTheDocument();
  });
});
