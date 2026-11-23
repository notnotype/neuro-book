/**
 * 主文字的稿在这个窗口里的登记（docs/specs/canon/author-ui.md 输出 44 到 46）：每个条目一份编辑会话，管三件事——
 *
 * 1. **暂存**：稿存在这部作品的本机记录里，一个条目一条。这个窗口对一条记录的写是串行的，每次都带上一次确认的 revision
 *    （条件写）。别的窗口写过这条记录时条件写失败：停止自动暂存、状态变成 `diverged`，由作者选用哪边，两边都不自动丢。存储的
 *    结局不明（回执丢了）时先把记录读回来核对，再决定下一步；放弃要确认记录真的删了才算完成。
 * 2. **提交**：读块、把稿对上去（`rebase`）、编成操作（`compile`），带读取戳发给内核。世界在读与写之间变了就重读再来，
 *    至多 `SUBMIT_ATTEMPTS` 次。
 * 3. **提交的结局**：发出之前把整份请求冻结进稿（`pending`）并等存储确认；结局不明时留着它，之后只原样重发这同一个请求
 *    （内核按请求 id 保证最多发布一次），不从稿重编、不换请求 id。什么算“确定没有发布”见 `settle`。
 *
 * 会话不随页面组件卸载：标签不在前台时圆点还要问“有没有未提交的内容”。提交在途（`phase` 是 `submitting`）时会话不接别的动作：
 * 放弃、编辑、选冲突、换稿都要等它收场，免得在途的那一次拿着后来的稿继续往下走。纯逻辑在 `text-draft.ts`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";
import {reactive} from "vue";

import {ReadPositionSchema} from "@notnotype/nb-canon/schema";
import type {EntryOp, ReadPosition} from "@notnotype/nb-canon/schema";

import {defineRecord, MAX_RECORD_MAX_BYTES} from "nbook/shared/storage";
import type {RecordHandle, Revision, StorageFailure, StorageService} from "nbook/shared/storage";

import {CANON_BUDGET_BYTES, encodedBytes} from "../shared/contracts";
import type {CanonClient, CanonFailure, CanonOutputs} from "../shared/contracts";
import {compile, emptyDraft, hasChanges, own, rebase, resolve} from "./text-draft";
import type {Blocked, Choice, Conflict, PendingSubmit, TextDraft, TextRead} from "./text-draft";
import type {CanonWorld} from "./world";

const Texts = Type.Record(Type.String(), Type.String());
const BlockAt = Type.Object({entry: Type.String(), path: Type.String()});
/**
 * 存下来的冻结请求里的一项操作。块的文字不再存一遍：改字的 `value` 与 `read`、加块的 `source` 与稿里那一块的文字相同时省掉
 * （几乎总是相同），读回来照稿补上。不省的话，一块几百 KB 的修改，稿存得下、请求发得出，冻结却存不下（同一段字在记录里有
 * 两三份）。冻结期间稿不变，补回来的与冻结时逐字相同。
 */
const StoredOpSchema = Type.Union([
    Type.Object({op: Type.Literal("set"), at: BlockAt, value: Type.Optional(Type.String()), read: Type.Optional(Type.String())}),
    Type.Object({op: Type.Literal("addBlock"), entry: Type.String(), source: Type.Optional(Type.String()), after: Type.Optional(Type.Union([Type.String(), Type.Null()]))}),
    Type.Object({op: Type.Literal("removeBlock"), at: BlockAt}),
]);
const DraftSchema = Type.Object({
    at: ReadPositionSchema,
    order: Type.Array(Type.String()),
    base: Texts,
    texts: Texts,
    removed: Type.Array(Type.String()),
    routes: Type.Optional(Texts),
    moved: Type.Optional(Type.Array(Type.String())),
    merged: Type.Optional(Type.Record(Type.String(), Type.Object({into: Type.String(), head: Type.String(), joined: Type.String()}))),
    split: Type.Optional(Type.Record(Type.String(), Type.Object({from: Type.String(), text: Type.String()}))),
    pending: Type.Optional(Type.Object({
        requestId: Type.String(),
        title: Type.String(),
        stamp: Type.Object({version: Type.Integer(), input: Type.String()}),
        ops: Type.Array(StoredOpSchema),
        keys: Type.Array(Type.String()),
    })),
});
type StoredDraft = Static<typeof DraftSchema>;
type StoredOp = Static<typeof StoredOpSchema>;

/** 一个条目一条，键是条目 id；只在这台机器的这份浏览器配置里（`local`）。 */
export const TEXT_DRAFTS_RECORD = defineRecord({key: "canon.text-drafts", scope: "project", locality: "local", version: 1, keyed: true, maxBytes: MAX_RECORD_MAX_BYTES, schema: DraftSchema});

/** 世界在读与写之间一直在变时，重读再发至多几次。 */
export const SUBMIT_ATTEMPTS = 3;
/** 输入停下多久写一次暂存。 */
const SAVE_DELAY_MS = 300;

/**
 * 内核在判过请求 id 之后才会给的拒收：收到它说明这个请求 id 当时没有发布过，而且这一次也没有发布。别的失败（别人独占、世界
 * 只读、连不上）发生在判请求 id 之前，证明不了原来那一次有没有发布。这张表照内核写入的公共路径列（`WorldService` 的 `#write`：
 * 判请求 id 之前只有停止、只读、独占那几种）；内核添了新的拒收而这里没跟上时，重发碰到它会停在“正在确认”，只能放弃，不会
 * 发布两次。`too-large` 是日志一行超过上限：请求在调用方一侧超过预算时根本发不出去，冻结的请求既然发出过，重发时不会是那一种。
 */
const REJECTED: ReadonlySet<string> = new Set([
    "stale-read", "version-conflict", "value-conflict", "validation-failed", "result-mismatch", "field-unavailable", "incomplete-field", "accumulated-value",
    "chapter-not-found", "line-not-found", "intent-not-allowed", "not-deletable", "source-not-writable", "author-source-invalid", "author-source-required", "too-large",
]);

/** 暂存的状态：`none` 没有要存的；`diverged` 是别的窗口写过这条记录。 */
export type SavedState = "none" | "saved" | "unsaved" | "failed" | "too-large" | "diverged";

/** 进不了编辑、或稿对不上世界的原因。`too-large` 是整个条目的主文字超过了一次读取能带回来的大小。 */
export type Blocker = "chapter-not-found" | "line-not-found" | "entry-missing" | "too-large" | "unavailable";

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
    /** 暂存写不进去，没有发（见 `freeze`）。 */
    | {readonly status: "not-saved"; readonly code: StorageFailure}
    /** 重读再发了几次，世界还在变。 */
    | {readonly status: "contended"}
    /** 结局不明：稿留着 `pending`，等 `confirm`。 */
    | {readonly status: "unknown"}
    /** 上一次提交确定没有发布：稿还在，可以再提交。 */
    | {readonly status: "not-published"}
    | {readonly status: "blocked"; readonly reason: Blocker}
    | {readonly status: "failed"; readonly failure: CanonFailure}
    | {readonly status: "busy"};

/** 一块下面要写的原因：稿模型给的，或内核的校验细项。 */
export type BlockProblem = {readonly kind: "blocked"; readonly reason: Blocked} | {readonly kind: "rejected"; readonly code: string; readonly message: string};

export interface TextDraftState {
    /** 存储读到了（有没有稿已经知道）。读失败时仍为假，之后再读。 */
    loaded: boolean;
    /** 在编辑：稿（可以没有改动）。null 是阅读。 */
    draft: TextDraft | null;
    /** 稿对着的那次读取；读不出来时为 null，原因在 `blocker`。 */
    read: TextRead | null;
    blocker: Blocker | null;
    saved: SavedState;
    /** `confirming`：上一次提交冻结了、结果不明。 */
    phase: "idle" | "submitting" | "confirming";
    conflicts: readonly Conflict[];
    problems: Readonly<Record<string, BlockProblem>>;
    /**
     * 读进来就在等结局的稿，会话自己去确认（没有页面在场时也会）得到的“没发布”一类的结局：界面据此写明上一次提交怎么了。
     * 作者再动一下（编辑、提交、放弃）就清掉。
     */
    resumed: SubmitResult | null;
}

export interface TextDraftSession {
    readonly state: TextDraftState;
    /** 读存下来的稿；有稿就读块、对上去。读成功以后重复调用不再读；读失败的下一次调用再读。 */
    load(): Promise<void>;
    /**
     * 开始编辑：先重读存储（别的窗口留下的稿、上次没删掉的稿要接着用），没有稿才在这个位置读块、建一份没有改动的稿。读不出来
     * 时返回原因。已经在编辑时什么也不做。
     */
    begin(position: ReadPosition): Promise<Blocker | null>;
    /** 一次编辑。提交在途、等结局、读不出块时不生效。 */
    edit(change: (draft: TextDraft, read: TextRead) => TextDraft): void;
    /** 现在就把稿写进存储（输入框失焦、页面转入后台）。 */
    flush(): Promise<void>;
    /**
     * 离开编辑：存下来的稿删掉、内存里的丢掉（有改动时调用方先问过作者）。存储里那一份删不掉（连不上）时不离开、返回假：否则
     * 重开以后它又回来了。提交在途时不能放弃；等结局期间可以，只丢本机的稿。
     */
    discard(): Promise<boolean>;
    /** `title` 是这次修订的标题。上一次提交还没有确定的结局时等于 `confirm`。 */
    submit(title: string): Promise<SubmitResult>;
    /** 上一次提交结局不明时再确认一次（连上以后、作者点“再试”）。 */
    confirm(): Promise<SubmitResult>;
    /** 作者选完了一条冲突。 */
    choose(conflict: Conflict, choice: Choice): void;
    /** 别的窗口也在改时：用这里的内容覆盖那边的。 */
    takeOver(): Promise<void>;
    /** 别的窗口也在改时：换成那边的内容（那边已经没有稿了就回到阅读）。 */
    adopt(): Promise<void>;
    /** 读不出块、读不出存储（连接断了）以后再读一次。 */
    reload(): Promise<void>;
}

export interface TextDrafts {
    /**
     * 这个条目有没有未提交的主文字（响应式）。第一次问时去读存储，读到之前为假；读到的稿等着上一次提交的结局时，接着去确认
     * （见 `load`）。标签条的计算里就在问它：恢复出来、还没打开过的条目页标签靠这一次读取才有圆点。
     */
    uncommitted(entry: string): boolean;
    session(entry: string): TextDraftSession;
}

export interface TextDraftsOptions {
    /** 窗口没有 Storage 时为 null：稿只在内存里。 */
    readonly storage: StorageService | null;
    /** 窗口没有绑定项目时为 null。 */
    readonly world: () => CanonWorld | null;
    readonly call: CanonClient["call"];
    readonly requestId?: () => string;
    /** 推迟执行，返回取消；测试给自己的（不按时长等，直接调 `flush`）。 */
    readonly schedule?: (run: () => void, ms: number) => () => void;
    readonly report?: (error: unknown) => void;
}

type Written = CanonOutputs["editEntries"];
type Persisted = {readonly ok: true} | {readonly ok: false; readonly code: StorageFailure};
type WriteReply = Awaited<ReturnType<CanonWorld["write"]>>;

export function createTextDrafts(options: TextDraftsOptions): TextDrafts {
    const sessions = new Map<string, TextDraftSession>();
    const schedule = options.schedule ?? ((run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    });
    const newRequestId = options.requestId ?? (() => `text-${crypto.randomUUID()}`);

    const create = (entry: string): TextDraftSession => {
        const state: TextDraftState = reactive({loaded: false, draft: null, read: null, blocker: null, saved: "none", phase: "idle", conflicts: [], problems: {}, resumed: null});
        let handle: RecordHandle<StoredDraft> | null = null;
        /** 这个窗口上一次读到或写下的 revision：条件写带它。 */
        let revision: Revision | null = null;
        /** 记录是坏的或别的版本写下的：下一次写用 `reset`。 */
        let reset = false;
        /** 上一次写存储的结局不明（回执丢了）：`attempted` 是那一次要写的值（删除为 null）。下一次动存储之前先读回来核对。 */
        let uncertain: {readonly attempted: StoredDraft | null} | null = null;
        /**
         * 存储里确认存着的那份稿带的冻结请求的 id（那份稿没有冻结、或还不知道存的是什么时为 null）。冻结的请求发出之前它得是
         * 这个请求（Spec 输出 46）：否则回执再丢一次、窗口关掉，重开读到的是没有冻结的旧稿，会把同样的新块再加一遍。
         */
        let durable: string | null = null;
        let cancelSave: (() => void) | null = null;
        /** 每次编辑加一：一次保存回来时还等于它开始时的数，才说明存下去的就是现在的内容。 */
        let edits = 0;
        /** 稿换了一份（放弃、发布、换成那边的、重新开始）就加一：在途的提交回来发现对不上就不再往下走。 */
        let generation = 0;
        /** 存储的读写排成一队：同一条记录上这个窗口不会有两次写同时在途。 */
        let queue: Promise<unknown> = Promise.resolve();
        let loading: Promise<void> | null = null;

        const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
            const next = queue.then(task, task);
            queue = next.catch((error: unknown) => options.report?.(error));
            return next;
        };

        const open = async (): Promise<RecordHandle<StoredDraft> | StorageFailure | null> => {
            if (options.storage === null) return null;
            if (handle !== null) return handle;
            const opened = await options.storage.open(TEXT_DRAFTS_RECORD, entry);
            if (!opened.ok) return opened.code;
            handle = opened.handle;
            return handle;
        };

        /**
         * 上一次写的结局不明：把记录读回来。存下的就是那一次要写的，或 revision 没动（那一次没写进去），都能接着用；别的情形是
         * 别的窗口写过。读不出来时仍不明。只在队列里调用。
         */
        const settleStorage = async (record: RecordHandle<StoredDraft>): Promise<"settled" | "diverged" | "unknown"> => {
            if (uncertain === null) return "settled";
            const snapshot = await record.read();
            if (snapshot.status === "error") return "unknown";
            const landed = uncertain.attempted === null ? snapshot.status === "missing" : snapshot.status === "ok" && Value.Equal(snapshot.value, uncertain.attempted);
            const untouched = snapshot.revision === revision;
            if (landed) durable = uncertain.attempted?.pending?.requestId ?? null;
            uncertain = null;
            if (landed || untouched) {
                revision = snapshot.revision;
                return "settled";
            }
            state.saved = "diverged";
            return "diverged";
        };

        /** 把内存里的稿写进存储（没有改动、也不在等结局时删掉记录）。 */
        const persist = (): Promise<Persisted> => enqueue(async () => {
            cancelSave?.();
            cancelSave = null;
            if (state.saved === "diverged") return {ok: false, code: "conflict" as const};
            const record = await open();
            /** 现在要存的稿；没有改动、也不在等结局时为 null（记录该删掉）。 */
            const kept = (): TextDraft | null => {
                const draft = state.draft;
                return draft !== null && (hasChanges(draft) || draft.pending !== undefined) ? draft : null;
            };
            // 窗口没有 Storage：稿只在内存里。算写成了（没有更早的一份会留在存储里），那一行照样写“没有暂存”。
            if (record === null) {
                state.saved = kept() === null ? "none" : "failed";
                return {ok: true as const};
            }
            if (typeof record === "string") {
                state.saved = "failed";
                return {ok: false, code: record};
            }
            const settled = await settleStorage(record);
            if (settled === "diverged") return {ok: false, code: "conflict" as const};
            if (settled === "unknown") {
                state.saved = "failed";
                return {ok: false, code: "unknown-outcome" as const};
            }
            // 要存的内容与编辑的计数在同一刻取：这一次写在途时作者再打的字不算进它。
            const draft = kept();
            const keep = draft !== null;
            if (!keep && revision === null && !reset) {
                state.saved = "none";
                return {ok: true as const};
            }
            const [seq, value] = [edits, draft === null ? null : toStored(draft)];
            const written = value === null ? await record.remove({expect: revision}) : await (reset ? record.reset(value, {expect: revision}) : record.save(value, {expect: revision}));
            if (written.ok) {
                revision = written.revision;
                reset = false;
                durable = value?.pending?.requestId ?? null;
                // 保存期间作者又打了字：存下去的不是现在的内容，那一次编辑排的保存还在后面。
                state.saved = !keep ? "none" : seq === edits ? "saved" : "unsaved";
                return {ok: true as const};
            }
            if (written.code === "unknown-outcome") uncertain = {attempted: value};
            state.saved = written.code === "conflict" ? "diverged" : written.code === "too-large" ? "too-large" : "failed";
            return {ok: false, code: written.code};
        });

        const touch = (): void => {
            edits += 1;
            if (state.saved !== "diverged") state.saved = "unsaved";
            cancelSave?.();
            cancelSave = schedule(() => void persist(), SAVE_DELAY_MS);
        };

        const readBlocks = async (position: ReadPosition): Promise<TextRead | Blocker> => {
            try {
                const result = await options.call("textBlocks", {id: entry, position});
                if (!result.ok) return result.failure.code === "chapter-not-found" || result.failure.code === "line-not-found" || result.failure.code === "too-large" ? result.failure.code : "unavailable";
                return result.value ?? "entry-missing";
            } catch (error) {
                options.report?.(error);
                return "unavailable";
            }
        };

        /** 读块并把稿对上去；读不出来时稿原样留着。 */
        const align = async (): Promise<readonly Conflict[] | Blocker> => {
            const [draft, mine] = [state.draft, generation];
            if (draft === null) return [];
            const read = await readBlocks(draft.at);
            // 读的途中稿换了一份（放弃了、换成了那边的）：这次读到的不是给它的。
            if (state.draft === null || generation !== mine) return [];
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

        /** 内存里回到阅读。 */
        const leave = (): void => {
            generation += 1;
            cancelSave?.();
            cancelSave = null;
            state.draft = null;
            state.read = null;
            state.blocker = null;
            state.conflicts = [];
            state.problems = {};
            state.resumed = null;
            state.phase = "idle";
        };

        /** 发布了：回到阅读，再把存下来的稿删掉。删不掉（连不上）不要紧：它带着 `pending`，下次读到时一问结局就收场。 */
        const finish = async (): Promise<void> => {
            leave();
            if (state.saved === "diverged") state.saved = "none";
            else await persist();
            if (state.saved === "saved" || state.saved === "unsaved") state.saved = "none";
        };

        const withoutPending = (draft: TextDraft): TextDraft => {
            const {pending: _sent, ...rest} = draft;
            return rest;
        };

        const request = (draft: TextDraft, pending: PendingSubmit) => ({
            requestId: pending.requestId,
            by: {kind: "author" as const},
            what: "edit" as const,
            title: pending.title,
            baseVersion: pending.stamp.version,
            readStamp: pending.stamp,
            intent: "creative" as const,
            position: draft.at,
            ops: [...pending.ops],
        });

        const write = async (world: CanonWorld, input: ReturnType<typeof request>): Promise<WriteReply> => {
            try {
                return await world.write("editEntries", {input});
            } catch (error) {
                options.report?.(error);
                return {ok: false, failure: {code: "unknown-outcome"}};
            }
        };

        /**
         * 一次发送回来以后收场。`resend` 是结局不明以后的原样重发。
         *
         * - 发布了（或内核说这个请求 id 早就发布过）：收场。
         * - 回执丢了（`unknown-outcome`）、内核说日志定不了（`write-unknown`）、世界客户端在结局不明以后查到“没发布”
         *   （`write-failed` 带 `after`：那一次查询可能早于原请求落盘）：结局不明，留着冻结的请求。
         * - 内核在判过请求 id 之后的拒收（`REJECTED`）、写日志明确失败（不带 `after` 的 `write-failed`）：确定没有发布，解冻。
         * - 其余（别人独占、世界只读、没发出去）：第一次发送时说明请求根本没有开始，解冻；重发时它们发生在判请求 id 之前，说明
         *   不了原来那一次，照结局不明留着。
         *
         * 返回 `again` 是世界在读与写之间变了，由调用方重读再来。
         */
        const settle = async (result: WriteReply, keys: readonly string[], resend: boolean): Promise<SubmitResult | "again"> => {
            if (result.ok) {
                const written = result.value as Written;
                await finish();
                return {status: "published", revision: written.revision, version: written.version};
            }
            const failure = result.failure;
            if (failure.code === "request-id-reused") {
                await finish();
                return {status: "published"};
            }
            const lost = failure.code === "unknown-outcome" || failure.code === "write-unknown" || (failure.code === "write-failed" && failure.after !== undefined);
            const rejected = REJECTED.has(failure.code) || (failure.code === "write-failed" && failure.after === undefined);
            if (lost || (resend && !rejected)) {
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
         * 把整份请求冻结进稿并等存储确认，然后才能发（Spec 输出 46）。写不进去就不发：刷新以后存储里可能留着更早的一份稿，
         * 没有 `pending` 的它会被当成没提交过、把同样的新块再加一遍。存储的回执丢了、又读不回来核对时，那条记录里可能已经有
         * 这份冻结：内存里也留着它，当作结局不明，连上以后由 `confirm` 原样发出去。没有 Storage 的窗口稿只在内存里，不存在这个问题。
         */
        const freeze = async (pending: PendingSubmit): Promise<"frozen" | "unknown" | StorageFailure> => {
            state.draft = {...state.draft!, pending};
            const frozen = await persist();
            if (frozen.ok) return "frozen";
            // 结局不明的得是这一次冻结的写。更早一次写的结局还读不回来时，这一次根本没写：请求没发出过，照没冻结上处理。
            if (uncertain !== null && uncertain.attempted?.pending?.requestId === pending.requestId) return "unknown";
            state.draft = withoutPending(state.draft);
            return frozen.code;
        };

        const attempt = async (title: string): Promise<SubmitResult> => {
            const world = options.world();
            if (world === null) return {status: "blocked", reason: "unavailable"};
            const mine = generation;
            for (let round = 0; round < SUBMIT_ATTEMPTS; round += 1) {
                const conflicts = await align();
                if (generation !== mine || state.draft === null) return {status: "busy"};
                if (typeof conflicts === "string") return {status: "blocked", reason: conflicts};
                state.conflicts = conflicts;
                if (conflicts.length > 0) {
                    touch();
                    return {status: "conflicts"};
                }
                const [draft, read] = [state.draft, state.read!];
                const compiled = compile(draft, read, entry);
                if (compiled.problems.size > 0) {
                    state.problems = Object.fromEntries([...compiled.problems].map(([key, reason]) => [key, {kind: "blocked" as const, reason}]));
                    return {status: "problems"};
                }
                state.problems = {};
                if (compiled.ops.length === 0) {
                    await finish();
                    return {status: "nothing"};
                }
                if (compiled.tooMany) return {status: "too-many", count: compiled.ops.length};
                const pending: PendingSubmit = {requestId: newRequestId(), title, stamp: {version: read.version, input: read.inputDigest}, ops: compiled.ops, keys: compiled.keys};
                const input = request(draft, pending);
                if (encodedBytes({input}) > CANON_BUDGET_BYTES) return {status: "too-large"};
                const frozen = await freeze(pending);
                if (generation !== mine) return {status: "busy"};
                if (frozen === "unknown") {
                    state.phase = "confirming";
                    return {status: "unknown"};
                }
                if (frozen !== "frozen") return {status: "not-saved", code: frozen};
                const settled = await settle(await write(world, input), compiled.keys, false);
                if (settled !== "again") return settled;
                if (generation !== mine) return {status: "busy"};
            }
            return {status: "contended"};
        };

        const guarded = async (run: () => Promise<SubmitResult>): Promise<SubmitResult> => {
            if (busy() || state.draft === null) return {status: "busy"};
            const from = state.phase;
            state.phase = "submitting";
            state.resumed = null;
            try {
                return await run();
            } finally {
                // `settle` 自己会把结局不明记成 confirming、把发布与确定的拒收记成 idle；别的出口（冲突、放不进去、出错）回到原来的。
                if (state.phase === "submitting") state.phase = from === "confirming" && state.draft?.pending !== undefined ? "confirming" : "idle";
            }
        };

        /**
         * 上一次提交结局不明。先问一次结局：问到已经发布就收场（不依赖读块：条目变大到读不回来时也收得了场）。问到“没发布”不
         * 作数（那一次查询不排在写队列里，可能早于原请求落盘）：把冻结的请求原样再发一次。内核先判请求 id：原请求先落盘的话
         * 这一次拿回它的结果，否则由这一次发布，或给出确定的拒收（见 `settle`）。
         */
        const confirm = (): Promise<SubmitResult> => guarded(async () => {
            const [draft, mine] = [state.draft!, generation];
            const pending = draft.pending;
            if (pending === undefined) return {status: "not-published"};
            const world = options.world();
            if (world === null) return {status: "unknown"};
            // 冻结的写结局不明、其实没写进去的：先补上（读回来核对，没有就再写），补不上就不发。
            if (options.storage !== null && durable !== pending.requestId) {
                const saved = await persist();
                if (generation !== mine) return {status: "busy"};
                if (!saved.ok || durable !== pending.requestId) return {status: "unknown"};
            }
            try {
                const outcome = await options.call("outcome", {requestId: pending.requestId});
                if (generation !== mine) return {status: "busy"};
                if (outcome.ok && outcome.value.published) {
                    await finish();
                    return {status: "published", revision: outcome.value.revision, version: outcome.value.version};
                }
            } catch (error) {
                options.report?.(error);
            }
            const reply = await write(world, request(draft, pending));
            if (generation !== mine) return {status: "busy"};
            const settled = await settle(reply, pending.keys, true);
            if (settled === "again") state.phase = "idle";
            // 确定没有发布：回到一份普通的稿。世界变了的重新对一遍；读进来就在等结局的稿还没读过块，读一次，作者才能接着改。
            if (state.draft !== null && state.draft.pending === undefined && (settled === "again" || state.read === null)) await align();
            return settled === "again" ? {status: "not-published"} : settled;
        });

        /** 把存储里的记录读进来。读不出来返回假（不知道有没有稿）。 */
        const pull = async (): Promise<boolean> => {
            const record = await open();
            if (record === null) return true;
            if (typeof record === "string") return false;
            const snapshot = await enqueue(() => record.read());
            if (snapshot.status === "error") return false;
            // 读的途中稿已经有了（同一个会话的另一处先开始了编辑、作者已经在打字）：不拿读到的记录盖掉它，条件写的基线也不动。
            // 那条记录是别的窗口的稿的话，下一次暂存照常得到“另一个窗口也在改”，由作者选。
            if (state.draft !== null) return true;
            uncertain = null;
            revision = snapshot.revision;
            reset = snapshot.status === "corrupt" || snapshot.status === "unsupported-version";
            durable = snapshot.status === "ok" ? snapshot.value.pending?.requestId ?? null : null;
            if (snapshot.status === "ok") {
                generation += 1;
                state.draft = fromStored(snapshot.value);
                state.saved = "saved";
                state.conflicts = [];
                state.problems = {};
                state.resumed = null;
            }
            return true;
        };

        /** 读进来的稿接着走：等结局的去确认，别的读块对上去。 */
        const resume = async (): Promise<void> => {
            if (state.draft === null) return;
            if (state.draft.pending === undefined) {
                await align();
                return;
            }
            if (state.phase === "idle") state.phase = "confirming";
            const result = await confirm();
            // 这一次确认没有页面在等结果：没发布一类的结局记下来，界面挂上时写明。
            if (state.draft !== null && result.status !== "published" && result.status !== "unknown" && result.status !== "busy") state.resumed = result;
        };

        // 读过了就不再读：之后稿在内存里，再读一次会拿存储里的记录盖掉它。
        const load = (): Promise<void> => (state.loaded ? Promise.resolve() : loading ??= (async () => {
            if (!(await pull())) {
                // 读失败不记成“读过了、没有稿”：下一次再读。
                loading = null;
                state.saved = "failed";
                return;
            }
            state.loaded = true;
            await resume();
        })().catch((error: unknown) => {
            options.report?.(error);
            loading = null;
        }));

        /** 把这个窗口存下的那条记录删掉；别的窗口写过的不动（那是那边的稿）。确认删了（或本来就没有）才返回真。 */
        const drop = (): Promise<boolean> => enqueue(async () => {
            cancelSave?.();
            cancelSave = null;
            if (state.saved === "diverged") return true;
            const record = await open();
            if (record === null) return true;
            if (typeof record === "string") return false;
            const settled = await settleStorage(record);
            // 别的窗口写过：那是那边的稿，不删；这个窗口自己的已经不在记录里了。
            if (settled !== "settled") return settled === "diverged";
            if (revision === null && !reset) return true;
            const removed = await record.remove({expect: revision});
            if (removed.ok) {
                revision = removed.revision;
                reset = false;
                durable = null;
                return true;
            }
            if (removed.code === "conflict") return true;
            if (removed.code === "unknown-outcome") uncertain = {attempted: null};
            return false;
        });

        /** 放弃在途（等存储把记录删掉）。这期间不发请求、不接别的动作：否则记录已经删了、请求才第一次发出去。 */
        let leaving = false;
        const busy = (): boolean => state.phase === "submitting" || leaving;
        /** 在途的那一次开始编辑：同一个会话被两个页面同时点“编辑”时共用它，不各读各的。 */
        let beginning: Promise<Blocker | null> | null = null;

        return {
            state,
            load,
            begin: (position) => (beginning ??= (async (): Promise<Blocker | null> => {
                if (busy()) return "unavailable";
                if (state.draft !== null) return state.blocker;
                // 每次开始编辑都重读存储：别的窗口这期间留下了稿、或上一次没删掉的稿，要接着用，不另开一份把它盖掉。
                if (!(await pull())) return "unavailable";
                state.loaded = true;
                if (state.draft !== null) {
                    await resume();
                    return state.blocker;
                }
                const read = await readBlocks(position);
                if (typeof read === "string") return read;
                // 等读取的时候别处（另一次点击）已经开始了：不盖它。
                if (state.draft !== null) return null;
                generation += 1;
                state.read = read;
                state.blocker = null;
                state.draft = emptyDraft(read);
                state.saved = "none";
                return null;
            })().finally(() => {
                beginning = null;
            })),
            edit: (change) => {
                const [draft, read] = [state.draft, state.read];
                if (draft === null || read === null || state.phase !== "idle" || draft.pending !== undefined) return;
                const next = change(draft, read);
                if (next === draft) return;
                state.draft = next;
                if (Object.keys(state.problems).length > 0) state.problems = {};
                state.resumed = null;
                touch();
            },
            flush: async () => {
                // 上一次没存成（链路断着）的也算：之后作者不再打字、直接切走或关窗时，靠这一次补存。
                if (cancelSave === null && state.saved !== "unsaved" && state.saved !== "failed") return;
                await persist();
            },
            discard: async () => {
                if (busy()) return false;
                leaving = true;
                try {
                    if (!(await drop())) {
                        state.saved = "failed";
                        return false;
                    }
                    leave();
                    state.saved = "none";
                    return true;
                } finally {
                    leaving = false;
                }
            },
            // 有冻结着的请求时不另发一次：先把它的结局弄清楚。
            submit: (title) => (state.draft?.pending !== undefined ? confirm() : guarded(() => attempt(title))),
            confirm,
            choose: (conflict, choice) => {
                const [draft, read] = [state.draft, state.read];
                if (draft === null || read === null || state.phase !== "idle") return;
                state.draft = resolve(draft, read, conflict, choice);
                state.conflicts = state.conflicts.filter((item) => item !== conflict);
                touch();
            },
            takeOver: async () => {
                if (busy() || state.draft === null) return;
                const refreshed = await enqueue(async () => {
                    const record = await open();
                    if (record === null || typeof record === "string") return false;
                    const snapshot = await record.read();
                    if (snapshot.status === "error") return false;
                    uncertain = null;
                    revision = snapshot.revision;
                    reset = snapshot.status === "corrupt" || snapshot.status === "unsupported-version";
                    durable = null;
                    state.saved = "unsaved";
                    return true;
                });
                if (refreshed) await persist();
            },
            adopt: async () => {
                if (busy()) return;
                const record = await open();
                if (record === null || typeof record === "string") return;
                const snapshot = await enqueue(() => record.read());
                if (snapshot.status === "error") return;
                uncertain = null;
                revision = snapshot.revision;
                reset = snapshot.status === "corrupt" || snapshot.status === "unsupported-version";
                durable = snapshot.status === "ok" ? snapshot.value.pending?.requestId ?? null : null;
                // 那边已经没有稿了（发布了、放弃了）：这里也回到阅读。
                if (snapshot.status !== "ok") {
                    leave();
                    state.saved = "none";
                    return;
                }
                generation += 1;
                state.draft = fromStored(snapshot.value);
                state.saved = "saved";
                state.conflicts = [];
                state.problems = {};
                state.phase = "idle";
                await resume();
            },
            reload: async () => {
                if (busy()) return;
                if (!state.loaded) {
                    await load();
                    return;
                }
                await resume();
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

/** 稿存下去的样子：一份普通对象副本（存储的调用要结构化复制，响应式代理过不去），冻结的请求里省掉与稿重复的文字。 */
function toStored(draft: TextDraft): StoredDraft {
    const {pending, ...rest} = JSON.parse(JSON.stringify(draft)) as TextDraft;
    if (pending === undefined) return rest as StoredDraft;
    const ops = pending.ops.map((op, index): StoredOp => {
        const key = pending.keys[index] ?? "";
        if (op.op === "set") {
            const {value, read, ...kept} = op;
            return {...kept, ...(value === own(rest.texts, key) ? {} : {value}), ...(read === undefined || read === own(rest.base, key) ? {} : {read})} as StoredOp;
        }
        if (op.op === "addBlock") {
            const {source, ...kept} = op;
            return {...kept, ...(source === own(rest.texts, key) ? {} : {source})};
        }
        return op as StoredOp;
    });
    return {...rest, pending: {...pending, ops}} as StoredDraft;
}

/** 读回来的记录还原成稿：冻结的请求里省掉的文字照稿补上。 */
function fromStored(stored: StoredDraft): TextDraft {
    const {pending, ...rest} = stored;
    if (pending === undefined) return rest;
    const ops = pending.ops.map((op, index): EntryOp => {
        const key = pending.keys[index] ?? "";
        if (op.op === "set") return {...op, value: op.value ?? own(rest.texts, key) ?? "", read: op.read ?? own(rest.base, key) ?? ""};
        if (op.op === "addBlock") return {...op, source: op.source ?? own(rest.texts, key) ?? ""};
        return op;
    });
    return {...rest, pending: {...pending, ops}};
}
