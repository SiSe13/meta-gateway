import { OperatorClaimPanel } from "./OperatorProfilePanel";
import { Navigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { Page } from "../components/ui";
import { RuntimeSettingsPanel } from "./ops";
import { useSession } from "../session";

/**
 * System settings keep one page of runtime parameters. Their own rail supplies
 * the setting sections; appearance and account controls live in the avatar
 * menu, and backup management has a route in the backup/extensions workspace.
 */
export function Maintain() {
  const { t } = useI18n();
  const { role } = useSession();
  const [params] = useSearchParams();
  const requested = params.get("tab");

  // Legacy deep-links (after hooks).
  if (requested === "appearance") {
    // Appearance is now opened from the avatar menu, not as a settings tab.
    return <Navigate to="/" replace />;
  }
  if (requested === "backups") {
    return <Navigate to="/backups" replace />;
  }
  if (requested === "operator" && role !== null && role !== "owner") {
    return <Navigate to="/settings?tab=runtime" replace />;
  }
  if (requested === "mode") {
    return <Navigate to="/settings?tab=runtime" replace />;
  }
  if (requested === "discovery") {
    return <Navigate to="/logs?tab=discovery" replace />;
  }
  if (requested === "audit") {
    return <Navigate to="/system-logs" replace />;
  }
  if (requested === "checkins") {
    return <Navigate to="/checkins" replace />;
  }
  if (requested === "exchange") {
    return <Navigate to="/exchange" replace />;
  }

  const showOperatorAccount = requested === "operator" && (role === null || role === "owner");
  return (
    <Page
      title={showOperatorAccount ? t("operator.title") : t("maintain.title")}
      description={t("maintain.description")}
      hideHeading={!showOperatorAccount}
    >
      <div className="ops-canvas">
        {/* Keep the runtime draft mounted while an avatar menu opens the hidden
            account page on this same route, so its local edits are not dropped. */}
        <div hidden={showOperatorAccount}>
          <RuntimeSettingsPanel />
        </div>
        {showOperatorAccount ? <OperatorClaimPanel /> : null}
      </div>
    </Page>
  );
}
