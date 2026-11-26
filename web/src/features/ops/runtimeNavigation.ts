import type { RuntimeEditableSettings } from "../../api/types";

type EditableKey = keyof RuntimeEditableSettings;

export const RUNTIME_ZERO_MEANS_DEFAULT: ReadonlySet<EditableKey> = new Set<EditableKey>([
  "outbound_connect_timeout_seconds",
  "outbound_header_timeout_seconds",
  "outbound_image_header_timeout_seconds",
  "outbound_tls_timeout_seconds",
  "outbound_max_idle_conns",
  "outbound_max_idle_conns_per_host",
  "relay_max_body_mb",
  "relay_max_image_mb",
  "site_probe_interval_seconds",
]);

export interface RuntimeSection {
  key: string;
  label: string;
  fields: readonly EditableKey[];
  /** 相同 menuKey 的相关设置卡片共用一个侧栏入口。 */
  menuKey?: string;
  menuLabel?: string;
}

export interface RuntimeGroup {
  key: string;
  label: string;
  sections: readonly RuntimeSection[];
}

export interface RuntimeMenuEntry {
  key: string;
  label: string;
  sections: readonly RuntimeSection[];
}

export function runtimeMenuEntries(group: RuntimeGroup): RuntimeMenuEntry[] {
  const entries = new Map<string, RuntimeMenuEntry>();
  for (const section of group.sections) {
    const key = section.menuKey ?? section.key;
    const entry = entries.get(key);
    if (entry) {
      entries.set(key, { ...entry, sections: [...entry.sections, section] });
    } else {
      entries.set(key, {
        key,
        label: section.menuLabel ?? section.label,
        sections: [section],
      });
    }
  }
  return [...entries.values()];
}

export function runtimeSectionMenuKey(section: RuntimeSection) {
  return section.menuKey ?? section.key;
}

const RELAY_SECTION: RuntimeSection = {
  key: "relay",
  label: "ops.runtime.section.relay",
  fields: [
    "cross_channel_failover_enabled",
    "retry_times",
    "channel_retry_times",
    "images_failover_enabled",
    "images_failover_include_ambiguous",
    "images_failover_include_uncertain",
  ],
};

/** 设置页侧栏与运行参数卡片共用的分组目录。 */
export const RUNTIME_GROUPS: readonly RuntimeGroup[] = [
  {
    key: "forwarding",
    label: "ops.runtime.navGroup.forwarding",
    sections: [
      RELAY_SECTION,
      {
        key: "routing",
        label: "ops.runtime.section.routing",
        menuKey: "routing",
        menuLabel: "ops.runtime.menu.routingStrategy",
        fields: [
          "routing_latency_aware",
          "routing_error_aware",
          "routing_concurrency_enabled",
          "routing_concurrency_limit",
        ],
      },
      {
        key: "stableFirst",
        label: "ops.runtime.section.stableFirst",
        menuKey: "routing",
        fields: [
          "stable_first_enabled",
          "stable_first_denominator",
          "stable_first_promote_requests",
        ],
      },
      {
        key: "sticky",
        label: "ops.runtime.section.sticky",
        menuKey: "routing",
        fields: ["sticky_enabled", "sticky_ttl_minutes"],
      },
      {
        key: "limits",
        label: "ops.runtime.section.limits",
        fields: [
          "relay_rate_per_minute",
          "relay_rate_burst",
          "admin_rate_per_minute",
          "admin_rate_burst",
        ],
      },
      { key: "errorRules", label: "ops.errorRules.title", fields: [] },
      { key: "promptGuard", label: "ops.guard.title", fields: [] },
    ],
  },
  {
    key: "automation",
    label: "ops.runtime.navGroup.automation",
    sections: [
      {
        key: "cooldown",
        label: "ops.runtime.section.cooldown",
        menuKey: "cooldown",
        menuLabel: "ops.runtime.menu.healthRecovery",
        fields: [
          "fault_protection_enabled",
          "cooldown_seconds",
          "channel_auto_disable_threshold",
          "recovery_probe_interval_seconds",
          "recovery_probe_enabled",
        ],
      },
      {
        key: "health",
        label: "ops.runtime.section.healthSweep",
        menuKey: "cooldown",
        fields: [
          "health_sweep_enabled",
          "health_sweep_interval_seconds",
          "health_sweep_jitter_seconds",
          "health_sweep_degraded_ms",
          "health_sweep_concurrency",
          "health_sweep_timeout_seconds",
        ],
      },
      {
        key: "sync",
        label: "ops.runtime.section.sync",
        menuKey: "sync",
        menuLabel: "ops.runtime.menu.modelOps",
        fields: ["discovery_cron", "default_model_sync_mode"],
      },
      {
        key: "probe",
        label: "ops.runtime.section.probe",
        menuKey: "sync",
        fields: [
          "probe_cron",
          "probe_prompt",
          "probe_max_tokens",
          "probe_concurrency",
          "probe_auto_disable",
          "probe_channels",
          "probe_models",
        ],
      },
      {
        key: "siteProbe",
        label: "ops.runtime.section.siteProbe",
        menuKey: "siteProbe",
        menuLabel: "ops.runtime.menu.siteMonitoring",
        fields: ["site_probe_interval_seconds", "site_probe_jitter_seconds"],
      },
      {
        key: "siteNews",
        label: "ops.runtime.section.siteNews",
        menuKey: "siteProbe",
        fields: ["site_news_interval_seconds"],
      },
      {
        key: "keepalive",
        label: "ops.runtime.section.keepalive",
        fields: [
          "keepalive_enabled",
          "keepalive_check_interval_seconds",
          "keepalive_default_idle_days",
        ],
      },
    ],
  },
  {
    key: "data",
    label: "ops.runtime.navGroup.data",
    sections: [
      {
        key: "audit",
        label: "ops.runtime.section.audit",
        menuKey: "audit",
        menuLabel: "ops.runtime.menu.auditDatabase",
        fields: ["audit_retention_days", "audit_retention_rows"],
      },
      {
        key: "alerts",
        label: "ops.runtime.section.alerts",
        menuKey: "alerts",
        menuLabel: "ops.runtime.menu.alertManagement",
        fields: [
          "webhook_url",
          "webhook_throttle_seconds",
          "alert_config_json",
          "alert_sweep_interval_seconds",
          "alert_daily_summary_interval_seconds",
        ],
      },
      {
        key: "alertRules",
        label: "ops.alertRules.title",
        fields: [],
        menuKey: "alerts",
      },
      {
        key: "maintenance",
        label: "ops.runtime.section.maintenance",
        fields: ["db_gc_cron"],
        menuKey: "audit",
      },
      {
        key: "server",
        label: "ops.runtime.section.server",
        fields: [
          "proxy_url",
          "outbound_connect_timeout_seconds",
          "outbound_header_timeout_seconds",
          "outbound_image_header_timeout_seconds",
          "outbound_tls_timeout_seconds",
          "outbound_max_idle_conns",
          "outbound_max_idle_conns_per_host",
          "relay_max_body_mb",
          "relay_max_image_mb",
          "update_check_enabled",
        ],
      },
      {
        key: "totp",
        label: "ops.runtime.section.totp",
        fields: [],
        menuKey: "users",
        menuLabel: "ops.runtime.menu.accountSecurity",
      },
      {
        key: "dbMaintenance",
        label: "ops.runtime.section.dbMaintenance",
        fields: [],
        menuKey: "audit",
      },
      {
        key: "users",
        label: "ops.runtime.section.users",
        fields: [],
        menuKey: "users",
      },
      { key: "recovery", label: "ops.runtime.menu.systemRecovery", fields: [] },
    ],
  },
];

export const ALL_RUNTIME_SECTIONS: readonly RuntimeSection[] = RUNTIME_GROUPS.flatMap(
  (group) => group.sections,
);
export const RUNTIME_SECTION_BY_KEY = new Map(
  ALL_RUNTIME_SECTIONS.map((section) => [section.key, section]),
);

export function runtimeSectionChanged(
  section: RuntimeSection,
  editable: Partial<RuntimeEditableSettings>,
  bootstrap?: Partial<RuntimeEditableSettings> | null,
) {
  return section.fields.some((key) => {
    const value = editable[key];
    if (RUNTIME_ZERO_MEANS_DEFAULT.has(key) && !value) return false;
    const baseline = bootstrap?.[key];
    if (Array.isArray(value) || Array.isArray(baseline)) {
      return JSON.stringify(value ?? []) !== JSON.stringify(baseline ?? []);
    }
    return (value ?? "") !== (baseline ?? "");
  });
}
