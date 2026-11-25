/**
 * 产品装配（docs/specs/web/tools.md 输出 20、21）：按产品清单起真实服务端（`manifestServerPlugins`），本进程里的浏览器内核
 * 实例经真实 WebSocket 连上 RPC 端口，调 `nbook.web/settings`。只往测试插件里注入定义，证明不了产品进程装上了本插件。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createSocketLink} from "@notnotype/nb-host/socket";
import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import {PROJECT_LIMIT_DEFAULTS} from "nbook/server/config";
import {manifestServerPlugins} from "nbook/server/plugins";
import {startClaimedServer} from "nbook/server/testing/claimed-server";
import type {RunningServer} from "nbook/server/start";
import {windowProjectKey} from "nbook/shared/projects";

import {webSettingsContract} from "./shared/contracts";

let tmp = "";
let backend: RunningServer;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-web", "产品装配");
    const stateRoot = join(tmp, "state");
    backend = await startClaimedServer({
        config: {host: "127.0.0.1", port: 0, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS},
        plugins: (context) => manifestServerPlugins(context),
        process: new EventEmitter(),
        writeFatal: () => undefined,
    });
    await backend.ready;
});

afterAll(async () => {
    backend.requestStop("test");
    expect(await backend.stopped).toMatchObject({exitCode: 0});
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("产品装配", () => {
    it("产品服务端装上了 nbook.web：窗口经真实 RPC 端口调到 status", async () => {
        const socket = new WebSocket(backend.rpcUrl);
        const link = createSocketLink({send: (text) => socket.send(text), close: () => socket.close()});
        const closed = Promise.withResolvers<void>();
        socket.addEventListener("message", (event) => link.receive(event.data));
        socket.addEventListener("close", () => {
            link.closed();
            closed.resolve();
        });
        await new Promise<void>((resolve, reject) => {
            socket.addEventListener("open", () => resolve(), {once: true});
            socket.addEventListener("error", () => reject(new Error("RPC 端口连不上")), {once: true});
        });
        const node = createRemoteNode({instance: {id: "w", kind: "browser", role: "client", project: null, client: "client-w"}, bind: null});
        expect(await node.connect(link)).toEqual({ok: true});
        const silent = {error: () => undefined};
        let captured: ActivationContext | null = null;
        const app = createApplication(
            {identity: {location: "browser", instanceId: "w", client: "client-w"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {
                capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project: null})}],
                plugins: [
                    createDiagnosticsPlugin({location: "browser", store: createDiagnosticsStore({identity: {location: "browser", instanceId: "w"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
                    {id: "test.web-assembly", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
                        captured = context;
                        return {};
                    }})]},
                ],
                gates: [],
                remote: node,
            },
        );
        try {
            expect(await app.startup).toMatchObject({status: "available", failures: []});
            if (captured === null) throw new Error("the probe did not activate");
            const client = (captured as ActivationContext).remote.use(webSettingsContract);
            expect(await client.status({})).toEqual({ok: true, value: {providers: {deepseek: {hasKey: false}, tavily: {hasKey: false}}}});
        } finally {
            await app.stop();
            socket.close();
            await closed.promise;
        }
    });
});
