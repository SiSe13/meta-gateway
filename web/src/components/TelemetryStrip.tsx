import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Button as HeroButton } from "@heroui/react";
import { useI18n } from "../i18n";

export type TelemetryItem = {
  label: string;
  value: ReactNode;
  onClick?: () => void;
  active?: boolean;
  hint?: string;
  icon?: ReactNode;
  tone?: "primary" | "info" | "success" | "warning" | "danger";
  trend?: number | null;
};

// Measurements render their true value immediately; motion never fabricates zero.
function TelemetryValue({ value }: { value: ReactNode }) {
  return <>{value}</>;
}

function TrendBadge({ trend }: { trend: number }) {
  const { t } = useI18n();
  const up = trend >= 0;
  const pct = `${up ? "+" : "−"}${Math.round(Math.abs(trend) * 100)}%`;
  return (
    <span
      className={`telemetry-trend ${up ? "is-up" : "is-down"}`}
      title={up ? t("dashboard.trendUp") : t("dashboard.trendDown")}
    >
      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {pct}
    </span>
  );
}

function SegmentBody({ item }: { item: TelemetryItem }) {
  return (
    <>
      <span className="telemetry-segment-edge" aria-hidden="true" />
      <span className="telemetry-segment-head">
        {item.label}
        {item.trend != null ? <TrendBadge trend={item.trend} /> : null}
      </span>
      <span className="telemetry-segment-read">
        <span className="telemetry-segment-value">
          <TelemetryValue value={item.value} />
        </span>
        {item.icon ? <span className="telemetry-segment-icon">{item.icon}</span> : null}
      </span>
      {item.hint ? <span className="telemetry-segment-hint">{item.hint}</span> : null}
    </>
  );
}

/**
 * Telemetry readout band. Primary vitals as segments separated by hairline
 * dividers; only genuinely clickable segments are buttons — read-only
 * measurements render as plain segments with a visible caption.
 */
export function TelemetryStrip({ items }: { items: TelemetryItem[] }) {
  const compact = items.length <= 3 && items.every((item) => !item.hint && item.trend == null);
  return (
    <div
      className={`telemetry-strip${compact ? " is-compact" : ""}`}
      role="group"
      aria-label="Telemetry"
    >
      {items.map((item) => {
        const interactive = Boolean(item.onClick);
        const className = [
          "telemetry-segment",
          interactive ? "is-interactive" : "",
          item.active ? "is-active" : "",
          item.tone ? `tone-${item.tone}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (!interactive) {
          return (
            <div key={item.label} className={className}>
              <SegmentBody item={item} />
            </div>
          );
        }
        return (
          <HeroButton
            type="button"
            variant="ghost"
            key={item.label}
            className={className}
            onPress={item.onClick}
            ref={(element) => element?.setAttribute("title", item.hint ?? "")}
            aria-pressed={Boolean(item.active)}
          >
            <SegmentBody item={item} />
          </HeroButton>
        );
      })}
    </div>
  );
}

/** Secondary measurements: a single caption row under the primary band. */
export function TelemetrySecondary({ items }: { items: TelemetryItem[] }) {
  return (
    <div className="telemetry-secondary" role="group" aria-label="Secondary telemetry">
      {items.map((item) => (
        <div key={item.label} className="telemetry-secondary-item" title={item.hint}>
          {item.icon ? (
            <span className="telemetry-secondary-icon" aria-hidden="true">
              {item.icon}
            </span>
          ) : null}
          <span className="telemetry-secondary-label">{item.label}</span>
          <strong className="telemetry-secondary-value">
            <TelemetryValue value={item.value} />
          </strong>
        </div>
      ))}
    </div>
  );
}
