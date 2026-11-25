import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";
import { auditActionLabel } from "./AuditPanel";

describe("system log action labels", () => {
  it("explains common model discovery and admin actions", () => {
    expect(auditActionLabel("admin.discovery.create", (key) => translate("zh-CN", key))).toBe(
      "创建模型发现任务",
    );
    expect(auditActionLabel("admin.admin.create", (key) => translate("zh-CN", key))).toBe(
      "创建管理员",
    );
  });

  it("translates standard admin resources and verbs", () => {
    expect(auditActionLabel("admin.site.create", (key) => translate("zh-CN", key))).toBe(
      "创建：站点",
    );
  });

  it("preserves unfamiliar action codes rather than guessing", () => {
    expect(auditActionLabel("future.unknown.operation", (key) => translate("zh-CN", key))).toBe(
      "future.unknown.operation",
    );
  });
});
