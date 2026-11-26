import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { Button as HeroButton, Input as HeroInput } from "@heroui/react";
import { api } from "../../api/client";
import type { PromptGuardRule } from "../../api/types";
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

export // Sensitive prompt guards: regex rules that mask, reject, or channel-exclude
// request bodies containing sensitive content (API keys, credentials…).
function PromptGuardPanel() {
  const { client } = useSession();
  const service = api(client!);
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["prompt-guards"],
    queryFn: ({ signal }) => service.promptGuards(signal),
  });
  const [draft, setDraft] = useState<Partial<PromptGuardRule> | null>(null);
  // Irreversible, and it was firing straight from the click while every other
  // delete in the console asks first.
  const [confirmDelete, setConfirmDelete] = useState<PromptGuardRule | null>(null);
  const save = useAdminMutation({
    mutationFn: (value: PromptGuardRule) =>
      value.id ? service.updatePromptGuard(value.id, value) : service.createPromptGuard(value),
    invalidateKeys: [["prompt-guards"]],
  });
  const remove = useAdminMutation({
    mutationFn: (id: number) => service.deletePromptGuard(id),
    invalidateKeys: [["prompt-guards"]],
  });
  const items = query.data?.items ?? [];
  const addButtonTitle = { title: t("ops.guard.add") };
  return (
    <section className="panel runtime-section runtime-tool-prompt-guard" id="runtime-prompt-guards">
      <div className="panel-header">
        <div className="panel-title">
          <h3>{t("ops.guard.title")}</h3>
          <InfoTip label={t("ops.guard.hint")} />
        </div>
        <HeroButton
          {...addButtonTitle}
          type="button"
          className="icon-button runtime-rule-add"
          isIconOnly
          aria-label={t("ops.guard.add")}
          onPress={() =>
            setDraft({
              name: "",
              pattern: "",
              action: "mask",
              replacement: "[REDACTED]",
              exclude_channels: "",
              channel_scope: 0,
              enabled: true,
            })
          }
        >
          <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
        </HeroButton>
      </div>
      <p className="muted panel-lede">{t("ops.guard.lede")}</p>
      {items.length === 0 ? (
        <div className="runtime-rule-empty-state">
          <span className="runtime-rule-empty-icon" aria-hidden="true">
            <ShieldCheck size={18} />
          </span>
          <p>{t("ops.guard.empty")}</p>
        </div>
      ) : (
        <div className="error-rules-list">
          {items.map((rule) => (
            <div key={rule.id} className="error-rule-row">
              <span className={"error-rule-badge is-" + rule.action}>{rule.action}</span>
              <span className="error-rule-name">{rule.name}</span>
              <code className="error-rule-cond">{rule.pattern}</code>
              {rule.action === "exclude" ? (
                <code className="error-rule-cond">{rule.exclude_channels}</code>
              ) : null}
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
        <PromptGuardEditor
          value={draft}
          pending={save.isPending}
          error={save.error instanceof Error ? save.error : null}
          onClose={() => setDraft(null)}
          onSave={(value) => {
            save.mutate(value as PromptGuardRule);
            setDraft(null);
          }}
        />
      ) : null}
      {confirmDelete ? (
        <ConfirmDialog
          title={t("ops.guard.deleteTitle")}
          message={t("ops.guard.deleteConfirm")}
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

function PromptGuardEditor({
  value,
  pending,
  error,
  onClose,
  onSave,
}: {
  value: Partial<PromptGuardRule>;
  pending: boolean;
  error?: Error | null;
  onClose: () => void;
  onSave: (value: Partial<PromptGuardRule>) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<Partial<PromptGuardRule>>(value);
  const patch = (p: Partial<PromptGuardRule>) => setForm((current) => ({ ...current, ...p }));
  return (
    <Dialog
      title={form.id ? t("ops.guard.edit") : t("ops.guard.add")}
      onClose={onClose}
      busy={pending}
    >
      <div className="meta-form">
        <Field label={t("ops.guard.name")}>
          <HeroInput
            value={form.name ?? ""}
            onChange={(e) => patch({ name: e.target.value })}
            disabled={pending}
          />
        </Field>
        <Field label={t("ops.guard.pattern")}>
          <HeroInput
            value={form.pattern ?? ""}
            placeholder="sk-[A-Za-z0-9]{16,}"
            onChange={(e) => patch({ pattern: e.target.value })}
            disabled={pending}
          />
        </Field>
        <Field label={t("ops.guard.action")}>
          <SelectControl
            value={form.action ?? "mask"}
            onChange={(e) =>
              patch({
                action: e.target.value as PromptGuardRule["action"],
              })
            }
            disabled={pending}
          >
            <option value="mask">{t("ops.guard.actionMask")}</option>
            <option value="reject">{t("ops.guard.actionReject")}</option>
            <option value="exclude">{t("ops.guard.actionExclude")}</option>
          </SelectControl>
        </Field>
        {form.action === "mask" ? (
          <Field label={t("ops.guard.replacement")}>
            <HeroInput
              value={form.replacement ?? "[REDACTED]"}
              onChange={(e) => patch({ replacement: e.target.value })}
              disabled={pending}
            />
          </Field>
        ) : null}
        {form.action === "exclude" ? (
          <Field label={t("ops.guard.excludeChannels")}>
            <HeroInput
              value={form.exclude_channels ?? ""}
              placeholder="5, 12"
              onChange={(e) => patch({ exclude_channels: e.target.value })}
              disabled={pending}
            />
          </Field>
        ) : null}
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
