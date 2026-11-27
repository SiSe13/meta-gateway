import { useState } from "react";
import { Cable, Boxes } from "lucide-react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ConsoleShell } from "./ConsoleShell";
import { Button, Page, PageActions } from "./ui";

beforeEach(() => localStorage.setItem("meta-gateway.locale", "en"));
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("closes mobile navigation after choosing a destination", () => {
  function CurrentLocation() {
    return <output data-testid="destination">{useLocation().pathname}</output>;
  }
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={["/models"]}>
        <ConsoleShell
          appearance="metapi"
          sections={[
            {
              label: "Workspace",
              items: [
                { to: "/channels", label: "Connections", icon: Cable },
                { to: "/models", label: "Models", icon: Boxes },
              ],
            },
          ]}
          version="dev"
          theme="light"
          onThemeChange={vi.fn()}
          onDisconnect={vi.fn()}
          health={{ total: 2, healthy: 1, loading: false }}
        >
          <CurrentLocation />
        </ConsoleShell>
      </MemoryRouter>
    </I18nProvider>,
  );
  expect(screen.queryByRole("button", { name: /search commands/i })).not.toBeInTheDocument();
  expect(
    screen.queryByText("Workspace", { selector: ".console-breadcrumb span" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  const drawer = screen.getByRole("dialog", { name: "Balbo AI" });
  fireEvent.click(within(drawer).getByRole("link", { name: "Connections" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByTestId("destination")).toHaveTextContent("/channels");
  expect(screen.getByRole("link", { name: "Connections" })).toHaveAttribute("aria-current", "page");
});

it("hides the icon on nested sidebar entries when requested", () => {
  const { container } = render(
    <I18nProvider>
      <MemoryRouter initialEntries={["/settings?section=relay"]}>
        <ConsoleShell
          appearance="metapi"
          sections={[
            {
              label: "Runtime",
              items: [
                {
                  to: "/settings?section=relay",
                  label: "Relay",
                  icon: Cable,
                  hideIcon: true,
                  active: true,
                },
              ],
            },
          ]}
          version="dev"
          theme="light"
          onThemeChange={vi.fn()}
          onDisconnect={vi.fn()}
          health={{ total: 0, healthy: 0, loading: false }}
        >
          <div />
        </ConsoleShell>
      </MemoryRouter>
    </I18nProvider>,
  );
  const link = screen.getByRole("link", { name: "Relay" });
  expect(link).toBeInTheDocument();
  expect(link.querySelector("svg")).toBeNull();
  expect(container.querySelector(".runtime-nav-dot")).toBeNull();
});

it("shows only the selected top workspace and omits the sidebar section caption", () => {
  const { container } = render(
    <I18nProvider>
      <MemoryRouter initialEntries={["/channels?view=observations"]}>
        <ConsoleShell
          appearance="metapi"
          sections={[
            {
              label: "Console",
              items: [{ to: "/channels", label: "Connections", icon: Cable }],
            },
          ]}
          topNavigation={[
            { id: "console", label: "Console", to: "/channels" },
            { id: "observations", label: "Site observations", to: "/channels?view=observations" },
          ]}
          activeTopNavigation="observations"
          version="dev"
          theme="light"
          onThemeChange={vi.fn()}
          onDisconnect={vi.fn()}
          health={{ total: 0, healthy: 0, loading: false }}
        >
          {null}
        </ConsoleShell>
      </MemoryRouter>
    </I18nProvider>,
  );

  const topNavigation = container.querySelector(".metapi-top-navigation");
  expect(container.querySelector(".console-shell")).toHaveClass("is-observation-view");
  expect(container.querySelector(".console-sidebar")).not.toBeInTheDocument();
  expect(container.querySelector(".console-mobile-trigger")).not.toBeInTheDocument();
  expect(topNavigation?.querySelectorAll("a.active")).toHaveLength(1);
  expect(topNavigation?.querySelector('a[href="/channels"]')).not.toHaveClass("active");
  expect(topNavigation?.querySelector('a[href="/channels?view=observations"]')).toHaveClass(
    "active",
  );
  expect(container.querySelector(".console-nav-caption")).toBeNull();
});

it("marks only the exact team board as active", () => {
  const { container } = render(
    <I18nProvider>
      <MemoryRouter initialEntries={["/users/policies"]}>
        <ConsoleShell
          appearance="metapi"
          sections={[
            {
              label: "Users",
              items: [
                { to: "/users/members", label: "Members & invitations", icon: Cable },
                { to: "/users/policies", label: "Permissions & routing", icon: Boxes },
              ],
            },
          ]}
          version="dev"
          theme="light"
          onThemeChange={vi.fn()}
          onDisconnect={vi.fn()}
          health={{ total: 0, healthy: 0, loading: false }}
        >
          {null}
        </ConsoleShell>
      </MemoryRouter>
    </I18nProvider>,
  );

  expect(container.querySelectorAll(".console-nav-link.active")).toHaveLength(1);
  expect(container.querySelector('a[href="/users/members"]')).not.toHaveClass("active");
  expect(container.querySelector('a[href="/users/policies"]')).toHaveClass("active");
});

it("opens the password change dialog from the administrator menu", () => {
  const openAccount = vi.fn();
  render(
    <I18nProvider>
      <MemoryRouter>
        <ConsoleShell
          appearance="metapi"
          sections={[]}
          showAdminAccount
          onOpenAdminAccount={openAccount}
          version="dev"
          theme="light"
          onThemeChange={vi.fn()}
          onDisconnect={vi.fn()}
          health={{ total: 0, healthy: 0, loading: false }}
        >
          {null}
        </ConsoleShell>
      </MemoryRouter>
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Change password" }));
  expect(openAccount).toHaveBeenCalledOnce();
});

it("opens the password flow from the team account menu", () => {
  const openPassword = vi.fn();
  render(
    <I18nProvider>
      <MemoryRouter>
        <ConsoleShell
          appearance="metapi"
          sections={[]}
          showMemberAccount
          onOpenPasswordDialog={openPassword}
          version="dev"
          theme="light"
          onThemeChange={vi.fn()}
          onDisconnect={vi.fn()}
          health={{ total: 0, healthy: 0, loading: false }}
        >
          {null}
        </ConsoleShell>
      </MemoryRouter>
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Change password" }));
  expect(openPassword).toHaveBeenCalledOnce();
});

it("keeps page header actions bound to the current selection", () => {
  const edit = vi.fn();
  function Catalog() {
    const [selected, setSelected] = useState("gpt-image");
    return (
      <>
        <PageActions>
          <Button onClick={() => edit(selected)}>Edit {selected}</Button>
        </PageActions>
        <button onClick={() => setSelected("gemini")}>Select Gemini</button>
      </>
    );
  }
  render(
    <Page title="Models" description="Routing workspace">
      <Catalog />
    </Page>,
  );
  expect(screen.getByRole("button", { name: "Edit gpt-image" }).closest("header")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Select Gemini" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit gemini" }));
  expect(edit).toHaveBeenCalledWith("gemini");
  expect(screen.queryByRole("button", { name: "Edit gpt-image" })).not.toBeInTheDocument();
});
