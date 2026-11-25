import { Play, Settings2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { useAdminMutation } from "../../hooks/useAdminMutation";
import { useClientPagination } from "../../hooks/useClientPagination";
import { useI18n } from "../../i18n";
import { useSession } from "../../session";
import { useToast } from "../../toast";
import {
  SCHEDULE_PRESETS,
  scheduleFromSettings,
  settingsFromSchedule,
  type SchedulePresetId,
} from "../../lib/schedulePresets";
import { PaginationBar } from "../../components/PaginationBar";
import { UiDatePicker } from "../../components/UiDatePicker";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorState,
  Loading,
  Panel,
  StatusBadge,
  formatDate,
} from "../../components/ui";
import { CheckinTimePicker } from "./CheckinTimePicker";

/** Human-readable check-in category; falls back to the raw code. */
function checkinCategoryLabel(
  category: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const key = `ops.checkinCategory.${category}`;
  const translated = t(key);
  // i18n returns the key itself when missing.
  if (translated === key) return category;
  return translated;
}

function checkinDetailText(
  log: { category: string; message?: string },
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const message = (log.message || "").trim();
  const label = checkinCategoryLabel(log.category, t);
  if (!message) return label;
  // Avoid "Label — Label" when message already matches a short English category phrase.
  if (message.toLowerCase() === log.category.toLowerCase()) return label;
  if (message === label) return label;
  return `${label} — ${message}`;
}

function siteDisplayName(
  siteId: number,
  sitesById: Map<number, { name: string; base_url: string }>,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const site = sitesById.get(siteId);
  return site?.name.trim() || site?.base_url.trim() || t("common.siteId", { id: siteId });
}

// localDateBounds 将浏览器本地日期转换为左闭右开的 RFC3339 时间范围。
function localDateBounds(day: string): { since: string; until: string } | null {
  if (!day) return null;
  const start = new Date(`${day}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { since: start.toISOString(), until: end.toISOString() };
}

// todayLocalDate 返回浏览器本地日历日期作为默认筛选值。
function todayLocalDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function CheckinsPanel() {
  const { client } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const s = api(client!);
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [siteId, setSiteId] = useState("");
  const [date, setDate] = useState(todayLocalDate);
  const [confirmRun, setConfirmRun] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const runtime = useQuery({
    queryKey: ["runtime-settings"],
    queryFn: ({ signal }) => s.runtimeSettings(signal),
  });
  const [scheduleDraft, setScheduleDraft] = useState<{
    preset: SchedulePresetId;
    cron: string;
  } | null>(null);
  useEffect(() => {
    if (scheduleDraft) return;
    if (!runtime.data?.editable) return;
    setScheduleDraft(
      scheduleFromSettings({
        enabled: runtime.data.editable.checkin_enabled,
        cron: runtime.data.editable.checkin_cron,
      }),
    );
  }, [runtime.data, scheduleDraft]);
  const saveSchedule = useAdminMutation({
    mutationFn: (next: { enabled: boolean; cron: string }) => {
      const editable = runtime.data?.editable;
      if (!editable) throw new Error("runtime settings unavailable");
      return s.updateRuntimeSettings({
        ...editable,
        checkin_enabled: next.enabled,
        checkin_cron: next.cron,
      });
    },
    invalidateKeys: [["runtime-settings"]],
    onSuccess: () => {
      setScheduleOpen(false);
      toast.push({ tone: "success", message: t("ops.checkin.scheduleSaved") });
    },
  });
  const logs = useQuery({
    queryKey: ["checkin-logs", status, siteId, date],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ limit: "500" });
      if (status) params.set("status", status);
      if (siteId) params.set("site_id", siteId);
      const bounds = localDateBounds(date);
      if (bounds) {
        params.set("since", bounds.since);
        params.set("until", bounds.until);
      }
      return s.checkinLogs(`?${params.toString()}`, signal);
    },
    retry: (failureCount, error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/plugin_disabled/i.test(message)) return false;
      const statusCode = (error as { status?: number } | null)?.status;
      if (statusCode === 404) return false;
      return failureCount < 2;
    },
  });
  const sites = useQuery({
    queryKey: ["sites"],
    queryFn: ({ signal }) => s.sites(signal),
  });
  const sitesById = useMemo(() => {
    const map = new Map<number, { name: string; base_url: string }>();
    for (const site of sites.data ?? []) {
      map.set(site.id, { name: site.name, base_url: site.base_url });
    }
    return map;
  }, [sites.data]);
  const run = useMutation({
    mutationFn: s.runAllCheckins,
    onSuccess: (result) => {
      setConfirmRun(false);
      void qc.invalidateQueries({ queryKey: ["checkin-logs"] });
      void qc.invalidateQueries({ queryKey: ["credentials"] });
      void qc.invalidateQueries({ queryKey: ["channel-overviews"] });
      // The result strip below the table is easy to miss — especially when the
      // table is long. A toast makes a manual run's outcome explicit, and a
      // failed count is surfaced as an error rather than a quiet summary.
      toast.push({
        tone: result.failure_count > 0 ? "error" : "success",
        message: t("ops.checkinRunDone", {
          success: result.success_count,
          failure: result.failure_count,
          skipped: result.skipped_count,
        }),
      });
    },
    onError: (error) => {
      setConfirmRun(false);
      toast.pushError(error);
    },
  });
  const checkinRows = logs.data ?? [];
  const checkinPagination = useClientPagination(checkinRows, 15);

  const schedule = scheduleDraft ?? { preset: "off" as const, cron: "" };
  const scheduleDirty =
    runtime.data != null &&
    scheduleDraft != null &&
    (scheduleDraft.preset === "off"
      ? runtime.data.editable.checkin_enabled
      : !runtime.data.editable.checkin_enabled ||
        runtime.data.editable.checkin_cron !== scheduleDraft.cron);

  return (
    <>
      <Panel
        actions={
          <div className="checkin-log-toolbar">
            <div className="checkin-log-filters">
              <select
                aria-label={t("ops.checkin.siteFilter")}
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              >
                <option value="">{t("ops.checkin.allSites")}</option>
                {(sites.data ?? []).map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name.trim() || site.base_url || t("common.siteId", { id: site.id })}
                  </option>
                ))}
              </select>
              <UiDatePicker
                ariaLabel={t("ops.checkin.dateFilter")}
                value={date}
                onChange={setDate}
              />
              <select
                aria-label={t("ops.statusFilter")}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">{t("ops.allStatuses")}</option>
                <option value="success">{t("status.success")}</option>
                <option value="failed">{t("status.failed")}</option>
                <option value="skipped">{t("status.skipped")}</option>
              </select>
            </div>
            <div className="checkin-log-actions">
              <Button
                icon={<Play size={16} />}
                disabled={run.isPending}
                onClick={() => setConfirmRun(true)}
              >
                {run.isPending ? t("ops.running") : t("ops.runEnabled")}
              </Button>
              <Button
                variant="secondary"
                icon={<Settings2 size={16} />}
                disabled={scheduleDraft == null}
                onClick={() => setScheduleOpen(true)}
              >
                {t("ops.checkin.settings")}
              </Button>
            </div>
          </div>
        }
      >
        {run.error && <ErrorState error={run.error} />}
        {run.data && (
          <div className="result-strip">
            <StatusBadge value={run.data.failure_count > 0 ? "failed" : "success"} />
            <span>
              {t("ops.checkinSummary", {
                success: run.data.success_count,
                failure: run.data.failure_count,
                skipped: run.data.skipped_count,
              })}
            </span>
          </div>
        )}
        {logs.isPending ? (
          <Loading />
        ) : logs.isError ? (
          <ErrorState error={logs.error} />
        ) : (
          <>
            <DataTable
              headers={[
                t("common.site"),
                t("common.status"),
                t("common.source"),
                t("ops.checkinDetail"),
                t("common.reward"),
                t("common.latency"),
                t("common.time"),
              ]}
              empty={!checkinRows.length}
            >
              {checkinPagination.pageItems.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{siteDisplayName(l.site_id, sitesById, t)}</strong>
                  </td>
                  <td>
                    <StatusBadge value={l.status} />
                  </td>
                  <td>{l.source}</td>
                  <td>
                    <span title={l.category}>{checkinDetailText(l, t)}</span>
                  </td>
                  <td>{l.reward || "-"}</td>
                  <td>{t("common.ms", { n: l.latency_ms })}</td>
                  <td>{formatDate(l.ran_at)}</td>
                </tr>
              ))}
            </DataTable>
            <PaginationBar
              page={checkinPagination.page}
              totalPages={checkinPagination.totalPages}
              total={checkinPagination.total}
              pageSize={checkinPagination.pageSize}
              rangeStart={checkinPagination.rangeStart}
              rangeEnd={checkinPagination.rangeEnd}
              hasPrev={checkinPagination.hasPrev}
              hasNext={checkinPagination.hasNext}
              onPageChange={checkinPagination.setPage}
              onPageSizeChange={checkinPagination.setPageSize}
            />
          </>
        )}
        {confirmRun ? (
          <ConfirmDialog
            title={t("ops.runEnabled")}
            message={t("ops.runEnabledConfirm")}
            confirmLabel={t("ops.runEnabled")}
            pending={run.isPending}
            error={run.error}
            onClose={() => setConfirmRun(false)}
            onConfirm={() => run.mutate()}
          />
        ) : null}
      </Panel>
      {scheduleOpen ? (
        <Dialog
          title={t("ops.checkin.scheduleTitle")}
          onClose={() => setScheduleOpen(false)}
          busy={saveSchedule.isPending}
          actions={
            <>
              <Button variant="secondary" onClick={() => setScheduleOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={!scheduleDirty || saveSchedule.isPending || scheduleDraft == null}
                onClick={() =>
                  scheduleDraft && saveSchedule.mutate(settingsFromSchedule(scheduleDraft))
                }
              >
                {saveSchedule.isPending ? t("common.working") : t("ops.checkin.scheduleSave")}
              </Button>
            </>
          }
        >
          <p className="panel-lede muted">{t("ops.checkin.scheduleLede")}</p>
          <label className="check">
            <input
              className="switch"
              type="checkbox"
              disabled={saveSchedule.isPending || scheduleDraft == null}
              checked={schedule.preset !== "off"}
              onChange={(e) => {
                if (!scheduleDraft) return;
                setScheduleDraft(
                  e.target.checked
                    ? { preset: "daily", cron: "0 8 * * *" }
                    : { preset: "off", cron: scheduleDraft.cron },
                );
              }}
            />
            <span>{t("ops.checkin.scheduleEnabled")}</span>
          </label>
          {schedule.preset !== "off" ? (
            <div className="form-grid is-spaced">
              <label className="field">
                <span>{t("ops.checkin.schedulePreset")}</span>
                <select
                  disabled={saveSchedule.isPending}
                  value={schedule.preset}
                  onChange={(e) => {
                    const preset = e.target.value as SchedulePresetId;
                    if (!scheduleDraft) return;
                    const known = SCHEDULE_PRESETS.find((item) => item.id === preset);
                    setScheduleDraft({
                      preset,
                      cron:
                        preset === "custom"
                          ? scheduleDraft.cron
                          : (known?.cron ?? scheduleDraft.cron),
                    });
                  }}
                >
                  {SCHEDULE_PRESETS.filter((item) => item.id !== "off").map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(`ops.schedule.preset.${item.id}`)}
                    </option>
                  ))}
                </select>
              </label>
              {schedule.preset === "custom" || schedule.preset === "daily" ? (
                <label className="field">
                  <span>{t("ops.checkin.scheduleCron")}</span>
                  <CheckinTimePicker
                    value={schedule.cron}
                    disabled={saveSchedule.isPending}
                    onChange={(cron) => setScheduleDraft({ preset: "custom", cron })}
                  />
                </label>
              ) : (
                <div className="field">
                  <span>{t("ops.checkin.scheduleCron")}</span>
                  <input className="mono" disabled value={schedule.cron} readOnly />
                </div>
              )}
            </div>
          ) : null}
          {runtime.data ? (
            <p className="ops-panel-context">
              <span>
                {t("ops.checkin.scheduleSource", {
                  source: t(
                    runtime.data.source === "admin_override"
                      ? "ops.runtime.sourceAdmin"
                      : "ops.runtime.sourceEnvironment",
                  ),
                })}
                {runtime.data.has_override ? "" : ` ${t("ops.checkin.scheduleEnvHint")}`}
              </span>
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}
