import { Languages } from "lucide-react";
import { setUiLocale, useUiLocale } from "@/i18n/LocaleBoundary";

export function LanguageToggle() {
  const locale = useUiLocale();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-(length:--text-compact)">
      <Languages className="size-4 text-muted-foreground" />
      <span className="flex-1">语言 / Language</span>
      {([ ["zh-CN", "中文"], ["en", "EN"] ] as const).map(([code, label]) => (
        <button
          key={code}
          type="button"
          aria-pressed={locale === code}
          className="rounded-md px-2 py-1 text-foreground hover:bg-accent aria-pressed:bg-accent"
          onClick={() => { void setUiLocale(code); }}
        >
          {label}
        </button>
      ))}
      </div>
      <p className="px-2.5 text-sm text-muted-foreground">
        {locale === "zh-CN"
          ? "切换语言会重置未保存的表单，请先保存更改。"
          : "Save your changes first. Switching language resets unsaved forms."}
      </p>
    </div>
  );
}
