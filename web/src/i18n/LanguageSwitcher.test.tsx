import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider, LanguageSwitcher } from "./index";

describe("LanguageSwitcher", () => {
  afterEach(() => localStorage.clear());

  it("uses the application dropdown and changes the selected language", async () => {
    localStorage.setItem("meta-gateway.locale", "en");
    render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "中文" }));

    expect(screen.getByRole("button", { name: "语言" })).toHaveTextContent("中文");
    expect(localStorage.getItem("meta-gateway.locale")).toBe("zh-CN");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
