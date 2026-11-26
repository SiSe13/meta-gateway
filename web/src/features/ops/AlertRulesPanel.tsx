import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button as HeroButton, Input as HeroInput } from "@heroui/react";
import { api } from "../../api/client";
import type { AlertRule } from "../../api/types";
import { useAdminMutation } from "../../hooks/useAdminMutation";
import { useI18n } from "../../i18n";
import { useSession } from "../../session";
import {
  CheckboxControl,
  ConfirmDialog,
  Dialog,
  Field,
  InfoTip,
  SelectControl,
} from "../../components/ui";
import { RuleEditorFooter } from "./RuleEditorFooter";

export // Alert rules: metric/operator/threshold/window/sustained → webhook.
function AlertRulesPanel() {
  const { client } = useSession();
  const service = api(client!);
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["alert-rules"],
    queryFn: ({ signal }) => service.alertRules(signal),
  });
  const [draft, setDraft] = useState<Partial<AlertRule> | null>(null);
  // Irreversible, and it was firing straight from the click while every other
  // delete in the console asks first.
  const [confirmDelete, setConfirmDelete] = useState<AlertRule | null>(null);
  const save = useAdminMutation({
    mutationFn: (value: AlertRule) =>
      value.id ? service.updateAlertRule(value.id, value) : service.createAlertRule(value),
    invalidateKeys: [["alert-rules"]],
  });
  const remove = useAdminMutation({
    mutationFn: (id: number) => service.deleteAlertRule(id),
    invalidateKeys: [["alert-rules"]],
  });
  const items = query.data?.items ?? [];
  const metrics = query.data?.metrics ?? {};
  const addButtonTitle = { title: t("ops.alertRules.add") };
  return (
    <section className="panel runtime-section runtime-tool-alert-rules" id="runtime-alert-rules">
      <div className="panel-header">
        <div className="panel-title">
          <h3>{t("ops.alertRules.title")}</h3>
          <InfoTip label={t("ops.alertRules.hint")} />
        </div>
        <HeroButton
          {...addButtonTitle}
          type="button"
          className="icon-button runtime-rule-add"
          isIconOnly
          aria-label={t("ops.alertRules.add")}
          onPress={() =>
            setDraft({
              name: "",
              metric: "request_fail_rate",
              operator: "gt",
              threshold: 0.5,
              window_seconds: 3600,
              sustained_seconds: 300,
              cooldown_seconds: 900,
              level: "warning",
              enabled: true,
            })
          }
        >
          <Plus size={18} strokeWidth={2.25} aria-hidden="true" />
        </HeroButton>
      </div>
      <p className="muted panel-lede">{t("ops.alertRules.lede")}</p>
      {items.length === 0 ? (
        <p className="is-quiet panel-note">{t("ops.alertRules.empty")}</p>
      ) : (
        <div className="error-rules-list">
          {items.map((rule) => (
            <div key={rule.id} className="error-rule-row">
              <span className={"error-rule-badge " + (rule.enabled ? "is-passthrough" : "is-off")}>
                {rule.metric}
              </span>
              <span className="error-rule-name">{rule.name}</span>
              <code className="error-rule-cond">
                {rule.operator} {rule.threshold}
              </code>
              <code className="error-rule-cond">
                {rule.sustained_seconds}s / {rule.cooldown_seconds}s
              </code>
              {!rule.enabled ? (
                <span className="error-rule-off">{t("common.disabled")}</span>
              ) : null}
              <span className="flex-spacer" />
              <HeroButton
                type="button"
                className="error-rule-edit"
                onPress={() => setDraft({ ...rule })}
              >
                {t("common.edit")}
              </HeroButton>
              <HeroButton
                type="button"
                className="error-rule-del"
                onPress={() => setConfirmDelete(rule)}
              >
                {t("common.delete")}
              </HeroButton>
            </div>
          ))}
        </div>
      )}
      {draft ? (
        <AlertRuleEditor
          value={draft}
          metrics={metrics}
          pending={save.isPending}
          error={save.error instanceof Error ? save.error : null}
          onClose={() => setDraft(null)}
          onSave={(value) => {
            save.mutate(value as AlertRule);
            setDraft(null);
          }}
        />
      ) : null}
      {confirmDelete ? (
        <ConfirmDialog
          title={t("ops.alertRules.deleteTitle")}
          message={t("ops.alertRules.deleteConfirm")}
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => {
            remove.mutate(confirmDelete.id!);
            setConfirmDelete(null);
          }}
          onClose={() => setConfirmDelete(null)}
        />
      ) : null}
    </section>
  );
}

function AlertRuleEditor({
  value,
  metrics,
  pending,
  error,
  onClose,
  onSave,
}: {
  value: Partial<AlertRule>;
  metrics: Record<string, string>;
  pending: boolean;
  error?: Error | null;
  onClose: () => void;
  onSave: (value: Partial<AlertRule>) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<Partial<AlertRule>>(value);
  const patch = (p: Partial<AlertRule>) => setForm((current) => ({ ...current, ...p }));
  return (
    <Dialog
      title={form.id ? t("ops.alertRules.edit") : t("ops.alertRules.add")}
      onClose={onClose}
      busy={pending}
    >
      <div className="meta-form">
        <Field label={t("ops.alertRules.name")}>
          <HeroInput
            value={form.name ?? ""}
            onChange={(e) => patch({ name: e.target.value })}
            disabled={pending}
          />
        </Field>
        <Field label={t("ops.alertRules.metric")}>
          <SelectControl
            value={form.metric ?? "request_fail_rate"}
            onChange={(e) => patch({ metric: e.target.value })}
            disabled={pending}
          >
            {Object.entries(metrics).map(([key, desc]) => (
              <option key={key} value={key} title={desc}>
                {key}
              </option>
            ))}
          </SelectControl>
        </Field>
        <div className="alert-rule-row2">
          <Field label={t("ops.alertRules.operator")}>
            <SelectControl
              value={form.operator ?? "gt"}
              onChange={(e) =>
                patch({
                  operator: e.target.value as AlertRule["operator"],
                })
              }
              disabled={pending}
            >
              {["gt", "gte", "lt", "lte", "eq", "neq"].map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </SelectControl>
          </Field>
          <Field label={t("ops.alertRules.threshold")}>
            <HeroInput
              type="number"
              step={0.05}
              value={form.threshold ?? 0}
              onChange={(e) => patch({ threshold: Number(e.target.value) || 0 })}
              disabled={pending}
            />
          </Field>
        </div>
        <div className="alert-rule-row3">
          <Field label={t("ops.alertRules.window")}>
            <HeroInput
              type="number"
              min={60}
              value={form.window_seconds ?? 3600}
              onChange={(e) => patch({ window_seconds: Number(e.target.value) || 3600 })}
              disabled={pending}
            />
          </Field>
          <Field label={t("ops.alertRules.sustained")}>
            <HeroInput
              type="number"
              min={0}
              value={form.sustained_seconds ?? 0}
              onChange={(e) => patch({ sustained_seconds: Number(e.target.value) || 0 })}
              disabled={pending}
            />
          </Field>
          <Field label={t("ops.alertRules.cooldown")}>
            <HeroInput
              type="number"
              min={60}
              value={form.cooldown_seconds ?? 900}
              onChange={(e) => patch({ cooldown_seconds: Number(e.target.value) || 900 })}
              disabled={pending}
            />
          </Field>
        </div>
        <label className="check">
          <CheckboxControl
            checked={form.enabled ?? true}
            onChange={(e) => patch({ enabled: e.target.checked })}
            disabled={pending}
          />
          <span>{t("common.enabled")}</span>
        </label>
      </div>
      <RuleEditorFooter
        pending={pending}
        error={error}
        onCancel={onClose}
        onSave={() => onSave(form)}
      />
    </Dialog>
  );
}
