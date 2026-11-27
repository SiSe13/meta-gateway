import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { PasswordChangeDialog } from "./PasswordChangeDialog";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("meta-gateway.locale", "en");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("changes the password from the profile dialog and ends the session", async () => {
  const fetcher = vi.fn(async () => new Response("{}"));
  const onClose = vi.fn();
  const onDisconnected = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(
    <I18nProvider>
      <PasswordChangeDialog mode="member" onClose={onClose} onDisconnected={onDisconnected} />
    </I18nProvider>,
  );

  const currentPassword = screen.getByLabelText<HTMLInputElement>("Current password");
  const newPassword = screen.getByLabelText<HTMLInputElement>("New password");
  const confirmPassword = screen.getByLabelText<HTMLInputElement>("Confirm new password");
  const inputs = Array.from(currentPassword.form!.querySelectorAll("input"));
  expect(inputs.indexOf(currentPassword)).toBeLessThan(inputs.indexOf(newPassword));
  expect(inputs.indexOf(newPassword)).toBeLessThan(inputs.indexOf(confirmPassword));
  expect(currentPassword.form!.querySelector("fieldset")).toHaveClass("overlay-fields");

  fireEvent.change(currentPassword, {
    target: { value: "current-password" },
  });
  fireEvent.change(newPassword, {
    target: { value: "new-password" },
  });
  fireEvent.change(confirmPassword, {
    target: { value: "new-password" },
  });
  expect(screen.getByRole("heading", { name: "Change password" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(onDisconnected).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledWith(
    "/me/password",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ current_password: "current-password", password: "new-password" }),
    }),
  );
});
