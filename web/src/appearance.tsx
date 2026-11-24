import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { normalizePalette, type PaletteId } from "./palettes";
import type { UIThemeId } from "./themes/types";

export type Appearance = UIThemeId;
export type ColorScheme = "light" | "dark";
// Keep the original key so existing light/dark preferences survive the upgrade.
const SCHEME_KEY = "meta-gateway.theme";
const PALETTE_KEY = "meta-gateway.palette";
const BACKGROUND_KEY = "meta-gateway.background";
const CARD_STYLE_KEY = "meta-gateway.card-style";
const DENSITY_KEY = "meta-gateway.density";
const validScheme = (value: string | null): ColorScheme => (value === "dark" ? "dark" : "light");

export type BackgroundStyle = "paper" | "mist" | "warm";
export type CardStyle = "raised" | "outlined" | "flat";
export type PageDensity = "comfortable" | "standard" | "compact";

const validBackground = (value: string | null): BackgroundStyle =>
  value === "mist" || value === "warm" ? value : "paper";
const validCardStyle = (value: string | null): CardStyle =>
  value === "outlined" || value === "flat" ? value : "raised";
const validDensity = (value: string | null): PageDensity =>
  value === "comfortable" || value === "compact" ? value : "standard";
/**
 * The colour scheme to start in.
 *
 * An explicit choice wins; with none, the system decides. Defaulting to
 * "light" regardless is what made the member app look broken on a dark
 * desktop: the page declared `color-scheme: light` while the browser sat in
 * dark mode, and Chromium's forced darkening repainted the charts solid black.
 * Computed styles stayed correct throughout — the damage happened at paint
 * time, which is why no style assertion caught it. Following the system gives
 * a real dark theme instead of a light one being repainted.
 */
function preferredScheme(): ColorScheme {
  const stored = read(SCHEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Appearance still works without browser storage. */
  }
}

type AppearanceContextValue = {
  appearance: Appearance;
  scheme: ColorScheme;
  palette: PaletteId;
  background: BackgroundStyle;
  cardStyle: CardStyle;
  density: PageDensity;
  setScheme: (value: ColorScheme) => void;
  setPalette: (value: PaletteId) => void;
  setBackground: (value: BackgroundStyle) => void;
  setCardStyle: (value: CardStyle) => void;
  setDensity: (value: PageDensity) => void;
  toggleScheme: () => void;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function transition(apply: () => void) {
  if (
    document.startViewTransition &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    const result = document.startViewTransition(() => flushSync(apply));
    void result.ready.catch(() => {});
    void result.finished.catch(() => {});
  } else apply();
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const appearance: Appearance = "metapi";
  const [scheme, updateScheme] = useState<ColorScheme>(preferredScheme);
  const [palette, updatePalette] = useState<PaletteId>(() => normalizePalette(read(PALETTE_KEY)));
  const [background, updateBackground] = useState<BackgroundStyle>(() =>
    validBackground(read(BACKGROUND_KEY)),
  );
  const [cardStyle, updateCardStyle] = useState<CardStyle>(() =>
    validCardStyle(read(CARD_STYLE_KEY)),
  );
  const [density, updateDensity] = useState<PageDensity>(() => validDensity(read(DENSITY_KEY)));
  useLayoutEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.dataset.palette = palette;
    document.documentElement.dataset.background = background;
    document.documentElement.dataset.cardStyle = cardStyle;
    document.documentElement.dataset.density = density;
    document.documentElement.classList.toggle("dark", scheme === "dark");
  }, [appearance, background, cardStyle, density, palette, scheme]);
  useEffect(() => {
    const sync = () => {
      document.documentElement.dataset.visibility = document.hidden ? "hidden" : "visible";
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key === SCHEME_KEY || event.key === null)
        updateScheme(validScheme(read(SCHEME_KEY)));
      if (event.key === PALETTE_KEY || event.key === null)
        updatePalette(normalizePalette(read(PALETTE_KEY)));
      if (event.key === BACKGROUND_KEY || event.key === null)
        updateBackground(validBackground(read(BACKGROUND_KEY)));
      if (event.key === CARD_STYLE_KEY || event.key === null)
        updateCardStyle(validCardStyle(read(CARD_STYLE_KEY)));
      if (event.key === DENSITY_KEY || event.key === null)
        updateDensity(validDensity(read(DENSITY_KEY)));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  // `remember` distinguishes "the operator picked this" from "the system
  // changed"; only the former is written to storage, so a system-driven scheme
  // keeps following the system afterwards.
  const applyScheme = useCallback((value: ColorScheme, remember: boolean) => {
    transition(() => {
      document.documentElement.classList.toggle("dark", value === "dark");
      updateScheme(value);
      if (remember) persist(SCHEME_KEY, value);
    });
  }, []);
  const setScheme = useCallback(
    (value: ColorScheme) => {
      if (value === scheme) return;
      applyScheme(value, true);
    },
    [scheme, applyScheme],
  );
  // Follow the desktop while the operator has not chosen a scheme themselves.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = (event: MediaQueryListEvent) => {
      if (read(SCHEME_KEY)) return;
      applyScheme(event.matches ? "dark" : "light", false);
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [applyScheme]);
  const toggleScheme = useCallback(
    () => setScheme(scheme === "dark" ? "light" : "dark"),
    [scheme, setScheme],
  );
  // 调整配色只更新颜色变量，不触发布局切换动画。
  const setPalette = useCallback(
    (value: PaletteId) => {
      if (value === palette) return;
      document.documentElement.dataset.palette = value;
      updatePalette(value);
      persist(PALETTE_KEY, value);
    },
    [palette],
  );
  // 背景预设、卡片样式和页面密度都是本地偏好，切换后立即作用于全局样式。
  const setBackground = useCallback(
    (value: BackgroundStyle) => {
      if (value === background) return;
      updateBackground(value);
      persist(BACKGROUND_KEY, value);
    },
    [background],
  );
  const setCardStyle = useCallback(
    (value: CardStyle) => {
      if (value === cardStyle) return;
      updateCardStyle(value);
      persist(CARD_STYLE_KEY, value);
    },
    [cardStyle],
  );
  const setDensity = useCallback(
    (value: PageDensity) => {
      if (value === density) return;
      updateDensity(value);
      persist(DENSITY_KEY, value);
    },
    [density],
  );
  const value = useMemo(
    () => ({
      appearance,
      scheme,
      palette,
      background,
      cardStyle,
      density,
      setScheme,
      setPalette,
      setBackground,
      setCardStyle,
      setDensity,
      toggleScheme,
    }),
    [
      appearance,
      scheme,
      palette,
      background,
      cardStyle,
      density,
      setScheme,
      setPalette,
      setBackground,
      setCardStyle,
      setDensity,
      toggleScheme,
    ],
  );
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance requires AppearanceProvider");
  return value;
}

/** 独立业务页面也使用统一控制台布局。 */
export function useUITheme() {
  return useContext(AppearanceContext)?.appearance ?? "metapi";
}
