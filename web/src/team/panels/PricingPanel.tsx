import { Link } from "react-router-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { useI18n } from "../../i18n";
import { PricingRules } from "../../features/models/PriceFields";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActionMenu } from "../../components/ActionMenu";
import {
  Button,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Loading,
  Panel,
  TextInput,
  CheckboxControl,
} from "../../components/ui";
import { useConfirm } from "../../components/ConfirmProvider";
import { teamError } from "../text";
import { useTeamMutation } from "../useTeamMutation";
import { useUsers } from "../UsersContext";
import type { ModelRatio } from "../types";
import type { RouteOverview } from "../../api/types";
import { autoModelGroup, MODEL_GROUP_ORDER } from "../../lib/modelGroups";

/**
 * Billing markup: a per-model multiplier applied on top of whatever unit price
 * the model or the route member carries.
 *
 * It used to be reachable only through the API — a number that changes every
 * account's bill, with no interface and no mention anywhere in the console.
 * The board states the pricing order as well (member price, then model price,
 * then this multiplier), because "why is this number what it is" was the part
 * operators could not answer.
 */
export function PricingPanel() {
  const { request, t } = useUsers();
  const confirm = useConfirm();
  const { busy, error, run } = useTeamMutation(request, t);
  const [editing, setEditing] = useState<ModelRatio | null>(null);
  const ratios = useQuery({
    queryKey: ["team", "ratios"],
    queryFn: ({ signal }) => request<ModelRatio[]>("/admin/ratios", { signal }),
  });
  const routes = useQuery({
    queryKey: ["route-overviews"],
    queryFn: ({ signal }) => request<RouteOverview[]>("/admin/routes/overview", { signal }),
    enabled: editing?.model === "",
  });
  const modelOptions = [...new Set((routes.data ?? []).map(({ route }) => route.model_pattern))]
    .filter((model) => model && !/[?*]/.test(model))
    .sort((a, b) => a.localeCompare(b));
  const failure = error || ratios.error;
  return (
    <div className="team-board">
      {failure ? <ErrorState error={failure} /> : null}
      <Panel
        title={t("billingRatios")}
        titleHelp={t("billingRatiosHint")}
        actions={
          <div className="pricing-panel-actions">
            <Link className="button button-quiet" to="/models">
              {t("openModelPricing")}
            </Link>
            <Button onClick={() => setEditing({ model: "", ratio: 1 })}>{t("newRatio")}</Button>
          </div>
        }
        lede={t("pricingIntro")}
        className="team-pricing-panel"
      >
        {ratios.isLoading ? (
          <Loading />
        ) : ratios.data?.length ? (
          <DataTable headers={[t("model"), t("ratioLabel"), ""]}>
            {ratios.data.map((r) => (
              <tr key={r.model}>
                <td>
                  <code>{r.model}</code>
                </td>
                <td>× {r.ratio}</td>
                <td className="row-actions">
                  <ActionMenu
                    compact
                    label={t("moreActions")}
                    items={[
                      {
                        key: "edit",
                        label: t("edit"),
                        onSelect: () => setEditing(structuredClone(r)),
                      },
                      {
                        key: "delete",
                        group: t("dangerZone"),
                        label: t("delete"),
                        danger: true,
                        disabled: busy,
                        onSelect: () => {
                          void confirm({
                            title: t("ratioDeleteTitle"),
                            message: t("ratioDeleteWarning", { model: r.model }),
                            confirmLabel: t("delete"),
                            danger: true,
                          }).then((accepted) => {
                            if (accepted)
                              void run(
                                `/admin/ratios/${encodeURIComponent(r.model)}`,
                                "PUT",
                                // 负倍率是接口约定的删除方式。
                                { ratio: -1 },
                              );
                          });
                        },
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <div className="pricing-ratio-empty">
            <strong>{t("noRatios")}</strong>
          </div>
        )}
        <PricingRules />
      </Panel>
      {editing && (
        <RatioDialog
          ratio={editing}
          models={modelOptions}
          modelsLoading={routes.isLoading}
          modelsError={routes.error}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RatioDialog({
  ratio,
  models,
  modelsLoading,
  modelsError,
  onClose,
}: {
  ratio: ModelRatio;
  models: string[];
  modelsLoading: boolean;
  modelsError: unknown;
  onClose: () => void;
}) {
  const { request, locale, t } = useUsers();
  const { busy, error, run } = useTeamMutation(request, t);
  const [selectedModels, setSelectedModels] = useState<string[]>(ratio.model ? [ratio.model] : []);
  const [value, setValue] = useState(String(ratio.ratio));
  const [saving, setSaving] = useState(false);
  const { t: ui } = useI18n();
  const creating = ratio.model === "";
  const valid =
    selectedModels.length > 0 &&
    value.trim() !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0 &&
    Number(value) <= 1000;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || busy || saving) return;
    setSaving(true);
    try {
      for (const [index, model] of selectedModels.entries()) {
        const saved = await run(
          `/admin/ratios/${encodeURIComponent(model)}`,
          "PUT",
          { ratio: Number(value) },
          index === selectedModels.length - 1 ? () => onClose() : () => {},
        );
        if (saved === undefined) return;
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title={creating ? t("newRatio") : t("ratioTitle", { model: ratio.model })}
      onClose={onClose}
      busy={busy || saving}
      className="ratio-dialog"
    >
      <form className="ratio-form" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <span className="field-label">{t("model")}</span>
          {creating ? (
            <ModelMultiSelect
              models={models}
              selected={selectedModels}
              loading={modelsLoading}
              disabled={busy || saving || !!modelsError}
              onChange={setSelectedModels}
            />
          ) : (
            <div className="ratio-model-fixed">
              <code>{ratio.model}</code>
            </div>
          )}
          {modelsError ? <p className="field-error">{teamError(modelsError, locale)}</p> : null}
        </div>
        <Field label={t("ratioLabel")} hint={t("ratioHint")}>
          <TextInput
            type="number"
            required
            min={0}
            max={1000}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {value.trim() !== "" && Number(value) === 0 ? (
          <p role="status" className="panel-hint">
            {ui("pricing.zeroRatio")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="inline-error">
            {teamError(error, locale)}
          </p>
        ) : null}
        <div className="form-actions">
          <Button variant="quiet" type="button" onClick={onClose}>
            {t("close")}
          </Button>
          <Button
            type="submit"
            loading={busy || saving}
            disabled={!valid || modelsLoading || !!modelsError}
          >
            {t("save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ModelMultiSelect({
  models,
  selected,
  loading,
  disabled,
  onChange,
}: {
  models: string[];
  selected: string[];
  loading: boolean;
  disabled: boolean;
  onChange: (models: string[]) => void;
}) {
  const { t } = useUsers();
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const visibleModels = models.filter((model) =>
    model.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const buckets = new Map<string, string[]>();
  for (const model of visibleModels) {
    const group = autoModelGroup(model);
    const bucket = buckets.get(group);
    if (bucket) bucket.push(model);
    else buckets.set(group, [model]);
  }
  const groups = MODEL_GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => ({
    group,
    models: buckets.get(group)!,
  }));
  const forcedOpen = query.trim() !== "";
  const toggleGroup = (group: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };
  const toggle = (model: string) =>
    onChange(
      selected.includes(model) ? selected.filter((item) => item !== model) : [...selected, model],
    );
  return (
    <details className="ratio-model-picker" aria-disabled={disabled}>
      <summary
        className="ratio-model-trigger"
        aria-label={t("model")}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <span>
          {selected.length
            ? t("selectedModelCount", { count: selected.length })
            : t("selectModels")}
        </span>
      </summary>
      <div className="ratio-model-menu">
        <div className="ratio-model-search">
          <Search size={15} aria-hidden="true" />
          <TextInput
            aria-label={t("selectModels")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("selectModels")}
          />
        </div>
        <div className="ratio-model-options">
          {loading ? <p className="ratio-model-empty">{t("loadingModels")}</p> : null}
          {!loading && visibleModels.length === 0 ? (
            <p className="ratio-model-empty">{t("noModelsToSelect")}</p>
          ) : null}
          {!loading &&
            groups.map(({ group, models: groupedModels }) => {
              const isCollapsed = !forcedOpen && collapsedGroups.has(group);
              return (
                <section className="ratio-model-group" key={group}>
                  <Button
                    type="button"
                    className={`ratio-model-group-head${isCollapsed ? " is-collapsed" : ""}`}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleGroup(group)}
                  >
                    <ChevronDown size={13} aria-hidden="true" />
                    <span>{group}</span>
                    <small>{groupedModels.length}</small>
                  </Button>
                  {!isCollapsed ? (
                    <div className="ratio-model-group-items">
                      {groupedModels.map((model) => {
                        const checked = selected.includes(model);
                        return (
                          <label className="ratio-model-option" key={model}>
                            <CheckboxControl
                              aria-label={model}
                              checked={checked}
                              onChange={() => toggle(model)}
                              disabled={disabled}
                            />
                            <span>{model}</span>
                            {checked ? <Check size={15} aria-hidden="true" /> : null}
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
        </div>
      </div>
      {selected.length ? (
        <div className="ratio-model-selected" aria-live="polite">
          {selected.map((model) => (
            <span className="ratio-model-chip" key={model}>
              {model}
            </span>
          ))}
        </div>
      ) : null}
    </details>
  );
}
