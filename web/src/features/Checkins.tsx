import { useI18n } from "../i18n";
import { Page } from "../components/ui";
import { CheckinsPanel } from "./ops";

/**
 * Top-level check-in surface for the built-in scheduler and its history.
 */
export function Checkins() {
  const { t } = useI18n();

  return (
    <Page title={t("checkinsPage.title")} description={t("checkinsPage.description")}>
      <div className="ops-canvas">
        <CheckinsPanel />
      </div>
    </Page>
  );
}
