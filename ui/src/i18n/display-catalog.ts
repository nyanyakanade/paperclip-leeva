import en from "./reference/en.json";
import zh from "./reference/zh-CN.json";
import overrides from "./display-overrides.json";

function flatten(value: unknown, prefix = "", result: Record<string, string> = {}) {
  if (!value || typeof value !== "object") return result;
  for (const [key, child] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") result[name] = child;
    else flatten(child, name, result);
  }
  return result;
}

const english = flatten(en);
const chinese = flatten(zh);
const candidates = new Map<string, Set<string>>();
for (const [key, source] of Object.entries(english)) {
  const translated = chinese[key];
  if (!translated || source === translated || !/[\u3400-\u9fff]/u.test(translated)) continue;
  const values = candidates.get(source) ?? new Set<string>();
  values.add(translated);
  candidates.set(source, values);
}

/** Ambiguous English strings require an explicit reviewed override. */
export const displayCatalog = new Map<string, string>([
  ...[...candidates].filter(([, values]) => values.size === 1)
    .map(([source, values]): [string, string] => [source, [...values][0]]),
  ...Object.entries(overrides),
]);

export function lookupDisplayText(source: string) {
  const exact = displayCatalog.get(source);
  if (exact) return exact;
  const match = /^(\s*)(.*?)(\s*)$/s.exec(source)!;
  const translated = displayCatalog.get(match[2]);
  if (translated) return match[1] + translated + match[3];
  if (/^[A-Z][A-Z\s]+$/.test(match[2])) {
    const key = [...displayCatalog.keys()].find((value) => value.toUpperCase() === match[2]);
    if (key) return match[1] + displayCatalog.get(key)! + match[3];
  }
  return undefined;
}
