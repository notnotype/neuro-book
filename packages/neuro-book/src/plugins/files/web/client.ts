/**
 * 浏览器里的文件客户端（`filesKey` 的门面，docs/specs/workspace/resources.md）：按资源地址的方案选合同，以原调用方的
 * 身份（`context.remote.on(调用方)`）经代理发出，提供者据此确定写入来源。结果原样带码：业务失败与路由层失败
 * （目标不在、项目代次结束、写请求结果未知等）都不转成空结果。
 */

import type {ActivationContext} from "@notnotype/nb-runtime/plugins";
import type {RemoteFailure, RemoteFailureCode, RemoteResult, RemoteSubscribeOptions, RemoteSubscription} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import {encodedBytes, encodedTextBytes, FILES_FAILURES, MAX_OPERATION_ITEMS, parseResource, projectFilesContract, TEXT_BUDGET_BYTES, userFilesContract} from "../shared/contracts";
import type {Baseline, BatchHandle, BatchResult, BatchTransfer, ChangesMessage, FilesFailureCode, FilesResult, FilesService, OperationDone, Scheme, WatchMessage} from "../shared/contracts";

type Remote = ActivationContext["remote"];

/** 一个调用方的文件客户端与它的释放：释放时撤回它还没释放的 `watch`。 */
export interface FilesFacade {
    readonly service: FilesService;
    release(): void;
}

export function createFilesClient(remote: Remote, consumer: ConsumerIdentity, watches: WatchRegistry): FilesFacade {
    // 两份合同的方法相同；按方案分开取，客户端类型才精确。
    const client = (scheme: Scheme) => (scheme === "project" ? remote.on(consumer).use(projectFilesContract) : remote.on(consumer).use(userFilesContract));
    const releases = new Set<() => void>();
    /** 单个地址的写操作：解析地址、按方案发出、结果原样带码。 */
    const operate = async (address: string, call: (files: ReturnType<typeof client>, path: string) => Promise<RemoteResult<OperationDone, RemoteFailureCode | FilesFailureCode>>): Promise<FilesResult<OperationDone>> => {
        const parsed = parseResource(address);
        if (!parsed.ok) return parsed;
        const result = await call(client(parsed.resource.scheme), parsed.resource.path);
        return result.ok ? result : fromRemote(result);
    };
    /**
     * 一次批量：先核对方案，按客户端生成的操作 id 构造出要发出的完整请求，核对它编码后的大小，再发出这同一个请求；句柄的
     * `cancel` 带着同一个 id 与方案发往同一个提供者。核对不过时不发出，`cancel` 回答没有命中。
     */
    const batch = <I>(addresses: ReadonlyArray<string>, perItem: number, build: (operation: string, paths: ReadonlyArray<string>) => I, send: (files: ReturnType<typeof client>, input: I) => Promise<RemoteResult<BatchResult, RemoteFailureCode | FilesFailureCode>>): BatchHandle => {
        const checked = sameScheme(addresses, MAX_OPERATION_ITEMS * perItem);
        const refused = (failure: Extract<FilesResult<never>, {readonly ok: false}>): BatchHandle => ({result: Promise.resolve(failure), cancel: () => Promise.resolve({ok: true, value: {found: false}})});
        if (!checked.ok) return refused(checked);
        const operation = crypto.randomUUID();
        const input = build(operation, checked.paths);
        if (encodedBytes(input) > TEXT_BUDGET_BYTES) return refused(tooLarge);
        const files = client(checked.scheme);
        return {
            result: send(files, input).then((result) => (result.ok ? result : fromRemote(result))),
            cancel: async () => {
                const result = await files.cancel({operation});
                return result.ok ? result : fromRemote(result);
            },
        };
    };
    const service: FilesService = {
        list: async (address, options) => {
            const parsed = parseResource(address);
            if (!parsed.ok) return parsed;
            const result = await client(parsed.resource.scheme).list({path: parsed.resource.path}, options?.signal === undefined ? {} : {signal: options.signal});
            return result.ok ? result : fromRemote(result);
        },
        read: async (address, options) => {
            const parsed = parseResource(address);
            if (!parsed.ok) return parsed;
            const result = await client(parsed.resource.scheme).read({path: parsed.resource.path}, options?.signal === undefined ? {} : {signal: options.signal});
            return result.ok ? result : fromRemote(result);
        },
        write: async (address, text, baseline) => {
            const parsed = parseResource(address);
            if (!parsed.ok) return parsed;
            // 超过一条 RPC 消息的保存会被断开连接、成为结果未知：在发出前拒绝。
            if (encodedTextBytes(text) > TEXT_BUDGET_BYTES) return {ok: false, code: "too-large", detail: `${address} 的正文超过上限`};
            const result = await client(parsed.resource.scheme).write({path: parsed.resource.path, text, baseline});
            return result.ok ? result : fromRemote(result);
        },
        identify: async (addresses) => {
            const batch = sameScheme(addresses);
            if (!batch.ok) return batch;
            const input = {paths: [...batch.paths]};
            if (encodedBytes(input) > TEXT_BUDGET_BYTES) return tooLarge;
            const result = await client(batch.scheme).identify(input);
            return result.ok ? result : fromRemote(result);
        },
        create: (address, kind, options) => operate(address, (files, path) => files.create({path, kind, ...(options?.before === undefined ? {} : {before: options.before})})),
        createContent: (address) => operate(address, (files, path) => files.createContent({path})),
        rename: (address, name, options) => operate(address, (files, path) => files.rename({path, name, ...(options?.expected === undefined ? {} : {expected: options.expected})})),
        convert: (address, to, options) => operate(address, (files, path) => files.convert({path, to, ...(options?.expected === undefined ? {} : {expected: options.expected})})),
        reorder: async (directory, names) => {
            if (names.length > MAX_OPERATION_ITEMS) return tooLarge;
            return operate(directory, async (files, path) => {
                const input = {directory: path, names: [...names]};
                return encodedBytes(input) > TEXT_BUDGET_BYTES ? {ok: false, code: "too-large", detail: {detail: TOO_LARGE}} : files.reorder(input);
            });
        },
        display: (address, display) => operate(address, (files, path) => files.display({path, ...(display.title === undefined ? {} : {title: display.title}), ...(display.icon === undefined ? {} : {icon: display.icon})})),
        include: (address, options) => operate(address, (files, path) => files.include({path, ...(options?.before === undefined ? {} : {before: options.before})})),
        drop: (address) => operate(address, (files, path) => files.drop({path})),
        move: (items) => batch(items.flatMap((item) => [item.source, item.target]), 2, (operation, paths) => transferInput(operation, items, paths), (files, input) => files.move(input)),
        copy: (items) => batch(items.flatMap((item) => [item.source, item.target]), 2, (operation, paths) => transferInput(operation, items, paths), (files, input) => files.copy(input)),
        delete: (items) => batch(items.map((item) => item.address), 1, (operation, paths) => ({operation, items: items.map((item, at) => ({path: paths[at] as string, ...(item.expected === undefined ? {} : {expected: item.expected})}))}), (files, input) => files.delete(input)),
        watch: (scheme, listener) => {
            const release = watches.add(scheme, listener);
            const once = (): void => {
                if (releases.delete(once)) release();
            };
            releases.add(once);
            return once;
        },
    };
    return {
        service,
        release: () => {
            for (const release of [...releases]) release();
        },
    };
}

type Listener = (message: WatchMessage) => void;

/** 一个监听者；释放即置为不活跃，之后包括结束广播在内的投递都跳过它。 */
interface Entry {
    readonly listener: Listener;
    active: boolean;
}

export interface WatchRegistry {
    /** 加一个监听者；返回它的释放函数（幂等）。 */
    add(scheme: Scheme, listener: Listener): () => void;
    /** 入口停止：撤回全部订阅，不再回调。 */
    close(): void;
}

/**
 * 一个窗口里的 `watch`：同一方案只有一条远程订阅，以 `nbook.files` 自己的身份建立（读不需要区分调用方），多个监听者
 * 共享它。第一个监听者到来时建立，最后一个释放时撤回；`ended`（建立失败、提供方结束、内核结束订阅）广播给当时的全部
 * 监听者后清空，之后再 `watch` 会重新建立。同一项目代次内重连由内核重建订阅，这里收到 `onResync` 转成 `resync`。
 */
export function createWatchRegistry(remote: Remote, report: (error: unknown) => void): WatchRegistry {
    const watches = new Map<Scheme, SchemeWatch>();
    const of = (scheme: Scheme): SchemeWatch => {
        let found = watches.get(scheme);
        if (found === undefined) {
            found = new SchemeWatch((onMessage, options) => (scheme === "project" ? remote.use(projectFilesContract).events.changes.subscribe({}, onMessage, options) : remote.use(userFilesContract).events.changes.subscribe({}, onMessage, options)), report);
            watches.set(scheme, found);
        }
        return found;
    };
    return {
        add: (scheme, listener) => of(scheme).add(listener),
        close: () => {
            for (const watch of watches.values()) watch.close();
        },
    };
}

type Subscribe = (onMessage: (message: ChangesMessage) => void, options: RemoteSubscribeOptions) => Promise<RemoteResult<RemoteSubscription>>;

class SchemeWatch {
    readonly #subscribe: Subscribe;
    readonly #report: (error: unknown) => void;
    readonly #listeners = new Set<Entry>();
    #subscription: RemoteSubscription | null = null;
    #establishing = false;
    #ready = false;
    /** 每次撤回或结束加一：之前那次建立迟到的结果与消息据此丢掉。 */
    #round = 0;
    #closed = false;

    constructor(subscribe: Subscribe, report: (error: unknown) => void) {
        this.#subscribe = subscribe;
        this.#report = report;
    }

    add(listener: Listener): () => void {
        if (this.#closed) return () => undefined;
        // 同一个函数加两次也是两个监听者：各自释放。
        const entry: Entry = {listener, active: true};
        this.#listeners.add(entry);
        if (this.#subscription === null && !this.#establishing) void this.#establish();
        else if (this.#ready) this.#deliver(entry, {kind: "ready"});
        return () => this.#remove(entry);
    }

    close(): void {
        this.#closed = true;
        for (const entry of this.#listeners) entry.active = false;
        this.#listeners.clear();
        this.#reset();
    }

    #remove(entry: Entry): void {
        entry.active = false;
        if (!this.#listeners.delete(entry) || this.#listeners.size > 0) return;
        this.#reset();
    }

    async #establish(): Promise<void> {
        this.#establishing = true;
        const round = this.#round;
        const result = await this.#subscribe((message) => {
            if (round === this.#round) this.#receive(message);
        }, {
            onResync: () => {
                if (round === this.#round) this.#broadcast({kind: "resync"});
            },
            onEnd: (reason) => {
                if (round === this.#round) this.#end(reason);
            },
        });
        this.#establishing = false;
        if (round !== this.#round) {
            // 建立期间最后一个监听者已经释放（或已结束）：撤回这次刚建好的订阅。
            if (result.ok) result.value.release();
            if (this.#listeners.size > 0 && !this.#closed) void this.#establish();
            return;
        }
        if (result.ok) this.#subscription = result.value;
        else this.#end(result.code);
    }

    #receive(message: ChangesMessage): void {
        if (message.kind === "ended") {
            this.#end(message.reason);
            return;
        }
        if (message.kind === "ready") this.#ready = true;
        this.#broadcast(message);
    }

    #end(reason: string): void {
        const ended = [...this.#listeners];
        this.#listeners.clear();
        this.#reset();
        // 一个监听者在自己的 `ended` 回调里释放了别的：被释放的不再回调。
        for (const entry of ended) {
            this.#deliver(entry, {kind: "ended", reason});
            entry.active = false;
        }
    }

    #reset(): void {
        this.#round += 1;
        this.#ready = false;
        this.#subscription?.release();
        this.#subscription = null;
    }

    #broadcast(message: WatchMessage): void {
        // 前一个监听者的回调里可能释放了后面的：`#deliver` 跳过已释放的。
        for (const entry of [...this.#listeners]) this.#deliver(entry, message);
    }

    #deliver(entry: Entry, message: WatchMessage): void {
        if (!entry.active) return;
        try {
            entry.listener(message);
        } catch (error) {
            this.#report(error);
        }
    }
}

const BUSINESS: ReadonlySet<string> = new Set(FILES_FAILURES);

const TOO_LARGE = "超过一次请求的上限";
const tooLarge = {ok: false, code: "too-large", detail: TOO_LARGE} as const;

/** 移动与复制的请求：`paths` 是源与目标交替的方案内路径。 */
function transferInput(operation: string, items: ReadonlyArray<BatchTransfer>, paths: ReadonlyArray<string>) {
    return {operation, items: items.map((item, at) => ({source: paths[2 * at] as string, target: paths[2 * at + 1] as string, ...(item.expected === undefined ? {} : {expected: item.expected})}))};
}

/**
 * 一组地址：必须同一方案（只支持方案内的操作），项数有上限。编码后的大小由调用方对要发出的完整请求核对：超过一条 RPC
 * 消息的请求会被断开连接、写请求成为结果未知（docs/specs/workspace/files.md 的“大小上限”）。
 */
export function sameScheme(addresses: ReadonlyArray<string>, limit = MAX_OPERATION_ITEMS): {readonly ok: true; readonly scheme: Scheme; readonly paths: string[]} | Extract<FilesResult<never>, {readonly ok: false}> {
    if (addresses.length === 0) return {ok: false, code: "invalid-address", detail: "没有给出任何地址"};
    if (addresses.length > limit) return {ok: false, code: "too-large", detail: `一次最多 ${String(MAX_OPERATION_ITEMS)} 项`};
    const paths: string[] = [];
    let scheme: Scheme | null = null;
    for (const address of addresses) {
        const parsed = parseResource(address);
        if (!parsed.ok) return parsed;
        if (scheme !== null && parsed.resource.scheme !== scheme) return {ok: false, code: "invalid-address", detail: "一次操作的地址必须在同一个方案里"};
        scheme = parsed.resource.scheme;
        paths.push(parsed.resource.path);
    }
    return {ok: true, scheme: scheme as Scheme, paths};
}

/** 业务失败的详情已由内核按合同的 schema 校验过（`{detail}`，冲突另带 `current`）。 */
function fromRemote(failure: RemoteFailure<RemoteFailureCode | FilesFailureCode>): FilesResult<never> {
    if (BUSINESS.has(failure.code)) {
        const detail = failure.detail as {readonly detail: string; readonly current?: Baseline};
        return {ok: false, code: failure.code, detail: detail.detail, ...(detail.current === undefined ? {} : {current: detail.current})};
    }
    const reason = typeof failure.detail === "string" ? failure.detail : failure.cause === undefined ? failure.code : `${failure.code}（${failure.cause}）`;
    return {ok: false, code: failure.code, detail: reason, ...(failure.cause === undefined ? {} : {cause: failure.cause})};
}
