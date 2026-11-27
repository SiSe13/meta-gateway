import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import {
  formatGroupName,
  formatLatency,
  formatUnitPrice,
  setCurrency,
  useCurrency,
} from "./format";
import { translate } from "../i18n";
beforeEach(() => setCurrency({ symbol: "$", rate: 1 }));

it("localizes built-in default groups while preserving custom group names", () => {
  const t = (key: string) => translate("zh-CN", key);
  for (const value of [undefined, null, "", " ", "default", " default "]) {
    expect(formatGroupName(value, t)).toBe("默认");
  }
  for (const value of ["vip", "默认", "my-default", "Default"]) {
    expect(formatGroupName(value, t)).toBe(value);
  }
  expect(formatGroupName("default", (key) => translate("en", key))).toBe("default");
});
it("preserves nonzero tiny prices and large fractional prices", () => {
  expect(formatUnitPrice(0.0000001)).toBe("$1e-7");
  expect(formatUnitPrice(1234.56789)).toBe("$1,234.56789");
  expect(formatUnitPrice(0)).toBe("$0.00");
});
it("notifies mounted prices when display currency arrives without altering ledger input", () => {
  const { result, unmount } = renderHook(() => useCurrency());
  act(() => setCurrency({ symbol: "¥", rate: 7 }));
  expect(result.current).toEqual({ symbol: "¥", rate: 7 });
  expect(formatUnitPrice(1)).toBe("¥7.00");
  unmount();
});
// An average response time can be milliseconds or minutes, and the reader should
// not have to divide by a thousand to know which.
it("prints latency at the scale the number is actually at", () => {
  expect(formatLatency(348)).toBe("348 ms");
  expect(formatLatency(999)).toBe("999 ms");
  expect(formatLatency(1450)).toBe("1.45 s");
  expect(formatLatency(12480)).toBe("12.5 s");
  expect(formatLatency(125000)).toBe("2m 5s");
  expect(formatLatency(60000)).toBe("1m");
  // No sample is not a latency of zero.
  expect(formatLatency(0)).toBe("0 ms");
  expect(formatLatency(Number.NaN)).toBe("—");
  expect(formatLatency(-1)).toBe("—");
});
