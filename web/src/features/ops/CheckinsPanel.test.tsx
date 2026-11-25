import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SessionProvider } from "../../session";
import { ToastProvider } from "../../toast";
import { CheckinsPanel } from "./CheckinsPanel";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Only the fields the panel reads; the rest of the document is irrelevant here. */
const settings = (overrides: Record<string, unknown>) => ({
  source: "environment",
  has_override: false,
  note: "",
  editable: {
    retry_times: 2,
    cross_channel_failover_enabled: true,
    cooldown_seconds: 30,
    fault_protection_enabled: true,
    checkin_enabled: false,
    checkin_cron: "0 8 * * *",
  },
  env_bootstrap: {},
  server_http_addr: ":4100",
  data_dir: "/data",
  backup_dir: "/data/backups",
  plugins_dir: "/data/plugins",
  metrics_token_masked: "",
  ...overrides,
});

function setup(payload: Record<string, unknown>, logRows: unknown[] = []) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const logQueries: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      if (path === "/admin/runtime-settings") {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          calls.push({ path, body });
          return response(
            settings({
              source: "admin_override",
              has_override: true,
              editable: { ...(payload.editable as object), ...body },
            }),
          );
        }
        return response(payload);
      }
      if (path === "/admin/checkin/logs") {
        logQueries.push(url.search);
        return response(logRows);
      }
      if (path === "/admin/sites") {
        return response([{ id: 7, name: "示例站点", base_url: "https://example.com" }]);
      }
      if (path === "/admin/checkin/run") {
        return response({ items: [], success_count: 2, failure_count: 1, skipped_count: 0 });
      }
      return response({ error: `unexpected ${path}` }, 500);
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ToastProvider>
          <SessionProvider>
            <CheckinsPanel />
          </SessionProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { calls, logQueries };
}

describe("scheduled check-in panel", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("meta-gateway.locale", "zh-CN");
    localStorage.setItem("meta-gateway.admin-token", "test-token");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // The schedule is only durable when the console owns it: an environment-fed
  // schedule reverts to the compose default the moment the container is
  // recreated, which reads as "the update deleted my setting".
  it("says when the schedule still comes from the environment", async () => {
    setup(settings({}));
    const settingsButton = await screen.findByRole("button", { name: "设置" });
    await waitFor(() => expect(settingsButton).toBeEnabled());
    fireEvent.click(settingsButton);
    expect(await screen.findByText(/定时设置来源：环境变量/)).toBeInTheDocument();
    // One short line, not a paragraph: the mechanics behind it (which env vars,
    // what a compose rebuild re-reads) live in the panel's (i).
    expect(screen.getByText(/重建容器会读回 .env/)).toBeInTheDocument();
  });

  it("drops the environment warning once the console saved an override", async () => {
    setup(
      settings({
        source: "admin_override",
        has_override: true,
        editable: {
          retry_times: 2,
          cross_channel_failover_enabled: true,
          cooldown_seconds: 30,
          fault_protection_enabled: true,
          checkin_enabled: true,
          checkin_cron: "0 9 * * *",
        },
      }),
    );
    const settingsButton = await screen.findByRole("button", { name: "设置" });
    await waitFor(() => expect(settingsButton).toBeEnabled());
    fireEvent.click(settingsButton);
    expect(await screen.findByText("定时设置来源：管理端覆盖")).toBeInTheDocument();
    expect(screen.queryByText(/重建容器会读回 .env/)).not.toBeInTheDocument();
  });

  it("saves the schedule as a console override", async () => {
    const { calls } = setup(settings({}));
    const settingsButton = await screen.findByRole("button", { name: "设置" });
    await waitFor(() => expect(settingsButton).toBeEnabled());
    fireEvent.click(settingsButton);
    // Wait for the settings document: the checkbox stays disabled until it arrives.
    await screen.findByText(/定时设置来源：环境变量/);
    // Turning the schedule on is what pins it: the save carries the flag and
    // the cron in one document, so a rebuild keeps running at that time.
    fireEvent.click(screen.getByLabelText("启用定时签到"));
    fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toMatchObject({ checkin_enabled: true, checkin_cron: "0 8 * * *" });
  });

  // A manual run's outcome must not be visible only in the result strip below
  // the history table: the toast is what makes a failed count noticeable.
  it("shows a failed manual run as an explicit error toast", async () => {
    setup(settings({}));
    await screen.findByRole("button", { name: "设置" });
    fireEvent.click(screen.getByRole("button", { name: "运行已启用项" }));
    const confirmButtons = await screen.findAllByRole("button", { name: "运行已启用项" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    expect(await screen.findByText("签到完成：2 成功 · 1 失败 · 0 跳过")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("签到完成：2 成功 · 1 失败 · 0 跳过");
  });

  it("filters logs by site, local date, and translated status", async () => {
    const { logQueries } = setup(settings({}));
    const siteFilter = await screen.findByLabelText("站点筛选");
    const dateGroup = screen.getByRole("group", { name: "签到日期" });
    const statusFilter = screen.getByLabelText("状态筛选");

    for (const [segmentType, value] of [
      ["month", "10"],
      ["day", "15"],
      ["year", "2026"],
    ] as [string, string][]) {
      const segment = dateGroup.querySelector<HTMLElement>(`[data-type="${segmentType}"]`);
      expect(segment).not.toBeNull();
      segment!.focus();
      for (const digit of value) {
        fireEvent(
          segment!,
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: digit,
          }),
        );
      }
    }
    expect(screen.getByRole("option", { name: "成功" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "失败" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "已跳过" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "示例站点" })).toBeInTheDocument();

    fireEvent.change(siteFilter, { target: { value: "7" } });
    fireEvent.change(statusFilter, { target: { value: "failed" } });

    await waitFor(() => {
      const query = logQueries
        .map((value) => new URLSearchParams(value))
        .find(
          (params) =>
            params.get("site_id") === "7" &&
            params.get("status") === "failed" &&
            params.get("since") === new Date("2026-10-15T00:00:00").toISOString() &&
            params.get("until") === new Date("2026-10-16T00:00:00").toISOString(),
        );
      expect(query).toBeDefined();
    });
  });

  it("shows just the site name in the history list", async () => {
    setup(settings({}), [
      {
        id: 1,
        site_id: 7,
        credential_id: 9,
        source: "manual",
        status: "success",
        category: "checked_in",
        message: "",
        reward: "3.5",
        latency_ms: 10,
        ran_at: "2026-11-24T00:00:00Z",
      },
    ]);
    expect(await screen.findByRole("cell", { name: "示例站点" })).toBeInTheDocument();
    expect(screen.queryByText(/#7|example\.com|凭证 #9/)).not.toBeInTheDocument();
  });
});
