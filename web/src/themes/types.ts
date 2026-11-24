import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { UpdateCheckStatus } from "../api/types";

export type UIThemeId = "metapi";
export type ThemeNavItem = { to: string; label: string; icon: LucideIcon };
export type ThemeChromeProps = {
  navigation: ReactNode;
  topNavigation: { id: string; label: string; to: string }[];
  activeTopNavigation: string;
  showAdminAccount: boolean;
  appearanceHiddenNav: string[];
  sections: { label: string; items: ThemeNavItem[] }[];
  version: string;
  theme: "light" | "dark";
  onThemeChange: () => void;
  onSearch: () => void;
  onDisconnect: () => void;
  health: { healthy: number; total: number; loading: boolean; available?: boolean };
  tone: "idle" | "ok" | "down" | "warn";
  update?: UpdateCheckStatus;
  collapsed: boolean;
  onCollapse: () => void;
  onOpenNav: () => void;
  onSelectTopNavigation: (to: string) => void;
  sectionLabel: string;
  pageLabel: string;
};
export type ThemeDetailsProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};
export type UIThemePackage = {
  id: UIThemeId;
  version: string;
  apiVersion: 1;
  Chrome: ComponentType<ThemeChromeProps>;
  Details: ComponentType<ThemeDetailsProps>;
  channelDetails: "split" | "drawer";
};
