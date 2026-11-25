import { AuditPanel } from "./ops";
import { Page } from "../components/ui";
import { useI18n } from "../i18n";

/** 管理端操作审计单独作为系统日志页面展示。 */
export function SystemLogs() {
  const { t } = useI18n();
  return (
    <Page
      title={t("logsPage.systemTitle")}
      description={t("logsPage.systemDescription")}
      hideHeading
    >
      <div className="ops-canvas system-logs-page">
        <AuditPanel />
      </div>
    </Page>
  );
}
