import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import { i18n } from ".";
import { persistUiLocale, type UiLocale } from "./locale-preference";

const subscribe = (listener: () => void) => {
  i18n.on("languageChanged", listener);
  return () => { i18n.off("languageChanged", listener); };
};
const snapshot = () => i18n.language;

export function useUiLocale() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export async function setUiLocale(locale: UiLocale) {
  let persisted = false;
  try { persisted = persistUiLocale(locale, window.localStorage); } catch { /* Session-only switch. */ }
  await i18n.changeLanguage(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  return persisted;
}

/** Like the previous locale reload, switching resets transient UI state, not data. */
export function LocaleBoundary({ children }: { children: ReactNode }) {
  const locale = useUiLocale();
  return <Fragment key={locale}>{children}</Fragment>;
}
