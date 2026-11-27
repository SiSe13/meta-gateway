import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button as HeroButton } from "@heroui/react";
import {
  ErrorState,
  Field,
  Panel,
  TextInput,
  SelectControl,
  CheckboxControl,
} from "../components/ui";
import { useUnsavedChanges } from "../lib/unsavedChanges";
import { teamError, type TeamText } from "./text";
import type { OAuthSettings, Policy, TeamRequest } from "./types";

/**
 * Exactly the fields `save` sends. "Unsaved" is defined by this shape, so the
 * dirty flag can never disagree with what the next PUT would change: a blank
 * secret (the server keeps the stored one) is not an edit, and a save that
 * succeeds returns this payload to clean in one step.
 */
function oauthPayload(settings: OAuthSettings, secrets: Record<string, string>) {
  return {
    auto_register: settings.auto_register,
    default_policy_id: settings.default_policy_id,
    providers: settings.providers.map((provider) => ({
      id: provider.id,
      enabled: provider.enabled,
      client_id: provider.client_id,
      client_secret: secrets[provider.id] ?? "",
      authorize_url: provider.authorize_url,
      token_url: provider.token_url,
      userinfo_url: provider.userinfo_url,
      scopes: provider.scopes,
    })),
  };
}

/**
 * Sign-in providers: which third parties may authenticate a member, and what
 * happens the first time one arrives.
 *
 * A provider is only offered on the login page once it is enabled AND has a
 * client id + secret — the console says so explicitly, because a half-filled
 * card is the most likely reason a button does not appear.
 *
 * The three settings cards save together after a short pause in editing, while
 * retaining a clean baseline so in-flight requests cannot overwrite newer input.
 */
export function OAuthPanel({
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
  const [draft, setDraft] = useState<OAuthSettings | null>(null);
  // The last server-confirmed document; dirty means the draft drifted from it.
  const [baseline, setBaseline] = useState<OAuthSettings | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const draftRef = useRef(draft);
  const secretsRef = useRef(secrets);
  // A document that lands while the operator is mid-edit must not overwrite
  // their input; only the first payload — or one arriving while nothing is
  // unsaved — is adopted.
  const editedRef = useRef(false);

  useEffect(() => {
    let active = true;
    void request<OAuthSettings>("/admin/team/oauth")
      .then((data) => {
        if (!active || editedRef.current) return;
        setDraft(data);
        setBaseline(data);
      })
      .catch((e) => {
        if (active) setError(e);
      });
    return () => {
      active = false;
    };
  }, [request]);

  const dirty =
    draft !== null &&
    baseline !== null &&
    JSON.stringify(oauthPayload(draft, secrets)) !== JSON.stringify(oauthPayload(baseline, {}));
  editedRef.current = dirty;
  draftRef.current = draft;
  secretsRef.current = secrets;
  // Leaving this board — through the sidebar, the command palette or any other
  // in-app move — must not discard a change before its automatic save completes.
  useUnsavedChanges(dirty);

  useEffect(() => {
    if (!draft || !baseline || !dirty || busy || error) return;

    const payload = oauthPayload(draft, secrets);
    const signature = JSON.stringify(payload);
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError(null);
      setNotice("");
      void request<OAuthSettings>("/admin/team/oauth", {
        method: "PUT",
        body: JSON.stringify(payload),
      })
        .then((result) => {
          const latestSignature = JSON.stringify(
            oauthPayload(draftRef.current!, secretsRef.current),
          );
          setBaseline(result);
          if (latestSignature === signature) {
            setDraft(result);
            setSecrets({});
            setNotice(t("oauthAutoSaved"));
          }
        })
        .catch((saveError) => {
          const latestSignature = JSON.stringify(
            oauthPayload(draftRef.current!, secretsRef.current),
          );
          if (latestSignature === signature) setError(saveError);
        })
        .finally(() => setBusy(false));
    }, 650);

    return () => window.clearTimeout(timer);
  }, [baseline, busy, dirty, draft, error, request, secrets, t]);

  if (error && !draft) {
    return <ErrorState error={error} />;
  }
  if (!draft) return <p className="panel-hint">{t("load")}</p>;

  const patch = (providerId: string, values: Partial<OAuthSettings["providers"][number]>) => {
    setError(null);
    setNotice("");
    setDraft({
      ...draft,
      providers: draft.providers.map((item) =>
        item.id === providerId ? { ...item, ...values } : item,
      ),
    });
  };

  const updateRegistration = (values: Partial<OAuthSettings>) => {
    setError(null);
    setNotice("");
    setDraft({ ...draft, ...values });
  };

  return (
    <div className="team-board">
      {busy || notice ? (
        <p className="team-oauth-autosave" role="status" aria-live="polite">
          {busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : null}
          {busy ? t("oauthAutoSaving") : notice}
        </p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {teamError(error, locale)}
        </p>
      ) : null}
      <div className="team-oauth-grid">
        <Panel
          title={t("oauthRegistration")}
          className="team-oauth-card team-oauth-card-registration"
        >
          <label className="check marginless">
            <CheckboxControl
              checked={draft.auto_register}
              onChange={(e) => updateRegistration({ auto_register: e.target.checked })}
            />
            <span>{t("oauthAutoRegister")}</span>
          </label>
          <p className="panel-hint">{t("oauthAutoRegisterHint")}</p>
          <Field label={t("oauthDefaultPolicy")}>
            <SelectControl
              value={draft.default_policy_id}
              onChange={(e) => updateRegistration({ default_policy_id: Number(e.target.value) })}
            >
              <option value={0}>{t("oauthFirstPolicy")}</option>
              {policies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
            </SelectControl>
          </Field>
        </Panel>

        {draft.providers.map((provider) => {
          const ready = provider.enabled && provider.client_id && provider.has_secret;
          return (
            <Panel
              title={provider.label}
              className={`team-oauth-card team-oauth-card-${provider.id}`}
              key={provider.id}
            >
              <label className="check marginless">
                <CheckboxControl
                  checked={provider.enabled}
                  onChange={(e) => patch(provider.id, { enabled: e.target.checked })}
                />
                <span>{t("oauthEnable", { name: provider.label })}</span>
              </label>

              <div className="team-callback">
                <code>{provider.callback_url}</code>
                <HeroButton
                  type="button"
                  variant="ghost"
                  className="button button-quiet"
                  onPress={() => {
                    void navigator.clipboard
                      .writeText(provider.callback_url)
                      .then(() => {
                        setCopied(provider.id);
                        window.setTimeout(() => setCopied(""), 1600);
                      })
                      .catch(() => setCopied(""));
                  }}
                >
                  {copied === provider.id ? t("copied") : t("copy")}
                </HeroButton>
              </div>
              <p className="panel-hint">{t("oauthCallbackHint")}</p>

              <div className="meta-form">
                <Field label={t("oauthClientID")}>
                  <TextInput
                    value={provider.client_id}
                    maxLength={200}
                    autoComplete="off"
                    onChange={(e) => patch(provider.id, { client_id: e.target.value })}
                  />
                </Field>
                <Field
                  label={
                    provider.has_secret
                      ? `${t("oauthClientSecret")} · ${t("oauthSecretStored")}`
                      : t("oauthClientSecret")
                  }
                >
                  <TextInput
                    type="password"
                    autoComplete="new-password"
                    placeholder={provider.has_secret ? t("oauthSecretKeep") : ""}
                    value={secrets[provider.id] ?? ""}
                    onChange={(e) => {
                      setError(null);
                      setNotice("");
                      setSecrets({ ...secrets, [provider.id]: e.target.value });
                    }}
                  />
                </Field>
                <Field label={t("oauthScopes")}>
                  <TextInput
                    value={provider.scopes}
                    placeholder={provider.default_scopes}
                    onChange={(e) => patch(provider.id, { scopes: e.target.value })}
                  />
                </Field>
              </div>

              <details className="team-oauth-advanced">
                <summary>{t("oauthAdvanced")}</summary>
                <p className="panel-hint">{t("oauthAdvancedHint")}</p>
                <div className="meta-form">
                  <Field label={t("oauthAuthorizeURL")}>
                    <TextInput
                      value={provider.authorize_url}
                      placeholder={provider.default_authorize_url}
                      onChange={(e) => patch(provider.id, { authorize_url: e.target.value })}
                    />
                  </Field>
                  <Field label={t("oauthTokenURL")}>
                    <TextInput
                      value={provider.token_url}
                      placeholder={provider.default_token_url}
                      onChange={(e) => patch(provider.id, { token_url: e.target.value })}
                    />
                  </Field>
                  <Field label={t("oauthUserInfoURL")}>
                    <TextInput
                      value={provider.userinfo_url}
                      placeholder={provider.default_userinfo_url}
                      onChange={(e) => patch(provider.id, { userinfo_url: e.target.value })}
                    />
                  </Field>
                </div>
              </details>

              <details className="team-oauth-guide">
                <summary>
                  {t(provider.id === "github" ? "oauthGitHubGuide" : "oauthLinuxDoGuide")}
                </summary>
                <ol>
                  {provider.id === "github" ? (
                    <>
                      <li>{t("oauthGitHubGuideStep1")}</li>
                      <li>{t("oauthGitHubGuideStep2")}</li>
                      <li>{t("oauthGitHubGuideStep3")}</li>
                    </>
                  ) : (
                    <>
                      <li>{t("oauthLinuxDoGuideStep1")}</li>
                      <li>{t("oauthLinuxDoGuideStep2")}</li>
                      <li>{t("oauthLinuxDoGuideStep3")}</li>
                    </>
                  )}
                </ol>
                <a
                  href={
                    provider.id === "github"
                      ? "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app"
                      : "https://connect.linux.do"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {t(provider.id === "github" ? "oauthGitHubGuideLink" : "oauthLinuxDoGuideLink")}
                </a>
              </details>

              <p className="panel-hint">{ready ? t("oauthReady") : t("oauthNotReady")}</p>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
