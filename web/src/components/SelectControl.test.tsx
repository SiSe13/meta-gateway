import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { SelectControl } from "./ui";

afterEach(cleanup);

it("joins option text fragments without adding commas and preserves the selected value", () => {
  const onChange = vi.fn();
  const model = "new-model";
  render(
    <I18nProvider>
      <SelectControl aria-label="Target model" defaultValue="" onChange={onChange}>
        <option value="">Choose a model</option>
        <option value="new-model">
          {model}
          {" — Added"}
        </option>
      </SelectControl>
    </I18nProvider>,
  );

  // 文案来自多个 JSX 文本片段时，展示和搜索都必须保持原来的完整名称。
  fireEvent.click(screen.getByRole("button", { name: "Target model" }));
  fireEvent.click(screen.getByRole("option", { name: "new-model — Added" }));
  expect(onChange).toHaveBeenCalledWith({ target: { value: "new-model" } });
  expect(screen.getByRole("button", { name: "Target model" })).toHaveTextContent(
    "new-model — Added",
  );
});
