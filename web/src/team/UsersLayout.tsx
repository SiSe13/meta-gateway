import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "../i18n";
import { ErrorState, Loading, Page } from "../components/ui";
import { teamText } from "./text";
import type { ModeInfo, TeamRequest, TeamSettings } from "./types";
import type { UsersContext } from "./UsersContext";
import { ModePanel } from "./ModePanel";

/**
 * The multi-user module supplies its page content to the console's shared shell.
 *
 * The shared shell owns the left navigation, so this layout must not render a
 * second row of tabs. In personal mode the module still needs a way to enable
 * team accounts; keep that action in the page body without exposing an
 * Overview navigation item.
 *
 * Page access remains role-gated by the application and server. The page
 * components also keep their existing owner-only data and write checks.
 */
export function UsersLayout({ request }: { request: TeamRequest }) {
  // The transport is handed in rather than taken from the console session:
  // these boards are also reachable by a member-scoped session and must not
  // reach for the admin client (an ESLint boundary enforces it).
  const { locale } = useI18n();
  const t = teamText(locale);
  // `/admin/mode` answers on either gateway and is what tells this shell which
  // one it is running on. `/admin/team/settings` deliberately does not: it sits
  // behind the mode gate and 404s while the gateway is personal — asking it
  // first would make the module's own front door an error page.
  const mode = useQuery({
    queryKey: ["team", "mode"],
    queryFn: ({ signal }) => request<ModeInfo>("/admin/mode", { signal }),
  });
  const enabled = mode.data?.mode === "team";
  const settings = useQuery({
    queryKey: ["team", "settings"],
    queryFn: ({ signal }) =>
      request<{ settings: TeamSettings; has_owner: boolean; role: string }>(
        "/admin/team/settings",
        { signal },
      ),
    enabled,
  });

  if (mode.isPending) return <Loading />;
  if (mode.isError) return <ErrorState error={mode.error} retry={() => void mode.refetch()} />;
  const info = mode.data;
  if (!info) return null;
  // Owner and has_owner come from the settings document while the module is on
  // (it reflects the live roster); on a personal gateway there is no roster to
  // read, so the ungated mode payload answers instead.
  const owner = (settings.data?.role ?? info.role) === "owner";
  const hasOwner = settings.data?.has_owner ?? info.has_owner;
  const teamSettings: TeamSettings = settings.data?.settings ?? {
    mode: info.mode,
    branding: {
      name: "Balbo AI",
      accent: "#275b85",
      logo_url: "",
      notice: "",
      login_description: "",
      api_base_url: "",
      show_usage: true,
      show_routing: true,
    },
  };
  // Before team mode is enabled, member and group endpoints are intentionally
  // not mounted. The owner can still enable the module here without restoring
  // an Overview item to the left navigation.
  if (!enabled) {
    return (
      <Page
        as="section"
        className="team-surface"
        title={t("team")}
        description={t("teamDescription")}
      >
        <div className="team-board">
          <p className="panel-hint">{t("modeHint")}</p>
          <ModePanel request={request} locale={locale} />
        </div>
      </Page>
    );
  }

  return (
    <Page
      as="section"
      className="team-surface"
      title={t("team")}
      description={t("teamDescription")}
      hideHeading
    >
      <Outlet
        context={
          {
            request,
            locale,
            t,
            owner,
            settings: teamSettings,
            hasOwner,
          } satisfies UsersContext
        }
      />
    </Page>
  );
}
