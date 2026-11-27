import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/** 通过可见下拉选项完成选择，兼容选择后短暂阻止重开的键盘保护。 */
export async function selectOption(trigger: HTMLElement, label: string | RegExp) {
  await waitFor(() => {
    if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("option", { name: label }));
}
