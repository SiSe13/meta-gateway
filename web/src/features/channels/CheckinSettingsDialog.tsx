import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChannelOverview } from "../../api/types";
import { api } from "../../api/client";
import { Button, Dialog, ErrorState, Field } from "../../components/ui";
import { SearchableSelect } from "../../components/SearchableSelect";
import { useAdminMutation } from "../../hooks/useAdminMutation";
import { credentialPatch, credentialShouldBeRemoved } from "./credentialPatch";
import { SECRET_MASK, userAuthFieldsFor } from "./helpers";
import { parseCredentialMeta, withCredentialMetaValue } from "../credentialMeta";
import { userCredentialFor } from "./channelCredentials";
import { useSession } from "../../session";

type Text = (key: string, vars?: Record<string, string | number>) => string;

export function CheckinSettingsDialog({
  overview,
  enabled,
  manageCheckin = true,
  t,
  onClose,
  setCheckin,
}: {
  overview: ChannelOverview;
  enabled: boolean;
  manageCheckin?: boolean;
  t: Text;
  onClose: () => void;
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
  const [userToken, setUserToken] = useState("");
  const [userCookie, setUserCookie] = useState("");
  const [checkinPath, setCheckinPath] = useState("");
  const [checkinMethod, setCheckinMethod] = useState("");
  const [seededId, setSeededId] = useState<number | null>(null);
  const credentialMeta = parseCredentialMeta(credential?.meta_json);
  const storedUserID = credentialMeta.platform_user_id;
  const storedCheckinPath = credentialMeta.checkin_path;
  const storedCheckinMethod = credentialMeta.checkin_method;
  const defaultCheckinPath = defaultCheckinPathFor(overview.channel.type_hint ?? "");

  useEffect(() => {
    if (credentials.isPending) return;
    const nextSeededId = credential?.id ?? 0;
    if (nextSeededId === seededId) return;
    setSeededId(nextSeededId);
    setUserID(storedUserID ? String(storedUserID) : "");
    setUserToken(credential?.has_secret ? SECRET_MASK : "");
    setUserCookie(credential?.has_cookie ? SECRET_MASK : "");
    setCheckinPath(storedCheckinPath || defaultCheckinPath);
    setCheckinMethod(storedCheckinMethod || "");
  }, [
    credential,
    credentials.isPending,
    defaultCheckinPath,
    seededId,
    storedCheckinMethod,
    storedCheckinPath,
    storedUserID,
  ]);

  const save = useAdminMutation({
    mutationFn: async () => {
      const normalizedID = userID.trim();
      if (manageCheckin && enabled && !/^[1-9][0-9]*$/.test(normalizedID)) {
        throw new Error(t("channels.userIDInvalid"));
      }
      const nextID = normalizedID ? Number(normalizedID) : undefined;
      const normalizedPath = checkinPath.trim();
      if (manageCheckin && normalizedPath && !isValidCheckinPath(normalizedPath)) {
        throw new Error(t("channels.checkinPathInvalid"));
      }

      const tokenRaw = userToken.trim();
      const cookieRaw = userCookie.trim();
      const tokenKept = tokenRaw === SECRET_MASK;
      const cookieKept = cookieRaw === SECRET_MASK;
      const token = tokenKept ? "" : tokenRaw;
      const cookie = cookieKept ? "" : cookieRaw;
      const authMode = cookieKept
        ? credential?.auth_mode || (token ? "access_token" : "cookie")
        : cookie
          ? token
            ? "auto"
            : "cookie"
          : "access_token";
      const secretChanged = !tokenKept && (token !== "" || Boolean(credential?.has_secret));
      const cookieChanged = !cookieKept && (cookie !== "" || Boolean(credential?.has_cookie));
      if (
        manageCheckin &&
        enabled &&
        !token &&
        !cookie &&
        !credential?.has_secret &&
        !credential?.has_cookie
      ) {
        throw new Error(t("channels.checkinNeedsUserCredential"));
      }

      let savedCredentialId = credential?.id;
      const checkinEnabled = credential?.checkin_enabled ?? false;
      if (
        credential &&
        credentialShouldBeRemoved({
          userCred: credential,
          userToken: token,
          userCookie: cookie,
          secretChanged,
          cookieChanged,
        })
      ) {
        await service.deleteCredential(credential.id);
        return null;
      }

      if (credential) {
        const checkinPathChanged =
          manageCheckin && normalizedPath !== (storedCheckinPath || defaultCheckinPath);
        const checkinMethodChanged = manageCheckin && checkinMethod !== (storedCheckinMethod || "");
        const userIDChanged = manageCheckin && nextID !== storedUserID;
        const patch = credentialPatch({
          userCred: credential,
          userToken: token,
          userCookie: cookie,
          userID: nextID,
          userAuthMode: authMode,
          secretChanged,
          cookieChanged,
          metaChanged: userIDChanged,
        }) as Parameters<typeof service.updateCredential>[1];
        if (checkinPathChanged || checkinMethodChanged) {
          let nextMeta = userCredMeta(credential?.meta_json, normalizedPath, defaultCheckinPath);
          if (checkinMethodChanged) {
            nextMeta = withCredentialMetaValue(
              nextMeta,
              "checkin_method",
              checkinMethod || undefined,
            );
          }
          if (userIDChanged) {
            nextMeta = withCredentialMetaValue(nextMeta, "platform_user_id", nextID);
          }
          patch.meta_json = nextMeta;
        }
        if (Object.keys(patch).length > 0) {
          await service.updateCredential(credential.id, patch);
        }
      } else if ((token || cookie) && siteId) {
        let metaJSON: string | undefined;
        if (manageCheckin && normalizedPath !== defaultCheckinPath) {
          metaJSON = withCredentialMetaValue(metaJSON, "checkin_path", normalizedPath || undefined);
        }
        if (manageCheckin && checkinMethod) {
          metaJSON = withCredentialMetaValue(metaJSON, "checkin_method", checkinMethod);
        }
        if (manageCheckin && nextID) {
          metaJSON = withCredentialMetaValue(metaJSON, "platform_user_id", nextID);
        }
        const created = await service.createCredential(siteId, {
          kind: "access_token",
          ...(token ? { secret: token } : {}),
          ...(cookie ? { cookie } : {}),
          ...(metaJSON ? { meta_json: metaJSON } : {}),
          auth_mode: authMode,
          status: "enabled",
        });
        savedCredentialId = created.id;
      }

      if (
        manageCheckin &&
        savedCredentialId &&
        (checkinEnabled !== enabled || nextID !== storedUserID)
      ) {
        await setCheckin({ credentialId: savedCredentialId, enabled });
      }
      return savedCredentialId ?? null;
    },
    invalidateKeys: [["credentials"], ["channel-overviews"], ["runtime-settings"]],
    onSuccess: onClose,
  });

  const userIDInvalid = userID !== "" && !/^[1-9][0-9]*$/.test(userID.trim());
  const checkinPathInvalid = checkinPath.trim() !== "" && !isValidCheckinPath(checkinPath.trim());
  const loading = credentials.isPending;
  const busy = save.isPending;
  const authFields = userAuthFieldsFor(overview.channel.type_hint ?? "");
  const showToken = authFields === "both" || authFields === "none";
  const showCookie = authFields === "both" || authFields === "cookie";
  const hasCredentialMaterial =
    (userToken === SECRET_MASK && Boolean(credential?.has_secret)) ||
    (userCookie === SECRET_MASK && Boolean(credential?.has_cookie)) ||
    (userToken.trim() !== "" && userToken !== SECRET_MASK) ||
    (userCookie.trim() !== "" && userCookie !== SECRET_MASK);

  return (
    <Dialog
      title={manageCheckin ? t("channels.checkinSection") : t("channels.userCredentialSettings")}
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
              busy ||
              loading ||
              (manageCheckin &&
                enabled &&
                (!userID.trim() || userIDInvalid || !hasCredentialMaterial))
            }
            onClick={() => save.mutate()}
          >
            {manageCheckin && enabled && !overview.checkin_enabled
              ? t("channels.checkinEnable")
              : t("common.save")}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <div className="checkin-settings-fields">
          {showToken ? (
            <Field
              label={t("channels.userToken")}
              hint={
                credential?.has_secret
                  ? t("channels.userTokenPresentHint")
                  : t("channels.userTokenHint")
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                value={userToken}
                onChange={(event) => setUserToken(event.target.value)}
                placeholder={
                  credential?.has_secret
                    ? t("channels.editSecretPlaceholder")
                    : t("channels.userTokenEmptyPlaceholder")
                }
                disabled={busy}
              />
            </Field>
          ) : null}
          {showCookie ? (
            <Field
              label={t("channels.userCookie")}
              hint={
                credential?.has_cookie
                  ? t("channels.userCookiePresentHint")
                  : t("channels.userCookieHint")
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                value={userCookie}
                onChange={(event) => setUserCookie(event.target.value)}
                placeholder={
                  credential?.has_cookie
                    ? t("channels.editSecretPlaceholder")
                    : t("channels.userCookiePlaceholder")
                }
                disabled={busy}
              />
            </Field>
          ) : null}
          {manageCheckin ? (
            <div className="checkin-endpoint-grid">
              <Field
                label={t("channels.checkinPath")}
                hint={t("channels.checkinPathHint", { path: defaultCheckinPath })}
                error={checkinPathInvalid ? t("channels.checkinPathInvalid") : undefined}
              >
                <input
                  type="text"
                  value={checkinPath}
                  onChange={(event) => setCheckinPath(event.target.value)}
                  placeholder={defaultCheckinPath}
                  disabled={busy}
                />
              </Field>
              <Field label={t("channels.checkinMethod")} hint={t("channels.checkinMethodHint")}>
                <SearchableSelect
                  ariaLabel={t("channels.checkinMethod")}
                  value={checkinMethod}
                  onChange={setCheckinMethod}
                  disabled={busy}
                  options={[
                    { value: "", label: t("channels.checkinMethodDefault") },
                    { value: "POST", label: "POST" },
                    { value: "GET", label: "GET" },
                  ]}
                />
              </Field>
            </div>
          ) : null}
          {manageCheckin ? (
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
          ) : null}
          {save.isError ? <ErrorState error={save.error} /> : null}
        </div>
      )}
    </Dialog>
  );
}

/** 外部签到站默认使用活动接口，New-API 系使用标准用户签到接口。 */
function defaultCheckinPathFor(typeHint: string): string {
  return typeHint.trim().toLowerCase() === "external-checkin"
    ? "/api/checkin/spin"
    : "/api/user/checkin";
}

/** 签到路径只允许站点内的绝对路径，避免覆盖站点域名或 URL 参数。 */
function isValidCheckinPath(path: string): boolean {
  return path.startsWith("/") && !/[\\?#%]/.test(path) && !path.split("/").includes("..");
}

/** 将默认路径作为“无覆盖”保存，避免以后默认值更新后被旧值钉死。 */
function userCredMeta(metaJSON: string | undefined, path: string, defaultPath: string): string {
  return withCredentialMetaValue(
    metaJSON,
    "checkin_path",
    path && path !== defaultPath ? path : undefined,
  );
}
