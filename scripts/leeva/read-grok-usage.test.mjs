import assert from "node:assert/strict";
import test from "node:test";
import { selectTarget } from "./read-grok-usage.mjs";

const target = {
  type: "page",
  url: "file:///Applications/Grok%20Bot.app/Contents/Resources/app.asar/dist/renderer/index.html",
  webSocketDebuggerUrl: "ws://127.0.0.1:9334/devtools/page/test",
};
test("accepts only the known local Grok renderer", () => {
  assert.equal(selectTarget([target]), target.webSocketDebuggerUrl);
  assert.throws(() => selectTarget([]));
  assert.throws(() => selectTarget([target, target]));
  assert.throws(() => selectTarget([{ ...target, url: "https://example.com/" }]));
});
test("rejects debugger redirects to other services or credential URLs", () => {
  for (const url of ["ws://example.com:9334/devtools/page/test", "ws://127.0.0.1:3100/devtools/page/test",
    "ws://user:secret@127.0.0.1:9334/devtools/page/test", "wss://127.0.0.1:9334/devtools/page/test",
    "ws://127.0.0.1:9334/devtools/browser/test"]) {
    assert.throws(() => selectTarget([{ ...target, webSocketDebuggerUrl: url }]));
  }
});
