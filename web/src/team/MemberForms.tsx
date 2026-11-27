import { useEffect, useState, useRef, type FormEvent } from "react";
import { Input as HeroInput, TextArea as HeroTextArea } from "@heroui/react";
import {
  Button as UiButton,
  CheckboxControl,
  Dialog as UiDialog,
  InfoTip,
  SelectControl,
} from "../components/ui";
import { TeamField as Field, TeamModal } from "./ui";
import { formatCost } from "../lib/format";
import { teamError, type TeamKey, type TeamText } from "./text";
import type { ImportOutcome, Policy, TeamRequest, TeamUser } from "./types";

const CONCURRENCY_GRANT_DAYS = [7, 30, 90, 365, 0] as const;

/**
 * Per-line import failures carry a reason code; the console names each one so a
 * roster paste reports "username already taken" rather than "failed".
 */
const IMPORT_REASON: Record<string, TeamKey> = {
  invalid_username: "importReason.invalid_username",
  username_taken: "importReason.username_taken",
  invalid_quota: "importReason.invalid_quota",
  invalid_request: "importReason.invalid_request",
  password_length: "importReason.password_length",
  invalid_policy: "importReason.invalid_policy",
  save_failed: "importReason.save_failed",
};

/**
 * The three writes an operator needs when they already know who they are
 * onboarding: create one account, paste a list, or top up an existing account's
 * credit pool. Invitations remain the self-service path and live on the code
 * board.
 */

export function NewMemberDialog({
  request,
  policies,
  isOwner,
  locale,
  t,
  onClose,
  onCreated,
}: {
  request: TeamRequest;
  policies: Policy[];
  isOwner: boolean;
  locale: string;
  t: TeamText;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [policyIDs, setPolicyIDs] = useState<number[]>(policies[0] ? [policies[0].id] : []);
  const [role, setRole] = useState("member");
  useEffect(() => {
    if (policyIDs.length === 0 && policies[0]) setPolicyIDs([policies[0].id]);
  }, [policies, policyIDs.length]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await request<{ user: TeamUser; password: string }>("/admin/team/users", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          name: form.get("name"),
          password: form.get("password") ?? "",
          policy_ids: policyIDs,
          role,
          quota_tokens: Number(form.get("quota_tokens") ?? 0),
          quota_cost: Number(form.get("quota_cost") ?? 0),
        }),
      });
      const suppliedPassword = String(form.get("password") ?? "");
      setCreated({
        username: result.user.username,
        password: result.password || suppliedPassword,
      });
      onCreated();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TeamModal
      title={t("newMember")}
      onClose={onClose}
      busy={busy}
      dialogClassName="team-new-member-modal"
    >
      {created ? (
        <div className="team-credential-result">
          <p className="team-credential-hint">{t("memberCreatedHint")}</p>
          <div className="team-credential-card">
            <div className="team-credential-row">
              <span>{t("accountLabel")}</span>
              <code>{created.username}</code>
            </div>
            <div className="team-credential-row">
              <span>{t("passwordLabel")}</span>
              <code>{created.password}</code>
            </div>
          </div>
          <div className="team-actions team-modal-actions">
            <UiButton
              variant="secondary"
              onClick={() =>
                void navigator.clipboard.writeText(
                  `${t("accountLabel")}: ${created.username}\n${t("passwordLabel")}: ${created.password}`,
                )
              }
            >
              {t("copyCredentials")}
            </UiButton>
            <UiButton className="team-dialog-cancel" variant="secondary" onClick={onClose}>
              {t("close")}
            </UiButton>
          </div>
        </div>
      ) : (
        <form id="new-member" className="team-new-member-form" onSubmit={submit}>
          <div className="team-new-member-fields">
            <Field label={t("username")}>
              <HeroInput
                className="team-import-number-input"
                name="username"
                aria-label={t("username")}
                required
                minLength={3}
                maxLength={64}
                autoComplete="off"
              />
            </Field>
            <Field label={t("name")}>
              <HeroInput
                className="team-import-number-input"
                name="name"
                aria-label={t("name")}
                required
                maxLength={80}
              />
            </Field>
            <Field label={`${t("password")} · ${t("passwordOptional")}`}>
              <HeroInput
                className="team-import-number-input"
                name="password"
                aria-label={`${t("password")} · ${t("passwordOptional")}`}
                type="password"
                autoComplete="new-password"
              />
            </Field>
            <Field label={t("role")}>
              <SelectControl
                name="role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                disabled={!isOwner}
                aria-label={t("role")}
              >
                <option value="member">{t("member")}</option>
                <option value="admin">{t("admin")}</option>
              </SelectControl>
            </Field>
          </div>
          <div className="team-import-settings team-new-member-settings">
            <PolicyGroupChoices
              policies={policies}
              selected={policyIDs}
              onChange={setPolicyIDs}
              t={t}
            />
            <div className="team-import-quotas">
              <Field label={t("quotaUnit")}>
                <HeroInput
                  className="team-import-number-input"
                  name="quota_tokens"
                  aria-label={t("quotaUnit")}
                  type="number"
                  min={0}
                  step={1000}
                  defaultValue={0}
                />
              </Field>
              <Field label={t("quotaCostTotal")}>
                <HeroInput
                  className="team-import-number-input"
                  name="quota_cost"
                  aria-label={t("quotaCostTotal")}
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={0}
                  placeholder="0"
                />
              </Field>
            </div>
          </div>
          <p className="team-muted team-new-member-quota-hint">{t("quotaHint")}</p>
          {error ? (
            <div className="team-error" role="alert">
              {teamError(error, locale)}
            </div>
          ) : null}
          <div className="team-actions team-modal-actions">
            <UiButton className="team-dialog-cancel" variant="secondary" onClick={onClose}>
              {t("cancel")}
            </UiButton>
            <UiButton
              variant="primary"
              type="submit"
              loading={busy}
              disabled={policyIDs.length === 0}
            >
              {t("create")}
            </UiButton>
          </div>
        </form>
      )}
    </TeamModal>
  );
}

export function ImportMembersDialog({
  request,
  policies,
  locale,
  t,
  onClose,
  onImported,
}: {
  request: TeamRequest;
  policies: Policy[];
  locale: string;
  t: TeamText;
  onClose: () => void;
  onImported: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [policyIDs, setPolicyIDs] = useState<number[]>(policies[0] ? [policies[0].id] : []);
  useEffect(() => {
    if (policyIDs.length === 0 && policies[0]) setPolicyIDs([policies[0].id]);
  }, [policies, policyIDs.length]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await request<ImportOutcome>("/admin/team/users/import", {
        method: "POST",
        body: JSON.stringify({
          text: form.get("text"),
          policy_ids: policyIDs,
          quota_tokens: Number(form.get("quota_tokens") ?? 0),
          quota_cost: Number(form.get("quota_cost") ?? 0),
        }),
      });
      setOutcome(result);
      onImported();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const credentials = (outcome?.created ?? [])
    .map(
      (item) => `${t("accountLabel")}: ${item.username}\t${t("passwordLabel")}: ${item.password}`,
    )
    .join("\n");

  return (
    <TeamModal
      title={t("importMembers")}
      onClose={onClose}
      busy={busy}
      dialogClassName="team-import-modal"
    >
      {outcome ? (
        <>
          <p className="team-credential-hint">
            {t("importSummary", { n: outcome.created.length })}
          </p>
          {outcome.created.length ? (
            <ul className="team-credential-list">
              {outcome.created.map((item) => (
                <li key={item.id}>
                  <div className="team-credential-row">
                    <span>{t("accountLabel")}</span>
                    <code>{item.username}</code>
                  </div>
                  <div className="team-credential-row">
                    <span>{t("passwordLabel")}</span>
                    <code>{item.password}</code>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {outcome.failed.length ? (
            <>
              <p className="team-muted" style={{ marginTop: 14 }}>
                {t("importFailures", { n: outcome.failed.length })}
              </p>
              <ul className="team-import-failures">
                {outcome.failed.map((item) => (
                  <li key={`${item.line}-${item.input}`}>
                    <span className="mono">#{item.line}</span> {item.input || "—"}
                    <small>{t(IMPORT_REASON[item.reason] ?? "importReason.save_failed")}</small>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="team-actions team-modal-actions">
            <UiButton
              variant="primary"
              disabled={!outcome.created.length}
              onClick={() => void navigator.clipboard.writeText(credentials)}
            >
              {t("copyCredentials")}
            </UiButton>
            <UiButton className="team-dialog-cancel" variant="secondary" onClick={onClose}>
              {t("close")}
            </UiButton>
          </div>
        </>
      ) : (
        <form id="import-members" className="team-import-form" onSubmit={submit}>
          <Field label={t("importList")}>
            <HeroTextArea
              className="team-import-textarea"
              name="text"
              rows={10}
              required
              spellCheck={false}
              placeholder={t("importPlaceholder")}
            />
          </Field>
          <p className="team-muted">{t("importHint")}</p>
          <div className="team-import-settings">
            <PolicyGroupChoices
              policies={policies}
              selected={policyIDs}
              onChange={setPolicyIDs}
              t={t}
            />
            <div className="team-import-quotas">
              <Field label={t("quotaUnit")}>
                <HeroInput
                  className="team-import-number-input"
                  name="quota_tokens"
                  type="number"
                  min={0}
                  step={1000}
                  defaultValue={0}
                />
              </Field>
              <Field label={t("quotaCostTotal")}>
                <HeroInput
                  className="team-import-number-input"
                  name="quota_cost"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={0}
                  placeholder="0"
                />
              </Field>
            </div>
          </div>
          <p className="team-muted">{t("quotaHint")}</p>
          {error ? (
            <div className="team-error" role="alert">
              {teamError(error, locale)}
            </div>
          ) : null}
          <div className="team-actions team-modal-actions">
            <UiButton className="team-dialog-cancel" variant="secondary" onClick={onClose}>
              {t("cancel")}
            </UiButton>
            <UiButton
              variant="primary"
              type="submit"
              loading={busy}
              disabled={policyIDs.length === 0}
            >
              {t("import")}
            </UiButton>
          </div>
        </form>
      )}
    </TeamModal>
  );
}

function PolicyGroupChoices({
  policies,
  selected,
  onChange,
  t,
}: {
  policies: Policy[];
  selected: number[];
  onChange: (ids: number[]) => void;
  t: TeamText;
}) {
  return (
    <fieldset className="team-policy-choices">
      <legend>
        {t("authorizationGroups")}
        <InfoTip label={t("authorizationGroupsHint")} />
      </legend>
      {policies.map((policy) => (
        <div className="check marginless" key={policy.id}>
          <CheckboxControl
            aria-label={policy.name}
            checked={selected.includes(policy.id)}
            disabled={selected.length === 1 && selected.includes(policy.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, policy.id]
                  : selected.filter((id) => id !== policy.id),
              )
            }
          />
          <span>{policy.name}</span>
        </div>
      ))}
      {!policies.length && <p className="team-muted">{t("none")}</p>}
    </fieldset>
  );
}

export function QuotaDialog({
  request,
  user,
  locale,
  t,
  onClose,
  onSaved,
}: {
  request: TeamRequest;
  user: TeamUser;
  locale: string;
  t: TeamText;
  onClose: () => void;
  onSaved: () => void;
}) {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [total, setTotal] = useState(String(user.quota_total_tokens));
  const [costTotal, setCostTotal] = useState(
    user.quota_total_cost > 0 ? String(user.quota_total_cost) : "",
  );
  const [reset, setReset] = useState(false);

  // Blank explicitly means unlimited, matching existing quota semantics.
  // Invalid numeric input must not become null in JSON and silently preserve
  // the previous limit while telling the operator the save succeeded.
  const tokenLimit = total.trim() === "" ? 0 : Number(total);
  const moneyLimit = costTotal.trim() === "" ? 0 : Number(costTotal);
  const valid =
    Number.isSafeInteger(tokenLimit) &&
    tokenLimit >= 0 &&
    tokenLimit <= 1_000_000_000_000 &&
    Number.isFinite(moneyLimit) &&
    moneyLimit >= 0 &&
    moneyLimit <= 1_000_000;
  async function save() {
    if (!valid || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await request(`/admin/team/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          quota_total_tokens: tokenLimit,
          quota_total_cost: moneyLimit,
          quota_reset: reset,
        }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <UiDialog
      title={`${t("quota")} · ${user.name}`}
      onClose={onClose}
      busy={busy}
      className="team-quota-dialog"
      preventBackdropDismiss
      actions={
        <div className="team-quota-actions">
          <UiButton variant="secondary" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </UiButton>
          <UiButton disabled={busy || !valid} loading={busy} onClick={() => void save()}>
            {busy ? t("saving") : t("save")}
          </UiButton>
        </div>
      }
    >
      <p className="team-muted team-quota-current">
        {t("quotaUsed", {
          used: user.quota_used_tokens.toLocaleString(),
          total: user.quota_total_tokens
            ? user.quota_total_tokens.toLocaleString()
            : t("unlimited"),
        })}
        {user.quota_total_cost > 0
          ? ` · ${formatCost(user.quota_used_cost)} / ${formatCost(user.quota_total_cost)}`
          : ""}
      </p>
      <div className="team-grid team-quota-grid">
        <Field label={t("quotaUnit")}>
          <HeroInput
            type="number"
            min={0}
            step={1}
            max={1_000_000_000_000}
            aria-invalid={
              !Number.isSafeInteger(tokenLimit) || tokenLimit < 0 || tokenLimit > 1_000_000_000_000
            }
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </Field>
        <Field label={t("quotaCostTotal")}>
          <HeroInput
            type="number"
            min={0}
            step="0.01"
            max={1_000_000}
            aria-invalid={!Number.isFinite(moneyLimit) || moneyLimit < 0 || moneyLimit > 1_000_000}
            value={costTotal}
            onChange={(e) => setCostTotal(e.target.value)}
            placeholder="0"
          />
        </Field>
        <div className="team-quota-reset">
          <CheckboxControl
            checked={reset}
            onChange={(e) => setReset(e.target.checked)}
            aria-label={t("quotaResetLabel")}
          />
          <span className="team-quota-reset__copy">
            <strong>{t("quotaReset")}</strong>
            <small>{t("quotaResetLabel")}</small>
          </span>
        </div>
      </div>
      <div className="team-quota-guidance">
        <p className="team-muted">{t("quotaHint")}</p>
        <p className="team-muted">{t("quotaEditSemantics")}</p>
      </div>
      {error ? (
        <div className="team-error" role="alert">
          {teamError(error, locale)}
        </div>
      ) : null}
    </UiDialog>
  );
}

/** 将同一组 Token 与金额上限一次应用给选中的全部成员。 */
export function BulkQuotaDialog({
  request,
  ids,
  count,
  locale,
  t,
  onClose,
  onSaved,
}: {
  request: TeamRequest;
  ids: number[];
  count: number;
  locale: string;
  t: TeamText;
  onClose: () => void;
  onSaved: () => void;
}) {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tokens, setTokens] = useState("");
  const [cost, setCost] = useState("");
  const [reset, setReset] = useState(false);
  const tokenLimit = tokens.trim() === "" ? 0 : Number(tokens);
  const costLimit = cost.trim() === "" ? 0 : Number(cost);
  const valid =
    Number.isSafeInteger(tokenLimit) &&
    tokenLimit >= 0 &&
    tokenLimit <= 1_000_000_000_000 &&
    Number.isFinite(costLimit) &&
    costLimit >= 0 &&
    costLimit <= 1_000_000;

  async function save() {
    if (!valid || submitting.current || ids.length === 0) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await request("/admin/team/users/bulk", {
        method: "POST",
        body: JSON.stringify({
          ids,
          action: "quota",
          quota_total_tokens: tokenLimit,
          quota_total_cost: costLimit,
          quota_reset: reset,
        }),
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <UiDialog
      title={`${t("bulkQuota")} · ${count}`}
      onClose={onClose}
      busy={busy}
      className="team-quota-dialog"
      preventBackdropDismiss
      actions={
        <div className="team-quota-actions">
          <UiButton variant="secondary" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </UiButton>
          <UiButton disabled={busy || !valid} loading={busy} onClick={() => void save()}>
            {busy ? t("saving") : t("save")}
          </UiButton>
        </div>
      }
    >
      <p className="team-muted team-quota-current">{t("bulkQuotaDescription", { count })}</p>
      <div className="team-grid team-quota-grid">
        <Field label={t("quotaUnit")} hint={t("quotaEditSemantics")}>
          <HeroInput
            type="number"
            min={0}
            step={1}
            max={1_000_000_000_000}
            aria-invalid={
              !Number.isSafeInteger(tokenLimit) || tokenLimit < 0 || tokenLimit > 1_000_000_000_000
            }
            value={tokens}
            onChange={(event) => setTokens(event.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label={t("quotaCostTotal")}>
          <HeroInput
            type="number"
            min={0}
            step="0.01"
            max={1_000_000}
            aria-invalid={!Number.isFinite(costLimit) || costLimit < 0 || costLimit > 1_000_000}
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            placeholder="0"
          />
        </Field>
        <div className="team-quota-reset">
          <CheckboxControl
            checked={reset}
            onChange={(event) => setReset(event.target.checked)}
            aria-label={t("bulkQuotaResetLabel")}
          />
          <span className="team-quota-reset__copy">
            <strong>{t("quotaReset")}</strong>
            <small>{t("bulkQuotaResetLabel")}</small>
          </span>
        </div>
      </div>
      <div className="team-quota-guidance">
        <p className="team-muted">{t("quotaHint")}</p>
        {error ? (
          <div className="team-error" role="alert">
            {teamError(error, locale)}
          </div>
        ) : null}
      </div>
    </UiDialog>
  );
}

/** 为单个或多个成员增加并发槽，并可设置到期回收时间。 */
export function ConcurrencyDialog({
  request,
  target,
  locale,
  t,
  onClose,
  onSaved,
}: {
  request: TeamRequest;
  target: { kind: "user"; user: TeamUser } | { kind: "bulk"; ids: number[]; count: number };
  locale: string;
  t: TeamText;
  onClose: () => void;
  onSaved: () => void;
}) {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [amount, setAmount] = useState("1");
  const [validityDays, setValidityDays] = useState(7);
  const amountValue = Number(amount);
  const valid = Number.isSafeInteger(amountValue) && amountValue >= 1 && amountValue <= 10000;
  const recipient = target.kind === "user" ? target.user.name : String(target.count);

  async function save() {
    if (!valid || submitting.current || (target.kind === "bulk" && target.ids.length === 0)) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (target.kind === "user") {
        await request(`/admin/team/users/${target.user.id}/concurrency`, {
          method: "POST",
          body: JSON.stringify({ amount: amountValue, grant_validity_days: validityDays }),
        });
      } else {
        await request("/admin/team/users/bulk", {
          method: "POST",
          body: JSON.stringify({
            ids: target.ids,
            action: "concurrency",
            concurrency: amountValue,
            grant_validity_days: validityDays,
          }),
        });
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <UiDialog
      title={`${t("adjustConcurrency")} · ${recipient}`}
      onClose={onClose}
      busy={busy}
      className="team-quota-dialog team-concurrency-dialog"
      preventBackdropDismiss
      actions={
        <div className="team-quota-actions">
          <UiButton variant="secondary" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </UiButton>
          <UiButton disabled={busy || !valid} loading={busy} onClick={() => void save()}>
            {busy ? t("saving") : t("save")}
          </UiButton>
        </div>
      }
    >
      <p className="team-muted team-quota-current">
        {target.kind === "user"
          ? t("concurrencyAdjustUserHint", { current: target.user.max_concurrent })
          : t("concurrencyAdjustBulkHint", { count: target.count })}
      </p>
      <div className="team-grid team-quota-grid">
        <Field label={t("concurrencyAmount")} hint={t("concurrencyAmountHint")}>
          <HeroInput
            type="number"
            min={1}
            max={10000}
            step={1}
            value={amount}
            aria-invalid={!valid}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label={t("concurrencyValidity")} hint={t("concurrencyValidityHint")}>
          <SelectControl
            value={validityDays}
            aria-label={t("concurrencyValidity")}
            onChange={(event) => setValidityDays(Number(event.target.value))}
          >
            {CONCURRENCY_GRANT_DAYS.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? t("codeExpiryPermanent") : t("codeExpiryDays", { n: days })}
              </option>
            ))}
          </SelectControl>
        </Field>
      </div>
      {error ? (
        <div className="team-error" role="alert">
          {teamError(error, locale)}
        </div>
      ) : null}
    </UiDialog>
  );
}
