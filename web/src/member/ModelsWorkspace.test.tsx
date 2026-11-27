import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ModelsWorkspace } from "./ModelsWorkspace";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A catalog row, shaped as `/me/model-catalog` answers. */
const catalogRow = (name: string, vendor = "OpenAI") => ({
  name,
  vendor,
  kind: "chat",
  context_window: 32000,
  input_modalities: "text",
  output_modalities: "text",
  candidates: 1,
});

/** A priced quote, shaped as one batch item. */
const batchItem = (model: string) => ({
  model,
  currency: "USD",
  evaluated_at: "2026-10-05T00:00:00Z",
  timezone: "UTC",
  input_tokens: 0,
  candidates: 1,
  ratio: 1,
  input_per_1k: { min: 0.001, max: 0.001 },
  output_per_1k: { min: 0.002, max: 0.002 },
  cache_per_1k: { min: 0, max: 0 },
  per_request: { min: 0, max: 0 },
  tiered: false,
  scheduled: false,
  priced_candidates: 1,
  status: "priced",
});

/** Answers the batch with one quote per requested name, the catalog otherwise. */
function stubFetch(
  requests: string[],
  models: string[],
  vendors: Record<string, string> = {},
  availability: Array<Record<string, unknown>> = [],
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      requests.push(path);
      if (path.startsWith("/me/model-pricing/batch")) {
        const asked = new URL(path, "http://gateway").searchParams.getAll("model");
        return new Response(JSON.stringify({ items: asked.map(batchItem), unavailable: [] }));
      }
      if (path === "/me/model-availability") {
        return new Response(JSON.stringify(availability));
      }
      return new Response(JSON.stringify(models.map((name) => catalogRow(name, vendors[name]))));
    }),
  );
}

it("keeps model cards non-clickable and clears catalogue filters", async () => {
  localStorage.setItem("meta-gateway.locale", "en");
  const requests: string[] = [];
  stubFetch(requests, ["gpt-test"], {}, [
    {
      model: "gpt-test",
      upstreams: 2,
      probed: 2,
      healthy: 1,
      samples: 10,
      ok_samples: 8,
      availability: 0.8,
      avg_latency_ms: 1200,
      last_probed_at: "2026-10-05T00:00:00Z",
    },
  ]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <ModelsWorkspace
          userID={1}
          locale="en"
          canRoute={false}
          plans={[]}
          planId={0}
          onPlanChange={vi.fn()}
          onCreatePlan={vi.fn()}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
  expect((await screen.findAllByText("gpt-test"))[0]).toBeInTheDocument();
  expect(container.querySelector(".model-directory .models-simple-toolbar")).toBeInTheDocument();
  expect(container.querySelector(".member-model-suppliers")).toHaveTextContent("All suppliers");
  // The directory renders cards now (same model, same shared facts): the
  // assertion is about the shared atoms being present, not about the container.
  expect(container.querySelector(".model-card-grid.is-single-model")).toBeInTheDocument();
  expect(container.querySelector(".model-card .model-facts")).toBeInTheDocument();
  expect(container.querySelector(".model-card-usage")).toHaveTextContent("0 requests");
  expect(container.querySelector(".model-card-health")).toHaveTextContent("80.0%");
  expect(container.querySelectorAll(".model-card-health .availability-bar")).toHaveLength(24);
  expect(container.querySelector(".model-card-status")).toBeNull();
  expect(container.querySelector(".model-facts")).toHaveTextContent("32.0k");
  expect(container.querySelector(".model-facts")).not.toHaveTextContent("Unknown");
  expect(screen.queryByRole("combobox", { name: "Model family" })).toBeNull();
  expect(container.querySelector(".model-price-input")).toBeNull();
  const card = screen.getByRole("article", { name: "gpt-test" });
  expect(within(card).queryByRole("button", { name: /details|connect/i })).toBeNull();
  expect(screen.queryByText(/This token works in any OpenAI-compatible client/i)).toBeNull();
  expect(requests).toContain("/me/model-availability");
  fireEvent.click(card);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.change(container.querySelector(".models-search input")!, {
    target: { value: "missing" },
  });
  expect(screen.getByText("No matching models")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getAllByText("gpt-test")[0]).toBeInTheDocument();
  expect(requests).toContain("/me/model-catalog");
  expect(requests.every((path) => path.startsWith("/me/"))).toBe(true);
  expect(container.querySelector(".model-card-workspace")).toBeInTheDocument();
  // One page asks the batch once; there is no per-card price request.
  const priceCalls = requests.filter((path) => path.startsWith("/me/model-pricing/batch"));
  expect(priceCalls).toHaveLength(1);
  expect(new URL(priceCalls[0]!, "http://gateway").searchParams.getAll("model")).toEqual([
    "gpt-test",
  ]);
  expect(requests.some((path) => path.startsWith("/me/model-pricing?"))).toBe(false);
});

it("asks the price batch for the current page only when the page turns", async () => {
  localStorage.setItem("meta-gateway.locale", "en");
  const requests: string[] = [];
  const names = Array.from({ length: 25 }, (_, index) => `model-${index}`);
  stubFetch(requests, names);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <ModelsWorkspace
          userID={1}
          locale="en"
          canRoute={false}
          plans={[]}
          planId={0}
          onPlanChange={vi.fn()}
          onCreatePlan={vi.fn()}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
  expect((await screen.findAllByText("model-0")).length).toBeGreaterThan(0);
  expect(document.querySelector(".model-card-health")).toBeNull();
  expect(document.querySelector(".model-card-status")).toBeNull();
  expect(document.querySelector(".model-card-grid.is-single-model")).toBeNull();
  const first = requests.filter((path) => path.startsWith("/me/model-pricing/batch"));
  expect(first).toHaveLength(1);
  expect(new URL(first[0]!, "http://gateway").searchParams.getAll("model")).toHaveLength(20);

  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect((await screen.findAllByText("model-20")).length).toBeGreaterThan(0);
  const batches = requests.filter((path) => path.startsWith("/me/model-pricing/batch"));
  expect(batches).toHaveLength(2);
  // The second batch carries page two's names alone — page one is not re-asked.
  expect(new URL(batches[1]!, "http://gateway").searchParams.getAll("model")).toEqual([
    "model-20",
    "model-21",
    "model-22",
    "model-23",
    "model-24",
  ]);
});

it("filters the catalogue by normalized model supplier", async () => {
  localStorage.setItem("meta-gateway.locale", "en");
  const requests: string[] = [];
  stubFetch(requests, ["deepseek-chat", "gemini-flash"], {
    "deepseek-chat": "DeepSeek AI",
    "gemini-flash": "Google DeepMind",
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <ModelsWorkspace
          userID={1}
          locale="en"
          canRoute={false}
          plans={[]}
          planId={0}
          onPlanChange={vi.fn()}
          onCreatePlan={vi.fn()}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
  expect((await screen.findAllByText("deepseek-chat")).length).toBeGreaterThan(0);
  expect(container.querySelector(".member-model-suppliers")).toHaveTextContent("DeepSeek");
  expect(container.querySelector(".member-model-suppliers")).toHaveTextContent("Google");
  expect(container.querySelector(".model-card-grid.is-two-models")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "DeepSeek 1" }));
  expect(container.querySelectorAll(".model-card")).toHaveLength(1);
  expect(container.querySelector(".model-card-grid.is-single-model")).toBeInTheDocument();
  expect(container.querySelector(".model-card-grid")).toHaveTextContent("deepseek-chat");
  expect(container.querySelector(".model-card-grid")).not.toHaveTextContent("gemini-flash");
});
