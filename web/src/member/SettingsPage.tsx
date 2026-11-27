import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, X } from "lucide-react";
import { Button, Dialog, Field, Page, Panel, TextInput } from "../components/ui";
import { QuotaMeter } from "../components/QuotaMeter";
import { formatCost } from "../lib/format";
import { accountRequest } from "../team/transport";
import { teamError, type TeamText } from "../team/text";
import type { Account } from "../team/types";
import type { UsageSummary } from "../api/types";
import { useI18n } from "../i18n";

type Session = {
  id: string;
  created_at: number;
  expires_at: number;
  current: boolean;
  device: string;
  ip_address: string;
  login_method: string;
  last_active_at: number;
};
type Redemption = {
  id: number;
  created_at: number;
  quota_tokens: number;
  quota_cost: number;
  quota_concurrent: number;
  grant_expires_at: number;
  grant_expired: boolean;
  target: "account" | "api_key";
};

/** Personal information, credit and active login sessions. */
export function SettingsPage({
  account,
  t,
  onDisconnected,
}: {
  account: Account;
  t: TeamText;
  onDisconnected: () => void;
}) {
  const { locale } = useI18n();
  const userID = account.user.id;
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sessionError, setSessionError] = useState<unknown>(null);
  const [logoutOtherConfirmOpen, setLogoutOtherConfirmOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemNotice, setRedeemNotice] = useState("");
  const [redemptionHistoryOpen, setRedemptionHistoryOpen] = useState(false);
  const [credit, setCredit] = useState(account.credit);
  const [maxConcurrent, setMaxConcurrent] = useState(account.user.max_concurrent);
  const usage = useQuery({
    queryKey: ["user", userID, "usage-summary"],
    queryFn: ({ signal }) => accountRequest<UsageSummary>("/me/usage/summary", { signal }),
  });
  const redemptions = useQuery({
    queryKey: ["user", userID, "redemptions"],
    queryFn: ({ signal }) => accountRequest<Redemption[]>("/me/redemptions", { signal }),
    enabled: redemptionHistoryOpen,
  });
  const sessions = useQuery({
    queryKey: ["user", userID, "sessions"],
    queryFn: ({ signal }) => accountRequest<Session[]>("/me/sessions", { signal }),
  });

  async function revokeSession(session: Session) {
    setSessionBusy(true);
    setSessionError(null);
    try {
      await accountRequest(`/me/sessions/${session.id}`, { method: "DELETE" });
      await sessions.refetch();
      if (session.current) onDisconnected();
    } catch (cause) {
      setSessionError(cause);
    } finally {
      setSessionBusy(false);
    }
  }

  async function logoutOtherSessions() {
    setSessionBusy(true);
    setSessionError(null);
    try {
      await accountRequest("/me/sessions/others", { method: "DELETE" });
      await sessions.refetch();
    } catch (cause) {
      setSessionError(cause);
    } finally {
      setSessionBusy(false);
    }
  }

  return (
    <Page
      className="member-settings-page"
      title={t("personalInformation")}
      description={t("personalInformationHint")}
      hideHeading
    >
      <div className="member-identity">
        <div className="member-identity-profile">
          <div className="member-identity-main">
            <strong>{account.user.name || account.user.username}</strong>
            <span className="member-identity-handle">@{account.user.username}</span>
          </div>
          <div className="member-identity-chips">
            <span className="member-home-chip">{t(account.user.role)}</span>
            <span
              className={`member-home-chip${account.user.status === "active" ? " member-home-chip--active" : ""}`}
            >
              {t(account.user.status)}
            </span>
          </div>
        </div>
        <div className="member-identity-stats">
          <div className="member-identity-stat">
            <span>{t("totalUsage")}</span>
            <strong>{usage.data ? formatCost(usage.data.cost) : "—"}</strong>
            <small>{t("totalSpend")}</small>
          </div>
          <div className="member-identity-stat">
            <span>{t("apiRequests")}</span>
            <strong>{usage.data ? usage.data.request_count.toLocaleString(locale) : "—"}</strong>
            <small>{t("totalRequestCount")}</small>
          </div>
          <div className="member-identity-stat">
            <span>{t("maxConcurrent")}</span>
            <strong>{maxConcurrent}</strong>
          </div>
          <div className="member-identity-stat">
            <span>{t("created")}</span>
            <strong>
              {account.user.created_at
                ? new Date(account.user.created_at).toLocaleDateString(locale, {
                    year: "numeric",
                    month: "short",
                  })
                : "—"}
            </strong>
          </div>
        </div>
      </div>

      <Panel className="settings-credit" title={t("credit")} titleHelp={t("creditHint")}>
        <div className="member-credit-meters">
          <div className="member-credit-meter">
            <QuotaMeter
              label={t("credit")}
              headline={
                credit.unlimited ? (
                  t("unlimited")
                ) : (
                  <>
                    <span className="member-home-remaining">{t("creditRemaining")}</span>
                    {credit.available.toLocaleString()}
                  </>
                )
              }
              used={credit.used}
              total={credit.total}
              format={(value) => value.toLocaleString()}
              percentLabel={(percent) => t("quotaUsedPercent", { percent })}
              unlimitedLabel={t("unlimited")}
              footer={
                <span className="member-meter-words">
                  {credit.unlimited
                    ? `${t("creditUsed")} ${credit.used.toLocaleString()}`
                    : `${t("creditUsed")} · ${t("creditTotal")}`}
                </span>
              }
            />
          </div>
          <div className="member-credit-meter member-credit-meter--cost">
            <QuotaMeter
              label={t("creditCost")}
              headline={
                credit.cost_unlimited ? (
                  t("unlimited")
                ) : (
                  <>
                    <span className="member-home-remaining">{t("creditRemaining")}</span>
                    {formatCost(credit.cost_available)}
                  </>
                )
              }
              used={credit.cost_used}
              total={credit.cost_total}
              format={formatCost}
              percentLabel={(percent) => t("quotaUsedPercent", { percent })}
              unlimitedLabel={t("unlimited")}
              footer={
                <span className="member-meter-words">
                  {credit.cost_unlimited
                    ? `${t("creditCostUsed")} ${formatCost(credit.cost_used)}`
                    : `${t("creditCostUsed")} · ${t("creditCostTotal")}`}
                </span>
              }
            />
          </div>
        </div>
        <form
          className="user-redeem"
          onSubmit={(event) => {
            event.preventDefault();
            setRedeemBusy(true);
            setError(null);
            setRedeemNotice("");
            void accountRequest<{
              granted: number;
              cost_granted: number;
              quota_total: number;
              quota_used: number;
              quota_available: number;
              cost_total: number;
              cost_used: number;
              concurrency_granted: number;
              max_concurrent: number;
            }>("/me/redeem", {
              method: "POST",
              body: JSON.stringify({ code: redeemCode }),
            })
              .then((result) => {
                setMaxConcurrent(result.max_concurrent);
                setCredit({
                  total: result.quota_total,
                  used: result.quota_used,
                  available: result.quota_available,
                  unlimited: result.quota_total <= 0,
                  cost_total: result.cost_total,
                  cost_used: result.cost_used,
                  cost_available: Math.max(result.cost_total - result.cost_used, 0),
                  cost_unlimited: result.cost_total <= 0,
                });
                setRedeemCode("");
                setRedeemNotice(
                  result.concurrency_granted > 0
                    ? t("redeemSuccessConcurrent", {
                        n: result.concurrency_granted,
                        total: result.max_concurrent,
                      })
                    : result.cost_granted > 0
                      ? t("redeemSuccessCost", { amount: formatCost(result.cost_granted) })
                      : t("redeemSuccess", { n: result.granted }),
                );
              })
              .catch(setError)
              .finally(() => setRedeemBusy(false));
          }}
        >
          <Field
            label={t("redeemCode")}
            hint={t("redeemHint")}
            className="redeem-code-field"
            labelAction={
              <Button variant="link" onClick={() => setRedemptionHistoryOpen(true)}>
                {t("viewRedemptionHistory")}
              </Button>
            }
          >
            <TextInput
              value={redeemCode}
              onChange={(event) => setRedeemCode(event.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              required
              maxLength={64}
              autoComplete="off"
            />
          </Field>
          <Button type="submit" loading={redeemBusy} disabled={redeemBusy || !redeemCode}>
            {t("redeem")}
          </Button>
        </form>
        {error ? (
          <p className="inline-error" role="alert">
            {teamError(error, locale)}
          </p>
        ) : null}
        {redeemNotice ? (
          <p role="status" className="workspace-note">
            {redeemNotice}
          </p>
        ) : null}
      </Panel>

      {redemptionHistoryOpen ? (
        <Dialog
          title={t("redemptionHistory")}
          onClose={() => setRedemptionHistoryOpen(false)}
          className="redemption-history-dialog"
        >
          {redemptions.error ? (
            <div className="inline-error" role="alert">
              <span>{teamError(redemptions.error, locale)}</span>
              <Button variant="quiet" onClick={() => void redemptions.refetch()}>
                {t("retry")}
              </Button>
            </div>
          ) : redemptions.isLoading ? (
            <p className="workspace-note">{t("load")}</p>
          ) : redemptions.data ? (
            <div className="table-wrap" data-columns="4">
              <table>
                <thead>
                  <tr>
                    <th>{t("created")}</th>
                    <th>{t("grantAmount")}</th>
                    <th>{t("redemptionTarget")}</th>
                    <th>{t("grantExpiry")}</th>
                  </tr>
                </thead>
                <tbody>
                  {redemptions.data.length ? (
                    redemptions.data.map((item) => {
                      const grants = [
                        item.quota_tokens > 0
                          ? `${item.quota_tokens.toLocaleString(locale)} ${t("tokenUnit")}`
                          : "",
                        item.quota_cost > 0 ? formatCost(item.quota_cost) : "",
                        item.quota_concurrent > 0
                          ? `+${item.quota_concurrent} ${t("maxConcurrent")}`
                          : "",
                      ].filter(Boolean);
                      const expiry = item.grant_expired
                        ? t("grantExpired")
                        : item.grant_expires_at > 0
                          ? t("grantUntil", {
                              date: new Date(item.grant_expires_at * 1000).toLocaleDateString(
                                locale,
                              ),
                            })
                          : t("grantPermanent");
                      return (
                        <tr key={item.id}>
                          <td>{new Date(item.created_at * 1000).toLocaleString(locale)}</td>
                          <td>{grants.join(" · ") || "—"}</td>
                          <td>
                            {t(
                              item.target === "account"
                                ? "redemptionTargetAccount"
                                : "redemptionTargetKey",
                            )}
                          </td>
                          <td>{expiry}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4}>
                        <p className="workspace-note redemption-history-empty">
                          {t("redemptionHistoryEmpty")}
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="workspace-note">{t("redemptionHistoryEmpty")}</p>
          )}
        </Dialog>
      ) : null}

      <Panel
        className="settings-sessions"
        title={t("sessions")}
        lede={t("sessionsHint")}
        actions={
          <Button
            variant="secondary"
            className="member-session-logout-others"
            icon={<LogOut size={15} aria-hidden="true" />}
            disabled={
              sessionBusy ||
              sessions.isPending ||
              !sessions.data?.some((session) => !session.current)
            }
            onClick={() => setLogoutOtherConfirmOpen(true)}
          >
            {t("logoutOtherSessions")}
          </Button>
        }
      >
        {sessions.error || sessionError ? (
          <p className="inline-error" role="alert">
            {teamError(sessionError ?? sessions.error, locale)}{" "}
            {sessions.error ? (
              <Button variant="quiet" onClick={() => void sessions.refetch()}>
                {t("retry")}
              </Button>
            ) : null}
          </p>
        ) : null}
        {sessions.isPending ? (
          <p className="workspace-note">{t("load")}</p>
        ) : sessions.error ? null : sessions.data?.length ? (
          <div className="member-session-list">
            {sessions.data.map((session) => (
              <article className="member-session" key={session.id}>
                <span className="member-session-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <rect x="4" y="4" width="16" height="13" rx="2" />
                    <path d="M2.5 20h19M9 17v3m6-3v3" />
                  </svg>
                </span>
                <div className="member-session-info">
                  <div className="member-session-title">
                    <strong>{session.device || t("unknownDevice")}</strong>
                    {session.current ? (
                      <span className="member-session-current">{t("currentSession")}</span>
                    ) : null}
                  </div>
                  <p>
                    {t("sessionIp")}: {session.ip_address || "—"}
                    <span> · </span>
                    {t("sessionLoginMethod")}: {formatLoginMethod(session.login_method, t)}
                  </p>
                  <p>
                    {t("sessionLastActive")}: {formatSessionDate(session.last_active_at, locale)}
                    <span> · </span>
                    {t("sessionExpires")}: {formatSessionDate(session.expires_at, locale)}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  className="member-session-revoke"
                  icon={<X size={14} aria-hidden="true" />}
                  disabled={sessionBusy}
                  onClick={() => void revokeSession(session)}
                >
                  {t("revoke")}
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <p className="workspace-note">{t("sessionsEmpty")}</p>
        )}
      </Panel>
      {logoutOtherConfirmOpen ? (
        <Dialog
          title={t("logoutOtherSessions")}
          onClose={() => setLogoutOtherConfirmOpen(false)}
          busy={sessionBusy}
          actions={
            <>
              <Button
                variant="quiet"
                disabled={sessionBusy}
                onClick={() => setLogoutOtherConfirmOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="danger"
                loading={sessionBusy}
                disabled={sessionBusy}
                onClick={() => {
                  setLogoutOtherConfirmOpen(false);
                  void logoutOtherSessions();
                }}
              >
                {t("logoutOtherSessions")}
              </Button>
            </>
          }
        >
          <p>{t("logoutOtherSessionsConfirm")}</p>
        </Dialog>
      ) : null}
    </Page>
  );
}

/** 将 Unix 秒时间戳格式化为当前界面语言的日期。 */
function formatSessionDate(value: number, locale: string) {
  return value > 0 ? new Date(value * 1000).toLocaleString(locale) : "—";
}

/** 将会话中保存的登录来源转换为界面文案。 */
function formatLoginMethod(value: string, t: TeamText) {
  if (value.startsWith("oauth:")) {
    const provider = value.slice("oauth:".length);
    return t("sessionOAuthMethod", { provider: provider === "linuxdo" ? "Linux.do" : provider });
  }
  if (value === "password" || value === "operator_password") return t("sessionPasswordMethod");
  if (value === "invitation") return t("sessionInvitationMethod");
  return t("sessionUnknownMethod");
}
