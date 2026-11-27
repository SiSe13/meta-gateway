import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "./ui";

afterEach(cleanup);

it("preserves a switch role and restores button semantics when it changes", () => {
  const view = render(
    <Button role="switch" aria-checked={false}>
      Theme
    </Button>,
  );
  expect(screen.getByRole("switch", { name: "Theme" })).toHaveAttribute("aria-checked", "false");
  view.rerender(
    <Button role="switch" aria-checked={true}>
      Theme
    </Button>,
  );
  expect(screen.getByRole("switch", { name: "Theme" })).toHaveAttribute("aria-checked", "true");
  view.rerender(<Button>Theme</Button>);
  expect(screen.getByRole("button", { name: "Theme" })).toBeInTheDocument();
});

it("submits an external form once and respects native validation", () => {
  const submit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());
  render(
    <>
      <form id="account-form" onSubmit={submit}>
        <input aria-label="Account name" name="name" required />
      </form>
      <Button type="submit" form="account-form">
        Save
      </Button>
    </>,
  );
  const save = screen.getByRole("button", { name: "Save" });
  expect(save).toHaveAttribute("form", "account-form");
  fireEvent.click(save);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Account name" }), {
    target: { value: "Alice" },
  });
  fireEvent.click(save);
  expect(submit).toHaveBeenCalledOnce();
});
