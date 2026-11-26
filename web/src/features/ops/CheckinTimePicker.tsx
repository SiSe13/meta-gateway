import { TimeField as HeroTimeField } from "@heroui/react";
import { Input as HeroInput } from "@heroui/react";
import { Time } from "@internationalized/date";
import { useI18n } from "../../i18n";

/** Parse a daily "m h * * *" cron into wall-clock time; null for custom schedules. */
function parseDailyCron(cron = ""): { hour: number; minute: number } | null {
  const parts = (cron || "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteRaw, hourRaw, dom, month, dow] = parts;
  if (dom !== "*" || month !== "*" || dow !== "*") return null;
  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { hour, minute };
}

export /**
 * Time picker for the daily check-in schedule. Stores back a standard
 * five-field cron ("m h * * *"); custom expressions keep the raw input.
 */
function CheckinTimePicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (cron: string) => void;
}) {
  const { t } = useI18n();
  const time = parseDailyCron(value);
  if (!time) {
    // Custom expression (e.g. weekday-based): fall back to the raw input.
    return (
      <HeroInput
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0 8 * * *"
      />
    );
  }
  const pick = (hour: number, minute: number) => onChange(`${minute} ${hour} * * *`);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="checkin-time-picker">
      <HeroTimeField
        className="checkin-time-field"
        aria-label={t("ops.runtime.checkinTime")}
        hourCycle={24}
        granularity="minute"
        isDisabled={disabled}
        value={new Time(time.hour, time.minute)}
        onChange={(next) => {
          if (next) pick(next.hour, next.minute);
        }}
      >
        <HeroTimeField.Group className="checkin-time-group">
          <HeroTimeField.Input>
            {(segment) => <HeroTimeField.Segment segment={segment} />}
          </HeroTimeField.Input>
        </HeroTimeField.Group>
      </HeroTimeField>
      <span className="checkin-time-hint">
        {t("ops.runtime.checkinDaily")} · {pad(time.hour)}:{pad(time.minute)}
      </span>
    </span>
  );
}
