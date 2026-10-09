/**
 * 一个窗口里打开的文档（docs/specs/workbench/editor.md 输出 11–18、21–25 与“时序与寿命”）：按地址持有权威正文、磁盘
 * 基线与状态，经文件客户端读取与按基线保存，订阅两个方案的变化，给资源管理器提供文档协调服务。活到编辑器入口停止。
 *
 * 几处先后关系是这份代码最容易改错的地方：
 * - 读取等该方案的订阅 `ready` 之后才发：先读后订阅的间隙里发生的变化不会有事件（审查实测）。
 * - 读取在途时该文件有变化，结果回来后再读一次；接纳读取结果时再核对输入修订没有前进、没有 dirty、没有在途保存。
 * - 变化事件不带基线，来源也分不出是不是本窗口：一律读一次，用读到的哈希与本窗口已提交或正在提交的正文比较。
 * - 每份文档的保存排成一列：一次保存开始时固定快照，下一次用它完成后的基线；租约期间新的保存等租约结束。
 */

import {computed, ref, shallowRef} from "@vue/reactivity";
import type {ComputedRef, Ref, ShallowRef} from "@vue/reactivity";

import type {Baseline, FilesService, Scheme, WatchMessage} from "nbook/plugins/files/shared/contracts";

import type {AffectedDocument, DocumentCoordinator, DocumentLease, LeaseResult, SettleState} from "../../shared/contracts";
import {isWithin, rebase, schemeOf, textHash} from "./address";

/** 空正文的 SHA-256：删除后重建时排他新建的空文件就是这个基线。 */
export const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type DocumentStatus = "loading" | "ready" | "failed" | "deleted";

/** 文档身份（命令目录 `nbook.editor.go-to-line` 的四字段）：改名只换 `path`。 */
export interface DocumentTarget {
    readonly workspaceKey: string;
    readonly generation: number;
    readonly documentId: string;
    readonly path: string;
}

export interface DocumentProblem {
    readonly code: string;
    readonly detail: string;
}

/** 视图看到的文档：都是只读的响应式值，改动只经 store 的方法。 */
export interface TextDocument {
    readonly target: Readonly<ShallowRef<DocumentTarget>>;
    readonly status: Readonly<Ref<DocumentStatus>>;
    /** 打开失败的原因（status 为 failed 时）。 */
    readonly failure: Readonly<Ref<DocumentProblem | null>>;
    readonly text: Readonly<Ref<string>>;
    /** 正文修订：每次接受输入或换成磁盘内容加一；视图的输入回执按它判定基线。 */
    readonly revision: Readonly<Ref<number>>;
    readonly dirty: ComputedRef<boolean>;
    readonly saving: ComputedRef<boolean>;
    /** 磁盘冲突：保存时磁盘的当前基线；没有为 null。 */
    readonly conflict: Readonly<Ref<Baseline | null>>;
    /** dirty 时磁盘被别处改过：下一次保存会得到冲突。 */
    readonly diskChanged: Readonly<Ref<boolean>>;
    /** 方案的订阅结束的原因：之后不可保存。 */
    readonly ended: Readonly<Ref<string | null>>;
    /** 最近一次保存失败的原因（冲突另见 conflict）；保存成功时清除。 */
    readonly saveProblem: Readonly<Ref<DocumentProblem | null>>;
    /** 有未裁决输入的视图标识。 */
    readonly unresolved: ComputedRef<ReadonlyArray<string>>;
    readonly writable: ComputedRef<boolean>;
}

export type CommitResult = {readonly status: "accepted"; readonly revision: number} | {readonly status: "conflict"; readonly revision: number} | {readonly status: "stale"};

export type SaveResult = {readonly ok: true} | {readonly ok: false; readonly code: string; readonly detail?: string};

export type StoreEvent =
    | {readonly kind: "rebound"; readonly from: string; readonly to: string}
    | {readonly kind: "closed"; readonly addresses: ReadonlyArray<string>};

export interface DocumentReference {
    readonly document: TextDocument;
    /** 释放这次打开；最后一个引用释放时文档丢弃（关闭前的询问由标签的拥有者负责）。幂等。 */
    release(): void;
}

export interface DocumentStore {
    acquire(address: string): DocumentReference;
    /** 已打开的文档；没有为 null。 */
    get(address: string): TextDocument | null;
    /** 视图交来输入（输入回执）：`baseRevision` 是视图看到的修订。 */
    commit(document: TextDocument, token: string, baseRevision: number, text: string): CommitResult;
    /** 裁决一份未裁决输入：采用当前正文（丢弃它），或以最新修订重新提交它。 */
    resolve(document: TextDocument, token: string, choice: "adopt-current" | "keep-view"): void;
    /** 丢弃一个视图的未裁决输入（用户选择不保存、视图关闭）。 */
    discardInput(document: TextDocument, token: string): void;
    /** 视图登记自己的结算函数：保存、切换、资源管理器的操作之前同步调用，让视图把还没交出的输入交给文档。 */
    attachView(document: TextDocument, flush: () => void): () => void;
    /** 同步结算这份文档全部视图的输入。 */
    settle(document: TextDocument): void;
    save(document: TextDocument): Promise<SaveResult>;
    /** 丢弃修改，重新读磁盘。 */
    revert(document: TextDocument): Promise<void>;
    /** 磁盘冲突时以冲突带回的当前基线写入。 */
    overwrite(document: TextDocument): Promise<SaveResult>;
    /** 重试打开失败的文档。 */
    retry(document: TextDocument): void;
    readonly coordinator: DocumentCoordinator;
    /** 未保存的正文与未裁决输入（终态页的抢救）；同步返回。 */
    rescue(): ReadonlyArray<{readonly path: string; readonly text: string}>;
    subscribe(listener: (event: StoreEvent) => void): () => void;
    dispose(): void;
}

export interface DocumentStoreOptions {
    readonly files: FilesService;
    readonly workspaceKey: string;
    readonly generation: number;
    readonly report: (error: unknown) => void;
}

interface Entry {
    address: string;
    refs: number;
    closed: boolean;
    readonly document: TextDocument;
    readonly target: ShallowRef<DocumentTarget>;
    readonly status: Ref<DocumentStatus>;
    readonly failure: Ref<DocumentProblem | null>;
    readonly text: Ref<string>;
    readonly revision: Ref<number>;
    /** 基线对应的正文；还没读到时为 null。 */
    readonly saved: Ref<string | null>;
    baseline: Baseline | null;
    readonly conflict: Ref<Baseline | null>;
    readonly diskChanged: Ref<boolean>;
    readonly ended: Ref<string | null>;
    readonly saveProblem: Ref<DocumentProblem | null>;
    readonly candidates: ShallowRef<Map<string, string>>;
    readonly flushers: Set<() => void>;
    /** 结果未知的那次保存的快照：之后的核对读到它的哈希就算已保存。 */
    uncertain: {readonly text: string; readonly hash: Promise<string>} | null;
    /** 正在提交的快照：回声核对用它的哈希。 */
    readonly inflight: Ref<{readonly text: string; readonly hash: Promise<string>} | null>;
    /** 排队还没开始的保存：重复保存合并到它。 */
    readonly pending: ShallowRef<Promise<SaveResult> | null>;
    /** 保存队列的尾。 */
    queue: Promise<unknown>;
    reading: boolean;
    reread: boolean;
    leases: number;
    readonly leaseWaiters: Array<() => void>;
}

interface Watch {
    readonly ready: Promise<void>;
    readonly release: () => void;
    ended: string | null;
}

export function createDocumentStore(options: DocumentStoreOptions): DocumentStore {
    const {files} = options;
    const entries = new Map<string, Entry>();
    const watches = new Map<Scheme, Watch>();
    const listeners = new Set<(event: StoreEvent) => void>();
    /** 本窗口的保存形成的身份链：地址 → 旧令牌 → 新令牌。 */
    const chains = new Map<string, Map<string, string>>();
    let nextId = 0;
    let disposed = false;

    const emit = (event: StoreEvent): void => {
        for (const listener of [...listeners]) {
            try {
                listener(event);
            } catch (error) {
                options.report(error);
            }
        }
    };

    const entryOf = (document: TextDocument): Entry | null => {
        for (const entry of entries.values()) if (entry.document === document) return entry;
        return null;
    };

    const isDirty = (entry: Entry): boolean => entry.saved.value !== null && entry.text.value !== entry.saved.value;

    const watchFor = (scheme: Scheme): Watch => {
        const existing = watches.get(scheme);
        if (existing !== undefined) return existing;
        let markReady = (): void => undefined;
        const ready = new Promise<void>((resolve) => {
            markReady = resolve;
        });
        const watch: Watch = {ready, release: () => undefined, ended: null};
        watches.set(scheme, watch);
        let first = true;
        (watch as {release: () => void}).release = files.watch(scheme, (message) => {
            if (disposed) return;
            if (message.kind === "ready" && first) {
                first = false;
                markReady();
                return;
            }
            onMessage(scheme, watch, message);
        });
        return watch;
    };

    const onMessage = (scheme: Scheme, watch: Watch, message: WatchMessage): void => {
        const inScheme = (): Entry[] => [...entries.values()].filter((entry) => schemeOf(entry.address) === scheme);
        switch (message.kind) {
            case "ready":
            case "resync":
                for (const entry of inScheme()) recheck(entry);
                return;
            case "ended":
                watch.ended = message.reason;
                for (const entry of inScheme()) entry.ended.value = message.reason;
                return;
            case "batch":
                for (const event of message.events) {
                    const address = `${scheme}://${event.path}`;
                    if (event.type === "renamed") {
                        rebind(`${scheme}://${event.from}`, address);
                        continue;
                    }
                    for (const entry of inScheme()) {
                        const touched = event.type === "deleted" ? isWithin(entry.address, address) : entry.address === address;
                        if (touched) recheck(entry);
                    }
                }
        }
    };

    /** 读一次磁盘并按接纳规则应用；读取在途时只记下要再读。 */
    const recheck = (entry: Entry): void => {
        if (entry.closed || disposed) return;
        if (entry.reading) {
            entry.reread = true;
            return;
        }
        void read(entry);
    };

    const read = async (entry: Entry): Promise<void> => {
        entry.reading = true;
        try {
            await watchFor(schemeOf(entry.address)).ready;
            for (;;) {
                entry.reread = false;
                const address = entry.address;
                const revision = entry.revision.value;
                const result = await files.read(address);
                if (entry.closed || disposed) return;
                // 读取期间改名了或又有变化：这份结果已经过时，再读一次。
                if (entry.reread || entry.address !== address) continue;
                await apply(entry, result, revision);
                if (!entry.reread) return;
            }
        } catch (error) {
            options.report(error);
        } finally {
            entry.reading = false;
        }
    };

    const apply = async (entry: Entry, result: Awaited<ReturnType<FilesService["read"]>>, revisionAtStart: number): Promise<void> => {
        const status = entry.status.value;
        if (!result.ok) {
            if (result.code === "not-found") {
                if (status === "loading" || status === "failed") {
                    entry.failure.value = {code: result.code, detail: result.detail};
                    entry.status.value = "failed";
                } else {
                    entry.status.value = "deleted";
                }
                return;
            }
            if (status === "loading" || status === "failed") {
                entry.failure.value = {code: result.code, detail: result.detail};
                entry.status.value = "failed";
            }
            // 已打开的文档读不到（断线之类）：保持原样，下一次变化或 resync 再核对。
            return;
        }
        const {text, baseline} = result.value;
        if (status === "loading" || status === "failed") {
            adopt(entry, text, baseline);
            entry.failure.value = null;
            entry.status.value = "ready";
            return;
        }
        if (status === "deleted") {
            // 文件又出现了：不 dirty 就用磁盘的；dirty 时保留正文，基线不动，下一次保存得到冲突。
            entry.status.value = "ready";
            if (!isDirty(entry) && entry.candidates.value.size === 0) adopt(entry, text, baseline);
            else entry.diskChanged.value = true;
            return;
        }
        const uncertain = entry.uncertain;
        if (uncertain !== null) {
            entry.uncertain = null;
            if (baseline.hash === (await uncertain.hash)) {
                entry.baseline = baseline;
                entry.saved.value = uncertain.text;
                entry.saveProblem.value = null;
                return;
            }
        }
        if (baseline.hash === entry.baseline?.hash) return;
        const inflight = entry.inflight.value;
        if (inflight !== null && baseline.hash === (await inflight.hash)) return;
        if (entry.closed) return;
        const quiet = !isDirty(entry) && entry.inflight.value === null && entry.pending.value === null && entry.candidates.value.size === 0 && entry.conflict.value === null && entry.revision.value === revisionAtStart;
        if (quiet) adopt(entry, text, baseline);
        else entry.diskChanged.value = true;
    };

    /** 换成磁盘内容：正文、已保存的正文与基线一起，修订前进让视图更新。 */
    const adopt = (entry: Entry, text: string, baseline: Baseline): void => {
        entry.baseline = baseline;
        entry.saved.value = text;
        entry.text.value = text;
        entry.revision.value += 1;
        entry.diskChanged.value = false;
        entry.conflict.value = null;
    };

    const create = (address: string): Entry => {
        nextId += 1;
        const target = shallowRef<DocumentTarget>({workspaceKey: options.workspaceKey, generation: options.generation, documentId: String(nextId), path: address});
        const status = ref<DocumentStatus>("loading");
        const text = ref("");
        const saved = ref<string | null>(null);
        const candidates = shallowRef(new Map<string, string>());
        const inflight = ref<{readonly text: string; readonly hash: Promise<string>} | null>(null);
        const pending = shallowRef<Promise<SaveResult> | null>(null);
        const ended = ref<string | null>(watches.get(schemeOf(address))?.ended ?? null);
        const conflict = ref<Baseline | null>(null);
        const document: TextDocument = {
            target,
            status,
            failure: ref(null),
            text,
            revision: ref(0),
            dirty: computed(() => saved.value !== null && text.value !== saved.value),
            saving: computed(() => inflight.value !== null || pending.value !== null),
            conflict,
            diskChanged: ref(false),
            ended,
            saveProblem: ref(null),
            unresolved: computed(() => [...candidates.value.keys()]),
            writable: computed(() => (status.value === "ready" || status.value === "deleted") && ended.value === null),
        };
        const entry: Entry = {
            address,
            refs: 0,
            closed: false,
            document,
            target,
            status,
            failure: document.failure as Ref<DocumentProblem | null>,
            text,
            revision: document.revision as Ref<number>,
            saved,
            baseline: null,
            conflict,
            diskChanged: document.diskChanged as Ref<boolean>,
            ended,
            saveProblem: document.saveProblem as Ref<DocumentProblem | null>,
            candidates,
            flushers: new Set(),
            uncertain: null,
            inflight,
            pending,
            queue: Promise.resolve(),
            reading: false,
            reread: false,
            leases: 0,
            leaseWaiters: [],
        };
        return entry;
    };

    const drop = (entry: Entry): void => {
        if (entries.get(entry.address) === entry) entries.delete(entry.address);
        entry.closed = true;
        entry.flushers.clear();
    };

    const rebind = (from: string, to: string): void => {
        if (from === to) return;
        const moved = [...entries.values()].filter((entry) => isWithin(entry.address, from));
        for (const entry of moved) entries.delete(entry.address);
        for (const entry of moved) {
            const next = rebase(entry.address, from, to);
            const chain = chains.get(entry.address);
            if (chain !== undefined) {
                chains.delete(entry.address);
                chains.set(next, chain);
            }
            entry.address = next;
            entry.target.value = {...entry.target.value, path: next};
            entries.set(next, entry);
        }
        if (moved.length > 0) emit({kind: "rebound", from, to});
    };

    const flush = (entry: Entry): void => {
        for (const settle of [...entry.flushers]) {
            try {
                settle();
            } catch (error) {
                options.report(error);
            }
        }
    };

    const waitForLeases = async (entry: Entry): Promise<void> => {
        while (entry.leases > 0) await new Promise<void>((resolve) => entry.leaseWaiters.push(resolve));
    };

    const save = (entry: Entry): Promise<SaveResult> => {
        if (entry.pending.value !== null) return entry.pending.value;
        const run = entry.queue.then(async (): Promise<SaveResult> => {
            await waitForLeases(entry);
            entry.pending.value = null;
            return saveNow(entry);
        });
        entry.pending.value = run;
        entry.queue = run.catch((error: unknown) => options.report(error));
        return run;
    };

    const saveNow = async (entry: Entry): Promise<SaveResult> => {
        if (entry.closed) return {ok: false, code: "closed"};
        flush(entry);
        if (entry.candidates.value.size > 0) return {ok: false, code: "unresolved"};
        if (entry.conflict.value !== null) return {ok: false, code: "conflict"};
        if (entry.ended.value !== null) return {ok: false, code: "ended", detail: entry.ended.value};
        const status = entry.status.value;
        if (status === "loading" || status === "failed") return {ok: false, code: "not-ready"};
        if (status !== "deleted" && !isDirty(entry)) return {ok: true};
        const address = entry.address;
        const text = entry.text.value;
        const hash = textHash(text);
        entry.inflight.value = {text, hash};
        try {
            let baseline = entry.baseline;
            if (status === "deleted") {
                const created = await files.create(address, "file");
                if (!created.ok) return failed(entry, created.code === "conflict" ? "exists" : created.code, created.detail);
                // 排他新建的是空文件：以空正文为基线写入；写入失败时如实记下“已有一个空文件”。
                baseline = {hash: EMPTY_HASH};
                entry.baseline = baseline;
                entry.saved.value = "";
                entry.status.value = "ready";
            }
            if (baseline === null) return {ok: false, code: "not-ready"};
            const result = await files.write(address, text, baseline);
            if (result.ok) {
                entry.baseline = result.value.baseline;
                entry.saved.value = text;
                entry.diskChanged.value = false;
                entry.saveProblem.value = null;
                const identity = result.value.identity;
                if (identity !== undefined) {
                    const chain = chains.get(entry.address) ?? new Map<string, string>();
                    chain.set(identity.before, identity.after);
                    chains.set(entry.address, chain);
                }
                return {ok: true};
            }
            if (result.code === "conflict") {
                entry.conflict.value = result.current ?? null;
                return {ok: false, code: "conflict"};
            }
            if (result.code === "unknown-outcome") {
                // 写可能已经落盘：记下快照，下一次核对（马上读一次，读不到就等重连后的 resync）读到它的哈希即为已保存。
                entry.uncertain = {text, hash};
                recheck(entry);
            }
            return failed(entry, result.code, result.detail);
        } finally {
            entry.inflight.value = null;
        }
    };

    const failed = (entry: Entry, code: string, detail: string): SaveResult => {
        entry.saveProblem.value = {code, detail};
        return {ok: false, code, detail};
    };

    const settleState = (entry: Entry): SettleState | null => {
        if (entry.candidates.value.size > 0) return "unresolved";
        if (entry.conflict.value !== null) return "conflict";
        if (entry.inflight.value !== null || entry.pending.value !== null) return "saving";
        return isDirty(entry) ? "dirty" : null;
    };

    const within = (addresses: ReadonlyArray<string>): Entry[] => [...entries.values()].filter((entry) => addresses.some((address) => isWithin(entry.address, address)));

    const coordinator: DocumentCoordinator = {
        affected: (addresses) => within(addresses).flatMap((entry): AffectedDocument[] => {
            const state = settleState(entry);
            return state === null ? [] : [{address: entry.address, state}];
        }),
        begin: async (addresses): Promise<LeaseResult> => {
            const affected = within(addresses);
            for (const entry of affected) flush(entry);
            // 等在途与排队的保存都结束；之后同步加租约，中间不让出执行权。
            for (const entry of affected) {
                while (entry.inflight.value !== null || entry.pending.value !== null) await entry.queue;
            }
            const blocked = affected.flatMap((entry): AffectedDocument[] => {
                const state = settleState(entry);
                return state === "unresolved" || state === "conflict" ? [{address: entry.address, state}] : [];
            });
            if (blocked.length > 0) return {ok: false, reason: "blocked", documents: blocked};
            for (const entry of affected) entry.leases += 1;
            let ended = false;
            const lease: DocumentLease = {
                end: (result) => {
                    if (ended || result.kind === "unknown") return;
                    ended = true;
                    for (const moved of result.moved ?? []) rebind(moved.from, moved.to);
                    for (const entry of affected) {
                        entry.leases -= 1;
                        if (entry.leases === 0) for (const resume of entry.leaseWaiters.splice(0)) resume();
                    }
                },
            };
            return {ok: true, lease};
        },
        save: async (addresses) => {
            const results = [];
            for (const entry of within(addresses)) {
                if (!isDirty(entry) && entry.candidates.value.size === 0 && entry.conflict.value === null) continue;
                const result = await save(entry);
                results.push(result.ok ? {address: entry.address, ok: true} : {address: entry.address, ok: false, code: result.code});
            }
            return results;
        },
        translate: (address, token) => {
            const chain = chains.get(address);
            let current = token;
            const seen = new Set<string>();
            while (chain?.has(current) === true && !seen.has(current)) {
                seen.add(current);
                current = chain.get(current) as string;
            }
            return current;
        },
        close: (addresses) => {
            const closed = within(addresses);
            for (const entry of closed) drop(entry);
            if (closed.length > 0) emit({kind: "closed", addresses: closed.map((entry) => entry.address)});
        },
    };

    const live = (document: TextDocument): Entry => {
        const entry = entryOf(document);
        if (entry === null) throw new RangeError(`文档 ${document.target.value.path} 已关闭`);
        return entry;
    };

    return {
        acquire: (address) => {
            schemeOf(address);
            let entry = entries.get(address);
            if (entry === undefined) {
                entry = create(address);
                entries.set(address, entry);
                const watch = watchFor(schemeOf(address));
                if (watch.ended !== null) {
                    entry.failure.value = {code: "ended", detail: watch.ended};
                    entry.status.value = "failed";
                } else {
                    void read(entry);
                }
            }
            entry.refs += 1;
            const held = entry;
            let released = false;
            return {
                document: held.document,
                release: () => {
                    if (released) return;
                    released = true;
                    held.refs -= 1;
                    if (held.refs <= 0) drop(held);
                },
            };
        },
        get: (address) => entries.get(address)?.document ?? null,
        commit: (document, token, baseRevision, text) => {
            const entry = entryOf(document);
            if (entry === null || !document.writable.value) return {status: "stale"};
            const revision = entry.revision.value;
            if (text === entry.text.value) return {status: "accepted", revision};
            if (baseRevision === revision) {
                entry.text.value = text;
                entry.revision.value = revision + 1;
                return {status: "accepted", revision: revision + 1};
            }
            const candidates = new Map(entry.candidates.value);
            candidates.set(token, text);
            entry.candidates.value = candidates;
            return {status: "conflict", revision};
        },
        resolve: (document, token, choice) => {
            const entry = live(document);
            const candidate = entry.candidates.value.get(token);
            if (candidate === undefined) return;
            const candidates = new Map(entry.candidates.value);
            candidates.delete(token);
            entry.candidates.value = candidates;
            if (choice === "keep-view" && candidate !== entry.text.value) {
                entry.text.value = candidate;
                entry.revision.value += 1;
            }
        },
        discardInput: (document, token) => {
            const entry = entryOf(document);
            if (entry === null || !entry.candidates.value.has(token)) return;
            const candidates = new Map(entry.candidates.value);
            candidates.delete(token);
            entry.candidates.value = candidates;
        },
        attachView: (document, settle) => {
            const entry = live(document);
            entry.flushers.add(settle);
            return () => {
                entry.flushers.delete(settle);
            };
        },
        settle: (document) => {
            const entry = entryOf(document);
            if (entry !== null) flush(entry);
        },
        save: (document) => save(live(document)),
        revert: async (document) => {
            const entry = live(document);
            const result = await files.read(entry.address);
            if (entry.closed) return;
            if (!result.ok) {
                if (result.code === "not-found") entry.status.value = "deleted";
                return;
            }
            entry.candidates.value = new Map();
            entry.status.value = "ready";
            adopt(entry, result.value.text, result.value.baseline);
        },
        overwrite: async (document) => {
            const entry = live(document);
            const current = entry.conflict.value;
            if (current === null) return save(entry);
            // 以磁盘的当前基线写入。冲突来自保存 dirty 的正文，正文仍 dirty，这次保存一定发出。
            entry.conflict.value = null;
            entry.baseline = current;
            entry.diskChanged.value = false;
            return save(entry);
        },
        retry: (document) => {
            const entry = live(document);
            if (entry.status.value !== "failed") return;
            entry.status.value = "loading";
            void read(entry);
        },
        coordinator,
        rescue: () => {
            const found: Array<{path: string; text: string}> = [];
            for (const entry of entries.values()) {
                flush(entry);
                if (isDirty(entry)) found.push({path: entry.address, text: entry.text.value});
                for (const candidate of entry.candidates.value.values()) found.push({path: entry.address, text: candidate});
            }
            return found;
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            for (const watch of watches.values()) watch.release();
            watches.clear();
            for (const entry of [...entries.values()]) drop(entry);
            listeners.clear();
        },
    };
}
