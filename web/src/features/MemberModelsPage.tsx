import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Field, Loading, ErrorState, TextInput } from "../components/ui";
import { useI18n } from "../i18n";
import { useToast } from "../toast";
import { accountRequest } from "../team/transport";
import { teamText, teamError } from "../team/text";
import type { Account, Plan } from "../team/types";
import { ModelsWorkspace } from "../member/ModelsWorkspace";

/**
 * The member's model page, inside the console.
 *
 * The page body is the member app's own (`ModelsWorkspace`): the catalogue they
 * may call and their arrangement editor. What this
 * wrapper adds is the data the workspace expects its host to have fetched —
 * account and plans — because in the member shell that
 * host was `UserApp`, and the console is not going to grow a second copy of the
 * member shell to satisfy a prop list.
 *
 * The arrangement choice is remembered under the member app's own key, so a
 * plan selected before the move is still selected after it.
 */
const PLAN_KEY = "meta-gateway.team.plan";

export function MemberModelsPage() {
  const { locale } = useI18n();
  const t = teamText(locale);
  const { push } = useToast();
  const qc = useQueryClient();
  const [planId, setPlanId] = useState(() => {
    try {
      return Number(localStorage.getItem(PLAN_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  });
  const [busy, setBusy] = useState(false);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const account = useQuery({
    queryKey: ["me", "account"],
    queryFn: ({ signal }) => accountRequest<Account>("/me", { signal }),
  });
  const userID = account.data?.user.id;
  const canRoute = Boolean(account.data?.user.allow_routing && account.data?.branding.show_routing);
  const plans = useQuery({
    queryKey: ["user", userID, "plans"],
    queryFn: ({ signal }) => accountRequest<Plan[]>("/me/plans", { signal }),
    enabled: Boolean(userID) && canRoute,
  });
  const selectPlan = useCallback((id: number) => {
    setPlanId(id);
    try {
      localStorage.setItem(PLAN_KEY, String(id));
    } catch {
      /* optional preference */
    }
  }, []);
  const createPlan = useCallback(async () => {
    const name = newPlanName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const created = await accountRequest<Plan>("/me/plans", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      await qc.invalidateQueries({ queryKey: ["user", userID, "plans"] });
      if (created?.id) selectPlan(created.id);
      setNewPlanName("");
      setNewPlanOpen(false);
    } catch (error) {
      push({ message: teamError(error, locale), tone: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, locale, newPlanName, qc, selectPlan, userID, push]);

  if (account.isPending) return <Loading />;
  if (!account.data)
    return <ErrorState error={account.error} retry={() => void account.refetch()} />;
  return (
    <>
      <ModelsWorkspace
        userID={account.data.user.id}
        locale={locale}
        canRoute={canRoute}
        plans={plans.data ?? []}
        planId={planId}
        onPlanChange={selectPlan}
        onCreatePlan={() => {
          setNewPlanName("");
          setNewPlanOpen(true);
        }}
      />
      {newPlanOpen ? (
        <Dialog
          title={t("newPlan")}
          busy={busy}
          onClose={() => setNewPlanOpen(false)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setNewPlanOpen(false)}>
                {t("close")}
              </Button>
              <Button
                disabled={!newPlanName.trim()}
                loading={busy}
                onClick={() => void createPlan()}
              >
                {t("create")}
              </Button>
            </>
          }
        >
          <Field label={t("planName")}>
            <TextInput
              autoFocus
              maxLength={80}
              value={newPlanName}
              onChange={(event) => setNewPlanName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createPlan();
                }
              }}
            />
          </Field>
        </Dialog>
      ) : null}
      {busy ? <Loading /> : null}
    </>
  );
}
