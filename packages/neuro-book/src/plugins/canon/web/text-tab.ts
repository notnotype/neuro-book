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
import type {EditorBlock} from "./components/entry-text-editor";
import type {ConflictChoice, ConflictItem} from "./components/text-conflict-dialog";
import {failureText} from "./failures";
import type {CanonNotices} from "./notices";
import {addAfter, allowed, changedCount, isNewKey, isRemoved, mergeUp, own, removeBlock, restoreBlock, setText, splitAt, SUBMIT_OPS_MAX, textOf} from "./text-draft";
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
    /** 有没提交的内容。 */
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
    /** 进编辑；返回没进去的原因（读不出块），空串是进去了。没进去时人还在阅读视图，由宿主写在那里。 */
    start(): Promise<string>;
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
    /**
     * 作者在现在写不了的时候按了提交（多半是用键盘）：把原因照整批的说明显示。不存成 `message`：原因是随世界变的（独占放开、
     * 重新连上），它没了这句也跟着收起。
     */
    const blockedAsked = shallowRef(false);
    watch(() => options.blocked(), (now) => {
        if (now === "") blockedAsked.value = false;
    });
    /**
     * 作者在对话框里选到一半的选择，按“这一条冲突是什么”记（哪一块、哪一种、两边各是什么）：回去再改、再提交时同一条冲突还选着；
     * 两边的文字变了、换了一份稿（放弃再开始、换成那边的）就是另一条冲突，不带着上一次的选择。
     */
    const choices = reactive(new Map<string, ConflictChoice>());
    const signature = (conflict: Conflict): string => JSON.stringify([conflict.kind, conflict.key, "mine" in conflict ? conflict.mine : null, "theirs" in conflict ? conflict.theirs : null]);
    const blockerText = (blocker: Blocker): string => text(blocker === "chapter-not-found" ? "textEdit.blockerChapter" : blocker === "line-not-found" ? "textEdit.blockerLine" : blocker === "entry-missing" ? "textEdit.blockerEntry" : blocker === "too-large" ? "textEdit.blockerTooLarge" : "textEdit.blockerUnavailable");

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
            return draft.order.filter((key) => own(draft.texts, key) !== undefined || isRemoved(draft, key)).map((key) => ({
                key,
                text: own(draft.texts, key) ?? own(draft.base, key) ?? "",
                state: isNewKey(key) ? "new" : isRemoved(draft, key) ? "removed" : "edited",
                story: false,
                blocked: {edit: frozen, remove: frozen, split: frozen, merge: frozen, add: frozen},
                problem: "",
            }));
        }
        const can = allowed(draft, read);
        return draft.order.map((key): EditorBlock => {
            const info = read.blocks.find((block) => block.id === key);
            const allow = can.blocks.get(key)!;
            const blockState: EditorBlock["state"] = isNewKey(key) ? "new" : isRemoved(draft, key) ? "removed" : info === undefined ? "gone" : own(draft.base, key) !== undefined ? "edited" : "same";
            return {
                key,
                text: textOf(draft, read, key),
                state: blockState,
                story: info !== undefined && (info.fixed.length > 0 || info.write !== "init"),
                blocked: {edit: reason(allow.edit), remove: reason(allow.remove), split: reason(allow.split), merge: reason(allow.mergeUp), add: reason(allow.addAfter)},
                problem: problemText(own(state.problems, key)),
            };
        });
    });

    const dirty = computed(() => state.draft !== null && (changedCount(state.draft) > 0 || state.draft.pending !== undefined));

    const conflictItem = (conflict: Conflict): ConflictItem => {
        const chosen = choices.get(signature(conflict)) ?? null;
        if (conflict.kind === "changed") return {id: conflict.key, kind: "changed", mine: conflict.mine, theirs: conflict.theirs, choice: chosen};
        if (conflict.kind === "gone") return {id: conflict.key, kind: "gone", mine: conflict.mine, theirs: null, choice: chosen};
        if (conflict.kind === "rerouted") {
            // 拆过、并过的块没有能自动做的选择：只说明情况，作者回去整理。
            if (conflict.manual) return {id: conflict.key, kind: "manual", mine: conflict.mine, theirs: conflict.theirs, reason: text("textEdit.conflictManual"), choice: null};
            return {id: conflict.key, kind: "rerouted", mine: conflict.mine, theirs: conflict.theirs, reason: text("textEdit.conflictRerouted"), choice: chosen};
        }
        // 现在做不了的只有一个选择，不用作者再点一次。
        const why = conflict.reason.kind === "not-adjacent" ? "textEdit.conflictNotAdjacent" : conflict.remove ? "textEdit.conflictLockedRemove" : "textEdit.conflictLockedEdit";
        return {id: conflict.key, kind: "locked", mine: null, theirs: state.read?.blocks.find((block) => block.id === conflict.key)?.source ?? null, reason: text(why), choice: "theirs"};
    };

    /** 一次提交没发出去、要整批写明的原因；别的结局是空串。 */
    const resultMessage = (result: SubmitResult): string => {
        switch (result.status) {
            case "too-many": return text("textEdit.resultTooMany", {count: result.count, max: SUBMIT_OPS_MAX});
            case "too-large": return text("textEdit.resultTooLarge");
            case "not-saved": return text("textEdit.resultNotSaved");
            case "contended": return text("textEdit.resultContended");
            case "not-published": return text("textEdit.resultNotPublished");
            case "blocked": return blockerText(result.reason);
            case "failed": return options.translate(failureText(result.failure).text);
            // 发布了、要作者选、没有净变化、原因落在块上、结局不明（那一行另有“正在确认”）、重复点击：没有整批的说明。
            default: return "";
        }
    };
    /** 提交（或再确认）的结局换成界面上的东西。 */
    const report = (result: SubmitResult, title: string): void => {
        message.value = resultMessage(result);
        if (result.status === "published" && result.revision !== undefined) options.notices.show({revision: result.revision, title});
        if (result.status === "conflicts") {
            // 上一轮选过、这一轮还在的冲突留着选择；不在了的丢掉。
            const still = new Set(state.conflicts.map(signature));
            for (const key of [...choices.keys()]) if (!still.has(key)) choices.delete(key);
            asking.value = true;
        }
    };

    const title = (): string => text("textEdit.title", {name: options.name()});
    const edit = (change: Parameters<TextDraftSession["edit"]>[0]): void => {
        message.value = "";
        session.edit(change);
    };
    /** 发一次提交。`settled` 是作者刚在冲突里选完：这时即使已经没有改动也要走一遍，让会话收场、回到阅读视图。 */
    const submit = async (settled = false): Promise<void> => {
        if (state.draft === null || state.phase === "submitting") return;
        // 现在写不了（只读、别人独占、断开、条目已删除）：不发，原因照整批的说明显示。
        if (options.blocked() !== "") {
            message.value = "";
            blockedAsked.value = true;
            return;
        }
        if (!settled && !dirty.value) return;
        message.value = "";
        const sent = title();
        report(await session.submit(sent), sent);
    };
    const retry = async (): Promise<void> => {
        message.value = "";
        const sent = state.draft?.pending?.title ?? title();
        report(await session.confirm(), sent);
    };

    // 连上以后：断着的时候没读到暂存的现在读，没存上的稿补存，等着结局的再确认一次，读不出块的再读一次。
    watch(() => options.world.connection.value, (now) => {
        if (now !== "online") return;
        if (!state.loaded) {
            void session.reload();
            return;
        }
        if (state.draft === null) return;
        if (state.saved === "failed") void session.flush();
        if (state.phase === "confirming") void retry();
        else if (state.blocker === "unavailable") void session.reload();
    });

    return {
        editing: computed(() => state.draft !== null),
        dirty,
        editor: computed(() => ({
            blocks: blocks.value,
            addFirstBlocked: state.draft === null || state.read === null ? "" : reason(allowed(state.draft, state.read).first),
            count: state.draft === null ? 0 : changedCount(state.draft),
            saved: state.saved,
            phase: state.phase,
            submitBlocked: options.blocked(),
            // 这一页自己发的提交的原因在先；其次是按了提交而现在写不了的原因；再是会话在没有页面时确认出来的结局（读进来就在等
            // 结局的稿）；最后是读不出块的原因。
            message: message.value !== "" ? message.value : blockedAsked.value && options.blocked() !== "" ? options.blocked() : state.resumed !== null && resultMessage(state.resumed) !== "" ? resultMessage(state.resumed) : state.blocker === null ? "" : blockerText(state.blocker),
            frozen: state.draft !== null && state.read === null,
        })),
        conflicts: computed(() => state.conflicts.map(conflictItem)),
        asking,
        start: async () => {
            message.value = "";
            choices.clear();
            const failed = await session.begin(options.position());
            if (state.draft === null) return blockerText(failed ?? "unavailable");
            // 没有主文字：先放一个空的新块，进来就能写（空的新块不算改动，也不会发出去）。
            if (state.draft.order.length === 0) session.edit((draft) => addAfter(draft, null).draft);
            return "";
        },
        update: (key, value) => edit((draft, read) => setText(draft, read, key, value)),
        add: (after) => edit((draft) => addAfter(draft, after).draft),
        split: (key, offset) => edit((draft, read) => splitAt(draft, read, key, offset).draft),
        merge: (key) => edit((draft, read) => mergeUp(draft, read, key)?.draft ?? draft),
        remove: (key) => edit((draft, read) => removeBlock(draft, read, key)),
        restore: (key) => edit((draft, read) => restoreBlock(draft, read, key)),
        flush: () => void session.flush(),
        leave: async () => {
            message.value = "";
            blockedAsked.value = false;
            asking.value = false;
            // 存下来的稿删不掉时不离开（否则重开以后它又回来了）：留在编辑并写明。
            if (await session.discard()) choices.clear();
            else message.value = text("textEdit.resultDiscardFailed");
        },
        submit: () => submit(),
        retry,
        takeOver: async () => {
            message.value = "";
            if ((await session.takeOver()) === "pending") message.value = text("textEdit.takeOverPending");
        },
        adopt: () => {
            choices.clear();
            return session.adopt();
        },
        choose: (id, choice) => {
            const conflict = state.conflicts.find((item) => item.key === id);
            if (conflict !== undefined) choices.set(signature(conflict), choice);
        },
        confirmConflicts: async () => {
            const picked = [...state.conflicts];
            // 这一轮里有与别的块换过文字的块、有现在做不了而撤掉的动作：稿的结构变了，让作者看过再提交，不接着发。
            const review = picked.some((conflict) => conflict.structural === true || conflict.kind === "locked");
            for (const conflict of picked) session.choose(conflict, conflict.kind === "locked" ? "theirs" : choices.get(signature(conflict)) ?? "theirs");
            choices.clear();
            asking.value = false;
            if (review) message.value = text("textEdit.resultReview");
            else await submit(true);
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
