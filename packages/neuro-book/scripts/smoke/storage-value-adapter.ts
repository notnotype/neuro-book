#!/usr/bin/env node
/**
 * Storage 浏览器值适配器、分区绑定与状态订阅的真实浏览器 Smoke。
 *
 * 在隔离 State Root 与真实 HTTP 上让 Chromium 加载产品浏览器模块（`app/utils/storage`），
 * 验证单元测试无法证明的事实：真实 HTTP + 真实 IndexedDB 身份下，适配器能绑定分区代次、
 * 条件保存并在另一个标签页观察到确认值，订阅先给初始快照再按修订更新，回收让旧句柄与未读键
 * 一起失效，后端重启后显式重建可恢复，近 1 MiB 的合法记录不被传输层截断，释放后不再观察。
 *
 * 使用隔离 State Root 与独立浏览器上下文，不读取主应用登录态，也不碰机器默认 data。
 * 必须由 Node 运行（Windows 下 Bun 连接 Chromium 调试管道不稳定）。
 */

import {randomBytes} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createApp, createError, defineEventHandler, toNodeListener, type H3Event} from "h3";
import {build} from "esbuild";
import {chromium, type Browser, type ConsoleMessage, type Page} from "playwright-core";
import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
import {STORAGE_ACTION_BODY_LIMIT_BYTES, type StorageActionRequest} from "nbook/shared/storage/action";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
// 以下生产模块只按类型导入：它们必须在隔离根写进进程环境后再动态加载，理由见 loadStorageModules。
import type {absoluteFsPath, AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {
    disposeStorageHost,
    issueStorageUserContext,
    performStorageUserAction,
    releaseStorageUserContext,
    setStorageHostContextForTest,
} from "nbook/server/storage/host";
import type {readStorageActionRequest} from "nbook/server/storage/storage-actions";
import type {withStorageHttpError} from "nbook/server/storage/http-error";
import type {deriveStorageClientId} from "nbook/server/storage/access-context";
import type {storagePartitionPaths} from "nbook/server/storage/storage-address";

const CONTEXT_PATH = "/api/storage/user/context";
const ACTION_PATH = "/api/storage/user/action";

/** 近 1 MiB 的合法记录；现有 Agent SSE parser 的 128 KiB 上限不能拿来限制它。 */
const LARGE_VALUE_BYTES = 1024 * 1024 - 64;

export type StorageValueAdapterSmokeOptions = {
    /** 隔离临时根；State Root 为 `<root>/data`，浏览器站点文件为 `<root>/site`。 */
    readonly root: string;
    readonly browserExecutable: string;
    readonly headless?: boolean;
};

type SmokeFinding = {
    readonly kind: "assertion" | "console" | "page";
    readonly message: string;
};

/** 页面把适配器结果与失败投影成可序列化结果，避免把领域对象跨进程边界传。 */
type PageOutcome<T> =
    | {readonly ok: true; readonly value: T}
    | {readonly ok: false; readonly code: string | null; readonly status: number | null; readonly committed: boolean | null; readonly message: string};

type ReadView = {
    readonly kind: string;
    readonly value?: unknown;
    readonly schemaVersion?: number;
    readonly credential?: {readonly revision: string | null; readonly partitionGeneration: number};
    readonly credentialGeneration?: number;
    readonly diagnosis?: string | null;
};

type WriteView = {readonly revision: string | null; readonly partitionGeneration: number};
type SubscriptionView = {readonly count: number; readonly values: readonly unknown[]; readonly initial: unknown};

type SmokePageApi = {
    readonly open: (slot: string, name: string) => Promise<PageOutcome<{readonly binding: {readonly local: number | null; readonly shared: number}; readonly credential: string}>>;
    readonly read: (slot: string, name: string, resource?: string) => Promise<PageOutcome<ReadView>>;
    readonly save: (slot: string, name: string, value: unknown, resource?: string) => Promise<PageOutcome<WriteView>>;
    readonly remove: (slot: string, name: string, expected: WriteView, resource?: string) => Promise<PageOutcome<WriteView>>;
    readonly reclaim: (slot: string, name: string, targets: readonly {readonly resource?: string}[]) => Promise<PageOutcome<{readonly partitionGeneration: number; readonly outcomes: readonly {readonly outcome: string}[]}>>;
    readonly subscribe: (slot: string, name: string, resource?: string) => Promise<PageOutcome<SubscriptionView>>;
    readonly updates: () => SubscriptionView;
    readonly release: (slot: string) => Promise<PageOutcome<true>>;
};

type IsolatedHost = {
    readonly origin: string;
    readonly apiCalls: readonly string[];
    readonly close: () => Promise<void>;
};

type StorageModules = {
    readonly issueUserContext: typeof issueStorageUserContext;
    readonly releaseUserContext: typeof releaseStorageUserContext;
    readonly performAction: typeof performStorageUserAction;
    readonly readAction: (event: H3Event) => Promise<StorageActionRequest>;
    readonly setHostContextForTest: typeof setStorageHostContextForTest;
    readonly disposeHost: typeof disposeStorageHost;
    readonly withHttpError: typeof withStorageHttpError;
    readonly absoluteFsPath: typeof absoluteFsPath;
    readonly partitionPaths: typeof storagePartitionPaths;
    readonly deriveClientId: typeof deriveStorageClientId;
};

const SITE_FILES: readonly {readonly route: string; readonly fileName: string; readonly contentType: string}[] = [
    {route: "/", fileName: "index.html", contentType: "text/html; charset=utf-8"},
    {route: "/storage-values.js", fileName: "storage-values.js", contentType: "text/javascript; charset=utf-8"},
];

const PAGE_MARKUP = [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head><meta charset=\"utf-8\"><title>storage value adapter smoke</title></head>",
    "<body><script type=\"module\" src=\"/storage-values.js\"></script></body>",
    "</html>",
    "",
].join("\n");

/**
 * 浏览器入口：把产品适配器挂到页面上，并补上宿主运行时应提供的 `$fetch`。
 *
 * 页面只调用产品模块；这里不复制适配器逻辑，也不把状态值留在页面全局之外。
 */
const BROWSER_ENTRY_SOURCE = [
    "import {$fetch} from \"ofetch\";",
    "import {openStorageUserContext} from \"nbook/app/utils/storage/host-context-client\";",
    "import {openStorageOwnerHandle} from \"nbook/app/utils/storage/owner-handle\";",
    "import {defineStorageState} from \"nbook/shared/storage/definition\";",
    "",
    "// 宿主运行时（Nuxt）提供的 $fetch；产品适配器通过 apiFetch 消费它。",
    "globalThis.$fetch = $fetch;",
    "",
    "// 与 Node 侧注册的同名定义各自成实例：跨进程只需要相同的 owner/key/归属/容量。",
    "const definitions = {",
    "    layout: defineStorageState({",
    "        owner: \"smoke.layout\", key: \"layout\", scope: \"user\", locality: \"local\", records: \"single\", schemaVersion: 1,",
    "        defaultValue: {width: 320},",
    "        validate: (value) => typeof value === \"object\" && value !== null && typeof value.width === \"number\",",
    "    }),",
    "    note: defineStorageState({",
    "        owner: \"smoke.notes\", key: \"note\", scope: \"user\", locality: \"local\", records: \"identified\", schemaVersion: 1,",
    "        defaultValue: {text: \"\"},",
    "        validate: (value) => typeof value === \"object\" && value !== null && typeof value.text === \"string\",",
    "    }),",
    "    board: defineStorageState({",
    "        owner: \"smoke.shared\", key: \"board\", scope: \"user\", locality: \"shared\", records: \"single\", schemaVersion: 1,",
    "        defaultValue: {title: \"\"},",
    "        validate: (value) => typeof value === \"object\" && value !== null && typeof value.title === \"string\",",
    "        limits: {maxValueBytes: 1024 * 1024},",
    "    }),",
    "};",
    "",
    "const state = {handles: {}, credentials: {}, subscription: null, updates: [], initial: null};",
    "",
    "const recordKeyOf = (name, resource) => name + \"\\u0000\" + (resource ?? \"\");",
    "// 条件写入使用本条记录最近一次已确认的凭据：适配器不做通用合并，冲突必须由 owner 处理。",
    "const credentialOf = (name, resource) => state.credentials[recordKeyOf(name, resource)] ?? {revision: null, partitionGeneration: 1};",
    "",
    "const attempt = async (run) => {",
    "    try {",
    "        return {ok: true, value: await run()};",
    "    } catch (error) {",
    "        return {",
    "            ok: false,",
    "            code: error?.code ?? null,",
    "            status: error?.status ?? null,",
    "            committed: error?.committed === undefined ? null : error.committed,",
    "            message: error?.message ?? String(error),",
    "        };",
    "    }",
    "};",
    "",
    "const handleOf = (slot) => {",
    "    const handle = state.handles[slot];",
    "    if (handle === undefined) throw new Error(\"未打开的句柄槽：\" + slot);",
    "    return handle;",
    "};",
    "",
    "const readView = (result) => ({",
    "    kind: result.kind,",
    "    value: result.value,",
    "    schemaVersion: result.schemaVersion,",
    "    credential: result.credential,",
    "    credentialGeneration: result.credential?.partitionGeneration ?? result.repair?.partitionGeneration,",
    "    diagnosis: result.diagnosis ?? null,",
    "});",
    "",
    "globalThis.nbookStorageValueSmoke = {",
    "    // 每次打开都重新初始化访问上下文：后端重启、回收与释放之后必须显式重建。",
    "    open: (slot, name) => attempt(async () => {",
    "        const opened = await openStorageUserContext();",
    "        if (opened.status !== \"ready\") throw new Error(\"访问上下文不可用：\" + JSON.stringify(opened));",
    "        const handle = await openStorageOwnerHandle({session: opened.session, owner: definitions[name].owner});",
    "        state.handles[slot] = handle;",
    "        return {binding: handle.binding, credential: opened.session.clientCredential};",
    "    }),",
    "    read: (slot, name, resource) => attempt(async () => {",
    "        const result = await handleOf(slot).read(definitions[name], {resource});",
    "        if (result.credential !== undefined) state.credentials[recordKeyOf(name, resource)] = result.credential;",
    "        return readView(result);",
    "    }),",
    "    save: (slot, name, value, resource) => attempt(async () => {",
    "        const credential = await handleOf(slot).save(definitions[name], {expected: credentialOf(name, resource), value, resource});",
    "        state.credentials[recordKeyOf(name, resource)] = credential;",
    "        return credential;",
    "    }),",
    "    remove: (slot, name, expected, resource) => attempt(async () => {",
    "        const credential = await handleOf(slot).remove(definitions[name], {expected, resource});",
    "        state.credentials[recordKeyOf(name, resource)] = credential;",
    "        return credential;",
    "    }),",
    "    reclaim: (slot, name, targets) => attempt(async () => await handleOf(slot).reclaim(definitions[name], {targets})),",
    "    subscribe: (slot, name, resource) => attempt(async () => {",
    "        state.updates = [];",
    "        const subscription = await handleOf(slot).subscribe(definitions[name], {",
    "            resource,",
    "            onUpdate: (snapshot) => state.updates.push(readView(snapshot)),",
    "            onError: (error) => state.updates.push({kind: \"error\", diagnosis: error?.code ?? String(error)}),",
    "        });",
    "        state.subscription = subscription;",
    "        state.initial = readView(subscription.snapshot);",
    "        if (subscription.snapshot.credential !== undefined) state.credentials[recordKeyOf(name, resource)] = subscription.snapshot.credential;",
    "        return {count: 0, values: [], initial: state.initial};",
    "    }),",
    "    updates: () => ({count: state.updates.length, values: state.updates, initial: state.initial}),",
    "    release: (slot) => attempt(async () => {",
    "        const handle = handleOf(slot);",
    "        const subscription = state.subscription;",
    "        state.subscription = null;",
    "        if (subscription !== null) await subscription.close();",
    "        delete state.handles[slot];",
    "        await handle.release();",
    "        return true;",
    "    }),",
    "};",
    "",
].join("\n");

/** 与浏览器入口同名的服务端定义；容量与归属必须一致，实例身份不跨进程共享。 */
const serverDefinitions: readonly DefinedStorageState<unknown>[] = [
    defineStorageState({
        owner: "smoke.layout",
        key: "layout",
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: 1,
        defaultValue: {width: 320},
        validate: (value): value is {readonly width: number} => typeof value === "object" && value !== null
            && typeof (value as {readonly width?: unknown}).width === "number",
    }),
    defineStorageState({
        owner: "smoke.notes",
        key: "note",
        scope: "user",
        locality: "local",
        records: "identified",
        schemaVersion: 1,
        defaultValue: {text: ""},
        validate: (value): value is {readonly text: string} => typeof value === "object" && value !== null
            && typeof (value as {readonly text?: unknown}).text === "string",
    }),
    defineStorageState({
        owner: "smoke.shared",
        key: "board",
        scope: "user",
        locality: "shared",
        records: "single",
        schemaVersion: 1,
        defaultValue: {title: ""},
        validate: (value): value is {readonly title: string} => typeof value === "object" && value !== null
            && typeof (value as {readonly title?: unknown}).title === "string",
        limits: {maxValueBytes: 1024 * 1024},
    }),
];

export async function runStorageValueAdapterSmoke(
    input: StorageValueAdapterSmokeOptions,
): Promise<readonly SmokeFinding[]> {
    const stateRoot = join(input.root, "data");
    const applicationRoot = join(input.root, "app");
    const siteRoot = join(input.root, "site");
    await mkdir(applicationRoot, {recursive: true});
    await mkdir(siteRoot, {recursive: true});
    await writeBootConfig(stateRoot);
    // 产品路径必须指向隔离根：宿主按 State Root 解析身份域与 WorkspaceRoot。
    process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
    process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
    process.env.DATABASE_KIND = "sqlite";
    process.env.DATABASE_URL = "file:./storage-values.sqlite";
    const modules = await loadStorageModules();
    const storageRoot = modules.absoluteFsPath(join(stateRoot, "workspace", ".nbook", "storage"));
    await modules.setHostContextForTest({storageRoot, definitions: serverDefinitions});

    const findings: SmokeFinding[] = [];
    await writeSiteFiles(siteRoot);
    const host = await startIsolatedHost(siteRoot, modules);
    let browser: Browser | null = null;
    try {
        browser = await launchBrowser(input);
        await runBrowserScenarios({browser, host, storageRoot, findings, modules});
    } finally {
        const cleanup = await Promise.allSettled([browser?.close(), host.close(), modules.disposeHost()]);
        const failures = cleanup.filter((result) => result.status === "rejected");
        if (failures.length > 0) throw new AggregateError(failures.map((result) => result.reason), "Storage 值适配器 smoke 清理失败");
    }
    return findings;
}

/**
 * 生产模块只能在隔离根写进进程环境之后加载。
 *
 * 鉴权模块会解析数据库配置；先安装显式 State Root 与 SQLite 路径，确保首次请求也不读取默认 data。
 */
async function loadStorageModules(): Promise<StorageModules> {
    const host = await import("nbook/server/storage/host");
    const httpError = await import("nbook/server/storage/http-error");
    const storageActions = await import("nbook/server/storage/storage-actions");
    const accessContext = await import("nbook/server/storage/access-context");
    const filePath = await import("nbook/server/runtime/paths/file-path");
    const storageAddress = await import("nbook/server/storage/storage-address");
    return {
        issueUserContext: host.issueStorageUserContext,
        releaseUserContext: host.releaseStorageUserContext,
        performAction: host.performStorageUserAction,
        readAction: (event) => storageActions.readStorageActionRequest(event, STORAGE_ACTION_BODY_LIMIT_BYTES),
        setHostContextForTest: host.setStorageHostContextForTest,
        disposeHost: host.disposeStorageHost,
        withHttpError: httpError.withStorageHttpError,
        absoluteFsPath: filePath.absoluteFsPath,
        partitionPaths: storageAddress.storagePartitionPaths,
        deriveClientId: accessContext.deriveStorageClientId,
    };
}

async function runBrowserScenarios(input: {
    readonly browser: Browser;
    readonly host: IsolatedHost;
    readonly storageRoot: AbsoluteFsPath;
    readonly findings: SmokeFinding[];
    readonly modules: StorageModules;
}): Promise<void> {
    const {findings, host} = input;
    const shared = await input.browser.newContext();
    const isolated = await input.browser.newContext();
    try {
        const tabA = await shared.newPage();
        const tabB = await shared.newPage();
        const otherClient = await isolated.newPage();
        for (const page of [tabA, tabB, otherClient]) observePage(page, findings);
        for (const page of [tabA, tabB, otherClient]) await page.goto(host.origin, {waitUntil: "domcontentloaded", timeout: 30_000});
        for (const page of [tabA, tabB, otherClient]) await page.waitForFunction("typeof globalThis.nbookStorageValueSmoke === 'object'");

        const credential = await assertConditionalSaveAndCrossTabObservation({tabA, tabB, otherClient, findings});
        await assertSharedAndLargeValue({tabA, otherClient, findings});
        await assertSubscription({tabA, tabB, findings});
        await assertReleaseStopsObservation({tabB, host, findings});
        await assertReclaimInvalidatesHandle({tabA, credential, findings});
        await assertCorruptDiagnosis({tabA, storageRoot: input.storageRoot, credential, findings, modules: input.modules});
        await assertBackendRestartRestores({tabA, storageRoot: input.storageRoot, definitions: serverDefinitions, credential, findings, modules: input.modules});
    } finally {
        await shared.close();
        await isolated.close();
    }
}

/** 保存 → 另一个标签页观察到确认值；独立浏览器上下文仍按客户端隔离。 */
async function assertConditionalSaveAndCrossTabObservation(input: {
    readonly tabA: Page;
    readonly tabB: Page;
    readonly otherClient: Page;
    readonly findings: SmokeFinding[];
}): Promise<string> {
    const {findings} = input;
    const openedA = await expectOk(await call<PageOutcome<{readonly binding: {readonly local: number | null; readonly shared: number}; readonly credential: string}>>(input.tabA, "open", "main", "layout"), findings, "主标签页应能绑定 layout");
    if (openedA === null) return "";
    assert(openedA.binding.local === 1 && openedA.binding.shared === 1, findings, `首次绑定应捕获初始分区代次：${JSON.stringify(openedA.binding)}`);

    const missing = await expectOk(await call<PageOutcome<ReadView>>(input.tabA, "read", "main", "layout"), findings, "读取缺失状态应成功");
    assert(missing?.kind === "missing", findings, `缺失读取应是 missing：${JSON.stringify(missing)}`);
    assert(missing?.credentialGeneration === 1, findings, `缺失读取应带分区代次：${JSON.stringify(missing)}`);

    const saved = await expectOk(await call<PageOutcome<WriteView>>(input.tabA, "save", "main", "layout", {width: 640}), findings, "条件保存应成功");
    if (saved === null) return "";
    assert(saved.revision !== null && saved.partitionGeneration === 1, findings, `保存应返回新 revision 与代次：${JSON.stringify(saved)}`);

    const confirmed = await expectOk(await call<PageOutcome<ReadView>>(input.tabA, "read", "main", "layout"), findings, "保存后重读应成功");
    assert(JSON.stringify(confirmed?.value) === JSON.stringify({width: 640}), findings, `保存后应读到确认值：${JSON.stringify(confirmed)}`);

    const openedB = await expectOk(await call<PageOutcome<{readonly binding: {readonly local: number | null; readonly shared: number}; readonly credential: string}>>(input.tabB, "open", "second", "layout"), findings, "第二个标签页应能绑定 layout");
    assert(openedB?.credential === openedA.credential, findings, "同一浏览器存储上下文的两个标签页应共享定位凭证");
    assert(JSON.stringify(openedB?.binding) === JSON.stringify(openedA.binding), findings, `两个标签页应绑定同一分区代次：${JSON.stringify(openedB?.binding)}`);
    const observed = await expectOk(await call<PageOutcome<ReadView>>(input.tabB, "read", "second", "layout"), findings, "另一个句柄应能读到状态");
    assert(JSON.stringify(observed?.value) === JSON.stringify({width: 640}), findings, `另一个句柄应观察到确认值：${JSON.stringify(observed)}`);

    const openedOther = await expectOk(await call<PageOutcome<{readonly binding: {readonly local: number | null; readonly shared: number}; readonly credential: string}>>(input.otherClient, "open", "isolated", "layout"), findings, "独立浏览器上下文应能绑定 layout");
    assert(openedOther !== null && openedOther.credential !== openedA.credential, findings, "独立浏览器上下文应得到不同定位凭证");
    const isolatedRead = await expectOk(await call<PageOutcome<ReadView>>(input.otherClient, "read", "isolated", "layout"), findings, "独立上下文应能读取自己的 local 分区");
    assert(isolatedRead?.kind === "missing", findings, `独立浏览器的 local 状态必须隔离：${JSON.stringify(isolatedRead)}`);
    return openedA.credential;
}

/** shared 记录在相同主体下不按客户端隔离；近 1 MiB 的合法值不被传输层截断。 */
async function assertSharedAndLargeValue(input: {
    readonly tabA: Page;
    readonly otherClient: Page;
    readonly findings: SmokeFinding[];
}): Promise<void> {
    const {findings} = input;
    await expectOk(await call<PageOutcome<unknown>>(input.tabA, "open", "shared", "board"), findings, "主标签页应能绑定 board");
    await expectOk(await call<PageOutcome<WriteView>>(input.tabA, "save", "shared", "board", {title: "shared"}), findings, "shared 保存应成功");
    await expectOk(await call<PageOutcome<unknown>>(input.otherClient, "open", "isolatedShared", "board"), findings, "独立上下文应能绑定 board");
    const sharedRead = await expectOk(await call<PageOutcome<ReadView>>(input.otherClient, "read", "isolatedShared", "board"), findings, "独立上下文应能读取 shared 记录");
    assert(JSON.stringify(sharedRead?.value) === JSON.stringify({title: "shared"}), findings, `shared 记录应在相同主体间共享：${JSON.stringify(sharedRead)}`);

    const large = "x".repeat(LARGE_VALUE_BYTES);
    const saved = await expectOk(await call<PageOutcome<WriteView>>(input.tabA, "save", "shared", "board", {title: large}), findings, "近 1 MiB 的合法记录应能保存");
    assert(saved !== null, findings, "近 1 MiB 的合法记录应返回凭据");
    const read = await expectOk(await call<PageOutcome<ReadView>>(input.tabA, "read", "shared", "board"), findings, "近 1 MiB 的记录应能重读");
    const readTitle = (read?.value as {readonly title?: string} | undefined)?.title ?? "";
    assert(readTitle.length === LARGE_VALUE_BYTES, findings, `近 1 MiB 的记录必须完整往返：读到 ${String(readTitle.length)} 字节`);

    // 硬上限在浏览器接纳边界即可拒绝，不能把整个超限请求发送到服务端。
    const oversized = await call<PageOutcome<WriteView>>(input.tabA, "save", "shared", "board", {title: "y".repeat(1024 * 1024 + 4096)});
    assert(oversized.ok === false && oversized.code === "STORAGE_VALUE_TOO_LARGE", findings, `超过硬上限的值应在接纳边界拒绝：${JSON.stringify(oversized)}`);
    const restored = await expectOk(await call<PageOutcome<ReadView>>(input.tabA, "read", "shared", "board"), findings, "拒绝后应仍能读取原记录");
    const restoredTitle = (restored?.value as {readonly title?: string} | undefined)?.title ?? "";
    assert(restoredTitle === large, findings, "被拒绝的写入不得影响原记录");
}

/** 订阅先给初始快照，再按修订报告另一个句柄提交的变化。 */
async function assertSubscription(input: {
    readonly tabA: Page;
    readonly tabB: Page;
    readonly findings: SmokeFinding[];
}): Promise<void> {
    const {findings} = input;
    const subscribed = await expectOk(await call<PageOutcome<SubscriptionView>>(input.tabB, "subscribe", "second", "layout"), findings, "订阅应返回初始快照");
    assert(JSON.stringify((subscribed?.initial as ReadView | undefined)?.value) === JSON.stringify({width: 640}), findings, `初始快照应是当前确认值：${JSON.stringify(subscribed?.initial)}`);
    assert(subscribed?.count === 0, findings, "初始快照本身不应触发 onUpdate");

    await expectOk(await call<PageOutcome<WriteView>>(input.tabA, "save", "main", "layout", {width: 700}), findings, "另一个句柄的保存应成功");
    try {
        await input.tabB.waitForFunction("globalThis.nbookStorageValueSmoke.updates().count > 0", undefined, {timeout: 15_000});
    } catch (error) {
        findings.push({kind: "assertion", message: `订阅应在观察间隔内报告外部提交：${error instanceof Error ? error.message : String(error)}`});
        return;
    }
    const updates = await call<SubscriptionView>(input.tabB, "updates");
    const last = updates.values.at(-1) as ReadView | undefined;
    assert(JSON.stringify(last?.value) === JSON.stringify({width: 700}), findings, `订阅更新应是新的确认值：${JSON.stringify(last)}`);
    assert(updates.values.every((entry) => (entry as ReadView).kind !== "error"), findings, `订阅不应报告错误：${JSON.stringify(updates.values)}`);
}

/** 释放句柄后不再观察：既没有新的网络请求，也没有新的快照。 */
async function assertReleaseStopsObservation(input: {
    readonly tabB: Page;
    readonly host: IsolatedHost;
    readonly findings: SmokeFinding[];
}): Promise<void> {
    const {findings, host} = input;
    await expectOk(await call<PageOutcome<true>>(input.tabB, "release", "second"), findings, "释放句柄应成功");
    const callsAfterRelease = host.apiCalls.length;
    const updatesAfterRelease = (await call<SubscriptionView>(input.tabB, "updates")).count;
    // 覆盖至少一个完整观察间隔：释放后不得再产生定时器驱动的请求。
    await input.tabB.waitForTimeout(1_200);
    assert(host.apiCalls.length === callsAfterRelease, findings, `释放后不得再产生 Storage 请求：新增 ${String(host.apiCalls.length - callsAfterRelease)} 次`);
    assert((await call<SubscriptionView>(input.tabB, "updates")).count === updatesAfterRelease, findings, "释放后不得再投递快照");
}

/** 回收让旧句柄、旧凭据与尚未读过的键一起失效；显式重建后可恢复访问。 */
async function assertReclaimInvalidatesHandle(input: {
    readonly tabA: Page;
    readonly credential: string;
    readonly findings: SmokeFinding[];
}): Promise<void> {
    const {findings} = input;
    await expectOk(await call<PageOutcome<{readonly credential: string}>>(input.tabA, "open", "notes", "note"), findings, "notes 句柄应能绑定");
    const saved = await expectOk(await call<PageOutcome<WriteView>>(input.tabA, "save", "notes", "note", {text: "first"}, "first"), findings, "写入 note 应成功");
    if (saved === null) return;
    await expectOk(await call<PageOutcome<WriteView>>(input.tabA, "remove", "notes", "note", saved, "first"), findings, "删除应形成墓碑");
    const reclaimed = await expectOk(await call<PageOutcome<{readonly partitionGeneration: number; readonly outcomes: readonly {readonly outcome: string}[]}>>(
        input.tabA, "reclaim", "notes", "note", [{resource: "first"}, {resource: "second"}],
    ), findings, "回收应成功");
    assert(reclaimed?.partitionGeneration === 2, findings, `回收应提升分区代次：${JSON.stringify(reclaimed)}`);
    assert(reclaimed?.outcomes[0]?.outcome === "reclaimed", findings, `回收应删除选定墓碑：${JSON.stringify(reclaimed)}`);

    const stale = await call<PageOutcome<ReadView>>(input.tabA, "read", "notes", "note", "second");
    assert(stale.ok === false && stale.code === "STORAGE_CREDENTIAL_STALE", findings, `回收后尚未读过的键也必须失效：${JSON.stringify(stale)}`);
    const rebound = await expectOk(await call<PageOutcome<{readonly credential: string}>>(input.tabA, "open", "notesFresh", "note"), findings, "回收后应能显式重建句柄");
    assert(rebound?.credential === input.credential, findings, "重建应复用同一浏览器定位凭证");
    const current = await expectOk(await call<PageOutcome<ReadView>>(input.tabA, "read", "notesFresh", "note", "second"), findings, "重建后应能读取当前状态");
    assert(current?.kind === "missing" && current.credentialGeneration === 2, findings, `重建后应看到回收后的当前代次：${JSON.stringify(current)}`);
}

/** 损坏记录的公开诊断不暴露原始内容，原件仍保留。 */
async function assertCorruptDiagnosis(input: {
    readonly tabA: Page;
    readonly storageRoot: AbsoluteFsPath;
    readonly credential: string;
    readonly findings: SmokeFinding[];
    readonly modules: StorageModules;
}): Promise<void> {
    const {findings} = input;
    if (input.credential === "") return;
    const identityDomain = JSON.parse(await readFile(join(input.storageRoot, "identity.json"), "utf8")) as {readonly identityDomain: string};
    const partition = input.modules.partitionPaths({
        storageRoot: input.storageRoot,
        identityDomain: identityDomain.identityDomain,
        subject: `local:${identityDomain.identityDomain}`,
        locality: "local",
        clientId: input.modules.deriveClientId(input.credential),
        owner: "smoke.notes",
    });
    const marker = "private-diagnostic-marker";
    await writeFile(join(partition.recordsDirectory, "note~third.json"), marker, "utf8");

    const broken = await expectOk(await call<PageOutcome<ReadView>>(input.tabA, "read", "notesFresh", "note", "third"), findings, "损坏记录应返回分类结果");
    assert(broken?.kind === "corrupt", findings, `损坏记录应分类为 corrupt：${JSON.stringify(broken)}`);
    assert(!JSON.stringify(broken).includes(marker), findings, "公开诊断不得包含记录原始内容");
    assert(broken?.credentialGeneration === 2, findings, `损坏记录应带当前代次的修复凭据：${JSON.stringify(broken)}`);
    assert(await readFile(join(partition.recordsDirectory, "note~third.json"), "utf8") === marker, findings, "读取损坏记录不得改动原件");
}

/** 后端重启后旧句柄失效；显式重建的句柄仍能读到重启前保存的确认值。 */
async function assertBackendRestartRestores(input: {
    readonly tabA: Page;
    readonly storageRoot: AbsoluteFsPath;
    readonly definitions: readonly DefinedStorageState<unknown>[];
    readonly credential: string;
    readonly findings: SmokeFinding[];
    readonly modules: StorageModules;
}): Promise<void> {
    const {findings} = input;
    const before = await expectOk(await call<PageOutcome<ReadView>>(input.tabA, "read", "main", "layout"), findings, "重启前读取应成功");
    assert(JSON.stringify(before?.value) === JSON.stringify({width: 700}), findings, `重启前应是另一个句柄提交的值：${JSON.stringify(before)}`);

    // 同一隔离根上的新运行期等价于后端重启：旧访问失效，浏览器定位凭证与 data 保留。
    await input.modules.setHostContextForTest({storageRoot: input.storageRoot, definitions: [...input.definitions]});
    const stale = await call<PageOutcome<ReadView>>(input.tabA, "read", "main", "layout");
    assert(stale.ok === false && stale.code === "STORAGE_CONTEXT_INVALID", findings, `后端重启后旧句柄必须失效：${JSON.stringify(stale)}`);

    const restarted = await expectOk(await call<PageOutcome<{readonly binding: {readonly local: number | null; readonly shared: number}; readonly credential: string}>>(
        input.tabA, "open", "restarted", "layout",
    ), findings, "重启后应能显式重建句柄");
    assert(restarted?.credential === input.credential, findings, "重建应复用浏览器定位凭证并回到原 local 分区");
    const recovered = await expectOk(await call<PageOutcome<ReadView>>(input.tabA, "read", "restarted", "layout"), findings, "重建后应能读取确认值");
    assert(JSON.stringify(recovered?.value) === JSON.stringify({width: 700}), findings, `重启后应恢复确认值：${JSON.stringify(recovered)}`);
}

async function expectOk<TResult>(outcome: PageOutcome<TResult>, findings: SmokeFinding[], message: string): Promise<TResult | null> {
    if (!outcome.ok) {
        findings.push({kind: "assertion", message: `${message}：${JSON.stringify(outcome)}`});
        return null;
    }
    return outcome.value;
}

/** 挂载产品 Storage 入口的最小宿主：上下文与动作都是产品路由，静态站点只负责加载浏览器模块。 */
async function startIsolatedHost(siteRoot: string, modules: StorageModules): Promise<IsolatedHost> {
    const app = createApp();
    app.use(CONTEXT_PATH, defineEventHandler(async (event) => {
        if (event.method === "POST") return await modules.withHttpError(() => modules.issueUserContext(event));
        if (event.method === "DELETE") return await modules.withHttpError(() => modules.releaseUserContext(event));
        throw createError({statusCode: 405, message: "仅支持 POST 与 DELETE"});
    }));
    app.use(ACTION_PATH, defineEventHandler((event) => {
        if (event.method !== "POST") throw createError({statusCode: 405, message: "仅支持 POST"});
        return modules.withHttpError(async () => {
            const action = await modules.readAction(event);
            return await modules.performAction(event, action);
        });
    }));
    const listener = toNodeListener(app);
    const apiCalls: string[] = [];
    const siteFiles = new Map<string, {readonly contentType: string; readonly body: string}>();
    for (const file of SITE_FILES) {
        siteFiles.set(file.route, {contentType: file.contentType, body: await readFile(join(siteRoot, file.fileName), "utf8")});
    }
    const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (pathname.startsWith("/api/")) {
            apiCalls.push(`${request.method ?? "GET"} ${pathname}`);
            listener(request, response);
            return;
        }
        if (pathname === "/favicon.ico") {
            response.writeHead(204);
            response.end();
            return;
        }
        const file = siteFiles.get(pathname);
        if (file === undefined) {
            response.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
            response.end("not found");
            return;
        }
        response.writeHead(200, {"content-type": file.contentType, "cache-control": "no-store"});
        response.end(file.body);
    });
    const {promise, resolve: ready, reject: failed} = Promise.withResolvers<void>();
    server.once("error", failed);
    server.listen(0, "127.0.0.1", ready);
    await promise;
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Storage 值适配器 smoke 未取得 TCP 端口");
    }
    return {
        origin: `http://storage.test:${String(address.port)}/`,
        apiCalls,
        close: async () => {
            const closed = Promise.withResolvers<void>();
            server.close((error) => (error ? closed.reject(error) : closed.resolve()));
            await closed.promise;
        },
    };
}

async function writeSiteFiles(siteRoot: string): Promise<void> {
    await writeFile(join(siteRoot, "index.html"), PAGE_MARKUP, "utf8");
    const entryPath = join(siteRoot, "entry.js");
    await writeFile(entryPath, BROWSER_ENTRY_SOURCE, "utf8");
    await build({
        entryPoints: [entryPath],
        outfile: join(siteRoot, "storage-values.js"),
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        // 产品模块使用 `nbook/*` 根别名；隔离宿主复用同一约定，不复制源码。
        alias: {nbook: fileURLToPath(new URL("../..", import.meta.url))},
        nodePaths: [fileURLToPath(new URL("../../../../node_modules", import.meta.url))],
        logLevel: "silent",
    });
}

/** 隔离 State Root 使用显式 Boot Config 关闭鉴权，走与产品相同的 auth-off 本地主体路径。 */
async function writeBootConfig(stateRoot: string): Promise<void> {
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(stateRoot, "config.yaml"), "auth:\n  enabled: false\n", "utf8");
}

async function launchBrowser(input: StorageValueAdapterSmokeOptions): Promise<Browser> {
    if (process.platform === "win32" && typeof Bun !== "undefined") {
        throw new Error("Storage 值适配器 smoke 必须由 Node 运行；Windows Bun 无法可靠连接 Chromium 调试管道。");
    }
    return await chromium.launch({
        args: ["--host-resolver-rules=MAP storage.test 127.0.0.1", "--no-proxy-server"],
        executablePath: resolve(input.browserExecutable),
        headless: input.headless ?? true,
        timeout: 60_000,
    });
}

/**
 * 调用页面上的适配器 fixture API。
 *
 * 必须传表达式字符串：Node 侧函数经 tsx 转换后带有 `__name` 辅助引用，
 * Playwright 序列化函数源码时会在页面里抛出 `__name is not defined`。
 */
async function call<TResult>(page: Page, method: keyof SmokePageApi, ...args: readonly unknown[]): Promise<TResult> {
    const serialized = args.map((arg) => JSON.stringify(arg)).join(", ");
    return await page.evaluate(`globalThis.nbookStorageValueSmoke.${method}(${serialized})`) as TResult;
}

function observePage(page: Page, findings: SmokeFinding[]): void {
    page.on("console", (message: ConsoleMessage) => {
        // 网络状态由场景自己断言；这里的 "Failed to load resource" 也覆盖了刻意制造的非 2xx。
        if ((message.type() === "error" || message.type() === "warning")
            && !message.text().startsWith("Failed to load resource:")) {
            findings.push({kind: "console", message: `${message.type()}: ${message.text()}`});
        }
    });
    page.on("pageerror", (error: Error) => findings.push({kind: "page", message: error.stack ?? error.message}));
}

function assert(condition: boolean, findings: SmokeFinding[], message: string): void {
    if (!condition) findings.push({kind: "assertion", message});
}

function parseOptions(args: readonly string[]): StorageValueAdapterSmokeOptions {
    const values: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!key?.startsWith("--") || !value) throw new Error(`无效参数：${args.slice(index).join(" ")}`);
        values[key] = value;
    }
    const browserExecutable = values["--browser-executable"] ?? chromium.executablePath();
    return {
        root: resolveAgentScratchPath("storage-value-adapter", randomBytes(4).toString("hex")),
        browserExecutable,
        headless: values["--headed"] === undefined,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const options = parseOptions(process.argv.slice(2));
    let findings: readonly SmokeFinding[] = [];
    try {
        console.error(`Storage 值适配器 smoke 隔离根：${options.root}`);
        findings = await runStorageValueAdapterSmoke(options);
    } catch (error) {
        findings = [{kind: "page", message: error instanceof Error ? error.stack ?? error.message : String(error)}];
    } finally {
        await rm(options.root, {recursive: true, force: true});
    }
    console.log(JSON.stringify({
        schema: "nbook.storage-value-adapter-smoke/v1",
        status: findings.length === 0 ? "passed" : "failed",
        findings,
    }, null, 2));
    if (findings.length > 0) process.exitCode = 1;
}
