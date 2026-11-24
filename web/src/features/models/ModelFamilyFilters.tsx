import { useI18n } from "../../i18n";
import { Button as HeroButton } from "@heroui/react";

/** Compact family chips, shared by both catalogue roles. */
export function ModelFamilyFilters({
  groups,
  value,
  onChange,
}: {
  groups: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="model-family-filters" role="group" aria-label={t("modelsPage.groupFilter")}>
      {["", ...groups].map((group) => (
        <HeroButton
          type="button"
          variant="ghost"
          key={group}
          aria-pressed={value === group}
          onPress={() => onChange(group)}
        >
          {group || t("modelsPage.allGroups")}
        </HeroButton>
      ))}
    </div>
  );
}
