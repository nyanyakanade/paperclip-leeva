export type UiLocale = "en" | "zh-CN";
export const UI_LOCALE_STORAGE_KEY = "paperclip.ui.locale";
export const DEFAULT_UI_LOCALE: UiLocale = "zh-CN";

export function resolveUiLocale(value: unknown): UiLocale {
  return value === "en" || value === "zh-CN" ? value : DEFAULT_UI_LOCALE;
}

export function readUiLocale(storage?: Pick<Storage, "getItem">): UiLocale {
  try {
    return resolveUiLocale(storage?.getItem(UI_LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_UI_LOCALE;
  }
}

/** A failed preference write must not prevent the current session switching. */
export function persistUiLocale(locale: UiLocale, storage?: Pick<Storage, "setItem">) {
  try {
    if (!storage) return false;
    storage.setItem(UI_LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}
