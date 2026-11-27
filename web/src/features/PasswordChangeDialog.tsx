import { useState } from "react";
import { Dialog } from "../components/ui";
import { useI18n } from "../i18n";
import { OperatorClaimPanel } from "./OperatorProfilePanel";
import { MemberPasswordForm } from "./MemberPasswordDialog";

export function PasswordChangeDialog({
  mode,
  onClose,
  onDisconnected,
}: {
  mode: "operator" | "member";
  onClose: () => void;
  onDisconnected: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      title={t("operator.title")}
      onClose={onClose}
      busy={busy}
      className="operator-claim-dialog"
    >
      {mode === "operator" ? (
        <OperatorClaimPanel onBusyChange={setBusy} onSaved={onClose} />
      ) : (
        <MemberPasswordForm onBusyChange={setBusy} onDisconnected={onDisconnected} />
      )}
    </Dialog>
  );
}
