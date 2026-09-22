#!/usr/bin/env node
/**
 * Project Storage 浏览器 → HTTP → 磁盘真实 Smoke。
 *
 * 在隔离 State Root、隔离 Workspace Root 与两个本次专属 Chromium profile 上，让真实浏览器加载产品适配器
 * （`app/utils/storage`）打最小 HTTP 宿主，验证单元测试无法证明的事实：只有精确 ready 才签发 Project 访问、
 * 同客户端的两个标签共享分区而不同 Project 互相隔离、Project 的 shared 定义跨客户端共享而 local 不共享、
 * 订阅观察到外部提交、陈旧条件写入明确冲突、释放一个标签不撤销另一个、关闭 Project 后旧 session 与旧 ready
 * 都拒绝新写、同路径重开新 ready 能读回已提交值，以及记录确实落在对应 Project 的 `.nbook/storage` 里。
 *
 * 该脚本不是 Nuxt/Project UI 验收：它只挂载 Project Storage 的 H3 路由与产品浏览器模块。
 * 必须由 Node 运行（Windows 下 Bun 连接 Chromium 调试管道不稳定）。
 */

import {randomBytes} from "node:crypto";
import {mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {basename, dirname, isAbsolute, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {build} from "esbuild";
import {createApp, createError, defineEventHandler, toNodeListener, type H3Event} from "h3";
import {chromium, type BrowserContext, type ConsoleMessage, type Page} from "playwright-core";
import {assertContained, resolveAgentAcceptanceRoot, resolveAgentScratchPath, resolveAgentTempRoot} from "@notnotype/neuro-book-test-support/paths";
import {STORAGE_ACTION_BODY_LIMIT_BYTES, type StorageActionRequest} from "nbook/shared/storage/action";
import {STORAGE_WRAPPER_VERSION} from "nbook/shared/storage/contract";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
// 以下生产模块只按类型导入：它们必须在隔离根写进进程环境后再动态加载，理由见 loadStorageModules。
import type {absoluteFsPath, AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ProjectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import type {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session";
import type {
    disposeStorageHost,
    issueStorageProjectContext,
    performStorageProjectAction,
    releaseStorageProjectContext,
    setStorageHostContextForTest,
} from "nbook/server/storage/host";
import type {readStorageActionRequest, readStorageProjectContextRequest} from "nbook/server/storage/storage-actions";
import type {withStorageHttpError} from "nbook/server/storage/http-error";
import type {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import type {deriveStorageClientId, localStorageSubject} from "nbook/server/storage/access-context";
import type {readStorageIdentityDomain} from "nbook/server/storage/identity-domain";
import type {parseStorageRecord} from "nbook/server/storage/record-codec";
import type {
    projectStorageRootFromProjectRoot,
    storagePartitionPaths,
    storageRecordFileName,
    userStorageRootFromWorkspaceRoot,
} from "nbook/server/storage/storage-address";

const CONTEXT_PATH = "/api/storage/project/context";
const ACTION_PATH = "/api/storage/project/action";

/** 本次运行的 scratch 目录名与服务名；随机叶子限定位十六进制，绝不匹配任何历史临时根。 */
const SCRATCH_DIRECTORY = "nb-t43";
const SCRATCH_LEAF_PATTERN = /^[0-9a-f]{8}$/u;
/** 历史临时根：只作为拒删名单保留，本脚本从不创建也从不删除它。 */
const FORBIDDEN_DIRECTORIES: readonly string[] = ["storage-browser-MxfyHy"];

const PROJECT_OWNER = "smoke.project-layout";
const LAYOUT_KEY = "layout";
const BOARD_KEY = "board";

/** 两个 Project 的 Workspace Root 单段 locator；请求只能按它定位 ready，不能提交磁盘路径。 */
const PROJECT_A_SEGMENT = "alpha";
const PROJECT_B_SEGMENT = "beta";

/** 服务端注册的定义；owner/key/scope/locality/records/schemaVersion 必须与浏览器入口一致。 */
const serverDefinitions: readonly DefinedStorageState<unknown>[] = [
    defineStorageState({
        owner: PROJECT_OWNER,
        key: LAYOUT_KEY,
        scope: "project",
        locality: "local",
        records: "single",
        schemaVersion: 1,
        defaultValue: {width: 320},
        validate: (value): value is {readonly width: number} => storageWidthOf(value) !== null,
    }),
    defineStorageState({
        owner: PROJECT_OWNER,
        key: BOARD_KEY,
        scope: "project",
        locality: "shared",
        records: "single",
        schemaVersion: 1,
        defaultValue: {title: ""},
        validate: (value): value is {readonly title: string} => storageTitleOf(value) !== null,
    }),
];

export type StorageProjectAdapterSmokeOptions = {
    /** 隔离临时根；State Root、Workspace Root、site、两个 Chromium profile 都在它下面。 */
    readonly root: string;
    readonly browserExecutable: string;
    readonly headless?: boolean;
};

type SmokeFinding = {
    readonly kind: "assertion" | "console" | "page";
    readonly message: string;
};

/** 单项释放结果；失败项使整体 status 为 failed，但不跳过其余释放项。 */
type CleanupOutcome = {
    readonly resource: string;
    readonly ok: boolean;
    readonly message: string | null;
};

type IsolatedRun = {
    readonly root: string;
    readonly scratchRoot: string;
    readonly httpOrigin: string | null;
    readonly profileDirectories: readonly string[];
    readonly profileArtifacts: readonly ProfileArtifact[];
    readonly dataStorageRoot: string | null;
    readonly projectStorageRoots: readonly {readonly projectRoot: string; readonly storageRoot: string}[];
};

/** Chromium 在自己 profile 目录里留下的可见证据；用它证明 profile 与 cache 真的在隔离根内。 */
type ProfileArtifact = {
    readonly label: string;
    readonly directory: string;
    readonly localState: boolean;
    readonly indexedDbEntries: readonly string[];
};

/** 一条已核对记录的精确证据：地址来自生产入口，字段来自解析结果。 */
type StorageRecordEvidence = {
    readonly label: string;
    readonly path: string;
    readonly wrapper: number | null;
    readonly state: string | null;
    readonly schemaVersion: number | null;
    readonly value: unknown;
};

export type StorageProjectAdapterSmokeResult = {
    readonly findings: readonly SmokeFinding[];
    readonly cleanup: readonly CleanupOutcome[];
    readonly isolated: IsolatedRun;
    readonly records: readonly StorageRecordEvidence[];
};

/** 页面把适配器结果与失败投影成可序列化结果，避免把领域对象跨进程边界传。 */
type PageOutcome<TResult> =
    | {readonly ok: true; readonly value: TResult}
    | {
        readonly ok: false;
        readonly code: string | null;
        readonly status: number | null;
        readonly reason: string | null;
        readonly committed: boolean | null;
        readonly message: string;
    };

type StorageView = {
    readonly kind: string;
    readonly value?: unknown;
    readonly schemaVersion?: number;
    readonly credential?: {readonly revision: string | null; readonly partitionGeneration: number};
    readonly repair?: {readonly partitionGeneration: number; readonly contentFingerprint: string};
    readonly diagnosis?: string | null;
};

type WriteView = {readonly revision: string; readonly partitionGeneration: number};

type OpenView = {
    readonly credential: string;
    readonly contextId: string;
    readonly replaced: boolean;
    readonly binding: {readonly local: number | null; readonly shared: number};
};

type SlotView = {
    readonly hasSession: boolean;
    readonly hasHandle: boolean;
    readonly hasSubscription: boolean;
    /** 当前访问上下文标识；没有 session 时为 null。 */
    readonly contextId: string | null;
    readonly updates: number;
};

type SmokePageApi = {
    readonly open: (slot: string, name: string, projectRoot: string, publicId: string) => Promise<PageOutcome<OpenView>>;
    readonly read: (slot: string, name: string) => Promise<PageOutcome<StorageView>>;
    readonly save: (slot: string, name: string, value: unknown) => Promise<PageOutcome<WriteView>>;
    readonly subscribe: (slot: string, name: string) => Promise<PageOutcome<StorageView>>;
    readonly updates: (slot: string) => {readonly count: number; readonly last: StorageView | null};
    readonly release: (slot: string) => Promise<PageOutcome<true>>;
    readonly state: (slot: string) => SlotView;
};

type IsolatedHost = {
    readonly origin: string;
    readonly apiCalls: readonly string[];
    readonly close: () => Promise<void>;
};

/** 一个本次专属的 Chromium profile；上下文与页面都在释放范围内。 */
type ProfileRuntime = {
    readonly label: string;
    readonly profileDirectory: string;
    readonly context: BrowserContext;
    readonly pages: Page[];
};

type StorageModules = {
    readonly issueProjectContext: typeof issueStorageProjectContext;
    readonly releaseProjectContext: typeof releaseStorageProjectContext;
    readonly performAction: typeof performStorageProjectAction;
    readonly readAction: (event: H3Event) => Promise<StorageActionRequest>;
    readonly readProjectContextRequest: typeof readStorageProjectContextRequest;
    readonly setHostContextForTest: typeof setStorageHostContextForTest;
    readonly disposeHost: typeof disposeStorageHost;
    readonly withHttpError: typeof withStorageHttpError;
    readonly withProjectHttpError: typeof withProjectHttpError;
    readonly absoluteFsPath: typeof absoluteFsPath;
    readonly userStorageRootFromWorkspaceRoot: typeof userStorageRootFromWorkspaceRoot;
    readonly projectStorageRootFromProjectRoot: typeof projectStorageRootFromProjectRoot;
    readonly partitionPaths: typeof storagePartitionPaths;
    readonly recordFileName: typeof storageRecordFileName;
    readonly parseRecord: typeof parseStorageRecord;
    readonly readIdentityDomain: typeof readStorageIdentityDomain;
    readonly localStorageSubject: typeof localStorageSubject;
    readonly deriveClientId: typeof deriveStorageClientId;
};

/** 被测的两个 Project；`ready` 只是最近一次 open 的结果，重开后由 Project owner 更新。 */
type ProjectUnderTest = {
    readonly segment: string;
    readonly ref: ProjectWorkspaceRef;
    readonly root: AbsoluteFsPath;
    readonly storageRoot: AbsoluteFsPath;
    ready: ReadyProjectSessionRef;
};

type ProjectCommands = {
    readonly projectA: ProjectUnderTest;
    readonly projectB: ProjectUnderTest;
    closeA(): Promise<void>;
    reopenA(): Promise<ReadyProjectSessionRef>;
};

type ProjectSessionModule = {
    readonly closeAllProjects: () => Promise<void>;
    readonly closeProject: (ref: ProjectWorkspaceRef, reason: "shutdown") => Promise<void>;
    readonly openProject: (ref: ProjectWorkspaceRef, opener: {readonly kind: "user"}, workspaceRoot: AbsoluteFsPath) => Promise<ReadyProjectSessionRef>;
    readonly projectWorkspaceRef: (projectRoot: string) => ProjectWorkspaceRef;
    readonly writeProjectManifest: typeof writeProjectManifest;
};

/** 浏览器侧观察到的客户端凭据；磁盘断言用它经生产入口导出 clientId。 */
type BrowserEvidence = {
    readonly mainClientCredential: string;
    readonly otherClientCredential: string;
};

type ScenarioContext = {
    readonly tabA: Page;
    readonly tabB: Page;
    readonly otherClient: Page;
    readonly host: IsolatedHost;
    readonly projects: ProjectCommands;
    readonly findings: SmokeFinding[];
};

const SITE_FILES: readonly {readonly route: string; readonly fileName: string; readonly contentType: string}[] = [
    {route: "/", fileName: "index.html", contentType: "text/html; charset=utf-8"},
    {route: "/project.js", fileName: "project.js", contentType: "text/javascript; charset=utf-8"},
];

const PAGE_MARKUP = [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head><meta charset=\"utf-8\"><title>storage project adapter smoke</title></head>",
    "<body><script type=\"module\" src=\"/project.js\"></script></body>",
    "</html>",
    "",
].join("\n");

/**
 * 浏览器入口：把产品 Project 适配器挂到页面上，并补上宿主运行时应提供的 `$fetch`。
 *
 * 页面只调用产品模块；槽（slot）保存一个标签页已经取得的资源，释放顺序固定为订阅 → 句柄 → 访问上下文。
 */
const BROWSER_ENTRY_SOURCE = `
import {$fetch} from "ofetch";
import {closeStorageContext, openStorageProjectContext} from "nbook/app/utils/storage/host-context-client";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import {defineStorageState} from "nbook/shared/storage/definition";

// 宿主运行时（Nuxt）提供的 $fetch；产品适配器通过 apiFetch 消费它。
globalThis.$fetch = $fetch;

// 与服务端注册的同名定义各自成实例：跨进程只需要相同的 owner/key/归属/容量。
const definitions = {
    layout: defineStorageState({
        owner: "smoke.project-layout", key: "layout", scope: "project", locality: "local", records: "single", schemaVersion: 1,
        defaultValue: {width: 320},
        validate: (value) => typeof value === "object" && value !== null && typeof value.width === "number",
    }),
    board: defineStorageState({
        owner: "smoke.project-layout", key: "board", scope: "project", locality: "shared", records: "single", schemaVersion: 1,
        defaultValue: {title: ""},
        validate: (value) => typeof value === "object" && value !== null && typeof value.title === "string",
    }),
};

const slots = {};

const readView = (result) => ({
    kind: result.kind,
    value: result.value,
    schemaVersion: result.schemaVersion,
    credential: result.credential,
    repair: result.repair,
    diagnosis: result.diagnosis ?? null,
});

const attempt = async (run) => {
    try {
        return {ok: true, value: await run()};
    } catch (error) {
        return {
            ok: false,
            code: error?.code ?? null,
            status: error?.status ?? null,
            reason: error?.reason ?? null,
            committed: error?.committed === undefined ? null : error.committed,
            message: error?.message ?? String(error),
        };
    }
};

const slotOf = (slot) => {
    const entry = slots[slot];
    if (entry === undefined) throw new Error("尚未创建的句柄槽：" + slot);
    return entry;
};

// 未打开的槽必须直接失败：不能让人误以为共享了别人的句柄。
const activeSlot = (slot) => {
    const entry = slotOf(slot);
    if (entry.handle === null) throw new Error("槽没有活动句柄，必须先成功 open：" + slot);
    return entry;
};

// 条件写入使用本条记录最近一次已确认的凭据；适配器不做通用合并，冲突必须由 owner 处理。
const credentialOf = (entry, name) => entry.credentials[name] ?? {revision: null, partitionGeneration: 1};

/** 释放槽内已经取得的资源；顺序固定，单项失败不跳过其余项。 */
const closeSlotResources = async (entry) => {
    const failures = [];
    if (entry.subscription !== null) {
        const subscription = entry.subscription;
        entry.subscription = null;
        try {
            await subscription.close();
        } catch (error) {
            failures.push(error);
        }
    }
    if (entry.handle !== null) {
        const handle = entry.handle;
        entry.handle = null;
        try {
            await handle.release();
        } catch (error) {
            failures.push(error);
        }
    }
    if (entry.session !== null) {
        const session = entry.session;
        entry.session = null;
        try {
            await closeStorageContext(session);
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) {
        throw new Error("槽资源释放失败：" + failures.map((error) => error?.message ?? String(error)).join("; "));
    }
};

globalThis.nbookStorageProjectSmoke = {
    /**
     * 先签发新访问上下文，成功后才释放旧槽：失败的 open 不丢已有访问，成功的覆盖必须报告并释放旧句柄与旧上下文。
     */
    open: (slot, name, projectRoot, publicId) => attempt(async () => {
        const existing = slots[slot];
        const opened = await openStorageProjectContext({projectRoot, publicId});
        if (opened.status !== "ready") {
            const error = new Error(opened.diagnosis);
            error.code = opened.code;
            error.status = opened.statusCode;
            error.reason = opened.reason;
            throw error;
        }
        const session = opened.session;
        let handle;
        try {
            handle = await openStorageOwnerHandle({session, owner: definitions[name].owner});
        } catch (error) {
            // 句柄建立失败不能留下已签发的访问上下文。
            await closeStorageContext(session).catch(() => undefined);
            throw error;
        }
        const replaced = existing !== undefined && (existing.session !== null || existing.handle !== null);
        slots[slot] = {handle, session, subscription: null, credentials: {}, updates: [], released: false};
        if (existing !== undefined) await closeSlotResources(existing);
        return {credential: session.clientCredential, contextId: session.contextId, binding: handle.binding, replaced};
    }),
    read: (slot, name) => attempt(async () => {
        const entry = activeSlot(slot);
        const result = await entry.handle.read(definitions[name]);
        if (result.credential !== undefined) entry.credentials[name] = result.credential;
        return readView(result);
    }),
    save: (slot, name, value) => attempt(async () => {
        const entry = activeSlot(slot);
        const credential = await entry.handle.save(definitions[name], {expected: credentialOf(entry, name), value});
        entry.credentials[name] = credential;
        return credential;
    }),
    subscribe: (slot, name) => attempt(async () => {
        const entry = activeSlot(slot);
        entry.updates = [];
        const subscription = await entry.handle.subscribe(definitions[name], {
            onUpdate: (snapshot) => entry.updates.push(readView(snapshot)),
            onError: (error) => entry.updates.push({kind: "error", diagnosis: error?.code ?? String(error)}),
        });
        entry.subscription = subscription;
        if (subscription.snapshot.credential !== undefined) entry.credentials[name] = subscription.snapshot.credential;
        return readView(subscription.snapshot);
    }),
    updates: (slot) => {
        const entry = slotOf(slot);
        return {count: entry.updates.length, last: entry.updates.length === 0 ? null : entry.updates[entry.updates.length - 1]};
    },
    release: (slot) => attempt(async () => {
        const entry = slotOf(slot);
        await closeSlotResources(entry);
        entry.released = true;
        return true;
    }),
    state: (slot) => {
        const entry = slots[slot];
        return {
            hasSession: entry !== undefined && entry.session !== null,
            hasHandle: entry !== undefined && entry.handle !== null,
            hasSubscription: entry !== undefined && entry.subscription !== null,
            contextId: entry === undefined || entry.session === null ? null : entry.session.contextId,
            updates: entry === undefined ? 0 : entry.updates.length,
        };
    },
};
`;

/**
 * 运行一次完整 Smoke。
 *
 * 全部资源（目录、进程环境、Project manifest 与 session、Storage 宿主、esbuild 产物、HTTP listener、profile、页面）
 * 从取得的第一刻起就在释放范围内：`finally` 按 页面 → profile → HTTP → Project session → Storage 宿主 → 进程环境
 * 的固定顺序逐项释放，单项失败不跳过其余项，也不把释放责任留给调用方。
 */
export async function runStorageProjectAdapterSmoke(
    input: StorageProjectAdapterSmokeOptions,
): Promise<StorageProjectAdapterSmokeResult> {
    const findings: SmokeFinding[] = [];
    const cleanup: CleanupOutcome[] = [];
    const profiles: ProfileRuntime[] = [];
    const records: StorageRecordEvidence[] = [];
    const isolated: {
        root: string;
        scratchRoot: string;
        httpOrigin: string | null;
        profileDirectories: string[];
        profileArtifacts: ProfileArtifact[];
        dataStorageRoot: string | null;
        projectStorageRoots: {projectRoot: string; storageRoot: string}[];
    } = {
        root: input.root,
        scratchRoot: resolveAgentTempRoot(),
        httpOrigin: null,
        profileDirectories: [],
        profileArtifacts: [],
        dataStorageRoot: null,
        projectStorageRoots: [],
    };
    const paths = {
        stateRoot: join(input.root, "state"),
        applicationRoot: join(input.root, "application"),
        siteRoot: join(input.root, "site"),
        workspaceRoot: join(input.root, "state", "workspace"),
        profileMain: join(input.root, "profiles", "main"),
        profileOther: join(input.root, "profiles", "other"),
    };
    let environment: {restore: () => void} | null = null;
    let host: IsolatedHost | null = null;
    let projectSession: ProjectSessionModule | null = null;
    let modules: StorageModules | null = null;
    const dispose = async (resource: string, disposeResource: () => Promise<unknown> | undefined): Promise<void> => {
        try {
            await disposeResource();
            cleanup.push({resource, ok: true, message: null});
        } catch (error) {
            cleanup.push({resource, ok: false, message: describe(error)});
        }
    };

    try {
        environment = installIsolatedEnvironment(paths);
        await mkdir(paths.applicationRoot, {recursive: true});
        await mkdir(paths.siteRoot, {recursive: true});
        await mkdir(paths.workspaceRoot, {recursive: true});
        await writeFile(join(paths.stateRoot, "config.yaml"), "auth:\n  enabled: false\n", "utf8");

        modules = await loadStorageModules();
        const workspaceRoot = modules.absoluteFsPath(paths.workspaceRoot);
        projectSession = await importProjectSession();
        const projects = await openProjectsUnderTest(projectSession, modules, workspaceRoot);
        for (const project of [projects.projectA, projects.projectB]) {
            isolated.projectStorageRoots.push({projectRoot: project.root, storageRoot: project.storageRoot});
        }
        const dataStorageRoot = modules.userStorageRootFromWorkspaceRoot(workspaceRoot);
        isolated.dataStorageRoot = dataStorageRoot;
        await modules.setHostContextForTest({storageRoot: dataStorageRoot, definitions: serverDefinitions});

        await writeSiteFiles(paths.siteRoot);
        host = await startIsolatedHost(paths.siteRoot, modules);
        isolated.httpOrigin = host.origin;
        console.error(`Project Storage smoke HTTP：${host.origin}`);

        profiles.push(await launchProfileRuntime({
            label: "main",
            profileDirectory: paths.profileMain,
            browserExecutable: input.browserExecutable,
            headless: input.headless ?? true,
        }));
        profiles.push(await launchProfileRuntime({
            label: "other",
            profileDirectory: paths.profileOther,
            browserExecutable: input.browserExecutable,
            headless: input.headless ?? true,
        }));
        isolated.profileDirectories.push(...profiles.map((profile) => profile.profileDirectory));
        for (const profile of profiles) console.error(`Project Storage smoke profile(${profile.label})：${profile.profileDirectory}`);

        const evidence = await runBrowserScenarios({profiles, host, projects, findings});
        isolated.profileArtifacts.push(...await collectProfileArtifacts(profiles, findings));
        records.push(...await assertProjectRecordsOnDisk({modules, dataStorageRoot, projects, evidence, findings}));
    } catch (error) {
        findings.push({kind: "page", message: describe(error)});
    } finally {
        for (const profile of profiles) {
            for (const [index, page] of profile.pages.entries()) {
                await dispose(`page:${profile.label}#${String(index + 1)}`, async () => await page.close());
            }
        }
        for (const profile of profiles) {
            await dispose(`profile:${profile.profileDirectory}`, async () => await profile.context.close());
        }
        await dispose(`http:${isolated.httpOrigin ?? "未启动"}`, async () => await host?.close());
        await dispose("project-session", async () => await projectSession?.closeAllProjects());
        await dispose("storage-host", async () => await modules?.disposeHost());
        await dispose("environment", async () => environment?.restore());
    }
    return {findings, cleanup, isolated, records};
}

/**
 * 采样本 profile 目录里的 Chromium 产物。
 *
 * `newContext()` 只证明存储上下文隔离；这里用 profile 自己的 `Local State` 与 `Default/IndexedDB`
 * 证明浏览器数据目录确实落在隔离根内，且客户端定位凭证就存在这份 IndexedDB 里。
 */
async function collectProfileArtifacts(profiles: readonly ProfileRuntime[], findings: SmokeFinding[]): Promise<readonly ProfileArtifact[]> {
    const artifacts: ProfileArtifact[] = [];
    for (const profile of profiles) {
        const localState = await stat(join(profile.profileDirectory, "Local State")).then(() => true, () => false);
        const indexedDbEntries = await readdir(join(profile.profileDirectory, "Default", "IndexedDB")).catch(() => [] as string[]);
        artifacts.push({label: profile.label, directory: profile.profileDirectory, localState, indexedDbEntries});
        assert(localState, findings, `profile(${profile.label}) 应留下 Chromium 的 Local State 文件：${profile.profileDirectory}`);
        assert(indexedDbEntries.some((entry) => entry.includes("indexeddb")), findings,
            `profile(${profile.label}) 的 IndexedDB 应落在隔离根内：${JSON.stringify(indexedDbEntries)}`);
    }
    return artifacts;
}

/**
 * 生产模块只能在隔离根写进进程环境之后加载。
 *
 * 鉴权模块会解析数据库配置并读取 State Root；先安装显式隔离根，确保首次请求也不读取机器默认 data。
 */
async function loadStorageModules(): Promise<StorageModules> {
    const host = await import("nbook/server/storage/host");
    const storageActions = await import("nbook/server/storage/storage-actions");
    const storageErrors = await import("nbook/server/storage/http-error");
    const projectErrors = await import("nbook/server/api/projects/project-http-error");
    const filePath = await import("nbook/server/runtime/paths/file-path");
    const accessContext = await import("nbook/server/storage/access-context");
    const identityDomain = await import("nbook/server/storage/identity-domain");
    const storageAddress = await import("nbook/server/storage/storage-address");
    const recordCodec = await import("nbook/server/storage/record-codec");
    return {
        issueProjectContext: host.issueStorageProjectContext,
        releaseProjectContext: host.releaseStorageProjectContext,
        performAction: host.performStorageProjectAction,
        readAction: (event) => storageActions.readStorageActionRequest(event, STORAGE_ACTION_BODY_LIMIT_BYTES),
        readProjectContextRequest: storageActions.readStorageProjectContextRequest,
        setHostContextForTest: host.setStorageHostContextForTest,
        disposeHost: host.disposeStorageHost,
        withHttpError: storageErrors.withStorageHttpError,
        withProjectHttpError: projectErrors.withProjectHttpError,
        absoluteFsPath: filePath.absoluteFsPath,
        userStorageRootFromWorkspaceRoot: storageAddress.userStorageRootFromWorkspaceRoot,
        projectStorageRootFromProjectRoot: storageAddress.projectStorageRootFromProjectRoot,
        partitionPaths: storageAddress.storagePartitionPaths,
        recordFileName: storageAddress.storageRecordFileName,
        parseRecord: recordCodec.parseStorageRecord,
        readIdentityDomain: identityDomain.readStorageIdentityDomain,
        localStorageSubject: accessContext.localStorageSubject,
        deriveClientId: accessContext.deriveStorageClientId,
    };
}

/**
 * Project session 与其 manifest 入口。
 *
 * 它们同样只能在隔离根写进进程环境之后加载：`project-session` 的导入会注册 Storage lazy Module，
 * 静态导入会让模块级接线早于本次隔离根。
 */
async function importProjectSession(): Promise<ProjectSessionModule> {
    const session = await import("nbook/server/workspace-files/project-session");
    const workspace = await import("nbook/server/workspace-files/project-workspace");
    const identity = await import("nbook/server/workspace-files/project-identity");
    return {
        closeAllProjects: session.closeAllProjects,
        closeProject: async (ref, reason) => await session.closeProject(ref, reason),
        openProject: async (ref, opener, workspaceRoot) => await session.openProject(ref, opener, workspaceRoot),
        projectWorkspaceRef: identity.projectWorkspaceRef,
        writeProjectManifest: workspace.writeProjectManifest,
    };
}

/** 打开两个隔离 Project；A 用于关闭/重开，B 用于同客户端跨 Project 隔离。 */
async function openProjectsUnderTest(
    projectSession: ProjectSessionModule,
    modules: StorageModules,
    workspaceRoot: AbsoluteFsPath,
): Promise<ProjectCommands> {
    const refA = projectSession.projectWorkspaceRef(PROJECT_A_SEGMENT);
    const refB = projectSession.projectWorkspaceRef(PROJECT_B_SEGMENT);
    await projectSession.writeProjectManifest(workspaceRoot, refA, {kind: "novel", title: "alpha", summary: ""});
    await projectSession.writeProjectManifest(workspaceRoot, refB, {kind: "novel", title: "beta", summary: ""});
    const readyA = await projectSession.openProject(refA, {kind: "user"}, workspaceRoot);
    const readyB = await projectSession.openProject(refB, {kind: "user"}, workspaceRoot);
    const projectA: ProjectUnderTest = {
        segment: PROJECT_A_SEGMENT,
        ref: refA,
        root: readyA.workspace.root,
        storageRoot: modules.projectStorageRootFromProjectRoot(readyA.workspace.root),
        ready: readyA,
    };
    const projectB: ProjectUnderTest = {
        segment: PROJECT_B_SEGMENT,
        ref: refB,
        root: readyB.workspace.root,
        storageRoot: modules.projectStorageRootFromProjectRoot(readyB.workspace.root),
        ready: readyB,
    };
    return {
        projectA,
        projectB,
        closeA: async () => await projectSession.closeProject(refA, "shutdown"),
        reopenA: async () => {
            const reopened = await projectSession.openProject(refA, {kind: "user"}, workspaceRoot);
            projectA.ready = reopened;
            return reopened;
        },
    };
}

/**
 * 每个浏览器场景都在真实页面里跑；返回的客户端凭据用于后续磁盘断言。
 *
 * 顺序固定：先证明只有精确 ready 才签发，再证明同客户端跨 Project 隔离、shared 定义、订阅与陈旧 CAS，
 * 最后证明释放独立性与 Project 关闭/重开恢复。
 */
async function runBrowserScenarios(input: {
    readonly profiles: readonly ProfileRuntime[];
    readonly host: IsolatedHost;
    readonly projects: ProjectCommands;
    readonly findings: SmokeFinding[];
}): Promise<BrowserEvidence> {
    const main = input.profiles.find((profile) => profile.label === "main");
    const other = input.profiles.find((profile) => profile.label === "other");
    if (main === undefined || other === undefined) throw new Error("缺少本次运行的 profile");
    const tabA = await openSmokePage(main, input.host.origin, input.findings);
    const tabB = await openSmokePage(main, input.host.origin, input.findings);
    const otherClient = await openSmokePage(other, input.host.origin, input.findings);
    const context: ScenarioContext = {tabA, tabB, otherClient, host: input.host, projects: input.projects, findings: input.findings};

    const targeting = await assertReadyTargeting(context);
    const mainClientCredential = await assertCrossTabAndProjectIsolation(context, targeting);
    const otherClientCredential = await assertSharedDefinitionAcrossClients(context);
    await assertSubscriptionAndStaleWrite(context, mainClientCredential);
    await assertReleaseKeepsSiblingWritable(context);
    await assertProjectCloseAndReopen(context);
    assertNoUserFallback(context.host, input.findings);
    return {mainClientCredential, otherClientCredential};
}

/** 无 ready 目标与错误 publicId 都不得签发，也不得留下半初始化状态。 */
async function assertReadyTargeting(context: ScenarioContext): Promise<OpenView> {
    const {findings, projects} = context;

    const missing = await call<PageOutcome<OpenView>>(context.tabA, "open", "a1", LAYOUT_KEY, projects.projectA.segment, "");
    assert(missing.ok === false, findings, `缺少 publicId 不得签发 Project 访问上下文：${JSON.stringify(missing)}`);
    assert(missing.ok === false && missing.reason === "target-invalid" && missing.status === null,
        findings, `缺少 publicId 应在本地拒绝且不发请求：${JSON.stringify(missing)}`);

    const wrong = await call<PageOutcome<OpenView>>(context.tabA, "open", "a1", LAYOUT_KEY, projects.projectA.segment, projects.projectB.ready.publicId);
    assert(wrong.ok === false, findings, `另一个 Project 的 ready 不得为 Project A 签发上下文：${JSON.stringify(wrong)}`);
    assert(wrong.ok === false && wrong.status === 409, findings, `错误 ready 必须由 Project 边界拒绝：${JSON.stringify(wrong)}`);

    const afterFailures = await call<SlotView>(context.tabA, "state", "a1");
    assert(afterFailures.hasSession === false && afterFailures.hasHandle === false && afterFailures.hasSubscription === false,
        findings, `签发失败不得留下半初始化状态：${JSON.stringify(afterFailures)}`);

    const noHandle = await call<PageOutcome<StorageView>>(context.tabA, "read", "a1", LAYOUT_KEY);
    assert(noHandle.ok === false, findings, `没有成功 open 的槽不得读到状态：${JSON.stringify(noHandle)}`);
    const failedSubscribe = await call<PageOutcome<StorageView>>(context.tabA, "subscribe", "a1", LAYOUT_KEY);
    assert(failedSubscribe.ok === false, findings, `没有成功 open 的槽不得建立订阅：${JSON.stringify(failedSubscribe)}`);
    const stillClean = await call<SlotView>(context.tabA, "state", "a1");
    assert(stillClean.hasSubscription === false && stillClean.hasHandle === false,
        findings, `失败调用不得留下订阅或句柄：${JSON.stringify(stillClean)}`);

    const opened = await expectOk(
        await call<PageOutcome<OpenView>>(context.tabA, "open", "a1", LAYOUT_KEY, projects.projectA.segment, projects.projectA.ready.publicId),
        findings,
        "Project A 的有效 ready 应签发访问上下文",
    );
    assert(opened?.replaced === false, findings, `首次打开不应报告覆盖旧槽：${JSON.stringify(opened)}`);
    return opened ?? {credential: "", contextId: "", replaced: false, binding: {local: null, shared: 0}};
}

/** 同客户端两个标签共享分区；同客户端访问另一个 Project 必须看到自己的缺失记录。 */
async function assertCrossTabAndProjectIsolation(context: ScenarioContext, targeting: OpenView): Promise<string> {
    const {findings, projects} = context;
    const missing = await expectOk(await call<PageOutcome<StorageView>>(context.tabA, "read", "a1", LAYOUT_KEY), findings, "Project A 初始读取应成功");
    assert(missing?.kind === "missing", findings, `Project A 初始状态应是 missing：${JSON.stringify(missing)}`);
    const saved = await expectOk(await call<PageOutcome<WriteView>>(context.tabA, "save", "a1", LAYOUT_KEY, {width: 480}), findings, "Project A 首次保存应成功");
    assert(saved !== null && saved.revision.length > 0, findings, `首次保存应返回 revision：${JSON.stringify(saved)}`);

    const secondTab = await expectOk(
        await call<PageOutcome<OpenView>>(context.tabB, "open", "a2", LAYOUT_KEY, projects.projectA.segment, projects.projectA.ready.publicId),
        findings,
        "同一 profile 的第二个标签应能打开 Project A",
    );
    assert(secondTab?.credential === targeting.credential, findings, "同一 profile 的两个标签应共享客户端定位凭证");
    assert(secondTab?.binding.local === targeting.binding.local, findings, `同客户端的 Project 分区代次应一致：${JSON.stringify(secondTab?.binding)}`);
    const observed = await expectOk(await call<PageOutcome<StorageView>>(context.tabB, "read", "a2", LAYOUT_KEY), findings, "第二个标签应能读到同一分区");
    assert(JSON.stringify(observed?.value) === JSON.stringify({width: 480}), findings, `同一客户端的第二个标签应读到确认值：${JSON.stringify(observed)}`);

    // 同一 profile 的第二个标签改访问 Project B：相同 owner/key 必须是另一个 Project 自己的记录。
    const switched = await expectOk(
        await call<PageOutcome<OpenView>>(context.tabB, "open", "a2", LAYOUT_KEY, projects.projectB.segment, projects.projectB.ready.publicId),
        findings,
        "切换到 Project B 应签发新访问上下文",
    );
    assert(switched?.replaced === true, findings, "同一标签再次 open 必须报告并释放被覆盖的旧槽");
    assert(switched?.credential === targeting.credential, findings, "切换 Project 不改变客户端定位凭证");
    const projectBMissing = await expectOk(await call<PageOutcome<StorageView>>(context.tabB, "read", "a2", LAYOUT_KEY), findings, "Project B 初始读取应成功");
    assert(projectBMissing?.kind === "missing", findings, `同客户端跨 Project 必须隔离，B 应读到 missing：${JSON.stringify(projectBMissing)}`);
    const projectBSaved = await expectOk(await call<PageOutcome<WriteView>>(context.tabB, "save", "a2", LAYOUT_KEY, {width: 900}), findings, "Project B 保存应成功");
    assert(projectBSaved !== null && projectBSaved.revision.length > 0, findings, `Project B 保存应返回 revision：${JSON.stringify(projectBSaved)}`);

    const projectAUnchanged = await expectOk(await call<PageOutcome<StorageView>>(context.tabA, "read", "a1", LAYOUT_KEY), findings, "Project A 重读应成功");
    assert(storageWidthOf(projectAUnchanged?.value) === 480, findings, `Project B 的写入不得影响 Project A：${JSON.stringify(projectAUnchanged)}`);
    return targeting.credential;
}

/** shared 定义在相同主体下跨客户端共享；同一 owner 的 local 记录仍按客户端隔离。 */
async function assertSharedDefinitionAcrossClients(context: ScenarioContext): Promise<string> {
    const {findings, projects} = context;
    const otherOpened = await expectOk(
        await call<PageOutcome<OpenView>>(context.otherClient, "open", "isolated", LAYOUT_KEY, projects.projectA.segment, projects.projectA.ready.publicId),
        findings,
        "独立 profile 应能打开 Project A",
    );
    if (otherOpened === null) return "";
    const otherLocal = await expectOk(await call<PageOutcome<StorageView>>(context.otherClient, "read", "isolated", LAYOUT_KEY), findings, "独立 profile 读取 local 记录应成功");
    assert(otherLocal?.kind === "missing", findings, `独立 profile 的 Project local 记录必须隔离：${JSON.stringify(otherLocal)}`);

    const sharedSaved = await expectOk(
        await call<PageOutcome<WriteView>>(context.tabA, "save", "a1", BOARD_KEY, {title: "shared-board"}),
        findings,
        "主客户端写入 Project shared 记录应成功",
    );
    assert(sharedSaved !== null && sharedSaved.revision.length > 0, findings, `shared 保存应返回 revision：${JSON.stringify(sharedSaved)}`);
    const sharedRead = await expectOk(await call<PageOutcome<StorageView>>(context.otherClient, "read", "isolated", BOARD_KEY), findings, "独立 profile 读取 shared 记录应成功");
    assert(JSON.stringify(sharedRead?.value) === JSON.stringify({title: "shared-board"}),
        findings, `Project shared 记录应在相同主体内跨客户端共享：${JSON.stringify(sharedRead)}`);
    return otherOpened.credential;
}

/** 订阅先给初始快照，再报告另一个句柄提交的变化；陈旧条件写入必须明确冲突。 */
async function assertSubscriptionAndStaleWrite(context: ScenarioContext, mainClientCredential: string): Promise<void> {
    const {findings, projects} = context;
    const backToA = await expectOk(
        await call<PageOutcome<OpenView>>(context.tabB, "open", "a2", LAYOUT_KEY, projects.projectA.segment, projects.projectA.ready.publicId),
        findings,
        "第二个标签应能回到 Project A",
    );
    assert(backToA?.credential === mainClientCredential, findings, "回到 Project A 应复用同一客户端定位凭证");
    assert(backToA?.replaced === true, findings, "从 Project B 切回 A 必须报告并释放被覆盖的旧槽");

    const subscribed = await expectOk(await call<PageOutcome<StorageView>>(context.tabB, "subscribe", "a2", LAYOUT_KEY), findings, "订阅应返回初始快照");
    assert(JSON.stringify(subscribed?.value) === JSON.stringify({width: 480}), findings, `订阅初始快照应是当前确认值：${JSON.stringify(subscribed)}`);
    const startedUpdates = await call<{readonly count: number; readonly last: StorageView | null}>(context.tabB, "updates", "a2");
    assert(startedUpdates.count === 0, findings, `初始快照不应触发 onUpdate：${JSON.stringify(startedUpdates)}`);

    const changed = await expectOk(await call<PageOutcome<WriteView>>(context.tabA, "save", "a1", LAYOUT_KEY, {width: 640}), findings, "另一个句柄的保存应成功");
    assert(changed !== null && changed.revision.length > 0, findings, `订阅来源保存应返回 revision：${JSON.stringify(changed)}`);
    try {
        await context.tabB.waitForFunction("globalThis.nbookStorageProjectSmoke.updates('a2').count > 0", undefined, {timeout: 15_000});
    } catch (error) {
        findings.push({kind: "assertion", message: `订阅应在观察间隔内报告外部提交：${describe(error)}`});
        return;
    }
    const observed = await call<{readonly count: number; readonly last: StorageView | null}>(context.tabB, "updates", "a2");
    assert(JSON.stringify(observed.last?.value) === JSON.stringify({width: 640}), findings, `订阅更新应是新的确认值：${JSON.stringify(observed.last)}`);
    assert(observed.last?.kind !== "error", findings, `订阅不应报告错误：${JSON.stringify(observed.last)}`);

    // 先让第二个标签刷新到当前确认值，再由第一个句柄提交一次新修订，第二个标签的条件写入随即陈旧。
    const refreshed = await expectOk(await call<PageOutcome<StorageView>>(context.tabB, "read", "a2", LAYOUT_KEY), findings, "订阅标签重读应成功");
    assert(JSON.stringify(refreshed?.value) === JSON.stringify({width: 640}), findings, `订阅标签重读应看到确认值：${JSON.stringify(refreshed)}`);
    const advanced = await expectOk(await call<PageOutcome<WriteView>>(context.tabA, "save", "a1", LAYOUT_KEY, {width: 700}), findings, "提交新修订应成功");
    assert(advanced !== null, findings, "提交新修订应返回凭据");
    const stale = await call<PageOutcome<WriteView>>(context.tabB, "save", "a2", LAYOUT_KEY, {width: 800});
    assert(stale.ok === false && stale.code === "STORAGE_REVISION_CONFLICT", findings, `陈旧条件写入必须明确冲突：${JSON.stringify(stale)}`);
    assert(stale.ok === false && stale.committed === false, findings, `冲突不得提交任何内容：${JSON.stringify(stale)}`);
    const afterConflict = await expectOk(await call<PageOutcome<StorageView>>(context.tabB, "read", "a2", LAYOUT_KEY), findings, "冲突后重读应成功");
    assert(JSON.stringify(afterConflict?.value) === JSON.stringify({width: 700}), findings, `冲突不得覆盖已确认值：${JSON.stringify(afterConflict)}`);
}

/** 释放第二个标签必须关闭它的订阅、句柄与访问上下文，且第一个标签仍能真实读写。 */
async function assertReleaseKeepsSiblingWritable(context: ScenarioContext): Promise<void> {
    const {findings, projects} = context;
    const subscribed = await expectOk(await call<PageOutcome<StorageView>>(context.tabB, "subscribe", "a2", LAYOUT_KEY), findings, "释放前应能再次建立订阅");
    assert(JSON.stringify(subscribed?.value) === JSON.stringify({width: 700}), findings, `释放前订阅快照应是确认值：${JSON.stringify(subscribed)}`);
    const beforeRelease = await call<SlotView>(context.tabB, "state", "a2");
    assert(beforeRelease.hasSession && beforeRelease.contextId !== null, findings, `释放前第二个标签应持有访问上下文：${JSON.stringify(beforeRelease)}`);
    const released = await expectOk(await call<PageOutcome<true>>(context.tabB, "release", "a2"), findings, "释放第二个标签应成功");
    assert(released !== null, findings, "释放第二个标签应返回成功");

    const afterRelease = await call<SlotView>(context.tabB, "state", "a2");
    assert(afterRelease.hasSubscription === false && afterRelease.hasHandle === false && afterRelease.hasSession === false,
        findings, `释放必须同时关闭订阅、句柄与访问上下文：${JSON.stringify(afterRelease)}`);
    const deletesAfterRelease = context.host.apiCalls.filter((entry) => entry === "DELETE /api/storage/project/context").length;
    assert(deletesAfterRelease >= 1, findings, `释放应向宿主提交访问上下文释放：${String(deletesAfterRelease)} 次`);

    // 被释放的槽不能继续提供服务，也不能留下半初始化状态。
    const readAfterRelease = await call<PageOutcome<StorageView>>(context.tabB, "read", "a2", LAYOUT_KEY);
    assert(readAfterRelease.ok === false, findings, `已释放的槽不得继续读取：${JSON.stringify(readAfterRelease)}`);
    const subscribeAfterRelease = await call<PageOutcome<StorageView>>(context.tabB, "subscribe", "a2", LAYOUT_KEY);
    assert(subscribeAfterRelease.ok === false, findings, `已释放的槽不得重新订阅：${JSON.stringify(subscribeAfterRelease)}`);
    const stateAfterFailedCalls = await call<SlotView>(context.tabB, "state", "a2");
    assert(stateAfterFailedCalls.hasSubscription === false && stateAfterFailedCalls.hasHandle === false,
        findings, `失败调用不得留下半初始化状态：${JSON.stringify(stateAfterFailedCalls)}`);

    // 第一个标签必须完成一次真实 save + read 往返：释放另一个标签不撤销这一个的访问生命周期。
    const siblingSaved = await expectOk(await call<PageOutcome<WriteView>>(context.tabA, "save", "a1", LAYOUT_KEY, {width: 720}), findings, "释放第二个标签后第一个标签应仍能保存");
    assert(siblingSaved !== null && siblingSaved.revision.length > 0, findings, `第一个标签的保存应返回 revision：${JSON.stringify(siblingSaved)}`);
    const siblingRead = await expectOk(await call<PageOutcome<StorageView>>(context.tabA, "read", "a1", LAYOUT_KEY), findings, "释放第二个标签后第一个标签应仍能读取");
    assert(JSON.stringify(siblingRead?.value) === JSON.stringify({width: 720}), findings, `第一个标签应读回自己的写入：${JSON.stringify(siblingRead)}`);

    // 覆盖至少一个完整观察间隔：被释放的订阅不得再投递快照。
    await context.tabB.waitForTimeout(1_200);
    const updatesAfterRelease = await call<{readonly count: number; readonly last: StorageView | null}>(context.tabB, "updates", "a2");
    assert(updatesAfterRelease.count === afterRelease.updates, findings, `释放后不得再投递订阅快照：${String(updatesAfterRelease.count)} / ${String(afterRelease.updates)}`);

    // 重新打开必须得到新的访问上下文，证明释放关闭的是旧上下文而不是换了个句柄。
    const reopened = await expectOk(
        await call<PageOutcome<OpenView>>(context.tabB, "open", "a2", LAYOUT_KEY, projects.projectA.segment, projects.projectA.ready.publicId),
        findings,
        "释放后应能重新打开 Project A",
    );
    assert(reopened?.replaced === false, findings, `干净释放后重新打开不应报告覆盖：${JSON.stringify(reopened)}`);
    assert(reopened !== null && beforeRelease.contextId !== null && reopened.contextId !== beforeRelease.contextId,
        findings, `释放后重新打开必须得到新的访问上下文：${JSON.stringify(beforeRelease.contextId)} → ${JSON.stringify(reopened?.contextId)}`);
    const reopenedRead = await expectOk(await call<PageOutcome<StorageView>>(context.tabB, "read", "a2", LAYOUT_KEY), findings, "重新打开后应能读取确认值");
    assert(JSON.stringify(reopenedRead?.value) === JSON.stringify({width: 720}), findings, `重新打开应读回已提交值：${JSON.stringify(reopenedRead)}`);
}

/** 关闭 Project 后旧 session 与旧 ready 都拒绝新写；同路径重开新 ready 后能读回已提交值。 */
async function assertProjectCloseAndReopen(context: ScenarioContext): Promise<void> {
    const {findings, projects} = context;
    const previousPublicId = projects.projectA.ready.publicId;
    const beforeClose = await call<SlotView>(context.tabA, "state", "a1");
    assert(beforeClose.hasSession && beforeClose.contextId !== null, findings, `关闭前第一个标签应持有访问上下文：${JSON.stringify(beforeClose)}`);
    await projects.closeA();

    const staleRead = await call<PageOutcome<StorageView>>(context.tabA, "read", "a1", LAYOUT_KEY);
    assert(staleRead.ok === false && staleRead.code === "STORAGE_CONTEXT_INVALID", findings, `Project 关闭后旧 session 应失效：${JSON.stringify(staleRead)}`);
    const staleWrite = await call<PageOutcome<WriteView>>(context.tabA, "save", "a1", LAYOUT_KEY, {width: 990});
    assert(staleWrite.ok === false && staleWrite.code === "STORAGE_CONTEXT_INVALID", findings, `Project 关闭后旧 session 必须拒绝新写：${JSON.stringify(staleWrite)}`);
    const staleReady = await call<PageOutcome<OpenView>>(context.tabA, "open", "a1", LAYOUT_KEY, projects.projectA.segment, previousPublicId);
    assert(staleReady.ok === false && staleReady.status === 409, findings, `Project 关闭后旧 ready 不得签发新上下文：${JSON.stringify(staleReady)}`);

    const reopened = await projects.reopenA();
    assert(reopened.publicId !== previousPublicId, findings, "同路径重开必须发布新的 ready publicId");
    const rebuilt = await expectOk(
        await call<PageOutcome<OpenView>>(context.tabA, "open", "a1", LAYOUT_KEY, projects.projectA.segment, reopened.publicId),
        findings,
        "新 ready 应能显式重建访问上下文",
    );
    assert(rebuilt?.replaced === true, findings, "重建应报告并释放被覆盖的旧槽");
    assert(rebuilt !== null && beforeClose.contextId !== null && rebuilt.contextId !== beforeClose.contextId,
        findings, `重开后的重建必须得到新的访问上下文：${JSON.stringify(beforeClose.contextId)} → ${JSON.stringify(rebuilt?.contextId)}`);
    const recovered = await expectOk(await call<PageOutcome<StorageView>>(context.tabA, "read", "a1", LAYOUT_KEY), findings, "重建后应能读取确认值");
    assert(JSON.stringify(recovered?.value) === JSON.stringify({width: 720}), findings, `新 ready 应从 Project 磁盘恢复确认值：${JSON.stringify(recovered)}`);
    const rewritten = await expectOk(await call<PageOutcome<WriteView>>(context.tabA, "save", "a1", LAYOUT_KEY, {width: 730}), findings, "重开后的新上下文应可写");
    assert(rewritten !== null && rewritten.revision.length > 0, findings, `重开后的写入应返回 revision：${JSON.stringify(rewritten)}`);
}

/** 全部请求都必须打在 Project 路由上：错误目标不得退化成 user 访问。 */
function assertNoUserFallback(host: IsolatedHost, findings: SmokeFinding[]): void {
    const userCalls = host.apiCalls.filter((entry) => entry.includes("/api/storage/user/"));
    assert(userCalls.length === 0, findings, `Project smoke 不得回退到 user 路由：${JSON.stringify(userCalls)}`);
    const contextCalls = host.apiCalls.filter((entry) => entry.endsWith("/api/storage/project/context")).length;
    assert(contextCalls > 0, findings, "Project smoke 必须真实经过 Project 上下文路由");
}

/**
 * 精确磁盘断言：记录地址由生产地址入口推导，记录内容是解析后的字段而不是任意文本。
 *
 * 身份域来自 data 根（WorkspaceRoot/.nbook/storage）的生产身份入口；Project 根不持有第二份身份元数据。
 */
async function assertProjectRecordsOnDisk(input: {
    readonly modules: StorageModules;
    readonly dataStorageRoot: AbsoluteFsPath;
    readonly projects: ProjectCommands;
    readonly evidence: BrowserEvidence;
    readonly findings: SmokeFinding[];
}): Promise<readonly StorageRecordEvidence[]> {
    const {findings, modules, projects} = input;
    const records: StorageRecordEvidence[] = [];
    if (input.evidence.mainClientCredential === "" || input.evidence.otherClientCredential === "") {
        findings.push({kind: "assertion", message: "浏览器没有取得客户端定位凭证，无法核对磁盘记录"});
        return records;
    }
    const identityDomain = await modules.readIdentityDomain(input.dataStorageRoot);
    assert(identityDomain !== null, findings, "Project 访问应初始化 data 身份域");
    if (identityDomain === null) return records;
    const subject = modules.localStorageSubject(identityDomain);
    const mainClientId = modules.deriveClientId(input.evidence.mainClientCredential);
    const otherClientId = modules.deriveClientId(input.evidence.otherClientCredential);
    assert(mainClientId !== otherClientId, findings, "两个 profile 必须导出不同的 clientId");

    const localPartition = (project: ProjectUnderTest, clientId: string) => modules.partitionPaths({
        storageRoot: project.storageRoot,
        identityDomain,
        subject,
        locality: "local",
        clientId,
        owner: PROJECT_OWNER,
    });
    const partitionA = localPartition(projects.projectA, mainClientId);
    const partitionB = localPartition(projects.projectB, mainClientId);
    assert(partitionA.directory !== partitionB.directory, findings, `两个 Project 的 local 分区目录必须不同：${partitionA.directory} / ${partitionB.directory}`);
    assert(localPartition(projects.projectA, otherClientId).directory !== partitionA.directory,
        findings, "不同 clientId 的 Project local 分区目录必须不同");

    const recordA = join(partitionA.recordsDirectory, modules.recordFileName(LAYOUT_KEY));
    const recordB = join(partitionB.recordsDirectory, modules.recordFileName(LAYOUT_KEY));
    const evidenceA = await assertRecordValue(recordA, "Project A local 记录", modules, findings, (value) => storageWidthOf(value) === 730);
    const evidenceB = await assertRecordValue(recordB, "Project B local 记录", modules, findings, (value) => storageWidthOf(value) === 900);
    if (evidenceA !== null) records.push(evidenceA);
    if (evidenceB !== null) records.push(evidenceB);

    const sharedPartition = modules.partitionPaths({
        storageRoot: projects.projectA.storageRoot,
        identityDomain,
        subject,
        locality: "shared",
        owner: PROJECT_OWNER,
    });
    assert(sharedPartition.directory !== partitionA.directory, findings, "shared 分区不得与 local 分区重合");
    const sharedRecord = join(sharedPartition.recordsDirectory, modules.recordFileName(BOARD_KEY));
    const sharedEvidence = await assertRecordValue(sharedRecord, "Project A shared 记录", modules, findings, (value) => storageTitleOf(value) === "shared-board");
    if (sharedEvidence !== null) records.push(sharedEvidence);

    // 身份域只从 data 根签发：Project Storage 根不复制一份 identity.json。
    const projectEntries = await readdir(projects.projectA.storageRoot).catch(() => [] as string[]);
    assert(!projectEntries.includes("identity.json"), findings, `Project Storage 根不得持有第二份 identity.json：${JSON.stringify(projectEntries)}`);
    const dataIdentityPresent = await stat(join(input.dataStorageRoot, "identity.json")).then(() => true, () => false);
    assert(dataIdentityPresent, findings, "data 根应持有身份域元数据");
    return records;
}

/** 解析一条已确认记录：核对封装版本、schemaVersion、revision 与最终值字段，并把核对结果作为证据返回。 */
async function assertRecordValue(
    recordPath: string,
    label: string,
    modules: StorageModules,
    findings: SmokeFinding[],
    matchesExpectedValue: (value: unknown) => boolean,
): Promise<StorageRecordEvidence | null> {
    const raw = await readFile(recordPath, "utf8").catch(() => null);
    assert(raw !== null, findings, `${label} 应在生产地址推导的路径留下记录：${recordPath}`);
    if (raw === null) return null;
    const envelope = parseEnvelope(raw);
    assert(envelope.wrapper === STORAGE_WRAPPER_VERSION, findings, `${label} 封装版本应是 ${String(STORAGE_WRAPPER_VERSION)}：${JSON.stringify(envelope)}`);
    assert(envelope.state === "value", findings, `${label} 应是值记录：${JSON.stringify(envelope)}`);
    const parsed = modules.parseRecord(raw);
    assert(parsed.kind === "value", findings, `${label} 应能被生产解析器读成值记录：${JSON.stringify(parsed)}`);
    if (parsed.kind !== "value") return null;
    assert(parsed.schemaVersion === 1, findings, `${label} 的 schemaVersion 应是定义声明的 1：${JSON.stringify(parsed)}`);
    assert(envelope.revision !== null && parsed.revision === envelope.revision, findings, `${label} 的 revision 应在封装与解析结果中一致：${JSON.stringify(envelope)}`);
    assert(matchesExpectedValue(parsed.value), findings, `${label} 的最终值应与已确认提交一致：${JSON.stringify(parsed.value)}`);
    return {
        label,
        path: recordPath,
        wrapper: envelope.wrapper,
        state: envelope.state,
        schemaVersion: parsed.schemaVersion,
        value: parsed.value,
    };
}

type RecordEnvelope = {
    readonly wrapper: number | null;
    readonly state: string | null;
    readonly revision: string | null;
};

/** 封装字段只按运行时类型取值，避免对解析结果做形状断言。 */
function parseEnvelope(raw: string): RecordEnvelope {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {wrapper: null, state: null, revision: null};
    const wrapper = "wrapper" in parsed ? parsed.wrapper : null;
    const state = "state" in parsed ? parsed.state : null;
    const revision = "revision" in parsed ? parsed.revision : null;
    return {
        wrapper: typeof wrapper === "number" ? wrapper : null,
        state: typeof state === "string" ? state : null,
        revision: typeof revision === "string" ? revision : null,
    };
}

/** 只读取一个已声明字段，并按运行时类型收窄；不信任外部形状。 */
function storageWidthOf(value: unknown): number | null {
    if (typeof value !== "object" || value === null || !("width" in value)) return null;
    return typeof value.width === "number" ? value.width : null;
}

/** 只读取一个已声明字段，并按运行时类型收窄；不信任外部形状。 */
function storageTitleOf(value: unknown): string | null {
    if (typeof value !== "object" || value === null || !("title" in value)) return null;
    return typeof value.title === "string" ? value.title : null;
}

/** 挂载产品 Project Storage 入口的最小宿主：静态站点只负责加载浏览器模块。 */
async function startIsolatedHost(siteRoot: string, modules: StorageModules): Promise<IsolatedHost> {
    const app = createApp();
    app.use(CONTEXT_PATH, defineEventHandler(async (event) => {
        if (event.method === "POST") {
            const request = await modules.readProjectContextRequest(event);
            return await modules.withHttpError(() => modules.withProjectHttpError(() => modules.issueProjectContext(event, request)));
        }
        if (event.method === "DELETE") return await modules.withHttpError(() => modules.releaseProjectContext(event));
        throw createError({statusCode: 405, message: "仅支持 POST 与 DELETE"});
    }));
    app.use(ACTION_PATH, defineEventHandler(async (event) => {
        if (event.method !== "POST") throw createError({statusCode: 405, message: "仅支持 POST"});
        return await modules.withHttpError(async () => {
            const action = await modules.readAction(event);
            return await modules.withProjectHttpError(() => modules.performAction(event, action));
        });
    }));
    const listener = toNodeListener(app);
    const apiCalls: string[] = [];
    const siteFiles = new Map<string, {readonly contentType: string; readonly body: string}>();
    for (const file of SITE_FILES) {
        siteFiles.set(file.route, {contentType: file.contentType, body: await readFile(join(siteRoot, file.fileName), "utf8")});
    }
    const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://storage.test").pathname;
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
    if (address === null || typeof address === "string") throw new Error("Project Storage smoke 未监听 TCP 端口");
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
        outfile: join(siteRoot, "project.js"),
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

/**
 * 启动一个本次专属的持久化 profile。
 *
 * `launchPersistentContext` 让 Chromium 的 profile 与 cache 实际落在隔离根内：
 * 定位凭证存在 IndexedDB，只有真实 profile 目录才能证明跨客户端隔离，`browser.newContext()` 不能。
 */
async function launchProfileRuntime(input: {
    readonly label: string;
    readonly profileDirectory: string;
    readonly browserExecutable: string;
    readonly headless: boolean;
}): Promise<ProfileRuntime> {
    if (process.platform === "win32" && typeof Bun !== "undefined") {
        throw new Error("Project Storage smoke 必须由 Node 运行；Windows Bun 无法可靠连接 Chromium 调试管道。");
    }
    await mkdir(input.profileDirectory, {recursive: true});
    const context = await chromium.launchPersistentContext(input.profileDirectory, {
        args: ["--host-resolver-rules=MAP storage.test 127.0.0.1", "--no-proxy-server"],
        executablePath: resolve(input.browserExecutable),
        headless: input.headless,
        timeout: 60_000,
    });
    return {label: input.label, profileDirectory: input.profileDirectory, context, pages: []};
}

/** 打开一个页面并等待产品 fixture 就位；页面进入 profile 的释放范围。 */
async function openSmokePage(profile: ProfileRuntime, origin: string, findings: SmokeFinding[]): Promise<Page> {
    const page = await profile.context.newPage();
    profile.pages.push(page);
    observePage(page, findings);
    await page.goto(origin, {waitUntil: "domcontentloaded", timeout: 30_000});
    await page.waitForFunction("typeof globalThis.nbookStorageProjectSmoke === 'object'", undefined, {timeout: 30_000});
    return page;
}

/**
 * 调用页面上的 Project 适配器 fixture API。
 *
 * 必须传表达式字符串：Node 侧函数经 tsx 转换后带有 `__name` 辅助引用，
 * Playwright 序列化函数源码时会在页面里抛出 `__name is not defined`。
 */
async function call<TResult>(page: Page, method: keyof SmokePageApi, ...args: readonly unknown[]): Promise<TResult> {
    const serialized = args.map((arg) => JSON.stringify(arg)).join(", ");
    return await page.evaluate(`globalThis.nbookStorageProjectSmoke.${method}(${serialized})`) as TResult;
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

async function expectOk<TResult>(outcome: PageOutcome<TResult>, findings: SmokeFinding[], message: string): Promise<TResult | null> {
    if (!outcome.ok) {
        findings.push({kind: "assertion", message: `${message}：${JSON.stringify(outcome)}`});
        return null;
    }
    return outcome.value;
}

function assert(condition: boolean, findings: SmokeFinding[], message: string): void {
    if (!condition) findings.push({kind: "assertion", message});
}

function describe(error: unknown): string {
    return error instanceof Error ? error.stack ?? error.message : String(error);
}

/**
 * 隔离 State Root 使用显式 Boot Config 关闭鉴权，走与产品相同的 auth-off 本地主体路径。
 *
 * 快照被改写的进程变量，释放阶段恢复它们：脚本不在进程里留下隔离根。
 */
function installIsolatedEnvironment(paths: {readonly applicationRoot: string; readonly stateRoot: string}): {restore: () => void} {
    const assignments: Record<string, string> = {
        NEURO_BOOK_APPLICATION_ROOT: paths.applicationRoot,
        NEURO_BOOK_STATE_ROOT: paths.stateRoot,
        DATABASE_KIND: "sqlite",
        DATABASE_URL: "file:./storage-project.sqlite",
    };
    const previous: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(assignments)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }
    return {
        restore: () => {
            for (const key of Object.keys(assignments)) {
                const value = previous[key];
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        },
    };
}

/**
 * 删除前核验隔离根归属。
 *
 * 只有「本次选项推导出的 scratch 路径」才允许删除：绝对路径必须等于解析结果、叶子必须是本次随机十六进制名、
 * 父目录必须是本次服务名，且真实路径位于 test-support scratch 根之下。历史临时根因此永远不可能通过校验。
 */
export function assertOwnedIsolationRoot(root: string): void {
    const resolved = resolve(root);
    if (!isAbsolute(root) || resolved !== root) {
        throw new Error(`拒绝删除非绝对或未规范化的隔离根：${root}`);
    }
    if (!SCRATCH_LEAF_PATTERN.test(basename(resolved)) || basename(dirname(resolved)) !== SCRATCH_DIRECTORY) {
        throw new Error(`拒绝删除本次运行之外的隔离根：${resolved}`);
    }
    for (const forbidden of forbiddenRoots()) {
        if (resolved === forbidden) {
            throw new Error(`拒绝删除历史临时根：${resolved}`);
        }
    }
    assertContained(resolveAgentTempRoot(), dirname(resolved), "Project Storage smoke 隔离根");
}

/** 历史临时根在本机可能落在 scratch 根或 product-runtime 验收根下；两种拼写都进入拒删名单。 */
function forbiddenRoots(): readonly string[] {
    return FORBIDDEN_DIRECTORIES.flatMap((name) => [resolveAgentScratchPath(name), join(resolveAgentAcceptanceRoot(), name)]);
}

/** 根删除只发生在归属校验通过之后；校验或删除失败都作为独立结果上报，不掩盖正文结果。 */
async function removeIsolationRoot(root: string): Promise<CleanupOutcome> {
    const resource = `isolation-root:${root}`;
    try {
        assertOwnedIsolationRoot(root);
    } catch (error) {
        return {resource, ok: false, message: describe(error)};
    }
    try {
        await rm(root, {recursive: true, force: true});
        return {resource, ok: true, message: null};
    } catch (error) {
        return {resource, ok: false, message: describe(error)};
    }
}

function parseOptions(args: readonly string[]): StorageProjectAdapterSmokeOptions {
    const values: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!key?.startsWith("--") || !value) throw new Error(`无效参数：${args.slice(index).join(" ")}`);
        values[key] = value;
    }
    return {
        root: resolveAgentScratchPath(SCRATCH_DIRECTORY, randomBytes(4).toString("hex")),
        browserExecutable: values["--browser-executable"] ?? chromium.executablePath(),
        headless: values["--headed"] === undefined,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const options = parseOptions(process.argv.slice(2));
    console.error(`Project Storage smoke 隔离根：${options.root}`);
    const result = await runStorageProjectAdapterSmoke(options);
    const cleanup = [...result.cleanup, await removeIsolationRoot(options.root)];
    const findings = result.findings;
    const failed = findings.length > 0 || cleanup.some((outcome) => !outcome.ok);
    console.log(JSON.stringify({
        schema: "nbook.storage-project-adapter-smoke/v1",
        status: failed ? "failed" : "passed",
        isolated: result.isolated,
        records: result.records,
        cleanup,
        findings,
    }, null, 2));
    if (failed) process.exitCode = 1;
}
