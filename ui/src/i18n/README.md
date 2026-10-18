# Leeva UI language support

This fork defaults to Simplified Chinese. Personal settings offers 中文 / EN and
stores the preference under `paperclip.ui.locale`. Existing English preferences
continue to work. Switching refreshes the React UI subtree, like the former
page reload: transient forms reset, while route, server data and browser-saved
drafts remain. A failed storage write still permits a session-only switch.

## Sources and maintenance

`reference/en.json` and `reference/zh-CN.json` contain **data only** from
[oooBCKooo's Simplified Chinese contribution, PR #11373](https://github.com/paperclipai/paperclip/pull/11373),
commit `0cac809a0cea0e5bc1cf84ee1f9b48505eff2fed`, repository
`oooBCKooo/paperclip`, paths `ui/src/i18n/locales/{en,zh-CN}.json` (MIT).
Credit for those translations belongs to that contributor. No implementation
code from the unmerged PR is included. The source predates this fork's upstream
version; `display-overrides.json` carries reviewed current UI terms migrated
from the existing local patch. Ambiguous translations are skipped unless an
override resolves them; missing copy remains English.

The existing i18next instance owns language state and key-based `t()` calls.
For new UI code prefer explicit `t()` at the final presentation boundary and
add corresponding entries to the existing locale resources. Do not translate
API data, task titles/bodies, agent prompts, IDs, values, paths or discriminators.

The Vite source transform is a migration bridge for existing UI copy. It operates
before React compilation; no hashed output files are patched. It translates
static JSX text and allowed display attributes of an explicit presentational
component list. It skips comparisons, callbacks, arbitrary function arguments,
interpolated templates and opaque code/Markdown/prompt children.
The build-only `typescript-compiler-api` alias pins TypeScript 5.9.3's stable
JavaScript AST API; the repository's TypeScript 7 typechecker is unchanged.

Static menu/select descriptors with `value`/`href` and `setBreadcrumbs` objects
may register their literal `label` in a WeakMap. Registration returns the exact
original object without changing or adding enumerable fields. Only a JSX
display read of that registered, unchanged property resolves its translation.
API objects, changed labels and copies which lost their registration stay raw.
Logical `label === "Tasks"` checks and serialized payloads therefore retain
their original behavior. SearchableSelect matches both original and display
labels. The environment-variable editor recognizes translated commit buttons
when flushing pending edits.

## Checks

From the repository root:

```sh
pnpm --filter @paperclipai/ui exec vitest run src/i18n
pnpm --filter @paperclipai/ui typecheck
pnpm --filter @paperclipai/ui build
pnpm check:token-gates
```

Add a source-transform negative test whenever extending the display boundary.
Never add runtime string matching over arbitrary API/user text to increase
coverage. The mock-only preview configurations intentionally retain their own
build behavior; the normal app Vite configuration enables this bridge.
