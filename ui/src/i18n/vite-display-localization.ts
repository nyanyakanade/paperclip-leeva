import ts from "typescript-compiler-api";
import type { Plugin } from "vite";
import { lookupDisplayText } from "./display-catalog";

const nativeProps = new Set(["aria-label", "title", "alt", "placeholder"]);
const noProps = new Set<string>();
const displayProps = new Set([
  ...nativeProps, "label", "ariaLabel", "subtitle", "description", "hint", "emptyLabel",
  "searchPlaceholder", "buttonText", "actionLabel", "headerTitle", "headerDescription",
]);
// Explicitly presentational components. New business components are not opted in by name pattern.
const displayComponents = new Set([
  "Field", "Button", "SidebarNavItem", "SubSection", "Section", "DetailRow", "PropertyRow",
  "MetricTile", "Input", "ExperimentalToggleCard", "FieldRow", "ToggleField", "TextField",
  "DetailFact", "PropertyPicker", "InlineBanner", "SelectTrigger", "MetadataRow", "PolicyRow",
  "SidebarSection", "StatCard", "CaseCopyableToken", "PropertySection", "ChartCard", "SummaryRow",
  "LoadingState", "GitHubToggle", "Fact", "Link", "Badge", "EmptyState", "FieldLabel",
  "ChipToggleGroup", "SearchFilterMenu", "CasePropertyRow", "Textarea", "MenuAction",
  "MetaRow", "AgentSetupPrompt", "NavItem", "ToggleSwitch", "SummaryCard", "FilterSection",
  "CollapsibleSection", "FilterOptionSearch", "Metric", "MetaCard", "FilterField", "DetailSection",
  "MetricCard", "PropRow", "Row", "FieldHelp", "SecretField", "QuotaBar", "ControlButton",
  "ConfirmActionButton", "ServerInfoRow", "ResultRow", "ToolsPageHeader", "SettingToggle",
  "MobileField", "StepHeader", "CommandInput", "SearchableSelect", "FormField", "OnboardingHeading",
]);
const opaqueChildren = /^(?:code|pre|textarea|script|style)$|Markdown|Editor|Prompt|CodeBlock|Copy/;

/** React's JSX whitespace normalization, before replacing JSX text with an expression. */
function jsxText(value: string) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line, i) => {
    let text = line.replace(/\t/g, " ");
    if (i !== 0) text = text.replace(/^ +/, "");
    if (i !== lines.length - 1) text = text.replace(/ +$/, "");
    return text;
  }).filter(Boolean).join(" ");
}

/** Scoped source transform: no compiled bundle patches or untranslated business-value mutation. */
export function transformDisplaySource(source: string, fileName: string): string | null {
  if (!/\.tsx?$/.test(fileName) || /(?:\.test\.|\/i18n\/|\/api\/)/.test(fileName)) return null;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let changed = false;
  let usesDisplay = false;
  let usesDescriptor = false;
  let usesProperty = false;
  const factory = ts.factory;
  const translate = (node: ts.Expression): ts.Expression => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!lookupDisplayText(node.text)) return node;
      usesDisplay = changed = true;
      return factory.createCallExpression(factory.createIdentifier("__leevaDisplayText"), undefined,
        [factory.createStringLiteral(node.text)]);
    }
    if (ts.isPropertyAccessExpression(node) && !node.questionDotToken && node.name.text === "label") {
      usesProperty = changed = true;
      return factory.createCallExpression(factory.createIdentifier("__leevaDisplayProperty"), undefined,
        [node.expression, factory.createStringLiteral("label")]);
    }
    if (ts.isParenthesizedExpression(node)) return factory.updateParenthesizedExpression(node, translate(node.expression));
    if (ts.isConditionalExpression(node)) return factory.updateConditionalExpression(node,
      node.condition, node.questionToken, translate(node.whenTrue), node.colonToken, translate(node.whenFalse));
    if (ts.isBinaryExpression(node)) {
      // Conditions, comparisons, arbitrary call arguments and callbacks are never traversed.
      if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken]
        .includes(node.operatorToken.kind)) return factory.updateBinaryExpression(node, node.left, node.operatorToken, translate(node.right));
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return factory.updateBinaryExpression(node,
        translate(node.left), node.operatorToken, translate(node.right));
    }
    if (ts.isArrayLiteralExpression(node)) return factory.updateArrayLiteralExpression(node,
      node.elements.map((element) => ts.isSpreadElement(element) ? element : translate(element)));
    return node;
  };
  function registerable(node: ts.ObjectLiteralExpression) {
    // An API spread or a duplicate/computed key could replace the apparent literal at runtime.
    if (node.properties.some((property) => ts.isSpreadAssignment(property)
      || (property.name && ts.isComputedPropertyName(property.name)))) return false;
    if (node.properties.filter((property) => property.name?.getText(file) === "label").length !== 1) return false;
    const label = node.properties.find((property) => ts.isPropertyAssignment(property)
      && property.name.getText(file) === "label");
    if (!label || !ts.isPropertyAssignment(label) || !ts.isStringLiteral(label.initializer)
      || !lookupDisplayText(label.initializer.text)) return false;
    // Menus/select options and breadcrumb objects only. Payload objects without these shapes stay untouched.
    if (node.properties.some((property) => ts.isPropertyAssignment(property)
      && ["value", "href"].includes(property.name.getText(file))
      && ts.isStringLiteral(property.initializer))) return true;
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (ts.isCallExpression(parent) && parent.expression.getText(file) === "setBreadcrumbs") return true;
      if (ts.isStatement(parent)) break;
    }
    return false;
  }
  const result = ts.transform(file, [(context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tag = opening.tagName.getText(file);
        const hasExplicitValue = opening.attributes.properties.some((attribute) =>
          ts.isJsxAttribute(attribute) && attribute.name.getText(file) === "value");
        const childrenAreData = opaqueChildren.test(tag)
          || (["option", "CommandItem", "SelectItem"].includes(tag) && !hasExplicitValue);
        const allowedProps = /^[a-z]/.test(tag) ? nativeProps : displayComponents.has(tag) ? displayProps : noProps;
        const properties = opening.attributes.properties.map((attribute) => {
          if (!ts.isJsxAttribute(attribute) || !allowedProps.has(attribute.name.getText(file)) || !attribute.initializer) return attribute;
          const value = ts.isStringLiteral(attribute.initializer) ? attribute.initializer
            : ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
          if (!value) return attribute;
          const next = translate(value);
          return next === value ? attribute : factory.updateJsxAttribute(attribute, attribute.name,
            factory.createJsxExpression(undefined, next));
        });
        const attributes = factory.updateJsxAttributes(opening.attributes, properties);
        if (ts.isJsxSelfClosingElement(node)) return factory.updateJsxSelfClosingElement(node,
          node.tagName, node.typeArguments, attributes);
        const children = node.children.map((child) => {
          if (childrenAreData) return child;
          if (!childrenAreData) {
            if (ts.isJsxText(child)) {
              const text = jsxText(child.text);
              if (lookupDisplayText(text)) return factory.createJsxExpression(undefined,
                translate(factory.createStringLiteral(text)));
            }
            if (ts.isJsxExpression(child) && child.expression) {
              const expression = translate(child.expression);
              return factory.updateJsxExpression(child, ts.visitNode(expression, visit) as ts.Expression);
            }
          }
          return ts.visitNode(child, visit) as ts.JsxChild;
        });
        return factory.updateJsxElement(node, factory.updateJsxOpeningElement(node.openingElement,
          node.openingElement.tagName, node.openingElement.typeArguments, attributes), children, node.closingElement);
      }
      if (ts.isObjectLiteralExpression(node) && registerable(node)) {
        usesDescriptor = changed = true;
        return factory.createCallExpression(factory.createIdentifier("__leevaDisplayDescriptor"), undefined,
          [ts.visitEachChild(node, visit, context), factory.createArrayLiteralExpression([factory.createStringLiteral("label")])]);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (sourceFile) => ts.visitNode(sourceFile, visit) as ts.SourceFile;
  }]);
  if (!changed) { result.dispose(); return null; }
  const names = [usesDisplay && "displayText as __leevaDisplayText", usesDescriptor && "registerDisplayDescriptor as __leevaDisplayDescriptor", usesProperty && "displayProperty as __leevaDisplayProperty"].filter(Boolean);
  const printed = ts.createPrinter().printFile(result.transformed[0] as ts.SourceFile);
  result.dispose();
  return `import { ${names.join(", ")} } from "@/i18n/display";\n${printed}`;
}

export function displayLocalizationPlugin(): Plugin {
  return {
    name: "leeva-display-localization", enforce: "pre",
    transform(code, id) {
      const fileName = id.split("?")[0].replaceAll("\\", "/");
      if (!fileName.includes("/ui/src/")) return null;
      const transformed = transformDisplaySource(code, fileName);
      return transformed ? { code: transformed, map: null } : null;
    },
  };
}
