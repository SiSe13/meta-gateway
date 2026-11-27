import { useI18n } from "../../i18n";
import { formatGroupName } from "../../lib/format";
import { Button } from "../../components/ui";

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
        <Button
          type="button"
          variant={value === group ? "primary" : "secondary"}
          key={group}
          aria-pressed={value === group}
          onClick={() => onChange(group)}
        >
          {group ? formatGroupName(group, t) : t("modelsPage.allGroups")}
        </Button>
      ))}
    </div>
  );
}
