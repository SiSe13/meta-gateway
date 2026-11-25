import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppearanceProvider, useAppearance } from "./appearance";
import { ConsoleShell } from "./components/ConsoleShell";
import { AppearancePanel } from "./features/AppearancePanel";
import { I18nProvider } from "./i18n";

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Preferences() {
  const { appearance, scheme } = useAppearance();
  return (
    <output aria-label="Preferences">
      {appearance}/{scheme}
    </output>
  );
}

function mount() {
  return render(
    <AppearanceProvider>
      <QueryClientProvider client={queryClient()}>
        <I18nProvider>
          <MemoryRouter initialEntries={["/settings?tab=appearance"]}>
            <ConsoleShell
              sections={[]}
              version="test"
              theme="light"
              onThemeChange={() => {}}
              onDisconnect={() => {}}
              health={{ healthy: 0, total: 0, loading: false }}
            >
              <Preferences />
              <AppearancePanel />
            </ConsoleShell>
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>
    </AppearanceProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("meta-gateway.locale", "en");
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: String(query).includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.appearance;
  delete document.documentElement.dataset.palette;
  delete document.documentElement.dataset.background;
  delete document.documentElement.dataset.cardStyle;
  delete document.documentElement.dataset.density;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses the MetaAPI layout while preserving existing color preferences", () => {
  localStorage.setItem("meta-gateway.theme", "dark");
  localStorage.setItem("meta-gateway.appearance", "classic");
  mount();
  expect(document.querySelector(".theme-metapi")).toBeInTheDocument();
  expect(document.querySelector(".console-sidebar")).toBeInTheDocument();
  expect(screen.getByLabelText("Preferences")).toHaveTextContent("metapi/dark");
  expect(localStorage.getItem("meta-gateway.appearance")).toBe("classic");
  expect(localStorage.getItem("meta-gateway.theme")).toBe("dark");
  expect(screen.queryByRole("radio", { name: /Classic console|Modern workspace/ })).toBeNull();
});

it("follows the desktop color scheme until the operator chooses one", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: String(query).includes("prefers-color-scheme"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  mount();
  expect(screen.getByLabelText("Preferences")).toHaveTextContent("metapi/dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem("meta-gateway.theme")).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Light and dark" }));
  expect(screen.getByLabelText("Preferences")).toHaveTextContent("metapi/light");
  expect(localStorage.getItem("meta-gateway.theme")).toBe("light");
});

it("applies a preset palette without changing the layout or color scheme", () => {
  mount();
  expect(document.querySelectorAll(".palette-swatch")).toHaveLength(7);
  const ocean = screen.getByRole("button", { name: "Ocean" });
  fireEvent.click(ocean);
  expect(document.documentElement.dataset.palette).toBe("ocean");
  expect(document.documentElement.dataset.appearance).toBe("metapi");
  expect(screen.getByLabelText("Preferences")).toHaveTextContent("metapi/light");
  fireEvent.click(screen.getByRole("switch", { name: "Light and dark" }));
  expect(document.documentElement.dataset.palette).toBe("ocean");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

it("syncs palette changes made in another tab", () => {
  mount();
  act(() => {
    localStorage.setItem("meta-gateway.palette", "sakura");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "meta-gateway.palette", storageArea: localStorage }),
    );
  });
  expect(document.documentElement.dataset.palette).toBe("sakura");
});

it("applies and persists background, card style, and density preferences", () => {
  mount();
  const clickOption = (group: string, value: string) => {
    const option = document.querySelector<HTMLButtonElement>(
      `[data-option-group="${group}"][data-option-value="${value}"]`,
    );
    if (!option) throw new Error(`Missing ${group} option: ${value}`);
    fireEvent.click(option);
  };

  expect(document.documentElement.dataset.background).toBe("paper");
  expect(document.documentElement.dataset.cardStyle).toBe("raised");
  expect(document.documentElement.dataset.density).toBe("standard");

  clickOption("background", "mist");
  clickOption("cards", "outlined");
  clickOption("density", "compact");
  expect(document.documentElement.dataset.background).toBe("mist");
  expect(document.documentElement.dataset.cardStyle).toBe("outlined");
  expect(document.documentElement.dataset.density).toBe("compact");
  expect(localStorage.getItem("meta-gateway.background")).toBe("mist");
  expect(localStorage.getItem("meta-gateway.card-style")).toBe("outlined");
  expect(localStorage.getItem("meta-gateway.density")).toBe("compact");

  fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
  expect(document.documentElement.dataset.background).toBe("paper");
  expect(document.documentElement.dataset.cardStyle).toBe("raised");
  expect(document.documentElement.dataset.density).toBe("standard");
  expect(localStorage.getItem("meta-gateway.background")).toBe("paper");
  expect(localStorage.getItem("meta-gateway.card-style")).toBe("raised");
  expect(localStorage.getItem("meta-gateway.density")).toBe("standard");
});
