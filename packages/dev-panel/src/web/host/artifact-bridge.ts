import {onScopeDispose, watch, type Ref} from "vue";
import {validateAnswerValue} from "../../core/questions.js";
import type {BridgeQuestion, PageMessage, ShellMessage} from "../bridge/protocol.js";
import {answerText, groupQuestions, isBlankAnswer, setDraftValue, type AnswerDraft} from "./answers.js";
import type {QuestionState} from "./types.js";

/**
 * 产物页与评审板页面里的答题控件对话（t23）：把题表与草稿发给页面，收页面里改的取值、校验后写进草稿。
 * 页面是会话写的，它的脚本能伪造任何一条消息，所以页面只能改草稿：提交仍在侧栏里按，开发者提交前看得见改了什么。
 * 消息的形状见 `bridge/protocol.ts`，合同见 docs/panel.md 的“页面里作答”。
 */

/** 发给页面的题表：这一版里待答与已答的题；之前几版的、已关闭的题不发（页面上已经没有，或者不再收答复）。 */
export function bridgeQuestions(questions: readonly QuestionState[], draft: AnswerDraft): BridgeQuestion[] {
    const {pending, answered} = groupQuestions(questions);
    const entry = (state: QuestionState, kind: BridgeQuestion["state"]): BridgeQuestion => {
        const {id, type, label, options, required, recommend} = state.question;
        const changed = kind === "pending" && draft.touched[id] === true;
        return {
            id, type, label, options, required, recommend, state: kind,
            value: changed ? draft.values[id] ?? null : null,
            changed,
            answerText: kind === "answered" ? answerText(state.question, state.answer?.value) : null,
        };
    };
    return [...pending.map((state) => entry(state, "pending")), ...answered.map((state) => entry(state, "answered"))];
}

/**
 * 页面里改了一道题：合格就返回改好的整份草稿，不合格返回原因（调用方写一条警告、丢掉这条消息）。
 * 只收这一版里待答的题（已答的题在侧栏“改答”），表单只读时不收；取值按核心的同一份规则校验，`null` 是清空。
 * 文字题还在打字时可能是半截：空白当清空，其余按文字题的规则（长度、控制字符）校验。
 */
export function acceptPageDraft(input: {questions: readonly QuestionState[]; draft: AnswerDraft; disabledReason: string | null; id: unknown; value: unknown}): {draft: AnswerDraft} | {rejected: string} {
    if (input.disabledReason !== null) return {rejected: `表单现在只读：${input.disabledReason}`};
    if (typeof input.id !== "string") return {rejected: "题号不是字符串"};
    const state = groupQuestions(input.questions).pending.find((entry) => entry.question.id === input.id);
    if (!state) return {rejected: `${input.id} 不是这一版里待答的题`};
    if (input.value === null || isBlankAnswer(input.value)) return {draft: setDraftValue(input.draft, input.id, undefined, true)};
    const problem = validateAnswerValue(state.question, input.value);
    if (problem) return {rejected: problem};
    return {draft: setDraftValue(input.draft, input.id, input.value, true)};
}

export type ArtifactBridgeOptions = {
    /** 产物页的 iframe 的窗口；还没挂上时是 null。只收它发来的消息、只往它发。 */
    frame: () => Window | null;
    /** 现在的题表；没有可答的表单（还没发布、Work 级产物）时是 null，页面里不画控件。 */
    questions: () => readonly QuestionState[] | null;
    draft: Ref<AnswerDraft>;
    /** 不能答的原因（看的不是最新一版、产物已关闭、主工作区不能写、正在提交）；有值时页面里的控件只读、草稿消息丢掉。 */
    disabledReason: () => string | null;
};

/**
 * 在产物页上挂一次：页面发 `ready` 之后才往它发题表（页面换了、刷新了会再发 `ready`），之后题表、草稿、只读原因一变就重发。
 * 只认 `event.source` 是这个 iframe 的消息：沙箱 iframe 是不透明来源，`event.origin` 总是 "null"，认不出是谁。
 */
export function useArtifactBridge(options: ArtifactBridgeOptions): {reveal: (id: string) => void} {
    let ready = false;
    function send(message: ShellMessage): void {
        // 草稿是响应式代理，结构化克隆不了：转成普通 JSON。iframe 是不透明来源，`targetOrigin` 只能写 "*"。
        options.frame()?.postMessage(JSON.parse(JSON.stringify(message)) as ShellMessage, "*");
    }
    function sendState(): void {
        if (!ready) return;
        const questions = options.questions();
        send({type: "nbdev:state", questions: questions ? bridgeQuestions(questions, options.draft.value) : [], disabledReason: options.disabledReason()});
    }
    function onMessage(event: MessageEvent): void {
        const frame = options.frame();
        if (frame === null || event.source !== frame) return;
        const data = event.data as PageMessage | null;
        if (typeof data !== "object" || data === null) return;
        if (data.type === "nbdev:ready") {
            ready = true;
            sendState();
            return;
        }
        if (data.type !== "nbdev:draft") return;
        const questions = options.questions();
        if (!questions) return;
        const outcome = acceptPageDraft({questions, draft: options.draft.value, disabledReason: options.disabledReason(), id: data.id, value: data.value});
        if ("rejected" in outcome) {
            console.warn("评审板页面发来的取值没收：", outcome.rejected);
            // 页面上的控件可能已经显示了没收的取值：重发一份题表，让它回到草稿里的样子。
            sendState();
            return;
        }
        options.draft.value = outcome.draft;
    }
    window.addEventListener("message", onMessage);
    onScopeDispose(() => window.removeEventListener("message", onMessage));
    watch([() => options.questions(), () => options.disabledReason(), options.draft], sendState, {deep: true});
    return {reveal: (id) => send({type: "nbdev:reveal", id})};
}
