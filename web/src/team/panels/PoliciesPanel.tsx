import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  InfoTip,
  Panel,
  StatusBadge,
  TextInput,
  CheckboxControl,
} from "../../components/ui";
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
  const { request, t } = useUsers();
  const { busy, error, run } = useTeamMutation(request, t);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    | {
        kind: "save";
        path: string;
        method: "POST" | "PUT";
        body: Omit<Policy, "id"> & { id?: number };
      }
    | { kind: "delete"; policyId: number }
    | null
  >(null);
  const [expandedModels, setExpandedModels] = useState<Set<string>>(() => new Set());
  const policies = useQuery({
    queryKey: ["team", "policies"],
    queryFn: ({ signal }) => request<Policy[]>("/admin/team/policies", { signal }),
  });
  const candidates = useQuery({
    queryKey: ["team", "candidates"],
    queryFn: ({ signal }) => request<Candidate[]>("/admin/team/candidates", { signal }),
    enabled: editing !== null,
  });
  const failure = error || policies.error || candidates.error;
  const modelOptions = Array.from(
    new Set([
      ...(candidates.data ?? []).map((candidate) => candidate.model),
      ...(editing?.models ?? []),
    ]),
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const channelCounts = new Map<string, number>();
  for (const candidate of candidates.data ?? []) {
    channelCounts.set(candidate.model, (channelCounts.get(candidate.model) ?? 0) + 1);
  }
  const visibleCandidates = (candidates.data ?? []).filter(
    (candidate) => editing?.all_models || editing?.models.includes(candidate.model),
  );
  const candidatesByModel = visibleCandidates.reduce((groups, candidate) => {
    const modelCandidates = groups.get(candidate.model) ?? [];
    modelCandidates.push(candidate);
    groups.set(candidate.model, modelCandidates);
    return groups;
  }, new Map<string, Candidate[]>());

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
                <Button
                  variant="quiet"
                  className="policy-edit-button"
                  onClick={() => setEditing(structuredClone(p))}
                >
                  {t("edit")}
                </Button>
                {/* 默认授权分组供新成员使用；删除后会让账户失去默认分组。 */}
                {p.id === 1 ? null : (
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => setConfirmAction({ kind: "delete", policyId: p.id })}
                  >
                    {t("delete")}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
      {editing && (
        <Dialog
          title={t("policy")}
          className="policy-editor-dialog"
          busy={busy}
          onClose={() => setEditing(null)}
          actions={
            <Button type="submit" form="policy-editor-form" loading={busy}>
              {t("save")}
            </Button>
          }
        >
          <form
            id="policy-editor-form"
            className="policy-editor-form"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirmAction({
                kind: "save",
                path: `/admin/team/policies${editing.id ? `/${editing.id}` : ""}`,
                method: editing.id ? "PUT" : "POST",
                body: {
                  ...editing,
                  models: [...new Set(editing.models.map((m) => m.trim()).filter(Boolean))],
                },
              });
            }}
          >
            <Field label={t("name")}>
              <TextInput
                value={editing.name}
                required
                maxLength={80}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <label className="check marginless">
              <CheckboxControl
                checked={editing.all_models}
                onChange={(e) => {
                  const allModels = e.target.checked;
                  setEditing({
                    ...editing,
                    all_models: allModels,
                    models: allModels ? modelOptions : [],
                    member_ids: allModels ? editing.member_ids : [],
                  });
                }}
              />
              <span>{t("allModels")}</span>
            </label>
            {!editing.all_models && (
              <fieldset className="policy-model-picker">
                <legend>{t("modelList")}</legend>
                <div className="policy-model-options">
                  {candidates.isLoading ? (
                    <p className="panel-hint">{t("load")}</p>
                  ) : modelOptions.length ? (
                    modelOptions.map((model) => {
                      const selected = editing.models.includes(model);
                      return (
                        <label className="check marginless" key={model}>
                          <CheckboxControl
                            checked={selected}
                            onChange={(e) => {
                              const nextModels = e.target.checked
                                ? [...editing.models, model]
                                : editing.models.filter((item) => item !== model);
                              const allowedMemberIds = new Set(
                                (candidates.data ?? [])
                                  .filter((candidate) => nextModels.includes(candidate.model))
                                  .map((candidate) => candidate.id),
                              );
                              const allModelsSelected =
                                modelOptions.length > 0 &&
                                modelOptions.every((item) => nextModels.includes(item));
                              setEditing({
                                ...editing,
                                all_models: allModelsSelected,
                                models: nextModels,
                                member_ids: editing.member_ids.filter((id) =>
                                  allowedMemberIds.has(id),
                                ),
                              });
                            }}
                          />
                          <span>
                            {model}{" "}
                            <small>
                              {t("modelChannelCount", { count: channelCounts.get(model) ?? 0 })}
                            </small>
                          </span>
                        </label>
                      );
                    })
                  ) : (
                    <p className="panel-hint">{t("noCandidates")}</p>
                  )}
                </div>
              </fieldset>
            )}
            <section className="drawer-section">
              <div className="policy-channel-heading">
                <h3>
                  {t("candidates")} <InfoTip label={t("candidatesHint")} />
                </h3>
                {visibleCandidates.length ? (
                  <label className="check marginless policy-select-all">
                    <CheckboxControl
                      aria-label={t("selectAllChannels")}
                      checked={
                        visibleCandidates.length > 0 &&
                        visibleCandidates.every((channel) =>
                          editing.member_ids.includes(channel.id),
                        )
                      }
                      onChange={(e) => {
                        const visibleIds = new Set(visibleCandidates.map((channel) => channel.id));
                        setEditing({
                          ...editing,
                          member_ids: e.target.checked
                            ? Array.from(new Set([...editing.member_ids, ...visibleIds]))
                            : editing.member_ids.filter((id) => !visibleIds.has(id)),
                        });
                      }}
                    />
                    <span>{t("selectAll")}</span>
                  </label>
                ) : null}
              </div>
              {candidates.isLoading ? (
                <p className="panel-hint">{t("load")}</p>
              ) : visibleCandidates.length ? (
                <div className="policy-channel-groups">
                  {Array.from(candidatesByModel.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([model, channels]) => {
                      const expanded = expandedModels.has(model);
                      const allChannelsSelected = channels.every((channel) =>
                        editing.member_ids.includes(channel.id),
                      );
                      return (
                        <section className="policy-channel-group" key={model}>
                          <div className="policy-channel-group-heading">
                            <label className="check marginless policy-channel-group-select-all">
                              <CheckboxControl
                                aria-label={t("selectModelChannels", { model })}
                                checked={allChannelsSelected}
                                onChange={(e) => {
                                  const channelIds = new Set(channels.map((channel) => channel.id));
                                  setEditing({
                                    ...editing,
                                    member_ids: e.target.checked
                                      ? Array.from(new Set([...editing.member_ids, ...channelIds]))
                                      : editing.member_ids.filter((id) => !channelIds.has(id)),
                                  });
                                }}
                              />
                            </label>
                            <Button
                              type="button"
                              className="policy-channel-group-toggle"
                              aria-expanded={expanded}
                              onClick={() =>
                                setExpandedModels((current) => {
                                  const next = new Set(current);
                                  if (next.has(model)) next.delete(model);
                                  else next.add(model);
                                  return next;
                                })
                              }
                            >
                              {expanded ? (
                                <ChevronDown size={14} aria-hidden="true" />
                              ) : (
                                <ChevronRight size={14} aria-hidden="true" />
                              )}
                              <span>{model}</span>
                              <small>{t("modelChannelCount", { count: channels.length })}</small>
                            </Button>
                          </div>
                          {expanded ? (
                            <div className="policy-channel-options">
                              {channels.map((channel) => (
                                <label className="check marginless" key={channel.id}>
                                  <CheckboxControl
                                    checked={editing.member_ids.includes(channel.id)}
                                    onChange={(e) =>
                                      setEditing({
                                        ...editing,
                                        member_ids: e.target.checked
                                          ? [...editing.member_ids, channel.id]
                                          : editing.member_ids.filter((id) => id !== channel.id),
                                      })
                                    }
                                  />
                                  <span>
                                    {channel.name}
                                    {channel.enabled ? null : <StatusBadge value={false} />}
                                  </span>
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                </div>
              ) : candidates.data?.length ? (
                <p className="panel-hint">
                  {editing.all_models
                    ? t("noCandidates")
                    : editing.models.length
                      ? t("noChannelsForModels")
                      : t("selectModelsFirst")}
                </p>
              ) : (
                <p className="panel-hint">{t("noCandidates")}</p>
              )}
            </section>
          </form>
        </Dialog>
      )}
      {confirmAction ? (
        <ConfirmDialog
          title={
            confirmAction.kind === "save"
              ? t("savePolicyConfirmTitle")
              : t("deletePolicyConfirmTitle")
          }
          message={confirmAction.kind === "save" ? t("policyChanged") : t("policyDeleteWarning")}
          confirmLabel={confirmAction.kind === "save" ? t("save") : t("delete")}
          danger={confirmAction.kind === "delete"}
          pending={busy}
          error={error}
          onClose={() => setConfirmAction(null)}
          onConfirm={() => {
            if (confirmAction.kind === "save") {
              void run(confirmAction.path, confirmAction.method, confirmAction.body, () => {
                setEditing(null);
                setConfirmAction(null);
              });
              return;
            }
            void run(`/admin/team/policies/${confirmAction.policyId}`, "DELETE", undefined, () =>
              setConfirmAction(null),
            );
          }}
        />
      ) : null}
    </div>
  );
}
