import { Boxes, Cable, Eye, Plus, Search } from "lucide-react";
import { Button as HeroButton, Input as HeroInput } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import type { ChannelOverview, FinanceItem } from "../../api/types";
import type { ActionMenuItem } from "../../components/ActionMenu";
import { ActionMenu } from "../../components/ActionMenu";
import { rowContextPoint, rowKeyboardContextPoint } from "../../components/contextMenu";
import { EmptyHero } from "../../components/EmptyHero";
import { EntityState } from "../../components/EntityState";
import { ListShell } from "../../components/ListShell";
import { PaginationBar } from "../../components/PaginationBar";
import { Button, DataTable, Panel } from "../../components/ui";
import { ChannelStatusBadges } from "./badges";
import { Pin } from "lucide-react";
import { SearchableSelect, type SelectOption } from "../../components/SearchableSelect";
import { capabilityFlags } from "./helpers";
import type { ConnectionHealthFilter } from "./helpers";
import { useSession } from "../../session";
import { api } from "../../api/client";
import { nativeAmount } from "../models/pricingTypes";
import { useState } from "react";
import { CheckinSettingsDialog } from "./CheckinSettingsDialog";

/**
 * The connections directory: the search and filters, the table, its bulk bar and
 * the row context menu.
 *
 * This is the A02 split's point for the channels page — the list used to be 340
 * lines of JSX in the middle of a two-thousand line component, reading eighteen
 * locals straight out of the enclosing scope, so no part of it (which column shows
 * what, when a row is busy, how the context menu positions itself) could be read
 * or changed without the whole board on screen.
 *
 * The props are deliberately explicit and numerous: every one of those eighteen
 * captured values is now a stated dependency, which is exactly the cost of the
 * split, paid once and visibly rather than silently. The board remains the owner
 * of every query, mutation and piece of state; this component renders and calls
 * back.
 */
type Text = (key: string, vars?: Record<string, string | number>) => string;

/** The slice of a mutation/query hook this directory reads. */
type Pending = { pendingId?: number | string | null };

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Runner = { mutate: (...args: any[]) => unknown };

export type ChannelDirectoryProps = {
  t: Text;
  /* Filters. */
  query: string;
  setQuery: (value: string) => void;
  params: URLSearchParams;
  setParams: (next: URLSearchParams, options?: { replace: boolean }) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  groupFilter: string;
  setGroupFilter: (value: string) => void;
  updateFilterParam: (key: string, value: string) => void;
  /** Group/type options come straight off the rows, so a channel with no
   *  type_hint contributes an undefined entry — rendered as an empty option. */
  filterOptions: { types: (string | undefined)[]; groups: string[] };
  healthFilter: ConnectionHealthFilter;
  setHealthFilter: (value: ConnectionHealthFilter) => void;
  /* Data. */
  overviews: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data?: ChannelOverview[];
    refetch: () => void;
  };
  rows: ChannelOverview[];
  /**
   * Channels the same search term reached through their MODELS rather than
   * their name. They are listed under the table, never twice inside it.
   */
  modelMatches: Array<{ channelId: number; name: string; model: string; source: string }>;
  pageRows: ChannelOverview[];
  selected: ChannelOverview | null;
  pagination: {
    page: number;
    totalPages: number;
    total: number;
    pageSize: number;
    rangeStart: number;
    rangeEnd: number;
    hasPrev: boolean;
    hasNext: boolean;
    setPage: (page: number) => void;
    setPageSize: (size: number) => void;
  };
  /* Bulk selection and its operations. */
  bulkMode: boolean;
  bulkSelected: Set<number>;
  toggleBulkSelected: (id: number) => void;
  setBulkSelected: (next: Set<number> | ((prev: Set<number>) => Set<number>)) => void;
  exitBulkMode: () => void;
  bulkBusy: boolean;
  bulkSync: Runner;
  bulkStatus: Runner;
  bulkHeader: React.ReactNode;
  addAction: React.ReactNode;
  maintenanceActions: React.ReactNode;
  setCheckin: (input: { credentialId: number; enabled: boolean }) => Promise<unknown>;
  /* Row interaction. */
  openAdd: () => void;
  selectRow: (id: number) => void;
  setInspectorOpen: (open: boolean) => void;
  setContextMenu: (value: { channelId: number; top: number; left: number } | null) => void;
  contextMenu: { channelId: number; top: number; left: number } | null;
  connectionActions: (
    overview: ChannelOverview,
    options?: { closeContext?: boolean },
  ) => ActionMenuItem[];
  /* Row busy state comes from five mutations' pending ids. */
  /** The ids currently pinned to the top (shared console pins). */
  pinnedIds?: Set<string>;
  pending: {
    refresh: Pending;
    probe: Pending;
    accountProbe: Pending;
    syncKeys: Pending;
    toggle: Pending;
    del: Pending;
  };
};

export function ChannelDirectory(props: ChannelDirectoryProps) {
  const [checkinSettings, setCheckinSettings] = useState<{
    overview: ChannelOverview;
    enabled: boolean;
  } | null>(null);
  const { client } = useSession();
  const finance = useQuery({
    queryKey: ["finance"],
    queryFn: ({ signal }) => api(client!).finance(signal),
    enabled: Boolean(client),
    retry: false,
    staleTime: 120_000,
    refetchInterval: (query) => (query.state.data?.refreshing ? 1_500 : false),
  });
  const financeByChannel = new Map<number, FinanceItem>(
    (finance.data?.items ?? []).map((item) => [item.channel_id, item]),
  );
  const formatUpstreamQuota = (value: number, item: FinanceItem) => {
    if (!item.unit) return t("billing.quotaPoints", { value });
    const amount = item.quota_per_unit > 0 ? value / item.quota_per_unit : value;
    return nativeAmount(amount, item.unit, t("billing.credit"));
  };
  const {
    t,
    query,
    setQuery,
    params,
    setParams,
    typeFilter,
    setTypeFilter,
    groupFilter,
    setGroupFilter,
    updateFilterParam,
    filterOptions,
    healthFilter,
    setHealthFilter,
    overviews,
    rows,
    modelMatches,
    pageRows,
    selected,
    pagination,
    bulkMode,
    bulkSelected,
    toggleBulkSelected,
    setBulkSelected,
    exitBulkMode,
    bulkBusy,
    bulkSync,
    bulkStatus,
    bulkHeader,
    addAction,
    maintenanceActions,
    setCheckin,
    openAdd,
    selectRow,
    setInspectorOpen,
    setContextMenu,
    contextMenu,
    connectionActions,
    pinnedIds,
    pending,
  } = props;
  const typeOptions: SelectOption[] = [
    { value: "all", label: t("channels.allTypes") },
    ...filterOptions.types
      .filter((type): type is string => Boolean(type))
      .map((type) => ({ value: type, label: type })),
  ];
  const groupOptions: SelectOption[] = [
    { value: "all", label: t("channels.allGroups") },
    ...filterOptions.groups.map((group) => ({ value: group, label: group })),
  ];
  return (
    <Panel className="ops-list-panel channels-directory">
      <div className="workspace-filter-row">
        {" "}
        <div className="directory-search channels-search">
          <Search size={16} aria-hidden="true" />
          <HeroInput
            className="channels-search-input"
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              setQuery(value);
              const next = new URLSearchParams(params);
              if (value) next.set("search", value);
              else next.delete("search");
              next.delete("id");
              setParams(next, { replace: true });
            }}
            placeholder={t("channels.searchPlaceholder")}
            aria-label={t("channels.searchPlaceholder")}
          />
        </div>
        <div className="channels-filter-select">
          <SearchableSelect
            ariaLabel={t("channels.filterType")}
            options={typeOptions}
            value={typeFilter}
            onChange={(value) => {
              setTypeFilter(value);
              updateFilterParam("type", value);
            }}
          />
        </div>
        <div className="channels-filter-select">
          <SearchableSelect
            ariaLabel={t("channels.filterGroup")}
            options={groupOptions}
            value={groupFilter}
            onChange={(value) => {
              setGroupFilter(value);
              updateFilterParam("group", value);
            }}
          />
        </div>
        <span className="workspace-list-caption">{t("channels.listHint")}</span>
        <div className="channels-maintenance-actions">{maintenanceActions}</div>
        <div className="channels-add-site-action">{addAction}</div>
      </div>
      <EntityState
        isLoading={overviews.isPending}
        isError={overviews.isError}
        error={overviews.error}
        isEmpty={!rows.length && modelMatches.length === 0}
        empty={
          <EmptyHero
            className={healthFilter === "all" ? "channels-first-run" : ""}
            icon={healthFilter === "all" ? <Cable size={19} /> : undefined}
            kicker={
              healthFilter === "missing_key"
                ? t("channels.filter.missingKeyKicker")
                : t("channels.emptyKicker")
            }
            title={
              healthFilter === "missing_key"
                ? t("channels.filter.missingKeyTitle")
                : healthFilter === "attention"
                  ? t("channels.filter.attentionTitle")
                  : healthFilter === "ready"
                    ? t("channels.filter.readyTitle")
                    : t("channels.emptyTitle")
            }
            body={healthFilter === "all" ? t("channels.empty") : t("channels.filter.clearHint")}
            actions={
              healthFilter === "all" ? (
                <Button icon={<Plus size={16} />} onClick={openAdd}>
                  {t("channels.add")}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setHealthFilter("all")}>
                  {t("common.clearFilters")}
                </Button>
              )
            }
          />
        }
        retry={() => overviews.refetch()}
      >
        {bulkMode && bulkSelected.size > 0 ? (
          <div className="toolbar bulk-bar">
            <span className="live-trace-count">
              {t("channels.bulkSelected", { n: bulkSelected.size })}
            </span>
            <Button
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => bulkSync.mutate([...bulkSelected])}
            >
              {t("channels.bulkSyncModels")}
            </Button>
            <Button
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => bulkStatus.mutate({ ids: [...bulkSelected], status: "enabled" })}
            >
              {t("common.enableAction")}
            </Button>
            <Button
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => bulkStatus.mutate({ ids: [...bulkSelected], status: "disabled" })}
            >
              {t("common.disableAction")}
            </Button>
            <Button variant="quiet" onClick={() => setBulkSelected(new Set())}>
              {t("channels.bulkClear")}
            </Button>
            <Button variant="quiet" onClick={exitBulkMode}>
              {t("channels.bulkDone")}
            </Button>
          </div>
        ) : null}
        <ListShell
          footer={
            rows.length > 0 ? (
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
            ) : null
          }
        >
          {/* The table only exists when the search matched a NAME: with no such
              row the model group below is the whole answer, and a lone header
              row above it would only suggest the list failed to load. */}
          {pageRows.length > 0 ? (
            <DataTable
              headers={[
                ...(bulkMode ? [bulkHeader] : []),
                t("common.name"),
                t("channels.groupColumn"),
                t("common.status"),
                <span className="channel-model-count-heading">
                  {t("channels.modelsSummaryColumn")}
                </span>,
                t("common.latency"),
                t("channels.balanceUsed"),
                t("channels.checkinColumn"),
                <span className="channel-actions-heading">{t("common.actions")}</span>,
              ]}
            >
              {pageRows.map((overview) => {
                const ch = overview.channel;
                const financeItem = financeByChannel.get(ch.id);
                const caps = capabilityFlags(overview);
                const rowActions = connectionActions(overview);
                const editAction = rowActions.find((item) => item.key === "edit");
                const toggleAction = rowActions.find((item) => item.key === "toggle");
                const moreActions = rowActions.filter(
                  (item) => !["details", "edit", "toggle"].includes(item.key),
                );
                const active = selected?.channel.id === ch.id;
                const rowBusy =
                  pending.refresh.pendingId === ch.id ||
                  pending.probe.pendingId === ch.id ||
                  pending.accountProbe.pendingId === ch.id ||
                  pending.syncKeys.pendingId === ch.id ||
                  pending.toggle.pendingId === ch.id ||
                  pending.del.pendingId === ch.id;
                return (
                  <tr
                    key={ch.id}
                    tabIndex={0}
                    className={`is-clickable${active ? " is-selected" : ""}`}
                    onClick={() => {
                      selectRow(ch.id);
                      setInspectorOpen(true);
                    }}
                    onContextMenu={(event) => {
                      const point = rowContextPoint(event);
                      if (!point) return;
                      selectRow(ch.id);
                      setContextMenu({ channelId: ch.id, ...point });
                    }}
                    onKeyDown={(event) => {
                      const point = rowKeyboardContextPoint(event);
                      if (point) {
                        selectRow(ch.id);
                        setContextMenu({ channelId: ch.id, ...point });
                      }
                    }}
                  >
                    {bulkMode ? (
                      <td className="bulk-cell" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={t("channels.bulkSelectOne", { name: ch.name })}
                          checked={bulkSelected.has(ch.id)}
                          onChange={() => toggleBulkSelected(ch.id)}
                        />
                      </td>
                    ) : null}
                    <td>
                      <strong>{ch.name}</strong>
                      {pinnedIds?.has(String(ch.id)) ? (
                        <span className="pin-chip" title={t("channels.pinnedBadge")}>
                          <Pin size={12} />
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span className="capability-chip is-group">
                        {ch.group_name || t("routing.groupDefault")}
                      </span>
                    </td>
                    <td className="status-col">
                      <div className="capability-stack is-compact">
                        <ChannelStatusBadges overview={overview} />
                        {caps.tokenProblem ? (
                          <span className="capability-chip is-warn">
                            {t("channels.badge.tokenProblem")}
                          </span>
                        ) : null}
                        {caps.modelsReady ? (
                          <span className="capability-chip is-models">
                            {t("channels.badge.models")}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className="channel-model-counts"
                      title={`${t("channels.modelsTotalHint")} · ${t("channels.modelsAdoptedHint")}`}
                    >
                      <span className="channel-model-count-pair">
                        <strong>
                          {overview.last_checked_at ? overview.discovered_model_count : "—"}
                        </strong>
                        <span className="muted">/</span>
                        <strong>{overview.model_count}</strong>
                      </span>
                    </td>
                    <td>
                      {overview.last_checked_at
                        ? t("common.ms", { n: overview.last_latency_ms })
                        : "—"}
                    </td>
                    <td className="channel-finance-cell">
                      {financeItem?.balance_known ? (
                        <div className="channel-finance-values">
                          <strong>{formatUpstreamQuota(financeItem.balance, financeItem)}</strong>
                          <span>
                            {t("channels.used")}:{" "}
                            {formatUpstreamQuota(financeItem.quota_used ?? 0, financeItem)}
                          </span>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {overview.checkin_supported ? (
                        <button
                          type="button"
                          className={`capability-chip is-interactive ${overview.checkin_enabled ? "is-checkin" : "is-muted"}`}
                          title={
                            overview.checkin_enabled
                              ? t("channels.checkinDisable")
                              : t("channels.checkinEnable")
                          }
                          aria-label={`${overview.checkin_enabled ? t("channels.checkinDisable") : t("channels.checkinEnable")}: ${ch.name}`}
                          disabled={rowBusy}
                          onClick={(event) => {
                            // 签到按钮位于可点击行内，阻止行点击抢先打开详情。
                            event.stopPropagation();
                            const checkinAction = rowActions.find(
                              (item) => item.key === "checkin-toggle",
                            );
                            if (
                              overview.has_user_credential &&
                              overview.has_platform_user_id &&
                              checkinAction &&
                              !checkinAction.disabled
                            ) {
                              checkinAction.onSelect();
                              return;
                            }
                            setCheckinSettings({
                              overview,
                              enabled: !overview.checkin_enabled,
                            });
                          }}
                        >
                          {overview.checkin_enabled
                            ? t("channels.checkinEnabled")
                            : t("channels.checkinDisabled")}
                        </button>
                      ) : (
                        <span className="capability-chip is-muted">
                          {t("channels.checkinDisabled")}
                        </span>
                      )}
                    </td>
                    <td
                      className="actions row-actions channel-actions-cell"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="channel-row-quick-actions">
                        <Button
                          variant="quiet"
                          className="channel-row-action-details"
                          icon={<Eye size={14} />}
                          title={t("channels.quickDetails")}
                          aria-label={`${t("channels.quickDetails")}: ${ch.name}`}
                          onClick={() => {
                            selectRow(ch.id);
                            setInspectorOpen(true);
                          }}
                        >
                          {t("channels.quickDetails")}
                        </Button>
                        {editAction ? (
                          <Button
                            variant="quiet"
                            className="channel-row-action-edit"
                            icon={editAction.icon}
                            disabled={rowBusy || editAction.disabled}
                            title={editAction.label}
                            aria-label={`${t("common.edit")}: ${ch.name}`}
                            onClick={editAction.onSelect}
                          >
                            {t("common.edit")}
                          </Button>
                        ) : null}
                        {toggleAction ? (
                          <Button
                            variant="quiet"
                            className={`channel-row-action-toggle ${ch.status === "enabled" ? "is-disable" : "is-enable"}`}
                            icon={toggleAction.icon}
                            disabled={rowBusy || toggleAction.disabled}
                            title={toggleAction.label}
                            aria-label={`${toggleAction.label}: ${ch.name}`}
                            onClick={toggleAction.onSelect}
                          >
                            {toggleAction.label}
                          </Button>
                        ) : null}
                      </div>
                      <ActionMenu
                        compact
                        label={t("common.moreActions")}
                        title={ch.name}
                        disabled={rowBusy}
                        onOpenChange={(open) => {
                          // Ensure credentials for this row's site are loaded so the
                          // check-in toggle label matches the overview badge.
                          if (open) selectRow(ch.id);
                        }}
                        items={moreActions}
                      />
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          ) : null}
          {modelMatches.length > 0 ? (
            <div className="model-match-group">
              <div className="model-match-head">
                <Boxes size={13} aria-hidden="true" />
                <span>
                  {t("channels.modelMatchHead", { n: modelMatches.length, term: query.trim() })}
                </span>
              </div>
              <ul className="model-match-list">
                {modelMatches.map((match) => (
                  <li key={match.channelId}>
                    <HeroButton
                      type="button"
                      variant="ghost"
                      className={`model-match-row${
                        selected?.channel.id === match.channelId ? " is-selected" : ""
                      }`}
                      onPress={() => {
                        selectRow(match.channelId);
                        setInspectorOpen(true);
                      }}
                    >
                      <span className="model-match-name">{match.name}</span>
                      {match.model ? (
                        <span className="pg-chip mono">
                          {t("channels.modelMatchHit", { model: match.model })}
                        </span>
                      ) : null}
                      <span className="muted model-match-source">
                        {t(`channels.modelMatchSource.${match.source}`)}
                      </span>
                    </HeroButton>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </ListShell>
        {contextMenu
          ? (() => {
              const overview =
                rows.find((row) => row.channel.id === contextMenu.channelId) ??
                (overviews.data ?? []).find((row) => row.channel.id === contextMenu.channelId);
              if (!overview) return null;
              return (
                <ActionMenu
                  key={overview.channel.id}
                  label={t("common.moreActions")}
                  title={overview.channel.name}
                  open
                  onOpenChange={(open) => {
                    if (!open) setContextMenu(null);
                  }}
                  position={{ top: contextMenu.top, left: contextMenu.left }}
                  items={connectionActions(overview, { closeContext: true })}
                />
              );
            })()
          : null}
      </EntityState>
      {checkinSettings ? (
        <CheckinSettingsDialog
          overview={checkinSettings.overview}
          enabled={checkinSettings.enabled}
          t={t}
          setCheckin={setCheckin}
          onClose={() => setCheckinSettings(null)}
          onEditCredential={() => {
            const actions = connectionActions(checkinSettings.overview);
            actions.find((item) => item.key === "edit")?.onSelect();
          }}
        />
      ) : null}
    </Panel>
  );
}
