/**
 * 写入接口 `workspaceFilesKey`（docs/specs/workspace/resources.md 的“写入接口”）：服务端按调用方门面，按全局地址分派到
 * `user://`、`projects://` 与已注册的方案。
 *
 * - 读：取得本机读路径后在本进程里读，`projects://` 不经项目合同传内容；虚拟根交回提供者生成的文字。
 * - 写：在根的暂存目录里建暂存文件（`staging.ts`）、交给写入函数写完、`fsync`，再提交一次：`user://` 在本进程里，
 *   挂载方案借用挂载点提交，`projects://` 在一次租约里调项目合同的 `commit`。结算见 `settle`。
 * - 来源按调用方身份；`as` 只认服务端的 `nbook.agent`；`group` 由门面带上，经它的调用都带同一个组。
 */

import {createHash, randomUUID} from "node:crypto";
import {open} from "node:fs/promises";
import type {FileHandle} from "node:fs/promises";

import {provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {ProvidedService} from "@notnotype/nb-runtime/plugins";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import {errno} from "nbook/backend/locked-replace";

import type {Baseline, BatchResult, ChangeGroup, ChangeSource, Identified, Listing, OperationDone} from "../shared/contracts";
import {parseAddress} from "../shared/resource";
import type {Address} from "../shared/resource";
import {renderVirtual} from "../shared/schemes";
import {decodeText} from "../shared/text";
import type {SchemeCaller, ServerFilesResult} from "../shared/schemes";
import {workspaceFilesKey} from "../shared/workspace-files";
import type {CallOptions, CommitOptions, ReadPath, StagedSink, WorkspaceFiles} from "../shared/workspace-files";
import type {Batch} from "./batch";
import type {Origin} from "./changes";
import {toResult, tracked} from "./execute";
import type {WriteTarget} from "./execute";
import {hashOf} from "./files-service";
import type {Operations} from "./operations";
import type {ProjectsAccess} from "./projects-scheme";
import type {SchemeRegistry} from "./registry";
import {createStage, ensureStagingDirectory, KEEP_BYTES} from "./staging";
import type {CommitInput, Stage, StagingCommit} from "./staging";

const AGENT_PLUGIN = "nbook.agent";
/** `update` 冲突时重读重算的次数。 */
const UPDATE_ATTEMPTS = 3;

/** 本进程拥有的根（服务端的 `user://`、项目实例的 `project://`）：`plugin.ts` 的后端。 */
export interface LocalRoot extends WriteTarget {
    readonly operations: Operations;
    readonly batch: Batch;
    readonly commit: StagingCommit | null;
    readonly stagingDirectory: string | null;
}

export interface WorkspaceFilesDeps {
    /** 本进程拥有的根与它的方案名。 */
    readonly own: {readonly scheme: "user" | "project"; readonly root: LocalRoot};
    /** 已注册的挂载方案；项目实例里没有。 */
    readonly registry: SchemeRegistry | null;
    readonly projects: ProjectsAccess | null;
    /** 提供入口的停止信号：入口停止时在途调用一并中止。 */
    readonly signal: AbortSignal;
    readonly sourceOf: (consumer: ConsumerIdentity) => ChangeSource;
    readonly report: (event: string, error: unknown) => void;
}

type Result<T> = ServerFilesResult<T>;
type Fail = Extract<Result<never>, {ok: false}>;
const fail = (code: Fail["code"], detail: string): Fail => ({ok: false, code, detail});

/** 一次已接纳的调用：地址、调用方、归属与终止信号。 */
interface Request {
    readonly address: Address;
    readonly caller: SchemeCaller;
    readonly origin: Origin;
    readonly signal: AbortSignal;
}

/** 提交暂存的一个目标：暂存放在哪里、怎样提交。 */
interface StagingTarget {
    readonly directory: string;
    readonly commit: (input: Omit<CommitInput, "path">) => Promise<Result<{readonly baseline: Baseline}>>;
}

export function provideWorkspaceFiles(deps: WorkspaceFilesDeps): ProvidedService<WorkspaceFiles> {
    const released = new WeakMap<object, AbortController>();
    return provideServicePerConsumer(workspaceFilesKey, (consumer) => {
        // 门面释放（调用方入口停止）时中止它在途的调用；分组的门面共用这一个。
        const gone = new AbortController();
        const facade = facadeFor(deps, consumer, gone.signal, undefined);
        released.set(facade, gone);
        return facade;
    }, {release: (facade) => {
        released.get(facade)?.abort();
    }});
}

function facadeFor(deps: WorkspaceFilesDeps, consumer: ConsumerIdentity, gone: AbortSignal, group: ChangeGroup | undefined): WorkspaceFiles {
    const {own, projects} = deps;
    const user = own.root;
    const mountedOf = (scheme: string) => deps.registry?.get(scheme) ?? null;
    const unknown = (scheme: string): Fail => fail("unknown-scheme", `没有方案 ${scheme}://`);

    const begin = (address: string, options: CallOptions | undefined): Request | Fail => {
        const parsed = parseAddress(address);
        if (!parsed.ok) return fail(parsed.code, parsed.detail);
        const agent = options?.as?.agent ?? null;
        if (agent !== null && !(consumer.location === "server" && consumer.plugin === AGENT_PLUGIN)) return fail("invalid-input", "只有服务端的 nbook.agent 可以注明代表哪个会话");
        const signal = AbortSignal.any([gone, deps.signal, ...(options?.signal === undefined ? [] : [options.signal])]);
        if (signal.aborted) return fail("cancelled", "调用已取消");
        const source: ChangeSource = agent === null ? deps.sourceOf(consumer) : {kind: "agent", session: agent.session, ...(agent.entry === undefined ? {} : {entry: agent.entry})};
        return {address: parsed.address, caller: {consumer, agent: agent === null ? null : {session: agent.session, profile: agent.profile}}, origin: group === undefined ? {source} : {source, group}, signal};
    };
    /** 项目合同的写方法要带的 `as` 与 `group`。 */
    const forwarded = (request: Request) => ({as: request.origin.source, ...(request.origin.group === undefined ? {} : {group: request.origin.group})});

    /** `forRead`：`read` 取字节前的定位，挂载方案里不建目录。 */
    const readPath = async (request: Request, forRead = false): Promise<Result<ReadPath>> => {
        const {scheme, path} = request.address;
        if (scheme === own.scheme) {
            const target = await user.root.resolveForRead(path);
            return "ok" in target ? fail(target.code, target.detail) : {ok: true, value: {path: target.absolute, kind: target.kind}};
        }
        if (scheme === "projects") {
            if (projects === null) return unknown(scheme);
            if (path === "") return fail("unsupported-capability", "projects:// 是虚拟目录，没有真实路径");
            return projects.call(path, request.signal, (client, inner) => client.realPath({path: inner, follow: true}, {signal: request.signal}));
        }
        return mountedOf(scheme)?.readTarget(path, request.caller, request.signal, forRead ? "read" : "realPath") ?? unknown(scheme);
    };

    /** 虚拟根的文字：`projects://` 的根与挂载方案的根；别的地址为 null。 */
    const virtualText = async (request: Request): Promise<Result<string> | null> => {
        const {scheme, path} = request.address;
        if (path !== "") return null;
        if (scheme === "projects" && projects !== null) {
            const listed = await projects.virtual();
            return listed.ok ? {ok: true, value: renderVirtual(listed.value)} : listed;
        }
        const mounted = mountedOf(scheme);
        if (mounted === null) return null;
        const read = await mounted.read(path, request.caller, request.signal);
        return read.ok ? {ok: true, value: read.value.text} : read;
    };

    const readBytes = async (request: Request): Promise<Result<{readonly bytes: Uint8Array; readonly baseline: Baseline}>> => {
        const virtual = await virtualText(request);
        if (virtual !== null) {
            if (!virtual.ok) return virtual;
            const bytes = new TextEncoder().encode(virtual.value);
            return {ok: true, value: {bytes, baseline: {hash: hashOf(bytes)}}};
        }
        const located = await readPath(request, true);
        if (!located.ok) return located;
        if (located.value.kind !== "file") return fail("not-a-file", `${formatAddress(request.address)} 不是普通文件`);
        return readLocal(located.value.path, formatAddress(request.address), deps.report);
    };

    const stagingTarget = async (request: Request): Promise<Result<StagingTarget>> => {
        const {scheme, path} = request.address;
        if (scheme === own.scheme) {
            const {commit, stagingDirectory} = user;
            if (commit === null || stagingDirectory === null) return fail("io-failed", "暂存目录不可用");
            return {ok: true, value: {directory: stagingDirectory, commit: async (input) => toResult(await tracked(user.scope, "files.commit", () => commit({...input, path}, request.origin)))}};
        }
        if (scheme === "projects") {
            if (projects === null) return unknown(scheme);
            if (path === "") return fail("permission-denied", "projects:// 是只读的目录");
            const located = await projects.locate(path);
            if (!located.ok) return located;
            const directory = await ensureStagingDirectory(located.value.record.path, [".nbook", "staging"]);
            if (!directory.ok) return fail("io-failed", directory.detail);
            return {ok: true, value: {directory: directory.path, commit: (input) => projects.call(path, request.signal, (client, inner) => client.commit({...input, path: inner, ...forwarded(request)}, {signal: request.signal}))}};
        }
        const mounted = mountedOf(scheme);
        if (mounted === null) return unknown(scheme);
        const directory = user.stagingDirectory;
        if (directory === null) return fail("io-failed", "暂存目录不可用");
        return {ok: true, value: {directory, commit: (input) => mounted.commit(path, input, request.caller, request.origin, request.signal)}};
    };

    const stage = async (request: Request, write: (sink: StagedSink) => Promise<void>, options: CommitOptions): Promise<Result<{readonly baseline: Baseline}>> => {
        const target = await stagingTarget(request);
        if (!target.ok) return target;
        const created = await createStage(target.value.directory, deps.report);
        if (!created.ok) return fail("io-failed", created.detail);
        const {stage: staged} = created;
        const written = await fill(staged, write, request.signal, deps.report);
        if (!written.ok) {
            await staged.discard();
            return written;
        }
        if (request.signal.aborted) {
            await staged.discard();
            return fail("cancelled", "调用已取消");
        }
        return settle(staged, await target.value.commit({stage: staged.name, hash: written.value, expect: options.expect, ...(options.createParents === undefined ? {} : {createParents: options.createParents})}));
    };

    const write = (request: Request, content: Uint8Array | string, options: CommitOptions) => {
        const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
        return stage(request, (sink) => sink.write(bytes), options);
    };

    /** 文件操作的公共分派：`user://` 进程内，`projects://` 经项目合同，挂载方案只有新建。 */
    const operate = async <T>(address: string, options: CallOptions | undefined, local: (path: string, origin: Origin) => Promise<Result<T>>, remote: (path: string, request: Request, projects: ProjectsAccess) => Promise<Result<T>>): Promise<Result<T>> => {
        const started = begin(address, options);
        if ("ok" in started) return started;
        const {scheme, path} = started.address;
        if (scheme === own.scheme) return local(path, started.origin);
        if (scheme === "projects") {
            if (projects === null) return unknown(scheme);
            if (path === "") return fail("permission-denied", "projects:// 是只读的目录");
            return remote(path, started, projects);
        }
        return mountedOf(scheme) === null ? unknown(scheme) : fail("unsupported-capability", `${scheme}:// 不支持这个文件操作`);
    };

    const local = <T>(label: string, run: () => Promise<Parameters<typeof toResult<T>>[0]>): Promise<Result<T>> => tracked(user.scope, label, run).then(toResult);

    /** 批量：全部项必须同一方案（`projects://` 还要同一个项目），路径按方案拆好。 */
    const batch = async <I extends object>(items: ReadonlyArray<I>, addressesOf: (item: I) => readonly string[], options: CallOptions | undefined, run: {
        readonly local: (paths: ReadonlyArray<I>, origin: Origin, signal: AbortSignal) => Promise<Result<BatchResult>>;
        readonly remote: (paths: ReadonlyArray<I>, request: Request, project: string, projects: ProjectsAccess) => Promise<Result<BatchResult>>;
    }, rewrite: (item: I, map: (address: string) => string) => I): Promise<Result<BatchResult>> => {
        const first = items[0];
        if (first === undefined) return {ok: true, value: {items: [], manifests: []}};
        const started = begin(addressesOf(first)[0] as string, options);
        if ("ok" in started) return started;
        const {scheme} = started.address;
        const project = scheme === "projects" ? started.address.path.split("/")[0] as string : null;
        const prefix = scheme === "projects" ? `${project ?? ""}/` : "";
        const paths: I[] = [];
        for (const item of items) {
            for (const address of addressesOf(item)) {
                const parsed = parseAddress(address);
                if (!parsed.ok) return fail(parsed.code, parsed.detail);
                if (parsed.address.scheme !== scheme || (prefix !== "" && !parsed.address.path.startsWith(prefix))) return fail("invalid-input", "一次批量的源与目标必须在同一方案（同一个项目）里");
            }
            paths.push(rewrite(item, (address) => {
                const parsed = parseAddress(address);
                return parsed.ok ? parsed.address.path.slice(prefix.length) : address;
            }));
        }
        if (scheme === own.scheme) return run.local(paths, started.origin, started.signal);
        if (scheme === "projects") {
            if (projects === null) return unknown(scheme);
            return run.remote(paths, started, project ?? "", projects);
        }
        return mountedOf(scheme) === null ? unknown(scheme) : fail("unsupported-capability", `${scheme}:// 不支持这个文件操作`);
    };
    /** 一次本地批量：操作 id 同时用作诊断里的标识。 */
    const localBatch = <T>(label: string, signal: AbortSignal, run: (operation: string, batchControl: {operation: string; cancelled: boolean; signal: AbortSignal}) => Promise<Parameters<typeof toResult<T>>[0]>): Promise<Result<T>> => {
        const operation = randomUUID();
        return local(label, () => run(operation, {operation, cancelled: false, signal}));
    };

    const facade: WorkspaceFiles = {
        read: async (address, options) => {
            const started = begin(address, options);
            return "ok" in started ? started : readBytes(started);
        },
        readPath: async (address, options) => {
            const started = begin(address, options);
            return "ok" in started ? started : readPath(started);
        },
        list: async (address, options) => {
            const started = begin(address, options);
            if ("ok" in started) return started;
            const {address: {scheme, path}} = started;
            if (scheme === own.scheme) return toResult(await user.service.list(path));
            if (scheme === "projects") {
                if (projects === null) return unknown(scheme);
                return path === "" ? projects.virtual() : projects.call<Listing>(path, started.signal, (client, inner) => client.list({path: inner}, {signal: started.signal}));
            }
            return mountedOf(scheme)?.list(path, started.caller, started.signal) ?? unknown(scheme);
        },
        stage: async (address, run, options) => {
            const started = begin(address, options);
            return "ok" in started ? started : stage(started, run, options);
        },
        write: async (address, content, options) => {
            const started = begin(address, options);
            return "ok" in started ? started : write(started, content, options);
        },
        update: async (address, edit, options) => {
            const started = begin(address, options);
            if ("ok" in started) return started;
            for (let attempt = 1; ; attempt += 1) {
                const read = await readBytes(started);
                if (!read.ok) return read;
                const text = decodeText(read.value.bytes);
                if (text === null) return fail("not-text", `${formatAddress(started.address)} 不是 UTF-8 文本`);
                const written = await write(started, edit(text), {...options, expect: read.value.baseline});
                if (written.ok || written.code !== "conflict" || attempt >= UPDATE_ATTEMPTS) return written;
            }
        },

        identify: async (addresses, options) => {
            const first = addresses[0];
            if (first === undefined) return {ok: true, value: {items: []}};
            return operate<Identified>(first, options, async () => {
                const paths = addresses.map((address) => {
                    const parsed = parseAddress(address);
                    return parsed.ok && parsed.address.scheme === own.scheme ? parsed.address.path : null;
                });
                if (paths.includes(null)) return fail("invalid-input", "一次身份查询的地址必须在同一方案里");
                return toResult(await user.operations.identify(paths as string[]));
            }, async (path, request, access) => {
                const project = path.split("/")[0] as string;
                const inner = addresses.map((address) => {
                    const parsed = parseAddress(address);
                    return parsed.ok && parsed.address.scheme === "projects" && parsed.address.path.startsWith(`${project}/`) ? parsed.address.path.slice(project.length + 1) : null;
                });
                if (inner.includes(null)) return fail("invalid-input", "一次身份查询的地址必须在同一个项目里");
                return access.call<Identified>(project, request.signal, (client) => client.identify({paths: inner as string[]}, {signal: request.signal}));
            });
        },
        create: (address, kind, options) => {
            const started = begin(address, options);
            if ("ok" in started) return Promise.resolve(started);
            const mounted = mountedOf(started.address.scheme);
            if (mounted !== null) return mounted.create(started.address.path, kind, started.caller, started.origin.source, started.signal);
            const before = options?.before === undefined ? {} : {before: options.before};
            return operate<OperationDone>(address, options, (path, origin) => local("files.create", () => user.operations.create({path, kind, ...before}, origin)), (path, request, access) => access.call(path, request.signal, (client, inner) => client.create({path: inner, kind, ...before, ...forwarded(request)}, {signal: request.signal})));
        },
        createContent: (address, options) => operate<OperationDone>(address, options, (path, origin) => local("files.create-content", () => user.operations.createContent({path}, origin)), (path, request, access) => access.call(path, request.signal, (client, inner) => client.createContent({path: inner, ...forwarded(request)}, {signal: request.signal}))),
        rename: (address, name, options) => {
            const expected = options?.expected === undefined ? {} : {expected: options.expected};
            return operate<OperationDone>(address, options, (path, origin) => local("files.rename", () => user.operations.rename({path, name, ...expected}, origin)), (path, request, access) => access.call(path, request.signal, (client, inner) => client.rename({path: inner, name, ...expected, ...forwarded(request)}, {signal: request.signal})));
        },
        convert: (address, to, options) => {
            const expected = options?.expected === undefined ? {} : {expected: options.expected};
            return operate<OperationDone>(address, options, (path, origin) => local("files.convert", () => user.operations.convert({path, to, ...expected}, origin)), (path, request, access) => access.call(path, request.signal, (client, inner) => client.convert({path: inner, to, ...expected, ...forwarded(request)}, {signal: request.signal})));
        },
        reorder: (directory, names, options) => operate<OperationDone>(directory, options, (path, origin) => local("files.reorder", () => user.operations.reorder({directory: path, names}, origin)), (path, request, access) => access.call(path, request.signal, (client, inner) => client.reorder({directory: inner, names: [...names], ...forwarded(request)}, {signal: request.signal}))),
        display: (address, display, options) => operate<OperationDone>(address, options, (path, origin) => local("files.display", () => user.operations.display({path, ...display}, origin)), (path, request, access) => access.call(path, request.signal, (client, inner) => client.display({path: inner, ...display, ...forwarded(request)}, {signal: request.signal}))),
        include: (address, options) => {
            const before = options?.before === undefined ? {} : {before: options.before};
            return operate<OperationDone>(address, options, (path, origin) => local("files.include", () => user.operations.include({path, ...before}, origin)), (path, request, access) => access.call(path, request.signal, (client, inner) => client.include({path: inner, ...before, ...forwarded(request)}, {signal: request.signal})));
        },
        drop: (address, options) => operate<OperationDone>(address, options, (path, origin) => local("files.drop", () => user.operations.drop({path}, origin)), (path, request, access) => access.call(path, request.signal, (client, inner) => client.drop({path: inner, ...forwarded(request)}, {signal: request.signal}))),
        move: (items, options) => batch(items, (item) => [item.source, item.target], options, {
            local: (paths, origin, signal) => localBatch("files.move", signal, (operation, batchControl) => user.batch.transfer("move", {operation, items: paths}, origin, batchControl)),
            remote: (paths, request, project, access) => access.call(project, request.signal, (client) => client.move({operation: randomUUID(), items: paths.map((item) => ({...item})), ...forwarded(request)}, {signal: request.signal})),
        }, (item, map) => ({...item, source: map(item.source), target: map(item.target)})),
        copy: (items, options) => batch(items, (item) => [item.source, item.target], options, {
            local: (paths, origin, signal) => localBatch("files.copy", signal, (operation, batchControl) => user.batch.transfer("copy", {operation, items: paths}, origin, batchControl)),
            remote: (paths, request, project, access) => access.call(project, request.signal, (client) => client.copy({operation: randomUUID(), items: paths.map((item) => ({...item})), ...forwarded(request)}, {signal: request.signal})),
        }, (item, map) => ({...item, source: map(item.source), target: map(item.target)})),
        delete: (items, options) => batch(items, (item) => [item.address], options, {
            local: (paths, origin, signal) => localBatch("files.delete", signal, (operation, batchControl) => user.batch.remove({operation, items: paths.map(({address, ...rest}) => ({path: address, ...rest}))}, origin, batchControl)),
            remote: (paths, request, project, access) => access.call(project, request.signal, (client) => client.delete({operation: randomUUID(), items: paths.map(({address, ...rest}) => ({path: address, ...rest})), ...forwarded(request)}, {signal: request.signal})),
        }, (item, map) => ({...item, address: map(item.address)})),

        group: (info, run) => run(facadeFor(deps, consumer, gone, {id: randomUUID(), title: info.title, ...(info.note === undefined ? {} : {note: info.note})})),
    };
    return facade;
}

/** 把写入函数的内容写进暂存文件：边写边算哈希，写完 `fsync`。交回新内容的哈希。 */
async function fill(staged: Stage, write: (sink: StagedSink) => Promise<void>, signal: AbortSignal, report: (event: string, error: unknown) => void): Promise<Result<string>> {
    let handle: FileHandle;
    try {
        handle = await open(staged.path, "r+");
    } catch (error) {
        return fail("io-failed", `无法打开暂存文件：${String(errno(error) ?? error)}`);
    }
    const hasher = createHash("sha256");
    let closed = false;
    const sink: StagedSink = {
        write: async (chunk) => {
            if (closed) throw new Error("暂存文件已经结束写入");
            if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("调用已取消");
            let offset = 0;
            while (offset < chunk.length) {
                const {bytesWritten} = await handle.write(chunk, offset);
                offset += bytesWritten;
            }
            hasher.update(chunk);
        },
    };
    try {
        await write(sink);
        await handle.sync();
    } catch (error) {
        if (signal.aborted) return fail("cancelled", "调用已取消");
        report("stage.write-failed", error);
        return fail("io-failed", `写入暂存文件失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
        closed = true;
        await handle.close();
    }
    return {ok: true, value: hasher.digest("hex")};
}

/**
 * 提交的结算（docs/specs/workspace/resources.md 的“暂存与提交”）：成功时暂存已被消费，只放活性锁；结果不确定时拥有根的
 * 进程可能还在消费它，同样只放锁、不删（之后由它在锁里消费或下次打开根时清理）；别的失败暂存没被动过，删掉再放锁。
 */
async function settle(staged: Stage, result: Result<{readonly baseline: Baseline}>): Promise<Result<{readonly baseline: Baseline}>> {
    if (result.ok || result.code === "unknown-outcome") await staged.release();
    else await staged.discard();
    return result;
}

/** 在本进程里读一个真实文件：用打开的句柄核对类型与大小。 */
async function readLocal(path: string, label: string, report: (event: string, error: unknown) => void): Promise<Result<{readonly bytes: Uint8Array; readonly baseline: Baseline}>> {
    let handle: FileHandle;
    try {
        handle = await open(path, "r");
    } catch (error) {
        const code = errno(error);
        if (code === "ENOENT" || code === "ENOTDIR") return fail("not-found", `${label} 不存在`);
        if (code === "EACCES" || code === "EPERM") return fail("permission-denied", `无权读取 ${label}`);
        return fail("io-failed", `读取 ${label} 失败`);
    }
    try {
        const info = await handle.stat();
        if (!info.isFile()) return fail("not-a-file", `${label} 不是普通文件`);
        if (info.size > KEEP_BYTES) return fail("too-large", `${label} 有 ${String(info.size)} 字节，超过 32 MB`);
        const bytes = new Uint8Array(await handle.readFile());
        return {ok: true, value: {bytes, baseline: {hash: hashOf(bytes)}}};
    } catch (error) {
        report("read.failed", error);
        return fail("io-failed", `读取 ${label} 失败`);
    } finally {
        await handle.close();
    }
}

function formatAddress(address: Address): string {
    return `${address.scheme}://${address.path}`;
}
