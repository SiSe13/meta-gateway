import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActionMenu } from "../../components/ActionMenu";
import {
  Button,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Panel,
  StatusBadge,
} from "../../components/ui";
import { teamError } from "../text";
import { useTeamMutation } from "../useTeamMutation";
import { useUsers } from "../UsersContext";
import type { Candidate, Policy } from "../types";

/** 新建授权分组的默认值，与服务端校验保持一致。 */
const EMPTY_POLICY: Policy = {
  id: 0,
  name: "",
  models: [],
  member_ids: [],
  all_models: false,
  user_count: 0,
};
/**
 * 授权分组保存可调用模型与渠道范围；账户限制在成员详情中配置。
 */
export function PoliciesPanel() {
  const { request, locale, t } = useUsers();
  const { busy, error, run } = useTeamMutation(request, t);
  const [editing, setEditing] = useState<Policy | null>(null);
  const policies = useQuery({
    queryKey: ["team", "policies"],
    queryFn: ({ signal }) => request<Policy[]>("/admin/team/policies", { signal }),
  });
  const candidates = useQuery({
    queryKey: ["team", "candidates"],
    queryFn: ({ signal }) => request<Candidate[]>("/admin/team/candidates", { signal }),
    enabled: editing !== null,
  });
  const failure = error || policies.error;

  return (
    <div className="team-board">
      {failure ? <ErrorState error={failure} /> : null}
      <Panel
        title={t("policies")}
        titleHelp={t("policiesHint")}
        actions={<Button onClick={() => setEditing({ ...EMPTY_POLICY })}>{t("newPolicy")}</Button>}
      >
        <DataTable
          headers={[t("name"), t("modelScope"), t("routeGrants"), t("assignedUsers"), ""]}
          empty={!policies.data?.length}
        >
          {policies.data?.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>
                {p.all_models ? t("allModelsShort") : `${p.models.length}${t("modelCountUnit")}`}
              </td>
              <td>{`${p.member_ids.length}${t("routeGrantUnit")}`}</td>
              <td>{`${p.user_count}${t("userCountUnit")}`}</td>
              <td className="row-actions">
                <ActionMenu
                  compact
                  label={t("moreActions")}
                  items={[
                    {
                      key: "edit",
                      label: t("edit"),
                      onSelect: () => setEditing(structuredClone(p)),
                    },
                    // 默认授权分组供新成员使用；删除后会让账户失去默认分组。
                    ...(p.id === 1
                      ? []
                      : [
                          {
                            key: "delete",
                            group: t("dangerZone"),
                            label: t("delete"),
                            danger: true,
                            disabled: busy,
                            onSelect: () => {
                              if (confirm(t("deletionWarning")))
                                void run(`/admin/team/policies/${p.id}`, "DELETE");
                            },
                          },
                        ]),
                  ]}
                />
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
      {editing && (
        <Dialog title={t("policy")} busy={busy} onClose={() => setEditing(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (confirm(t("policyChanged")))
                void run(
                  `/admin/team/policies${editing.id ? `/${editing.id}` : ""}`,
                  editing.id ? "PUT" : "POST",
                  {
                    ...editing,
                    models: editing.models.map((m) => m.trim()).filter(Boolean),
                  },
                  () => setEditing(null),
                );
            }}
          >
            <Field label={t("name")}>
              <input
                value={editing.name}
                required
                maxLength={80}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <label className="check marginless">
              <input
                type="checkbox"
                checked={editing.all_models}
                onChange={(e) => setEditing({ ...editing, all_models: e.target.checked })}
              />
              <span>{t("allModels")}</span>
            </label>
            {!editing.all_models && (
              <Field label={t("modelList")}>
                <textarea
                  value={editing.models.join("\n")}
                  onChange={(e) => setEditing({ ...editing, models: e.target.value.split("\n") })}
                />
              </Field>
            )}
            <section className="drawer-section">
              <h3>{t("candidates")}</h3>
              <p className="panel-hint">{t("candidatesHint")}</p>
              <div className="team-candidates">
                {candidates.data?.length ? (
                  candidates.data.map((c) => (
                    <label className="check marginless" key={c.id}>
                      <input
                        type="checkbox"
                        checked={editing.member_ids.includes(c.id)}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            member_ids: e.target.checked
                              ? [...editing.member_ids, c.id]
                              : editing.member_ids.filter((id) => id !== c.id),
                            // Granting a member also grants the model it serves:
                            // the two lists describe one decision, so they move
                            // together instead of leaving the model unreachable.
                            models: e.target.checked
                              ? [...new Set([...editing.models.filter(Boolean), c.model])]
                              : editing.models,
                          })
                        }
                      />
                      <span>
                        {c.model} · {c.name} <small>#{c.id}</small>
                        {c.enabled ? null : <StatusBadge value={false} />}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="panel-hint">{t("noCandidates")}</p>
                )}
              </div>
            </section>
            {error ? (
              <p role="alert" className="inline-error">
                {teamError(error, locale)}
              </p>
            ) : null}
            <div className="form-actions">
              <Button type="submit" loading={busy}>
                {t("save")}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
