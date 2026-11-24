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
  appearanceHiddenNav = [],
  version,
  theme,
  onThemeChange,
  onSearch,
  onDisconnect,
  health,
  update,
  background,
  appearance = "metapi",
}: {
  children: ReactNode;
  appearance?: UIThemeId;
  sections: NavSection[];
  topNavigation?: ConsoleTopNavItem[];
  activeTopNavigation?: string;
  onSelectTopNavigation?: (to: string) => void;
  showAdminAccount?: boolean;
  appearanceHiddenNav?: string[];
  version: string;
  theme: "light" | "dark";
  onThemeChange: () => void;
  onSearch: () => void;
  onDisconnect: () => void;
  health: { healthy: number; total: number; loading: boolean; available?: boolean };
  update?: UpdateCheckStatus;
  background?: string;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const currentSection = sections.find((section) =>
    section.items.some((item) => {
      const path = item.to.split("?", 1)[0] ?? "/";
      return path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);
    }),
  );
  const current = currentSection?.items.find((item) => {
    const path = item.to.split("?", 1)[0] ?? "/";
    return path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);
  });
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
              <span className="console-nav-caption">{section.label}</span>
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
      className={`console-shell theme-shell theme-${appearance}${collapsed ? " is-collapsed" : ""}`}
    >
      <div
        className="console-atmosphere"
        aria-hidden="true"
        style={background ? { backgroundImage: `url("${background}")` } : undefined}
      />
      <Chrome
        navigation={navigation()}
        topNavigation={topNavigation}
        activeTopNavigation={activeTopNavigation}
        showAdminAccount={showAdminAccount}
        appearanceHiddenNav={appearanceHiddenNav}
        sections={sections}
        version={version}
        theme={theme}
        onThemeChange={onThemeChange}
        onSearch={onSearch}
        onDisconnect={onDisconnect}
        health={health}
        tone={tone}
        update={update}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(!collapsed)}
        onOpenNav={() => setMobileOpen(true)}
        onSelectTopNavigation={onSelectTopNavigation}
        sectionLabel={currentSection?.label ?? t("shell.workspace")}
        pageLabel={current?.label ?? t("shell.workspace")}
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
