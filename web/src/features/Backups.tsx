import { Page } from "../components/ui";
import { useI18n } from "../i18n";
import { BackupsPanel } from "./ops";

/** 备份工作区独立成页，供「备份/拓展」一级导航承载。 */
export function Backups() {
  const { t } = useI18n();
  return (
    <Page title={t("ops.tab.backups")} description={t("ops.backups.titleHelp")}>
      <div className="ops-canvas">
        <BackupsPanel />
      </div>
    </Page>
  );
}
