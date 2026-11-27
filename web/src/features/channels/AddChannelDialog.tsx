import { Cable, ChevronDown, ListPlus } from "lucide-react";
import { Button as HeroButton } from "@heroui/react";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ModelPicker } from "../../components/ModelPicker";
import { SearchableSelect, type SelectOption } from "../../components/SearchableSelect";
import {
  Button,
  Dialog,
  ErrorState,
  Field,
  InfoTip,
  TextInput,
  SelectControl,
} from "../../components/ui";
import { useI18n } from "../../i18n";
import { formatGroupName } from "../../lib/format";
import { PROVIDER_BASE_URLS } from "../../connectionTypes";
import { apiKeyLooksWrong, keyHintFor } from "../../lib/apiKeyPaste";
import { useSession } from "../../session";
import { TYPE_OPTIONS } from "./helpers";
import {
  TYPE_GROUPS,
  normalizeBase,
  normalizeTypeChoice,
  type ConnectionAdvancedPatch,
  type CreateConnectionInput,
} from "./helpers";
import { SyncModePicker, type ModelSyncMode } from "./SyncModePicker";

/** What the gateway will really call for a base URL + channel type. */
type EndpointPreview = {
  protocol?: string;
  chat_url?: string;
  models_url?: string;
  /** Downstream protocols served through another shape, and how. */
  surfaces?: Array<{ downstream?: string[]; mode?: string }>;
};

/**
 * Protocol ids come from the backend's protocol families. An id the picker does
 * not know falls back to the raw value rather than showing an empty label.
 */
const PROTOCOL_LABELS: Record<string, string> = {
  openai: "channels.upstreamProtocol.openai",
  anthropic: "channels.upstreamProtocol.anthropic",
  gemini: "channels.upstreamProtocol.gemini",
};

/** The same families named the way a user of them would say it. */
const PROTOCOL_TARGETS: Record<string, string> = {
  openai: "channels.protocolTarget.openai",
  anthropic: "channels.protocolTarget.anthropic",
  gemini: "channels.protocolTarget.gemini",
};

export function AddChannelDialog({
  existingGroups = [],
  pending,
  error,
  onClose,
  onSave,
}: {
  existingGroups?: string[];
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (value: CreateConnectionInput, options: { verify: boolean }) => void;
}) {
  const { t } = useI18n();
  const { client } = useSession();
  const service = api(client!);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [typeHint, setTypeHint] = useState("openai-compatible");
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  // Whether the operator has stated the type themselves. Auto-detection only
  // fills the field while it is still untouched: the detector is a heuristic
  // (it reported `new-api` for Zhipu's URL on a bare `user-self-401` response),
  // so letting it overwrite an explicit pick silently reverted "智谱 GLM" back to
  // "New API" on blur — taking the correct preset base URL with it.
  // Use a ref so an in-flight URL detection sees a manual selection made after
  // blur. A state value captured by the promise callback can be stale and let
  // the heuristic overwrite the operator's choice.
  const typeTouched = useRef(false);
  const [groupName, setGroupName] = useState("default");
  const [showAdvanced, setShowAdvanced] = useState(false);
  // The endpoint the gateway would actually call for this base URL AND type.
  // The provider presets are only as good as the URL builder, and a preset whose
  // base lands on the wrong path is invisible until the first request 404s —
  // which is what used to push operators into hand-written endpoint overrides.
  // The type belongs to the question: the same host serves OpenAI chat, OpenAI
  // Responses or Anthropic Messages, and each joins the base differently.
  const [endpointPreview, setEndpointPreview] = useState<EndpointPreview | null>(null);
  // Model list pulled from the upstream before anything is saved. Holding it
  // here (rather than creating the channel first and discovering after) is the
  // point: a wrong URL or key costs a retry, not a half-configured channel.
  const [upstreamModels, setUpstreamModels] = useState<string[] | null>(null);
  // A fresh list starts fully selected under manual sync: the operator asked for
  // this upstream's models, and unticking a few is cheaper than ticking eighty.
  const [picked, setPicked] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<unknown>(null);
  // Only fields the operator touched. An empty patch means "whatever the
  // backend defaults to", which is why the values start undefined instead of
  // being pre-filled with what the form happens to render.
  const [advanced, setAdvanced] = useState<ConnectionAdvancedPatch>({});
  const setAdvancedField = <K extends keyof ConnectionAdvancedPatch>(
    key: K,
    value: ConnectionAdvancedPatch[K],
  ) => setAdvanced((current) => ({ ...current, [key]: value }));

  const canSubmit = Boolean(baseUrl.trim() && secret.trim());
  const canFetchModels = canSubmit && !pending && !fetchingModels;
  const groupOptions: SelectOption[] = Array.from(
    new Set(["default", ...existingGroups.map((group) => group.trim()).filter(Boolean)]),
  ).map((group) => ({ value: group, label: formatGroupName(group, t), group: "existing" }));

  // Re-resolved whenever either half of the answer changes: the base URL and
  // the type are separate questions, and the preview is the join of the two.
  // The sequence keeps a slow earlier answer from overwriting a newer one — a
  // stale preview is the same lie this panel exists to prevent.
  const previewSeq = useRef(0);
  const refreshEndpointPreview = (url: string, type: string) => {
    const trimmed = url.trim();
    const seq = ++previewSeq.current;
    if (!trimmed) {
      setEndpointPreview(null);
      return;
    }
    service
      .endpointPreview(trimmed, type)
      .then((next) => {
        if (seq === previewSeq.current) setEndpointPreview(next);
      })
      .catch(() => {
        if (seq === previewSeq.current) setEndpointPreview(null);
      });
  };
  // A hint, not a rule: relay sites issue whatever token they like, so a
  // mismatch only ever earns a note next to the field.
  const secretHint = keyHintFor(typeHint);
  const secretLooksWrong = apiKeyLooksWrong(typeHint, secret);

  // The sync mode is a per-channel decision with a real operational cost, so
  // it is asked up front instead of being silently inherited. The system
  // default only seeds the pre-selection and is labelled as such.
  const runtimeSettings = useQuery({
    queryKey: ["runtime-settings"],
    queryFn: ({ signal }) => service.runtimeSettings(signal),
    retry: false,
  });
  // Sites are looked up only to answer one question in the interface: when this
  // base URL already exists as a site, "follow the site" can name the policy it
  // would actually follow instead of showing a blank inheritance.
  const sites = useQuery({
    queryKey: ["sites"],
    queryFn: ({ signal }) => service.sites(signal),
    retry: false,
  });
  const matchedSite = (sites.data ?? []).find(
    (site) => normalizeBase(site.base_url) === normalizeBase(baseUrl),
  );
  const inheritedPolicyLabel = matchedSite
    ? t("channels.callPolicyInherit", {
        policy: t(
          matchedSite.call_policy === "real_calls_only"
            ? "channels.keepalive.policyRealCallsOnly"
            : "channels.keepalive.policyAllowProbe",
        ),
      })
    : t("channels.callPolicyInheritUnknown");
  const defaultSyncMode: ModelSyncMode =
    runtimeSettings.data?.editable.default_model_sync_mode === "auto" ? "auto" : "manual";
  const [syncMode, setSyncMode] = useState<ModelSyncMode | null>(null);
  const effectiveSyncMode = syncMode ?? defaultSyncMode;

  const fetchModels = async () => {
    setFetchingModels(true);
    setModelsError(null);
    try {
      const result = await service.previewChannelModels({
        base_url: baseUrl.trim(),
        secret: secret.trim(),
        type_hint: typeHint,
      });
      setUpstreamModels(result.models);
      // Fetching lists what the upstream serves; it is not a decision to serve
      // all of it. Nothing is ticked until the operator ticks it.
      setPicked([]);
    } catch (err) {
      setModelsError(err);
      setUpstreamModels(null);
      setPicked([]);
    } finally {
      setFetchingModels(false);
    }
  };

  const submit = (options: { verify: boolean }) =>
    onSave(
      {
        name,
        base_url: baseUrl,
        secret,
        type_hint: typeHint,
        group_name: groupName,
        model_sync_mode: effectiveSyncMode,
        // Omitted when nothing was fetched: "never fetched" is not the same
        // statement as "fetched and picked none".
        ...(upstreamModels ? { models_csv: picked.join(",") } : {}),
        ...(Object.keys(advanced).length > 0 ? { advanced } : {}),
      },
      options,
    );

  return (
    <Dialog
      className="channels-add-dialog"
      title={t("channels.add")}
      onClose={onClose}
      busy={pending}
      preventBackdropDismiss={typePickerOpen}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button
            icon={<Cable size={16} />}
            disabled={pending || !canSubmit}
            onClick={() => submit({ verify: true })}
          >
            {pending ? t("common.working") : t("channels.saveAndVerify")}
          </Button>
        </>
      }
    >
      <div className="ops-panel-context">
        <span>{t("channels.addHint")}</span>
      </div>
      <div className="form-grid form-grid-single">
        <Field label={t("common.name")}>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("channels.namePlaceholder")}
            disabled={pending}
          />
        </Field>
        <Field label={t("common.baseUrl")} hint={t("channels.baseUrlHint")}>
          <TextInput
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => {
              // AAH-style auto-detection: sniff the platform from the URL so
              // the operator does not have to pick the type manually.
              const url = baseUrl.trim();
              if (!url) return;
              refreshEndpointPreview(url, typeHint);
              service
                .detectSiteType(url)
                .then((detected) => {
                  // Never clobber an explicit choice: the operator picked a
                  // provider, and this heuristic has no authority over that.
                  if (typeTouched.current) return;
                  if (detected.family && TYPE_OPTIONS.some((o) => o.value === detected.family)) {
                    setTypeHint(detected.family);
                    // Detection just changed which protocol the channel speaks.
                    refreshEndpointPreview(url, detected.family);
                  }
                })
                .catch(() => undefined);
            }}
            placeholder="https://api.example.com"
            disabled={pending}
          />
          {endpointPreview?.chat_url ? (
            <>
              <small className="field-preview">
                {t("channels.upstreamProtocol", {
                  protocol: t(
                    PROTOCOL_LABELS[endpointPreview.protocol ?? ""] ??
                      endpointPreview.protocol ??
                      "",
                  ),
                })}
              </small>
              <small className="field-preview mono" title={endpointPreview.chat_url}>
                {t("channels.endpointPreview", { url: endpointPreview.chat_url })}
              </small>
              {/* What a client speaking a DIFFERENT protocol gets. "This upstream
                  is OpenAI-shaped" does not answer for a Codex or Claude client,
                  and the answer differs per type. */}
              {endpointPreview.surfaces?.map((surface) => {
                const targetLabel = PROTOCOL_TARGETS[endpointPreview.protocol ?? ""];
                const target = targetLabel ? t(targetLabel) : (endpointPreview.protocol ?? "");
                return (
                  <small
                    className="field-preview"
                    key={`${surface.mode}:${surface.downstream?.join("+")}`}
                  >
                    {t(
                      surface.mode === "native_fallback"
                        ? "channels.surface.nativeFallback"
                        : "channels.surface.translated",
                      {
                        clients: (surface.downstream ?? [])
                          .map((id) => t(`channels.surface.client.${id}`))
                          .join(" / "),
                        target: target,
                      },
                    )}
                  </small>
                );
              })}
              {endpointPreview.models_url ? (
                <small className="field-preview mono" title={endpointPreview.models_url}>
                  {t("channels.endpointPreviewModels", { url: endpointPreview.models_url })}
                </small>
              ) : null}
            </>
          ) : null}
        </Field>
        <Field label={t("common.type")}>
          <SearchableSelect
            options={TYPE_OPTIONS}
            groups={TYPE_GROUPS}
            value={typeHint}
            onChange={(next) => {
              const provider = normalizeTypeChoice(next ?? "") || "openai-compatible";
              // 空值或仍是旧类型预设地址时，切换类型后同步切换默认地址。
              setBaseUrl((current) => {
                const currentTrimmed = current.trim().replace(/\/+$/, "");
                const previousDefault = PROVIDER_BASE_URLS[typeHint] ?? "";
                if (
                  currentTrimmed === "" ||
                  (previousDefault && currentTrimmed === previousDefault.replace(/\/+$/, ""))
                ) {
                  return PROVIDER_BASE_URLS[provider] ?? "";
                }
                return current;
              });
              setTypeHint(provider);
              typeTouched.current = true;
              refreshEndpointPreview(baseUrl, provider);
            }}
            disabled={pending}
            allowCustom
            placeholder={t("common.type")}
            onOpenChange={setTypePickerOpen}
          />
        </Field>
        <Field label={t("channels.group")} hint={t("channels.groupHint")}>
          <SearchableSelect
            options={groupOptions}
            groups={["existing"]}
            value={groupName}
            onChange={setGroupName}
            disabled={pending}
            allowCustom
            placeholder={t("channels.group")}
            customLabel={t("channels.groupCustom")}
            customPlaceholder={t("channels.groupCustomPlaceholder")}
            ariaLabel={t("channels.group")}
          />
        </Field>
        <Field label={t("common.secret")} hint={secretHint || undefined}>
          <TextInput
            type="password"
            autoComplete="new-password"
            required
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            disabled={pending}
          />
          {secretLooksWrong ? (
            <p className="map-row-error">
              {t("channels.keyFormatMismatch", {
                type: typeHint,
                hint: secretHint,
              })}
            </p>
          ) : null}
        </Field>
      </div>

      <section
        className="detail-section connection-subpanel"
        aria-label={t("channels.modelsSection")}
      >
        <div className="detail-section-head">
          <h3>{t("channels.modelsSection")}</h3>
          {upstreamModels ? (
            <span className="detail-section-count">{upstreamModels.length}</span>
          ) : null}
          {/* Same header shape as the channel detail's model block: the title on
              the left, the thing you can do about it on the right. */}
          <div className="detail-section-actions">
            <HeroButton
              type="button"
              variant="ghost"
              className="detail-section-expand connection-manage-button"
              onPress={fetchModels}
              isDisabled={!canFetchModels}
              {...{
                title: canFetchModels
                  ? t("channels.modelsFetchHint")
                  : t("channels.modelsFetchNeedsInput"),
              }}
            >
              <ListPlus size={12} className={fetchingModels ? "spin" : undefined} />
              {fetchingModels ? t("common.working") : t("channels.modelsFetch")}
            </HeroButton>
          </div>
        </div>
        <SyncModePicker
          value={effectiveSyncMode}
          onChange={setSyncMode}
          disabled={pending}
          defaultMode={defaultSyncMode}
        />
        {upstreamModels === null ? (
          <p className="detail-section-empty is-quiet">{t("channels.modelsFetchHint")}</p>
        ) : null}
        {modelsError ? <ErrorState error={modelsError} /> : null}
        {upstreamModels !== null ? (
          <>
            <p className="muted">
              {upstreamModels.length === 0
                ? t("channels.modelsFetchedEmpty")
                : t("channels.modelsFetchedCount", { n: upstreamModels.length })}
              {effectiveSyncMode === "auto" ? ` · ${t("channels.modelsAutoNote")}` : ""}
            </p>
            {/* Under auto sync the picker would be a lie: discovery adopts every
                model the upstream serves, so there is nothing to tick. */}
            {effectiveSyncMode === "manual" && upstreamModels.length > 0 ? (
              <ModelPicker
                options={upstreamModels.map((name) => ({ name }))}
                selected={picked}
                onChange={setPicked}
                emptyLabel={t("channels.modelsFetchedEmpty")}
              />
            ) : null}
          </>
        ) : null}
      </section>

      <HeroButton
        type="button"
        variant="ghost"
        className={`advanced-toggle${showAdvanced ? " is-open" : ""}`}
        onPress={() => setShowAdvanced((value) => !value)}
      >
        <ChevronDown size={13} />
        {showAdvanced
          ? t("channels.hideAdvanced")
          : Object.keys(advanced).length > 0
            ? t("channels.showAdvancedWithCount", { n: Object.keys(advanced).length })
            : t("channels.showAdvanced")}
      </HeroButton>
      {showAdvanced ? (
        <div className="advanced-fields">
          <div className="form-grid">
            {/* Only touched fields are sent (see ConnectionAdvancedPatch): the
                empty box means "backend default", not "zero". */}
            <Field label={t("common.priority")} hint={t("channels.priorityHint")}>
              <TextInput
                type="number"
                value={advanced.priority ?? ""}
                placeholder="0"
                onChange={(event) =>
                  setAdvancedField(
                    "priority",
                    event.target.value === "" ? undefined : Number(event.target.value) || 0,
                  )
                }
                disabled={pending}
              />
            </Field>
            <Field label={t("common.weight")} hint={t("channels.weightHint")}>
              <TextInput
                type="number"
                value={advanced.weight ?? ""}
                placeholder="100"
                onChange={(event) =>
                  setAdvancedField(
                    "weight",
                    event.target.value === "" ? undefined : Number(event.target.value) || 0,
                  )
                }
                disabled={pending}
              />
            </Field>
            <Field
              label={t("channels.maxReasoningEffort")}
              hint={t("channels.maxReasoningEffortHint")}
            >
              <SelectControl
                value={advanced.max_reasoning_effort ?? ""}
                onChange={(event) =>
                  setAdvancedField(
                    "max_reasoning_effort",
                    event.target.value === "" ? undefined : event.target.value,
                  )
                }
                disabled={pending}
              >
                <option value="">{t("channels.maxReasoningEffortNone")}</option>
                {["none", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </SelectControl>
            </Field>
            <Field label={t("channels.maxConcurrent")} hint={t("channels.maxConcurrentHint")}>
              <TextInput
                type="number"
                min={0}
                max={10000}
                value={advanced.max_concurrent ?? ""}
                placeholder="0"
                onChange={(event) =>
                  setAdvancedField(
                    "max_concurrent",
                    event.target.value === ""
                      ? undefined
                      : Math.max(0, Number(event.target.value) || 0),
                  )
                }
                disabled={pending}
              />
            </Field>
            <Field label={t("channels.nonStreamTimeout")} hint={t("channels.nonStreamTimeoutHint")}>
              <TextInput
                type="number"
                min={0}
                max={86400}
                value={advanced.non_stream_timeout_seconds ?? ""}
                placeholder="0"
                onChange={(event) =>
                  setAdvancedField(
                    "non_stream_timeout_seconds",
                    event.target.value === ""
                      ? undefined
                      : Math.max(0, Math.min(86400, Number(event.target.value) || 0)),
                  )
                }
                disabled={pending}
              />
            </Field>
            <Field label={t("channels.streamPolicy")} hint={t("channels.streamPolicyHint")}>
              <SelectControl
                value={advanced.stream_policy ?? ""}
                onChange={(event) =>
                  setAdvancedField(
                    "stream_policy",
                    event.target.value === ""
                      ? undefined
                      : (event.target.value as ConnectionAdvancedPatch["stream_policy"]),
                  )
                }
                disabled={pending}
              >
                <option value="">{t("channels.streamPolicyDefault")}</option>
                <option value="force_stream">{t("channels.streamPolicyForceStream")}</option>
                <option value="force_non_stream">{t("channels.streamPolicyForceNonStream")}</option>
              </SelectControl>
            </Field>
            <Field label={t("channels.proxyUrl")} hint={t("channels.proxyUrlHint")}>
              <TextInput
                type="url"
                value={advanced.proxy_url ?? ""}
                placeholder="http://127.0.0.1:7897"
                onChange={(event) =>
                  setAdvancedField(
                    "proxy_url",
                    event.target.value === "" ? undefined : event.target.value,
                  )
                }
                disabled={pending}
              />
            </Field>
            <Field label={t("channels.callPolicy")} hint={t("channels.callPolicyHint")}>
              <SelectControl
                value={advanced.call_policy ?? ""}
                onChange={(event) =>
                  setAdvancedField(
                    "call_policy",
                    event.target.value === ""
                      ? undefined
                      : (event.target.value as ConnectionAdvancedPatch["call_policy"]),
                  )
                }
                disabled={pending}
              >
                <option value="">{inheritedPolicyLabel}</option>
                <option value="allow_probe">{t("channels.keepalive.policyAllowProbe")}</option>
                <option value="real_calls_only">
                  {t("channels.keepalive.policyRealCallsOnly")}
                </option>
              </SelectControl>
            </Field>
          </div>
          <div className="stack-tight">
            <Button
              variant="secondary"
              disabled={pending || !canSubmit}
              onClick={() => submit({ verify: false })}
            >
              {t("channels.saveOnly")}
            </Button>
            <InfoTip label={t("channels.saveOnlyHint")} />
          </div>
        </div>
      ) : null}

      {error ? <ErrorState error={error} /> : null}
    </Dialog>
  );
}
