import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  Button,
  CheckboxControl,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Panel,
  SelectControl,
  StatusBadge,
  TextInput,
} from "../components/ui";
import { teamError, type TeamText } from "./text";
import { formatCost } from "../lib/format";
import type { MintedCode, Policy, TeamCode, TeamRequest } from "./types";

type CodeStatus = "pending" | "consumed" | "expired" | "revoked";

const EXPIRY_CHOICES = [24, 72, 168, 720, 8760, 0] as const;
const GRANT_EXPIRY_CHOICES = [0, 7, 30, 90, 365] as const;

/**
 * The code board: invitations that may be used more than once, credit
 * vouchers, and the batch generation both of them need.
 *
 * Generated codes are shown exactly once — the table stores only a hash — so
 * the mint result stays on screen, selectable and copyable as a block, until
 * the operator dismisses it. That is the only way to hand out thirty codes
 * without thirty round-trips.
 *
 * The board is a Panel whose header carries the kind filter and the mint action,
 * and its rows use the console's own table, badge and menu vocabulary — the code
 * status words (pending / used up / expired / revoked) now ride the shared badge
 * tones rather than a private colour map.
 */
export function CodePanel({
  request,
  policies,
  locale,
  t,
}: {
  request: TeamRequest;
  policies: Policy[];
  locale: string;
  t: TeamText;
}) {
  const qc = useQueryClient();
  const [minting, setMinting] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | TeamCode["kind"]>("all");
  const [mintKind, setMintKind] = useState<TeamCode["kind"]>("invite");
  const [mintExpiry, setMintExpiry] = useState(168);
  const [mintGrantValidity, setMintGrantValidity] = useState(0);
  const [mintPolicyIDs, setMintPolicyIDs] = useState<number[]>([policies[0]?.id ?? 1]);
  const [mintRole, setMintRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [minted, setMinted] = useState<MintedCode[] | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<number | null>(null);
  const [copied, setCopied] = useState("");
  const [revealTarget, setRevealTarget] = useState<TeamCode | null>(null);
  const [revealValue, setRevealValue] = useState("");
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<unknown>(null);

  const codes = useQuery({
    queryKey: ["team", "codes"],
    queryFn: ({ signal }) => request<TeamCode[]>("/admin/team/codes", { signal }),
  });

  const visible = useMemo(
    () => (codes.data ?? []).filter((c) => kindFilter === "all" || c.kind === kindFilter),
    [codes.data, kindFilter],
  );
  const hasLabels = visible.some((code) => code.label.trim() !== "");

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  }

  async function revoke(id: number) {
    setBusy(true);
    setError(null);
    try {
      await request(`/admin/team/codes/${id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["team", "codes"] });
      setRevokeTarget(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function reveal(code: TeamCode) {
    setRevealTarget(code);
    setRevealValue("");
    setRevealError(null);
    setRevealBusy(true);
    try {
      const result = await request<{ code: string }>(`/admin/team/codes/${code.id}/reveal`, {
        method: "POST",
      });
      setRevealValue(result.code);
    } catch (e) {
      setRevealError(e);
    } finally {
      setRevealBusy(false);
    }
  }

  function closeReveal() {
    setRevealTarget(null);
    setRevealValue("");
    setRevealError(null);
  }

  async function createCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await request<{ codes: MintedCode[] }>("/admin/team/codes", {
        method: "POST",
        body: JSON.stringify({
          kind: form.get("kind"),
          count: Number(form.get("count") ?? 1),
          policy_id: mintPolicyIDs[0] ?? 0,
          policy_ids: mintPolicyIDs,
          role: form.get("role") ?? "member",
          expires_in_hours: Number(form.get("expires_in_hours") ?? 24),
          grant_validity_days: Number(form.get("grant_validity_days") ?? 0),
          max_uses: Number(form.get("max_uses") ?? 1),
          quota_tokens: Number(form.get("quota_tokens") ?? 0),
          // A voucher may carry tokens, money, or both: the account pool holds two
          // budgets and the code says which one it tops up.
          quota_cost: Number(form.get("quota_cost") ?? 0),
          quota_concurrent: Number(form.get("quota_concurrent") ?? 0),
          label: form.get("label") ?? "",
          note: form.get("note") ?? "",
        }),
      });
      setMinted(result.codes);
      await qc.invalidateQueries({ queryKey: ["team", "codes"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function closeMintDialog() {
    setMinting(false);
    setMinted(null);
    setError(null);
  }

  return (
    <div className="team-board">
      <Panel
        title={t("codes")}
        titleHelp={t("codesHint")}
        actions={
          <div className="team-code-toolbar">
            <SelectControl
              aria-label={t("codeKind")}
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}
            >
              <option value="all">{t("all")}</option>
              <option value="invite">{t("codeKindInvite")}</option>
              <option value="credit">{t("codeKindCredit")}</option>
              <option value="concurrency">{t("codeKindConcurrency")}</option>
            </SelectControl>
            <Button
              type="button"
              icon={<Plus size={14} aria-hidden="true" />}
              onClick={() => {
                setError(null);
                setMinted(null);
                setMintKind("invite");
                setMintExpiry(168);
                setMintGrantValidity(0);
                setMintPolicyIDs([policies[0]?.id ?? 1]);
                setMintRole("member");
                setMinting(true);
              }}
            >
              {t("codeMint")}
            </Button>
          </div>
        }
      >
        {error && !minting && revokeTarget === null ? (
          <p className="inline-error" role="alert">
            {teamError(error, locale)}
          </p>
        ) : null}

        {codes.isPending ? (
          <p className="panel-hint">{t("load")}</p>
        ) : codes.error ? (
          <ErrorState error={codes.error} />
        ) : (
          <DataTable
            headers={[
              t("codeKind"),
              t("uses"),
              t("quota"),
              t("status"),
              ...(hasLabels ? [t("label")] : []),
              t("rowActions"),
            ]}
            empty={!visible.length}
          >
            {visible.map((code) => (
              <tr key={code.id}>
                <td>
                  {t(
                    code.kind === "invite"
                      ? "codeKindInvite"
                      : code.kind === "concurrency"
                        ? "codeKindConcurrency"
                        : "codeKindCredit",
                  )}
                </td>
                <td>
                  {code.used_count}/{code.max_uses}
                </td>
                <td>
                  {code.quota_tokens > 0 ? code.quota_tokens.toLocaleString() : "—"}
                  {(code.quota_cost ?? 0) > 0 ? <small>{formatCost(code.quota_cost)}</small> : null}
                  {code.quota_concurrent > 0 ? (
                    <small>
                      +{code.quota_concurrent} {t("codeQuotaConcurrent")}
                    </small>
                  ) : null}
                  {code.kind !== "invite" ? (
                    <small>
                      {code.grant_validity_days
                        ? t("codeGrantExpiresDays", { n: code.grant_validity_days })
                        : t("codeGrantNeverExpires")}
                    </small>
                  ) : null}
                </td>
                <td>
                  <StatusBadge value={codeStatus(code)} />
                </td>
                {hasLabels ? <td>{code.label.trim() ? code.label : null}</td> : null}
                <td className="row-actions">
                  {codeStatus(code) === "pending" ? (
                    code.revealable ? (
                      <Button variant="quiet" onClick={() => void reveal(code)} disabled={busy}>
                        {t("codeView")}
                      </Button>
                    ) : (
                      <small className="team-code-view-unavailable">
                        {t("codeViewUnavailable")}
                      </small>
                    )
                  ) : null}
                  {code.revoked ? null : (
                    <Button
                      variant="quiet"
                      className="team-code-revoke-action"
                      style={{
                        color: "#c62828",
                        background: "transparent",
                        borderColor: "transparent",
                        boxShadow: "none",
                      }}
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setRevokeTarget(code.id);
                      }}
                    >
                      {t("revoke")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      {minting ? (
        <Dialog
          title={minted ? t("codeMinted", { n: minted.length }) : t("codeMint")}
          className="team-code-mint-dialog"
          busy={busy}
          onClose={closeMintDialog}
          actions={
            minted ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => void copy(minted.map((item) => item.code).join("\n"), "all")}
                >
                  {copied === "all" ? t("copied") : t("copyAll")}
                </Button>
                <Button variant="quiet" onClick={closeMintDialog}>
                  {t("close")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="quiet" disabled={busy} onClick={closeMintDialog}>
                  {t("cancel")}
                </Button>
                <Button type="submit" form="team-code-mint-form" loading={busy}>
                  {t("codeMint")}
                </Button>
              </>
            )
          }
        >
          {minted ? (
            <div className="team-minted">
              <p className="panel-hint">{t("codeMintedOnce")}</p>
              <ul className="team-minted-list">
                {minted.map((item) => (
                  <li key={item.id}>
                    <code>{item.code}</code>
                    <Button variant="quiet" onClick={() => void copy(item.code, String(item.id))}>
                      {copied === String(item.id) ? t("copied") : t("copy")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <form id="team-code-mint-form" className="team-mint-form" onSubmit={createCodes}>
              <div className="meta-form">
                <Field label={t("codeKind")}>
                  <SelectControl
                    name="kind"
                    aria-label={t("codeKind")}
                    value={mintKind}
                    onChange={(event) => setMintKind(event.target.value as TeamCode["kind"])}
                  >
                    <option value="invite">{t("codeKindInvite")}</option>
                    <option value="credit">{t("codeKindCredit")}</option>
                    <option value="concurrency">{t("codeKindConcurrency")}</option>
                  </SelectControl>
                </Field>
                <Field label={t("codeCount")}>
                  <TextInput name="count" type="number" min={1} max={500} defaultValue={1} />
                </Field>
                <Field label={t("codeMaxUses")}>
                  <TextInput name="max_uses" type="number" min={1} max={100000} defaultValue={1} />
                </Field>
                <Field label={t("codeExpiry")} hint={t("codeExpiryHint")}>
                  <SelectControl
                    name="expires_in_hours"
                    value={mintExpiry}
                    onChange={(event) => setMintExpiry(Number(event.target.value))}
                  >
                    {EXPIRY_CHOICES.map((hours) => (
                      <option key={hours} value={hours}>
                        {hours === 0
                          ? t("codeExpiryPermanent")
                          : t("codeExpiryDays", { n: hours / 24 })}
                      </option>
                    ))}
                  </SelectControl>
                </Field>
                {mintKind === "concurrency" ? (
                  <Field label={t("codeQuotaConcurrent")}>
                    <TextInput
                      name="quota_concurrent"
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      defaultValue={1}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label={t("codeQuota")}>
                      <TextInput
                        name="quota_tokens"
                        type="number"
                        min={0}
                        step={1000}
                        defaultValue={0}
                      />
                    </Field>
                    <Field label={t("codeQuotaCost")}>
                      <TextInput
                        name="quota_cost"
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={0}
                        placeholder="0"
                      />
                    </Field>
                  </>
                )}
                {mintKind !== "invite" ? (
                  <Field label={t("codeGrantExpiry")} hint={t("codeGrantExpiryHint")}>
                    <SelectControl
                      name="grant_validity_days"
                      value={mintGrantValidity}
                      onChange={(event) => setMintGrantValidity(Number(event.target.value))}
                    >
                      {GRANT_EXPIRY_CHOICES.map((days) => (
                        <option key={days} value={days}>
                          {days === 0 ? t("codeExpiryPermanent") : t("codeExpiryDays", { n: days })}
                        </option>
                      ))}
                    </SelectControl>
                  </Field>
                ) : null}
                {mintKind === "invite" ? (
                  <>
                    <fieldset className="team-policy-choices">
                      <legend>{t("authorizationGroups")}</legend>
                      {policies.map((policy) => (
                        <div className="check marginless" key={policy.id}>
                          <CheckboxControl
                            aria-label={policy.name}
                            checked={mintPolicyIDs.includes(policy.id)}
                            disabled={
                              mintPolicyIDs.length === 1 && mintPolicyIDs.includes(policy.id)
                            }
                            onChange={(event) =>
                              setMintPolicyIDs((selected) =>
                                event.target.checked
                                  ? [...selected, policy.id]
                                  : selected.filter((id) => id !== policy.id),
                              )
                            }
                          />
                          <span>{policy.name}</span>
                        </div>
                      ))}
                    </fieldset>
                    <Field label={t("role")}>
                      <SelectControl
                        name="role"
                        value={mintRole}
                        onChange={(event) => setMintRole(event.target.value)}
                      >
                        <option value="member">{t("member")}</option>
                        <option value="admin">{t("admin")}</option>
                      </SelectControl>
                    </Field>
                    <Field label={t("label")}>
                      <TextInput name="label" maxLength={80} placeholder={t("codeLabelHint")} />
                    </Field>
                  </>
                ) : null}
              </div>
              <p className="panel-hint">{t("codeFormHint")}</p>
              {error ? (
                <p className="inline-error" role="alert">
                  {teamError(error, locale)}
                </p>
              ) : null}
            </form>
          )}
        </Dialog>
      ) : null}
      {revealTarget ? (
        <Dialog
          title={t("codeViewTitle")}
          className="team-code-mint-dialog"
          busy={revealBusy}
          onClose={closeReveal}
          actions={
            <>
              <Button variant="quiet" disabled={revealBusy} onClick={closeReveal}>
                {t("close")}
              </Button>
              {revealValue ? (
                <Button
                  variant="secondary"
                  onClick={() => void copy(revealValue, "revealed")}
                  disabled={revealBusy}
                >
                  {copied === "revealed" ? t("copied") : t("copy")}
                </Button>
              ) : null}
            </>
          }
        >
          {revealBusy ? (
            <p role="status" className="panel-hint">
              {t("load")}
            </p>
          ) : revealError ? (
            <ErrorState error={revealError} />
          ) : (
            <div className="team-code-reveal">
              <code>{revealValue}</code>
              <p className="panel-hint">{t("codeViewHint")}</p>
            </div>
          )}
        </Dialog>
      ) : null}
      {revokeTarget !== null ? (
        <ConfirmDialog
          title={t("revoke")}
          message={t("codeRevokeWarning")}
          confirmLabel={t("revoke")}
          pending={busy}
          error={error}
          onConfirm={() => void revoke(revokeTarget)}
          onClose={() => {
            setRevokeTarget(null);
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** spent/expired/revoked are the three states an operator must tell apart. */
function codeStatus(code: TeamCode): CodeStatus {
  if (code.revoked) return "revoked";
  if (code.used_count >= code.max_uses) return "consumed";
  if (code.expires_at > 0 && code.expires_at * 1000 < Date.now()) return "expired";
  return "pending";
}
