import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  Globe2,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Ticket,
  Trash2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button as HeroButton,
  Calendar as HeroCalendar,
  DateField as HeroDateField,
  DatePicker as HeroDatePicker,
  Dropdown,
  Input as HeroInput,
  Switch as HeroSwitch,
  TextArea as HeroTextArea,
} from "@heroui/react";
import { parseDateTime } from "@internationalized/date";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type {
  CreatedDownstreamKey,
  KeyCreateInput,
  KeyUpdateInput,
  DownstreamKey,
  RouteOverview,
} from "../api/types";
import type { ActionMenuItem } from "../components/ActionMenu";
import { EmptyHero } from "../components/EmptyHero";
import { ListShell } from "../components/ListShell";
import { ModelPicker, type ModelOption } from "../components/ModelPicker";
import { SearchableSelect } from "../components/SearchableSelect";
import { registerOverlay } from "../components/overlayStack";
import { ScopePicker } from "../components/ScopePicker";
import { autoModelGroup, modelGroup, modelPatternMatches } from "./models/modelGroups";
import { PaginationBar } from "../components/PaginationBar";
import { SecretRevealDialog } from "../components/SecretRevealDialog";
import { EntityState } from "../components/EntityState";
import { TelemetryStrip } from "../components/TelemetryStrip";
import { useAdminMutation } from "../hooks/useAdminMutation";
import { useClientPagination } from "../hooks/useClientPagination";
import { useI18n } from "../i18n";
import { useSession } from "../session";
import { useOperatingMode } from "../hooks/useOperatingMode";
import { memberKeysSource } from "../member/MemberKeysSource";
import { parseQuotaInput } from "./keys/quotaInput";
import { mappingRealName } from "../lib/alias";
import { formatCost as formatLedgerCost, formatGroupName, useCurrency } from "../lib/format";
import {
  ADMIN_KEY_CAPS,
  MEMBER_KEY_CAPS,
  type KeysCapabilities,
  type KeysSource,
} from "./keys/KeysSource";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  IconButton,
  Panel,
  StatusBadge,
  formatDate,
  TextInput,
  CheckboxControl,
} from "../components/ui";

/**
 * The token's on/off switch, sitting where its state is read.
 *
 * Enablement is not the same as a quota: an operator pauses a token whose
 * client is misbehaving and turns it back on later, without rotating or
 * deleting anything. The status badge this replaces could only report the
 * state, so pausing a token meant editing the record outside the console.
 */
function EnabledSwitch({
  on,
  name,
  pending,
  onToggle,
}: {
  on: boolean;
  name: string;
  pending: boolean;
  onToggle: () => void;
}) {
  const { t, status } = useI18n();
  const action = t(on ? "common.disableAction" : "common.enableAction");
  return (
    <HeroSwitch
      className="key-toggle-switch"
      isSelected={on}
      isDisabled={pending}
      aria-label={`${name} · ${action}`}
      {...{ title: action }}
      onChange={onToggle}
    >
      <HeroSwitch.Content className={`badge badge-${on ? "enabled" : "disabled"} key-toggle`}>
        {status(on)}
      </HeroSwitch.Content>
    </HeroSwitch>
  );
}

/** 在同一弹窗中查看或编辑单个令牌的模型白名单。 */
function KeyModelRangeDialog({
  models,
  modelOptions,
  canEdit,
  pending,
  error,
  onClose,
  onSave,
}: {
  models: string[];
  modelOptions: ModelOption[];
  canEdit: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (models: string[]) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [selectedModels, setSelectedModels] = useState(models);

  return (
    <Dialog
      title={t("keys.modelRangeDialogTitle")}
      className="key-model-range-dialog"
      onClose={onClose}
      busy={pending}
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              if (editing) {
                setSelectedModels(models);
                setEditing(false);
              } else {
                onClose();
              }
            }}
          >
            {editing ? t("common.cancel") : t("common.close")}
          </Button>
          {editing ? (
            <Button disabled={pending} onClick={() => onSave(selectedModels)}>
              {t("common.save")}
            </Button>
          ) : canEdit ? (
            <Button onClick={() => setEditing(true)}>{t("keys.modelRangeEdit")}</Button>
          ) : null}
        </>
      }
    >
      {editing ? (
        <div className="key-model-range-editor">
          <Field label={t("keys.modelAllowlist")} hint={t("keys.modelAllowlistHint")}>
            <ModelPicker
              options={modelOptions}
              selected={selectedModels}
              onChange={setSelectedModels}
              placeholder={t("modelPicker.search")}
              emptyLabel={t("keys.modelPickerEmpty")}
              flagMissing
            />
          </Field>
          {error ? <ErrorState error={error} /> : null}
        </div>
      ) : (
        <ul className="key-model-range-list">
          {models.map((model) => (
            <li key={model}>
              <code>{model}</code>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

// Redemption code manager: mint quota vouchers, copy them, void unused ones.
function RedemptionDialog({ onClose }: { onClose: () => void }) {
  const { client } = useSession();
  const service = api(client!);
  const { t } = useI18n();
  const [count, setCount] = useState(1);
  const [quota, setQuota] = useState(1000000);
  const [minted, setMinted] = useState<Array<{ id: number; code: string }>>([]);
  const query = useQuery({
    queryKey: ["redemption-codes"],
    queryFn: ({ signal }) => service.listRedemptionCodes(signal),
  });
  const mint = useAdminMutation({
    mutationFn: () => service.createRedemptionCodes({ count, quota_tokens: quota }),
    invalidateKeys: [["redemption-codes"]],
    toastOnError: false,
    onSuccess: (result) => setMinted(result.items),
  });
  const voidCode = useAdminMutation({
    mutationFn: (id: number) => service.deleteRedemptionCode(id),
    pendingIdOf: (id) => id,
    invalidateKeys: [["redemption-codes"]],
    toastOnError: false,
  });
  const items = query.data?.items ?? [];
  return (
    <Dialog
      title={t("keys.redemptionTitle")}
      onClose={onClose}
      busy={mint.isPending || voidCode.isPending}
    >
      <div className="redemption-mint">
        <Field label={t("keys.redemptionCount")}>
          <TextInput
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
          />
        </Field>
        <Field label={t("keys.redemptionQuota")}>
          <TextInput
            type="number"
            min={1}
            value={quota}
            onChange={(e) => setQuota(Number(e.target.value) || 0)}
          />
        </Field>
        <Button
          variant="primary"
          disabled={mint.isPending || count < 1 || quota < 1}
          onClick={() => mint.mutate(undefined)}
        >
          {mint.isPending ? t("common.working") : t("keys.redemptionMint")}
        </Button>
      </div>
      {minted.length ? (
        <div className="redemption-minted">
          {minted.map((m) => (
            <div key={m.id} className="redemption-code-row">
              <code>{m.code}</code>
              <HeroButton
                type="button"
                variant="ghost"
                className="redemption-copy"
                onPress={() => {
                  void navigator.clipboard.writeText(m.code);
                }}
              >
                {t("keys.redemptionCopy")}
              </HeroButton>
            </div>
          ))}
        </div>
      ) : null}
      <div className="redemption-list">
        <strong>{t("keys.redemptionList")}</strong>
        {items.length === 0 ? (
          <p className="is-quiet">{t("keys.redemptionEmpty")}</p>
        ) : (
          items.slice(0, 50).map((c) => (
            <div key={c.id} className="redemption-list-row">
              <code className={c.redeemed_by_key_id ? "is-used" : ""}>{c.code}</code>
              <span>{formatNumber(c.quota_tokens)}</span>
              {c.redeemed_by_key_id ? (
                <span className="is-quiet">
                  {t("keys.redemptionUsed")} · #{c.redeemed_by_key_id}
                </span>
              ) : (
                <HeroButton
                  type="button"
                  variant="ghost"
                  className="redemption-void"
                  isDisabled={voidCode.pendingId === c.id}
                  onPress={() => voidCode.mutate(c.id)}
                >
                  {voidCode.pendingId === c.id ? t("common.working") : t("keys.redemptionVoid")}
                </HeroButton>
              )}
            </div>
          ))
        )}
      </div>
      {mint.error ? <ErrorState error={mint.error} /> : null}
      {voidCode.error ? <ErrorState error={voidCode.error} /> : null}
    </Dialog>
  );
}

function formatNumber(value?: number) {
  if (value == null || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat().format(value);
}

function formatCost(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatLedgerCost(value);
}

/**
 * Upstream model names behind a route's {"real": …} alias mapping.
 *
 * Aliases are written on the member (one per channel) with a legacy
 * route-level form for older rows; to the picker both mean the same thing:
 * this route name is the name a client sends for that upstream model.
 */
function aliasReals(overview: RouteOverview): string[] {
  const out = new Set<string>();
  const collect = (raw?: string) => {
    const real = mappingRealName(raw);
    if (real) out.add(real);
  };
  collect(overview.route.mapping_json);
  for (const candidate of overview.members ?? []) {
    collect(candidate.member.mapping_json);
  }
  return [...out];
}

/**
 * The console's keys page: the shared renderer bound to the admin client, with
 * every capability on. The member app mounts `KeysView` directly with its own
 * source — this wrapper exists so the console's route table stays unchanged.
 */
/**
 * The token page, for whoever is signed in.
 *
 * Staff manage every token in the gateway; a member manages their own, through
 * the member source (/me/keys). Both mount the same renderer — the capability
 * flags are what differ, and they come from the role rather than from which app
 * this is, because there is now only one app.
 */
export function Keys() {
  const { client, role } = useSession();
  const member = role === "member";
  const service = useMemo(() => api(client!), [client]);
  // The tenant-group vocabulary belongs to the multi-user area, so it is shown
  // only while that area is on. Resolved here, in the console's own wrapper:
  // the shared renderer below must not reach for a session, because the member
  // app mounts it without one.
  const operatingMode = useOperatingMode();
  const team = operatingMode.data?.mode === "team";
  const source = useMemo<KeysSource>(
    () =>
      member
        ? memberKeysSource
        : {
            keys: (signal) => service.keys(signal),
            ownerUsers: (signal) =>
              client!.request<Array<{ id: number; name: string; username: string }>>(
                "/admin/team/users",
                { signal },
              ),
            keyActivity: (signal) => service.keyActivity(signal),
            discoveredModels: (signal) => service.discoveredModels(undefined, signal),
            usageSummary: (signal) => service.usageSummary(undefined, signal),
            routeOverviews: (signal) => service.routeOverviews(signal),
            routeGroups: (signal) => service.routeGroups(signal),
            // Tenant groups live behind their own endpoint; the page only needs the
            // names for its picker.
            keyGroups: (signal) =>
              service.keyGroups(signal).then((rows) => ({ groups: rows.map((row) => row.name) })),
            modelMetadata: (signal) => service.modelMetadata(signal),
            createKey: (body) => service.createKey(body),
            updateKey: (id, body) => service.updateKey(id, body),
            deleteKey: (id) => service.deleteKey(id),
            revealKey: (id) => service.revealKey(id),
            rotateKey: (id) => service.rotateKey(id),
          },
    [client, member, service],
  );
  return <KeysView source={source} caps={member ? MEMBER_KEY_CAPS : ADMIN_KEY_CAPS} team={team} />;
}

/**
 * The keys list, driven by an injected data source and capabilities.
 *
 * The console mounts it with the admin client and every capability on; the
 * member app mounts the very same renderer with `/me` endpoints and the
 * operator-only capabilities off, so a member sees their own keys — same
 * table, same filters, same dialogs — without the columns and actions that
 * belong to running the site.
 */
export function KeysView({
  source,
  caps,
  team = false,
  extraRowActions,
}: {
  source: KeysSource;
  caps: KeysCapabilities;
  /**
   * Whether the gateway currently serves more than one person.
   *
   * Passed in rather than read here: the team vocabulary (tenant groups, the
   * owning member) comes from the multi-user area, and this renderer is also
   * mounted by the member app — which has no console session to ask.
   */
  team?: boolean;
  /** Member-only actions appended to each row ("connect", …). */
  extraRowActions?: (key: DownstreamKey) => ActionMenuItem[];
}) {
  const { t } = useI18n();
  useCurrency();
  // Both conditions matter: the capability says this viewer may see team
  // concepts at all, the prop says the gateway is currently in that mode.
  const showTeam = Boolean(team) && caps.team;
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useQuery({
    queryKey: ["keys", caps.upstream ? "admin" : "member"],
    queryFn: ({ signal }) => source.keys(signal),
  });
  const keyActivity = useQuery({
    queryKey: ["key-activity", caps.upstream ? "admin" : "member"],
    queryFn: ({ signal }) => source.keyActivity!(signal),
    enabled: caps.upstream && !!source.keyActivity,
    refetchInterval: caps.upstream ? 2000 : false,
  });
  const ownerUsers = useQuery({
    queryKey: ["key-owner-users"],
    queryFn: ({ signal }) => source.ownerUsers!(signal),
    enabled: showTeam && !!source.ownerUsers,
    staleTime: 60_000,
  });
  const ownerById = useMemo(
    () => new Map((ownerUsers.data ?? []).map((user) => [user.id, user])),
    [ownerUsers.data],
  );
  const currentConcurrencyByKey = useMemo(
    () => new Map((keyActivity.data ?? []).map((item) => [item.id, item.current_concurrent])),
    [keyActivity.data],
  );
  const discovered = useQuery({
    queryKey: ["discovered-models", caps.upstream ? "admin" : "member"],
    queryFn: ({ signal }) => source.discoveredModels(signal),
  });
  // Upstream names reported by discovery: used only to expand wildcard
  // routes into the concrete names a client can ask for. They are NOT the
  // candidate list — the only names a token filter can match are route
  // names (see modelOptions below).
  const discoveredNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const model of discovered.data ?? []) {
      const name = model.model_name.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [discovered.data]);
  const usage = useQuery({
    queryKey: ["usage-summary", caps.upstream ? "admin" : "member"],
    queryFn: ({ signal }) => source.usageSummary(signal),
  });
  const modelRoutes = useQuery({
    queryKey: ["route-overviews", caps.upstream ? "admin" : "member"],
    queryFn: ({ signal }) => source.routeOverviews(signal),
  });
  const routeGroups = useQuery({
    queryKey: ["route-groups", caps.upstream ? "admin" : "member"],
    queryFn: ({ signal }) => source.routeGroups(signal),
  });
  const metadata = useQuery({
    queryKey: ["model-metadata", caps.upstream ? "admin" : "member"],
    queryFn: ({ signal }) => source.modelMetadata(signal),
  });
  const tenantGroups = useQuery({
    queryKey: ["key-groups"],
    queryFn: ({ signal }) => source.keyGroups!(signal),
    enabled: showTeam && !!source.keyGroups,
  });
  const metaByModel = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of metadata.data?.items ?? []) {
      map.set(item.model_name, item.vendor);
    }
    return map;
  }, [metadata.data]);
  // The allow/deny filter compares the name a client sends, and clients can
  // only send route names. A member's /me/models endpoint already returns the
  // names authorized for that account; the admin side derives them from routes
  // so aliases and wildcard expansions match the names clients can call.
  const modelOptions = useMemo<ModelOption[]>(() => {
    if (!caps.upstream) {
      return discoveredNames.map((name) => ({
        name,
        group: modelGroup(name, undefined, metaByModel.get(name)),
      }));
    }

    const out: ModelOption[] = [];
    for (const overview of modelRoutes.data ?? []) {
      const pattern = overview.route.model_pattern.trim();
      if (!pattern) continue;
      const channels = new Map<number, string>();
      for (const candidate of overview.members ?? []) {
        channels.set(candidate.member.channel_id, candidate.channel.name);
      }
      const channelList = [...channels]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.id - b.id);
      const group = modelGroup(pattern, overview.route.model_group, metaByModel.get(pattern));
      const disabled = !overview.route.enabled;
      if (/[?*]/.test(pattern)) {
        const matched = discoveredNames.filter((name) => modelPatternMatches(pattern, name));
        if (matched.length === 0) {
          out.push({ name: pattern, channels: channelList, group, disabled, pattern });
        }
        for (const name of matched) {
          out.push({ name, channels: channelList, group, disabled, pattern });
        }
        continue;
      }
      out.push({
        name: pattern,
        channels: channelList,
        group,
        disabled,
        aliasOf: aliasReals(overview),
      });
    }
    return out;
  }, [caps.upstream, discoveredNames, metaByModel, modelRoutes.data]);
  const modelGroupOptions = useMemo(() => {
    const groups = new Set<string>();
    for (const option of modelOptions) {
      groups.add(option.group?.trim() || autoModelGroup(option.name));
    }
    return [...groups].sort((a, b) => a.localeCompare(b));
  }, [modelOptions]);
  const modelsByGroup = useMemo(() => {
    const grouped = new Map<string, Set<string>>();
    for (const option of modelOptions) {
      const group = option.group?.trim() || autoModelGroup(option.name);
      const models = grouped.get(group) ?? new Set<string>();
      models.add(option.name);
      grouped.set(group, models);
    }
    return grouped;
  }, [modelOptions]);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<DownstreamKey | null>(null);
  const [redemption, setRedemption] = useState(false);
  const [viewingModelRange, setViewingModelRange] = useState<{
    key: DownstreamKey;
    models: string[];
  } | null>(null);
  const [created, setCreated] = useState<Pick<CreatedDownstreamKey, "id" | "token"> | null>(null);
  const [remove, setRemove] = useState<number | null>(null);
  // Re-view a stored plaintext token (created after plaintext storage).
  const [viewing, setViewing] = useState<{ id: number; name: string } | null>(null);
  const [viewedToken, setViewedToken] = useState<string | null>(null);
  // Rotate: replace the token, old one dies instantly.
  const [rotating, setRotating] = useState<number | null>(null);
  const [rotatedToken, setRotatedToken] = useState<{
    id: number;
    name: string;
    token: string;
  } | null>(null);
  const [rotateError, setRotateError] = useState<unknown>(null);
  const openedCreateFromQuery = useRef(false);

  useEffect(() => {
    if (openedCreateFromQuery.current) return;
    if (searchParams.get("create") !== "1") return;
    openedCreateFromQuery.current = true;
    setAdd(true);
    const next = new URLSearchParams(searchParams);
    next.delete("create");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const create = useAdminMutation({
    mutationFn: (v: KeyCreateInput) => source.createKey!(v),
    invalidateKeys: [["keys"], ["usage-summary"]],
    toastOnError: false,
    onSuccess: (result) => {
      setCreated(result);
      setAdd(false);
    },
  });
  const update = useAdminMutation({
    mutationFn: (v: { id: number; body: KeyUpdateInput }) => source.updateKey!(v.id, v.body),
    invalidateKeys: [["keys"], ["usage-summary"]],
    toastOnError: false,
    onSuccess: () => {
      setEdit(null);
      setViewingModelRange(null);
    },
  });
  const del = useAdminMutation({
    mutationFn: (id: number) => source.deleteKey!(id),
    invalidateKeys: [["keys"], ["usage-summary"]],
    pendingIdOf: (id) => id,
    toastOnError: false,
    onSuccess: () => setRemove(null),
  });
  const reveal = useAdminMutation({
    mutationFn: (id: number) => source.revealKey!(id),
    pendingIdOf: (id) => id,
    toastOnError: false,
    onSuccess: (result) => setViewedToken(result.token),
  });
  // Copying a token is the same read the reveal dialog performs, without making
  // the reader transcribe a secret by hand: reveal, put it on the clipboard,
  // confirm in place. If the clipboard is unavailable the dialog opens instead,
  // which is the one path that still lets them see it.
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [apiAddressCopied, setApiAddressCopied] = useState(false);
  const [apiAddressOpen, setApiAddressOpen] = useState(false);
  const apiAddressRootRef = useRef<HTMLDivElement>(null);
  const apiAddressPopoverRef = useRef<HTMLElement>(null);
  const apiAddressTimer = useRef<number | null>(null);
  const apiAddress = `${window.location.origin}/v1`;
  // The in-place "copied" confirmation is a timer, and a timer that outlives its
  // component is a leak: it fired into a torn-down tree, which showed up as a test
  // run reporting 526 passed and exit code 1. Cleared on unmount and on each copy.
  const copyResetTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
      if (apiAddressTimer.current !== null) window.clearTimeout(apiAddressTimer.current);
    },
    [],
  );
  useEffect(() => {
    const popover = apiAddressPopoverRef.current;
    const root = apiAddressRootRef.current;
    if (!apiAddressOpen || !popover || !root) return;
    const close = () => setApiAddressOpen(false);
    const unregister = registerOverlay(close, {
      modal: false,
      transient: true,
      element: popover,
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (popover.contains(target) || root.contains(target))) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    popover.addEventListener("keydown", onKeyDown);
    return () => {
      unregister();
      window.removeEventListener("pointerdown", onPointerDown, true);
      popover.removeEventListener("keydown", onKeyDown);
    };
  }, [apiAddressOpen]);
  const copyApiAddress = async () => {
    try {
      await navigator.clipboard.writeText(apiAddress);
      setApiAddressCopied(true);
      if (apiAddressTimer.current !== null) window.clearTimeout(apiAddressTimer.current);
      apiAddressTimer.current = window.setTimeout(() => {
        apiAddressTimer.current = null;
        setApiAddressCopied(false);
      }, 1800);
    } catch {
      setApiAddressCopied(false);
    }
  };
  const copy = useAdminMutation({
    mutationFn: (key: { id: number; name: string }) => source.revealKey!(key.id),
    pendingIdOf: (key) => key.id,
    toastOnError: false,
    onSuccess: (result, variables) => {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) {
        // No clipboard in this context (an insecure origin, or a browser that
        // withheld the API): show the secret instead of a button that lies.
        setViewedToken(result.token);
        setViewing({ id: variables.id, name: variables.name });
        return;
      }
      void clipboard
        .writeText(result.token)
        .then(() => {
          setCopiedId(variables.id);
          if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
          copyResetTimer.current = window.setTimeout(() => {
            copyResetTimer.current = null;
            setCopiedId((current) => (current === variables.id ? null : current));
          }, 1800);
        })
        .catch(() => {
          setViewedToken(result.token);
          setViewing({ id: variables.id, name: variables.name });
        });
    },
  });
  const rotate = useAdminMutation({
    mutationFn: (v: { id: number; name: string }) => source.rotateKey!(v.id),
    invalidateKeys: [["keys"]],
    toastOnError: false,
    onSuccess: (result, variables) => {
      setRotatedToken({
        id: result.id,
        name: variables.name,
        token: result.token,
      });
      setRotating(null);
      setRotateError(null);
    },
    onError: (err) => setRotateError(err),
  });

  const searchTerm = searchParams.get("search")?.trim().toLowerCase() ?? "";
  const rows = useMemo(() => {
    const list = query.data ?? [];
    if (!searchTerm) return list;
    return list.filter(
      (key) => key.name.toLowerCase().includes(searchTerm) || String(key.id).includes(searchTerm),
    );
  }, [query.data, searchTerm]);
  const pagination = useClientPagination(rows, 12);
  const pageRows = pagination.pageItems;
  const enabledCount = useMemo(() => rows.filter((key) => key.enabled).length, [rows]);
  const totalUsed = useMemo(
    () => rows.reduce((sum, key) => sum + (key.quota_used_tokens ?? 0), 0),
    [rows],
  );

  const openCreate = () => {
    create.reset();
    setAdd(true);
  };

  const viewKey = (key: DownstreamKey) => {
    reveal.reset();
    setViewedToken(null);
    setViewing({ id: key.id, name: key.name });
    reveal.mutate(key.id);
  };
  const copyKey = (key: DownstreamKey) => {
    copy.reset();
    copy.mutate({ id: key.id, name: key.name });
  };
  const keyActions = (key: DownstreamKey): ActionMenuItem[] => {
    const busy =
      reveal.pendingId === key.id ||
      del.pendingId === key.id ||
      (rotate.isPending && rotate.variables?.id === key.id) ||
      (update.isPending && update.variables?.id === key.id);
    const actions: ActionMenuItem[] = [];
    // A capability that is off removes the item instead of disabling it: an
    // action a member can never perform should not appear at all.
    if (caps.edit) {
      actions.push({
        key: "edit",
        label: t("keys.edit"),
        group: t("actions.manage"),
        icon: <Pencil size={14} />,
        disabled: busy,
        onSelect: () => {
          update.reset();
          setEdit(key);
        },
      });
    }
    if (caps.rotate) {
      actions.push({
        key: "rotate",
        label: t("keys.rotate"),
        group: t("actions.danger"),
        danger: true,
        icon: <RefreshCw size={14} />,
        disabled: busy,
        onSelect: () => {
          rotate.reset();
          setRotateError(null);
          setRotating(key.id);
        },
      });
    }
    if (caps.remove) {
      actions.push({
        key: "delete",
        label: t("keys.delete"),
        group: t("actions.danger"),
        danger: true,
        icon: <Trash2 size={14} />,
        disabled: busy,
        onSelect: () => setRemove(key.id),
      });
    }
    // Member-only affordances (the connect sheet) arrive through the source's
    // own slot, so the same row can offer more without a second table.
    if (extraRowActions) actions.push(...extraRowActions(key));
    return actions.map((action) => ({
      ...action,
      disabledReason: action.disabled ? t("common.working") : undefined,
    }));
  };
  return (
    <main className="page keys-page">
      <div className="ops-canvas">
        <TelemetryStrip
          items={[
            {
              label: t("keys.stat.total"),
              value: query.isPending ? "—" : rows.length,
              tone: "primary",
            },
            {
              label: t("keys.stat.enabled"),
              value: query.isPending ? "—" : enabledCount,
              tone: "success",
            },
            {
              label: t("keys.stat.usedTokens"),
              value:
                query.isPending || usage.isPending || usage.isError
                  ? "—"
                  : formatNumber(usage.data?.total_tokens ?? totalUsed),
              tone: "info",
            },
            {
              label: t("keys.stat.requests"),
              value:
                usage.isPending || usage.isError
                  ? "—"
                  : formatNumber(usage.data?.request_count ?? 0),
              tone: "warning",
            },
          ]}
        />
        {usage.isError ? <ErrorState error={usage.error} retry={() => usage.refetch()} /> : null}

        <Panel className="ops-list-panel">
          <div className="workspace-filter-row keys-toolbar">
            <div className="directory-search channels-search keys-search">
              <Search size={16} aria-hidden="true" />
              <HeroInput
                className="channels-search-input"
                type="search"
                name="key-search"
                autoComplete="off"
                value={searchParams.get("search") ?? ""}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams);
                  const value = event.target.value;
                  if (value) next.set("search", value);
                  else next.delete("search");
                  setSearchParams(next, { replace: true });
                }}
                placeholder={t("keys.searchPlaceholder")}
                aria-label={t("keys.searchPlaceholder")}
              />
            </div>
            <div className="keys-toolbar-actions">
              <div className="keys-api-address" ref={apiAddressRootRef}>
                <Dropdown isOpen={apiAddressOpen} onOpenChange={setApiAddressOpen}>
                  <Dropdown.Trigger
                    className="button button--secondary keys-api-address-trigger"
                    aria-label={t("keys.apiAddress")}
                  >
                    <Globe2 size={15} aria-hidden="true" />
                    {t("keys.apiAddress")}
                    <ChevronDown size={13} aria-hidden="true" />
                  </Dropdown.Trigger>
                  <Dropdown.Popover
                    ref={apiAddressPopoverRef}
                    className="keys-api-address-popover"
                    placement="bottom end"
                    isNonModal
                  >
                    <div className="keys-api-address-title">{t("keys.apiAddress")}</div>
                    <Button
                      className="keys-api-address-copy"
                      type="button"
                      aria-label={t("keys.copyAPIAddress")}
                      onClick={() => void copyApiAddress()}
                    >
                      <span>
                        <strong>{t("keys.defaultAPIAddress")}</strong>
                        <code>{apiAddress}</code>
                      </span>
                      {apiAddressCopied ? (
                        <Check size={16} aria-label={t("dashboard.copied")} />
                      ) : (
                        <Copy size={16} aria-hidden="true" />
                      )}
                    </Button>
                  </Dropdown.Popover>
                </Dropdown>
              </div>
              {caps.create ? (
                <Button icon={<Plus size={16} />} onClick={openCreate}>
                  {t("keys.create")}
                </Button>
              ) : null}
              {/* Credit codes are an operator concept in the console; the member
                  app redeems inside its own settings page instead. */}
              {caps.quotas ? (
                <Button
                  variant="secondary"
                  icon={<Ticket size={15} />}
                  onClick={() => setRedemption(true)}
                >
                  {t("keys.redemption")}
                </Button>
              ) : null}
            </div>
          </div>
          <EntityState
            isLoading={query.isPending}
            isError={query.isError}
            error={query.error}
            isEmpty={!rows.length}
            empty={
              <EmptyHero
                kicker={t("keys.emptyKicker")}
                title={t("keys.emptyTitle")}
                body={t("keys.empty")}
                actions={
                  <>
                    {caps.upstream ? (
                      <Link className="button button-secondary" to="/channels">
                        {t("keys.ctaConnections")}
                      </Link>
                    ) : null}
                  </>
                }
              />
            }
            retry={() => query.refetch()}
          >
            <ListShell
              footer={
                <PaginationBar
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  total={pagination.total}
                  pageSize={pagination.pageSize}
                  rangeStart={pagination.rangeStart}
                  rangeEnd={pagination.rangeEnd}
                  hasPrev={pagination.hasPrev}
                  hasNext={pagination.hasNext}
                  onPageChange={pagination.setPage}
                  onPageSizeChange={pagination.setPageSize}
                />
              }
            >
              <DataTable
                headers={[
                  t("common.name"),
                  t("keys.secretCol"),
                  ...(caps.quotas || caps.pricing ? [t("keys.usageCol")] : []),
                  ...(caps.modelRange ? [t("keys.modelRangeCol")] : []),
                  ...(caps.concurrency ? [t("keys.currentConcurrentCol")] : []),
                  t("common.status"),
                  ...(caps.advanced ? [t("keys.expiresAt")] : []),
                  t("common.created"),
                  t("common.actions"),
                ]}
              >
                {pageRows.map((k) => {
                  const allowedModels = (k.model_allowlist ?? "")
                    .split(",")
                    .map((model) => model.trim())
                    .filter(Boolean);
                  const owner = ownerById.get(k.user_id ?? 0);
                  const ownerName =
                    k.owner_name?.trim() ||
                    owner?.name.trim() ||
                    k.owner_username ||
                    owner?.username ||
                    t(ownerUsers.isPending ? "keys.userOwnerLoading" : "keys.userOwnerUnknown");
                  const ownerUsername = k.owner_username || owner?.username;
                  return (
                    <tr key={k.id}>
                      <td>
                        <strong>{k.name}</strong>
                        {showTeam && k.user_id ? (
                          <small>
                            {t("keys.userOwner", {
                              name: ownerName,
                              username:
                                ownerUsername && ownerUsername !== ownerName
                                  ? ` (@${ownerUsername})`
                                  : "",
                            })}
                          </small>
                        ) : null}
                      </td>
                      <td className="key-secret-cell">
                        {caps.reveal && (k.has_token || k.id === rotatedToken?.id) ? (
                          <>
                            <code>mg-••••••••</code>
                            <IconButton
                              className="is-bare"
                              label={
                                copiedId === k.id ? t("dashboard.copied") : t("keys.copyToken")
                              }
                              title={
                                copiedId === k.id ? t("dashboard.copied") : t("keys.copyToken")
                              }
                              disabled={copy.pendingId === k.id}
                              onClick={() => copyKey(k)}
                            >
                              {copiedId === k.id ? <Check size={14} /> : <Copy size={14} />}
                            </IconButton>
                          </>
                        ) : (
                          <span className="key-secret-unavailable">
                            {caps.reveal ? t("keys.tokenUnavailable") : "—"}
                          </span>
                        )}
                      </td>
                      {caps.quotas || caps.pricing ? (
                        <td>
                          <div className="key-usage-cell">
                            <span>
                              <strong>{t("keys.todayUsage")}</strong>
                              {formatCost(k.today_cost)} · {formatNumber(k.today_tokens)} Token
                            </span>
                            <span>
                              <strong>{t("keys.last30DaysUsage")}</strong>
                              {formatCost(k.last_30_days_cost)} ·{" "}
                              {formatNumber(k.last_30_days_tokens)} Token
                            </span>
                          </div>
                        </td>
                      ) : null}
                      {caps.modelRange ? (
                        <td>
                          {allowedModels.length === 0 ? (
                            t("keys.modelRangeFollowAccount")
                          ) : allowedModels.length <= 2 ? (
                            allowedModels.join("、")
                          ) : (
                            <span className="key-model-range-summary">
                              <span>
                                {t("keys.modelRangeCount", { count: allowedModels.length })}
                              </span>
                              <Button
                                className="button--ghost"
                                onClick={() =>
                                  setViewingModelRange({ key: k, models: allowedModels })
                                }
                              >
                                {t("keys.modelRangeView")}
                              </Button>
                            </span>
                          )}
                        </td>
                      ) : null}
                      {caps.concurrency ? (
                        <td className="key-current-concurrent">
                          {currentConcurrencyByKey.get(k.id) ?? k.current_concurrent ?? 0}
                        </td>
                      ) : null}
                      <td>
                        {caps.edit ? (
                          <EnabledSwitch
                            on={k.enabled}
                            name={k.name}
                            pending={update.isPending && update.variables?.id === k.id}
                            onToggle={() =>
                              update.mutate({ id: k.id, body: { enabled: !k.enabled } })
                            }
                          />
                        ) : (
                          <StatusBadge value={k.enabled} />
                        )}
                      </td>
                      {caps.advanced ? (
                        <td>{k.expires_at ? formatDate(k.expires_at) : t("keys.neverExpires")}</td>
                      ) : null}
                      <td>{formatDate(k.created_at)}</td>
                      <td className="actions key-row-actions">
                        {caps.reveal && (k.has_token || k.id === rotatedToken?.id) && (
                          <IconButton
                            className="is-bare"
                            label={t("keys.view")}
                            title={t("keys.view")}
                            disabled={reveal.pendingId === k.id}
                            onClick={() => viewKey(k)}
                          >
                            <Eye size={14} />
                          </IconButton>
                        )}
                        {keyActions(k).map((action) =>
                          action.icon ? (
                            <IconButton
                              key={action.key}
                              className={`is-bare${action.danger ? " key-row-action-danger" : ""}`}
                              label={action.label}
                              title={action.label}
                              disabled={action.disabled}
                              onClick={action.onSelect}
                            >
                              {action.icon}
                            </IconButton>
                          ) : (
                            <Button
                              key={action.key}
                              className="button--ghost"
                              disabled={action.disabled}
                              onClick={action.onSelect}
                            >
                              {action.label}
                            </Button>
                          ),
                        )}
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            </ListShell>
          </EntityState>
        </Panel>
      </div>

      {caps.quotas && redemption && <RedemptionDialog onClose={() => setRedemption(false)} />}
      {viewingModelRange ? (
        <KeyModelRangeDialog
          models={viewingModelRange.models}
          modelOptions={modelOptions}
          canEdit={caps.edit}
          pending={update.isPending}
          error={update.error}
          onClose={() => setViewingModelRange(null)}
          onSave={(models) =>
            update.mutate({
              id: viewingModelRange.key.id,
              body: { model_allowlist: models.join(",") },
            })
          }
        />
      ) : null}
      {add && (
        <KeyDialog
          mode="create"
          pending={create.isPending}
          error={create.error}
          onClose={() => setAdd(false)}
          onSave={(v) => create.mutate(v)}
          modelOptions={modelOptions}
          modelGroupOptions={modelGroupOptions}
          modelsByGroup={modelsByGroup}
          routeGroupNames={caps.upstream ? (routeGroups.data?.groups ?? []) : []}
          tenantGroupNames={showTeam ? (tenantGroups.data?.groups ?? []) : []}
        />
      )}
      {edit && (
        <KeyDialog
          mode="edit"
          initial={edit}
          pending={update.isPending}
          error={update.error}
          onClose={() => {
            setEdit(null);
          }}
          onSave={(v) =>
            update.mutate({
              id: edit.id,
              body: {
                // Every field the dialog can change has to travel: an omitted
                // field means "keep the stored value" (the backend reads
                // pointers), so dropping one here silently turns the input into
                // a no-op. quota_total_cost and route_group_name were both
                // collected but never sent, which is why picking a route group
                // looked like it saved and did not.
                name: v.name,
                scopes: v.scopes,
                quota_total_tokens: v.quota_total_tokens,
                quota_total_cost: v.quota_total_cost,
                model_allowlist: v.model_allowlist,
                model_denylist: v.model_denylist,
                expires_at: v.expires_at ?? "",
                allowed_ips: v.allowed_ips ?? "",
                // Always sent, empty included: "" is how a key is moved back to
                // "no route group", and `|| undefined` would omit it instead.
                route_group_name: v.route_group_name ?? "",
                group_name: v.group_name ?? "",
                reset_used: v.reset_used,
              },
            })
          }
          modelOptions={modelOptions}
          modelGroupOptions={modelGroupOptions}
          modelsByGroup={modelsByGroup}
          routeGroupNames={caps.upstream ? (routeGroups.data?.groups ?? []) : []}
          tenantGroupNames={showTeam ? (tenantGroups.data?.groups ?? []) : []}
        />
      )}
      {created && (
        <Dialog
          title={t("keys.copyTitle")}
          onClose={() => setCreated(null)}
          actions={<Button onClick={() => setCreated(null)}>{t("keys.stored")}</Button>}
        >
          <p className="warning">{t("keys.copyWarning")}</p>
          <div className="secret-output">
            <code>{created.token}</code>
            <IconButton
              label={t("keys.copyToken")}
              onClick={() => navigator.clipboard.writeText(created.token)}
            >
              <Copy size={14} />
            </IconButton>
          </div>
        </Dialog>
      )}
      {remove && (
        <ConfirmDialog
          title={t("keys.revoke")}
          message={t("keys.revokeMsg")}
          confirmLabel={t("keys.revokeConfirm")}
          pending={del.isPending}
          error={del.error}
          onClose={() => setRemove(null)}
          onConfirm={() => del.mutate(remove)}
        />
      )}
      {viewing && (
        <SecretRevealDialog
          title={t("keys.viewTitle", { name: viewing.name })}
          warning={t("keys.viewWarning")}
          secret={viewedToken}
          pending={reveal.isPending}
          error={reveal.error}
          onRetry={() => reveal.mutate(viewing.id)}
          closeLabel={t("common.close")}
          copyLabel={t("keys.copyToken")}
          onClose={() => setViewing(null)}
        />
      )}
      {rotating != null && (
        <ConfirmDialog
          title={t("keys.rotateTitle")}
          message={t("keys.rotateConfirmMsg")}
          confirmLabel={t("keys.rotateConfirm")}
          pending={rotate.isPending}
          error={rotateError}
          onClose={() => {
            if (!rotate.isPending) setRotating(null);
          }}
          onConfirm={() =>
            rotate.mutate({
              id: rotating,
              name: rows.find((k) => k.id === rotating)?.name ?? "",
            })
          }
        />
      )}
      {rotatedToken && (
        <SecretRevealDialog
          title={t("keys.rotatedTitle")}
          warning={t("keys.rotatedWarning")}
          secret={rotatedToken.token}
          closeLabel={t("keys.stored")}
          copyLabel={t("keys.copyToken")}
          onClose={() => setRotatedToken(null)}
        />
      )}
    </main>
  );
}

type KeyFormValues = KeyCreateInput & {
  reset_used?: boolean;
};

function KeyDialog({
  mode,
  initial,
  pending,
  error,
  onClose,
  onSave,
  modelOptions,
  modelGroupOptions,
  modelsByGroup,
  routeGroupNames,
  tenantGroupNames = [],
}: {
  mode: "create" | "edit";
  initial?: DownstreamKey;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (v: KeyFormValues) => void;
  modelOptions: ModelOption[];
  modelGroupOptions: string[];
  modelsByGroup: Map<string, Set<string>>;
  routeGroupNames: string[];
  /** Tenant groups a token can be bound to; empty hides the field entirely. */
  tenantGroupNames?: string[];
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [modelGroupSelection, setModelGroupSelection] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [useCustomToken, setUseCustomToken] = useState(false);
  const [scopes, setScopes] = useState<string[]>(() =>
    (initial?.scopes?.trim() || "relay")
      .split(/[,;|\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  const [quotaTotal, setQuotaTotal] = useState(
    String(
      initial?.quota_total_tokens && initial.quota_total_tokens > 0
        ? initial.quota_total_tokens
        : "",
    ),
  );
  // The spend budget is a SECOND allowance, in the ledger's unit: an operator
  // who sells "100 dollars of usage" caps the key in money, and the relay
  // refuses on whichever budget runs out first.
  const [quotaCost, setQuotaCost] = useState(
    String(
      initial?.quota_total_cost && initial.quota_total_cost > 0 ? initial.quota_total_cost : "",
    ),
  );
  const [tokenInputBad, setTokenInputBad] = useState(false);
  const [costInputBad, setCostInputBad] = useState(false);
  const splitModels = (raw?: string) =>
    (raw ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  const [allowlist, setAllowlist] = useState<string[]>(() => splitModels(initial?.model_allowlist));
  const [denylist, setDenylist] = useState<string[]>(() => splitModels(initial?.model_denylist));
  const [expiresAt, setExpiresAt] = useState(initial?.expires_at ?? "");
  const [allowedIPs, setAllowedIPs] = useState(initial?.allowed_ips ?? "");
  const [routeGroup, setRouteGroup] = useState(initial?.route_group_name ?? "");
  const [tenantGroup, setTenantGroup] = useState(initial?.group_name ?? "");
  const [resetUsed, setResetUsed] = useState(false);
  // Progressive disclosure: billing, model scoping and advanced controls are
  // folded sections so the common path (name + scopes) stays two steps.
  const [openBilling, setOpenBilling] = useState(false);
  const [openModels, setOpenModels] = useState(false);
  const [openAdvanced, setOpenAdvanced] = useState(false);
  // Pre-open a section when the stored value is non-trivial (edit mode).
  useEffect(() => {
    if (mode !== "edit") return;
    if ((initial?.quota_total_tokens ?? 0) > 0 || (initial?.quota_total_cost ?? 0) > 0) {
      setOpenBilling(true);
    }
    if ((initial?.model_allowlist ?? "").trim() || (initial?.model_denylist ?? "").trim()) {
      setOpenModels(true);
    }
    if (
      (initial?.expires_at ?? "").trim() ||
      (initial?.allowed_ips ?? "").trim() ||
      (initial?.route_group_name ?? "").trim() ||
      (initial?.group_name ?? "").trim()
    ) {
      setOpenAdvanced(true);
    }
  }, [mode, initial]);
  const addModelGroup = (group: string) => {
    setModelGroupSelection(group);
    if (!group) return;
    const additions = [...(modelsByGroup.get(group) ?? [])];
    setAllowlist((current) => [
      ...current,
      ...additions.filter((model) => !current.includes(model)),
    ]);
  };
  const trimmedCustom = customToken.trim();
  const customTooShort = useCustomToken && trimmedCustom.length > 0 && trimmedCustom.length < 16;
  const tokenQuota = parseQuotaInput(quotaTotal, true);
  const costQuota = parseQuotaInput(quotaCost);
  const quotasValid = tokenQuota !== null && costQuota !== null && !tokenInputBad && !costInputBad;
  const canSubmit =
    Boolean(name.trim()) &&
    quotasValid &&
    (mode === "edit" || !useCustomToken || (trimmedCustom.length >= 16 && !customTooShort));

  return (
    <Dialog
      title={mode === "create" ? t("keys.createDialog") : t("keys.editDialog")}
      className="key-dialog"
      onClose={onClose}
      busy={pending}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={pending || !canSubmit}
            icon={<KeyRound size={16} />}
            onClick={() => {
              if (!canSubmit || tokenQuota === null || costQuota === null) return;
              onSave({
                name: name.trim(),
                scopes: scopes.length > 0 ? scopes.join(",") : "relay",
                token: mode === "create" && useCustomToken ? trimmedCustom : undefined,
                quota_total_tokens: tokenQuota,
                quota_total_cost: costQuota,
                model_allowlist: allowlist.join(","),
                model_denylist: denylist.join(","),
                expires_at: expiresAt.trim() || undefined,
                allowed_ips: allowedIPs.trim() || undefined,
                route_group_name: routeGroup.trim() || undefined,
                group_name: tenantGroup.trim() || undefined,
                reset_used: mode === "edit" ? resetUsed : undefined,
              });
            }}
          >
            {mode === "create" ? t("common.create") : t("common.save")}
          </Button>
        </>
      }
    >
      <div className="ops-panel-context">
        <span>{mode === "create" ? t("keys.createHint") : t("keys.editHint")}</span>
      </div>
      <Field label={t("common.name")}>
        <HeroInput
          className="key-form-control"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("keys.namePlaceholder")}
        />
      </Field>
      <Field label={t("common.scopes")} hint={t("keys.scopesHint")}>
        <ScopePicker value={scopes} onChange={setScopes} disabled={pending} />
      </Field>

      <div className="key-dialog-section">
        <HeroButton
          type="button"
          variant="ghost"
          className="key-dialog-fold"
          aria-expanded={openBilling}
          onPress={() => setOpenBilling((v) => !v)}
        >
          <ChevronDown size={13} className={openBilling ? "is-open" : ""} />
          <span>{t("keys.sectionBilling")}</span>
          {openBilling ? null : <small>{t("keys.sectionBillingHint")}</small>}
        </HeroButton>
        {openBilling ? (
          <div className="key-dialog-fold-body">
            <Field label={t("keys.quotaTotal")} hint={t("keys.quotaTotalHint")}>
              <HeroInput
                className="key-form-control"
                type="number"
                min={0}
                step={1}
                value={quotaTotal}
                onChange={(e) => {
                  setQuotaTotal(e.target.value);
                  setTokenInputBad(e.target.validity.badInput);
                }}
                aria-invalid={tokenQuota === null || tokenInputBad}
                placeholder={t("keys.unlimitedPlaceholder")}
              />
            </Field>
            <Field label={t("keys.quotaCost")} hint={t("keys.quotaCostHint")}>
              <HeroInput
                className="key-form-control"
                type="number"
                min={0}
                step="0.01"
                value={quotaCost}
                onChange={(e) => {
                  setQuotaCost(e.target.value);
                  setCostInputBad(e.target.validity.badInput);
                }}
                aria-invalid={costQuota === null || costInputBad}
                placeholder={t("keys.unlimitedPlaceholder")}
              />
            </Field>
          </div>
        ) : null}
        {!quotasValid ? (
          <p className="inline-error" role="alert">
            {t("keys.invalidQuota")}
          </p>
        ) : null}
      </div>

      <div className="key-dialog-section">
        <HeroButton
          type="button"
          variant="ghost"
          className="key-dialog-fold"
          aria-expanded={openModels}
          onPress={() => setOpenModels((v) => !v)}
        >
          <ChevronDown size={13} className={openModels ? "is-open" : ""} />
          <span>{t("keys.sectionModels")}</span>
          {openModels ? null : <small>{t("keys.sectionModelsHint")}</small>}
        </HeroButton>
        {openModels ? (
          <div className="key-dialog-fold-body">
            <Field label={t("keys.modelAllowlist")} hint={t("keys.modelAllowlistHint")}>
              <div className="model-group-picker">
                <SearchableSelect
                  ariaLabel={t("keys.modelGroupPlaceholder")}
                  value={modelGroupSelection}
                  onChange={addModelGroup}
                  disabled={pending}
                  options={[
                    { value: "", label: t("keys.modelGroupPlaceholder") },
                    ...modelGroupOptions.map((group) => ({
                      value: group,
                      label: `${formatGroupName(group, t)} (${modelsByGroup.get(group)?.size ?? 0})`,
                    })),
                  ]}
                />
                <span className="field-hint">{t("keys.modelGroupHint")}</span>
              </div>
              <ModelPicker
                options={modelOptions}
                selected={allowlist}
                onChange={setAllowlist}
                placeholder={t("modelPicker.search")}
                emptyLabel={t("keys.modelPickerEmpty")}
                flagMissing
              />
            </Field>
            <Field label={t("keys.modelDenylist")} hint={t("keys.modelDenylistHint")}>
              <ModelPicker
                options={modelOptions}
                selected={denylist}
                onChange={setDenylist}
                placeholder={t("modelPicker.search")}
                emptyLabel={t("keys.modelPickerEmpty")}
                flagMissing
              />
            </Field>
          </div>
        ) : null}
      </div>

      <div className="key-dialog-section">
        <HeroButton
          type="button"
          variant="ghost"
          className="key-dialog-fold"
          aria-expanded={openAdvanced}
          onPress={() => setOpenAdvanced((v) => !v)}
        >
          <ChevronDown size={13} className={openAdvanced ? "is-open" : ""} />
          <span>{t("keys.sectionAdvanced")}</span>
          {openAdvanced ? null : <small>{t("keys.sectionAdvancedHint")}</small>}
        </HeroButton>
        {openAdvanced ? (
          <div className="key-dialog-fold-body">
            {tenantGroupNames.length > 0 || tenantGroup ? (
              <Field label={t("keys.group")} hint={t("keys.groupHint")}>
                <SearchableSelect
                  ariaLabel={t("keys.group")}
                  value={tenantGroup}
                  disabled={pending}
                  onChange={setTenantGroup}
                  options={[
                    { value: "", label: t("keys.groupDefault") },
                    ...(tenantGroup && !tenantGroupNames.includes(tenantGroup)
                      ? [{ value: tenantGroup, label: formatGroupName(tenantGroup, t) }]
                      : []),
                    ...tenantGroupNames.map((name) => ({
                      value: name,
                      label: formatGroupName(name, t),
                    })),
                  ]}
                />
              </Field>
            ) : null}
            <Field label={t("keys.routeGroup")} hint={t("keys.routeGroupHint")}>
              <SearchableSelect
                ariaLabel={t("keys.routeGroup")}
                value={routeGroup}
                disabled={pending}
                onChange={setRouteGroup}
                options={[
                  { value: "", label: t("keys.routeGroupNone") },
                  ...(routeGroup && !routeGroupNames.includes(routeGroup)
                    ? [{ value: routeGroup, label: formatGroupName(routeGroup, t) }]
                    : []),
                  ...routeGroupNames.map((name) => ({
                    value: name,
                    label: formatGroupName(name, t),
                  })),
                ]}
              />
            </Field>
            <div className="split is-tight">
              <Field label={t("keys.expiresAt")} hint={t("keys.expiresAtHint")}>
                <HeroDatePicker
                  aria-label={t("keys.expiresAt")}
                  className="key-expiry-picker"
                  granularity="minute"
                  hourCycle={24}
                  isDisabled={pending}
                  value={expiresAt ? parseDateTime(toLocalInput(expiresAt)) : null}
                  onChange={(value) => setExpiresAt(value ? toRFC3339(value.toString()) : "")}
                >
                  <HeroDateField.Group className="key-expiry-group" fullWidth>
                    <HeroDateField.Input>
                      {(segment) => <HeroDateField.Segment segment={segment} />}
                    </HeroDateField.Input>
                    <HeroDateField.Suffix>
                      <HeroDatePicker.Trigger>
                        <HeroDatePicker.TriggerIndicator />
                      </HeroDatePicker.Trigger>
                    </HeroDateField.Suffix>
                  </HeroDateField.Group>
                  <HeroDatePicker.Popover className="key-expiry-popover">
                    <HeroCalendar aria-label={t("keys.expiresAt")} className="ui-date-calendar">
                      <HeroCalendar.Header>
                        <HeroCalendar.Heading />
                        <HeroCalendar.NavButton slot="previous" />
                        <HeroCalendar.NavButton slot="next" />
                      </HeroCalendar.Header>
                      <HeroCalendar.Grid>
                        <HeroCalendar.GridHeader>
                          {(day) => <HeroCalendar.HeaderCell>{day}</HeroCalendar.HeaderCell>}
                        </HeroCalendar.GridHeader>
                        <HeroCalendar.GridBody>
                          {(date) => <HeroCalendar.Cell date={date} />}
                        </HeroCalendar.GridBody>
                      </HeroCalendar.Grid>
                    </HeroCalendar>
                  </HeroDatePicker.Popover>
                </HeroDatePicker>
              </Field>
              <Field label={t("keys.allowedIPs")} hint={t("keys.allowedIPsHint")}>
                <HeroTextArea
                  className="key-form-control key-form-textarea textarea-sm"
                  value={allowedIPs}
                  disabled={pending}
                  onChange={(e) => setAllowedIPs(e.target.value)}
                  placeholder="1.2.3.4&#10;10.0.0.0/8"
                />
              </Field>
            </div>
            {mode === "edit" ? (
              <label className="check is-spaced">
                <CheckboxControl
                  checked={resetUsed}
                  disabled={pending}
                  onChange={(event) => setResetUsed(event.target.checked)}
                />
                <span>{t("keys.resetUsed")}</span>
              </label>
            ) : (
              <>
                <label className="check is-spaced">
                  <CheckboxControl
                    checked={useCustomToken}
                    disabled={pending}
                    aria-label={t("keys.useCustomToken")}
                    onChange={(event) => {
                      setUseCustomToken(event.target.checked);
                      if (!event.target.checked) setCustomToken("");
                    }}
                  />
                  <span>{t("keys.useCustomToken")}</span>
                </label>
                {useCustomToken ? (
                  <Field label={t("keys.customToken")} hint={t("keys.customTokenHint")}>
                    <HeroInput
                      className="key-form-control"
                      type="password"
                      autoComplete="new-password"
                      aria-label={t("keys.customToken")}
                      value={customToken}
                      onChange={(e) => setCustomToken(e.target.value)}
                      placeholder={t("keys.customTokenPlaceholder")}
                      disabled={pending}
                    />
                  </Field>
                ) : (
                  <p className="exchange-panel-note">{t("keys.autoTokenHint")}</p>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>
      {error ? <ErrorState error={error} /> : null}
    </Dialog>
  );
}

/** Converts an RFC3339 string to a local datetime-local input value. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Converts a datetime-local input value to RFC3339 (local time). */
function toRFC3339(local: string): string {
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}
