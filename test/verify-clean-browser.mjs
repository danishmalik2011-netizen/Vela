const targets = await fetch("http://127.0.0.1:9444/json/list").then((response) => response.json());
const page = targets.find((target) => target.type === "page" && target.url.startsWith("http://127.0.0.1:3000/"));
if (!page) throw new Error("Clean Vela page was not found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : resolve(message.result);
});
function command(method, params = {}) {
  const commandId = ++id;
  socket.send(JSON.stringify({ id: commandId, method, params }));
  return new Promise((resolve, reject) => pending.set(commandId, { resolve, reject }));
}
const consoleMessages = [];
await command("Runtime.enable");
await command("Log.enable");
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.method === "Runtime.consoleAPICalled") consoleMessages.push(message.params.type);
  if (message.method === "Runtime.exceptionThrown") consoleMessages.push(message.params.exceptionDetails?.text || "exception");
  if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry?.level)) consoleMessages.push(message.params.entry.text);
});
const result = await command("Runtime.evaluate", {
  expression: `({
    href: location.href,
    ready: Boolean(window.__sageConversationControllerV2),
    projects: Boolean(window.VelaProjectStore),
    modules: [...document.scripts].filter(s => s.src.includes('/src/')).map(s => s.src),
    title: document.title
  })`,
  returnByValue: true
});
console.log(JSON.stringify({ ...result.result.value, consoleMessages }, null, 2));
socket.close();
