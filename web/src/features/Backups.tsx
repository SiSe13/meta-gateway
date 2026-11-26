import { Page } from "../components/ui";
import { BackupsPanel } from "./ops";

/** 备份工作区独立成页，供「备份/拓展」一级导航承载。 */
export function Backups() {
  return (
    <Page title="" description="" hideHeading>
      <div className="ops-canvas">
        <BackupsPanel />
      </div>
    </Page>
  );
}
