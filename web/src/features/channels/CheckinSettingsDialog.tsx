import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChannelOverview } from "../../api/types";
import { api } from "../../api/client";
import { Button, Dialog, ErrorState, Field } from "../../components/ui";
import { useAdminMutation } from "../../hooks/useAdminMutation";
import { parseCredentialMeta, withCredentialMetaValue } from "../credentialMeta";
import { userCredentialFor } from "./channelCredentials";
import { useSession } from "../../session";

type Text = (key: string, vars?: Record<string, string | number>) => string;

export function CheckinSettingsDialog({
  overview,
  enabled,
  t,
  onClose,
  onEditCredential,
  setCheckin,
}: {
  overview: ChannelOverview;
  enabled: boolean;
  t: Text;
  onClose: () => void;
  onEditCredential: () => void;
  setCheckin: (input: { credentialId: number; enabled: boolean }) => Promise<unknown>;
}) {
  const { client } = useSession();
  const service = api(client!);
  const siteId = overview.channel.site_id;
  const credentials = useQuery({
    queryKey: ["credentials", siteId],
    queryFn: ({ signal }) => service.credentials(siteId!, signal),
    enabled: typeof siteId === "number" && siteId > 0,
  });
  const credential = userCredentialFor(overview, credentials.data ?? []);
  const [userID, setUserID] = useState("");
  const [seededId, setSeededId] = useState<number | null>(null);
  const storedUserID = parseCredentialMeta(credential?.meta_json).platform_user_id;

  useEffect(() => {
    if (!credential || credential.id === seededId) return;
    setSeededId(credential.id);
    setUserID(storedUserID ? String(storedUserID) : "");
  }, [credential, seededId, storedUserID]);

  const save = useAdminMutation({
    mutationFn: async () => {
      if (!credential) throw new Error(t("channels.checkinNeedsUserCredential"));
      const normalizedID = userID.trim();
      if (enabled && !/^[1-9][0-9]*$/.test(normalizedID)) {
        throw new Error(t("channels.userIDInvalid"));
      }
      const nextID = normalizedID ? Number(normalizedID) : undefined;
      if (nextID !== storedUserID) {
        await service.updateCredential(credential.id, {
          meta_json: withCredentialMetaValue(credential.meta_json, "platform_user_id", nextID),
        });
      }
      if (credential.checkin_enabled !== enabled || nextID !== storedUserID) {
        await setCheckin({ credentialId: credential.id, enabled });
      }
      return credential.id;
    },
    invalidateKeys: [["credentials"], ["channel-overviews"], ["runtime-settings"]],
    onSuccess: onClose,
  });

  const userIDInvalid = userID !== "" && !/^[1-9][0-9]*$/.test(userID.trim());
  const loading = credentials.isPending;
  const busy = save.isPending;

  return (
    <Dialog
      title={t("channels.checkinSection")}
      onClose={onClose}
      busy={busy}
      className="checkin-settings-dialog"
      actions={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={
              busy || loading || !credential || (enabled && (!userID.trim() || userIDInvalid))
            }
            onClick={() => save.mutate()}
          >
            {enabled ? t("channels.checkinEnable") : t("common.save")}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="muted">{t("common.loading")}</p>
      ) : !credential ? (
        <div className="checkin-settings-missing">
          <p>{t("channels.checkinNeedsUserCredential")}</p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              onClose();
              onEditCredential();
            }}
          >
            {t("common.edit")}
          </Button>
        </div>
      ) : (
        <div className="checkin-settings-fields">
          <p className="muted">
            {enabled ? t("channels.checkinEnable") : t("channels.checkinDisable")}
          </p>
          <Field
            label={t("channels.userID")}
            hint={t("channels.userIDHint")}
            required={enabled}
            error={userIDInvalid ? t("channels.userIDInvalid") : undefined}
          >
            <input
              inputMode="numeric"
              value={userID}
              onChange={(event) => setUserID(event.target.value.trim())}
              placeholder={t("channels.userIDPlaceholder")}
              disabled={busy}
            />
          </Field>
          {save.isError ? <ErrorState error={save.error} /> : null}
        </div>
      )}
    </Dialog>
  );
}
