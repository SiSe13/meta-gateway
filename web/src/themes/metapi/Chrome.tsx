import {
  ChevronDown,
  Command,
  LogOut,
  Menu,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  UserRound,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { Button as HeroButton, Dropdown, Label, Separator } from "@heroui/react";
import { BrandMark } from "../../components/BrandMark";
import { IconButton } from "../../components/ui";
import { Drawer } from "../../components/Drawer";
import { AppearancePanel } from "../../features/AppearancePanel";
import { UpdateDialog } from "../../features/UpdateDialog";
import { LanguageSwitcher, useI18n } from "../../i18n";
import { useTopBarControls } from "../../lib/topBar";
import type { ThemeChromeProps } from "../types";

/** 用 MetaAPI 式的顶栏与侧栏承载现有导航和工作区控制。 */
export function MetapiChrome({
  navigation,
  topNavigation,
  activeTopNavigation,
  showAdminAccount,
  appearanceHiddenNav,
  version,
  theme,
  onThemeChange,
  onSearch,
  onDisconnect,
  health,
  tone,
  update,
  collapsed,
  onCollapse,
  onOpenNav,
  onSelectTopNavigation,
  sectionLabel,
  pageLabel,
}: ThemeChromeProps) {
  const { t } = useI18n();
  const topBar = useTopBarControls();
  const navigate = useNavigate();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <header className="console-topbar metapi-topbar">
        <div className="metapi-brand">
          <span className="metapi-brand-mark" aria-hidden="true">
            <BrandMark size={25} />
          </span>
          <span className="metapi-brand-copy">
            <strong>Meta Gateway</strong>
            <small>{t("shell.workspace")}</small>
          </span>
        </div>
        <IconButton
          className="console-mobile-trigger"
          label={t("app.nav.open")}
          onClick={onOpenNav}
        >
          <Menu size={19} />
        </IconButton>
        <nav className="metapi-top-navigation" aria-label={t("app.topNav.ariaLabel")}>
          {topNavigation.map((item) => (
            <NavLink
              key={item.id}
              to={item.to}
              className={item.id === activeTopNavigation ? "active" : ""}
              aria-current={item.id === activeTopNavigation ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                onSelectTopNavigation(item.to);
              }}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="console-breadcrumb">
          <span>{sectionLabel}</span>
          <strong>{pageLabel}</strong>
        </div>
        <div className="console-global-actions">
          {topBar.update && update ? (
            <HeroButton
              type="button"
              variant="ghost"
              className="console-update"
              onPress={() => setUpdateOpen(true)}
            >
              {t("app.updateAvailable", { version: update.latest })}
            </HeroButton>
          ) : null}
          {topBar.search ? (
            <IconButton
              className="console-mobile-search"
              label={t("command.placeholder")}
              onClick={onSearch}
            >
              <Search size={17} />
            </IconButton>
          ) : null}
          {topBar.theme ? (
            <IconButton
              label={t(theme === "dark" ? "app.themeLight" : "app.themeDark")}
              onClick={onThemeChange}
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </IconButton>
          ) : null}
          {topBar.language ? <LanguageSwitcher className="console-language" /> : null}
          <span className="console-action-divider" />
          <div className="metapi-profile" ref={profileRef}>
            <Dropdown>
              <Dropdown.Trigger className="metapi-avatar-trigger" aria-label={t("profile.menu")}>
                <span className="metapi-avatar">
                  <UserRound size={17} aria-hidden="true" />
                </span>
                <ChevronDown size={13} aria-hidden="true" />
              </Dropdown.Trigger>
              <Dropdown.Popover
                className="metapi-profile-popover"
                placement="bottom end"
                UNSTABLE_portalContainer={profileRef.current ?? undefined}
              >
                <Dropdown.Menu
                  aria-label={t("profile.menu")}
                  className="metapi-profile-menu-list"
                  onAction={(key) => {
                    if (key === "appearance") setAppearanceOpen(true);
                    if (key === "account") navigate("/settings?tab=operator");
                    if (key === "logout") onDisconnect();
                  }}
                >
                  <Dropdown.Item id="appearance" textValue={t("profile.appearance")}>
                    <Palette size={16} aria-hidden="true" />
                    <Label>{t("profile.appearance")}</Label>
                  </Dropdown.Item>
                  {showAdminAccount ? (
                    <Dropdown.Item id="account" textValue={t("profile.adminAccount")}>
                      <UserRound size={16} aria-hidden="true" />
                      <Label>{t("profile.adminAccount")}</Label>
                    </Dropdown.Item>
                  ) : null}
                  <Separator className="metapi-profile-divider" />
                  <Dropdown.Item id="logout" textValue={t("profile.logout")} variant="danger">
                    <LogOut size={16} aria-hidden="true" />
                    <Label>{t("profile.logout")}</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </div>
        {updateOpen && update ? (
          <UpdateDialog update={update} onClose={() => setUpdateOpen(false)} />
        ) : null}
      </header>
      <aside className="console-sidebar metapi-sidebar">
        <HeroButton
          variant="ghost"
          className="console-search"
          type="button"
          aria-label={t("command.placeholder")}
          onPress={onSearch}
        >
          <Search size={16} aria-hidden="true" />
          <span>{t("shell.search")}</span>
          <kbd>
            <Command size={11} /> K
          </kbd>
        </HeroButton>
        {navigation}
        <div className="console-sidebar-foot">
          {health.available !== false ? (
            <div className={`console-health is-${tone}`} title={t("dashboard.healthyChannelsHint")}>
              <span className="console-health-dot" />
              <div>
                <span>{t("shell.gatewayStatus")}</span>
                <strong>
                  {health.loading ? "—" : `${health.healthy} / ${health.total}`}{" "}
                  <small>{t("dashboard.healthyChannels")}</small>
                </strong>
              </div>
            </div>
          ) : null}
          <div className="console-sidebar-meta">
            <span>{version}</span>
            <IconButton
              label={t(collapsed ? "shell.expandNav" : "shell.collapseNav")}
              onClick={onCollapse}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </IconButton>
          </div>
        </div>
      </aside>
      {appearanceOpen ? (
        <Drawer
          title={t("profile.appearance")}
          onClose={() => setAppearanceOpen(false)}
          width={560}
          className="appearance-drawer"
        >
          <AppearancePanel modeHiddenNav={appearanceHiddenNav} showCurrency={false} />
        </Drawer>
      ) : null}
    </>
  );
}
