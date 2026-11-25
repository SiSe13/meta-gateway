import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SessionProvider } from "../../session";
import { ToastProvider } from "../../toast";
import { AddChannelDialog } from "./AddChannelDialog";
import type { CreateConnectionInput } from "./helpers";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Answers the preview the way the backend does: one endpoint per channel type. */
function stubPreview(detectedFamily = "") {
  const calls: Array<{ url: string; type: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = String(input);
      const path = raw.split("?")[0] ?? "";
      if (path === "/admin/endpoint-preview") {
        const type = new URL(raw, "http://localhost").searchParams.get("type") ?? "";
        calls.push({ url: raw, type });
        const anthropic = type === "anthropic";
        return jsonResponse({
          base_url: "https://api.deepseek.com/anthropic",
          protocol: anthropic ? "anthropic" : "openai",
          chat_url: anthropic
            ? "https://api.deepseek.com/anthropic/v1/messages"
            : "https://api.deepseek.com/anthropic/v1/chat/completions",
          models_url: "https://api.deepseek.com/anthropic/v1/models",
          surfaces: anthropic
            ? [{ downstream: ["chat", "responses"], mode: "translated" }]
            : [
                { downstream: ["responses"], mode: "native_fallback" },
                { downstream: ["messages"], mode: "translated" },
              ],
        });
      }
      if (path === "/admin/sites") return jsonResponse([]);
      if (path === "/admin/site-type") {
        return jsonResponse(detectedFamily ? { family: detectedFamily } : {});
      }
      if (path === "/admin/runtime-settings") {
        return jsonResponse({ editable: { default_model_sync_mode: "manual" } });
      }
      return jsonResponse({ error: `unexpected ${path}` }, 500);
    }),
  );
  return calls;
}

function renderDialog(props?: {
  existingGroups?: string[];
  onSave?: (value: CreateConnectionInput, options: { verify: boolean }) => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <SessionProvider>
            <AddChannelDialog
              pending={false}
              error={null}
              existingGroups={props?.existingGroups}
              onClose={() => {}}
              onSave={props?.onSave ?? (() => {})}
            />
          </SessionProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("AddChannelDialog endpoint preview", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("meta-gateway.locale", "en");
    localStorage.setItem("meta-gateway.admin-token", "test-token");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("detects a provider from the base URL and keeps the type directly below it", async () => {
    stubPreview("deepseek");
    renderDialog();

    const baseUrl = screen.getByPlaceholderText("https://api.example.com");
    const baseUrlField = baseUrl.closest(".field");
    const typeButton = screen.getByRole("button", { name: "Type" });
    expect(baseUrlField?.compareDocumentPosition(typeButton) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    fireEvent.change(baseUrl, { target: { value: "https://api.deepseek.com/v1" } });
    fireEvent.blur(baseUrl);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Type" })).toHaveTextContent("DeepSeek"),
    );
  });

  it("does not let a delayed URL detection overwrite a manual type selection", async () => {
    let resolveDetection: (response: Response) => void = () => {};
    const delayedDetection = new Promise<Response>((resolve) => {
      resolveDetection = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const raw = String(input);
        const path = raw.split("?")[0] ?? "";
        if (path === "/admin/site-type") return delayedDetection;
        if (path === "/admin/sites") return jsonResponse([]);
        if (path === "/admin/runtime-settings") {
          return jsonResponse({ editable: { default_model_sync_mode: "manual" } });
        }
        if (path === "/admin/endpoint-preview") {
          return jsonResponse({
            base_url: "https://api.example.com",
            protocol: "anthropic",
            chat_url: "https://api.example.com/v1/messages",
            models_url: "https://api.example.com/v1/models",
          });
        }
        return jsonResponse({ error: `unexpected ${path}` }, 500);
      }),
    );
    renderDialog();

    const baseUrl = screen.getByPlaceholderText("https://api.example.com");
    fireEvent.change(baseUrl, { target: { value: "https://api.example.com" } });
    fireEvent.blur(baseUrl);

    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.click(await screen.findByRole("option", { name: "Anthropic (Claude Official)" }));
    act(() => resolveDetection(jsonResponse({ family: "deepseek" })));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Type" })).toHaveTextContent("Anthropic"),
    );
  });

  it("lets the operator choose an existing channel group", async () => {
    stubPreview();
    renderDialog({ existingGroups: ["paid", "internal", "paid"] });

    fireEvent.click(screen.getByRole("button", { name: "Channel group" }));
    fireEvent.click(await screen.findByRole("option", { name: "paid" }));

    expect(screen.getByRole("button", { name: "Channel group" })).toHaveTextContent("paid");
  });

  it("lets the operator type a new channel group", async () => {
    stubPreview();
    const onSave = vi.fn();
    renderDialog({ existingGroups: ["paid"], onSave });

    fireEvent.click(screen.getByRole("button", { name: "Channel group" }));
    fireEvent.click(await screen.findByRole("option", { name: "Enter a new group…" }));
    fireEvent.change(screen.getByPlaceholderText("Enter group name"), {
      target: { value: "internal-team" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://api.example.com"), {
      target: { value: "https://api.example.com" },
    });
    fireEvent.change(document.querySelector('input[type="password"]')!, {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0].group_name).toBe("internal-team");
  });

  // The upstream can speak one of three wire shapes, and the dialog has to answer
  // for the one the operator picked: an Anthropic channel posts to `/v1/messages`,
  // not to the OpenAI chat endpoint a type-blind preview would print. The type is
  // part of the question, so changing it must re-resolve the answer.
  it("re-resolves the endpoint when the channel type changes", async () => {
    const calls = stubPreview();
    renderDialog();

    const baseUrl = screen.getByPlaceholderText("https://api.example.com");
    fireEvent.change(baseUrl, { target: { value: "https://api.deepseek.com/anthropic" } });
    fireEvent.blur(baseUrl);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Requests will go to: https://api.deepseek.com/anthropic/v1/chat/completions",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Upstream protocol: OpenAI compatible (Bearer, chat completions)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Model list: https://api.deepseek.com/anthropic/v1/models"),
    ).toBeInTheDocument();
    // "This upstream is OpenAI-shaped" does not answer for a Responses or Claude
    // client; those two rows are the difference between the three protocols.
    expect(
      screen.getByText(
        "Responses clients → sent in the native Responses shape first, rewritten to chat completions on 404/405",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Anthropic clients → rewritten to chat completions"),
    ).toBeInTheDocument();

    // The field's own label names the trigger ("Type"), not its current value.
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.click(screen.getByRole("option", { name: "Anthropic (Claude Official)" }));

    await waitFor(() =>
      expect(
        screen.getByText("Requests will go to: https://api.deepseek.com/anthropic/v1/messages"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Upstream protocol: Anthropic Messages (x-api-key)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Chat / Responses clients → rewritten to Anthropic Messages"),
    ).toBeInTheDocument();
    expect(calls.at(-1)?.type).toBe("anthropic");
  });
});
