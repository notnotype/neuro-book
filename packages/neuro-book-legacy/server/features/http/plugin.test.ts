import {afterEach, describe, expect, it, vi} from "vitest";
import {createHooks} from "hookable";
import type {NitroRuntimeHooks} from "nitropack/types";
import type {H3Event} from "h3";
import {createApplication} from "nbook/runtime/application/application";
import type {Application} from "nbook/runtime/application/application";
import {createDiagnosticsPlugin, createDiagnosticsStore, diagnosticsKey} from "nbook/runtime/diagnostics/diagnostics";
import {createServerTiming} from "nbook/server/utils/server-timing";
import {createHttpPlugin, httpKey} from "./plugin";
import {ProductHttpAdmission} from "./admission";

const logger = vi.hoisted(() => ({error: vi.fn(async () => undefined)}));
vi.mock("nbook/server/app-logs/logger", () => ({appLogger: logger}));
const applications: Application[] = [];
afterEach(async () => {
    for (const application of applications.splice(0)) await application.stop();
    vi.clearAllMocks();
});

async function activate() {
    const hooks = createHooks<NitroRuntimeHooks>();
    const store = createDiagnosticsStore({identity: {location: "server", instanceId: "http-hooks"}});
    const diagnostics = createDiagnosticsPlugin({location: "server", store, exporter: async () => ({status: "degraded", reason: "memory", detail: null}), fallback: () => undefined});
    const application = createApplication({identity: store.identity, stopSignal: new AbortController().signal, emergency: () => undefined}, {
        keys: [diagnosticsKey, httpKey], plugins: [diagnostics, createHttpPlugin(new ProductHttpAdmission(), undefined, () => undefined, {hooks})],
        requiredPlugins: ["nbook.http"], gates: [],
    });
    applications.push(application);
    expect(await application.startup).toMatchObject({status: "available"});
    return {application, hooks};
}

function eventFor(path = "/api/fail?q=小说正文片段") {
    const headers: Record<string, string> = {};
    const event = {method: "GET", path, context: {}, node: {res: {
        getHeader: (name: string) => headers[name.toLowerCase()],
        setHeader: (name: string, value: string) => {headers[name.toLowerCase()] = value;},
        getHeaders: () => headers,
    }}} as unknown as H3Event;
    return {event, headers};
}

describe("nbook.http 的 Nitro hooks", () => {
    it("请求失败只记录 pathname，摘要与错误栈清理 query；关闭后不再写请求错误", async () => {
        const {application, hooks} = await activate();
        const {event} = eventFor();
        const error = new Error("Cannot find any path matching /api/fail?q=小说正文片段.");
        error.stack = "Error: Cannot find any path matching /api/fail?q=小说正文片段.";
        await hooks.callHook("error", error, {event});
        expect(logger.error).toHaveBeenCalledExactlyOnceWith("server.request.error", {
            method: "GET", path: "/api/fail", statusCode: 500, message: "Cannot find any path matching /api/fail.",
        }, {name: "Error", message: "Cannot find any path matching /api/fail.", stack: "Error: Cannot find any path matching /api/fail."}, "服务端请求失败: GET /api/fail");
        expect(JSON.stringify(logger.error.mock.calls)).not.toContain("小说正文片段");
        await application.stop();
        await hooks.callHook("error", error, {event});
        expect(logger.error).toHaveBeenCalledOnce();
    });

    it("响应提交 Server-Timing 并合并现有值；关闭后 beforeResponse 已注销", async () => {
        const {application, hooks} = await activate();
        const {event, headers} = eventFor("/api/timing");
        createServerTiming(event).mark("agent.total", 12.34);
        const response = {headers: {"server-timing": "existing;dur=1.0"}, body: "ok"};
        await hooks.callHook("beforeResponse", event, response);
        expect(headers["server-timing"]).toBe("existing;dur=1.0, agent.total;dur=12.3");
        expect(response.headers).toHaveProperty("Server-Timing", "existing;dur=1.0, agent.total;dur=12.3");
        await application.stop();
        const late = eventFor("/api/late");
        createServerTiming(late.event).mark("late", 1);
        await hooks.callHook("beforeResponse", late.event, {headers: {}, body: "late"});
        expect(late.headers["server-timing"]).toBeUndefined();
    });
});
