import { useState, type FormEvent } from "react";
import { Button, Field, TextInput } from "../components/ui";
import { useI18n } from "../i18n";
import { accountRequest } from "../team/transport";
import { teamError } from "../team/text";

export function MemberPasswordForm({
  onDisconnected,
  onBusyChange,
}: {
  onDisconnected: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { locale, t: common } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || mismatch) return;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    void accountRequest("/me/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        password,
      }),
    })
      .then(onDisconnected)
      .catch(setError)
      .finally(() => {
        setBusy(false);
        onBusyChange?.(false);
      });
  }

  return (
    <section className="operator-profile-panel">
      <form onSubmit={changePassword}>
        <fieldset disabled={busy} className="overlay-fields">
          <Field label={common("operator.currentPassword")}>
            <TextInput
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </Field>
          <Field label={common("operator.newPassword")}>
            <TextInput
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Field label={common("operator.confirmNewPassword")}>
            <TextInput
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              aria-invalid={mismatch || undefined}
            />
          </Field>
          {mismatch ? (
            <p role="alert" className="inline-error">
              {common("operator.passwordMismatch")}
            </p>
          ) : null}
        </fieldset>
        <div className="operator-claim-actions">
          <Button
            type="submit"
            loading={busy}
            disabled={busy || !currentPassword || !password || mismatch}
          >
            {common("common.save")}
          </Button>
        </div>
        {error ? (
          <p className="inline-error" role="alert">
            {teamError(error, locale)}
          </p>
        ) : null}
      </form>
    </section>
  );
}
