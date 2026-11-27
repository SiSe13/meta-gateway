import {
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button as HeroButton, Dropdown, Label, Separator } from "@heroui/react";
import { BrandMark } from "../../components/BrandMark";
import { IconButton } from "../../components/ui";
import { Drawer } from "../../components/Drawer";
import { AppearancePanel } from "../../features/AppearancePanel";
import { UpdateDialog } from "../../features/UpdateDialog";
import { LanguageSwitcher, useI18n } from "../../i18n";
import { useTopBarControls } from "../../lib/topBar";
import type { ThemeChromeProps } from "../types";

type DicebearStyle =
  | "pixel-art"
  | "pixel-art-neutral"
  | "bottts"
  | "bottts-neutral"
  | "identicon"
  | "initials"
  | "avataaars"
  | "avataaars-neutral"
  | "personas"
  | "lorelei"
  | "lorelei-neutral"
  | "fun-emoji";
type AvatarPreference = { seed: string; style: DicebearStyle };

const DICEBEAR_STYLES: DicebearStyle[] = [
  "pixel-art",
  "pixel-art-neutral",
  "bottts",
  "bottts-neutral",
  "identicon",
  "initials",
  "avataaars",
  "avataaars-neutral",
  "personas",
  "lorelei",
  "lorelei-neutral",
  "fun-emoji",
];

// 每次进入控制台时生成新的头像种子。
function createAvatarSeed() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `seed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// 将随机种子映射到头像风格，让头像同时改变种子与画风。
function pickAvatarStyle(seed: string): DicebearStyle {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return DICEBEAR_STYLES[Math.abs(hash) % DICEBEAR_STYLES.length] ?? "pixel-art";
}

function createAvatarPreference(): AvatarPreference {
  const seed = createAvatarSeed();
  return { seed, style: pickAvatarStyle(seed) };
}

// 使用与 MetaAPI 相同的 Dicebear SVG 服务生成头像图像。
function buildAvatarUrl({ seed, style }: AvatarPreference) {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

/** 用 MetaAPI 式的顶栏与侧栏承载现有导航和工作区控制。 */
export function MetapiChrome({
  navigation,
  topNavigation,
  activeTopNavigation,
  showAdminAccount,
  showMemberAccount,
  onOpenAdminAccount,
  onOpenPasswordDialog,
  appearanceHiddenNav,
  version,
  theme,
  onThemeChange,
  onDisconnect,
  health,
  tone,
  update,
  collapsed,
  onCollapse,
  onOpenNav,
  onSelectTopNavigation,
}: ThemeChromeProps) {
  const { t } = useI18n();
  const topBar = useTopBarControls();
  const location = useLocation();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [avatar] = useState<AvatarPreference>(createAvatarPreference);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const observationView =
    location.pathname === "/channels" &&
    new URLSearchParams(location.search).get("view") === "observations";

  return (
    <>
      <header className="console-topbar metapi-topbar">
        <div className="metapi-brand">
          <span className="metapi-brand-mark" aria-hidden="true">
            <BrandMark size={25} />
          </span>
          <span className="metapi-brand-copy">
            <strong>Balbo AI</strong>
            <small>{t("shell.workspace")}</small>
          </span>
        </div>
        {!observationView ? (
          <IconButton
            className="console-sidebar-toggle"
            label={t(collapsed ? "shell.expandNav" : "shell.collapseNav")}
            onClick={onCollapse}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </IconButton>
        ) : null}
        {observationView ? null : (
          <IconButton
            className="console-mobile-trigger"
            label={t("app.nav.open")}
            onClick={onOpenNav}
          >
            <Menu size={19} />
          </IconButton>
        )}
        {topNavigation.length ? (
          <nav className="metapi-top-navigation" aria-label={t("app.topNav.ariaLabel")}>
            {topNavigation.map((item) => (
              <Link
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
              </Link>
            ))}
          </nav>
        ) : null}
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
          ) : topBar.update && showAdminAccount ? (
            <HeroButton
              type="button"
              variant="ghost"
              className="console-update"
              onPress={() => setUpdateOpen(true)}
            >
              {t("appearance.chrome.updatePreview")}
            </HeroButton>
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
          <div className="metapi-profile">
            <Dropdown>
              <Dropdown.Trigger className="metapi-avatar-trigger" aria-label={t("profile.menu")}>
                <span className="metapi-avatar">
                  {avatarFailed ? (
                    <UserRound size={19} aria-hidden="true" />
                  ) : (
                    <img
                      className="metapi-avatar-image"
                      src={buildAvatarUrl(avatar)}
                      alt=""
                      onError={() => setAvatarFailed(true)}
                    />
                  )}
                </span>
                <ChevronDown size={13} aria-hidden="true" />
              </Dropdown.Trigger>
              <Dropdown.Popover className="metapi-profile-popover" placement="bottom end">
                <Dropdown.Menu
                  aria-label={t("profile.menu")}
                  className="metapi-profile-menu-list"
                  onAction={(key) => {
                    if (key === "appearance") setAppearanceOpen(true);
                    if (key === "account") {
                      if (showAdminAccount) onOpenAdminAccount();
                      else onOpenPasswordDialog();
                    }
                    if (key === "logout") onDisconnect();
                  }}
                >
                  <Dropdown.Item id="appearance" textValue={t("profile.appearance")}>
                    <Palette size={16} aria-hidden="true" />
                    <Label>{t("profile.appearance")}</Label>
                  </Dropdown.Item>
                  {showAdminAccount || showMemberAccount ? (
                    <Dropdown.Item id="account" textValue={t("profile.account")}>
                      <UserRound size={16} aria-hidden="true" />
                      <Label>{t("profile.account")}</Label>
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
        {updateOpen && (update || showAdminAccount) ? (
          <UpdateDialog
            update={
              update ?? {
                enabled: false,
                current: "—",
                latest: "—",
                has_update: false,
                release_url: "",
              }
            }
            onClose={() => setUpdateOpen(false)}
          />
        ) : null}
      </header>
      {observationView ? null : (
        <aside className="console-sidebar metapi-sidebar">
          {navigation}
          <div className="console-sidebar-foot">
            {health.available !== false ? (
              <div
                className={`console-health is-${tone}`}
                title={t("dashboard.healthyChannelsHint")}
              >
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
            </div>
          </div>
        </aside>
      )}
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
