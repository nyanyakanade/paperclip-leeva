// Read-only bridge to the already running Grok Bot. Never opens a window,
// starts a conversation, changes a routine, or reads authentication files.
import { fileURLToPath } from "node:url";

const endpoint = "http://127.0.0.1:9334";
const pageUrl = "file:///Applications/Grok%20Bot.app/Contents/Resources/app.asar/dist/renderer/index.html";

export function selectTarget(targets) {
  const matches = targets.filter(target => target.type === "page" && target.url === pageUrl);
  if (matches.length !== 1) throw new Error("Grok page unavailable or ambiguous");
  const url = new URL(matches[0].webSocketDebuggerUrl);
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || url.port !== "9334"
      || url.username || url.password || !url.pathname.startsWith("/devtools/page/")) {
    throw new Error("Unexpected debugger endpoint");
  }
  return url.href;
}

// Fixed allowlist: this app method returns account quota, not Token records.
export const expression = `(async () => {
  const usage = await window.desktop.main.getCursorWeeklyUsage();
  return usage == null ? null : {
    percentUsed: usage.percentUsed,
    nextResetMs: usage.nextResetMs,
    planLabel: usage.grokPlanLabel
  };
})()`;

export async function readUsage() {
  const response = await fetch(`${endpoint}/json/list`, {
    redirect: "error", signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Grok debugger unavailable");
  const socket = new WebSocket(selectTarget(await response.json()));
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Grok usage timeout")), 20_000);
      const finish = (error, value) => {
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: {
        expression, awaitPromise: true, returnByValue: true,
      } }));
      socket.onerror = () => finish(new Error("Grok debugger unavailable"));
      socket.onclose = () => finish(new Error("Grok debugger closed"));
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.id !== 1) return;
          if (message.error || message.result?.exceptionDetails) throw new Error("Grok usage unavailable");
          finish(null, message.result?.result?.value);
        } catch { finish(new Error("Grok usage unavailable")); }
      };
    });
  } finally {
    socket.close(); // Only our connection; keep the user's debugger open.
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await readUsage()));
  } catch {
    console.error("Grok account usage unavailable");
    process.exitCode = 1;
  }
}
