import { Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import type { AuditEvent } from "../../api/types";
import { useClientPagination } from "../../hooks/useClientPagination";
import { useI18n } from "../../i18n";
import { useSession } from "../../session";
import { PaginationBar } from "../../components/PaginationBar";
import {
  Button,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Loading,
  Panel,
  StatusBadge,
  formatDate,
} from "../../components/ui";

export function auditActionLabel(action: string, t: (key: string) => string) {
  const key = `systemLogs.action.${action}`;
  const translated = t(key);
  if (translated !== key) return translated;

  const parts = action.split(".").filter((part) => part !== "admin");
  const verb = parts.pop();
  const resource = parts.map((part) => t(`systemLogs.part.${part}`));
  const verbLabel = verb ? t(`systemLogs.part.${verb}`) : "";
  const knownParts = resource.every((part) => !part.startsWith("systemLogs.part."));
  if (knownParts && !verbLabel.startsWith("systemLogs.part.")) {
    return `${verbLabel}${resource.length ? `：${resource.join(" / ")}` : ""}`;
  }
  return action;
}

/** 将审计接口的失败状态映射到界面统一使用的失败徽标。 */
export function auditOutcomeStatus(outcome: string) {
  return outcome === "failure" ? "failed" : outcome;
}

function auditResourceLabel(event: AuditEvent, t: (key: string) => string) {
  if (!event.resource_kind) return t("systemLogs.noResource");
  const key = `systemLogs.resource.${event.resource_kind}`;
  const translated = t(key);
  const resource = translated === key ? event.resource_kind : translated;
  return event.resource_id ? `${resource} #${event.resource_id}` : resource;
}

function auditActorLabel(event: AuditEvent, t: (key: string) => string) {
  const key = `systemLogs.actor.${event.actor_kind}`;
  const translated = t(key);
  const actor = translated === key ? event.actor_kind : translated;
  return event.actor_id ? `${actor} #${event.actor_id}` : actor;
}

function auditCategoryLabel(category: string | undefined, t: (key: string) => string) {
  if (!category) return t("systemLogs.noFailureReason");
  const key = `systemLogs.category.${category}`;
  const translated = t(key);
  return translated === key ? category : translated;
}

function statusExplanation(status: number, t: (key: string) => string) {
  if (status >= 200 && status < 300) return t("systemLogs.status.success");
  if (status === 401 || status === 403) return t("systemLogs.status.permission");
  if (status === 404) return t("systemLogs.status.notFound");
  if (status === 409) return t("systemLogs.status.conflict");
  if (status === 429) return t("systemLogs.status.rateLimited");
  if (status >= 500) return t("systemLogs.status.serverError");
  if (status >= 400) return t("systemLogs.status.requestError");
  return t("systemLogs.status.other");
}

export function AuditPanel() {
  const { client } = useSession();
  const { t } = useI18n();
  const s = api(client!);
  const qc = useQueryClient();
  const [before, setBefore] = useState<number | undefined>();
  const [confirm, setConfirm] = useState(false);
  const [cleanedCount, setCleanedCount] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["audit", before],
    queryFn: ({ signal }) => s.auditEvents(before, signal),
  });
  const cleanup = useMutation({
    mutationFn: s.cleanupAudit,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["audit"] });
      setCleanedCount(result.removed);
      setConfirm(false);
    },
  });
  const auditRows = q.data ?? [];
  const auditPagination = useClientPagination(auditRows, 15);
  return (
    <Panel
      actions={
        <Button
          variant="secondary"
          icon={<Trash2 size={16} />}
          onClick={() => {
            setCleanedCount(null);
            setConfirm(true);
          }}
        >
          {t("systemLogs.cleanupButton")}
        </Button>
      }
    >
      {cleanedCount !== null ? (
        <p className="system-logs-cleanup-result" role="status">
          {t("systemLogs.cleanupSuccess", { count: cleanedCount })}
        </p>
      ) : null}
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <>
          <DataTable
            headers={[
              t("systemLogs.column.action"),
              t("systemLogs.column.actor"),
              t("systemLogs.column.target"),
              t("systemLogs.column.result"),
              t("systemLogs.column.httpStatus"),
              t("systemLogs.column.reason"),
              t("common.time"),
            ]}
            empty={!auditRows.length}
          >
            {auditPagination.pageItems.map((e) => (
              <tr key={e.id}>
                <td>
                  <strong title={e.action}>{auditActionLabel(e.action, t)}</strong>
                </td>
                <td>{auditActorLabel(e, t)}</td>
                <td>{auditResourceLabel(e, t)}</td>
                <td>
                  <StatusBadge value={auditOutcomeStatus(e.outcome)} />
                </td>
                <td title={statusExplanation(e.status_code, t)}>
                  <span className="system-logs-http-status">HTTP {e.status_code}</span>
                  <small>{statusExplanation(e.status_code, t)}</small>
                </td>
                <td>{auditCategoryLabel(e.category, t)}</td>
                <td>{formatDate(e.created_at)}</td>
              </tr>
            ))}
          </DataTable>
          <PaginationBar
            page={auditPagination.page}
            totalPages={auditPagination.totalPages}
            total={auditPagination.total}
            pageSize={auditPagination.pageSize}
            rangeStart={auditPagination.rangeStart}
            rangeEnd={auditPagination.rangeEnd}
            hasPrev={auditPagination.hasPrev}
            hasNext={auditPagination.hasNext}
            onPageChange={auditPagination.setPage}
            onPageSizeChange={auditPagination.setPageSize}
          />
          {q.data.length === 100 && (
            <Button variant="secondary" onClick={() => setBefore(q.data.at(-1)?.id)}>
              {t("ops.olderEvents")}
            </Button>
          )}
          {before && (
            <Button variant="quiet" onClick={() => setBefore(undefined)}>
              {t("ops.newestEvents")}
            </Button>
          )}
        </>
      )}
      {confirm && (
        <ConfirmDialog
          title={t("systemLogs.cleanupTitle")}
          className="system-logs-cleanup-dialog"
          message={t("systemLogs.cleanupMessage")}
          confirmLabel={t("systemLogs.cleanupConfirm")}
          pending={cleanup.isPending}
          error={cleanup.error}
          onClose={() => setConfirm(false)}
          onConfirm={() => cleanup.mutate()}
        />
      )}
    </Panel>
  );
}
