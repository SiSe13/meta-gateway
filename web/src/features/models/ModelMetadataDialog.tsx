import { useState } from "react";
import { Input as HeroInput } from "@heroui/react";
import { SearchableSelect } from "../../components/SearchableSelect";
import type { ModelMetadata } from "../../api/types";
import { Button, Dialog, Field } from "../../components/ui";
import { useI18n } from "../../i18n";

export // Compact token-count rendering for metadata badges (128000 → 128K).
// Capability annotation editor for one canonical model name (context window,
// modalities, thinking support, vendor, notes).
function ModelMetadataDialog({
  value,
  pending,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  value: ModelMetadata;
  pending: boolean;
  error?: unknown;
  onClose: () => void;
  onSave: (value: ModelMetadata) => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<ModelMetadata>(value);
  const patch = (partial: Partial<ModelMetadata>) =>
    setForm((current) => ({ ...current, ...partial }));
  // Capability edits preserve legacy rates. Pricing is managed by BillingRulePanel.
  const submit = () =>
    onSave({
      model_name: form.model_name,
      context_window: form.context_window,
      input_modalities: form.input_modalities,
      output_modalities: form.output_modalities,
      supports_thinking: form.supports_thinking,
      vendor: form.vendor,
      notes: form.notes,
    });
  const thinkingOptions = [
    { value: -1, label: t("modelsPage.metaThinkingUnknown") },
    { value: 1, label: t("modelsPage.metaThinkingYes") },
    { value: 0, label: t("modelsPage.metaThinkingNo") },
  ];
  return (
    <Dialog
      title={t("modelsPage.metaTitle", { name: value.model_name })}
      onClose={onClose}
      busy={pending}
    >
      <div className="meta-form">
        <Field label={t("modelsPage.metaCtx")}>
          <HeroInput
            type="number"
            min={0}
            step={1000}
            value={form.context_window}
            onChange={(e) => patch({ context_window: Math.max(0, Number(e.target.value) || 0) })}
            disabled={pending}
          />
        </Field>
        <Field label={t("modelsPage.metaInput")}>
          <HeroInput
            value={form.input_modalities}
            placeholder="text,image,audio"
            onChange={(e) => patch({ input_modalities: e.target.value })}
            disabled={pending}
          />
        </Field>
        <Field label={t("modelsPage.metaOutput")}>
          <HeroInput
            value={form.output_modalities}
            placeholder="text,audio"
            onChange={(e) => patch({ output_modalities: e.target.value })}
            disabled={pending}
          />
        </Field>
        <Field label={t("modelsPage.metaThinking")}>
          <SearchableSelect
            ariaLabel={t("modelsPage.metaThinking")}
            value={String(form.supports_thinking)}
            onChange={(value) => patch({ supports_thinking: Number(value) })}
            disabled={pending}
            options={thinkingOptions.map((option) => ({
              value: String(option.value),
              label: option.label,
            }))}
          />
        </Field>
        <Field label={t("modelsPage.metaVendor")}>
          <HeroInput
            value={form.vendor}
            placeholder="DeepSeek, Google, OpenAI…"
            onChange={(e) => patch({ vendor: e.target.value })}
            disabled={pending}
          />
        </Field>
        <Field label={t("modelsPage.metaNotes")}>
          <HeroInput
            value={form.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            disabled={pending}
          />
        </Field>
        <p className="field-hint">{t("billing.priceLocation")}</p>
      </div>
      {error ? <div className="inline-error">{String(error)}</div> : null}
      <div className="dialog-actions">
        {onDelete ? (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              onDelete();
            }}
          >
            {t("common.delete")}
          </Button>
        ) : null}
        <span className="flex-spacer" />
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button disabled={pending} onClick={submit}>
          {pending ? t("common.working") : t("common.save")}
        </Button>
      </div>
    </Dialog>
  );
}
