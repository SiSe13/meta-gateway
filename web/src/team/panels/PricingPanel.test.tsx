import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { I18nProvider } from "../../i18n";
import { teamText } from "../text";
import type { TeamRequest } from "../types";
import { PricingPanel } from "./PricingPanel";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("meta-gateway.locale", "en");
});

describe("team pricing settings", () => {
  it("applies one multiplier to each selected exact model", async () => {
    const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
    const request: TeamRequest = async <T,>(path: string, init?: RequestInit) => {
      if (path === "/admin/ratios" && !init?.method) return [] as T;
      if (path === "/admin/routes/overview")
        return ["gpt-4o", "claude-sonnet-4", "gpt-*"].map((model, index) => ({
          route: {
            id: index + 1,
            model_pattern: model,
            enabled: true,
            routing_mode: "priority",
            created_at: "",
            updated_at: "",
          },
          members: [],
        })) as T;
      if (init?.method === "PUT") {
        writes.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return {} as T;
      }
      return {} as T;
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

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider>
          <MemoryRouter>
            <Routes>
              <Route element={<Outlet context={context} />}>
                <Route path="/" element={<PricingPanel />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Add multiplier" }));
    const modelPickerLabel = await screen.findByText("Search and select models");
    const modelPickerTrigger = modelPickerLabel.closest("summary");
    expect(modelPickerTrigger?.querySelector("svg")).toBeNull();
    fireEvent.click(modelPickerLabel);
    const gptGroup = await screen.findByRole("button", { name: /GPT/ });
    expect(gptGroup).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(gptGroup);
    expect(screen.queryByRole("checkbox", { name: "gpt-4o" })).toBeNull();
    fireEvent.click(gptGroup);
    fireEvent.click(await screen.findByRole("checkbox", { name: "gpt-4o" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "claude-sonnet-4" }));
    expect(screen.queryByRole("checkbox", { name: "gpt-*" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Multiplier"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes).toEqual([
      { path: "/admin/ratios/gpt-4o", body: { ratio: 2.5 } },
      { path: "/admin/ratios/claude-sonnet-4", body: { ratio: 2.5 } },
    ]);
  });
});
