/**
 * 条目页文字分页的宿主逻辑（docs/specs/canon/author-ui.md 输出 39、44 到 46）：把这个条目的稿会话（`text-drafts.ts`）接到编辑视图
 * `EntryTextEditor` 与冲突对话框 `TextConflictDialog` 上。组件是受控的，写入都在这里：编辑视图的每个动作换成稿模型
 * （`text-draft.ts`）的一次操作；提交的结局换成那一行的说明、冲突对话框或保存后的提示。
 *
 * 会话不随页面卸载（标签不在前台时圆点还要问它），所以这里不持有稿，只持有这一页的界面状态：整批的说明、冲突对话框开没开、
 * 作者在对话框里选到一半的选择。
 */

import {computed, reactive, shallowRef, watch} from "vue";
import type {ComputedRef, ShallowRef} from "vue";

import type {EntryOp, ReadPosition} from "@notnotype/nb-canon/schema";

import type {CanonClient} from "../shared/contracts";
import type {ConflictChoice, ConflictItem} from "./components/TextConflictDialog.vue";
import type {EditorBlock} from "./components/EntryTextEditor.vue";
import {failureText} from "./failures";
import type {CanonNotices} from "./notices";
import {addAfter, allowed, changedCount, isNewKey, isRemoved, mergeUp, removeBlock, restoreBlock, setText, splitAt, SUBMIT_OPS_MAX, textOf} from "./text-draft";
import type {Blocked, Conflict} from "./text-draft";
import {SUBMIT_ATTEMPTS} from "./text-drafts";
import type {BlockProblem, Blocker, SubmitResult, TextDraftSession} from "./text-drafts";
import type {useCanonText} from "./text";
import type {CanonWorld} from "./world";

/** 剧情对话框的一次写入的结局：`changed` 是对话框对着的那一块被别处改了（现在的原文；null 是已经不在了）。 */
export type StoryWritten = {readonly ok: true} | {readonly ok: false; readonly changed: string | null} | {readonly ok: false; readonly failure: string};

export interface TextTabOptions {
    readonly entry: string;
    readonly session: TextDraftSession;
    readonly world: CanonWorld;
    readonly call: CanonClient["call"];
    /** 条目的名字（修订的标题里用）。 */
    readonly name: () => string;
    /** 没有稿时这一页的读取位置：开始编辑用它。 */
    readonly position: () => ReadPosition;
    /** 现在写不了的原因（按计划开着、只读、别人独占、断开），已经是界面文字；空串是能写。 */
    readonly blocked: () => string;
    readonly notices: Pick<CanonNotices, "show">;
    readonly text: ReturnType<typeof useCanonText>;
    /** 把窗口的翻译端口交来：失败原因是文字引用，要它译成界面文字。 */
    readonly translate: (value: ReturnType<typeof failureText>["text"]) => string;
}

export interface TextTab {
    /** 在编辑（有稿，可以没有改动）。 */
    readonly editing: ComputedRef<boolean>;
    /** 有稿时这一页该停在的位置（稿开始时内核解析后的位置）。 */
    readonly lockedAt: ComputedRef<ReadPosition | null>;
    /** 有没提交的内容：剧情的入口这时不可用。 */
    readonly dirty: ComputedRef<boolean>;
    /** 编辑视图的属性。 */
    readonly editor: ComputedRef<{
        readonly blocks: readonly EditorBlock[];
        readonly addFirstBlocked: string;
        readonly count: number;
        readonly saved: TextDraftSession["state"]["saved"];
        readonly phase: TextDraftSession["state"]["phase"];
        readonly submitBlocked: string;
        readonly message: string;
        readonly frozen: boolean;
    }>;
    readonly conflicts: ComputedRef<readonly ConflictItem[]>;
    /** 冲突对话框开着。 */
    readonly asking: ShallowRef<boolean>;
    start(): Promise<void>;
    update(key: string, text: string): void;
    add(after: string | null): void;
    split(key: string, offset: number): void;
    merge(key: string): void;
    remove(key: string): void;
    restore(key: string): void;
    flush(): void;
    leave(): Promise<void>;
    submit(): Promise<void>;
    retry(): Promise<void>;
    takeOver(): Promise<void>;
    adopt(): Promise<void>;
    choose(id: string, choice: ConflictChoice): void;
    confirmConflicts(): Promise<void>;
    /**
     * 剧情的三个对话框的写入（输出 39）：记一条剧情变化。带读块时的读取戳，之间世界变了就重读；`block` 是对话框对着的那一块与
     * 打开时的原文，重读到的原文不一样就不发、交回现在的。
     */
    storyWrite(request: {readonly title: string; readonly ops: EntryOp[]; readonly block?: {readonly id: string; readonly source: string}}): Promise<StoryWritten>;
}

export function useTextTab(options: TextTabOptions): TextTab {
    const {session, text} = options;
    const state = session.state;
    /** 整批的说明：最近一次提交没发出去的原因、开始编辑时读不出块的原因。作者再动一下就收起。 */
    const message = shallowRef("");
    const asking = shallowRef(false);
    const choices = reactive<Record<string, ConflictChoice>>({});

    const blockerText = (blocker: Blocker): string => text(blocker === "chapter-not-found" ? "textEdit.blockerChapter" : blocker === "line-not-found" ? "textEdit.blockerLine" : blocker === "entry-missing" ? "textEdit.blockerEntry" : "textEdit.blockerUnavailable");

    const reason = (blocked: Blocked | null): string => {
        if (blocked === null) return "";
        switch (blocked.kind) {
            case "story": return text("textEdit.blockedStory");
            case "carried": return text("textEdit.blockedCarried");
            case "before-story": return text("textEdit.blockedBeforeStory");
            case "not-adjacent": return text("textEdit.blockedNotAdjacent");
            case "first": return text("textEdit.blockedFirst");
            case "removed": return text("textEdit.blockedRemoved");
            case "gone": return text("textEdit.blockedGone");
        }
    };
    const problemText = (problem: BlockProblem | undefined): string => {
        if (problem === undefined) return "";
        if (problem.kind === "rejected") return text("textEdit.problemRejected", {message: problem.message});
        return problem.reason.kind === "before-story" || problem.reason.kind === "carried" ? text("textEdit.problemSlot") : text("textEdit.problemClear");
    };

    const blocks = computed((): EditorBlock[] => {
        const [draft, read] = [state.draft, state.read];
        if (draft === null) return [];
        if (read === null) {
            // 读不出块：只有稿里动过的文字可看。
            const frozen = text("textEdit.blockedGone");
            return draft.order.filter((key) => draft.texts[key] !== undefined || isRemoved(draft, key)).map((key) => ({
                key,
                text: draft.texts[key] ?? draft.base[key] ?? "",
                state: isNewKey(key) ? "new" : isRemoved(draft, key) ? "removed" : "edited",
                story: false,
                blocked: {edit: frozen, remove: frozen, split: frozen, merge: frozen, add: frozen},
                problem: "",
            }));
        }
        const can = allowed(draft, read);
        return draft.order.map((key): EditorBlock => {
            const info = read.blocks.find((block) => block.id === key);
            const allow = can.blocks[key]!;
            const blockState: EditorBlock["state"] = isNewKey(key) ? "new" : isRemoved(draft, key) ? "removed" : info === undefined ? "gone" : draft.base[key] !== undefined ? "edited" : "same";
            return {
                key,
                text: textOf(draft, read, key),
                state: blockState,
                story: info !== undefined && (info.fixed.length > 0 || info.write !== "init"),
                blocked: {edit: reason(allow.edit), remove: reason(allow.remove), split: reason(allow.split), merge: reason(allow.mergeUp), add: reason(allow.addAfter)},
                problem: problemText(state.problems[key]),
            };
        });
    });

    const dirty = computed(() => state.draft !== null && (changedCount(state.draft) > 0 || state.draft.pending !== undefined));

    const conflictItem = (conflict: Conflict): ConflictItem => {
        if (conflict.kind === "changed") return {id: conflict.key, kind: "changed", mine: conflict.mine, theirs: conflict.theirs, choice: choices[conflict.key] ?? null};
        if (conflict.kind === "gone") return {id: conflict.key, kind: "gone", mine: conflict.mine, theirs: null, choice: choices[conflict.key] ?? null};
        // 现在做不了的只有一个选择，不用作者再点一次。
        return {id: conflict.key, kind: "locked", mine: null, theirs: state.read?.blocks.find((block) => block.id === conflict.key)?.source ?? null, reason: text(conflict.remove ? "textEdit.conflictLockedRemove" : "textEdit.conflictLockedEdit"), choice: "theirs"};
    };

    /** 提交（或再确认）的结局换成界面上的东西。 */
    const report = (result: SubmitResult, title: string): void => {
        switch (result.status) {
            case "published":
                if (result.revision !== undefined) options.notices.show({revision: result.revision, title});
                break;
            case "conflicts":
                for (const key of Object.keys(choices)) delete choices[key];
                asking.value = true;
                break;
            case "too-many":
                message.value = text("textEdit.resultTooMany", {count: result.count, max: SUBMIT_OPS_MAX});
                break;
            case "too-large":
                message.value = text("textEdit.resultTooLarge");
                break;
            case "not-saved":
                message.value = text("textEdit.resultNotSaved");
                break;
            case "contended":
                message.value = text("textEdit.resultContended");
                break;
            case "not-published":
                message.value = text("textEdit.resultNotPublished");
                break;
            case "blocked":
                message.value = blockerText(result.reason);
                break;
            case "failed":
                message.value = options.translate(failureText(result.failure).text);
                break;
            // 没有净变化、原因落在块上、结局不明（那一行另有“正在确认”）、重复点击：没有整批的说明。
            case "nothing":
            case "problems":
            case "unknown":
            case "busy":
                break;
        }
    };

    const title = (): string => text("textEdit.title", {name: options.name()});
    const edit = (change: Parameters<TextDraftSession["edit"]>[0]): void => {
        message.value = "";
        session.edit(change);
    };
    /** 发一次提交。`settled` 是作者刚在冲突里选完：这时即使已经没有改动也要走一遍，让会话收场、回到阅读视图。 */
    const submit = async (settled = false): Promise<void> => {
        if (state.draft === null || state.phase !== "idle" || options.blocked() !== "" || (!settled && !dirty.value)) return;
        message.value = "";
        const sent = title();
        report(await session.submit(sent), sent);
    };
    const retry = async (): Promise<void> => {
        message.value = "";
        const sent = state.draft?.pending?.title ?? title();
        report(await session.confirm(), sent);
    };

    // 连上以后：等着结局的再确认一次，读不出块的再读一次。
    watch(() => options.world.connection.value, (now) => {
        if (now !== "online" || state.draft === null) return;
        if (state.phase === "confirming") void retry();
        else if (state.blocker === "unavailable") void session.reload();
    });

    return {
        editing: computed(() => state.draft !== null),
        lockedAt: computed(() => state.draft?.at ?? null),
        dirty,
        editor: computed(() => ({
            blocks: blocks.value,
            addFirstBlocked: state.draft === null || state.read === null ? "" : reason(allowed(state.draft, state.read).first),
            count: state.draft === null ? 0 : changedCount(state.draft),
            saved: state.saved,
            phase: state.phase,
            submitBlocked: options.blocked(),
            message: message.value !== "" ? message.value : state.blocker === null ? "" : blockerText(state.blocker),
            frozen: state.draft !== null && state.read === null,
        })),
        conflicts: computed(() => state.conflicts.map(conflictItem)),
        asking,
        start: async () => {
            message.value = "";
            const failed = await session.begin(options.position());
            if (failed !== null) message.value = blockerText(failed);
            // 没有主文字：先放一个空的新块，进来就能写（空的新块不算改动，也不会发出去）。
            else if (state.draft !== null && state.draft.order.length === 0) session.edit((draft) => addAfter(draft, null).draft);
        },
        update: (key, value) => edit((draft, read) => setText(draft, read, key, value)),
        add: (after) => edit((draft) => addAfter(draft, after).draft),
        split: (key, offset) => edit((draft, read) => splitAt(draft, read, key, offset).draft),
        merge: (key) => edit((draft, read) => mergeUp(draft, read, key)?.draft ?? draft),
        remove: (key) => edit((draft, read) => removeBlock(draft, read, key)),
        restore: (key) => edit((draft) => restoreBlock(draft, key)),
        flush: () => void session.flush(),
        leave: async () => {
            message.value = "";
            asking.value = false;
            await session.discard();
        },
        submit: () => submit(),
        retry,
        takeOver: () => session.takeOver(),
        adopt: () => session.adopt(),
        choose: (id, choice) => {
            choices[id] = choice;
        },
        confirmConflicts: async () => {
            for (const conflict of [...state.conflicts]) session.choose(conflict, conflict.kind === "locked" ? "theirs" : choices[conflict.key] ?? "theirs");
            asking.value = false;
            await submit(true);
        },
        storyWrite: async (request) => {
            for (let round = 0; round < SUBMIT_ATTEMPTS; round += 1) {
                const read = await options.call("textBlocks", {id: options.entry, position: options.position()});
                if (!read.ok) return {ok: false, failure: options.translate(failureText(read.failure).text)};
                if (read.value === null) return {ok: false, failure: text("textEdit.blockerEntry")};
                if (request.block !== undefined) {
                    const now = read.value.blocks.find((block) => block.id === request.block!.id)?.source ?? null;
                    if (now !== request.block.source) return {ok: false, changed: now};
                }
                const result = await options.world.write("editEntries", {input: {
                    requestId: `text-story-${crypto.randomUUID()}`,
                    by: {kind: "author"},
                    what: "edit",
                    title: request.title,
                    baseVersion: read.value.version,
                    readStamp: {version: read.value.version, input: read.value.inputDigest},
                    intent: "story",
                    position: read.value.at,
                    ops: request.ops,
                }});
                if (result.ok) {
                    options.notices.show({revision: result.value.revision, title: request.title});
                    return {ok: true};
                }
                if (result.failure.code !== "stale-read" && result.failure.code !== "version-conflict") return {ok: false, failure: options.translate(failureText(result.failure).text)};
            }
            return {ok: false, failure: text("block.busyElsewhere")};
        },
    };
}
