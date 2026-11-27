import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const candidates = [
  { id: 11, model: "model-a", name: "Channel A", enabled: true },
  { id: 13, model: "model-a", name: "Channel B", enabled: true },
  { id: 14, model: "model-b", name: "Channel C", enabled: true },
];

function renderPoliciesPanel(request: TeamRequest) {
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
}

describe("authorization groups", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("meta-gateway.locale", "en");
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
      if (path === "/admin/team/candidates") return candidates as T;
      return body as T;
    };
    renderPoliciesPanel(request);

    expect(await screen.findByRole("columnheader", { name: "Model scope" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Route member grants" })).toBeInTheDocument();
    expect(screen.getByText("2 models")).toBeInTheDocument();
    expect(screen.getByText("2 grants")).toBeInTheDocument();
    expect(screen.getByText("1 users")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "New authorization group" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /model-a 2 channels/ }));
    const selectModelChannels = await screen.findByRole("checkbox", {
      name: "Select all channels for model-a",
    });
    fireEvent.click(selectModelChannels);
    expect(selectModelChannels).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "model-a 2 channels" }));
    expect(screen.getByRole("checkbox", { name: "Channel A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Channel B" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /model-b 1 channel/ }));
    expect(screen.getByRole("checkbox", { name: "Allow every model" })).toBeChecked();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Starter" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const confirmation = await screen.findByRole("dialog", { name: "Save authorization group?" });
    expect(confirmation).toHaveTextContent(
      "Saving immediately affects members and keys assigned to this authorization group. Continue?",
    );
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    fireEvent.click(within(confirmation).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const save = calls.find(
        (call) => call.path === "/admin/team/policies" && call.method === "POST",
      );
      expect(save?.body).toMatchObject({
        name: "Starter",
        models: ["model-a", "model-b"],
        member_ids: [11, 13],
        all_models: true,
      });
    });
  });

  it("uses the UI confirmation dialog before deleting an authorization group", async () => {
    const calls: { path: string; method: string }[] = [];
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ path, method });
      if (path === "/admin/team/policies" && method === "GET") return [policy] as T;
      if (path === "/admin/team/candidates") return candidates as T;
      return { ok: true } as T;
    };
    renderPoliciesPanel(request);

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const confirmation = await screen.findByRole("dialog", {
      name: "Delete authorization group?",
    });
    expect(confirmation).toHaveTextContent(
      "This cannot be undone. Deletion will be blocked while any member or invite still uses this group.",
    );
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    fireEvent.click(within(confirmation).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ path: "/admin/team/policies/2", method: "DELETE" });
    });
  });
});
