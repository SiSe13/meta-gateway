import {
  Calendar as HeroCalendar,
  DateField as HeroDateField,
  DatePicker as HeroDatePicker,
} from "@heroui/react";
import { parseDate, parseDateTime } from "@internationalized/date";

/** 在页面间统一提供 HeroUI 日期与日期时间选择器。 */
export function UiDatePicker({
  value,
  onChange,
  granularity = "day",
  ariaLabel,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  granularity?: "day" | "minute" | "second";
  ariaLabel: string;
  disabled?: boolean;
}) {
  const dateValue = value
    ? granularity === "day"
      ? parseDate(value)
      : parseDateTime(value)
    : null;

  return (
    <HeroDatePicker
      aria-label={ariaLabel}
      className="ui-date-picker"
      granularity={granularity}
      hourCycle={24}
      isDisabled={disabled}
      value={dateValue}
      onChange={(next) => onChange(next?.toString() ?? "")}
    >
      <HeroDateField.Group className="ui-date-picker-group" fullWidth>
        <HeroDateField.Input>
          {(segment) => <HeroDateField.Segment segment={segment} />}
        </HeroDateField.Input>
        <HeroDateField.Suffix>
          <HeroDatePicker.Trigger>
            <HeroDatePicker.TriggerIndicator />
          </HeroDatePicker.Trigger>
        </HeroDateField.Suffix>
      </HeroDateField.Group>
      <HeroDatePicker.Popover className="ui-date-picker-popover">
        <HeroCalendar aria-label={ariaLabel} className="ui-date-calendar">
          <HeroCalendar.Header>
            <HeroCalendar.Heading />
            <HeroCalendar.NavButton slot="previous" />
            <HeroCalendar.NavButton slot="next" />
          </HeroCalendar.Header>
          <HeroCalendar.Grid>
            <HeroCalendar.GridHeader>
              {(day) => <HeroCalendar.HeaderCell>{day}</HeroCalendar.HeaderCell>}
            </HeroCalendar.GridHeader>
            <HeroCalendar.GridBody>
              {(date) => <HeroCalendar.Cell date={date} />}
            </HeroCalendar.GridBody>
          </HeroCalendar.Grid>
        </HeroCalendar>
      </HeroDatePicker.Popover>
    </HeroDatePicker>
  );
}
