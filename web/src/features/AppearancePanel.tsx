import { Check, Download, Languages, Moon, RotateCcw, Sun } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button as HeroButton } from "@heroui/react";
import { api } from "../api/client";
import { Button, Field } from "../components/ui";
import { formatErrorMessage } from "../formatError";
import { setCurrency } from "../lib/format";
import { useOptionalSession } from "../session";
import {
  useAppearance,
  type BackgroundStyle,
  type CardStyle,
  type PageDensity,
} from "../appearance";
import { useI18n } from "../i18n";
import { PALETTES } from "../palettes";
import { CHROME_NAV_ITEMS, canAccessNav } from "../lib/chromeNav";
import {
  TOP_BAR_CONTROLS,
  resetChromePrefs,
  setNavVisible,
  setTopBarControl,
  useChromePrefs,
  type TopBarControlId,
} from "../lib/topBar";

// One glyph per entry, so the picker reads as a picture of the chrome it is
// configuring rather than a list of ids.
const CONTROL_ICONS: Record<TopBarControlId, ReactNode> = {
  update: <Download size={16} />,
  theme: <Moon size={16} />,
  language: <Languages size={16} />,
};

const BACKGROUND_STYLES: { id: BackgroundStyle; nameKey: string }[] = [
  { id: "paper", nameKey: "appearance.background.paper" },
  { id: "mist", nameKey: "appearance.background.mist" },
  { id: "warm", nameKey: "appearance.background.warm" },
];

const CARD_STYLES: { id: CardStyle; nameKey: string }[] = [
  { id: "raised", nameKey: "appearance.cards.raised" },
  { id: "outlined", nameKey: "appearance.cards.outlined" },
  { id: "flat", nameKey: "appearance.cards.flat" },
];

const PAGE_DENSITIES: { id: PageDensity; nameKey: string }[] = [
  { id: "comfortable", nameKey: "appearance.density.comfortable" },
  { id: "standard", nameKey: "appearance.density.standard" },
  { id: "compact", nameKey: "appearance.density.compact" },
];

function AppearanceChoiceGroup<T extends string>({
  title,
  kind,
  value,
  options,
  label,
  onSelect,
}: {
  title: string;
  kind: "background" | "cards" | "density";
  value: T;
  options: { id: T; nameKey: string }[];
  label: (key: string) => string;
  onSelect: (value: T) => void;
}) {
  return (
    <fieldset className="appearance-section appearance-divider-section">
      <legend>{title}</legend>
      <div className={`appearance-option-grid appearance-option-grid--${kind}`}>
        {options.map((option) => (
          <HeroButton
            key={option.id}
            type="button"
            variant="ghost"
            className="appearance-option"
            data-option-group={kind}
            data-option-value={option.id}
            aria-pressed={value === option.id}
            onPress={() => onSelect(option.id)}
          >
            {kind === "background" ? (
              <span
                className="appearance-option-preview appearance-background-preview"
                data-background={option.id}
                aria-hidden="true"
              />
            ) : kind === "cards" ? (
              <span
                className="appearance-option-preview appearance-card-preview"
                data-card-style={option.id}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
              </span>
            ) : (
              <span
                className="appearance-option-preview appearance-density-preview"
                data-density={option.id}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
              </span>
            )}
            <span className="appearance-option-label">{label(option.nameKey)}</span>
            {value === option.id ? (
              <span className="appearance-option-selected" aria-hidden="true">
                <Check size={13} />
              </span>
            ) : null}
          </HeroButton>
        ))}
      </div>
    </fieldset>
  );
}

function ChromeEntryToggle({
  icon,
  label,
  hint,
  on,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <HeroButton
      type="button"
      variant="ghost"
      className="topbar-toggle"
      aria-pressed={on}
      onPress={onToggle}
    >
      <span className="topbar-toggle-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="topbar-toggle-copy">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className="appearance-switch-track" aria-hidden="true">
        <span />
      </span>
    </HeroButton>
  );
}

export function AppearancePanel({
  modeHiddenNav = [],
  showCurrency = true,
}: {
  modeHiddenNav?: string[];
  /** 头像抽屉可收起货币设置，保留其他外观能力。 */
  showCurrency?: boolean;
}) {
  const session = useOptionalSession();
  const { t } = useI18n();
  const {
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
  } = useAppearance();
  const chrome = useChromePrefs();
  const hiddenNav = new Set(chrome.hiddenNav);
  const pinnedNav = new Set(chrome.pinnedNav);
  // Entries the gateway's own state hides (the multi-user area while the mode is
  // personal). The caller knows the mode and passes the resulting list, so this
  // panel needs no session of its own.
  const modeHidden = new Set(modeHiddenNav);
  const resetAppearance = () => {
    setScheme("light");
    setPalette("default");
    setBackground("paper");
    setCardStyle("raised");
    setDensity("standard");
    resetChromePrefs();
  };
  return (
    <section className="appearance-panel appearance-panel--drawer">
      <fieldset className="appearance-section appearance-divider-section">
        <legend>{t("appearance.mode")}</legend>
        <div className="appearance-scheme-control">
          <Sun size={17} aria-hidden="true" />
          <button
            type="button"
            role="switch"
            aria-checked={scheme === "dark"}
            aria-label={t("appearance.mode")}
            className="appearance-switch"
            onClick={() => setScheme(scheme === "dark" ? "light" : "dark")}
          >
            <span />
          </button>
          <Moon size={17} aria-hidden="true" />
        </div>
      </fieldset>
      <AppearanceChoiceGroup
        title={t("appearance.background.title")}
        kind="background"
        value={background}
        options={BACKGROUND_STYLES}
        label={t}
        onSelect={setBackground}
      />
      <fieldset className="appearance-section appearance-divider-section">
        <legend>{t("appearance.palette")}</legend>
        <div className="palette-picker">
          {PALETTES.map((option) => (
            <HeroButton
              key={option.id}
              type="button"
              variant="ghost"
              className="palette-swatch"
              data-palette={option.id}
              aria-pressed={palette === option.id}
              onPress={() => setPalette(option.id)}
            >
              <span className="palette-swatch-chip" aria-hidden="true" />
              <span className="palette-swatch-name">{t(option.nameKey)}</span>
              {palette === option.id ? <Check size={14} /> : null}
            </HeroButton>
          ))}
        </div>
      </fieldset>
      <AppearanceChoiceGroup
        title={t("appearance.cards.title")}
        kind="cards"
        value={cardStyle}
        options={CARD_STYLES}
        label={t}
        onSelect={setCardStyle}
      />
      <AppearanceChoiceGroup
        title={t("appearance.density.title")}
        kind="density"
        value={density}
        options={PAGE_DENSITIES}
        label={t}
        onSelect={setDensity}
      />
      <fieldset className="appearance-section appearance-divider-section appearance-topbar-section">
        <legend>{t("appearance.chrome.title")}</legend>
        <div className="chrome-pref-group">
          <h4 className="chrome-pref-heading">{t("appearance.chrome.groupBar")}</h4>
          <div className="topbar-picker">
            {TOP_BAR_CONTROLS.map((id) => (
              <ChromeEntryToggle
                key={id}
                icon={CONTROL_ICONS[id]}
                label={t(`appearance.chrome.${id}`)}
                hint={t(`appearance.chrome.${id}Hint`)}
                on={chrome.controls[id]}
                onToggle={() => setTopBarControl(id, !chrome.controls[id])}
              />
            ))}
          </div>
        </div>
        <div className="chrome-pref-group">
          <h4 className="chrome-pref-heading">{t("appearance.chrome.groupNav")}</h4>
          <p className="chrome-pref-hint">{t("appearance.chrome.navHint")}</p>
          <div className="topbar-picker">
            {CHROME_NAV_ITEMS.filter((item) => !session || canAccessNav(item, session.role)).map(
              (item) => {
                const Icon = item.icon;
                // An entry can be hidden by gateway state rather than by a
                // preference — the multi-user area while the mode is personal.
                // The switch still works; turning it on pins the entry back.
                const gated = modeHidden.has(item.path);
                const visible = !hiddenNav.has(item.path) && (!gated || pinnedNav.has(item.path));
                return (
                  <ChromeEntryToggle
                    key={item.path}
                    icon={<Icon size={16} />}
                    label={t(item.labelKey)}
                    on={visible}
                    onToggle={() => setNavVisible(item.path, !visible, gated)}
                  />
                );
              },
            )}
          </div>
        </div>
      </fieldset>
      {showCurrency ? (
        <details className="appearance-currency-section">
          <summary>{t("appearance.currency")}</summary>
          <p className="appearance-description">{t("appearance.currencyHint")}</p>
          <CurrencySettings />
        </details>
      ) : null}
      <div className="appearance-panel-footer">
        <HeroButton type="button" variant="outline" onPress={resetAppearance}>
          <RotateCcw size={14} />
          {t("appearance.chrome.reset")}
        </HeroButton>
      </div>
    </section>
  );
}

/**
 * Money presentation: the symbol and rate every amount is rendered through.
 *
 * Stored amounts stay in the ledger's unit, so switching currency rewrites
 * nothing — it only changes what the console and the member app print. The
 * preview line shows the effect on a real number instead of asking the
 * operator to imagine it.
 */
function CurrencySettings() {
  const { t } = useI18n();
  const { client } = useOptionalSession() ?? { client: null };
  // The console's API surface is built from the live session client; without
  // one (still connecting, or rendered outside a session) the query stays
  // disabled rather than crashing the panel.
  const service = useMemo(() => (client ? api(client) : null), [client]);
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["display-settings"],
    queryFn: ({ signal }) => service!.displaySettings(signal),
    enabled: Boolean(service),
  });
  const [symbol, setSymbol] = useState("");
  const [rate, setRate] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Seed the form from the server, and keep the formatter in sync so every
  // amount already on screen re-renders through the new symbol.
  useEffect(() => {
    if (!settings.data) return;
    setSymbol(settings.data.symbol);
    setRate(String(settings.data.rate));
    setCurrency(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => service!.saveDisplaySettings({ symbol, rate: Number(rate) || 1 }),
    onSuccess: async (next) => {
      if (next) setCurrency(next);
      setSaved(true);
      setError(null);
      // Amounts live in list caches; refetching them re-renders with the new
      // symbol without a page reload.
      await queryClient.invalidateQueries();
    },
    onError: (err) => {
      setError(err);
      setSaved(false);
    },
  });

  return (
    <div className="currency-settings">
      <div className="form-grid">
        <Field label={t("appearance.currencySymbol")} hint={t("appearance.currencySymbolHint")}>
          <input
            value={symbol}
            maxLength={8}
            onChange={(e) => {
              setSymbol(e.target.value);
              setSaved(false);
            }}
            placeholder="$"
          />
        </Field>
        <Field label={t("appearance.currencyRate")} hint={t("appearance.currencyRateHint")}>
          <input
            type="number"
            min={0.0001}
            step="0.01"
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              setSaved(false);
            }}
            placeholder="1"
          />
        </Field>
      </div>
      <p className="appearance-description">
        {t("appearance.currencyPreview", {
          sample: `${symbol || "$"}${((Number(rate) || 1) * 0.42).toFixed(2)}`,
        })}
      </p>
      {error ? (
        <p className="currency-note is-error" role="alert">
          {formatErrorMessage(error, t)}
        </p>
      ) : null}
      <div className="currency-actions">
        <Button
          type="button"
          loading={save.isPending}
          disabled={save.isPending || !symbol.trim()}
          onClick={() => save.mutate()}
        >
          {t("appearance.currencySave")}
        </Button>
        {saved ? <span className="currency-note">{t("appearance.currencySaved")}</span> : null}
      </div>
    </div>
  );
}
