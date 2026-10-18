import { describe, expect, it } from "vitest";
import { transformDisplaySource } from "./vite-display-localization";

const transform = (source: string) => transformDisplaySource(source, "/workspace/ui/src/components/Fixture.tsx")!;

describe("display-only source transform", () => {
  it("localizes final JSX output while preserving comparisons, routes, values and prompts", () => {
    const output = transform(`
      const item = { value: "todo", label: "Tasks", prompt: "Save" };
      const payload = { title: "Tasks", description: "Save", label: "Save" };
      function View() {
        return <><button onClick={() => api({ label: "Save", prompt: "Save" })}
          name="Save" value="Save" aria-label="Save">{item.label === "Tasks" ? "Save" : "Cancel"}</button>
          <a href="/Tasks">Tasks</a><AgentSetupPrompt prompt="Save" title="Settings" />
          <Widget title="Save" /><pre>Save</pre><MarkdownBody>{"Save"}</MarkdownBody></>;
      }
    `);
    expect(output).toContain('label: "Tasks"');
    expect(output).toContain('item.label === "Tasks"');
    expect(output).toContain('value="Save"');
    expect(output).toContain('href="/Tasks"');
    expect(output).toContain('prompt="Save"');
    expect(output).toContain('api({ label: "Save", prompt: "Save" })');
    expect(output).toContain('const payload = { title: "Tasks", description: "Save", label: "Save" }');
    expect(output).toMatch(/<Widget title="Save"\s*\/>/);
    expect(output).toContain('<pre>Save</pre>');
    expect(output).toContain('<MarkdownBody>{"Save"}</MarkdownBody>');
    expect(output).toContain('__leevaDisplayText("Save")');
  });

  it("registers static breadcrumb/menu copy but leaves dynamic API labels untouched", () => {
    const output = transform(`
      setBreadcrumbs([{ label: "Tasks" }, { label: task.title }]);
      const choices = [{ value: "todo", label: "Todo" }];
      const payload = { label: "Tasks" };
      const view = <span>{choice.label}</span>;
    `);
    expect(output).toContain('__leevaDisplayDescriptor({ label: "Tasks" }, ["label"])');
    expect(output).toContain('{ label: task.title }');
    expect(output).toContain('const payload = { label: "Tasks" }');
    expect(output).toContain('__leevaDisplayProperty(choice, "label")');
  });

  it("does not transform API modules, tests, runtime helpers or interpolated task bodies", () => {
    expect(transformDisplaySource('const body = "Tasks";', "/workspace/ui/src/api/tasks.ts")).toBeNull();
    expect(transformDisplaySource('<span>Tasks</span>', "/workspace/ui/src/Fixture.test.tsx")).toBeNull();
    expect(transform('const view = <p>{task.description}</p>;')).toBeNull();
    expect(transform('const view = <span>{format("Tasks", task.title)}</span>;')).toBeNull();
    expect(transform('const view = <option>Tasks</option>;')).toBeNull();
    expect(transform('const view = <CopyText>Tasks</CopyText>;')).toBeNull();
    expect(transform('const view = <pre><span>Tasks</span></pre>;')).toBeNull();
    expect(transform('const view = <CopyText><span>Tasks</span></CopyText>;')).toBeNull();
    expect(transform('const option = { value: "todo", label: "Tasks", ...apiObject };')).toBeNull();
    expect(transform('const option = { value: "todo", label: "Tasks", label: apiLabel };')).toBeNull();
  });
});
