/**
 * 正文上限经真实 WebSocket（docs/specs/workspace/files.md 的“读取与保存”）：同进程启动的真实后端（产品清单，含
 * `nbook.files` 的服务端入口）、真实 RPC 监听器（单条消息上限 1 MiB，超过即断开）与 Bun 的 WebSocket 客户端；窗口
 * 是本进程里的浏览器内核实例。进程内链路不限消息大小，证明不了这条：超出上限的保存若被发出，连接被断开，保存成为
 * 结果未知，之后的调用也失败。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {PROJECT_LIMIT_DEFAULTS} from "nbook/server/config";
import {manifestServerPlugins} from "nbook/server/plugins";
import {startServer} from "nbook/server/start";
import type {RunningServer} from "nbook/server/start";
import {windowProjectKey} from "nbook/shared/projects";
import {createSocketLink, RPC_MAX_MESSAGE_BYTES} from "nbook/shared/rpc-socket";

import {encodedTextBytes, TEXT_BUDGET_BYTES} from "./shared/contracts";
import type {FilesService} from "./shared/contracts";
import {hash, probe, probePlugin} from "./testing/scene";
import {filesBrowserPlugin} from "./web/plugin";

let tmp = "";
let backend: RunningServer;
let stateRoot = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "transport");
    stateRoot = join(tmp, "state");
    backend = startServer({
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

interface Window {
    readonly files: FilesService;
    readonly app: Application;
    readonly closed: Promise<void>;
    close(): Promise<void>;
}

/** 不绑定项目的窗口，经真实 WebSocket 连到后端的 RPC 端口。 */
async function windowOf(id: string): Promise<Window> {
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
    const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client: `client-${id}`}, bind: null});
    expect(await node.connect(link)).toEqual({ok: true});
    const silent = {error: () => undefined};
    const tester = probe();
    const app = createApplication(
        {identity: {location: "browser", instanceId: id, client: `client-${id}`}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project: null})}],
            plugins: [
                createDiagnosticsPlugin({location: "browser", store: createDiagnosticsStore({identity: {location: "browser", instanceId: id}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
                filesBrowserPlugin,
                probePlugin(`x.${id}`, "browser", tester),
            ],
            gates: [],
            remote: node,
            delegation: (plugin) => plugin === "nbook.files",
        },
    );
    expect(await app.startup).toMatchObject({status: "available", failures: []});
    return {
        files: tester.files!,
        app,
        closed: closed.promise,
        close: async () => {
            await app.stop();
            socket.close();
            await closed.promise;
        },
    };
}

describe("Spec workspace.files 批量的大小上限：真实 WebSocket", () => {
    it("预算内的 1000 项批量经真实 RPC 端口往返；超出预算的在窗口里就被拒绝，连接不断，之后的调用照常", async () => {
        const window = await windowOf("w2");
        try {
            // 每项一个约 900 字节的不存在路径（单段不超过 250 字节）：输入接近预算，逐项结果是 1000 个 not-found。
            const segment = "p".repeat(220);
            const near = Array.from({length: 1000}, (_unused, index) => ({address: `user://${segment}/${segment}/${segment}/${segment}/${String(index).padStart(4, "0")}.md`}));
            const result = await window.files.delete(near).result;
            expect(result.ok && result.value.items.length).toBe(1000);
            expect(result.ok && result.value.items.every((item) => item.status === "failed" && item.code === "not-found")).toBe(true);

            const over = Array.from({length: 1000}, (_unused, index) => ({address: `user://${segment}/${segment}/${segment}/${segment}/${segment}/${String(index)}.md`}));
            expect(await window.files.delete(over).result).toMatchObject({ok: false, code: "too-large"});

            // 地址数组本身在预算内，但带上字段名与身份令牌的完整请求超过一条消息：按完整请求核对，在窗口里就拒绝。
            await writeFile(join(stateRoot, "user", "token.md"), "T");
            const identified = await window.files.identify(["user://token.md"]);
            const token = identified.ok ? (identified.value.items[0] as {readonly token: string}).token : "";
            // 源路径 968 字节：只算地址时恰在预算内，完整请求（字段名与令牌）超过一条 RPC 消息。
            const tail = "q".repeat(77);
            const edge = Array.from({length: 1000}, (_unused, index) => ({source: `user://${segment}/${segment}/${segment}/${segment}/${tail}${String(index).padStart(4, "0")}.md`, target: `user://t/${String(index).padStart(4, "0")}.md`, expected: token}));
            const flat = edge.flatMap((item) => [item.source.slice(7), item.target.slice(7)]);
            expect(new TextEncoder().encode(JSON.stringify(flat)).length).toBeLessThan(TEXT_BUDGET_BYTES);
            const full = {operation: crypto.randomUUID(), items: edge.map((item) => ({source: item.source.slice(7), target: item.target.slice(7), expected: item.expected}))};
            expect(new TextEncoder().encode(JSON.stringify(full)).length).toBeGreaterThan(RPC_MAX_MESSAGE_BYTES);
            expect(await window.files.move(edge).result).toMatchObject({ok: false, code: "too-large"});
            await writeFile(join(stateRoot, "user", "keep.md"), "K");
            expect(await window.files.copy([{source: "user://keep.md", target: "user://keep-copy.md"}]).result).toEqual({ok: true, value: {items: [{status: "done"}], manifests: []}});
            expect(await readFile(join(stateRoot, "user", "keep-copy.md"), "utf8")).toBe("K");
        } finally {
            await window.close();
        }
    }, 30_000);
});

describe("Spec workspace.files 正文上限：真实 WebSocket", () => {
    it("恰在上限内的正文经真实 RPC 端口读写；超出上限的保存在窗口里就被拒绝，连接不断，之后的调用照常", async () => {
        expect(TEXT_BUDGET_BYTES).toBe(RPC_MAX_MESSAGE_BYTES - 64 * 1024);
        const fits = "字".repeat(Math.floor((TEXT_BUDGET_BYTES - 2) / 3));
        expect(encodedTextBytes(fits)).toBeLessThanOrEqual(TEXT_BUDGET_BYTES);
        await writeFile(join(stateRoot, "user", "big.md"), fits);
        await writeFile(join(stateRoot, "user", "small.md"), "s");
        const window = await windowOf("w1");
        try {

            const read = await window.files.read("user://big.md");
            expect(read).toMatchObject({ok: true, value: {baseline: {hash: hash(fits)}}});
            const edited = `${fits.slice(1)}改`;
            expect(await window.files.write("user://big.md", edited, {hash: hash(fits)})).toMatchObject({ok: true});
            expect(await readFile(join(stateRoot, "user", "big.md"), "utf8")).toBe(edited);

            // 换行在 JSON 里编码成两个字节：原字节不到上限，编码后超过一条消息。
            const escaped = "\n".repeat(Math.ceil(RPC_MAX_MESSAGE_BYTES / 2) + 1);
            expect(await window.files.write("user://small.md", escaped, {hash: hash("s")})).toMatchObject({ok: false, code: "too-large"});
            expect(await window.files.write("user://small.md", `${fits}${fits}`, {hash: hash("s")})).toMatchObject({ok: false, code: "too-large"});
            expect(await window.files.list("user://")).toMatchObject({ok: true});
            expect(await window.files.write("user://small.md", "s2", {hash: hash("s")})).toMatchObject({ok: true});
            expect(await readFile(join(stateRoot, "user", "small.md"), "utf8")).toBe("s2");
        } finally {
            await window.close();
        }
    }, 30_000);
});
