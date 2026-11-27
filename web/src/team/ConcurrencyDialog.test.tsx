import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ConcurrencyDialog } from "./MemberForms";
import { teamText } from "./text";
import type { TeamRequest, TeamUser } from "./types";

afterEach(cleanup);

const member: TeamUser = {
  id: 4,
  username: "member",
  name: "Member",
  role: "member",
  status: "active",
  policy_id: 1,
  policy_ids: [1],
  max_keys: 5,
  max_concurrent: 5,
  rpm: 60,
  allow_routing: false,
  allow_request_preferences: false,
  created_at: "",
  key_count: 0,
  quota_total_tokens: 0,
  quota_used_tokens: 0,
  quota_total_cost: 0,
  quota_used_cost: 0,
};

it("adds temporary concurrency to one member", async () => {
  const request = vi.fn(async () => ({})) as TeamRequest;
  render(
    <I18nProvider>
      <ConcurrencyDialog
        request={request}
        target={{ kind: "user", user: member }}
        locale="en"
        t={teamText("en")}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    </I18nProvider>,
  );

  fireEvent.change(screen.getByLabelText("Additional concurrent requests"), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Validity period" }));
  fireEvent.click(await screen.findByRole("option", { name: "30 days" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      "/admin/team/users/4/concurrency",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ amount: 3, grant_validity_days: 30 }),
      }),
    );
  });
});

it("submits the same concurrency grant for the selected members", async () => {
  const request = vi.fn(async () => ({})) as TeamRequest;
  render(
    <I18nProvider>
      <ConcurrencyDialog
        request={request}
        target={{ kind: "bulk", ids: [4, 5], count: 2 }}
        locale="en"
        t={teamText("en")}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    </I18nProvider>,
  );

  fireEvent.change(screen.getByLabelText("Additional concurrent requests"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Validity period" }));
  fireEvent.click(await screen.findByRole("option", { name: "Never expires" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      "/admin/team/users/bulk",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ids: [4, 5],
          action: "concurrency",
          concurrency: 2,
          grant_validity_days: 0,
        }),
      }),
    );
  });
});
