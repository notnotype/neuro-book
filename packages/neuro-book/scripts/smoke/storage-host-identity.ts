#!/usr/bin/env node
/**
 * Storage 宿主身份与 user 访问上下文的真实浏览器 Smoke。
 *
 * 在隔离 State Root 上启动只挂载 Storage 入口的最小宿主（h3 + Node HTTP），让真实 Chromium
 * 加载产品浏览器模块（`app/utils/storage`），验证浏览器侧不能靠单元测试证明的事实：
 * 同源首次双标签并发初始化收敛、独立存储上下文隔离、重开与清标识后的恢复、存储不可用时的
 * 不可恢复状态、同一客户端两个标签页的访问互不撤销，以及真实 HTTP 的签发、释放与撤销。
 *
 * 使用隔离 State Root 与独立浏览器上下文，不读取主应用登录态，也不碰机器默认 data。
 * 必须由 Node 运行（Windows 下 Bun 连接 Chromium 调试管道不稳定）。
 */

import {randomBytes} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createApp, createError, defineEventHandler, toNodeListener} from "h3";
import {build} from "esbuild";
import {chromium, type Browser, type ConsoleMessage, type Page} from "playwright-core";
import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
// 以下生产模块只按类型导入：它们必须在隔离根写进进程环境后再动态加载，理由见 loadStorageHostModules。
import type {absoluteFsPath, AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {
    issueStorageUserContext,
    releaseStorageUserContext,
    resolveStorageAccessContext,
    setStorageHostContextForTest,
    disposeStorageHost,
} from "nbook/server/storage/host";
import type {storageIdentityFilePath, userStorageRootFromWorkspaceRoot} from "nbook/server/storage/storage-address";
import type {withStorageHttpError} from "nbook/server/storage/http-error";
import type {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";

const CONTEXT_PATH = "/api/storage/user/context";
const RESOLVE_PATH = "/api/storage/test/resolve";
/** 首次并发初始化轮次：每轮都从“没有身份”开始，覆盖真实创建竞争。 */
const CONCURRENT_ROUNDS = 10;

export type StorageHostIdentitySmokeOptions = {
    /** 隔离临时根；State Root 为 `<root>/data`，浏览器站点文件为 `<root>/site`。 */
    readonly root: string;
    readonly browserExecutable: string;
    readonly headless?: boolean;
};

type SmokeFinding = {
    readonly kind: "assertion" | "console" | "page";
    readonly message: string;
};

type IdentityOutcome =
    | {readonly status: "ready"; readonly credential: string}
    | {readonly status: "unrecoverable"; readonly reason: string; readonly diagnosis: string};

type OpenOutcome =
    | {readonly status: "ready"; readonly session: {readonly contextId: string; readonly clientCredential: string}}
    | {readonly status: "unavailable"; readonly reason: string; readonly diagnosis: string};

type RawResponse = {readonly status: number; readonly body: {readonly released?: boolean; readonly data?: {readonly code?: string}}};

type SmokePageApi = {
    readonly loadIdentity: () => Promise<IdentityOutcome>;
    readonly loadIdentityAt: (startAt: number) => Promise<IdentityOutcome>;
    readonly clearIdentity: () => Promise<{readonly status: string}>;
    readonly openContext: () => Promise<OpenOutcome>;
    readonly request: (path: string, method: string, contextId: string, credential: string) => Promise<RawResponse>;
    readonly localStorageKeys: () => readonly string[];
};

type IsolatedHost = {
    readonly origin: string;
    readonly apiCalls: readonly {readonly method: string; readonly path: string}[];
    readonly close: () => Promise<void>;
};

/** 浏览器站点文件；入口把产品模块挂到页面上，并补上宿主运行时应提供的 `$fetch`。 */
const SITE_FILES: readonly {readonly route: string; readonly fileName: string; readonly contentType: string}[] = [
    {route: "/", fileName: "index.html", contentType: "text/html; charset=utf-8"},
    {route: "/storage-client.js", fileName: "storage-client.js", contentType: "text/javascript; charset=utf-8"},
];

const PAGE_MARKUP = [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head><meta charset=\"utf-8\"><title>storage host identity smoke</title></head>",
    "<body><script type=\"module\" src=\"/storage-client.js\"></script></body>",
    "</html>",
    "",
].join("\n");

const BROWSER_ENTRY_SOURCE = [
    "import {clearStorageClientIdentity, loadOrCreateStorageClientIdentity} from \"nbook/app/utils/storage/client-identity\";",
    "import {openStorageUserContext} from \"nbook/app/utils/storage/host-context-client\";",
    "import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from \"nbook/shared/storage/host\";",
    "",
    "// 宿主运行时（Nuxt）提供的 $fetch；产品 adapter 通过 apiFetch 消费它。",
    "globalThis.$fetch = async (path, options) => {",
    "    const response = await fetch(path, {method: options?.method ?? \"GET\", headers: options?.headers});",
    "    const text = await response.text();",
    "    const body = text.length > 0 ? JSON.parse(text) : null;",
    "    if (!response.ok) {",
    "        const error = new Error(body?.message ?? body?.data?.message ?? \"HTTP \" + response.status);",
    "        error.status = response.status;",
    "        error.statusCode = response.status;",
    "        error.data = body;",
    "        throw error;",
    "    }",
    "    return body;",
    "};",
    "",
    "const waitUntil = (startAt) => new Promise((resolve) => {",
    "    const delay = startAt - Date.now();",
    "    if (delay <= 0) { resolve(); return; }",
    "    setTimeout(resolve, delay);",
    "});",
    "",
    "globalThis.nbookStorageSmoke = {",
    "    loadIdentity: () => loadOrCreateStorageClientIdentity(),",
    "    loadIdentityAt: async (startAt) => { await waitUntil(startAt); return await loadOrCreateStorageClientIdentity(); },",
    "    clearIdentity: () => clearStorageClientIdentity(),",
    "    openContext: () => openStorageUserContext(),",
    "    request: async (path, method, contextId, credential) => {",
    "        const response = await fetch(path, {method, headers: {",
    "            [STORAGE_CLIENT_CREDENTIAL_HEADER]: credential,",
    "            [STORAGE_ACCESS_CONTEXT_HEADER]: contextId,",
    "        }});",
    "        return {status: response.status, body: await response.json()};",
    "    },",
    "    localStorageKeys: () => Object.keys(localStorage),",
    "};",
    "",
].join("\n");

export async function runStorageHostIdentitySmoke(
    input: StorageHostIdentitySmokeOptions,
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
    process.env.DATABASE_URL = "file:./storage-smoke.sqlite";
    const modules = await loadStorageHostModules();

    const storageRoot = modules.userStorageRootFromWorkspaceRoot(modules.resolveRuntimeWorkspaceRoot());
    await modules.setHostContextForTest({storageRoot});
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
        if (failures.length > 0) throw new AggregateError(failures.map((result) => result.reason), "Storage smoke 清理失败");
    }
    return findings;
}

/**
 * 生产模块只能在隔离根写进进程环境之后加载。
 *
 * 鉴权模块会解析数据库配置；先安装显式 State Root 和 SQLite 路径，确保首次请求也不读取默认 data。
 */
async function loadStorageHostModules(): Promise<StorageHostModules> {
    const host = await import("nbook/server/storage/host");
    const httpError = await import("nbook/server/storage/http-error");
    const filePath = await import("nbook/server/runtime/paths/file-path");
    const storageAddress = await import("nbook/server/storage/storage-address");
    const workspaceRuntimeRoot = await import("nbook/server/workspace-files/workspace-runtime-root");
    return {
        issueUserContext: host.issueStorageUserContext,
        releaseUserContext: host.releaseStorageUserContext,
        resolveAccessContext: host.resolveStorageAccessContext,
        setHostContextForTest: host.setStorageHostContextForTest,
        disposeHost: host.disposeStorageHost,
        withHttpError: httpError.withStorageHttpError,
        absoluteFsPath: filePath.absoluteFsPath,
        userStorageRootFromWorkspaceRoot: storageAddress.userStorageRootFromWorkspaceRoot,
        storageIdentityFilePath: storageAddress.storageIdentityFilePath,
        resolveRuntimeWorkspaceRoot: workspaceRuntimeRoot.resolveRuntimeWorkspaceRoot,
    };
}

/**
 * 隔离根生效后才能加载的宿主入口；字段就是各处实际消费的入口，避免把整个模块对象传下去。
 */
type StorageHostModules = {
    readonly issueUserContext: typeof issueStorageUserContext;
    readonly releaseUserContext: typeof releaseStorageUserContext;
    readonly resolveAccessContext: typeof resolveStorageAccessContext;
    readonly setHostContextForTest: typeof setStorageHostContextForTest;
    readonly disposeHost: typeof disposeStorageHost;
    readonly withHttpError: typeof withStorageHttpError;
    readonly absoluteFsPath: typeof absoluteFsPath;
    readonly userStorageRootFromWorkspaceRoot: typeof userStorageRootFromWorkspaceRoot;
    readonly storageIdentityFilePath: typeof storageIdentityFilePath;
    readonly resolveRuntimeWorkspaceRoot: typeof resolveRuntimeWorkspaceRoot;
};

async function runBrowserScenarios(input: {
    readonly browser: Browser;
    readonly host: IsolatedHost;
    readonly storageRoot: AbsoluteFsPath;
    readonly findings: SmokeFinding[];
    readonly modules: StorageHostModules;
}): Promise<void> {
    const {findings, host} = input;
    const first = await input.browser.newContext();
    const otherClient = await input.browser.newContext();
    const blocked = await input.browser.newContext();
    // 模拟宿主无法持久保存身份：IndexedDB 缺失时不得改用公共桶或悄悄降级。
    // init script 同样必须传字符串，理由见 callSmoke。
    await blocked.addInitScript({content: "Object.defineProperty(globalThis, \"indexedDB\", {configurable: true, get: () => undefined});"});
    try {
        const tabA = await first.newPage();
        const tabB = await first.newPage();
        const reopened = await first.newPage();
        const externalClient = await otherClient.newPage();
        const blockedTab = await blocked.newPage();
        const pages = [tabA, tabB, reopened, externalClient, blockedTab];
        for (const page of pages) observePage(page, findings);
        for (const page of pages) await page.goto(host.origin, {waitUntil: "domcontentloaded", timeout: 30_000});
        await tabA.waitForFunction("typeof globalThis.nbookStorageSmoke === 'object'");
        const httpCapabilities = await tabA.evaluate("({secure: isSecureContext, random: typeof crypto.getRandomValues === 'function', subtle: typeof crypto.subtle})") as {secure: boolean; random: boolean; subtle: string};
        assert(!httpCapabilities.secure && httpCapabilities.random && httpCapabilities.subtle === "undefined", findings, "应在普通 HTTP 非安全上下文中验证身份功能");

        await assertConcurrentFirstInit({tabA, tabB, reopened, findings});
        await tabA.evaluate("new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase('nbook.storage-client'); request.onsuccess = () => resolve(true); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('database deletion blocked')); })");
        assert((await callSmoke<IdentityOutcome>(tabA, "loadIdentity")).status === "ready", findings, "数据库删除后同页面应能重新初始化");
        await tabA.reload({waitUntil: "domcontentloaded"});
        await tabA.waitForFunction("typeof globalThis.nbookStorageSmoke === 'object'");
        const identity = await assertIndependentStorageContext({externalClient, tabA, findings});
        await assertUnrecoverableWithoutStorage({blockedTab, host, findings});
        const writeDenied = await input.browser.newContext();
        try {
            await writeDenied.addInitScript({content: "IDBObjectStore.prototype.put = function () { throw new DOMException('fixture denied', 'QuotaExceededError'); };"});
            const deniedPage = await writeDenied.newPage();
            observePage(deniedPage, findings);
            await deniedPage.goto(host.origin, {waitUntil: "domcontentloaded"});
            await deniedPage.waitForFunction("typeof globalThis.nbookStorageSmoke === 'object'");
            const denied = await callSmoke<IdentityOutcome>(deniedPage, "loadIdentity");
            assert(denied.status === "unrecoverable" && denied.reason === "write-failed", findings, "真实事务写入抛错必须中止并明确返回不可恢复");
        } finally {
            await writeDenied.close();
        }
        await assertIndependentTabLeases({tabA, tabB, findings});
        await assertContextHandshake({tabA, identity, storageRoot: input.storageRoot, host, findings, modules: input.modules});
    } finally {
        await first.close();
        await otherClient.close();
        await blocked.close();
    }
}

/**
 * 同一客户端的两个标签页各自持有独立访问：一个释放不撤销另一个。
 *
 * 双标签共享一份浏览器身份，但访问生命周期不合并；共享释放会让关闭一个标签页撤销另一个。
 */
async function assertIndependentTabLeases(input: {
    readonly tabA: Page;
    readonly tabB: Page;
    readonly findings: SmokeFinding[];
}): Promise<void> {
    const {findings} = input;
    const [left, right] = await Promise.all([
        callSmoke<OpenOutcome>(input.tabA, "openContext"),
        callSmoke<OpenOutcome>(input.tabB, "openContext"),
    ]);
    if (left.status !== "ready" || right.status !== "ready") {
        findings.push({kind: "assertion", message: `两个标签页都应签发出访问上下文：${JSON.stringify({left, right})}`});
        return;
    }
    assert(left.session.contextId !== right.session.contextId, findings, "两个标签页应各自获得不同的访问上下文");
    assert(
        left.session.clientCredential === right.session.clientCredential,
        findings,
        "两个标签页应共享同一份浏览器身份",
    );

    const released = await callSmoke<RawResponse>(
        input.tabA, "request", CONTEXT_PATH, "DELETE", left.session.contextId, left.session.clientCredential,
    );
    assert(released.status === 200 && released.body.released === true, findings, `标签页应能释放自己的访问：${JSON.stringify(released)}`);
    const survived = await callSmoke<RawResponse>(
        input.tabB, "request", RESOLVE_PATH, "GET", right.session.contextId, right.session.clientCredential,
    );
    assert(
        survived.status === 200,
        findings,
        `释放一个标签页的访问不得撤销另一个标签页：${JSON.stringify(survived)}`,
    );
}

/** 首次双标签并发初始化必须收敛到同一份凭证，且重开标签页读到的就是它。 */
async function assertConcurrentFirstInit(input: {
    readonly tabA: Page;
    readonly tabB: Page;
    readonly reopened: Page;
    readonly findings: SmokeFinding[];
}): Promise<IdentityOutcome | null> {
    const {findings} = input;
    const credentials: string[] = [];
    for (let round = 0; round < CONCURRENT_ROUNDS; round += 1) {
        await Promise.all([
            callSmoke(input.tabA, "clearIdentity"),
            callSmoke(input.tabB, "clearIdentity"),
        ]);
        const startAt = Date.now() + 200;
        const [left, right] = await Promise.all([
            callSmoke<IdentityOutcome>(input.tabA, "loadIdentityAt", startAt),
            callSmoke<IdentityOutcome>(input.tabB, "loadIdentityAt", startAt),
        ]);
        if (left.status !== "ready" || right.status !== "ready") {
            findings.push({
                kind: "assertion",
                message: `第 ${String(round + 1)} 轮双标签初始化都应得到可恢复身份：${JSON.stringify({left, right})}`,
            });
            return null;
        }
        assert(left.credential === right.credential, findings, `第 ${String(round + 1)} 轮两个标签页应收敛到同一凭证`);
        assert(/^[0-9a-f]{64}$/u.test(left.credential), findings, `第 ${String(round + 1)} 轮凭证应是 64 位十六进制不透明标识`);
        const stored = await callSmoke<IdentityOutcome>(input.reopened, "loadIdentity");
        assert(
            stored.status === "ready" && stored.credential === left.credential,
            findings,
            `第 ${String(round + 1)} 轮重开标签页应读到同一凭证：${JSON.stringify(stored)}`,
        );
        credentials.push(left.credential);
    }
    assert(new Set(credentials).size === credentials.length, findings, "每次清标识后的初始化都应得到新的身份");
    const last = credentials.at(-1) ?? null;
    if (last !== null) {
        await callSmoke(input.tabA, "clearIdentity");
        const recreated = await callSmoke<IdentityOutcome>(input.tabA, "loadIdentity");
        assert(
            recreated.status === "ready" && recreated.credential !== last,
            findings,
            `清除标识后的新初始化应获得新身份：${JSON.stringify(recreated)}`,
        );
    }
    return await callSmoke<IdentityOutcome>(input.tabA, "loadIdentity");
}

/** 另一个浏览器存储上下文必须得到自己的身份，并且多次读取保持稳定。 */
async function assertIndependentStorageContext(input: {
    readonly externalClient: Page;
    readonly tabA: Page;
    readonly findings: SmokeFinding[];
}): Promise<IdentityOutcome | null> {
    const {findings} = input;
    const [self, external] = await Promise.all([
        callSmoke<IdentityOutcome>(input.tabA, "loadIdentity"),
        callSmoke<IdentityOutcome>(input.externalClient, "loadIdentity"),
    ]);
    if (self.status !== "ready" || external.status !== "ready") {
        findings.push({kind: "assertion", message: `两个存储上下文都应得到身份：${JSON.stringify({self, external})}`});
        return null;
    }
    assert(external.credential !== self.credential, findings, "独立浏览器存储上下文应得到不同身份");
    const repeated = await callSmoke<IdentityOutcome>(input.externalClient, "loadIdentity");
    assert(
        repeated.status === "ready" && repeated.credential === external.credential,
        findings,
        "同一存储上下文重复读取应保持同一身份",
    );
    return self;
}

/** 存储不可用必须明确不可恢复：不写浏览器公共桶，也不请求后端。 */
async function assertUnrecoverableWithoutStorage(input: {
    readonly blockedTab: Page;
    readonly host: IsolatedHost;
    readonly findings: SmokeFinding[];
}): Promise<void> {
    const {findings, host} = input;
    const callsBefore = host.apiCalls.length;
    const outcome = await callSmoke<IdentityOutcome>(input.blockedTab, "loadIdentity");
    assert(
        outcome.status === "unrecoverable" && outcome.reason === "unavailable",
        findings,
        `IndexedDB 不可用时应返回不可恢复状态：${JSON.stringify(outcome)}`,
    );
    const keys = await callSmoke<readonly string[]>(input.blockedTab, "localStorageKeys");
    assert(keys.length === 0, findings, `身份不可恢复时不得写入浏览器公共桶：${JSON.stringify(keys)}`);
    assert(host.apiCalls.length === callsBefore, findings, "身份不可恢复时不得请求后端");
}

/** 真实 HTTP：签发、凭证变化后的撤销、释放幂等、宿主重启后的重签发与旧上下文失效。 */
async function assertContextHandshake(input: {
    readonly tabA: Page;
    readonly identity: IdentityOutcome | null;
    readonly storageRoot: AbsoluteFsPath;
    readonly host: IsolatedHost;
    readonly findings: SmokeFinding[];
    readonly modules: StorageHostModules;
}): Promise<void> {
    const {findings} = input;
    if (input.identity?.status !== "ready") return;
    const opened = await callSmoke<OpenOutcome>(input.tabA, "openContext");
    if (opened.status !== "ready") {
        findings.push({kind: "assertion", message: `浏览器身份就绪后应签发访问上下文：${JSON.stringify(opened)}`});
        return;
    }
    const createdIdentity = await readFile(input.modules.storageIdentityFilePath(input.storageRoot), "utf8").catch(() => null);
    assert(createdIdentity !== null, findings, "签发上下文应创建 data 身份域元数据");
    assert(
        opened.session.clientCredential === input.identity.credential,
        findings,
        "签发使用的应是浏览器保留的身份凭证",
    );

    const cleared = await callSmoke<{readonly status: string}>(input.tabA, "clearIdentity");
    assert(cleared.status === "cleared", findings, `清除标识应成功：${JSON.stringify(cleared)}`);
    const replacement = await callSmoke<IdentityOutcome>(input.tabA, "loadIdentity");
    if (replacement.status !== "ready") {
        findings.push({kind: "assertion", message: `清除标识后应重新获得身份：${JSON.stringify(replacement)}`});
        return;
    }
    const revoked = await callSmoke<RawResponse>(
        input.tabA, "request", CONTEXT_PATH, "DELETE", opened.session.contextId, replacement.credential,
    );
    assert(
        revoked.status === 403 && revoked.body.data?.code === "STORAGE_CONTEXT_INVALID",
        findings,
        `定位凭证变化后旧上下文不得继续使用：${JSON.stringify(revoked)}`,
    );

    const released = await callSmoke<RawResponse>(
        input.tabA, "request", CONTEXT_PATH, "DELETE", opened.session.contextId, opened.session.clientCredential,
    );
    assert(
        released.status === 200 && released.body.released === true,
        findings,
        `持有原凭证应能释放自己的上下文：${JSON.stringify(released)}`,
    );
    const repeated = await callSmoke<RawResponse>(
        input.tabA, "request", CONTEXT_PATH, "DELETE", opened.session.contextId, opened.session.clientCredential,
    );
    assert(repeated.status === 200 && repeated.body.released === false, findings, `重复释放应幂等成功：${JSON.stringify(repeated)}`);

    const second = await callSmoke<OpenOutcome>(input.tabA, "openContext");
    if (second.status !== "ready") {
        findings.push({kind: "assertion", message: `释放后应能重新签发上下文：${JSON.stringify(second)}`});
        return;
    }
    assert(second.session.contextId !== opened.session.contextId, findings, "释放后重新签发的上下文标识应不同");
    assert(
        second.session.clientCredential === replacement.credential,
        findings,
        "重新签发应复用浏览器保留的身份，而不是生成新身份",
    );

    // 同一隔离根上的新运行期等价于后端重启：旧上下文失效，浏览器身份保持。
    await input.modules.setHostContextForTest({storageRoot: input.storageRoot});
    const afterRestart = await callSmoke<RawResponse>(
        input.tabA, "request", RESOLVE_PATH, "GET", second.session.contextId, second.session.clientCredential,
    );
    assert(afterRestart.status === 403, findings, `宿主重启后旧上下文不得继续解析：${JSON.stringify(afterRestart)}`);
    const restarted = await callSmoke<OpenOutcome>(input.tabA, "openContext");
    assert(restarted.status === "ready", findings, `重启后应能重新初始化：${JSON.stringify(restarted)}`);
    if (restarted.status !== "ready") return;
    assert(
        restarted.session.clientCredential === replacement.credential,
        findings,
        "重启后浏览器身份应原样恢复并重新定位原 local 分区",
    );
    assert(restarted.session.contextId !== second.session.contextId, findings, "重启后应签发新的上下文标识");
    const resolved = await callSmoke<RawResponse>(
        input.tabA, "request", RESOLVE_PATH, "GET", restarted.session.contextId, restarted.session.clientCredential,
    );
    assert(resolved.status === 200, findings, `重启后新上下文应能通过核验：${JSON.stringify(resolved)}`);
}

/** 挂载产品 Storage 入口的最小宿主；resolve 路由代表后续状态读写必须走的核验边界。 */
async function startIsolatedHost(siteRoot: string, modules: StorageHostModules): Promise<IsolatedHost> {
    const app = createApp();
    app.use(CONTEXT_PATH, defineEventHandler(async (event) => {
        if (event.method === "POST") return await modules.withHttpError(() => modules.issueUserContext(event));
        if (event.method === "DELETE") return await modules.withHttpError(() => modules.releaseUserContext(event));
        throw createError({statusCode: 405, message: "仅支持 POST 与 DELETE"});
    }));
    app.use(RESOLVE_PATH, defineEventHandler((event) => modules.withHttpError(async () => {
        const context = await modules.resolveAccessContext(event);
        return {contextId: context.contextId};
    })));
    const listener = toNodeListener(app);
    const apiCalls: {method: string; path: string}[] = [];
    const siteFiles = new Map<string, {readonly contentType: string; readonly body: string}>();
    for (const file of SITE_FILES) {
        siteFiles.set(file.route, {contentType: file.contentType, body: await readFile(join(siteRoot, file.fileName), "utf8")});
    }
    const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (pathname.startsWith("/api/")) {
            apiCalls.push({method: request.method ?? "GET", path: pathname});
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
        throw new Error("隔离宿主没有取得 TCP 端口");
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
        outfile: join(siteRoot, "storage-client.js"),
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        // 产品模块使用 `nbook/*` 根别名；隔离宿主复用同一约定，不复制源码。
        alias: {nbook: fileURLToPath(new URL("../..", import.meta.url))},
        logLevel: "silent",
    });
}

/** 隔离 State Root 使用显式 Boot Config 关闭鉴权，走与产品相同的 auth-off 本地主体路径。 */
async function writeBootConfig(stateRoot: string): Promise<void> {
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(stateRoot, "config.yaml"), "auth:\n  enabled: false\n", "utf8");
}

async function launchBrowser(input: StorageHostIdentitySmokeOptions): Promise<Browser> {
    if (process.platform === "win32" && typeof Bun !== "undefined") {
        throw new Error("Storage 宿主身份 smoke 必须由 Node 运行；Windows Bun 无法可靠连接 Chromium 调试管道。");
    }
    return await chromium.launch({
        args: ["--host-resolver-rules=MAP storage.test 127.0.0.1", "--no-proxy-server"],
        executablePath: resolve(input.browserExecutable),
        headless: input.headless ?? true,
        timeout: 60_000,
    });
}

/**
 * 调用页面上的宿主 fixture API。
 *
 * 必须传表达式字符串：Node 侧函数经 tsx 转换后带有 `__name` 辅助引用，
 * Playwright 序列化函数源码时会在页面里抛出 `__name is not defined`。
 */
async function callSmoke<TResult>(page: Page, method: keyof SmokePageApi, ...args: readonly unknown[]): Promise<TResult> {
    const serialized = args.map((arg) => JSON.stringify(arg)).join(", ");
    return await page.evaluate(`globalThis.nbookStorageSmoke.${method}(${serialized})`) as TResult;
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

function parseOptions(args: readonly string[]): StorageHostIdentitySmokeOptions {
    const values: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!key?.startsWith("--") || !value) throw new Error(`无效参数：${args.slice(index).join(" ")}`);
        values[key] = value;
    }
    const browserExecutable = values["--browser-executable"] ?? chromium.executablePath();
    return {
        root: resolveAgentScratchPath("storage-host-identity", randomBytes(4).toString("hex")),
        browserExecutable,
        headless: values["--headed"] === undefined,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const options = parseOptions(process.argv.slice(2));
    let findings: readonly SmokeFinding[] = [];
    try {
        console.error(`Storage 宿主身份 smoke 隔离根：${options.root}`);
        findings = await runStorageHostIdentitySmoke(options);
    } catch (error) {
        findings = [{kind: "page", message: error instanceof Error ? error.stack ?? error.message : String(error)}];
    } finally {
        await rm(options.root, {recursive: true, force: true});
    }
    console.log(JSON.stringify({
        schema: "nbook.storage-host-identity-smoke/v1",
        status: findings.length === 0 ? "passed" : "failed",
        findings,
    }, null, 2));
    if (findings.length > 0) process.exitCode = 1;
}
