import { useEffect, useId, useState } from "react";
import { Button as HeroButton, SearchField } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Search, UserRoundPlus } from "lucide-react";
import { TeamField as Field } from "../ui";
import { formatCost } from "../../lib/format";
import {
  Button,
  CheckboxControl,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorState,
  Loading,
  SelectControl,
  StatusBadge,
  formatDate,
  TextInput,
} from "../../components/ui";
import { useConfirm } from "../../components/ConfirmProvider";
import {
  BulkQuotaDialog,
  ConcurrencyDialog,
  ImportMembersDialog,
  NewMemberDialog,
  QuotaDialog,
} from "../MemberForms";
import { teamError } from "../text";
import { useTeamMutation } from "../useTeamMutation";
import { useUsers } from "../UsersContext";
import type { BulkMemberAction, OAuthBinding, Policy, TeamUser, UserKey } from "../types";

/**
 * Members: the roster, one member in detail, and the bulk actions over a
 * selection.
 *
 * The roster is the only board an admin (non-owner) gets, so the owner-only
 * controls are absent here rather than disabled: an admin who cannot change a
 * group should not be shown a group picker that does nothing.
 */
export function MembersPanel() {
  const { request, locale, t, owner, settings } = useUsers();
  const confirm = useConfirm();
  const enabled = settings.mode === "team";
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["team"] });
  const { busy, error, notice, setNotice, run } = useTeamMutation(request, t);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TeamUser | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [newMember, setNewMember] = useState(false);
  const [importing, setImporting] = useState(false);
  const [quotaFor, setQuotaFor] = useState<TeamUser | null>(null);
  const [concurrencyTarget, setConcurrencyTarget] = useState<
    { kind: "user"; user: TeamUser } | { kind: "bulk" } | null
  >(null);
  const [bulkQuotaOpen, setBulkQuotaOpen] = useState(false);
  const [revokeFor, setRevokeFor] = useState<TeamUser | null>(null);
  const [bulkPolicies, setBulkPolicies] = useState<number[]>([]);
  const [copyMessage, setCopyMessage] = useState("");

  const users = useQuery({
    queryKey: ["team", "users"],
    queryFn: ({ signal }) => request<TeamUser[]>("/admin/team/users", { signal }),
  });
  const policies = useQuery({
    queryKey: ["team", "policies"],
    queryFn: ({ signal }) => request<Policy[]>("/admin/team/policies", { signal }),
  });
  const userKeys = useQuery({
    queryKey: ["team", "user-keys", selected?.id],
    queryFn: ({ signal }) =>
      request<UserKey[]>(`/admin/team/users/${selected!.id}/keys`, { signal }),
    enabled: !!selected,
  });
  const bindings = useQuery({
    queryKey: ["team", "identities", selected?.id],
    queryFn: ({ signal }) =>
      request<OAuthBinding[]>(`/admin/team/users/${selected!.id}/identities`, { signal }),
    enabled: !!selected,
  });

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(t("copied"));
    } catch {
      setCopyMessage(t("copyDenied"));
    }
  }

  async function bulk(action: BulkMemberAction, policyIDs?: number[]) {
    const ids = [...checked];
    if (!ids.length) return;
    const done = await run("/admin/team/users/bulk", "POST", {
      ids,
      action,
      ...(policyIDs ? { policy_ids: policyIDs } : {}),
    });
    if (done === undefined) return;
    setChecked(new Set());
    setBulkPolicies([]);
  }

  const visibleUsers = (users.data ?? []).filter((u) =>
    `${u.name} ${u.username}`.toLowerCase().includes(search.toLowerCase()),
  );
  const queryError = users.error || policies.error;
  const policyNames = (ids: number[]) =>
    ids.map((id) => ({
      id,
      name: policies.data?.find((policy) => policy.id === id)?.name ?? `#${id}`,
    }));

  return (
    <section className="team-user-roster">
      {Boolean(error || queryError) && (
        <div role="alert" className="team-error">
          {teamError(error || queryError, locale)}
        </div>
      )}
      {notice && (
        <div role="status" className="team-notice">
          {notice.startsWith("http") || notice.startsWith("/") ? (
            <>
              <p>{t("linkOnce")}</p>
              <code>{notice}</code>{" "}
              <HeroButton
                variant="outline"
                className="team-button"
                type="button"
                onPress={() => void copy(notice)}
              >
                {t("copy")}
              </HeroButton>
              <small>{copyMessage}</small>
            </>
          ) : (
            notice
          )}
        </div>
      )}
      {/* The roster stays mounted: the drawer edits one member beside the list
          they were found in, instead of replacing the page they were on. */}
      <>
        <header className="team-roster-header">
          <div className="team-roster-controls">
            <SearchField
              className="team-roster-search"
              value={search}
              onChange={setSearch}
              aria-label={t("search")}
            >
              <SearchField.Group>
                <SearchField.SearchIcon>
                  <Search size={16} aria-hidden="true" />
                </SearchField.SearchIcon>
                <SearchField.Input placeholder={t("search")} />
                <SearchField.ClearButton aria-label={t("clearSearch")} />
              </SearchField.Group>
            </SearchField>
            <Button
              variant="secondary"
              className="team-roster-action team-roster-action--import"
              icon={<FileUp size={16} aria-hidden="true" />}
              disabled={!enabled}
              onClick={() => setImporting(true)}
            >
              {t("importMembers")}
            </Button>
            <Button
              className="team-roster-action team-roster-action--new"
              icon={<UserRoundPlus size={16} aria-hidden="true" />}
              disabled={!enabled}
              onClick={() => setNewMember(true)}
            >
              {t("newMember")}
            </Button>
          </div>
        </header>
        {checked.size > 0 && (
          <BulkBar
            count={checked.size}
            policies={policies.data ?? []}
            owner={owner}
            busy={busy}
            policyIDs={bulkPolicies}
            onPolicyIDs={setBulkPolicies}
            onRun={bulk}
            onQuota={() => setBulkQuotaOpen(true)}
            onConcurrency={() => setConcurrencyTarget({ kind: "bulk" })}
            onClear={() => setChecked(new Set())}
          />
        )}
        {users.isPending ? (
          <p>{t("load")}</p>
        ) : (
          <DataTable
            headers={[
              <CheckboxControl
                key="all"
                aria-label={t("selectAll")}
                checked={visibleUsers.length > 0 && visibleUsers.every((u) => checked.has(u.id))}
                onChange={(e) =>
                  setChecked(
                    e.target.checked
                      ? new Set(visibleUsers.filter((u) => u.role !== "owner").map((u) => u.id))
                      : new Set(),
                  )
                }
              />,
              t("name"),
              t("role"),
              t("authorizationGroups"),
              t("status"),
              t("budgetColumn"),
              t("maxConcurrent"),
              t("activityTime"),
              t("keyCount"),
              t("rowActions"),
            ]}
            empty={visibleUsers.length === 0}
          >
            {visibleUsers.map((u) => {
              const groups = policyNames(u.policy_ids);
              return (
                <tr key={u.id} className={checked.has(u.id) ? "is-selected" : undefined}>
                  <td>
                    <CheckboxControl
                      aria-label={t("selectMember", { name: u.name })}
                      disabled={u.role === "owner"}
                      checked={checked.has(u.id)}
                      onChange={(e) => {
                        const next = new Set(checked);
                        if (e.target.checked) next.add(u.id);
                        else next.delete(u.id);
                        setChecked(next);
                      }}
                    />
                  </td>
                  <td>
                    {/* The name is what an operator says out loud; the login is
                        how the account actually signs in. Both belong here. */}
                    <span className="member-ident">
                      <span className="member-avatar" aria-hidden="true">
                        {(u.name || u.username || "?").trim().slice(0, 1).toUpperCase()}
                      </span>
                      <span className="member-ident-text">
                        <strong>{u.name}</strong>
                        <small>{u.username}</small>
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-role-${u.role}`}>{t(u.role)}</span>
                  </td>
                  <td>
                    <span className="team-user-policies">
                      {groups.length ? (
                        groups.map((policy) => (
                          <span className="team-user-policy" key={policy.id}>
                            {policy.name}
                          </span>
                        ))
                      ) : (
                        <span className="team-user-policy-empty">—</span>
                      )}
                    </span>
                  </td>
                  <td>
                    <StatusBadge value={u.status} />
                  </td>
                  <td>
                    <QuotaCell user={u} owner={owner} onEdit={() => setQuotaFor(u)} />
                  </td>
                  <td>
                    <span className="team-concurrency-limit">{u.max_concurrent}</span>
                  </td>
                  <td>
                    <span className="member-activity-times">
                      {u.last_login_at ? (
                        <span>
                          <small>{t("lastLogin")}</small>
                          <time>{formatDate(u.last_login_at)}</time>
                        </span>
                      ) : null}
                      {u.last_model_call_at ? (
                        <span>
                          <small>{t("lastModelCall")}</small>
                          <time>{formatDate(u.last_model_call_at)}</time>
                        </span>
                      ) : null}
                      {!u.last_login_at && !u.last_model_call_at ? <time>—</time> : null}
                    </span>
                  </td>
                  <td>{u.key_count}</td>
                  <td className="row-actions team-member-actions">
                    <div className="team-member-action-group">
                      <Button
                        variant="quiet"
                        className="team-member-action team-member-action--edit"
                        onClick={() => setSelected(u)}
                      >
                        {t("edit")}
                      </Button>
                      {owner ? (
                        <>
                          <Button
                            variant="quiet"
                            className="team-member-action team-member-action--quota"
                            onClick={() => setQuotaFor(u)}
                          >
                            {t("editQuota")}
                          </Button>
                          <Button
                            variant="quiet"
                            className="team-member-action team-member-action--concurrency"
                            onClick={() => setConcurrencyTarget({ kind: "user", user: u })}
                          >
                            {t("concurrencyAction")}
                          </Button>
                          {u.role !== "owner" ? (
                            <Button
                              variant="quiet"
                              className="team-member-action team-member-action--revoke"
                              disabled={busy}
                              onClick={() => setRevokeFor(u)}
                            >
                              {t("revokeSessions")}
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </>
      {selected ? (
        <MemberDetail
          key={selected.id}
          user={selected}
          policies={policies.data ?? []}
          keys={userKeys.data}
          keysPending={userKeys.isPending}
          keysError={userKeys.error}
          bindings={bindings.data}
          owner={owner}
          busy={busy}
          onBack={() => setSelected(null)}
          onSave={(body) =>
            void run(`/admin/team/users/${selected.id}`, "PATCH", body, () => setSelected(null))
          }
          onRevoke={() => setRevokeFor(selected)}
          onRecovery={() =>
            void run<{ path: string }>(
              `/admin/team/users/${selected.id}/recovery`,
              "POST",
              {},
              (d) => setNotice(new URL(d.path, location.origin).href),
            )
          }
          onUnlink={(bindingID) => {
            void confirm({
              title: t("oauthUnlinkTitle"),
              message: t("oauthUnlinkWarning"),
              confirmLabel: t("unlink"),
              danger: true,
            }).then((accepted) => {
              if (accepted)
                void run(`/admin/team/users/${selected.id}/identities/${bindingID}`, "DELETE");
            });
          }}
        />
      ) : null}
      {newMember && (
        <NewMemberDialog
          request={request}
          policies={policies.data ?? []}
          isOwner={owner}
          locale={locale}
          t={t}
          onClose={() => setNewMember(false)}
          onCreated={refresh}
        />
      )}
      {importing && (
        <ImportMembersDialog
          request={request}
          policies={policies.data ?? []}
          locale={locale}
          t={t}
          onClose={() => setImporting(false)}
          onImported={refresh}
        />
      )}
      {quotaFor && (
        <QuotaDialog
          request={request}
          user={quotaFor}
          locale={locale}
          t={t}
          onClose={() => setQuotaFor(null)}
          onSaved={refresh}
        />
      )}
      {bulkQuotaOpen && owner ? (
        <BulkQuotaDialog
          request={request}
          ids={[...checked]}
          count={checked.size}
          locale={locale}
          t={t}
          onClose={() => setBulkQuotaOpen(false)}
          onSaved={() => {
            refresh();
            setChecked(new Set());
            setBulkPolicies([]);
          }}
        />
      ) : null}
      {concurrencyTarget && owner ? (
        <ConcurrencyDialog
          request={request}
          target={
            concurrencyTarget.kind === "bulk"
              ? { kind: "bulk", ids: [...checked], count: checked.size }
              : concurrencyTarget
          }
          locale={locale}
          t={t}
          onClose={() => setConcurrencyTarget(null)}
          onSaved={() => {
            refresh();
            if (concurrencyTarget.kind === "bulk") {
              setChecked(new Set());
              setBulkPolicies([]);
            }
          }}
        />
      ) : null}
      {revokeFor && (
        <ConfirmDialog
          title={t("revokeSessionsConfirmTitle")}
          message={t("revokeSessionsConfirmMessage", { name: revokeFor.name })}
          confirmLabel={t("revokeSessions")}
          className="team-revoke-sessions-dialog"
          pending={busy}
          error={error}
          onClose={() => setRevokeFor(null)}
          onConfirm={() =>
            void run<{ ok: boolean }>(
              `/admin/team/users/${revokeFor.id}/revoke-sessions`,
              "POST",
              {},
              () => setRevokeFor(null),
            )
          }
        />
      )}
    </section>
  );
}

/**
 * The member table's credit cell: the same meters every other pool uses, made
 * clickable for an operator who may change the ceiling.
 */
function QuotaCell({
  user,
  owner,
  onEdit,
}: {
  user: TeamUser;
  owner: boolean;
  onEdit: () => void;
}) {
  const { t } = useUsers();
  const costTotal = user.quota_total_cost;
  const costRemaining = Math.max(0, costTotal - user.quota_used_cost);
  const tokenTotal = user.quota_total_tokens;
  const tokenRemaining = Math.max(0, tokenTotal - user.quota_used_tokens);
  const bothUnlimited = costTotal <= 0 && tokenTotal <= 0;
  const content = bothUnlimited ? (
    <span className="quota-unlimited">{t("unlimited")}</span>
  ) : (
    <span className="team-quota-summary">
      <span className="team-quota-line team-quota-line--cost">
        <span>{t("quotaMoneyLabel")}</span>
        <strong>{costTotal > 0 ? formatCost(costTotal) : t("unlimited")}</strong>
        <small>
          {t("creditRemaining")}: {costTotal > 0 ? formatCost(costRemaining) : t("unlimited")}
        </small>
      </span>
      <span className="team-quota-line team-quota-line--tokens">
        <span>{t("quotaTokensLabel")}</span>
        <strong>{tokenTotal > 0 ? tokenTotal.toLocaleString() : t("unlimited")}</strong>
        <small>
          {t("creditRemaining")}:{" "}
          {tokenTotal > 0 ? tokenRemaining.toLocaleString() : t("unlimited")}
        </small>
      </span>
    </span>
  );
  if (!owner) return content;
  return (
    <Button className="team-quota-edit" type="button" onClick={onEdit}>
      {content}
    </Button>
  );
}

function BulkBar({
  count,
  policies,
  owner,
  busy,
  policyIDs,
  onPolicyIDs,
  onRun,
  onQuota,
  onConcurrency,
  onClear,
}: {
  count: number;
  policies: Policy[];
  owner: boolean;
  busy: boolean;
  policyIDs: number[];
  onPolicyIDs: (value: number[]) => void;
  onRun: (action: BulkMemberAction, policyIDs?: number[]) => void;
  onQuota: () => void;
  onConcurrency: () => void;
  onClear: () => void;
}) {
  const { t } = useUsers();
  const confirm = useConfirm();
  return (
    <div className="team-bulkbar" role="region" aria-label={t("bulkActions")}>
      <strong className="team-bulkbar-count">{t("bulkSelected", { n: count })}</strong>
      <div className="team-actions">
        {owner ? (
          <>
            <HeroButton
              variant="outline"
              className="team-button team-bulk-action"
              type="button"
              isDisabled={busy}
              onPress={onQuota}
            >
              {t("bulkQuota")}
            </HeroButton>
            <HeroButton
              variant="outline"
              className="team-button team-bulk-action"
              type="button"
              isDisabled={busy}
              onPress={onConcurrency}
            >
              {t("adjustConcurrency")}
            </HeroButton>
            <div
              className="team-bulk-policy-picker"
              role="group"
              aria-label={t("authorizationGroups")}
            >
              {policies.map((p) => (
                <div className="team-bulk-policy" key={p.id}>
                  <CheckboxControl
                    aria-label={p.name}
                    checked={policyIDs.includes(p.id)}
                    onChange={(event) =>
                      onPolicyIDs(
                        event.target.checked
                          ? [...policyIDs, p.id]
                          : policyIDs.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
            <HeroButton
              variant="outline"
              className="team-button team-bulk-apply"
              type="button"
              isDisabled={busy || !policyIDs.length}
              onPress={() => onRun("policy", policyIDs)}
            >
              {t("applyBulk")}
            </HeroButton>
            <HeroButton
              variant="outline"
              className="team-button team-bulk-action"
              type="button"
              isDisabled={busy}
              onPress={() => onRun("pause")}
            >
              {t("pause")}
            </HeroButton>
            <HeroButton
              variant="outline"
              className="team-button team-bulk-action"
              type="button"
              isDisabled={busy}
              onPress={() => onRun("resume")}
            >
              {t("resume")}
            </HeroButton>
            <HeroButton
              variant="danger-soft"
              className="team-button danger team-bulk-delete"
              type="button"
              isDisabled={busy}
              onPress={() => {
                void confirm({
                  title: t("bulkDeleteTitle"),
                  message: t("bulkDeleteWarning", { n: count }),
                  confirmLabel: t("delete"),
                  danger: true,
                }).then((accepted) => {
                  if (accepted) onRun("delete");
                });
              }}
            >
              {t("delete")}
            </HeroButton>
          </>
        ) : (
          <HeroButton
            variant="outline"
            className="team-button team-bulk-action"
            type="button"
            isDisabled={busy}
            onPress={() => onRun("revoke_sessions")}
          >
            {t("revokeSessions")}
          </HeroButton>
        )}
        <HeroButton
          variant="ghost"
          className="team-button quiet team-bulk-clear"
          type="button"
          onPress={onClear}
        >
          {t("clearSelection")}
        </HeroButton>
      </div>
    </div>
  );
}

/**
 * One member in full: their account fields, the keys they own, and the
 * third-party identities bound to the account.
 *
 * The credit fields live in the account form (see the quota section) because
 * granting credit is part of creating or editing a member — it was previously
 * only reachable from a small button back on the list, which is why operators
 * reported that quotas could not be changed from user management at all.
 */
/**
 * One member's whole record, edited in a centered dialog with a fixed action bar.
 */
function MemberDetail({
  user,
  policies,
  keys,
  keysPending,
  keysError,
  bindings,
  owner,
  busy,
  onBack,
  onSave,
  onRevoke,
  onRecovery,
  onUnlink,
}: {
  user: TeamUser;
  policies: Policy[];
  keys?: UserKey[];
  keysPending: boolean;
  keysError: unknown;
  bindings?: OAuthBinding[];
  owner: boolean;
  busy: boolean;
  onBack: () => void;
  onSave: (body: Record<string, unknown>) => void;
  onRevoke: () => void;
  onRecovery: () => void;
  onUnlink: (bindingID: number) => void;
}) {
  const { t } = useUsers();
  const [policyIDs, setPolicyIDs] = useState(user.policy_ids);
  useEffect(() => setPolicyIDs(user.policy_ids), [user.id, user.policy_ids]);
  const [quotaTokens, setQuotaTokens] = useState(String(user.quota_total_tokens));
  const [quotaCost, setQuotaCost] = useState(String(user.quota_total_cost));
  const [resetUsed, setResetUsed] = useState(false);
  const [status, setStatus] = useState(user.status);
  const [role, setRole] = useState(user.role);
  const [allowRouting, setAllowRouting] = useState(user.allow_routing);
  const [allowRequestPreferences, setAllowRequestPreferences] = useState(
    user.allow_request_preferences,
  );
  // 保存操作放在弹框底部，使用表单 ID 关联到表单。
  const formID = useId();
  return (
    <Dialog
      title={
        <span className="member-edit-heading">
          <strong>{user.name}</strong>
          <span className="member-edit-heading__meta">{t(user.role)}</span>
          <StatusBadge value={user.status} />
        </span>
      }
      busy={busy}
      onClose={onBack}
      className="member-edit-dialog"
      actions={
        <div className="member-edit-dialog-actions">
          <div className="member-edit-dialog-actions__utility">
            {user.role !== "owner" && (
              <Button
                variant="secondary"
                className="member-edit-utility-button member-edit-utility-button--danger"
                disabled={busy}
                onClick={onRevoke}
              >
                {t("revokeSessions")}
              </Button>
            )}
            {owner && (
              <Button
                variant="secondary"
                className="member-edit-utility-button member-edit-utility-button--recovery"
                disabled={busy}
                onClick={onRecovery}
              >
                {t("recovery")}
              </Button>
            )}
          </div>
          <div className="member-edit-dialog-actions__primary">
            <Button variant="secondary" disabled={busy} onClick={onBack}>
              {t("cancel")}
            </Button>
            <Button type="submit" form={formID} loading={busy}>
              {t("save")}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={formID}
        className="member-edit-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSave({
            name: f.get("name"),
            ...(owner ? { policy_ids: policyIDs } : {}),
            ...(owner
              ? {
                  max_keys: Number(f.get("max_keys")),
                  max_concurrent: Number(f.get("max_concurrent")),
                  rpm: Number(f.get("rpm")),
                  allow_routing: allowRouting,
                  allow_request_preferences: allowRequestPreferences,
                }
              : {}),
            status: status,
            ...(owner && user.role !== "owner" ? { role: role } : {}),
            ...(owner
              ? {
                  quota_total_tokens: Number(quotaTokens || 0),
                  quota_total_cost: Number(quotaCost || 0),
                  ...(resetUsed ? { quota_reset: true } : {}),
                }
              : {}),
          });
        }}
      >
        <div className="meta-form member-edit-grid">
          <Field label={t("name")}>
            <TextInput name="name" defaultValue={user.name} required maxLength={80} />
          </Field>
          {owner && (
            <fieldset className="team-policy-choices">
              <legend>{t("authorizationGroups")}</legend>
              {policies.map((policy) => (
                <div className="check marginless" key={policy.id}>
                  <CheckboxControl
                    aria-label={policy.name}
                    checked={policyIDs.includes(policy.id)}
                    disabled={policyIDs.length === 1 && policyIDs.includes(policy.id)}
                    onChange={(event) =>
                      setPolicyIDs(
                        event.target.checked
                          ? [...policyIDs, policy.id]
                          : policyIDs.filter((id) => id !== policy.id),
                      )
                    }
                  />
                  <span>{policy.name}</span>
                </div>
              ))}
            </fieldset>
          )}
          <Field label={t("status")}>
            <SelectControl
              name="status"
              value={status}
              disabled={user.role === "owner"}
              onChange={(event) => setStatus(event.target.value as TeamUser["status"])}
              aria-label={t("status")}
            >
              <option value="active">{t("active")}</option>
              <option value="paused">{t("paused")}</option>
            </SelectControl>
            {user.role === "owner" && <input type="hidden" name="status" value="active" />}
          </Field>
          {owner && user.role !== "owner" && (
            <Field label={t("role")}>
              <SelectControl
                name="role"
                value={role}
                onChange={(event) => setRole(event.target.value as TeamUser["role"])}
                aria-label={t("role")}
              >
                <option value="member">{t("member")}</option>
                <option value="admin">{t("admin")}</option>
              </SelectControl>
            </Field>
          )}
        </div>
        {owner && (
          <section className="drawer-section member-edit-section">
            <h3>{t("accountLimits")}</h3>
            <div className="meta-form member-edit-limit-grid">
              <Field label={t("maxKeys")}>
                <TextInput
                  name="max_keys"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={user.max_keys}
                  required
                />
              </Field>
              <Field label={t("maxConcurrent")}>
                <TextInput
                  name="max_concurrent"
                  aria-label={t("maxConcurrent")}
                  type="number"
                  min={1}
                  max={10000}
                  defaultValue={user.max_concurrent}
                  required
                />
              </Field>
              <Field label={t("rpm")}>
                <TextInput
                  name="rpm"
                  type="number"
                  min={1}
                  max={100000}
                  defaultValue={user.rpm}
                  required
                />
              </Field>
            </div>
            <div className="member-edit-features">
              <div className="check marginless">
                <CheckboxControl
                  name="allow_routing"
                  checked={allowRouting}
                  onChange={(event) => setAllowRouting(event.target.checked)}
                />
                <span>{t("allowPersonalRouting")}</span>
              </div>
              <div className="check marginless">
                <CheckboxControl
                  name="allow_request_preferences"
                  checked={allowRequestPreferences}
                  onChange={(event) => setAllowRequestPreferences(event.target.checked)}
                />
                <span>{t("allowRequestControls")}</span>
              </div>
            </div>
          </section>
        )}
        {owner && (
          <section className="drawer-section member-edit-section member-edit-section--quota">
            <h3>{t("credit")}</h3>
            <p className="panel-hint">{t("creditHint")}</p>
            <div className="meta-form member-edit-quota-grid">
              <Field label={t("quotaTotal")} hint={t("quotaHint")}>
                <TextInput
                  type="number"
                  min={0}
                  value={quotaTokens}
                  onChange={(e) => setQuotaTokens(e.target.value)}
                />
              </Field>
              <Field label={t("quotaCostTotal")} hint={t("quotaCostHint")}>
                <TextInput
                  type="number"
                  min={0}
                  step="0.01"
                  value={quotaCost}
                  onChange={(e) => setQuotaCost(e.target.value)}
                />
              </Field>
            </div>
            <div className="check marginless">
              <CheckboxControl
                checked={resetUsed}
                onChange={(e) => setResetUsed(e.target.checked)}
              />
              <span>{t("quotaResetLabel")}</span>
            </div>
            <p className="panel-hint">
              {user.role === "owner" ? t("protectedOwner") : t("userChangeHint")}
            </p>
          </section>
        )}
      </form>
      <section className="drawer-section member-edit-section">
        <h3>{t("keys")}</h3>
        {keysPending ? (
          <Loading />
        ) : keysError ? (
          <ErrorState error={keysError} />
        ) : (
          <DataTable headers={[t("name"), "Key", t("status")]} empty={!keys?.length}>
            {keys?.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>
                  <code>mg-···{k.hint}</code>
                </td>
                <td>
                  <StatusBadge value={k.enabled} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
      <section className="drawer-section member-edit-section">
        <h3>{t("oauthBindings")}</h3>
        <p className="panel-hint">{t("oauthBindingsHint")}</p>
        {bindings && bindings.length > 0 ? (
          <DataTable headers={[t("oauth"), t("name"), t("lastUsed"), ""]}>
            {bindings.map((binding) => (
              <tr key={binding.id}>
                <td>{binding.label}</td>
                <td>
                  {binding.name || binding.email || "—"}
                  {binding.email ? <small>{binding.email}</small> : null}
                </td>
                <td>{binding.last_login_at}</td>
                <td className="row-actions">
                  <Button variant="danger" disabled={busy} onClick={() => onUnlink(binding.id)}>
                    {t("oauthUnlink")}
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <p className="panel-hint">{t("oauthNoBindings")}</p>
        )}
      </section>
    </Dialog>
  );
}
