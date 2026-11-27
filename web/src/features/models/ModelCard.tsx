import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { formatCost, formatGroupName, formatTokens, useCurrency } from "../../lib/format";

/**
 * One model, told completely, as a card in a responsive grid.
 *
 * The member catalogue used to be a table row per model: name, a couple of
 * badges, a price line, and two buttons — nothing that lets someone compare two
 * models against each other or decide which one to reach for. This is the
 * reference we went to look at (api.ilovecat520.me's model list) distilled to
 * what this gateway can honestly say: the model's identity, its real specs, the
 * capabilities we can derive from those specs, what this account has actually
 * done with it, whether the upstreams behind it are answering, its price as the
 * member will actually pay it, and the two ways in.
 *
 * The personal figures and the upstream health arrive as typed props rather
 * than as free-form slots, because a card that prints "3.2s" has to know whether
 * that number is a mean of 400 requests or a single sample: an unmeasured model
 * prints a dash, never a plausible-looking default.
 *
 * Shared on purpose (features/models): the operator's routing directory is the
 * same model, seen with more columns, and can adopt this card unchanged.
 */

/** What this account did with this model, over whatever window the host asked. */
export type ModelCardStats = {
  requests: number;
  ok: number;
  failed: number;
  /** 2xx share, or null when nothing was measured in the window. */
  successRate: number | null;
  avgLatencyMs: number | null;
  p95Ms: number | null;
  tokens: number;
  cost: number;
  /** The window these figures cover, worded by the host that read them. */
  windowLabel: string;
};

/** The gateway's own probes for the upstreams that serve this model. */
export type ModelCardHealth = {
  /** Enabled upstreams serving this model, for this reader. */
  upstreams: number;
  /** How many of them answered their latest probe. */
  healthy: number;
  /** How many of them have answered a probe at least once. */
  probed: number;
  /** Probe samples behind the ratio; 0 means "never probed", not "all good". */
  samples: number;
  /** Successful probe samples, summed across all channels for this model. */
  okSamples: number;
  /** 0..1, meaningful only when samples > 0. */
  availability: number;
  avgLatencyMs: number;
};

export type ModelCardProps = {
  name: string;
  /** Vendor or group chip: who makes it, or where it came from. */
  vendor?: string;
  /** The grouping chip (the member's plan group, the operator's model family). */
  group?: string;
  /** True when the model is one the reader has arranged / pinned. */
  arranged?: boolean;
  /** Spec line: context window, modalities, thinking. */
  facts?: ReactNode;
  /** Chips derived from those same fields — never a claim we cannot source. */
  capabilities?: string[];
  /** Price as the reader pays it, including the group multiplier when there is one. */
  prices?: ReactNode;
  /** The ways in: details, connect, arrange. */
  actions?: ReactNode;
  /** Extra line under the specs — a note the host owns. */
  metrics?: ReactNode;
  /** This account's own figures for the model. Omitted when the host cannot read them. */
  stats?: ModelCardStats;
  /** Upstream probe state. Omitted when the host may not read it. */
  health?: ModelCardHealth;
  /** Shown top-right, e.g. the plan group or a status chip. */
  status?: ReactNode;
};

/** Seconds with one decimal; whole seconds past ten, where a decimal is noise. */
function seconds(ms: number) {
  return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
}

export function ModelCard({
  name,
  vendor,
  group,
  arranged,
  facts,
  capabilities,
  prices,
  actions,
  metrics,
  stats,
  health,
  status,
}: ModelCardProps) {
  const { t } = useI18n();
  // The price block subscribes to the currency; these two figures are money as
  // well, so the same subscription has to cover them.
  useCurrency();
  const healthTone =
    !health || health.samples === 0
      ? "unknown"
      : health.availability >= 0.95
        ? "ok"
        : health.availability >= 0.8
          ? "degraded"
          : "down";
  return (
    <article className="model-card" aria-label={name}>
      <header className="model-card-head">
        <div className="model-card-identity">
          <h3 className="mono" title={name}>
            {name}
          </h3>
          <div className="model-card-chips">
            {vendor ? <span className="model-card-chip is-vendor">{vendor}</span> : null}
            {group ? <span className="model-card-chip">{formatGroupName(group, t)}</span> : null}
            {arranged ? <span className="model-card-chip is-arranged">★</span> : null}
          </div>
        </div>
        {status ? <div className="model-card-status">{status}</div> : null}
      </header>

      {facts ? <div className="model-card-facts">{facts}</div> : null}

      {stats ? (
        <div className="model-card-usage">
          {/* The window on its own line, once — not repeated inside all four
              labels, where "用量 · 近 24 小时" wrapped and knocked the four
              columns out of alignment with each other. */}
          <span className="model-card-usage-caption">{stats.windowLabel}</span>
          <dl className="model-card-stats">
            <div>
              <dt>{t("modelsPage.stats.usage")}</dt>
              <dd>{stats.requests > 0 ? formatTokens(stats.tokens) : "—"}</dd>
              <small>{t("modelsPage.stats.requests", { n: stats.requests })}</small>
            </div>
            <div>
              <dt>{t("modelsPage.stats.success")}</dt>
              <dd>
                {stats.requests > 0 && stats.successRate !== null
                  ? `${Math.round(stats.successRate * 100)}%`
                  : "—"}
              </dd>
              <small>
                {stats.failed > 0 ? t("modelsPage.stats.failed", { n: stats.failed }) : ""}
              </small>
            </div>
            <div>
              <dt>{t("modelsPage.stats.latency")}</dt>
              <dd>{stats.avgLatencyMs === null ? "—" : seconds(stats.avgLatencyMs)}</dd>
              <small>
                {stats.p95Ms === null
                  ? ""
                  : t("modelsPage.stats.p95", { value: seconds(stats.p95Ms) })}
              </small>
            </div>
            <div>
              <dt>{t("modelsPage.stats.cost")}</dt>
              <dd>{stats.requests > 0 && stats.cost > 0 ? formatCost(stats.cost) : "—"}</dd>
              <small />
            </div>
          </dl>
        </div>
      ) : null}

      {health ? (
        health.samples > 0 ? (
          // 竖线按多渠道汇总后的成功比例着色，只表达总体比例，不伪装成时间走势。
          <div className={`model-card-health is-${healthTone}`}>
            <span
              className="availability-bars"
              aria-hidden="true"
              title={t("modelsPage.health.aggregate", {
                ok: health.okSamples,
                total: health.samples,
              })}
            >
              {Array.from({ length: 24 }, (_, index) => (
                <span
                  key={index}
                  className={`availability-bar ${index < Math.round(health.availability * 24) ? "is-ok" : "is-failed"}`}
                />
              ))}
            </span>
            <strong className={`model-health-figure is-${healthTone}`}>
              {(Math.floor(Math.max(0, Math.min(1, health.availability)) * 1000) / 10).toFixed(1)}%
            </strong>
          </div>
        ) : null
      ) : null}

      {capabilities?.length ? (
        <ul className="model-card-caps">
          {capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      ) : null}

      {metrics ? <div className="model-card-metrics">{metrics}</div> : null}

      <div className="model-card-foot">
        <div className="model-card-price">{prices}</div>
        <div className="model-card-actions">{actions}</div>
      </div>
    </article>
  );
}

/** The grid the cards live in. One column on a phone, two on a tablet, three wider. */
export function ModelCardGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={["model-card-grid", className].filter(Boolean).join(" ")}>{children}</div>;
}
