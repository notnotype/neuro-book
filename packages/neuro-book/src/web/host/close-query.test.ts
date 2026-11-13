/**
 * 页面一侧的关闭前询问（docs/specs/runtime/browser-host.md 输出 9、10，场景 15 的宿主部分）：同进程的真实后端、真实窗口与
 * 测试插件登记的参与方；壳用一个 `EventTarget` 派发 `nbook-desktop` 事件、记下页面回的消息（形状同 desktop-bridge.ts）；
 * 宿主的提问按脚本作答；计时用手动时钟。层、对话框与挡输入在真实浏览器里验（e2e/desktop-close.e2e.ts）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {DiagnosticsConsole} from "@notnotype/nb-host/web";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {PROJECT_LIMIT_DEFAULTS} from "nbook/server/config";
import {manifestServerPlugins} from "nbook/server/plugins";
import type {RunningServer} from "nbook/server/start";
import {startClaimedServer} from "nbook/server/testing/claimed-server";
import {BROWSER_BOOTSTRAP_PATH, BROWSER_PROTOCOL_VERSION} from "nbook/shared/browser-bootstrap";
import {createDesktopBridge, DESKTOP_EVENT} from "nbook/shared/desktop-bridge";
import type {CloseReason, PageMessage} from "nbook/shared/desktop-bridge";
import {windowCloseKey} from "nbook/shared/host";
import type {RunningWorkReport} from "nbook/shared/running-work";

import {browserPluginDefinitions, builtinBrowserPlugins} from "../plugins";
import {createCloseQuery, NOT_CLOSED_MS, WORK_TIMEOUT_MS} from "./close-query";
import type {ClosePrompt} from "./close-query";
import {createConnection} from "./connection";
import {createBrowserWindow} from "./window";

let tmp = "";
let backend: RunningServer;
let sequence = 0;
const quietConsole: DiagnosticsConsole = {error: () => undefined, warn: () => undefined};

async function backendAt(port: number): Promise<RunningServer> {
    sequence += 1;
    const stateRoot = join(tmp, `state-${String(sequence)}`);
    return startClaimedServer({
        config: {host: "127.0.0.1", port, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS},
        plugins: (context) => manifestServerPlugins(context),
        process: new EventEmitter(),
        writeFatal: () => undefined,
    });
}

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-close-query", "close-query");
    backend = await backendAt(0);
    await backend.ready;
});

afterAll(async () => {
    backend.requestStop("test:done");
    await backend.stopped;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

type Behaviour = (request: {readonly reason: CloseReason; readonly signal: AbortSignal}) => Promise<"allow" | "deny">;

/** 登记一个参与方的测试插件；`calls` 记下谁被调用、以什么原因。 */
function participant(id: string, calls: string[], behave: Behaviour): {readonly descriptor: {readonly id: string; readonly version: string; readonly locations: readonly ["browser"]}; readonly definition: PluginDefinition} {
    return {
        descriptor: {id, version: "0.1.0", locations: ["browser"]},
        definition: {
            id,
            entries: [{
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                dependencies: [{key: windowCloseKey}],
                activate: (context: ActivationContext) => {
                    const release = context.services.require(windowCloseKey).participate((request) => {
                        calls.push(`${id}:${request.reason}`);
                        return behave(request);
                    });
                    context.signal.addEventListener("abort", release, {once: true});
                    return {};
                },
            }],
        },
    };
}

/** 一直等到 signal abort 才 settle 的参与方：记下它被 abort。 */
function hanging(seen: {aborted: number}): Behaviour {
    return ({signal}) => new Promise((resolve) => {
        signal.addEventListener("abort", () => {
            seen.aborted += 1;
            resolve("allow");
        }, {once: true});
    });
}

interface World {
    readonly sent: PageMessage[];
    readonly prompts: ClosePrompt[];
    readonly layer: string[];
    readonly reports: DiagnosticInput[];
    readonly clock: ManualClock;
    /** 宿主提问的作答：按 kind 取，没有就一直不答（直到被收起）。 */
    readonly answers: Partial<Record<ClosePrompt["kind"], "close" | "cancel">>;
    shell(message: unknown): void;
    readonly browserWindow: ReturnType<typeof createBrowserWindow>;
    stop(): Promise<void>;
}

function world(plugins: ReadonlyArray<ReturnType<typeof participant>>, options: {readonly fetchWork?: (signal: AbortSignal) => Promise<RunningWorkReport>; readonly rpc?: () => {readonly port: number; readonly path: string}} = {}): World {
    const builtin = [...builtinBrowserPlugins, ...plugins.map((plugin) => plugin.descriptor)];
    const rpc = options.rpc ?? (() => ({port: Number(new URL(backend.rpcUrl).port), path: "/"}));
    const stub = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: (request) => (new URL(request.url).pathname === BROWSER_BOOTSTRAP_PATH
        ? Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: rpc(), revision: "r", catalogs: [], plugins: builtin.map(({id, version}) => ({id, version}))})
        : new Response(null, {status: 404}))});
    const clock = new ManualClock();
    const page = new EventTarget();
    const browserWindow = createBrowserWindow({
        connection: createConnection(stub.url.href),
        page,
        console: quietConsole,
        clientIdentity: "close-query-test",
        navigation: {navigateDocument: () => undefined, reloadDocument: () => undefined, openExternal: () => "opened", currentUrl: () => "http://localhost/", replaceUrl: () => undefined},
        builtin,
        definitions: {...browserPluginDefinitions, ...Object.fromEntries(plugins.map((plugin) => [plugin.descriptor.id, plugin.definition]))},
        clock,
    });
    const sent: PageMessage[] = [];
    const prompts: ClosePrompt[] = [];
    const layer: string[] = [];
    const reports: DiagnosticInput[] = [];
    const answers: World["answers"] = {};
    const shellTarget = new EventTarget();
    const global = {
        addEventListener: (type: string, listener: (event: unknown) => void) => shellTarget.addEventListener(type, listener as EventListener),
        removeEventListener: (type: string, listener: (event: unknown) => void) => shellTarget.removeEventListener(type, listener as EventListener),
        __electrobunSendToHost: (message: unknown) => void sent.push(message as PageMessage),
    };
    const query = createCloseQuery({
        bridge: createDesktopBridge(global),
        window: browserWindow,
        fetchWork: options.fetchWork ?? (async () => ({items: [], failed: []})),
        prompts: {
            ask: (prompt, signal) => {
                prompts.push(prompt);
                const answer = answers[prompt.kind];
                if (answer !== undefined) return Promise.resolve(answer);
                return new Promise((resolve) => signal.addEventListener("abort", () => resolve("cancel"), {once: true}));
            },
        },
        layer: {show: () => void layer.push("show"), hide: () => void layer.push("hide")},
        report: (input) => void reports.push(input),
        clock,
    });
    return {
        sent, prompts, layer, reports, clock, answers, browserWindow,
        shell: (detail) => void shellTarget.dispatchEvent(new CustomEvent(DESKTOP_EVENT, {detail})),
        stop: async () => {
            query.dispose();
            await browserWindow.stop();
            stub.stop(true);
        },
    };
}

const answered = (w: World): PageMessage | undefined => w.sent.find((message) => message.type === "close-answer");

/** 让事件循环转一圈：已经 settle 的 Promise 的后续都跑完（不是按时长等）。 */
const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("关闭前询问：页面一侧", () => {
    it("按登记顺序调参与方，前一个完成才调下一个；有一个 deny 就停、回 deny；先回接下、盖层，deny 后撤层", async () => {
        const calls: string[] = [];
        let release!: (answer: "deny") => void;
        const w = world([participant("test.first", calls, () => new Promise((resolve) => (release = resolve))), participant("test.second", calls, async () => "allow")]);
        await w.browserWindow.start();
        w.shell({type: "close-query", generation: 1, reason: "window"});
        expect(w.sent).toEqual([{type: "close-ack", generation: 1}]);
        expect(w.layer).toEqual(["show"]);
        await waitUntil("第一个参与方被调用", () => calls.length === 1);
        await nextTurn();
        expect(calls).toEqual(["test.first:window"]);
        release("deny");
        await waitUntil("回答", () => answered(w));
        expect(answered(w)).toEqual({type: "close-answer", generation: 1, answer: "deny"});
        expect(calls).toEqual(["test.first:window"]);
        expect(w.layer).toEqual(["show", "hide"]);
        await w.stop();
    });

    it("都同意：回 allow，层保留；10 秒窗口还没关就撤层并写诊断", async () => {
        const calls: string[] = [];
        const w = world([participant("test.first", calls, async () => "allow"), participant("test.second", calls, async () => "allow")]);
        await w.browserWindow.start();
        w.shell({type: "close-query", generation: 4, reason: "window"});
        await waitUntil("回答", () => answered(w));
        expect(answered(w)).toEqual({type: "close-answer", generation: 4, answer: "allow"});
        expect(calls).toEqual(["test.first:window", "test.second:window"]);
        expect(w.layer).toEqual(["show"]);
        w.clock.advance(NOT_CLOSED_MS - 1);
        expect(w.layer).toEqual(["show"]);
        w.clock.advance(1);
        expect(w.layer).toEqual(["show", "hide"]);
        expect(w.reports.map((report) => report.event)).toContain("browser-host.close.not-closed");
        await w.stop();
    });

    it("参与方抛错：写诊断并问“仍然关闭 / 取消”；仍然关闭就接着问下一个，取消回 deny", async () => {
        const calls: string[] = [];
        const w = world([participant("test.broken", calls, async () => {
            throw new Error("检查坏了");
        }), participant("test.second", calls, async () => "allow")]);
        await w.browserWindow.start();
        w.answers["participant-failed"] = "close";
        w.shell({type: "close-query", generation: 1, reason: "window"});
        await waitUntil("回答", () => answered(w));
        expect(answered(w)?.type === "close-answer" && answered(w)).toMatchObject({answer: "allow"});
        expect(w.prompts).toEqual([{kind: "participant-failed", reason: "检查坏了"}]);
        expect(calls).toEqual(["test.broken:window", "test.second:window"]);
        expect(w.reports.map((report) => report.event)).toContain("browser-host.close.participant-failed");

        // 上一次同意后层还盖着；壳结束它（这里模拟）之后再问，才会重新调参与方。
        w.shell({type: "close-end", generation: 1});
        expect(w.layer).toEqual(["show", "hide"]);
        w.sent.length = 0;
        w.answers["participant-failed"] = "cancel";
        w.shell({type: "close-query", generation: 2, reason: "window"});
        await waitUntil("第二次回答", () => answered(w));
        expect(answered(w)).toEqual({type: "close-answer", generation: 2, answer: "deny"});
        await w.stop();
    });

    it("quit：取在跑的工作，有工作时提示、取消回 deny；取不到或有取不到的提示“无法确认”；没有工作不提示", async () => {
        let report: RunningWorkReport | Error = {items: [{plugin: "nbook.agent", project: null, text: "Agent 会话「第三章」正在运行"}], failed: []};
        const w = world([], {fetchWork: async () => {
            if (report instanceof Error) throw report;
            return report;
        }});
        await w.browserWindow.start();
        w.answers.work = "cancel";
        w.shell({type: "close-query", generation: 1, reason: "quit"});
        await waitUntil("回答", () => answered(w));
        expect(answered(w)).toMatchObject({answer: "deny"});
        expect(w.prompts).toEqual([{kind: "work", items: [{plugin: "nbook.agent", project: null, text: "Agent 会话「第三章」正在运行"}], uncertain: false}]);

        const unreachable: ReadonlyArray<RunningWorkReport | Error> = [new Error("断了"), {items: [], failed: [{plugin: null, project: "p1"}]}];
        for (const next of unreachable) {
            report = next;
            w.sent.length = 0;
            w.prompts.length = 0;
            w.answers.work = "close";
            w.shell({type: "close-query", generation: 2, reason: "quit"});
            await waitUntil("回答", () => answered(w));
            expect(answered(w)).toMatchObject({answer: "allow"});
            expect(w.prompts).toEqual([{kind: "work", items: [], uncertain: true}]);
        }

        report = {items: [], failed: []};
        w.sent.length = 0;
        w.prompts.length = 0;
        w.shell({type: "close-query", generation: 3, reason: "quit"});
        await waitUntil("回答", () => answered(w));
        expect(answered(w)).toMatchObject({answer: "allow"});
        expect(w.prompts).toEqual([]);
        // 原因是 window 时不取工作。
        report = new Error("不该来取");
        w.sent.length = 0;
        w.shell({type: "close-query", generation: 4, reason: "window"});
        await waitUntil("回答", () => answered(w));
        expect(answered(w)).toMatchObject({answer: "allow"});
        expect(w.prompts).toEqual([]);
        await w.stop();
    });

    it("取工作 8 秒没有结果：按取不到提示", async () => {
        let fetching = 0;
        const w = world([], {fetchWork: (signal) => {
            fetching += 1;
            return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true}));
        }});
        await w.browserWindow.start();
        w.answers.work = "close";
        w.shell({type: "close-query", generation: 1, reason: "quit"});
        await waitUntil("开始取工作", () => fetching === 1);
        w.clock.advance(WORK_TIMEOUT_MS - 1);
        await nextTurn();
        expect(w.prompts).toEqual([]);
        w.clock.advance(1);
        await waitUntil("回答", () => answered(w));
        expect(w.prompts).toEqual([{kind: "work", items: [], uncertain: true}]);
        await w.stop();
    });

    it("壳结束询问（close-end）：正在调用的参与方 signal abort，后面的不再调，不回答、撤层；迟到的 close-end 不理", async () => {
        const calls: string[] = [];
        const seen = {aborted: 0};
        const w = world([participant("test.saving", calls, hanging(seen)), participant("test.second", calls, async () => "allow")]);
        await w.browserWindow.start();
        w.shell({type: "close-query", generation: 7, reason: "window"});
        await waitUntil("第一个参与方被调用", () => calls.length === 1);
        w.shell({type: "close-end", generation: 6});
        expect(seen.aborted).toBe(0);
        w.shell({type: "close-end", generation: 7});
        expect(seen.aborted).toBe(1);
        await nextTurn();
        expect(calls).toEqual(["test.saving:window"]);
        expect(answered(w)).toBeUndefined();
        expect(w.layer).toEqual(["show", "hide"]);
        await w.stop();
    });

    it("新的询问到来：上一次按结束处理（它的提问收起、不回答），新的一次照常问", async () => {
        const w = world([], {fetchWork: async () => ({items: [{plugin: "nbook.tasks", project: null, text: "导入"}], failed: []})});
        await w.browserWindow.start();
        w.shell({type: "close-query", generation: 1, reason: "quit"});
        await waitUntil("第一次的提问", () => w.prompts.length === 1);
        w.answers.work = "close";
        w.shell({type: "close-query", generation: 2, reason: "quit"});
        await waitUntil("回答", () => answered(w));
        expect(w.sent).toEqual([{type: "close-ack", generation: 1}, {type: "close-ack", generation: 2}, {type: "close-answer", generation: 2, answer: "allow"}]);
        await w.stop();
    });

    it("启动还没完成就来询问：立即接下；没有参与方要调，原因 window 时回 allow", async () => {
        const calls: string[] = [];
        const w = world([participant("test.first", calls, async () => "deny")]);
        w.shell({type: "close-query", generation: 1, reason: "window"});
        await waitUntil("回答", () => answered(w));
        expect(w.sent).toEqual([{type: "close-ack", generation: 1}, {type: "close-answer", generation: 1, answer: "allow"}]);
        expect(calls).toEqual([]);
        await w.browserWindow.start();
        await w.stop();
    });

    it("window 同意之后壳以 quit 重问：层一直盖着，不再调参与方，只取工作", async () => {
        const calls: string[] = [];
        let fetched = 0;
        const w = world([participant("test.first", calls, async () => "allow")], {fetchWork: async () => {
            fetched += 1;
            return {items: [], failed: []};
        }});
        await w.browserWindow.start();
        w.shell({type: "close-query", generation: 1, reason: "window"});
        await waitUntil("第一次回答", () => answered(w));
        w.sent.length = 0;
        w.shell({type: "close-query", generation: 2, reason: "quit"});
        await waitUntil("第二次回答", () => answered(w));
        expect(answered(w)).toEqual({type: "close-answer", generation: 2, answer: "allow"});
        expect(calls).toEqual(["test.first:window"]);
        expect(fetched).toBe(1);
        expect(w.layer).toEqual(["show", "show"]);
        // 第二次同意之后的保险计时从头算，到点照样撤层。
        w.clock.advance(NOT_CLOSED_MS);
        expect(w.layer).toEqual(["show", "show", "hide"]);
        await w.stop();
    });

    it("询问中途服务端换了进程：正在调用的参与方 abort、后面的不再调，改按宿主页接着走并回答", async () => {
        const calls: string[] = [];
        const seen = {aborted: 0};
        const first = await backendAt(0);
        await first.ready;
        const httpPort = Number(new URL(first.url!).port);
        let server = first;
        const w = world([participant("test.saving", calls, hanging(seen)), participant("test.second", calls, async () => "allow")], {rpc: () => ({port: Number(new URL(server.rpcUrl).port), path: "/"})});
        await w.browserWindow.start();
        w.shell({type: "close-query", generation: 1, reason: "window"});
        await waitUntil("第一个参与方被调用", () => calls.length === 1);
        first.requestStop("test:restart");
        await first.stopped;
        await waitUntil("窗口标注离线", () => w.browserWindow.state.status === "ready" && w.browserWindow.state.connection === "offline");
        server = await backendAt(httpPort);
        await server.ready;
        w.clock.advance(500);
        await waitUntil("窗口转为服务端已重启", () => w.browserWindow.state.status === "server-restarted");
        await waitUntil("回答", () => answered(w));
        expect(answered(w)).toEqual({type: "close-answer", generation: 1, answer: "allow"});
        expect(seen.aborted).toBe(1);
        expect(calls).toEqual(["test.saving:window"]);
        await w.stop();
        server.requestStop("test:done");
        await server.stopped;
    }, 20_000);

    it("没有壳的发送函数：照常走完，回答时写一条诊断", async () => {
        const w = world([]);
        await w.browserWindow.start();
        // 换一个没有发送函数的桥：直接建第二个控制器，事件目标独立。
        const target = new EventTarget();
        const reports: DiagnosticInput[] = [];
        const query = createCloseQuery({
            bridge: createDesktopBridge({addEventListener: (type, listener) => target.addEventListener(type, listener as EventListener), removeEventListener: (type, listener) => target.removeEventListener(type, listener as EventListener)}),
            window: w.browserWindow,
            fetchWork: async () => ({items: [], failed: []}),
            prompts: {ask: async () => "close"},
            layer: {show: () => undefined, hide: () => undefined},
            report: (input) => void reports.push(input),
            clock: w.clock,
        });
        target.dispatchEvent(new CustomEvent(DESKTOP_EVENT, {detail: {type: "close-query", generation: 1, reason: "window"}}));
        await waitUntil("两次诊断（接下与回答）", () => reports.filter((report) => report.event === "browser-host.close.no-bridge").length === 2);
        query.dispose();
        await w.stop();
    });
});
