import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { I18nProvider } from "../../i18n";
import { teamText } from "../text";
import type { TeamRequest } from "../types";
import { PoliciesPanel } from "./PoliciesPanel";

const policy = {
  id: 2,
  name: "Starter",
  models: ["model-a", "model-b"],
  member_ids: [11, 12],
  all_models: false,
  user_count: 1,
};
const candidate = { id: 11, model: "model-a", name: "Channel A", enabled: true };

describe("authorization groups", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("meta-gateway.locale", "en");
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("creates an authorization group directly from its model and channel selections", async () => {
    const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });
      if (path === "/admin/team/policies" && method === "GET") return [policy] as T;
      if (path === "/admin/team/candidates") return [candidate] as T;
      return body as T;
    };
    const context = {
      request,
      locale: "en",
      t: teamText("en"),
      owner: true,
      hasOwner: true,
      settings: {
        mode: "team" as const,
        branding: {
          name: "Meta Gateway",
          logo_url: "",
          accent: "#275b85",
          notice: "",
          login_description: "",
          api_base_url: "",
          show_usage: true,
          show_routing: true,
        },
      },
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <MemoryRouter initialEntries={["/policies"]}>
            <Routes>
              <Route element={<Outlet context={context} />}>
                <Route path="/policies" element={<PoliciesPanel />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("columnheader", { name: "Model scope" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Route member grants" })).toBeInTheDocument();
    expect(screen.getByText("2 models")).toBeInTheDocument();
    expect(screen.getByText("2 grants")).toBeInTheDocument();
    expect(screen.getByText("1 users")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "New authorization group" }));
    const channel = await screen.findByRole("checkbox", { name: /model-a · Channel A/ });
    fireEvent.click(channel);
    expect(channel).toBeChecked();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Starter" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const save = calls.find(
        (call) => call.path === "/admin/team/policies" && call.method === "POST",
      );
      expect(save?.body).toMatchObject({ name: "Starter", models: ["model-a"], member_ids: [11] });
    });
  });
});
