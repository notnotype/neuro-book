/**
 * 主文字的稿在这个窗口里的登记（docs/specs/canon/author-ui.md 输出 44 到 46）：每个条目一份编辑会话，管三件事——
 *
 * 1. **暂存**：稿存在这部作品的本机记录里，一个条目一条。这个窗口对一条记录的写是串行的，每次都带上一次确认的 revision
 *    （条件写）。别的窗口写过这条记录时条件写失败：停止自动暂存、状态变成 `diverged`，由作者选用哪边，两边都不自动丢。
 * 2. **提交**：读块、把稿对上去（`rebase`）、编成操作（`compile`），带读取戳发给内核。世界在读与写之间变了就重读再来，
 *    至多 `SUBMIT_ATTEMPTS` 次。
 * 3. **提交的结局**：发出之前把请求 id 与读取戳写进稿（`pending`）并等存储确认；结果不明时留着它，之后只原样重发同一个请求
 *    或问结局，不换请求再发（`confirm` 的注释里写了为什么这样不会发布两次）。
 *
 * 会话不随页面组件卸载：标签不在前台时圆点还要问“有没有未提交的内容”。纯逻辑在 `text-draft.ts`。
 */

import {Type} from "typebox";
import {reactive} from "vue";

import {ReadPositionSchema} from "@notnotype/nb-canon/schema";
import type {ReadPosition} from "@notnotype/nb-canon/schema";

import {defineRecord, MAX_RECORD_MAX_BYTES} from "nbook/shared/storage";
import type {RecordHandle, Revision, StorageFailure, StorageService} from "nbook/shared/storage";

import {CANON_BUDGET_BYTES, encodedBytes} from "../shared/contracts";
import type {CanonClient, CanonFailure, CanonOutputs} from "../shared/contracts";
import {compile, emptyDraft, hasChanges, rebase, resolve} from "./text-draft";
import type {Blocked, Choice, Conflict, PendingSubmit, TextDraft, TextRead} from "./text-draft";
import type {CanonWorld} from "./world";

const DraftSchema = Type.Object({
    at: ReadPositionSchema,
    order: Type.Array(Type.String()),
    base: Type.Record(Type.String(), Type.String()),
    texts: Type.Record(Type.String(), Type.String()),
    removed: Type.Array(Type.String()),
    moved: Type.Optional(Type.Array(Type.String())),
    pending: Type.Optional(Type.Object({requestId: Type.String(), stamp: Type.Object({version: Type.Integer(), input: Type.String()})})),
});

/** 一个条目一条，键是条目 id；只在这台机器的这份浏览器配置里（`local`）。 */
export const TEXT_DRAFTS_RECORD = defineRecord({key: "canon.text-drafts", scope: "project", locality: "local", version: 1, keyed: true, maxBytes: MAX_RECORD_MAX_BYTES, schema: DraftSchema});

/** 世界在读与写之间一直在变时，重读再发至多几次。 */
export const SUBMIT_ATTEMPTS = 3;
/** 输入停下多久写一次暂存。 */
const SAVE_DELAY_MS = 300;

/** 暂存的状态：`none` 没有要存的；`diverged` 是别的窗口写过这条记录。 */
export type SavedState = "none" | "saved" | "unsaved" | "failed" | "too-large" | "diverged";

/** 进不了编辑、或稿对不上世界的原因。 */
export type Blocker = "chapter-not-found" | "line-not-found" | "entry-missing" | "unavailable";

/** 一次提交的结局。 */
export type SubmitResult =
    | {readonly status: "published"; readonly revision?: string; readonly version?: number}
    /** 净变化是零：没有发请求，稿已经清掉。 */
    | {readonly status: "nothing"}
    /** 有要作者选的（`state.conflicts`）。 */
    | {readonly status: "conflicts"}
    /** 有编不进去的块，或内核拒收并指到了块（`state.problems`）。 */
    | {readonly status: "problems"}
    | {readonly status: "too-many"; readonly count: number}
    | {readonly status: "too-large"}
    /** 暂存写不进去，没有发（见 `#freeze`）。 */
    | {readonly status: "not-saved"; readonly code: StorageFailure}
    /** 重读再发了几次，世界还在变。 */
    | {readonly status: "contended"}
    /** 结局不明：稿留着 `pending`，等 `confirm`。 */
    | {readonly status: "unknown"}
    /** 查到上一次提交确实没有发布：稿还在，可以再提交。 */
    | {readonly status: "not-published"}
    | {readonly status: "blocked"; readonly reason: Blocker}
    | {readonly status: "failed"; readonly failure: CanonFailure}
    | {readonly status: "busy"};

/** 一块下面要写的原因：稿模型给的，或内核的校验细项。 */
export type BlockProblem = {readonly kind: "blocked"; readonly reason: Blocked} | {readonly kind: "rejected"; readonly code: string; readonly message: string};

export interface TextDraftState {
    /** 问过存储了（有没有稿已经知道）。 */
    loaded: boolean;
    /** 在编辑：稿（可以没有改动）。null 是阅读。 */
    draft: TextDraft | null;
    /** 稿对着的那次读取；读不出来时为 null，原因在 `blocker`。 */
    read: TextRead | null;
    blocker: Blocker | null;
    saved: SavedState;
    /** `confirming`：上一次提交发出去了、结果不明。 */
    phase: "idle" | "submitting" | "confirming";
    conflicts: readonly Conflict[];
    problems: Readonly<Record<string, BlockProblem>>;
}

export interface TextDraftSession {
    readonly state: TextDraftState;
    /** 读存下来的稿；有稿就读块、对上去。重复调用拿到同一次读取。 */
    load(): Promise<void>;
    /** 开始编辑：在这个位置读块、建一份没有改动的稿。读不出来时返回原因。已经在编辑时什么也不做。 */
    begin(position: ReadPosition): Promise<Blocker | null>;
    /** 一次编辑。提交在途、等结局、读不出块时不生效。 */
    edit(change: (draft: TextDraft, read: TextRead) => TextDraft): void;
    /** 现在就把稿写进存储（输入框失焦、页面转入后台）。 */
    flush(): Promise<void>;
    /** 离开编辑：稿与暂存都丢掉（有改动时调用方先问过作者）。等结局期间同样可以放弃，只丢本机的稿。 */
    discard(): Promise<void>;
    submit(): Promise<SubmitResult>;
    /** 上一次提交结局不明时再确认一次（连上以后、作者点“再试”）。 */
    confirm(): Promise<SubmitResult>;
    /** 作者选完了一条冲突。 */
    choose(conflict: Conflict, choice: Choice): void;
    /** 别的窗口也在改时：用这里的内容覆盖那边的。 */
    takeOver(): Promise<void>;
    /** 别的窗口也在改时：换成那边的内容（那边已经没有稿了就回到阅读）。 */
    adopt(): Promise<void>;
    /** 读不出块（连接断了）以后再读一次。 */
    reload(): Promise<void>;
}

export interface TextDrafts {
    /** 这个条目有没有未提交的主文字（响应式）。第一次问时去读存储，读到之前为假。 */
    uncommitted(entry: string): boolean;
    session(entry: string): TextDraftSession;
}

export interface TextDraftsOptions {
    /** 窗口没有 Storage 时为 null：稿只在内存里。 */
    readonly storage: StorageService | null;
    /** 窗口没有绑定项目时为 null。 */
    readonly world: () => CanonWorld | null;
    readonly call: CanonClient["call"];
    /** 修订的标题（界面语言的“改主文字”）。 */
    readonly title: () => string;
    readonly requestId?: () => string;
    /** 推迟执行，返回取消；测试给自己的（不按时长等，直接调 `flush`）。 */
    readonly schedule?: (run: () => void, ms: number) => () => void;
    readonly report?: (error: unknown) => void;
}

type Written = CanonOutputs["editEntries"];

export function createTextDrafts(options: TextDraftsOptions): TextDrafts {
    const sessions = new Map<string, TextDraftSession>();
    const schedule = options.schedule ?? ((run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    });
    const newRequestId = options.requestId ?? (() => `text-${crypto.randomUUID()}`);

    const create = (entry: string): TextDraftSession => {
        const state: TextDraftState = reactive({loaded: false, draft: null, read: null, blocker: null, saved: "none", phase: "idle", conflicts: [], problems: {}});
        let handle: RecordHandle<TextDraft> | null = null;
        /** 这个窗口上一次读到或写下的 revision：条件写带它。 */
        let revision: Revision | null = null;
        /** 记录是坏的或别的版本写下的：下一次写用 `reset`。 */
        let reset = false;
        let cancelSave: (() => void) | null = null;
        /** 存储的读写排成一队：同一条记录上这个窗口不会有两次写同时在途，放弃也排在在途的保存后面。 */
        let queue: Promise<unknown> = Promise.resolve();
        let loading: Promise<void> | null = null;

        const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
            const next = queue.then(task, task);
            queue = next.catch((error: unknown) => options.report?.(error));
            return next;
        };

        const open = async (): Promise<RecordHandle<TextDraft> | StorageFailure | null> => {
            if (options.storage === null) return null;
            if (handle !== null) return handle;
            const opened = await options.storage.open(TEXT_DRAFTS_RECORD, entry);
            if (!opened.ok) return opened.code;
            handle = opened.handle;
            return handle;
        };

        /** 把内存里的稿写进存储（没有改动、也不在等结局时删掉记录）。返回写成了没有。 */
        const persist = (): Promise<{readonly ok: true} | {readonly ok: false; readonly code: StorageFailure}> => enqueue(async () => {
            cancelSave?.();
            cancelSave = null;
            if (state.saved === "diverged") return {ok: false, code: "conflict" as const};
            const record = await open();
            const draft = state.draft;
            const keep = draft !== null && (hasChanges(draft) || draft.pending !== undefined);
            // 窗口没有 Storage：稿只在内存里。算写成了（没有更早的一份会留在存储里），那一行照样写“没有暂存”。
            if (record === null) {
                state.saved = keep ? "failed" : "none";
                return {ok: true as const};
            }
            if (typeof record === "string") {
                state.saved = "failed";
                return {ok: false, code: record};
            }
            if (!keep && revision === null && !reset) {
                state.saved = "none";
                return {ok: true as const};
            }
            // `toRaw` 不够：稿里的数组、对象也是代理，结构化复制会抛。存进去的是一份普通对象。
            const written = keep ? await (reset ? record.reset(plain(draft), {expect: revision}) : record.save(plain(draft), {expect: revision})) : await record.remove({expect: revision});
            if (written.ok) {
                revision = written.revision;
                reset = false;
                state.saved = keep ? "saved" : "none";
                return {ok: true as const};
            }
            state.saved = written.code === "conflict" ? "diverged" : written.code === "too-large" ? "too-large" : "failed";
            return {ok: false, code: written.code};
        });

        const touch = (): void => {
            if (state.saved !== "diverged") state.saved = "unsaved";
            cancelSave?.();
            cancelSave = schedule(() => void persist(), SAVE_DELAY_MS);
        };

        const readBlocks = async (position: ReadPosition): Promise<TextRead | Blocker> => {
            try {
                const result = await options.call("textBlocks", {id: entry, position});
                if (!result.ok) return result.failure.code === "chapter-not-found" || result.failure.code === "line-not-found" ? result.failure.code : "unavailable";
                return result.value ?? "entry-missing";
            } catch (error) {
                options.report?.(error);
                return "unavailable";
            }
        };

        /** 读块并把稿对上去；读不出来时稿原样留着。 */
        const align = async (): Promise<readonly Conflict[] | Blocker> => {
            const draft = state.draft;
            if (draft === null) return [];
            const read = await readBlocks(draft.at);
            // 读的途中稿被放弃了：不把它带回来。
            if (state.draft === null) return [];
            if (typeof read === "string") {
                state.blocker = read;
                state.read = null;
                return read;
            }
            // 读的时候作者又打了字：以读回来时的稿为准去对。
            const rebased = rebase(state.draft, read);
            state.blocker = null;
            state.read = read;
            state.draft = rebased.draft;
            return rebased.conflicts;
        };

        const clear = async (): Promise<void> => {
            state.draft = null;
            state.read = null;
            state.blocker = null;
            state.conflicts = [];
            state.problems = {};
            state.phase = "idle";
            // 别的窗口这期间写过这条记录时删不掉（条件写）：那是那边的稿，留着。
            if (state.saved === "diverged") state.saved = "none";
            else await persist();
            if (state.saved !== "none") state.saved = "none";
        };

        const withoutPending = (draft: TextDraft): TextDraft => {
            const {pending: _sent, ...rest} = draft;
            return rest;
        };

        const input = (draft: TextDraft, ops: ReturnType<typeof compile>["ops"]) => ({
            requestId: draft.pending!.requestId,
            by: {kind: "author" as const},
            what: "edit" as const,
            title: options.title(),
            baseVersion: draft.pending!.stamp.version,
            readStamp: draft.pending!.stamp,
            intent: "creative" as const,
            position: draft.at,
            ops: [...ops],
        });

        /** 发出去以后按结果收场。世界变了（`again`）由调用方决定重读再来。 */
        const settle = async (result: Awaited<ReturnType<CanonWorld["write"]>>, keys: readonly string[]): Promise<SubmitResult | "again"> => {
            if (result.ok) {
                const written = result.value as Written;
                await clear();
                return {status: "published", revision: written.revision, version: written.version};
            }
            const failure = result.failure;
            // 同一个请求 id 已经发布过、只是内容对不上（例如标题换了语言）：那一次发布了。
            if (failure.code === "request-id-reused") {
                await clear();
                return {status: "published"};
            }
            // 发出去了、没等到结果（`unknown-outcome`），或内核说日志定不了（`write-unknown`）。`write-failed` 是世界客户端在结局
            // 不明以后查了一次、查到“没发布”：那一次查询可能早于原请求落盘，不当定论。没发出去的（`unavailable` 这些）是确定的失败。
            if (failure.code === "unknown-outcome" || failure.code === "write-failed" || failure.code === "write-unknown") {
                state.phase = "confirming";
                return {status: "unknown"};
            }
            state.draft = withoutPending(state.draft!);
            await persist();
            if (failure.code === "stale-read" || failure.code === "version-conflict" || failure.code === "value-conflict") return "again";
            state.phase = "idle";
            if (failure.code === "validation-failed") {
                const problems: Record<string, BlockProblem> = {};
                for (const item of (failure.problems as ReadonlyArray<{code: string; message: string; op?: number; path?: string}> | undefined) ?? []) {
                    const op = item.op ?? Number(/^ops\[(\d+)\]$/u.exec(item.path ?? "")?.[1] ?? Number.NaN);
                    const key = keys[op];
                    if (key !== undefined) problems[key] = {kind: "rejected", code: item.code, message: item.message};
                }
                if (Object.keys(problems).length > 0) {
                    state.problems = problems;
                    return {status: "problems"};
                }
            }
            return {status: "failed", failure};
        };

        /**
         * 把请求 id 与读取戳写进稿并等存储确认，然后才能发（Spec 输出 46）。写不进去就不发：刷新以后存储里可能留着更早的
         * 一份稿，没有 `pending` 的它会被当成没提交过、把同样的新块再加一遍。没有 Storage 的窗口稿只在内存里，不存在这个问题。
         */
        const freeze = async (pending: PendingSubmit): Promise<StorageFailure | null> => {
            state.draft = {...state.draft!, pending};
            const frozen = await persist();
            if (frozen.ok) return null;
            state.draft = withoutPending(state.draft);
            return frozen.code;
        };

        const attempt = async (): Promise<SubmitResult> => {
            const world = options.world();
            if (world === null) return {status: "blocked", reason: "unavailable"};
            for (let round = 0; round < SUBMIT_ATTEMPTS; round += 1) {
                const conflicts = await align();
                if (typeof conflicts === "string") return {status: "blocked", reason: conflicts};
                state.conflicts = conflicts;
                if (conflicts.length > 0) {
                    touch();
                    return {status: "conflicts"};
                }
                const [draft, read] = [state.draft!, state.read!];
                const compiled = compile(draft, read, entry);
                if (Object.keys(compiled.problems).length > 0) {
                    state.problems = Object.fromEntries(Object.entries(compiled.problems).map(([key, reason]) => [key, {kind: "blocked" as const, reason}]));
                    return {status: "problems"};
                }
                state.problems = {};
                if (compiled.ops.length === 0) {
                    await clear();
                    return {status: "nothing"};
                }
                if (compiled.tooMany) return {status: "too-many", count: compiled.ops.length};
                const pending: PendingSubmit = {requestId: newRequestId(), stamp: {version: read.version, input: read.inputDigest}};
                const request = input({...draft, pending}, compiled.ops);
                if (encodedBytes({input: request}) > CANON_BUDGET_BYTES) return {status: "too-large"};
                const failed = await freeze(pending);
                if (failed !== null) return {status: "not-saved", code: failed};
                const settled = await settle(await write(world, request), compiled.keys);
                if (settled !== "again") return settled;
            }
            return {status: "contended"};
        };

        const write = async (world: CanonWorld, request: ReturnType<typeof input>): Promise<Awaited<ReturnType<CanonWorld["write"]>>> => {
            try {
                return await world.write("editEntries", {input: request});
            } catch (error) {
                options.report?.(error);
                return {ok: false, failure: {code: "unknown-outcome"}};
            }
        };

        const guarded = async (run: () => Promise<SubmitResult>): Promise<SubmitResult> => {
            if (state.phase === "submitting" || state.draft === null) return {status: "busy"};
            const from = state.phase;
            state.phase = "submitting";
            try {
                return await run();
            } finally {
                // `settle` 自己会把结局不明记成 confirming、把发布与确定的拒收记成 idle；别的出口（冲突、放不进去、出错）回到原来的。
                if (state.phase === "submitting") state.phase = from === "confirming" && state.draft?.pending !== undefined ? "confirming" : "idle";
            }
        };

        /**
         * 上一次提交结局不明。两种情形都不会发布两次：
         *
         * - 世界还是那次读到的样子（读取戳没变）：原请求要么还没处理、要么根本没到。稿没变，重建出来的请求逐字相同，用同一个
         *   请求 id 再发：内核先判请求 id，原请求先落盘的话这一次拿回它的结果。
         * - 世界已经变了：原请求带的是旧戳，之后再到也会被拒收，所以它只可能是在此之前发布的。这时问结局才可信：发布了就
         *   收场；没发布就当作一份普通的稿（重新对一遍），由作者再提交，新的提交用新的请求 id。
         */
        const confirm = (): Promise<SubmitResult> => guarded(async () => {
            const pending = state.draft?.pending;
            if (pending === undefined) return attempt();
            const world = options.world();
            if (world === null) return {status: "unknown"};
            const read = await readBlocks(state.draft!.at);
            if (read === "unavailable") return {status: "unknown"};
            if (typeof read !== "string" && read.version === pending.stamp.version && read.inputDigest === pending.stamp.input) {
                state.read = read;
                state.blocker = null;
                const compiled = compile(withoutPending(state.draft!), read, entry);
                const settled = await settle(await write(world, input(state.draft!, compiled.ops)), compiled.keys);
                return settled === "again" ? attempt() : settled;
            }
            let found: CanonOutputs["outcome"];
            try {
                const outcome = await options.call("outcome", {requestId: pending.requestId});
                if (!outcome.ok) return {status: "unknown"};
                found = outcome.value;
            } catch (error) {
                options.report?.(error);
                return {status: "unknown"};
            }
            if (found.published) {
                await clear();
                return {status: "published", revision: found.revision, version: found.version};
            }
            state.draft = withoutPending(state.draft!);
            state.phase = "idle";
            await persist();
            await align();
            return {status: "not-published"};
        });

        const load = (): Promise<void> => (loading ??= (async () => {
            const record = await open();
            if (record !== null && typeof record !== "string") {
                const snapshot = await enqueue(() => record.read());
                if (snapshot.status === "ok") {
                    revision = snapshot.revision;
                    state.draft = snapshot.value;
                    state.saved = "saved";
                } else if (snapshot.status === "missing") revision = snapshot.revision;
                else if (snapshot.status === "corrupt" || snapshot.status === "unsupported-version") {
                    revision = snapshot.revision;
                    reset = true;
                } else state.saved = "failed";
            } else if (typeof record === "string") state.saved = "failed";
            state.loaded = true;
            if (state.draft === null) return;
            if (state.draft.pending !== undefined) {
                state.phase = "confirming";
                await confirm();
                return;
            }
            await align();
        })().catch((error: unknown) => {
            options.report?.(error);
            state.loaded = true;
        }));

        return {
            state,
            load,
            begin: async (position) => {
                await load();
                if (state.draft !== null) return state.blocker;
                const read = await readBlocks(position);
                if (typeof read === "string") return read;
                // 等读取的时候别处（另一次点击）已经开始了：不盖它。
                if (state.draft !== null) return null;
                state.read = read;
                state.blocker = null;
                state.draft = emptyDraft(read);
                return null;
            },
            edit: (change) => {
                const [draft, read] = [state.draft, state.read];
                if (draft === null || read === null || state.phase !== "idle" || draft.pending !== undefined) return;
                const next = change(draft, read);
                if (next === draft) return;
                state.draft = next;
                if (Object.keys(state.problems).length > 0) state.problems = {};
                touch();
            },
            flush: async () => {
                if (cancelSave === null && state.saved !== "unsaved") return;
                await persist();
            },
            discard: async () => {
                // 放弃时别的窗口的稿不动；这个窗口自己存下的那一份删掉。
                await clear();
            },
            submit: () => guarded(attempt),
            confirm,
            choose: (conflict, choice) => {
                const [draft, read] = [state.draft, state.read];
                if (draft === null || read === null) return;
                state.draft = resolve(draft, read, conflict, choice);
                state.conflicts = state.conflicts.filter((item) => item !== conflict);
                touch();
            },
            takeOver: () => enqueue(async () => {
                const record = await open();
                if (record === null || typeof record === "string") return;
                const snapshot = await record.read();
                if (snapshot.status === "error") return;
                revision = snapshot.revision;
                reset = snapshot.status === "corrupt" || snapshot.status === "unsupported-version";
                state.saved = "unsaved";
            }).then(async () => {
                await persist();
            }),
            adopt: async () => {
                const snapshot = await enqueue(async () => {
                    const record = await open();
                    return record === null || typeof record === "string" ? null : record.read();
                });
                if (snapshot === null || snapshot.status === "error") return;
                revision = snapshot.revision;
                state.conflicts = [];
                state.problems = {};
                if (snapshot.status !== "ok") {
                    state.draft = null;
                    state.read = null;
                    state.saved = "none";
                    state.phase = "idle";
                    return;
                }
                state.draft = snapshot.value;
                state.saved = "saved";
                state.phase = snapshot.value.pending === undefined ? "idle" : "confirming";
                if (snapshot.value.pending === undefined) await align();
                else await confirm();
            },
            reload: async () => {
                if (state.draft === null || state.phase === "submitting") return;
                if (state.draft.pending !== undefined) await confirm();
                else await align();
            },
        };
    };

    const session = (entry: string): TextDraftSession => {
        let found = sessions.get(entry);
        if (found === undefined) {
            found = create(entry);
            sessions.set(entry, found);
        }
        return found;
    };

    return {
        session,
        uncommitted: (entry) => {
            const current = session(entry);
            if (!current.state.loaded) void current.load();
            const draft = current.state.draft;
            return draft !== null && (hasChanges(draft) || draft.pending !== undefined);
        },
    };
}

/** 稿的一份普通对象副本（存储的调用要结构化复制，响应式代理过不去）。 */
function plain(draft: TextDraft): TextDraft {
    return JSON.parse(JSON.stringify(draft)) as TextDraft;
}
