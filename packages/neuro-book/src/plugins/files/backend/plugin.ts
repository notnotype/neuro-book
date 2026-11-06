/**
 * `nbook.files` 的后端定义：项目入口提供 `project://`（根是本项目代次的项目目录，`.nbook/` 是控制目录），服务端入口
 * 提供 `user://`（根是 `<状态根>/user/`）。两个入口都启动即激活，按调用方身份以远程服务交出同一套方法
 * （docs/specs/workspace/resources.md）。服务端与项目实例里的插件直接用这两份合同。
 */

import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {Scope} from "@notnotype/nb-runtime/lifecycle";
import type {ActivationContext, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import {clockKey, stateRootKey} from "nbook/shared/host";
import {HTTP_ROUTES_POINT} from "nbook/plugins/http/shared/contracts";
import {currentProjectKey, projectsKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {filesPreviewContract, projectFilesContract, userFilesContract} from "../shared/contracts";
import type {ChangeGroup, ChangeSource, FilesContract} from "../shared/contracts";
import {createChangeHub} from "./changes";
import type {ChangeHub, Origin} from "./changes";
import {createFilesService} from "./files-service";
import type {FilesService} from "./files-service";
import {createBatch} from "./batch";
import type {Batch, BatchControl} from "./batch";
import {createOperations} from "./operations";
import type {Operations} from "./operations";
import {addThemeAssetRoutes} from "./theme-asset-route";
import {createPreviewTokens, createRawRoutes, PREVIEW_PREFIX} from "./raw-route";
import {SCHEMES_POINT, schemesPoint} from "../shared/schemes";
import {workspaceFilesKey} from "../shared/workspace-files";
import {LEDGER_POINT, ledgerPoint} from "../shared/ledger";
import {LedgerSlot} from "./ledger-slot";
import {saveText, tracked} from "./execute";
import {createProjectsAccess} from "./projects-scheme";
import {SchemeRegistry} from "./registry";
import {ownWorkspaceFiles, provideWorkspaceFiles} from "./workspace-files";
import {openRoot} from "./rooted";
import {createStagingCommitter, ensureStagingDirectory, sweepStaging} from "./staging";
import type {StagingCommit} from "./staging";
import type {RootedRoot, RootOptions} from "./rooted";

/** 写入来源按调用方身份：窗口里的插件是写作者，服务端与项目实例里的插件是系统（resources.md 的“写入来源”）。 */
export function sourceOf(consumer: ConsumerIdentity): ChangeSource {
    return consumer.location === "browser" || consumer.location === "tui" ? {kind: "user", plugin: consumer.plugin} : {kind: "system", plugin: consumer.plugin};
}

/**
 * 写方法的 `as`（转发来的来源）只认服务端位置的 `nbook.files`（`projects://` 的转发，resources.md 的“写入来源”）；别的调用方
 * 带了按无权拒绝。远程提供方不能交回路由层的 `invalid-input`，所以用业务码 `permission-denied`。
 */
function originFor(consumer: ConsumerIdentity, input: {readonly as?: ChangeSource; readonly group?: ChangeGroup}): Origin | Denied {
    const group = input.group === undefined ? {} : {group: input.group};
    if (input.as === undefined) return {source: sourceOf(consumer), ...group};
    if (isServerFiles(consumer)) return {source: input.as, ...group};
    return denied("只有服务端的文件服务可以转发写入来源");
}

type Denied = {readonly ok: false; readonly code: "permission-denied"; readonly detail: {readonly detail: string}};

function denied(detail: string): Denied {
    return {ok: false, code: "permission-denied", detail: {detail}};
}

/** 服务端的 `nbook.files`（写入接口的 `projects://` 转发）：提交与根外读路径只给它，不给浏览器。 */
function isServerFiles(consumer: ConsumerIdentity): boolean {
    return consumer.location === "server" && consumer.plugin === descriptor.id;
}

interface Backend {
    readonly root: RootedRoot;
    readonly service: FilesService;
    readonly operations: Operations;
    readonly batch: Batch;
    readonly changes: ChangeHub;
    readonly scope: Scope;
    /** 暂存目录建不起来时为 null，提交得 `io-failed`。 */
    readonly commit: StagingCommit | null;
    readonly stagingDirectory: string | null;
    readonly ledger: LedgerSlot;
}

/** 两份合同的方法与事件相同，实现也相同；`consumer` 是内核填写的调用方身份，写入来源由它确定。 */
function implementation(backend: Backend, consumer: ConsumerIdentity): RemoteImplementation<typeof userFilesContract> {
    const {root, service, operations, batch, changes, scope} = backend;
    /** 带了 `as` 或 `group` 的写方法：按调用方身份核对后得到归属，核对不过时直接交回拒绝。 */
    const attributed = <T>(input: {readonly as?: ChangeSource; readonly group?: ChangeGroup}, run: (origin: Origin) => Promise<T>): Promise<T | Denied> => {
        const origin = originFor(consumer, input);
        return "ok" in origin ? Promise.resolve(origin) : run(origin);
    };
    /**
     * 这个调用方在途的批量：门面按调用方生成，别的窗口命中不了这里的操作 id。同一 id 正在执行时再发为 `busy`，
     * 结算后删除。
     */
    const active = new Map<string, BatchControl>();
    const run = async <T>(operation: string, signal: AbortSignal, label: string, body: (control: BatchControl) => Promise<T>): Promise<T | {readonly ok: false; readonly code: "busy"; readonly detail: {readonly detail: string}}> => {
        if (active.has(operation)) return {ok: false, code: "busy", detail: {detail: `操作 ${operation} 正在执行`}};
        const control: BatchControl = {operation, cancelled: false, signal};
        active.set(operation, control);
        try {
            return await tracked(scope, label, () => body(control));
        } finally {
            active.delete(operation);
        }
    };
    return {
        methods: {
            list: (input) => service.list(input.path),
            find: (input) => service.find(input.query, input.limit),
            read: (input) => service.read(input.path),
            realPath: async (input) => {
                if (input.follow !== true) return service.realPath(input.path);
                if (!isServerFiles(consumer)) return denied("只有服务端的文件服务可以取跟随链接的读路径");
                const target = await root.resolveForRead(input.path);
                if ("ok" in target) return {ok: false, code: target.code as Exclude<typeof target.code, "unknown-scheme">, detail: {detail: target.detail}};
                return {ok: true, value: {path: target.absolute, kind: target.kind}};
            },
            write: (input) => attributed(input, (origin) => saveText(backend, input.path, input.text, input.baseline, origin)),
            commit: async (input) => {
                if (!isServerFiles(consumer)) return denied("只有服务端的文件服务可以提交暂存文件");
                const {commit} = backend;
                if (commit === null) return {ok: false, code: "io-failed", detail: {detail: "暂存目录不可用"}};
                return attributed(input, (origin) => tracked(scope, "files.commit", () => commit(input, origin)));
            },
            identify: (input) => operations.identify(input.paths),
            create: (input) => attributed(input, (origin) => tracked(scope, "files.create", () => operations.create(input, origin))),
            createContent: (input) => attributed(input, (origin) => tracked(scope, "files.create-content", () => operations.createContent(input, origin))),
            rename: (input) => attributed(input, (origin) => tracked(scope, "files.rename", () => operations.rename(input, origin))),
            convert: (input) => attributed(input, (origin) => tracked(scope, "files.convert", () => operations.convert(input, origin))),
            reorder: (input) => attributed(input, (origin) => tracked(scope, "files.reorder", () => operations.reorder(input, origin))),
            display: (input) => attributed(input, (origin) => tracked(scope, "files.display", () => operations.display(input, origin))),
            include: (input) => attributed(input, (origin) => tracked(scope, "files.include", () => operations.include(input, origin))),
            drop: (input) => attributed(input, (origin) => tracked(scope, "files.drop", () => operations.drop(input, origin))),
            move: (input, {signal}) => attributed(input, (origin) => run(input.operation, signal, "files.move", (control) => batch.transfer("move", input, origin, control))),
            copy: (input, {signal}) => attributed(input, (origin) => run(input.operation, signal, "files.copy", (control) => batch.transfer("copy", input, origin, control))),
            delete: (input, {signal}) => attributed(input, (origin) => run(input.operation, signal, "files.delete", (control) => batch.remove(input, origin, control))),
            cancel: async (input) => {
                const control = active.get(input.operation);
                if (control !== undefined) control.cancelled = true;
                return {ok: true, value: {found: control !== undefined}};
            },
        },
        events: {
            changes: {
                subscribe: (_filter, sink, {signal}) => changes.subscribe((message) => sink.next(message), signal),
            },
        },
    };
}

/** 一个根上的文件服务：打开根、建变更、操作与批量，登记在入口的作用域上。根不可用时激活失败。 */
async function openBackend(context: ActivationContext, scheme: "user" | "project", placed: {readonly path: string; readonly options: Omit<RootOptions, "report">; readonly staging: {readonly base?: string; readonly segments: readonly string[]}}) {
    const record = recordTo(context.services.require(diagnosticsKey));
    const root = await openRoot(placed.path, {...placed.options, report: (event, error) => record("warn", `files.${event}`, "文件保存的收尾出错", {}, error)});
    if ("ok" in root) throw new Error(`${scheme}:// 的根不可用：${root.detail}`);
    const service = createFilesService({root, diagnose: (event, detail, cause) => record("warn", event, detail, {cause})});
    const changes = createChangeHub({root, controlDirectory: placed.options.controlDirectory, clock: context.services.require(clockKey), record});
    context.scope.register({kind: "files-changes", label: `${descriptor.id} ${scheme}`, value: changes, release: (value) => value.close()});
    const diagnose = (event: string, detail: string, cause: string): void => record("warn", event, detail, {cause});
    const operations = createOperations({root, changes, diagnose});
    const batch = createBatch({
        root,
        changes,
        diagnose,
        stopped: (operation, detail) => record("info", "files.batch.stopped", detail, {operation}),
    });
    const report = (event: string, error: unknown): void => record("warn", `files.${event}`, "暂存文件的收尾出错", {}, error);
    const ledger = new LedgerSlot({root: scheme, clock: context.services.require(clockKey), record});
    // 项目的暂存目录在根的真实路径下（`.nbook/staging/`）；`user://` 的在状态根下，不在根里。
    const staging = await ensureStagingDirectory(placed.staging.base ?? root.real, placed.staging.segments);
    let commit: StagingCommit | null = null;
    if (staging.ok) {
        await sweepStaging(staging.path, report);
        commit = createStagingCommitter({root, directory: staging.path, changes, ledger, report});
    } else {
        record("warn", "files.staging.unavailable", "暂存目录不可用，写入接口的提交会失败", {detail: staging.detail});
    }
    const backend: Backend = {root, service, operations, batch, changes, scope: context.scope, commit, stagingDirectory: staging.ok ? staging.path : null, ledger};
    const reportStage = (event: string, error: unknown): void => record("warn", `files.${event}`, "写入接口的收尾出错", {}, error);
    return {root, record, backend, reportStage};
}

/**
 * 服务端入口：`user://`（根是 `<状态根>/user/`），另在 HTTP 端口上按地址给出字节（`raw-route.ts`），它要找到项目目录，
 * 所以多依赖项目登记（可选）。启动即激活：根不可用在启动时就有诊断。
 */
const serverEntry = defineEntry({
    id: "server",
    location: "server",
    activationEvents: ["onStartup"],
    // 项目登记只有服务端宿主提供；只装了文件服务的实例（测试场地）里没有它，项目的字节地址随之不可用。
    dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: stateRootKey}, {key: projectsKey, required: false}],
    contributions: [{capability: HTTP_ROUTES_POINT, id: descriptor.id, declaration: {}}],
    provides: [workspaceFilesKey],
    remoteProvides: [userFilesContract, filesPreviewContract],
    receives: [SCHEMES_POINT, LEDGER_POINT],
    activate: async (context) => {
        const state = context.services.require(stateRootKey).path;
        const path = join(state, "user");
        await mkdir(path, {recursive: true});
        const {root, record, backend, reportStage} = await openBackend(context, "user", {path, options: {controlDirectory: false, lockDirectory: join(state, "locks", "user-files")}, staging: {base: state, segments: ["staging"]}});
        const schemes = new SchemeRegistry({scope: context.scope, clock: context.services.require(clockKey), lockRoot: join(state, "locks", "schemes"), staging: backend.stagingDirectory, record});
        context.onStop(() => schemes.stop());
        const projects = await context.services.resolve(projectsKey);
        const registry = projects.status === "resolved" ? projects.instance : null;
        const tokens = createPreviewTokens();
        const routes = createRawRoutes({projects: registry, user: root, tokens, record: (event, detail, error) => record("warn", event, detail, {}, error)});
        // 每个调用方（一个窗口里的一个入口）一份门面，记着它签发的令牌；门面释放时全部作废，并关上签发：运行时释放门面
        // 不等在途的调用，`open` 等登记查询回来时门面可能已经释放，那时签的令牌没人能撤回。
        const issued = new WeakMap<object, {readonly tokens: Set<string>; released: boolean}>();
        const preview = provideRemote(filesPreviewContract, () => {
            const state = {tokens: new Set<string>(), released: false};
            const mine = state.tokens;
            const facade = {methods: {
                open: async ({project, generation, network}: {readonly project: string; readonly generation: number; readonly network: boolean}) => {
                    if (registry === null) return {ok: false as const, code: "unavailable-project" as const, detail: {detail: "这个实例没有项目登记"}};
                    const listed = await registry.list();
                    const running = listed.ok ? listed.value.find((item) => item.id === project) : undefined;
                    if (running === undefined || running.generation !== generation) return {ok: false as const, code: "generation-gone" as const, detail: {detail: `作品 ${project} 的第 ${String(generation)} 代不在运行`}};
                    if (state.released) return {ok: false as const, code: "unavailable-project" as const, detail: {detail: "调用方已经断开"}};
                    const token = tokens.issue(project, generation, network);
                    mine.add(token);
                    return {ok: true as const, value: {token, base: `${PREVIEW_PREFIX}${token}/`}};
                },
                close: async ({token}: {readonly token: string}) => {
                    // 只作废自己签发的：别的窗口的令牌不归它。
                    if (mine.delete(token)) tokens.revoke(token);
                    return {ok: true as const, value: {}};
                },
            }};
            issued.set(facade, state);
            return facade;
        }, {release: (facade) => {
            const state = issued.get(facade);
            if (state === undefined) return;
            state.released = true;
            for (const token of state.tokens) tokens.revoke(token);
        }});
        const workspaceDeps = {own: {scheme: "user", root: backend}, registry: schemes, projects: registry === null ? null : createProjectsAccess(registry, context.remote), signal: context.signal, sourceOf, report: reportStage} as const;
        const ownFiles = ownWorkspaceFiles(workspaceDeps, {instanceId: "nbook.files/http", location: "server", client: null, plugin: descriptor.id, entry: "server", generation: null, via: null});
        addThemeAssetRoutes(routes, {userRoot: root.real, write: (address, bytes) => ownFiles.write(address, bytes, {expect: "absent", createParents: true}), delete: (items) => ownFiles.delete(items)});
        return {
            services: [
                provideWorkspaceFiles(workspaceDeps),
            ],
            remote: [provideRemote(userFilesContract, (consumer) => implementation(backend, consumer)), preview],
            contributions: {[HTTP_ROUTES_POINT]: {[descriptor.id]: routes}},
            receivers: {[SCHEMES_POINT]: schemes.receiver, [LEDGER_POINT]: backend.ledger.receiver},
        };
    },
});

/** 项目入口：`project://`，根是本项目代次的项目目录，`.nbook/` 是控制目录。 */
const projectEntry = defineEntry({
    id: "project",
    location: "project",
    activationEvents: ["onStartup"],
    dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: currentProjectKey}],
    provides: [workspaceFilesKey],
    remoteProvides: [projectFilesContract],
    receives: [LEDGER_POINT],
    activate: async (context) => {
        const path = context.services.require(currentProjectKey).root;
        const {backend, reportStage} = await openBackend(context, "project", {path, options: {controlDirectory: true, lockDirectory: join(path, ".nbook", "locks", "files")}, staging: {segments: [".nbook", "staging"]}});
        return {
            services: [provideWorkspaceFiles({own: {scheme: "project", root: backend}, registry: null, projects: null, signal: context.signal, sourceOf, report: reportStage})],
            remote: [provideRemote(projectFilesContract, (consumer) => implementation(backend, consumer))],
            receivers: {[LEDGER_POINT]: backend.ledger.receiver},
        };
    },
});

function recordTo(diagnostics: DiagnosticsService) {
    return (level: "info" | "warn", event: string, message: string, data: unknown, error?: unknown): void => {
        diagnostics.record({level, event, message, data, ...(error === undefined ? {} : {error}), source: {plugin: descriptor.id}});
    };
}

export const filesBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [schemesPoint, ledgerPoint],
    entries: [serverEntry, projectEntry],
};
