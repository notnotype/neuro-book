/**
 * 条目页文字分页的宿主逻辑（docs/specs/canon/author-ui.md 输出 39、44 到 46）：把这个条目的稿会话（`text-drafts.ts`）接到编辑视图
 * `EntryTextEditor` 与冲突对话框 `TextConflictDialog` 上。组件是受控的，写入都在这里：作者改的是整篇（`text-whole.ts`），每次
 * 输入换成整篇的一次改写；提交的结局换成那一行的说明、冲突对话框或保存后的提示。
 *
 * 会话不随页面卸载（标签不在前台时圆点还要问它），所以这里不持有稿，只持有这一页的界面状态：整批的说明、冲突对话框开没开、
 * 作者在对话框里选到一半的选择。
 */

import {computed, reactive, shallowRef, watch} from "vue";
import type {ComputedRef, ShallowRef} from "vue";

import type {ReadPosition} from "@notnotype/nb-canon/schema";

import type {CanonClient} from "../shared/contracts";
import type {ConflictChoice, ConflictItem} from "./components/text/text-conflict-dialog";
import {failureText} from "./failures";
import type {CanonNotices} from "./notices";
import {hasChanges, SUBMIT_OPS_MAX} from "./text-draft";
import type {BlockProblem, Blocker, SubmitResult, TextDraftSession} from "./text-drafts";
import {setWhole, toWhole, wholeProblem} from "./text-whole";
import type {WholeConflict, WholeProblem} from "./text-whole";
import type {useCanonText} from "./text";
import type {CanonWorld} from "./world";

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
        /** 作者的整篇；读不出块时是稿里存着的那一份。 */
        readonly text: string;
        /** 输入框下面要写的原因（内核说写得不对）；空串没有。 */
        readonly problem: string;
        readonly dirty: boolean;
        readonly saved: TextDraftSession["state"]["saved"];
        readonly phase: TextDraftSession["state"]["phase"];
        readonly submitBlocked: string;
        readonly message: string;
        readonly frozen: boolean;
    }>;
    readonly conflicts: ComputedRef<readonly ConflictItem[]>;
    /** 冲突对话框开着。 */
    readonly asking: ShallowRef<boolean>;
    /** 进编辑；返回没进去的原因（读不出块、这个条目不能整篇改），空串是进去了。没进去时人还在阅读视图，由宿主写在那里。 */
    start(): Promise<string>;
    update(text: string): void;
    flush(): void;
    leave(): Promise<void>;
    submit(): Promise<void>;
    retry(): Promise<void>;
    takeOver(): Promise<void>;
    adopt(): Promise<void>;
    choose(id: string, choice: ConflictChoice): void;
    confirmConflicts(): Promise<void>;
}

/** 对话框里那一条冲突的 id：整篇只有一条。 */
const WHOLE = "whole";

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
     * 作者在对话框里选到一半的选择，按“这一条冲突是什么”记（两边各是什么）：回去再改、再提交时同一条冲突还选着；两边的文字
     * 变了、换了一份稿（放弃再开始、换成那边的）就是另一条冲突，不带着上一次的选择。
     */
    const choices = reactive(new Map<string, ConflictChoice>());
    const signature = (conflict: WholeConflict): string => JSON.stringify([conflict.mine, conflict.theirs]);
    /** 整篇的稿至多一条冲突。按块的冲突只会出自还没换算的旧稿，这一页不提交那样的稿（见下面的 `watch`）。 */
    const conflict = computed((): WholeConflict | null => state.conflicts.find((item): item is WholeConflict => item.kind === "whole") ?? null);
    const blockerText = (blocker: Blocker): string => text(blocker === "chapter-not-found" ? "textEdit.blockerChapter" : blocker === "line-not-found" ? "textEdit.blockerLine" : blocker === "entry-missing" ? "textEdit.blockerEntry" : blocker === "too-large" ? "textEdit.blockerTooLarge" : "textEdit.blockerUnavailable");

    const wholeReason = (problem: WholeProblem): string => (problem.kind === "too-many" ? text("textEdit.wholeTooMany", {count: problem.count, max: SUBMIT_OPS_MAX}) : text("textEdit.wholeStory"));
    const problemText = (problem: BlockProblem | undefined): string => {
        if (problem === undefined) return "";
        return problem.kind === "rejected" ? text("textEdit.problemRejected", {message: problem.message}) : text("textEdit.wholeStory");
    };

    /**
     * 按块改出来的旧稿（没有 `whole`）一见到就换算成整篇：这一页只会改、只会提交整篇的稿。等着上一次提交结局的不动（冻结着
     * 的请求要原样重发），它确认完以后稿要么收掉、要么解冻再走到这里。
     */
    watch(() => [state.draft, state.read, state.phase] as const, ([draft, read, phase]) => {
        if (draft === null || read === null || phase !== "idle" || draft.whole !== undefined || draft.pending !== undefined) return;
        session.edit((old, from) => (old.whole === undefined ? toWhole(old, from) : old));
    }, {immediate: true});

    const whole = computed((): string => {
        const [draft, read] = [state.draft, state.read];
        if (draft === null) return "";
        if (draft.whole !== undefined) return draft.whole.text;
        // 还没换算的旧稿：读得出块时照换算的结果显示，读不出时只有稿里动过的文字。
        return read !== null ? toWhole(draft, read).whole?.text ?? "" : Object.values(draft.texts).join("\n\n");
    });

    const dirty = computed(() => state.draft !== null && (hasChanges(state.draft) || state.draft.pending !== undefined));

    const conflictItem = (item: WholeConflict): ConflictItem => {
        // 现在不能整篇改了的只有一个选择，不用作者再点一次。
        if (item.locked !== undefined) return {id: WHOLE, kind: "locked", mine: item.mine, theirs: item.theirs, reason: wholeReason(item.locked), choice: "theirs"};
        return {id: WHOLE, kind: "changed", mine: item.mine, theirs: item.theirs, choice: choices.get(signature(item)) ?? null};
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
            // 上一轮选过、这一轮还是那一条冲突的留着选择；两边的文字变了就丢掉。
            const still = conflict.value === null ? null : signature(conflict.value);
            for (const key of [...choices.keys()]) if (key !== still) choices.delete(key);
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
            text: whole.value,
            problem: problemText(Object.values(state.problems)[0]),
            dirty: dirty.value,
            saved: state.saved,
            phase: state.phase,
            submitBlocked: options.blocked(),
            // 这一页自己发的提交的原因在先；其次是按了提交而现在写不了的原因；再是会话在没有页面时确认出来的结局（读进来就在等
            // 结局的稿）；最后是读不出块的原因。
            message: message.value !== "" ? message.value : blockedAsked.value && options.blocked() !== "" ? options.blocked() : state.resumed !== null && resultMessage(state.resumed) !== "" ? resultMessage(state.resumed) : state.blocker === null ? "" : blockerText(state.blocker),
            frozen: state.draft !== null && state.read === null,
        })),
        conflicts: computed(() => (conflict.value === null ? [] : [conflictItem(conflict.value)])),
        asking,
        start: async () => {
            message.value = "";
            choices.clear();
            const failed = await session.begin(options.position());
            if (state.draft === null) return blockerText(failed ?? "unavailable");
            // 这些块不能整篇改（有随剧情变的段落、块太多）：没有要保住的改动时不进编辑。带着改动的稿照常进，提交时再问。
            const problem = state.read === null || hasChanges(state.draft) || state.draft.pending !== undefined ? null : wholeProblem(state.read);
            if (problem === null) return "";
            await session.discard();
            return wholeReason(problem);
        },
        update: (value) => edit((draft, read) => setWhole(draft, read, value)),
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
        choose: (_id, choice) => {
            if (conflict.value !== null) choices.set(signature(conflict.value), choice);
        },
        confirmConflicts: async () => {
            const picked = conflict.value;
            if (picked !== null) session.choose(picked, picked.locked !== undefined ? "theirs" : choices.get(signature(picked)) ?? "theirs");
            choices.clear();
            asking.value = false;
            // 选了“现在的”以后没有要发的：照样走一遍，让会话收场、回到阅读视图。
            await submit(true);
        },
    };
}
