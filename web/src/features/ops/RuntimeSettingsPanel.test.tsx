import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Link, MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { I18nProvider } from "../../i18n";
import { SessionProvider } from "../../session";
import { ToastProvider } from "../../toast";
import { RuntimeSettingsPanel } from "./RuntimeSettingsPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function mount(
  children: ReactNode,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  initialEntries = ["/"],
) {
  localStorage.setItem("meta-gateway.locale", "en");
  localStorage.setItem("meta-gateway.admin-token", "test-token");
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ToastProvider>
          <SessionProvider>
            <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
          </SessionProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return client;
}

/**
 * Only the keys a test needs are present: everything else renders empty, and an
 * absent key is not what these tests are about. `env_bootstrap` is the
 * deployment layer every "changed" badge is measured against.
 */
const payload = (
  editable: Record<string, unknown> = {},
  bootstrap: Record<string, unknown> = {},
) => ({
  source: "admin_override",
  has_override: true,
  note: "",
  updated_at: "2026-10-06T00:00:00Z",
  editable: {
    cross_channel_failover_enabled: true,
    retry_times: 2,
    images_failover_enabled: false,
    images_failover_include_ambiguous: false,
    images_failover_include_uncertain: false,
    routing_latency_aware: false,
    ...editable,
  },
  env_bootstrap: {
    cross_channel_failover_enabled: true,
    retry_times: 2,
    images_failover_enabled: false,
    images_failover_include_ambiguous: false,
    images_failover_include_uncertain: false,
    routing_latency_aware: false,
    ...bootstrap,
  },
});

/**
 * A fake runtime-settings endpoint that remembers what was PUT: instant save
 * means the panel re-reads after every write, and a mock that always answered
 * with the pre-write values would look like the save was thrown away.
 */
function runtimeServer(read: () => Record<string, unknown>) {
  const puts: Array<Record<string, unknown>> = [];
  let stored: Record<string, unknown> | null = null;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0];
    if (path === "/admin/mode") {
      return new Response(
        JSON.stringify({
          mode: "personal",
          has_owner: true,
          role: "owner",
          owner_bootstrap_available: true,
        }),
      );
    }
    if (path !== "/admin/runtime-settings") return new Response(JSON.stringify({}));
    const base = read();
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      puts.push(body);
      stored = body;
      return new Response(JSON.stringify({ ...base, editable: body }));
    }
    return new Response(JSON.stringify({ ...base, editable: stored ?? base.editable }));
  });
  return { fetcher, puts };
}

it("shows an initial load failure with a working retry instead of endless loading", async () => {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response('{"error":"runtime_read_failed"}', { status: 500 }),
  );
  vi.stubGlobal("fetch", fetcher);
  mount(<RuntimeSettingsPanel />);
  const retry = await screen.findByRole("button", { name: "Retry" });
  const reads = () =>
    fetcher.mock.calls.filter(([path]) => String(path).includes("/runtime-settings")).length;
  const before = reads();
  expect(before).toBeGreaterThan(0);
  fireEvent.click(retry);
  await waitFor(() => expect(reads()).toBeGreaterThan(before));
});

// The shell sidebar owns settings navigation; a section query restores the
// selected group without rendering a second menu inside the page.
it("opens the requested settings group from its section URL", async () => {
  vi.stubGlobal("fetch", runtimeServer(() => payload()).fetcher);
  mount(<RuntimeSettingsPanel />, undefined, ["/settings?tab=runtime&section=keepalive"]);

  expect(
    await screen.findByRole("heading", { name: "Account keepalive settings" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: /Failure cooldown|Cooldown/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Settings section")).not.toBeInTheDocument();
});

it("shows the related routing cards together under the consolidated menu entry", async () => {
  vi.stubGlobal("fetch", runtimeServer(() => payload()).fetcher);
  mount(<RuntimeSettingsPanel />, undefined, ["/settings?tab=runtime&section=routing"]);

  expect(await screen.findByRole("heading", { name: "Routing strategy" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "New-channel stability trial" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Session affinity" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Request failover" })).not.toBeInTheDocument();
});

it("shows both recovery forms directly in the merged runtime menu section", async () => {
  vi.stubGlobal("fetch", runtimeServer(() => payload()).fetcher);
  mount(<RuntimeSettingsPanel />, undefined, ["/settings?tab=runtime&section=recovery"]);

  expect(await screen.findByRole("heading", { name: "Reset to environment" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reset to environment" })).toBeInTheDocument();
  expect(screen.getByText("Factory reset")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start factory reset…" })).toBeInTheDocument();
  expect(screen.queryByText("Danger zone")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Runtime parameters" })).not.toBeInTheDocument();
});

it("shows the operating mode control directly in account security settings", async () => {
  vi.stubGlobal("fetch", runtimeServer(() => payload()).fetcher);
  mount(<RuntimeSettingsPanel />, undefined, ["/settings?tab=runtime&section=users"]);

  expect(await screen.findByRole("button", { name: "Operating mode" })).toHaveTextContent(
    "Personal",
  );
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: /Open user management/ })).not.toBeInTheDocument();
});

// Sidebar links change only the section query. Switching between groups must
// preserve an in-progress draft and never trigger a settings write.
it("follows sidebar section links without writing or losing the draft", async () => {
  const server = runtimeServer(() => payload());
  vi.stubGlobal("fetch", server.fetcher);
  mount(
    <>
      <Link to="/settings?tab=runtime&section=keepalive">Keepalive menu</Link>
      <Link to="/settings?tab=runtime&section=relay">Relay menu</Link>
      <RuntimeSettingsPanel />
    </>,
    undefined,
    ["/settings?tab=runtime&section=relay"],
  );

  const rounds = (await screen.findByLabelText(/Retry rounds/)) as HTMLInputElement;
  fireEvent.change(rounds, { target: { value: "40" } });

  fireEvent.click(screen.getByRole("link", { name: "Keepalive menu" }));
  expect(
    await screen.findByRole("heading", { name: "Account keepalive settings" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText(/Retry rounds/)).not.toBeInTheDocument();
  // Navigation is not a save.
  expect(server.puts).toHaveLength(0);

  fireEvent.click(screen.getByRole("link", { name: "Relay menu" }));
  expect((screen.getByLabelText(/Retry rounds/) as HTMLInputElement).value).toBe("40");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
});

// I04's other half: a background refetch used to replace the draft whenever the
// query data changed, so another session's save silently erased what was being
// typed. The page must say the server moved and let the operator choose.
it("reports a changed server snapshot instead of overwriting the draft", async () => {
  let current = payload();
  vi.stubGlobal("fetch", runtimeServer(() => current).fetcher);
  const qc = mount(<RuntimeSettingsPanel />);
  const rounds = (await screen.findByLabelText(/Retry rounds/)) as HTMLInputElement;
  expect(rounds.value).toBe("2");

  fireEvent.change(rounds, { target: { value: "40" } });
  expect(rounds.value).toBe("40");

  current = payload({ retry_times: 9 });
  await qc.invalidateQueries({ queryKey: ["runtime-settings"] });

  expect(await screen.findByText(/The server's runtime parameters changed/)).toBeInTheDocument();
  // The edit is still there — the notice is the point, not a silent reset.
  expect(rounds.value).toBe("40");

  fireEvent.click(screen.getByRole("button", { name: "Reload server settings" }));
  await waitFor(() => expect(rounds.value).toBe("9"));
  expect(screen.queryByText(/The server's runtime parameters changed/)).toBeNull();
});

it("keeps the local draft when the operator chooses their side", async () => {
  let current = payload();
  vi.stubGlobal("fetch", runtimeServer(() => current).fetcher);
  const qc = mount(<RuntimeSettingsPanel />);
  const rounds = (await screen.findByLabelText(/Retry rounds/)) as HTMLInputElement;
  fireEvent.change(rounds, { target: { value: "40" } });

  current = payload({ retry_times: 9 });
  await qc.invalidateQueries({ queryKey: ["runtime-settings"] });
  await screen.findByText(/The server's runtime parameters changed/);

  fireEvent.click(screen.getByRole("button", { name: "Keep my changes" }));
  await waitFor(() =>
    expect(screen.queryByText(/The server's runtime parameters changed/)).toBeNull(),
  );
  expect(rounds.value).toBe("40");
  // The unsaved marker stays: the draft is still uncommitted.
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
});

// There is no Save button any more, so the only moment that may write is the
// moment the operator leaves the field — never a keystroke, because "300" on
// its way to "3" is a valid-looking timeout that must never reach production.
it("writes the draft when a field is left, and not while it is being typed", async () => {
  const server = runtimeServer(() => payload());
  vi.stubGlobal("fetch", server.fetcher);
  mount(<RuntimeSettingsPanel />);
  const rounds = (await screen.findByLabelText(/Retry rounds/)) as HTMLInputElement;

  fireEvent.change(rounds, { target: { value: "3" } });
  expect(server.puts).toHaveLength(0);
  fireEvent.change(rounds, { target: { value: "30" } });
  expect(server.puts).toHaveLength(0);

  fireEvent.focusOut(rounds);
  await waitFor(() => expect(server.puts).toHaveLength(1));
  // The whole draft goes up, not just the touched field: the endpoint replaces
  // the override as one unit.
  expect(server.puts[0]!.retry_times).toBe(30);
  expect(server.puts[0]!.cross_channel_failover_enabled).toBe(true);

  expect(await screen.findByText(/Saved and applied without restart/)).toBeInTheDocument();
});

it("saves a checkbox on the change itself, with no blur to wait for", async () => {
  const server = runtimeServer(() => payload());
  vi.stubGlobal("fetch", server.fetcher);
  mount(<RuntimeSettingsPanel />, undefined, ["/settings?tab=runtime&section=routing"]);

  fireEvent.click(await screen.findByRole("switch", { name: /Latency-aware routing/ }));
  await waitFor(() => expect(server.puts).toHaveLength(1));
  expect(server.puts[0]!.routing_latency_aware).toBe(true);
});

// The image escape hatch is a deliberate exception to "a billed generation is
// never replayed", so the panel must be able to turn it on without a restart —
// and must show it as an override once it is on.
it("turns image-write failover on and marks it as an override", async () => {
  const server = runtimeServer(() => payload());
  vi.stubGlobal("fetch", server.fetcher);
  mount(<RuntimeSettingsPanel />);

  const toggle = (await screen.findByRole("switch", {
    name: /Fail over image requests/,
  })) as HTMLInputElement;
  expect(toggle.checked).toBe(false);

  fireEvent.click(toggle);
  await screen.findByText(/Turn on “fail over image requests”\?/);
  fireEvent.click(screen.getByRole("button", { name: /Turn on with the selected scope/ }));
  await waitFor(() => expect(server.puts).toHaveLength(1));
  expect(server.puts[0]!.images_failover_enabled).toBe(true);
  expect(await screen.findByText(/Saved and applied without restart/)).toBeInTheDocument();

  const row = toggle.closest(".field")!;
  expect(row.textContent).toContain("Changed");
});

// The page carries ONE switch; its scope is chosen in the arming dialog. The
// base scope (refusals only) costs nothing extra, so confirming without the
// options is the safe default — and cancel writes nothing at all.
it("opens the scope dialog when the image switch is armed, and writes only after confirmation", async () => {
  const server = runtimeServer(() => payload({ images_failover_enabled: false }));
  vi.stubGlobal("fetch", server.fetcher);
  mount(<RuntimeSettingsPanel />);

  const main = (await screen.findByRole("switch", {
    name: /Fail over image requests/,
  })) as HTMLInputElement;
  fireEvent.click(main);

  expect(server.puts).toHaveLength(0);
  expect(await screen.findByText(/Turn on “fail over image requests”\?/)).toBeInTheDocument();
  expect(main.checked).toBe(false);

  // Cancel: nothing written, the box stays where it was.
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByText(/fail over image requests”\?/)).toBeNull());
  expect(server.puts).toHaveLength(0);
  expect(main.checked).toBe(false);

  // Confirm with no options: base scope only.
  fireEvent.click(main);
  fireEvent.click(await screen.findByRole("button", { name: /Turn on with the selected scope/ }));
  await waitFor(() => expect(server.puts).toHaveLength(1));
  expect(server.puts[0]!.images_failover_enabled).toBe(true);
  expect(server.puts[0]!.images_failover_include_ambiguous).toBe(false);
  expect(server.puts[0]!.images_failover_include_uncertain).toBe(false);
  expect(main.checked).toBe(true);
});

// The two options widen the replay set from inside the dialog. The blunt one
// already covers 5xx, so checking it pulls the narrower box along instead of
// leaving the two choices contradicting each other.
it("writes the selected scope, and the blunt option implies the 5xx one", async () => {
  const server = runtimeServer(() => payload({ images_failover_enabled: false }));
  vi.stubGlobal("fetch", server.fetcher);
  mount(<RuntimeSettingsPanel />);

  const main = (await screen.findByRole("switch", {
    name: /Fail over image requests/,
  })) as HTMLInputElement;
  fireEvent.click(main);
  await screen.findByText(/Turn on “fail over image requests”\?/);

  const five = screen.getByRole("switch", { name: /Also retry 5xx/ }) as HTMLInputElement;
  const blunt = screen.getByRole("switch", {
    name: /Retry 504, timeouts and broken streams too/,
  }) as HTMLInputElement;
  fireEvent.click(blunt);
  expect(blunt.checked).toBe(true);
  expect(five.checked).toBe(true);
  expect(five.disabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: /Turn on with the selected scope/ }));
  await waitFor(() => expect(server.puts).toHaveLength(1));
  expect(server.puts[0]!.images_failover_enabled).toBe(true);
  expect(server.puts[0]!.images_failover_include_ambiguous).toBe(true);
  expect(server.puts[0]!.images_failover_include_uncertain).toBe(true);
});

// Turning the switch off must clear the whole scope, otherwise the next enable
// would silently restore a setting that was only ever armed through a warning.
it("clears the whole scope when the image switch goes off", async () => {
  const server = runtimeServer(() =>
    payload({
      images_failover_enabled: true,
      images_failover_include_ambiguous: true,
      images_failover_include_uncertain: true,
    }),
  );
  vi.stubGlobal("fetch", server.fetcher);
  mount(<RuntimeSettingsPanel />);

  const main = (await screen.findByRole("switch", {
    name: /Fail over image requests/,
  })) as HTMLInputElement;
  fireEvent.click(main);
  await waitFor(() => expect(server.puts).toHaveLength(1));
  expect(server.puts[0]!.images_failover_enabled).toBe(false);
  expect(server.puts[0]!.images_failover_include_ambiguous).toBe(false);
  expect(server.puts[0]!.images_failover_include_uncertain).toBe(false);
});

// With instant save the operator needs to see, without a Save button to compare
// against, which values override the deployment and which are just the default.
it("marks the fields that override the deployment default, and their section", async () => {
  vi.stubGlobal(
    "fetch",
    runtimeServer(() => payload({ retry_times: 9 }, { retry_times: 2 })).fetcher,
  );
  mount(<RuntimeSettingsPanel />);

  const relay = await screen.findByRole("heading", { name: "Request failover" });
  expect(relay.closest(".runtime-section")?.querySelector(".setting-state")).toHaveTextContent(
    "Changed",
  );

  // A row that differs from the deployment default says so; a row that does not
  // says nothing. A "Default" chip on every untouched row was noise — the answer
  // worth a mark is "I changed this".
  const changedRow = screen.getByLabelText(/Retry rounds/).closest(".field")!;
  expect(changedRow.textContent).toContain("Changed");
  const defaultRow = screen.getByLabelText(/Same-key re-sends/).closest(".field")!;
  expect(defaultRow.querySelector(".setting-state")).toBeNull();
  // The row keeps its explanation, but only a one-line hint stays visible: this
  // one is a paragraph, so it rides in the (i) beside the label. What must not
  // happen is the explanation disappearing — hence "a hint or a tip", and the
  // tip carries the text as its accessible name.
  expect(defaultRow.querySelector(".field-hint, .info-tip")).not.toBeNull();
});

it("restores one section to the deployment defaults without touching the rest", async () => {
  const server = runtimeServer(() =>
    payload({ retry_times: 9, sticky_enabled: false }, { retry_times: 2, sticky_enabled: true }),
  );
  vi.stubGlobal("fetch", server.fetcher);
  mount(<RuntimeSettingsPanel />);

  const restoreButtons = await screen.findAllByRole("button", { name: "Restore this section" });
  fireEvent.click(restoreButtons[0]!);
  await waitFor(() => expect(server.puts).toHaveLength(1));
  expect(server.puts[0]!.retry_times).toBe(2);
  // Sticky sessions are another section's business and stay as the operator
  // left them.
  expect(server.puts[0]!.sticky_enabled).toBe(false);
});

it("shows the environment layer read-only, folded into the service section", async () => {
  vi.stubGlobal(
    "fetch",
    runtimeServer(() => ({
      ...payload(),
      deployment_parameters: [
        {
          key: "OUTBOUND_IMAGE_HEADER_TIMEOUT_SECONDS",
          kind: "duration",
          value: "5m0s",
          from_env: false,
          secret: false,
        },
        {
          key: "OUTBOUND_HEADER_TIMEOUT_SECONDS",
          kind: "duration",
          value: "1m0s",
          from_env: true,
          secret: false,
        },
        { key: "MASTER_KEY", kind: "string", value: "••••••", from_env: true, secret: true },
      ],
    })).fetcher,
  );
  mount(<RuntimeSettingsPanel />, undefined, ["/settings?tab=runtime&section=server"]);

  // Folded until asked for: the variable list is a fact about the deployment,
  // not a knob, and it should not out-shout the settings above it.
  const toggle = await screen.findByRole("button", { name: /Deployment parameters \(env\)/ });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByLabelText("Filter variables")).toBeNull();
  fireEvent.click(toggle);

  // Only what the container actually set is listed until asked otherwise: a
  // value that fell back to a code default is the same on every deployment.
  expect(await screen.findByText("OUTBOUND_HEADER_TIMEOUT_SECONDS")).toBeInTheDocument();
  expect(screen.getByText("MASTER_KEY")).toBeInTheDocument();
  expect(screen.queryByText("OUTBOUND_IMAGE_HEADER_TIMEOUT_SECONDS")).toBeNull();
  expect(screen.getAllByText("env", { selector: ".runtime-param-source" })).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "Show all 1" }));
  expect(screen.getByText("OUTBOUND_IMAGE_HEADER_TIMEOUT_SECONDS")).toBeInTheDocument();
  expect(screen.getByText("5m0s")).toBeInTheDocument();
  expect(screen.getAllByText("default", { selector: ".runtime-param-source" })).toHaveLength(1);

  // Filtering is presentation only: the draft stays clean, so the page never
  // asks about unsaved changes.
  fireEvent.change(screen.getByLabelText("Filter variables"), { target: { value: "image" } });
  expect(screen.queryByText("OUTBOUND_HEADER_TIMEOUT_SECONDS")).toBeNull();
  expect(screen.getByText("OUTBOUND_IMAGE_HEADER_TIMEOUT_SECONDS")).toBeInTheDocument();
  expect(screen.queryByText("Unsaved changes")).toBeNull();
});
