import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { SessionProvider } from "../session";
import { SetupWizard } from "./SetupWizard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("offers personal/team setup and does not advance after saving sync defaults fails", async () => {
  localStorage.setItem("meta-gateway.locale", "en");
  localStorage.setItem("meta-gateway.admin-token", "test");
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/admin/mode")
      return new Response(
        JSON.stringify({
          mode: "personal",
          has_owner: false,
          role: "owner",
          owner_bootstrap_available: true,
        }),
      );
    return new Response(JSON.stringify({ error: "save failed" }), { status: 500 });
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <I18nProvider>
        <SessionProvider>
          <MemoryRouter>
            <SetupWizard />
          </MemoryRouter>
        </SessionProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByLabelText("Operating mode")).toHaveTextContent("Personal");
  expect(screen.queryByRole("heading", { name: "Create owner account" })).toBeNull();
  fireEvent.click(screen.getAllByRole("radio")[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([path]) => String(path).includes("runtime"))).toBe(true),
  );
  expect(screen.getByRole("heading", { name: "Start with the basics" })).toBeInTheDocument();
});

it("adds the selected site type when creating the first upstream site", async () => {
  localStorage.setItem("meta-gateway.locale", "en");
  localStorage.setItem("meta-gateway.admin-token", "test");
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/admin/mode")
      return new Response(
        JSON.stringify({
          mode: "personal",
          has_owner: true,
          role: "owner",
          owner_bootstrap_available: true,
        }),
      );
    if (path === "/admin/runtime-settings" && !init?.method)
      return new Response(JSON.stringify({ editable: { default_model_sync_mode: "manual" } }));
    if (path === "/admin/runtime-settings" && init?.method === "PUT")
      return new Response(JSON.stringify({}));
    if (path === "/admin/connections" && init?.method === "POST")
      return new Response(JSON.stringify({ channel: { id: 42 } }));
    return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <I18nProvider>
        <SessionProvider>
          <MemoryRouter>
            <SetupWizard />
          </MemoryRouter>
        </SessionProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );

  fireEvent.click((await screen.findAllByRole("radio"))[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const siteType = await screen.findByLabelText("Site type");
  expect(siteType).toHaveTextContent("OpenAI Compatible");
  fireEvent.click(siteType);
  fireEvent.click(await screen.findByRole("option", { name: "Anthropic (Claude Official)" }));
  fireEvent.change(screen.getByLabelText("Site Base URL"), {
    target: { value: "https://api.anthropic.com" },
  });
  fireEvent.change(screen.getByLabelText("Upstream API key"), {
    target: { value: "test-upstream-key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add site" }));

  await waitFor(() => {
    const request = fetcher.mock.calls.find(
      ([path, init]) => String(path) === "/admin/connections" && init?.method === "POST",
    );
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ type_hint: "anthropic" });
  });
});
