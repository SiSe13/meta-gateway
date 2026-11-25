import { OperatorUpgradePrompt } from "./features/OperatorProfilePanel";
import { DeploymentStepPrompt } from "./features/DeploymentStepPrompt";
import { OperatorClaimPanel } from "./features/OperatorProfilePanel";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  HelpCircle,
  LogIn,
  Puzzle,
  ShieldCheck,
  Ticket,
  Moon,
  Sun,
} from "lucide-react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button as HeroButton } from "@heroui/react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient, ApiError, api } from "./api/client";
import type { Site } from "./api/types";
import { LanguageSwitcher, useI18n } from "./i18n";
import { useSession, type AccountSession } from "./session";
import { useModules } from "./hooks/useModules";
import { Button, ErrorState, Dialog, Field, IconButton, Loading } from "./components/ui";
import { BrandMark } from "./components/BrandMark";
import { CommandPalette } from "./components/CommandPalette";
import { ConsoleShell } from "./components/ConsoleShell";
const Dashboard = lazy(() =>
  import("./features/Dashboard").then((module) => ({ default: module.Dashboard })),
);
const GuidedTour = lazy(() =>
  import("./features/GuidedTour").then((module) => ({ default: module.GuidedTour })),
);
const SetupWizard = lazy(() =>
  import("./features/SetupWizard").then((module) => ({ default: module.SetupWizard })),
);
import { channelHealthState } from "./features/channelHealth";
import { KatanaCanvas } from "./components/KatanaCanvas";
import { createEdgeSparkHost } from "./lib/katanafx";
import { useHiddenPlugins } from "./lib/pluginNav";
import {
  CHROME_NAV_GROUPS,
  CHROME_NAV_ITEMS,
  chromeNavGroupForLocation,
  STAFF_ONLY_PATHS,
  canAccessNav,
  type ChromeNavItem,
} from "./lib/chromeNav";
import { modeHiddenNav, useChromePrefs } from "./lib/topBar";
import { isStaff, type ConsoleRole } from "./session";
import { accountRequest, COOKIE_SESSION, refreshAnonymousCSRF } from "./team/transport";
import { teamText } from "./team/text";
import { AcceptFlow } from "./features/AcceptFlow";
const AccountPage = lazy(() =>
  import("./features/AccountPage").then((module) => ({ default: module.AccountPage })),
);
import { AppearanceProvider, useAppearance } from "./appearance";
import { LoginShell } from "./components/LoginShell";
// The multi-user module (its own area of the console) and the sign-in screen a
// team admin gets. Boards are loaded on demand — see team/panels/lazy.ts.
import * as UsersBoards from "./team/panels/lazy";
import { useOperatingMode } from "./hooks/useOperatingMode";
import { setCurrency, useCurrency } from "./lib/format";
import { useToast } from "./toast";
import { PRELOAD_EXHAUSTED_EVENT } from "./lib/preloadRecovery";

const Channels = lazy(() =>
  import("./features/Channels").then((module) => ({ default: module.Channels })),
);
const Backups = lazy(() =>
  import("./features/Backups").then((module) => ({ default: module.Backups })),
);
const ChannelModels = lazy(() =>
  import("./features/ChannelModels").then((module) => ({ default: module.ChannelModels })),
);
const Checkins = lazy(() =>
  import("./features/Checkins").then((module) => ({ default: module.Checkins })),
);
const ExchangePage = lazy(() =>
  import("./features/Exchange").then((module) => ({ default: module.Exchange })),
);
const Keys = lazy(() => import("./features/Keys").then((module) => ({ default: module.Keys })));
const Logs = lazy(() => import("./features/Logs").then((module) => ({ default: module.Logs })));
const SystemLogs = lazy(() =>
  import("./features/SystemLogs").then((module) => ({ default: module.SystemLogs })),
);
const Maintain = lazy(() =>
  import("./features/Maintain").then((module) => ({ default: module.Maintain })),
);
const Models = lazy(() =>
  import("./features/Models").then((module) => ({ default: module.Models })),
);
const PluginHost = lazy(() =>
  import("./features/PluginHost").then((module) => ({ default: module.PluginHost })),
);
const Store = lazy(() => import("./features/Store").then((module) => ({ default: module.Store })));
const Workbench = lazy(() =>
  import("./features/Workbench").then((module) => ({ default: module.default })),
);
const StandaloneAdmin = lazy(() =>
  import("./team/StandaloneAdmin").then((module) => ({ default: module.StandaloneAdmin })),
);
const UsersLayout = UsersBoards.UsersLayout;

type AuthorizedSession = {
  token: string;
  remember: boolean;
  sites: Site[];
  account?: AccountSession;
};

export function App() {
  return (
    <AppearanceProvider>
      <GatewayApp />
    </AppearanceProvider>
  );
}

function GatewayApp() {
  useCurrency();
  const { client, connect, connectMember, disconnect, role } = useSession();
  // The standalone admin screen renders the shared user-management module, so
  // it passes the transport in — the module deliberately does not know about
  // the console's session (see team/UsersLayout.tsx).
  const adminRequest = useCallback(
    <T,>(path: string, init?: RequestInit) => client!.request<T>(path, init),
    [client],
  );
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  // Money is rendered through the site's currency everywhere, so it is read
  // once here and applied to the shared formatter before any table paints.
  const service = useMemo(() => (client ? api(client) : null), [client]);
  const currencySettings = useQuery({
    queryKey: ["display-settings", role ?? "staff"],
    // The console's own endpoint is behind the admin gate; a member reads
    // the same values from their own path, so both format money alike.
    queryFn: ({ signal }) =>
      role === "member" || role === "admin"
        ? accountRequest<{ symbol: string; rate: number }>("/me/display-settings", { signal })
        : service!.displaySettings(signal),
    enabled: Boolean(service),
  });
  useEffect(() => {
    if (currencySettings.data) setCurrency(currencySettings.data);
  }, [currencySettings.data]);
  const [bootstrapSites, setBootstrapSites] = useState<Site[]>();
  // The preload recovery reloads the tab once when a chunk went missing after
  // a deploy. If that did not help, this tab is genuinely holding an old
  // build: say so instead of leaving a blank page or a console error.
  useEffect(() => {
    const onStale = () => toast.push({ tone: "error", message: t("app.staleBundle") });
    window.addEventListener(PRELOAD_EXHAUSTED_EVENT, onStale);
    return () => window.removeEventListener(PRELOAD_EXHAUSTED_EVENT, onStale);
  }, [toast, t]);
  useEffect(() => {
    if (!client) queryClient.clear();
  }, [client, queryClient]);

  const adoptSession = useCallback(
    (session: AuthorizedSession) => {
      if (session.account) connectMember(session.account);
      else connect(session.token, session.remember);
    },
    [connect, connectMember],
  );

  const authorize = useCallback(
    (token: string, remember: boolean, sites: Site[], account?: AccountSession) => {
      setBootstrapSites(sites);
      adoptSession({ token: token.trim(), remember, sites, account });
    },
    [adoptSession],
  );

  const handleDisconnect = useCallback(() => {
    setBootstrapSites(undefined);
    disconnect();
  }, [disconnect]);

  return (
    <>
      {client && role === "admin" ? (
        <Suspense fallback={<Loading />}>
          <StandaloneAdmin request={adminRequest} onDisconnect={handleDisconnect} />
        </Suspense>
      ) : client ? (
        <div className="authenticated-stage">
          <Authenticated
            clientKey={client}
            initialSites={bootstrapSites}
            onUnauthorized={handleDisconnect}
          />
        </div>
      ) : (
        <Connect onAuthorized={authorize} />
      )}
    </>
  );
}

function Connect({
  onAuthorized,
}: {
  onAuthorized: (token: string, remember: boolean, sites: Site[], account?: AccountSession) => void;
}) {
  const { t, locale } = useI18n();
  const { connectMember } = useSession();
  // Invitation, recovery and code links all land here now: /app used to serve
  // them, and the console is where those links point. The tokens ride in the
  // query string, which is also what makes them survivable across a sign-in
  // redirect.
  const linkParams = new URLSearchParams(location.search);
  const inviteToken = linkParams.get("invite") ?? "";
  const recoveryToken = linkParams.get("recovery") ?? "";
  const [manualCode, setManualCode] = useState(false);
  const accepting = Boolean(inviteToken || recoveryToken || manualCode);
  const team = teamText(locale);
  const [username, setUsername] = useState("");
  const [upgradeHelp, setUpgradeHelp] = useState(false);
  // The second layer of the sign-in card: registration, third-party sign-in and
  // the upgrade guide. Collapsed by default so the form stays the only thing
  // asking for attention.
  const [otherOpen, setOtherOpen] = useState(false);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  // Whether this deployment still accepts the admin token as a password, i.e.
  // no owner account has been claimed yet. Answered by the public /auth/options
  // so the upgrade entry can sit on the sign-in card — the page where an
  // upgrading operator actually is — instead of hiding inside "more options".
  const [upgradeLogin, setUpgradeLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [needTOTP, setNeedTOTP] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  const [isFocused, setIsFocused] = useState(false);
  const { scheme, toggleScheme, appearance } = useAppearance();
  const loginRef = useRef<HTMLDivElement>(null);
  const loginButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = loginButtonRef.current;
    if (!button) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const colors = getComputedStyle(document.documentElement);
    const sparks = createEdgeSparkHost(
      button,
      [
        colors.getPropertyValue("--primary").trim() || "#7cc4f0",
        colors.getPropertyValue("--accent").trim() || "#d4af37",
        "#ffffff",
      ],
      160,
    );
    const start = () => {
      if (!reduced.matches && !button.disabled && !document.hidden) sparks.start();
    };
    const stop = () => sparks.stop();
    button.addEventListener("pointerenter", start);
    button.addEventListener("pointerleave", stop);
    reduced.addEventListener("change", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      sparks.dispose();
      button.removeEventListener("pointerenter", start);
      button.removeEventListener("pointerleave", stop);
      reduced.removeEventListener("change", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [appearance, scheme]);

  // /auth/options is what mints the CSRF cookie the invitation, recovery and
  // third-party flows post against, and it is the only source of the configured
  // providers. Nothing used to call it, which left every one of those POSTs
  // answering 403 csrf_failed and the sign-in page with no third-party buttons
  // at all. A personal deployment answers 404 here; that simply means no
  // providers, and the sign-in form carries on unchanged.
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/auth/options", { credentials: "same-origin", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          body: {
            csrf?: string;
            oauth?: { id: string; label: string }[];
          } | null,
        ) => {
          if (!body) return;
          // Not setTeamCSRF: minting this anonymous token is not an account
          // transition, and bumping the generation for it signed out an in-flight
          // session restore (see the note in team/transport.ts).
          if (body.csrf) refreshAnonymousCSRF(body.csrf);
          if (body.oauth?.length) setProviders(body.oauth);
        },
      )
      .catch(() => {
        /* personal mode, offline, or aborted: the form still works */
      });
    // Whether the upgrade entry belongs on the card. Its own endpoint because
    // /auth/options sits behind the team-mode gate and answers 404 on a personal
    // gateway — which is exactly the deployment that is upgrading.
    void fetch("/auth/upgrade", { credentials: "same-origin", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { upgrade_login?: boolean } | null) => {
        if (body) setUpgradeLogin(Boolean(body.upgrade_login));
      })
      .catch(() => {
        /* no entry is the safe answer */
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem("mg.login.bg");
    } catch {
      // 浏览器限制存储时忽略旧背景偏好。
    }
  }, []);

  async function submit(e: React.FormEvent, legacy = false) {
    e.preventDefault();
    if ((!legacy && !username.trim()) || !password) return;
    setPending(true);
    setError("");
    try {
      // The server selects the account and role; the client never guesses
      // identity from a username or retries with elevated credentials.
      const res = await fetch("/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(legacy ? { token: password } : { username: username.trim(), password }),
          totp_code: needTOTP ? totpCode.trim() : "",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && body.error === "totp_required") {
        setNeedTOTP(true);
        setError(t("app.connect.totpRequired"));
        return;
      }
      if (!res.ok || (!body.session_token && !body.user)) {
        setError(
          typeof body.error === "string" && body.error
            ? body.error === "invalid_credentials"
              ? t("app.connect.invalidCredentials")
              : body.error
            : t("app.connect.failed"),
        );
        return;
      }
      if (body.user && body.csrf) {
        onAuthorized(COOKIE_SESSION, false, [], {
          role: body.user.role,
          csrf: body.csrf,
          remember,
        });
        return;
      }
      const sessionToken = body.session_token as string;
      const sites = await api(new ApiClient(sessionToken)).sites();
      onAuthorized(sessionToken, remember, sites);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.message === "Unable to reach Meta Gateway" || err.message === "api.unreachable"
            ? t("api.unreachable")
            : err.message,
        );
      } else {
        setError(t("app.connect.failed"));
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <LoginShell
      rootRef={loginRef}
      effects={
        <KatanaCanvas
          charging={isFocused || pending}
          chargeProgress={pending ? 1 : 0.65}
          motionTarget={loginRef}
        />
      }
      edition={t("shell.workspace")}
      title={
        <>
          {t("login.titleFirst")}
          <br />
          <span>{t("login.titleSecond")}</span>
        </>
      }
      description={t("login.description")}
      footerRight={t("login.foundation")}
      tools={
        <>
          <IconButton
            label={t(scheme === "dark" ? "app.themeLight" : "app.themeDark")}
            onClick={toggleScheme}
          >
            {scheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>
          <LanguageSwitcher />
        </>
      }
    >
      <div className="login-card-stack" data-layer={accepting || otherOpen ? "other" : "signin"}>
        {accepting ? (
          <section
            className={"login-card" + (isFocused ? " is-focused" : "")}
            aria-labelledby="login-card-title"
          >
            <div className="login-card-heading">
              <span className="login-card-mark">
                <ShieldCheck size={22} strokeWidth={1.4} />
              </span>
              <h2 id="login-card-title">{team(recoveryToken ? "recover" : "accept")}</h2>
              <p>{team("loginHint")}</p>
            </div>
            <AcceptFlow
              invite={inviteToken}
              recovery={recoveryToken}
              manual={manualCode}
              t={team}
              onDone={connectMember}
              onBack={() => {
                setManualCode(false);
                history.replaceState(null, "", "/console");
              }}
            />
            <p className="login-private">
              <ShieldCheck size={13} />
              {t("login.private")}
            </p>
          </section>
        ) : otherOpen ? (
          <section className="login-card is-other" aria-labelledby="login-card-title">
            <div className="login-card-heading">
              <span className="login-card-mark">
                <BrandMark size={25} />
              </span>
              <h2 id="login-card-title">{t("login.otherTitle")}</h2>
              <p>{t("login.otherHint")}</p>
            </div>
            <div className="login-other-list">
              {/* Registration is the same flow as arriving through an invite link:
						    only where the code came from differs. */}
              <HeroButton
                type="button"
                variant="ghost"
                className="login-other-item"
                isDisabled={pending}
                onPress={() => setManualCode(true)}
              >
                <Ticket size={16} />
                <span>{t("login.register")}</span>
                <ChevronRight size={15} />
              </HeroButton>
              {providers.map((provider) => (
                <a
                  key={provider.id}
                  className="login-other-item"
                  href={"/auth/oauth/" + provider.id + "/start"}
                >
                  <LogIn size={16} />
                  <span>{t("login.viaProvider", { provider: provider.label })}</span>
                  <ChevronRight size={15} />
                </a>
              ))}
            </div>
            <HeroButton
              type="button"
              variant="ghost"
              className="login-back"
              isDisabled={pending}
              onPress={() => setOtherOpen(false)}
            >
              <ArrowLeft size={14} />
              {t("login.backToSignIn")}
            </HeroButton>
            <p className="login-private">
              <ShieldCheck size={13} />
              {t("login.private")}
            </p>
          </section>
        ) : (
          <>
            <section
              className={"login-card" + (isFocused ? " is-focused" : "")}
              aria-labelledby="login-card-title"
            >
              <div className="login-card-heading">
                <span className="login-card-mark">
                  <BrandMark size={25} />
                </span>
                <h2 id="login-card-title">{t("login.welcome")}</h2>
                <p>{t("login.hint")}</p>
              </div>
              <form onSubmit={submit} aria-busy={pending}>
                <Field label={t("app.connect.username")}>
                  <input
                    autoFocus
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    autoComplete="username"
                    disabled={pending}
                    required
                  />
                </Field>
                <Field label={t("app.connect.password")}>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    autoComplete="current-password"
                    disabled={pending}
                    required
                  />
                </Field>
                {needTOTP ? (
                  <Field label={t("app.connect.totp")}>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      autoComplete="one-time-code"
                      placeholder="123456"
                      disabled={pending}
                      required
                    />
                  </Field>
                ) : null}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    disabled={pending}
                  />
                  <span>{t("app.connect.remember")}</span>
                </label>
                {error && (
                  <div className="inline-error" role="alert">
                    {error}
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={pending || !username.trim() || !password}
                  className="login-submit"
                  ref={loginButtonRef}
                >
                  <span className="btn-content">
                    <ArrowRight size={16} />
                    {pending ? t("app.connect.connecting") : t("app.connect.submit")}
                  </span>
                </Button>
              </form>
              <HeroButton
                type="button"
                variant="ghost"
                className="login-card-more"
                isDisabled={pending}
                onPress={() => setOtherOpen(true)}
              >
                <LogIn size={16} />
                <span>{t("login.moreWays")}</span>
                <ChevronRight size={15} />
              </HeroButton>
              <p className="login-private">
                <ShieldCheck size={13} />
                {t("login.private")}
              </p>
            </section>
          </>
        )}
      </div>
      {/* 将旧版本升级提示放在登录卡片下方，避免与登录操作争抢注意力。 */}
      {!accepting && !otherOpen && upgradeLogin ? (
        <HeroButton
          type="button"
          variant="ghost"
          className="login-upgrade"
          isDisabled={pending}
          onPress={() => setUpgradeHelp(true)}
        >
          <HelpCircle size={14} />
          <span>{t("login.upgradeEntry")}</span>
          <ChevronRight size={13} />
        </HeroButton>
      ) : null}
      {upgradeHelp ? (
        <Dialog title={t("login.upgradeHelp")} onClose={() => setUpgradeHelp(false)}>
          <p>{t("login.upgradeCredentials")}</p>
          <p>{t("login.upgradeCollision")}</p>
          <p>{t("login.upgradeTeam")}</p>
          <p>{t("operator.legacyHint")}</p>
          <form onSubmit={(event) => void submit(event, true)}>
            <Field label={t("operator.confirmToken")}>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={pending}
              />
            </Field>
            {needTOTP ? (
              <Field label={t("app.connect.totp")}>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value)}
                  required
                  disabled={pending}
                />
              </Field>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
            <Button type="submit" disabled={!password || pending}>
              {t("operator.legacyLogin")}
            </Button>
          </form>
        </Dialog>
      ) : null}
    </LoginShell>
  );
}

function Authenticated({
  clientKey,
  initialSites,
  onUnauthorized,
}: {
  clientKey: object;
  initialSites?: Site[];
  onUnauthorized: () => void;
}) {
  const { client, role } = useSession();
  const { t } = useI18n();
  // The gateway's site list is staff-only, and the session a member holds was
  // already proven by the /me call that established it — so a member skips
  // the query entirely instead of being shown its 403 as a full-page error.
  const staff = isStaff(role);
  const auth = useQuery({
    queryKey: ["auth", clientKey],
    queryFn: ({ signal }) => api(client!).sites(signal),
    initialData: initialSites,
    enabled: staff,
  });
  useEffect(() => {
    if (auth.error instanceof ApiError && auth.error.status === 401) onUnauthorized();
  }, [auth.error, onUnauthorized]);
  if (staff && auth.isPending)
    return (
      <div className="fullscreen-state">
        <Loading />
      </div>
    );
  if (staff && auth.isError)
    return (
      <div className="fullscreen-state">
        <ErrorState error={auth.error} retry={() => auth.refetch()} />
        <Button variant="secondary" onClick={onUnauthorized}>
          {t("app.disconnect")}
        </Button>
      </div>
    );
  return <AuthenticatedShell onUnauthorized={onUnauthorized} />;
}
/**
 * Keeps a member out of the gateway's own pages.
 *
 * The API refuses those endpoints to a member regardless (the team principal
 * gate), so this is not the security boundary — it is the difference between
 * "you cannot do that" and walking into a page that will only error. A member
 * who types one of these paths into the address bar lands back on the overview.
 */
function RouteGuard({ role, pathname }: { role: ConsoleRole; pathname: string }) {
  const navigate = useNavigate();
  const blocked =
    !isStaff(role) &&
    STAFF_ONLY_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));
  useEffect(() => {
    if (blocked) navigate("/", { replace: true });
  }, [blocked, navigate]);
  return null;
}

function AuthenticatedShell({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { t } = useI18n();
  const { addons } = useModules();
  // Which chrome entries the operator keeps (Settings → Appearance: the top
  // bar's controls and the navigation rows). Display only — see lib/topBar.ts.
  const chrome = useChromePrefs();
  const operatingMode = useOperatingMode();
  // Plugin entries the operator hid from the sidebar (a display preference,
  // stored per browser like the theme).
  const hiddenPlugins = useHiddenPlugins();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [operatorPromptReady, setOperatorPromptReady] = useState(false);
  const [operatorAccountOpen, setOperatorAccountOpen] = useState(false);
  const [operatorAccountBusy, setOperatorAccountBusy] = useState(false);
  const { client, role } = useSession();
  // A raw admin token (role === null) is the operator themselves, so it ranks
  // with an owner. Everything the console shows is then filtered by role:
  // staff get the gateway's pages, a member gets the pages that are theirs.
  const effectiveRole = role ?? "owner";
  const allowedFor = (item: ChromeNavItem) => canAccessNav(item, role);
  const usersRequest = useCallback(
    <T,>(path: string, init?: RequestInit) => client!.request<T>(path, init),
    [client],
  );
  // Real telemetry: channel health drives the deck readout instead of a static
  // ONLINE. It is the gateway's own plumbing, so a member never asks for it —
  // the readout simply reports nothing rather than an error.
  const channelStats = useQuery({
    queryKey: ["channel-overviews"],
    queryFn: ({ signal }) => api(client!).channelOverviews(signal),
    enabled: isStaff(role),
    refetchInterval: 30_000,
  });
  const healthy = (channelStats.data ?? []).filter(
    (o) => channelHealthState(o) === "healthy",
  ).length;
  const total = channelStats.data?.length ?? 0;

  // Build identity: /healthz is public and reports the injected version.
  const [gatewayVersion, setGatewayVersion] = useState("dev");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/healthz", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { version?: string } | null) => {
        if (body?.version) setGatewayVersion(body.version);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const updateCheck = useQuery({
    queryKey: ["update-check"],
    queryFn: ({ signal }) => api(client!).updateCheck(signal),
    // Releasing the gateway's image is an operator's decision.
    enabled: role === null || role === "owner",
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { scheme: theme, toggleScheme: changeTheme, appearance } = useAppearance();

  const location = useLocation();
  const navigate = useNavigate();
  const [setupWizardOpen, setSetupWizardOpen] = useState(() => location.pathname === "/setup");

  // 首次登录后若还没有站点，全局弹出设置引导；关闭或完成后记住选择。
  useEffect(() => {
    if (import.meta.env.VITEST) return;
    if (location.pathname === "/setup") {
      setSetupWizardOpen(true);
      return;
    }
    if (location.pathname === "/team") return;
    if (
      location.pathname === "/settings" &&
      ["mode", "runtime"].includes(new URLSearchParams(location.search).get("tab") ?? "")
    )
      return;
    if (!channelStats.isSuccess) return;
    if ((channelStats.data?.length ?? 0) !== 0) return;
    if (window.localStorage.getItem("mg.setup-wizard.done") === "1") return;
    setSetupWizardOpen(true);
  }, [channelStats.isSuccess, channelStats.data, location.pathname, location.search]);

  const closeSetupWizard = () => {
    setSetupWizardOpen(false);
    if (location.pathname === "/setup") navigate("/", { replace: true });
  };

  // The navigation is built from the shared catalogue (lib/chromeNav.ts), which
  // the appearance panel switches entry by entry. Plugin rows are appended from
  // runtime data and keep their own per-plugin hide switch.
  const enabledPlugins = addons
    .filter(
      (m) =>
        // Every enabled sidecar plugin gets a nav entry, whatever brought
        // it here — hand-registered ("sidecar") or market-installed
        // ("market:…"). Gating on the source string made market installs
        // invisible in the sidebar no matter what the plugin's own page
        // toggle said.
        m.installed &&
        m.enabled &&
        !!m.open_path &&
        (m.source === "sidecar" || m.source?.startsWith("market:")) &&
        // A plugin whose entry the operator hid keeps working (its hooks
        // still run); only the sidebar row goes away.
        !hiddenPlugins.has(m.id),
    )
    .map((m) => ({ to: m.open_path!, label: m.name, icon: Puzzle, group: "backup" as const }));

  // The multi-user area is gated by the operating mode (see lib/topBar.ts):
  // absence is the default on a personal gateway, and pinning the entry in the
  // appearance panel keeps it for an operator who wants the door early.
  const modeHidden = new Set(modeHiddenNav(operatingMode.data?.mode));
  const pinnedNav = new Set(chrome.pinnedNav);
  const modeHidesNav = (path: string) => modeHidden.has(path) && !pinnedNav.has(path);
  const registeredNav = CHROME_NAV_ITEMS.filter(allowedFor).map((item) => ({
    to: item.path,
    label: t(item.labelKey),
    icon: item.icon,
    group: item.group,
  }));
  const paletteNav = [...registeredNav.filter((item) => !modeHidesNav(item.to)), ...enabledPlugins];

  // 顶栏工作区和侧栏入口共用导航注册表，并按角色、运行模式和外观偏好过滤。
  const hidden = new Set(chrome.hiddenNav);
  const availableNav = [...registeredNav, ...enabledPlugins].filter(
    (item) => !modeHidesNav(item.to) && !hidden.has(item.to),
  );
  const modeAvailableNav = [...registeredNav, ...enabledPlugins].filter(
    (item) => !modeHidesNav(item.to),
  );
  const activeTopNavigation = chromeNavGroupForLocation(location.pathname, location.search);
  const activeGroup = CHROME_NAV_GROUPS.find((item) => item.id === activeTopNavigation)!;
  const topNavigation = CHROME_NAV_GROUPS.flatMap((group) => {
    const firstVisible = availableNav.find((item) => item.group === group.id);
    const firstAvailable = modeAvailableNav.find((item) => item.group === group.id);
    if (!firstAvailable) return [];
    return [
      {
        id: group.id,
        label: t(group.labelKey),
        to: firstVisible?.to ?? firstAvailable.to,
      },
    ];
  });
  const navSections = [
    {
      label: t(activeGroup.labelKey),
      items: availableNav
        .filter((item) => item.group === activeTopNavigation)
        .map(({ to, label, icon }) => ({ to, label, icon })),
    },
  ];

  return (
    <>
      <OperatorUpgradePrompt onReady={setOperatorPromptReady} />
      {/* Gated on the claim prompt so the two dialogs never stack: the account
          comes first, then the deployment file. */}
      <DeploymentStepPrompt enabled={operatorPromptReady} />
      {operatorAccountOpen ? (
        <Dialog
          title={t("operator.title")}
          onClose={() => setOperatorAccountOpen(false)}
          busy={operatorAccountBusy}
          className="operator-claim-dialog"
        >
          <OperatorClaimPanel
            onBusyChange={setOperatorAccountBusy}
            onSaved={() => setOperatorAccountOpen(false)}
          />
        </Dialog>
      ) : null}
      <ConsoleShell
        appearance={appearance}
        sections={navSections}
        topNavigation={topNavigation}
        activeTopNavigation={activeTopNavigation}
        onSelectTopNavigation={(to) => navigate(to)}
        showAdminAccount={role === null || role === "owner"}
        showMemberAccount={role === "member" || role === "admin"}
        onOpenAdminAccount={() => setOperatorAccountOpen(true)}
        appearanceHiddenNav={modeHiddenNav(operatingMode.data?.mode)}
        version={gatewayVersion}
        theme={theme}
        onThemeChange={changeTheme}
        onDisconnect={onUnauthorized}
        health={{ healthy, total, loading: channelStats.isPending, available: isStaff(role) }}
        update={
          (role === null || role === "owner") && updateCheck.data?.has_update
            ? updateCheck.data
            : undefined
        }
      >
        <RouteGuard role={effectiveRole} pathname={location.pathname} />
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="setup" element={<Dashboard />} />
            <Route path="channels" element={<Channels />} />
            <Route path="backups" element={<Backups />} />
            <Route path="models/channel/:channelId" element={<ChannelModels />} />
            <Route path="models" element={<Models />} />
            <Route path="keys" element={<Keys />} />
            {/* A member's own account: credit, request preferences, the
						    member app's former settings page, at the member's own path. */}
            <Route
              path="account"
              element={role === null ? <Navigate to="/settings" replace /> : <AccountPage />}
            />
            <Route path="users" element={<UsersLayout request={usersRequest} />}>
              <Route index element={<Navigate to="members" replace />} />
              <Route path="overview" element={<Navigate to="/users/members" replace />} />
              <Route path="members" element={<UsersBoards.MembersPanel />} />
              <Route path="policies" element={<UsersBoards.PoliciesPanel />} />
              <Route path="quotas" element={<UsersBoards.QuotasPanel />} />
              <Route path="pricing" element={<UsersBoards.PricingPanel />} />
              <Route path="codes" element={<UsersBoards.CodesPanel />} />
              <Route path="oauth" element={<UsersBoards.OAuthRoutePanel />} />
              <Route path="branding" element={<UsersBoards.BrandingPanel />} />
            </Route>
            {/* /team was this module's first path. It stays a redirect so old links
						    land on the module instead of the dashboard. */}
            <Route path="team" element={<Navigate to="/users" replace />} />
            <Route path="workbench" element={<Workbench />} />
            <Route path="logs" element={<Logs />} />
            <Route path="system-logs" element={<SystemLogs />} />
            <Route path="checkins" element={<Checkins />} />
            <Route path="exchange" element={<ExchangePage />} />
            <Route path="settings" element={<Maintain />} />
            {/* /maintain was the original path for this page. It is kept as a
						    redirect (not a second mount) so one page has one URL: two live
						    routes forked browser history, bookmarks and deep links. The
						    search string carries over so /maintain?tab=backups still lands
						    on the right tab. */}
            <Route
              path="maintain"
              element={<Navigate to={`/settings${location.search}`} replace />}
            />
            <Route path="store" element={<Store />} />
            <Route path="plugins/:id" element={<PluginHost />} />
            <Route path="sites/*" element={<Navigate to="/" replace />} />
            <Route path="routing" element={<Navigate to="/models" replace />} />
            <Route path="operations" element={<Navigate to="/logs?tab=discovery" replace />} />
            <Route path="assets" element={<Navigate to="/" replace />} />
            <Route path="dashboard" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ConsoleShell>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} nav={paletteNav} />
      <GuidedTour enabled={isStaff(role) && operatorPromptReady && !setupWizardOpen} />
      {setupWizardOpen && operatorPromptReady ? <SetupWizard onClose={closeSetupWizard} /> : null}
    </>
  );
}
