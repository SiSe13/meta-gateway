import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SessionProvider } from "../../session";
import { BackupsPanel } from "./BackupsPanel";

const name = "meta-gateway-20261126T060314Z-2f38eca1426f.db";
const records = [
  {
    id: 1,
    name,
    status: "success",
    size_bytes: 908000,
    checksum: "abc123",
    duration_ms: 31,
    created_at: "2026-11-26T06:03:14Z",
  },
];

describe("database backups panel", () => {
  let createObjectURLDescriptor: PropertyDescriptor | undefined;
  let revokeObjectURLDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("meta-gateway.locale", "zh-CN");
    localStorage.setItem("meta-gateway.admin-token", "test-token");
    createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (createObjectURLDescriptor) {
      Object.defineProperty(URL, "createObjectURL", createObjectURLDescriptor);
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (revokeObjectURLDescriptor) {
      Object.defineProperty(URL, "revokeObjectURL", revokeObjectURLDescriptor);
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("requests a listed database snapshot through the authenticated download endpoint", async () => {
    const blob = new Blob(["SQLite format 3\0"]);
    const createObjectURL = vi.fn((downloadBlob: Blob) => {
      expect(downloadBlob).toMatchObject({ size: blob.size, type: blob.type });
      return "blob:database-backup";
    });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const requests: { path: string; authorization: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0] ?? "";
        requests.push({
          path,
          authorization: new Headers(init?.headers).get("Authorization"),
        });
        if (path === "/admin/backups") {
          return new Response(JSON.stringify(records), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (path === `/admin/backups/${name}/download`) return new Response(blob);
        return new Response(JSON.stringify({ error: `unexpected ${path}` }), { status: 500 });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <SessionProvider>
            <BackupsPanel />
          </SessionProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("数据库备份")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "下载" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    await waitFor(() => {
      expect(requests).toContainEqual({
        path: `/admin/backups/${name}/download`,
        authorization: "Bearer test-token",
      });
    });
  });
});
