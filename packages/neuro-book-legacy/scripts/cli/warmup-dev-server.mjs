import {setTimeout as delay} from "node:timers/promises";

const defaultBaseUrl = "http://127.0.0.1:3000";
const baseUrl = (process.argv[2] || process.env.NUXT_WARMUP_BASE_URL || defaultBaseUrl).replace(/\/$/, "");
const timeoutMs = Number.parseInt(process.env.NUXT_WARMUP_TIMEOUT_MS || "60000", 10);

const warmupTargets = [
    "/",
    "/api/hello",
    "/api/auth/me",
    "/api/config/editor-snapshot?workspaceKind=user-assets",
    "/api/workspace-files/tree?workspaceKind=user-assets",
    "/api/projects",
    "/api/agent/sessions",
    "/api/agent/profiles/catalog",
    "/api/agent/skills",
];

/**
 * 等待 dev server 可访问。
 */
async function waitForServer() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(`${baseUrl}/api/hello`);
            if (response.ok) {
                return;
            }
        } catch {
            // dev server 启动前连接失败是预期状态，继续轮询。
        }
        await delay(1000);
    }

    throw new Error(`等待 Nuxt dev server 超时：${baseUrl}`);
}

/**
 * 请求单个预热点。
 */
async function warmup(path) {
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}${path}`);
    await response.arrayBuffer();
    const elapsedMs = Date.now() - startedAt;
    console.log(`${response.status} ${path} ${elapsedMs}ms`);
    return response;
}

console.log(`warming up ${baseUrl}`);
await waitForServer();

for (const target of warmupTargets) {
    try {
        await warmup(target);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`warmup skipped ${target}: ${message}`);
    }
}

console.log("warmup done");
