import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button as HeroButton } from "@heroui/react";
import { NavLink, useLocation } from "react-router-dom";
import type { UpdateCheckStatus } from "../api/types";
import { useI18n } from "../i18n";
import { Drawer } from "./Drawer";
import { UI_THEMES } from "../themes/registry";
import type { UIThemeId } from "../themes/types";

export type ConsoleNavItem = { to: string; label: string; icon: LucideIcon };
export type ConsoleTopNavItem = { id: string; label: string; to: string };
type NavSection = { label: string; items: ConsoleNavItem[] };

export function ConsoleShell({
  children,
  sections,
  topNavigation = [],
  activeTopNavigation = "",
  onSelectTopNavigation = () => {},
  showAdminAccount = false,
  showMemberAccount = false,
  onOpenAdminAccount = () => {},
  appearanceHiddenNav = [],
  version,
  theme,
  onThemeChange,
  onDisconnect,
  health,
  update,
  appearance = "metapi",
}: {
  children: ReactNode;
  appearance?: UIThemeId;
  sections: NavSection[];
  topNavigation?: ConsoleTopNavItem[];
  activeTopNavigation?: string;
  onSelectTopNavigation?: (to: string) => void;
  showAdminAccount?: boolean;
  showMemberAccount?: boolean;
  onOpenAdminAccount?: () => void;
  appearanceHiddenNav?: string[];
  version: string;
  theme: "light" | "dark";
  onThemeChange: () => void;
  onDisconnect: () => void;
  health: { healthy: number; total: number; loading: boolean; available?: boolean };
  update?: UpdateCheckStatus;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const Chrome = UI_THEMES[appearance].Chrome;
  const tone =
    health.total === 0
      ? "idle"
      : health.healthy === health.total
        ? "ok"
        : health.healthy === 0
          ? "down"
          : "warn";

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  const observationView =
    location.pathname === "/channels" &&
    new URLSearchParams(location.search).get("view") === "observations";

  // 桌面端在顶栏切换工作区，移动端在抽屉顶部提供同一组入口。
  const mobileTopNavigation = (
    <nav className="console-mobile-top-nav" aria-label={t("app.topNav.ariaLabel")}>
      {topNavigation.map((item) => (
        <HeroButton
          key={item.id}
          type="button"
          variant="ghost"
          className={item.id === activeTopNavigation ? "active" : ""}
          aria-current={item.id === activeTopNavigation ? "page" : undefined}
          onPress={() => onSelectTopNavigation(item.to)}
        >
          {item.label}
        </HeroButton>
      ))}
    </nav>
  );

  // 渲染按当前顶栏工作区筛选后的侧栏入口。
  const navigation = (mobile = false) => (
    <>
      {mobile ? mobileTopNavigation : null}
      <nav className="console-navigation" aria-label={t("app.nav.open")}>
        {sections
          .filter((section) => section.items.length)
          .map((section) => (
            <div className="console-nav-group" key={section.label}>
              {section.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={(to.split("?", 1)[0] ?? "/") === "/"}
                  title={label}
                  className={({ isActive }) => `console-nav-link${isActive ? " active" : ""}`}
                  onClick={() => {
                    if (mobile) setMobileOpen(false);
                  }}
                >
                  <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                  <span>{label}</span>
                  <i className="console-nav-indicator" aria-hidden="true" />
                </NavLink>
              ))}
            </div>
          ))}
      </nav>
    </>
  );

  return (
    <div
      className={`console-shell theme-shell theme-${appearance}${collapsed ? " is-collapsed" : ""}${observationView ? " is-observation-view" : ""}`}
    >
      <div className="console-atmosphere" aria-hidden="true" />
      <Chrome
        navigation={navigation()}
        topNavigation={topNavigation}
        activeTopNavigation={activeTopNavigation}
        showAdminAccount={showAdminAccount}
        showMemberAccount={showMemberAccount}
        onOpenAdminAccount={onOpenAdminAccount}
        appearanceHiddenNav={appearanceHiddenNav}
        sections={sections}
        version={version}
        theme={theme}
        onThemeChange={onThemeChange}
        onDisconnect={onDisconnect}
        health={health}
        tone={tone}
        update={update}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(!collapsed)}
        onOpenNav={() => setMobileOpen(true)}
        onSelectTopNavigation={onSelectTopNavigation}
      />
      <div className="console-main">
        <div className="console-content" id="console-workspace">
          {children}
        </div>
        <footer className="console-page-foot">
          <span>Meta Gateway</span>
          <span>{t("shell.footer")}</span>
          <span className="console-foot-dot" />
        </footer>
      </div>
      {mobileOpen ? (
        <Drawer
          title="Meta Gateway"
          onClose={() => setMobileOpen(false)}
          side="left"
          width={300}
          className="console-nav-drawer"
        >
          {navigation(true)}
        </Drawer>
      ) : null}
    </div>
  );
}
