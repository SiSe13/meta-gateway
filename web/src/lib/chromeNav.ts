import type { ConsoleRole } from "../session";
import {
  Activity,
  ArrowUpDown,
  Boxes,
  Cable,
  CalendarCheck,
  KeyRound,
  Package,
  FileClock,
  ScrollText,
  Settings,
  UserRound,
  Users,
  Eye,
  type LucideIcon,
} from "lucide-react";

export type ChromeNavGroupId = "console" | "backup" | "users" | "settings" | "observations";

export interface ChromeNavGroup {
  id: ChromeNavGroupId;
  labelKey: string;
  /** 顶栏切组后打开的默认页面。 */
  defaultPath: string;
}

/**
 * 顶栏工作区与页面导航共用这份注册表，避免顶栏、侧栏和外观开关分叉。
 */
export const CHROME_NAV_GROUPS: ChromeNavGroup[] = [
  { id: "console", labelKey: "app.topNav.console", defaultPath: "/" },
  { id: "users", labelKey: "app.topNav.users", defaultPath: "/users" },
  {
    id: "observations",
    labelKey: "app.topNav.observations",
    defaultPath: "/channels?view=observations",
  },
  {
    id: "settings",
    labelKey: "app.topNav.settings",
    defaultPath: "/settings?tab=runtime&section=relay",
  },
  { id: "backup", labelKey: "app.topNav.backupExtensions", defaultPath: "/exchange" },
];

export interface ChromeNavItem {
  /** 用于权限、隐藏偏好和当前页判断的稳定路径，可带 query。 */
  path: string;
  labelKey: string;
  icon: LucideIcon;
  group: ChromeNavGroupId;
  roles?: ConsoleRole[];
  /** 需要团队成员会话；部署管理员令牌不显示个人账户入口。 */
  accountOnly?: boolean;
}

/** 所有已登录用户可见的控制台页面。 */
const ALL: ConsoleRole[] = ["owner", "admin", "member"];
/** 网关运维页面只对站点管理员开放。 */
const STAFF: ConsoleRole[] = ["owner", "admin"];
/** 团队管理中的策略和财务配置由站长管理。 */
const OWNER: ConsoleRole[] = ["owner"];

export const CHROME_NAV_ITEMS: ChromeNavItem[] = [
  { path: "/", labelKey: "app.nav.overview", icon: Activity, group: "console", roles: ALL },
  {
    path: "/channels",
    labelKey: "app.nav.channels",
    icon: Cable,
    group: "console",
    roles: STAFF,
  },
  { path: "/models", labelKey: "app.nav.models", icon: Boxes, group: "console", roles: ALL },
  { path: "/keys", labelKey: "app.nav.keys", icon: KeyRound, group: "console", roles: ALL },
  {
    path: "/logs",
    labelKey: "app.nav.logs",
    icon: ScrollText,
    group: "console",
    roles: ALL,
  },
  {
    path: "/system-logs",
    labelKey: "app.nav.systemLogs",
    icon: FileClock,
    group: "console",
    roles: STAFF,
  },
  {
    path: "/checkins",
    labelKey: "app.nav.checkins",
    icon: CalendarCheck,
    group: "console",
    roles: STAFF,
  },
  {
    path: "/exchange",
    labelKey: "app.nav.exchange",
    icon: ArrowUpDown,
    group: "backup",
    roles: STAFF,
  },
  {
    path: "/store",
    labelKey: "app.nav.store",
    icon: Package,
    group: "backup",
    roles: STAFF,
  },
  {
    path: "/backups",
    labelKey: "ops.tab.backups",
    icon: Package,
    group: "backup",
    roles: STAFF,
  },
  {
    path: "/users/members",
    labelKey: "users.nav.members",
    icon: Users,
    group: "users",
    roles: STAFF,
  },
  {
    path: "/users/policies",
    labelKey: "users.nav.policies",
    icon: Users,
    group: "users",
    roles: OWNER,
  },
  {
    path: "/users/quotas",
    labelKey: "users.nav.quotas",
    icon: Users,
    group: "users",
    roles: OWNER,
  },
  {
    path: "/users/codes",
    labelKey: "users.nav.codes",
    icon: KeyRound,
    group: "users",
    roles: OWNER,
  },
  {
    path: "/users/pricing",
    labelKey: "users.nav.pricing",
    icon: Settings,
    group: "users",
    roles: OWNER,
  },
  {
    path: "/users/oauth",
    labelKey: "users.nav.oauth",
    icon: UserRound,
    group: "users",
    roles: OWNER,
  },
  {
    path: "/channels?view=observations",
    labelKey: "app.nav.observations",
    icon: Eye,
    group: "observations",
    roles: STAFF,
  },
];

/** 成员通过导航看不到这些站点管理页面，服务端仍负责最终鉴权。 */
export const STAFF_ONLY_PATHS = [
  "/channels",
  "/checkins",
  "/exchange",
  "/backups",
  "/settings",
  "/system-logs",
  "/store",
  "/users",
  "/setup",
  "/plugins",
];

/** 判断当前会话能否看见某个入口；接口授权仍由服务端执行。 */
export function canAccessNav(item: ChromeNavItem, role: ConsoleRole | null): boolean {
  if (item.accountOnly && role === null) return false;
  return !item.roles || item.roles.includes(role ?? "owner");
}

/** 根据路径与 query 确定顶栏当前工作区。 */
export function chromeNavGroupForLocation(pathname: string, search: string): ChromeNavGroupId {
  const params = new URLSearchParams(search);
  if (pathname === "/channels" && params.get("view") === "observations") return "observations";
  if (pathname === "/users" || pathname.startsWith("/users/")) return "users";
  if (pathname === "/settings" || pathname === "/maintain") return "settings";
  if (
    pathname === "/exchange" ||
    pathname === "/backups" ||
    pathname === "/store" ||
    pathname.startsWith("/plugins/")
  )
    return "backup";
  return "console";
}
