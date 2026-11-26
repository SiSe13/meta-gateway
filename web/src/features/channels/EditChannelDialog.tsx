import { ChevronDown, ExternalLink, FlaskConical, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Button as HeroButton } from "@heroui/react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Channel, RouteOverview, Site } from "../../api/types";
import { parseCredentialMeta } from "../credentialMeta";
import { Drawer } from "../../components/Drawer";
import { SearchableSelect } from "../../components/SearchableSelect";
import { Button, ErrorState, Field, InfoTip } from "../../components/ui";
import { useI18n } from "../../i18n";
import { formatCost, formatTokens } from "../../lib/format";
import {
  UA_PRESETS,
  isValidUserAgent,
  setUAInHeaderOverride,
  uaFromHeaderOverride,
} from "../../lib/uaPresets";
import { useSession } from "../../session";
import {
  SECRET_MASK,
  TYPE_GROUPS,
  TYPE_OPTIONS,
  isCustomChannelType,
  normalizeTypeChoice,
} from "./helpers";
import { SyncModePicker, type ModelSyncMode } from "./SyncModePicker";
import { ChannelModelTestDialog } from "./ChannelModelTestDialog";
import { EndpointMapEditor } from "./EndpointMapEditor";
import { readAdvancedOpen, writeAdvancedOpen } from "./advancedPrefs";
import { mappingRealName as mappingReal } from "../../lib/alias";

export function EditChannelDialog({
  value,
  existingGroups = [],
  routeOverviews,
  site,
  credentials,
  credential,
  userCredential,
  pending,
  error,
  onClose,
  onSave,
  onManageModels,
  onManageKeys,
  onRefreshModels,
  refreshingModels,
}: {
  value: Channel;
  existingGroups?: string[];
  routeOverviews?: RouteOverview[];
  site?: Site;
  credentials: Array<{
    id: number;
    kind: string;
    auth_mode?: string;
    has_secret: boolean;
    has_cookie?: boolean;
    status: string;
    checkin_enabled: boolean;
    meta_json?: string;
    models_csv?: string;
  }>;
  credential?: {
    id: number;
    kind: string;
    auth_mode?: string;
    has_secret: boolean;
    has_cookie?: boolean;
    checkin_enabled: boolean;
  };
  userCredential?: {
    id: number;
    kind: string;
    auth_mode?: string;
    has_secret: boolean;
    has_cookie?: boolean;
    checkin_enabled: boolean;
    meta_json?: string;
  };
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onRefreshModels?: () => void;
  refreshingModels?: boolean;
  onSave: (value: {
    channel: Channel;
    site?: Site;
    userCredential?: {
      id: number;
      kind: string;
      auth_mode?: string;
      has_secret: boolean;
      has_cookie?: boolean;
      checkin_enabled: boolean;
      meta_json?: string;
    };
    relayCredential?: {
      id: number;
      kind: string;
      has_secret: boolean;
      checkin_enabled: boolean;
    };
    name: string;
    base_url: string;
    type_hint: string;
    group_name?: string;
    max_reasoning_effort?: string;
    payload_rules?: string;
    proxy_url?: string;
    max_concurrent?: number;
    non_stream_timeout_seconds?: number;
    stream_policy?: "" | "force_stream" | "force_non_stream";
    priority: number;
    weight: number;
    header_override?: string;
    system_prompt?: string;
    retry_config?: string;
    model_sync_mode?: ModelSyncMode;
    upstream_path_override?: string;
    upstream_path_map?: string;
    upstream_request_map?: string;
    upstream_response_map?: string;
    stable_first?: boolean;
    call_policy?: "" | "allow_probe" | "real_calls_only";
    /** Cumulative spend / token ceilings (0 = none). Reaching one parks the
     *  channel: the operator's own budget came due, not an upstream failure. */
    usage_limit_cost?: number;
    usage_limit_tokens?: number;
    userToken: string;
    userCookie: string;
    apiKey: string;
  }) => void;
  onManageModels?: () => void;
  onManageKeys?: () => void;
}) {
  const { t } = useI18n();
  const inheritedBase = !value.base_url.trim();
  const initialBase = value.base_url || site?.base_url || "";
  const [name, setName] = useState(value.name);
  const [baseUrl, setBaseUrl] = useState(initialBase);
  const [typeHint, setTypeHint] = useState(
    value.type_hint || site?.platform || "openai-compatible",
  );
  const [groupName, setGroupName] = useState(value.group_name || "default");
  const [maxReasoningEffort, setMaxReasoningEffort] = useState(value.max_reasoning_effort ?? "");
  const [payloadRules, setPayloadRules] = useState(value.payload_rules ?? "");
  const [proxyUrl, setProxyUrl] = useState(value.proxy_url ?? "");
  const [maxConcurrent, setMaxConcurrent] = useState(value.max_concurrent ?? 0);
  const [nonStreamTimeout, setNonStreamTimeout] = useState(value.non_stream_timeout_seconds ?? 0);
  const [streamPolicy, setStreamPolicy] = useState(value.stream_policy ?? "");
  const [callPolicy, setCallPolicy] = useState<"" | "allow_probe" | "real_calls_only">(
    value.call_policy ?? "",
  );
  // The usage budget. The counters are the store's (it re-derives them from the
  // ledger when a limit changes), so they are only shown, never sent back.
  const [usageLimitCost, setUsageLimitCost] = useState(value.usage_limit_cost ?? 0);
  const [usageLimitTokens, setUsageLimitTokens] = useState(value.usage_limit_tokens ?? 0);
  const [priority, setPriority] = useState(value.priority);
  const [weight, setWeight] = useState(value.weight);
  const [headerOverride, setHeaderOverride] = useState(value.header_override ?? "");
  const [uaDraft, setUaDraft] = useState(uaFromHeaderOverride(value.header_override ?? ""));
  const applyUA = (ua: string) => {
    setUaDraft(ua);
    setHeaderOverride(setUAInHeaderOverride(headerOverride, ua));
  };
  const [systemPrompt, setSystemPrompt] = useState(value.system_prompt ?? "");
  const [retryConfig, setRetryConfig] = useState(value.retry_config ?? "");
  // Custom endpoint / field mapping. Kept as raw text so a half-typed JSON
  // document survives re-renders; the API validates the grammar on save.
  const [pathOverride, setPathOverride] = useState(value.upstream_path_override ?? "");
  const [pathMap, setPathMap] = useState(value.upstream_path_map ?? "");
  const [requestMap, setRequestMap] = useState(value.upstream_request_map ?? "");
  const [responseMap, setResponseMap] = useState(value.upstream_response_map ?? "");
  // The mapping is a protocol contract, not a preference: a provider that is not
  // OpenAI-shaped ships its mapping with the provider (see the backend's
  // proxy.ProviderProfile), so these four boxes are an override and an
  // inspection surface rather than the normal way in. Folded away when there is
  // nothing configured — a channel that plain passes through should not open
  // onto four JSON editors — but always shown when the row already carries a
  // mapping, because then it is information the operator owns.
  const [showEndpointMap, setShowEndpointMap] = useState(() =>
    Boolean(
      (value.upstream_path_override ?? "").trim() ||
      (value.upstream_path_map ?? "").trim() ||
      (value.upstream_request_map ?? "").trim() ||
      (value.upstream_response_map ?? "").trim(),
    ),
  );
  const [syncMode, setSyncMode] = useState<ModelSyncMode>(
    value.model_sync_mode === "auto" ? "auto" : "manual",
  );
  // What the folded panel reports, so folding it never hides which parts of the
  // mapping are in play.
  const endpointMapParts = [
    pathOverride.trim() ? t("channels.pathOverride") : "",
    pathMap.trim() ? t("channels.pathMap") : "",
    requestMap.trim() ? t("channels.requestMap") : "",
    responseMap.trim() ? t("channels.responseMap") : "",
  ].filter(Boolean);
  // The panel is the way in only for a hand-wired endpoint: a provider that is
  // not OpenAI-shaped ships its mapping with the provider, so four JSON editors
  // would be noise on every other row. It also stays visible whenever the row
  // already carries a mapping — that mapping is then information the operator
  // owns, and hiding it would leave it uninspectable and unclearable (a provider
  // profile applied at save, and an endpoint split out of a pasted URL, both
  // land here).
  const showEndpointMapSection = isCustomChannelType(typeHint) || endpointMapParts.length > 0;
  // The model-management drawer writes the sync mode directly (single-field
  // PATCH); the edit dialog only sends its own picker value when the operator
  // actually moved it here, so a stale snapshot can never stomp that choice.
  const [syncModeDirty, setSyncModeDirty] = useState(false);
  const [stableFirst, setStableFirst] = useState(value.stable_first ?? false);
  // Account credentials and scheduling are managed from the dedicated check-in
  // settings; this editor keeps only channel forwarding configuration.
  const advancedConfigured = [
    priority !== 0 || weight !== 100 ? t("channels.advRouting") : "",
    maxReasoningEffort ? t("channels.maxReasoningEffort") : "",
    maxConcurrent > 0 ? t("channels.maxConcurrent") : "",
    nonStreamTimeout > 0 ? t("channels.nonStreamTimeout") : "",
    streamPolicy ? t("channels.streamPolicy") : "",
    callPolicy ? t("channels.callPolicy") : "",
    proxyUrl.trim() ? t("channels.proxyUrl") : "",
    headerOverride.trim() ? t("channels.headerOverride") : "",
    systemPrompt.trim() ? t("channels.systemPrompt") : "",
    retryConfig.trim() && !["{}", "[]"].includes(retryConfig.trim())
      ? t("channels.retryConfig")
      : "",
    stableFirst ? t("channels.stableFirst") : "",
    payloadRules.trim() && payloadRules.trim() !== "[]" ? t("channels.payloadRules") : "",
    endpointMapParts.length > 0 ? t("channels.endpointMap") : "",
  ].filter(Boolean);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(
    () => readAdvancedOpen() ?? advancedConfigured.length > 0,
  );
  const toggleAdvanced = () =>
    setShowAdvanced((open) => {
      writeAdvancedOpen(!open);
      return !open;
    });
  const [testOpen, setTestOpen] = useState(false);
  const canSubmit = Boolean(name.trim() && baseUrl.trim());
  const apiKeys = credentials.filter((item) => item.kind === "api_key");
  const service = api(useSession().client!);
  const discovered = useQuery({
    queryKey: ["discovered-models", value.id],
    queryFn: ({ signal }) => service.discoveredModels(value.id, signal),
  });
  const editModels = discovered.data ?? [];
  const aliasOf = (realModel: string) =>
    routeOverviews?.find((overview) => {
      const onChannel = (overview.members ?? []).some(
        (member) => member.member.channel_id === value.id,
      );
      return (
        onChannel &&
        ((overview.members ?? []).some(
          (member) =>
            member.member.channel_id === value.id &&
            mappingReal(member.member.mapping_json) === realModel,
        ) ||
          mappingReal(overview.route.mapping_json) === realModel)
      );
    });

  // This channel's own model inventory, annotated with whether it is already
  // served. One source of truth for both the "N models · M adopted" readout and
  // the 试调 dialog, so the two can never disagree about what counts as adopted.
  //
  // Adoption is resolved through alias mappings ({"real": …} on the member,
  // falling back to the route) so the count stays correct for renamed models:
  // in manual sync mode M is 0 by design, and a bare zero reads as a bug unless
  // the total is shown next to it.
  const testModels = useMemo(() => {
    const bound = new Set<string>();
    for (const overview of routeOverviews ?? []) {
      const routeReal = mappingReal(overview.route.mapping_json);
      for (const wrapped of overview.members ?? []) {
        if (wrapped.member.channel_id !== value.id) continue;
        const memberReal = mappingReal(wrapped.member.mapping_json);
        if (memberReal) bound.add(memberReal);
        else if (routeReal) bound.add(routeReal);
        else bound.add(overview.route.model_pattern);
      }
    }
    return (discovered.data ?? []).map((model) => ({
      name: model.model_name,
      adopted: bound.has(model.model_name),
    }));
  }, [routeOverviews, discovered.data, value.id]);
  const adoptedCount = useMemo(
    () => testModels.filter((model) => model.adopted).length,
    [testModels],
  );

  return (
    <>
      <Drawer
        title={t("channels.edit")}
        onClose={onClose}
        busy={pending}
        width={760}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={pending || !canSubmit}
              onClick={() =>
                onSave({
                  channel: value,
                  site,
                  userCredential,
                  relayCredential: credential,
                  name,
                  base_url: baseUrl,
                  type_hint: typeHint,
                  group_name: groupName,
                  max_reasoning_effort: maxReasoningEffort,
                  payload_rules: payloadRules,
                  proxy_url: proxyUrl,
                  max_concurrent: maxConcurrent,
                  non_stream_timeout_seconds: nonStreamTimeout,
                  stream_policy: streamPolicy,
                  priority,
                  weight,
                  header_override: headerOverride,
                  system_prompt: systemPrompt,
                  retry_config: retryConfig,
                  upstream_path_override: pathOverride,
                  upstream_path_map: pathMap,
                  upstream_request_map: requestMap,
                  upstream_response_map: responseMap,
                  ...(syncModeDirty ? { model_sync_mode: syncMode } : {}),
                  stable_first: stableFirst,
                  call_policy: callPolicy,
                  usage_limit_cost: usageLimitCost,
                  usage_limit_tokens: usageLimitTokens,
                  // Account credentials are edited in the check-in settings.
                  userToken: SECRET_MASK,
                  userCookie: SECRET_MASK,
                  apiKey: "",
                })
              }
            >
              {pending ? t("common.working") : t("common.save")}
            </Button>
          </>
        }
      >
        <>
          <div className="ops-panel-context">
            <span>{t("channels.editHintDual")}</span>
          </div>
          <div className="form-grid form-grid-single">
            <Field label={t("common.name")}>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={pending} />
            </Field>
            <Field
              label={t("common.baseUrl")}
              hint={inheritedBase ? t("channels.editBaseUrlInherited") : t("channels.baseUrlHint")}
            >
              <input
                type="url"
                required
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                disabled={pending}
              />
            </Field>
            <Field label={t("common.type")}>
              <SearchableSelect
                options={TYPE_OPTIONS}
                groups={TYPE_GROUPS}
                value={typeHint}
                onChange={(next) => setTypeHint(normalizeTypeChoice(next))}
                disabled={pending}
                allowCustom
                placeholder={t("common.type")}
              />
            </Field>
            <Field label={t("channels.group")} hint={t("channels.groupHint")}>
              <SearchableSelect
                options={Array.from(new Set(["default", ...existingGroups]))
                  .sort((a, b) => a.localeCompare(b))
                  .map((group) => ({ value: group, label: group, group: "existing" }))}
                groups={["existing"]}
                value={groupName}
                onChange={(next) => setGroupName(next ?? "default")}
                disabled={pending}
                allowCustom
                placeholder={t("channels.group")}
                customLabel={t("channels.groupCustom")}
                customPlaceholder={t("channels.groupCustomPlaceholder")}
                ariaLabel={t("channels.group")}
              />
            </Field>
          </div>

          <section
            className="credential-key-panel connection-subpanel"
            aria-label={t("channels.apiKeysTitle")}
          >
            <div className="credential-key-panel-head">
              <div>
                <strong>{t("channels.apiKeysTitle")}</strong>
                <p>
                  {apiKeys.length === 0
                    ? t("channels.apiKeysEmpty")
                    : t("channels.apiKeysSummary", {
                        n: apiKeys.filter((item) => item.status === "enabled").length,
                        total: apiKeys.length,
                      })}
                </p>
              </div>
              <Button
                variant="secondary"
                className="connection-manage-button"
                disabled={pending}
                onClick={onManageKeys}
              >
                <ExternalLink size={12} />
                {t("channels.apiKeysManage")}
              </Button>
            </div>
            {apiKeys.length > 0 ? (
              <ul className="credential-key-list is-summary">
                {apiKeys.slice(0, 3).map((item) => {
                  const meta = parseCredentialMeta(item.meta_json);
                  const label = meta.name?.trim() || t("channels.apiKeyUnnamed", { id: item.id });
                  return (
                    <li
                      key={item.id}
                      className={[
                        "credential-key-row",
                        item.status !== "enabled" ? "is-disabled" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="credential-key-main">
                        <strong>{label}</strong>
                        <small>{`#${item.id}`}</small>
                      </div>
                      <span
                        className={`credential-key-summary-check${item.status === "enabled" ? " is-checked" : ""}`}
                        role="img"
                        aria-label={
                          item.status === "enabled" ? t("common.enabled") : t("common.disabled")
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {apiKeys.length > 3 ? (
              <p className="credential-key-more">
                {t("channels.apiKeysMore", { n: apiKeys.length - 3 })}
              </p>
            ) : null}
          </section>

          <section
            className="detail-section channel-model-summary-section connection-subpanel"
            aria-label={t("channels.modelsSection")}
          >
            <div className="detail-section-head">
              <h3>{t("channels.modelsSection")}</h3>
              <span className="detail-section-count">{editModels.length}</span>
              <div className="detail-section-actions">
                <HeroButton
                  type="button"
                  variant="ghost"
                  className="detail-section-expand connection-manage-button"
                  onPress={() => setTestOpen(true)}
                  isDisabled={editModels.length === 0}
                  {...{ title: t("channels.testActionHint") }}
                >
                  <FlaskConical size={12} />
                  {t("channels.testAction")}
                </HeroButton>
                {onRefreshModels ? (
                  <HeroButton
                    type="button"
                    variant="ghost"
                    className="detail-section-expand connection-manage-button"
                    onPress={onRefreshModels}
                    isDisabled={pending || refreshingModels}
                    {...{ title: t("channels.fetchModels") }}
                  >
                    <RefreshCw size={12} className={refreshingModels ? "spin" : undefined} />
                    {t("channels.fetchModels")}
                  </HeroButton>
                ) : null}
                <HeroButton
                  type="button"
                  variant="ghost"
                  className="detail-section-expand connection-manage-button connection-manage-button-models"
                  onPress={onManageModels}
                >
                  <ExternalLink size={12} />
                  {t("channels.modelsManage")}
                </HeroButton>
              </div>
            </div>
            <SyncModePicker
              value={syncMode}
              onChange={(next) => {
                setSyncMode(next);
                setSyncModeDirty(true);
              }}
              disabled={pending}
              modelCount={discovered.data ? editModels.length : null}
              adoptedCount={adoptedCount}
            />
            {discovered.isLoading ? (
              <p className="detail-section-empty is-quiet">{t("common.loading")}…</p>
            ) : editModels.length === 0 ? (
              <p className="detail-section-empty is-quiet">{t("channels.modelsEmpty")}</p>
            ) : (
              <ul className="channel-model-list is-compact">
                {editModels.map((model) => {
                  const existingAlias = aliasOf(model.model_name);
                  const alias = existingAlias?.route.model_pattern ?? "";
                  return (
                    <li key={model.id} className="channel-model-row">
                      <span className="mono truncate" title={model.model_name}>
                        {model.model_name}
                      </span>
                      {alias ? <span className="capability-chip is-key">{alias}</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="advanced-section-divider">
            <HeroButton
              type="button"
              variant="ghost"
              className={`advanced-toggle${showAdvanced ? " is-open" : ""}`}
              onPress={toggleAdvanced}
              {...{ title: advancedConfigured.join(" · ") || undefined }}
            >
              <ChevronDown size={13} />
              {showAdvanced
                ? t("channels.hideAdvanced")
                : advancedConfigured.length > 0
                  ? t("channels.showAdvancedWithCount", { n: advancedConfigured.length })
                  : t("channels.showAdvanced")}
            </HeroButton>
          </div>
          {showAdvanced ? (
            <div className="advanced-fields">
              <div className="form-grid">
                <Field label={t("common.priority")} hint={t("channels.priorityHint")}>
                  <input
                    type="number"
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value) || 0)}
                    disabled={pending}
                  />
                </Field>
                <Field label={t("common.weight")} hint={t("channels.weightHint")}>
                  <input
                    type="number"
                    value={weight}
                    onChange={(e) => setWeight(Number(e.target.value) || 0)}
                    disabled={pending}
                  />
                </Field>
                <Field
                  label={t("channels.maxReasoningEffort")}
                  hint={t("channels.maxReasoningEffortHint")}
                >
                  <select
                    value={maxReasoningEffort}
                    onChange={(e) => setMaxReasoningEffort(e.target.value)}
                    disabled={pending}
                  >
                    <option value="">{t("channels.maxReasoningEffortNone")}</option>
                    {["none", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("channels.maxConcurrent")} hint={t("channels.maxConcurrentHint")}>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={maxConcurrent}
                    onChange={(e) => setMaxConcurrent(Math.max(0, Number(e.target.value) || 0))}
                    disabled={pending}
                  />
                </Field>
                <Field
                  label={t("channels.nonStreamTimeout")}
                  hint={t("channels.nonStreamTimeoutHint")}
                >
                  <input
                    type="number"
                    min={0}
                    max={86400}
                    value={nonStreamTimeout}
                    onChange={(e) =>
                      setNonStreamTimeout(Math.max(0, Math.min(86400, Number(e.target.value) || 0)))
                    }
                    disabled={pending}
                  />
                </Field>
                <Field
                  label={t("channels.usageLimitCost")}
                  hint={
                    value.usage_limit_hit
                      ? t("channels.usageLimitHitCost", {
                          limit: formatCost(usageLimitCost),
                        })
                      : t("channels.usageLimitCostHint", {
                          used: formatCost(value.usage_used_cost ?? 0),
                        })
                  }
                >
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={usageLimitCost}
                    onChange={(e) => setUsageLimitCost(Math.max(0, Number(e.target.value) || 0))}
                    disabled={pending}
                  />
                </Field>
                <Field
                  label={t("channels.usageLimitTokens")}
                  hint={
                    value.usage_limit_hit
                      ? t("channels.usageLimitHitTokens", {
                          limit: formatTokens(usageLimitTokens),
                        })
                      : t("channels.usageLimitTokensHint", {
                          used: formatTokens(value.usage_used_tokens ?? 0),
                        })
                  }
                >
                  <input
                    type="number"
                    min={0}
                    value={usageLimitTokens}
                    onChange={(e) =>
                      setUsageLimitTokens(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                    }
                    disabled={pending}
                  />
                </Field>
                <Field label={t("channels.streamPolicy")} hint={t("channels.streamPolicyHint")}>
                  <select
                    value={streamPolicy}
                    onChange={(e) => setStreamPolicy(e.target.value as typeof streamPolicy)}
                    disabled={pending}
                  >
                    <option value="">{t("channels.streamPolicyDefault")}</option>
                    <option value="force_stream">{t("channels.streamPolicyForceStream")}</option>
                    <option value="force_non_stream">
                      {t("channels.streamPolicyForceNonStream")}
                    </option>
                  </select>
                </Field>
                {/* 此策略控制保活等自动请求的表现，与签到账号凭据分开配置。 */}
                <Field label={t("channels.callPolicy")} hint={t("channels.callPolicyHint")}>
                  <select
                    value={callPolicy}
                    onChange={(e) => setCallPolicy(e.target.value as typeof callPolicy)}
                    disabled={pending}
                  >
                    <option value="">
                      {t("channels.callPolicyInherit", {
                        policy: t(
                          site?.call_policy === "real_calls_only"
                            ? "channels.keepalive.policyRealCallsOnly"
                            : "channels.keepalive.policyAllowProbe",
                        ),
                      })}
                    </option>
                    <option value="allow_probe">{t("channels.keepalive.policyAllowProbe")}</option>
                    <option value="real_calls_only">
                      {t("channels.keepalive.policyRealCallsOnly")}
                    </option>
                  </select>
                </Field>
                <Field label={t("channels.proxyUrl")} hint={t("channels.proxyUrlHint")}>
                  <input
                    type="url"
                    value={proxyUrl}
                    placeholder="http://127.0.0.1:7897"
                    onChange={(e) => setProxyUrl(e.target.value)}
                    disabled={pending}
                  />
                </Field>
              </div>

              <section className="detail-section">
                <div className="detail-section-head">
                  <h3>{t("channels.overrides")}</h3>
                </div>
                <Field label={t("channels.uaPreset")} hint={t("channels.uaPresetHint")}>
                  <div className="ua-preset-row">
                    <select
                      aria-label={t("channels.uaPreset")}
                      value={uaDraft && UA_PRESETS.includes(uaDraft) ? uaDraft : "custom"}
                      onChange={(e) => {
                        const preset = e.target.value;
                        if (preset !== "custom") applyUA(preset);
                      }}
                      disabled={pending}
                    >
                      <option value="custom">{t("channels.uaCustom")}</option>
                      {UA_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {preset}
                        </option>
                      ))}
                    </select>
                    <input
                      value={uaDraft}
                      onChange={(e) => applyUA(e.target.value)}
                      placeholder={t("channels.uaPlaceholder")}
                      disabled={pending}
                    />
                  </div>
                  {uaDraft && !isValidUserAgent(uaDraft) ? (
                    <p className="ua-preset-error">{t("channels.uaInvalid")}</p>
                  ) : null}
                </Field>
                <Field label={t("channels.headerOverride")} hint={t("channels.headerOverrideHint")}>
                  <textarea
                    className="mono textarea-sm"
                    value={headerOverride}
                    onChange={(e) => {
                      const next = e.target.value;
                      setHeaderOverride(next);
                      setUaDraft(uaFromHeaderOverride(next));
                    }}
                    disabled={pending}
                    placeholder='{"User-Agent": "…", "X-Custom": "value"}'
                  />
                </Field>
                <Field label={t("channels.systemPrompt")} hint={t("channels.systemPromptHint")}>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    disabled={pending}
                    placeholder={t("channels.systemPromptPlaceholder")}
                    className="textarea-md"
                  />
                </Field>
                <Field label={t("channels.retryConfig")} hint={t("channels.retryConfigHint")}>
                  <textarea
                    value={retryConfig}
                    onChange={(e) => setRetryConfig(e.target.value)}
                    disabled={pending}
                    placeholder={t("channels.retryConfigPlaceholder")}
                    className="textarea-code"
                  />
                </Field>
                <label className="check is-spaced">
                  <input
                    type="checkbox"
                    checked={stableFirst}
                    onChange={(e) => setStableFirst(e.target.checked)}
                    disabled={pending}
                  />
                  <span>{t("channels.stableFirst")}</span>
                </label>
                <Field label={t("channels.payloadRules")} hint={t("channels.payloadRulesHint")}>
                  <textarea
                    className="mono textarea-lg"
                    value={payloadRules}
                    onChange={(e) => setPayloadRules(e.target.value)}
                    disabled={pending}
                    placeholder={JSON.stringify(
                      [
                        {
                          name: "cap max tokens",
                          match: {
                            model: "gpt-*",
                            payload: { max_tokens: { exists: true } },
                          },
                          actions: [
                            {
                              op: "set",
                              path: "max_tokens",
                              value: { num: 8000 },
                            },
                          ],
                        },
                      ],
                      null,
                      2,
                    )}
                  />
                </Field>
                {showEndpointMapSection ? (
                  <div className="detail-section">
                    <div className="detail-section-head">
                      <h3>{t("channels.endpointMap")}</h3>
                      {/* The "what is this section for" paragraph lives behind the
                      title's (i) now: it used to sit here as a multi-line
                      block, which pushed the fold-away toggle below the fold.
                      Same affordance the field hints below already use. */}
                      <InfoTip label={t("channels.endpointMapHint")} />
                      <span className="panel-summary">
                        {endpointMapParts.length === 0
                          ? t("channels.endpointMapSummaryNone")
                          : t("channels.endpointMapSummaryActive", {
                              parts: endpointMapParts.join(" / "),
                            })}
                      </span>
                    </div>
                    <HeroButton
                      type="button"
                      variant="ghost"
                      className={`advanced-toggle${showEndpointMap ? " is-open" : ""}`}
                      aria-expanded={showEndpointMap}
                      isDisabled={pending}
                      onPress={() => setShowEndpointMap((open) => !open)}
                    >
                      <ChevronDown size={13} />
                      {showEndpointMap
                        ? t("channels.endpointMapCollapse")
                        : t("channels.endpointMapConfigure")}
                    </HeroButton>
                    {showEndpointMap ? (
                      <EndpointMapEditor
                        value={{ pathOverride, pathMap, requestMap, responseMap }}
                        onChange={(next) => {
                          setPathOverride(next.pathOverride);
                          setPathMap(next.pathMap);
                          setRequestMap(next.requestMap);
                          setResponseMap(next.responseMap);
                        }}
                        disabled={pending}
                      />
                    ) : null}
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {error ? <ErrorState error={error} /> : null}
        </>
      </Drawer>
      {/* Outside the drawer's body on purpose: that body is a <fieldset> the
          drawer disables while saving, and a nested fieldset cannot re-enable
          itself — the smoke test must stay usable while a save is pending. */}
      {testOpen ? (
        <ChannelModelTestDialog
          channelId={value.id}
          channelName={value.name}
          models={testModels}
          onClose={() => setTestOpen(false)}
        />
      ) : null}
    </>
  );
}
