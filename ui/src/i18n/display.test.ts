import { afterEach, describe, expect, it } from "vitest";
import { i18n } from ".";
import { displayProperty, displayText, isUiCommitAction, registerDisplayDescriptor } from "./display";
import { setUiLocale } from "./LocaleBoundary";
import { persistUiLocale, readUiLocale, resolveUiLocale } from "./locale-preference";
import en from "./reference/en.json";
import zh from "./reference/zh-CN.json";
import { validateLocaleMessages } from "./locale-validation";

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("source display localization", () => {
  it("validates the imported data, without executing code from its source PR", () => {
    expect(validateLocaleMessages(zh, en)).toEqual([]);
  });

  it("preserves logical labels, object identity, serialized API data and unknown user content", async () => {
    await i18n.changeLanguage("zh-CN");
    const raw = { label: "Tasks", value: "Tasks", prompt: "Tasks", href: "/issues" };
    const before = JSON.stringify(raw);
    const descriptor = registerDisplayDescriptor(raw, ["label"]);
    expect(descriptor).toBe(raw);
    expect(descriptor.label === "Tasks").toBe(true);
    expect(JSON.stringify(raw)).toBe(before);
    expect(displayProperty(raw, "label")).toBe("任务");
    expect(displayProperty({ label: "Tasks" }, "label")).toBe("Tasks");
    expect(displayProperty({ ...raw }, "label")).toBe("Tasks");
    raw.label = "Save";
    expect(displayProperty(raw, "label")).toBe("Save");
  });

  it("switches to English and falls back to original copy for missing translations", async () => {
    await setUiLocale("zh-CN");
    expect(displayText("Settings")).toBe("设置");
    expect(displayText("A new upstream string")).toBe("A new upstream string");
    await setUiLocale("en");
    expect(displayText("Settings")).toBe("Settings");
  });

  it("uses Chinese by default and tolerates unavailable preference storage", () => {
    expect(resolveUiLocale("en")).toBe("en");
    expect(resolveUiLocale("invalid")).toBe("zh-CN");
    expect(readUiLocale({ getItem() { throw new Error("blocked"); } })).toBe("zh-CN");
    expect(persistUiLocale("en", { setItem() { throw new Error("blocked"); } })).toBe(false);
  });

  it("keeps env-editor draft flushing available for translated commit buttons", () => {
    for (const label of ["Save", "Test connection", "保存", "创建", "更新", "测试连接", "导入"]) {
      expect(isUiCommitAction(label), label).toBe(true);
    }
    expect(isUiCommitAction("取消")).toBe(false);
  });
});
