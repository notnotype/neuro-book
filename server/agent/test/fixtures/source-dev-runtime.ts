import {createServer} from "node:http";
import {writeFile} from "node:fs/promises";
import {acquireAgentSessionStoreLease, agentSessionStoreLeasePath} from "nbook/server/agent/session/agent-session-store-lease";

const rootWorkspace = requiredEnvironment("SOURCE_DEV_FIXTURE_WORKSPACE_ROOT");
const statePath = requiredEnvironment("SOURCE_DEV_FIXTURE_STATE_PATH");
const port = Number(requiredEnvironment("PORT"));
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Source Dev fixture端口无效：${String(port)}`);
}

// 故障fixture刻意不注册关闭处理：宿主消失时必须由Owned Process收口，留下的lock只由stale协议恢复。
await acquireAgentSessionStoreLease(rootWorkspace, "runtime");
const server = createServer((_request, response) => {
    response.writeHead(200, {"content-type": "text/plain"});
    response.end("source-dev-fixture");
});
await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", resolvePromise);
});
await writeFile(statePath, `${JSON.stringify({
    pid: process.pid,
    port,
    leasePath: agentSessionStoreLeasePath(rootWorkspace),
})}\n`, "utf8");

/** 读取 fixture 必需环境变量。 */
function requiredEnvironment(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Source Dev fixture缺少${name}`);
    return value;
}
