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
import type {ChangeSource, FilesContract} from "../shared/contracts";
import {createChangeHub} from "./changes";
import type {ChangeHub} from "./changes";
import {createFilesService} from "./files-service";
import type {FilesService} from "./files-service";
import {createBatch} from "./batch";
import type {Batch, BatchControl} from "./batch";
import {createOperations} from "./operations";
import type {Operations} from "./operations";
import {createPreviewTokens, createRawRoutes, PREVIEW_PREFIX} from "./raw-route";
import {SCHEMES_POINT, schemesPoint, serverFilesKey} from "../shared/schemes";
import {saveText, tracked} from "./execute";
import {SchemeRegistry} from "./registry";
import {provideServerFiles} from "./server-files";
import {openRoot} from "./rooted";
import type {RootedRoot, RootOptions} from "./rooted";

/** 写入来源按调用方身份：窗口里的插件是写作者，服务端与项目实例里的插件是系统（resources.md 的“写入来源”）。 */
export function sourceOf(consumer: ConsumerIdentity): ChangeSource {
    return consumer.location === "browser" || consumer.location === "tui" ? {kind: "user", plugin: consumer.plugin} : {kind: "system", plugin: consumer.plugin};
}

/**
 * 写方法的 `as`（转发来的来源）只认服务端位置的 `nbook.files`（`projects://` 的转发，resources.md 的“写入来源”）；别的调用方
 * 带了按无权拒绝。远程提供方不能交回路由层的 `invalid-input`，所以用业务码 `permission-denied`。
 */
function sourceFor(consumer: ConsumerIdentity, as: ChangeSource | undefined): ChangeSource | {readonly ok: false; readonly code: "permission-denied"; readonly detail: {readonly detail: string}} {
    if (as === undefined) return sourceOf(consumer);
    if (consumer.location === "server" && consumer.plugin === descriptor.id) return as;
    return {ok: false, code: "permission-denied", detail: {detail: "只有服务端的文件服务可以转发写入来源"}};
}

interface Backend {
    readonly root: RootedRoot;
    readonly service: FilesService;
    readonly operations: Operations;
    readonly batch: Batch;
    readonly changes: ChangeHub;
    readonly scope: Scope;
}

/** 两份合同的方法与事件相同，实现也相同；`consumer` 是内核填写的调用方身份，写入来源由它确定。 */
function implementation(backend: Backend, consumer: ConsumerIdentity): RemoteImplementation<typeof userFilesContract> {
    const {service, operations, batch, changes, scope} = backend;
    const source = sourceOf(consumer);
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
            read: (input) => service.read(input.path),
            realPath: (input) => service.realPath(input.path),
            write: async (input) => {
                const writer = sourceFor(consumer, input.as);
                return "ok" in writer ? writer : saveText(backend, input.path, input.text, input.baseline, writer);
            },
            identify: (input) => operations.identify(input.paths),
            create: async (input) => {
                const writer = sourceFor(consumer, input.as);
                return "ok" in writer ? writer : tracked(scope, "files.create", () => operations.create(input, writer));
            },
            createContent: (input) => tracked(scope, "files.create-content", () => operations.createContent(input, source)),
            rename: (input) => tracked(scope, "files.rename", () => operations.rename(input, source)),
            convert: (input) => tracked(scope, "files.convert", () => operations.convert(input, source)),
            reorder: (input) => tracked(scope, "files.reorder", () => operations.reorder(input, source)),
            display: (input) => tracked(scope, "files.display", () => operations.display(input, source)),
            include: (input) => tracked(scope, "files.include", () => operations.include(input, source)),
            drop: (input) => tracked(scope, "files.drop", () => operations.drop(input, source)),
            move: (input, {signal}) => run(input.operation, signal, "files.move", (control) => batch.transfer("move", input, source, control)),
            copy: (input, {signal}) => run(input.operation, signal, "files.copy", (control) => batch.transfer("copy", input, source, control)),
            delete: (input, {signal}) => run(input.operation, signal, "files.delete", (control) => batch.remove(input, source, control)),
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
async function openBackend(context: ActivationContext, scheme: "user" | "project", placed: {readonly path: string; readonly options: Omit<RootOptions, "report">}) {
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
    const backend: Backend = {root, service, operations, batch, changes, scope: context.scope};
    return {root, record, backend};
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
    provides: [serverFilesKey],
    remoteProvides: [userFilesContract, filesPreviewContract],
    receives: [SCHEMES_POINT],
    activate: async (context) => {
        const state = context.services.require(stateRootKey).path;
        const path = join(state, "user");
        await mkdir(path, {recursive: true});
        const {root, record, backend} = await openBackend(context, "user", {path, options: {controlDirectory: false, lockDirectory: join(state, "locks", "user-files")}});
        const schemes = new SchemeRegistry({scope: context.scope, clock: context.services.require(clockKey), lockRoot: join(state, "locks", "schemes"), record});
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
        return {
            services: [provideServerFiles({user: backend, registry: schemes, projects: null, signal: context.signal, sourceOf})],
            remote: [provideRemote(userFilesContract, (consumer) => implementation(backend, consumer)), preview],
            contributions: {[HTTP_ROUTES_POINT]: {[descriptor.id]: routes}},
            receivers: {[SCHEMES_POINT]: schemes.receiver},
        };
    },
});

/** 项目入口：`project://`，根是本项目代次的项目目录，`.nbook/` 是控制目录。 */
const projectEntry = defineEntry({
    id: "project",
    location: "project",
    activationEvents: ["onStartup"],
    dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: currentProjectKey}],
    remoteProvides: [projectFilesContract],
    activate: async (context) => {
        const path = context.services.require(currentProjectKey).root;
        const {backend} = await openBackend(context, "project", {path, options: {controlDirectory: true, lockDirectory: join(path, ".nbook", "locks", "files")}});
        return {remote: [provideRemote(projectFilesContract, (consumer) => implementation(backend, consumer))]};
    },
});

function recordTo(diagnostics: DiagnosticsService) {
    return (level: "info" | "warn", event: string, message: string, data: unknown, error?: unknown): void => {
        diagnostics.record({level, event, message, data, ...(error === undefined ? {} : {error}), source: {plugin: descriptor.id}});
    };
}

export const filesBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [schemesPoint],
    entries: [serverEntry, projectEntry],
};
