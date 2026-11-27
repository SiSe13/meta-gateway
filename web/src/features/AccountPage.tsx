import { useQuery } from "@tanstack/react-query";
import { ErrorState, Loading } from "../components/ui";
import { useI18n } from "../i18n";
import { useSession } from "../session";
import { accountRequest } from "../team/transport";
import { teamText } from "../team/text";
import type { Account } from "../team/types";
import { SettingsPage } from "../member/SettingsPage";

/**
 * The console's account page: the member app's settings, at a console path.
 *
 * The console's personal information page. Password changes live in the
 * profile menu, while appearance remains in the global appearance panel.
 */
export function AccountPage() {
  const { locale, t: consoleT } = useI18n();
  const t = teamText(locale);
  const { disconnect, role } = useSession();

  const account = useQuery({
    queryKey: ["me", "account"],
    queryFn: ({ signal }) => accountRequest<Account>("/me", { signal }),
  });

  if (account.isPending) return <Loading />;
  if (account.isError) {
    // /me speaks for a team account; a raw admin token has none. Saying so is
    // more useful than echoing a login error the operator cannot act on — the
    // page works the moment they sign in with an owner or member account.
    if (role === null)
      return (
        <div className="page-head">
          <h1>{consoleT("app.nav.account")}</h1>
          <p className="muted">{consoleT("account.needsTeamSession")}</p>
        </div>
      );
    return <ErrorState error={account.error} retry={() => void account.refetch()} />;
  }
  if (!account.data) return null;
  return <SettingsPage account={account.data} t={t} onDisconnected={disconnect} />;
}
