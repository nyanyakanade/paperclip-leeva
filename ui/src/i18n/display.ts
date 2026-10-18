import { i18n } from ".";
import { lookupDisplayText } from "./display-catalog";

/** Call only for developer-authored interface copy, never user/API content. */
export function displayText(source: string): string {
  return i18n.language === "zh-CN" ? lookupDisplayText(source) ?? source : source;
}

const descriptors = new WeakMap<object, ReadonlyMap<string, string>>();

/** Retain the exact object, fields and values used by navigation and callbacks. */
export function registerDisplayDescriptor<T extends object>(value: T, fields: readonly string[]): T {
  const source = new Map<string, string>();
  for (const field of fields) {
    const text = (value as Record<string, unknown>)[field];
    if (typeof text === "string") source.set(field, text);
  }
  descriptors.set(value, source);
  return value;
}

/** Only source-registered, unchanged copy is translated; API objects pass through. */
export function displayProperty<T extends object, K extends keyof T>(value: T, field: K): T[K] {
  const raw = value[field];
  const registered = descriptors.get(value)?.get(String(field));
  return (typeof raw === "string" && registered !== undefined && registered === raw
    ? displayText(raw) : raw) as T[K];
}

/** Preserve the existing env-editor flush heuristic after button copy is translated. */
export function isUiCommitAction(label: string): boolean {
  if (/\b(save|create|update|test|import)\b/i.test(label)) return true;
  return ["Save", "Create", "Update", "Test", "Import"]
    .some((source) => label.includes(lookupDisplayText(source) ?? source));
}
