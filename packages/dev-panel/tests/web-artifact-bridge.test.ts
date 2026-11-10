import {describe, expect, test} from "bun:test";
import {JSDOM} from "jsdom";
import {effectScope, nextTick, ref, type EffectScope} from "vue";
import {answerBridgeScript} from "../src/server/artifact-bridge.js";
import type {BridgeQuestion, PageMessage, ShellMessage} from "../src/web/bridge/protocol.js";
import {acceptPageDraft, bridgeQuestions, useArtifactBridge} from "../src/web/host/artifact-bridge.js";
import {emptyAnswerDraft, setDraftValue, type AnswerDraft} from "../src/web/host/answers.js";
import type {QuestionState, VersionQuestion} from "../src/web/host/types.js";
import {useWebEnv} from "./web-env.js";

/**
 * 页面里作答（t23）的两头：评审板页面里的答题脚本，与产物页收消息、写草稿的一侧。
 *
 * 评审板页面里的答题脚本（t23，`src/web/bridge/answer-bridge.ts`）：跑的是产物来源实际回的那份转译结果。
 * 页面是一个 jsdom 窗口，外壳是另一个；把页面的 `parent` 指到外壳窗口，就是面板 iframe 里的样子（jsdom 不加载 iframe 里的页面）。
 * 外壳发消息用页面窗口上的 `message` 事件、`source` 写外壳窗口，与浏览器里 `postMessage` 送到时一样；页面发的消息记在外壳窗口的 `postMessage` 上。
 */
const script = await answerBridgeScript();

const PAGE = `
<section data-nbdev-question="layout" data-nbdev-type="single"><h2>用卡片还是表</h2><p>材料</p></section>
<section data-nbdev-question="groups" data-nbdev-type="multi"><h2>分几组</h2></section>
<section data-nbdev-question="note" data-nbdev-type="text"><h2>命名</h2></section>
<section data-nbdev-question="approve" data-nbdev-type="confirm"><h2>批准</h2></section>
<section data-nbdev-question="done" data-nbdev-type="single"><h2>已答的题</h2></section>`;

function question(id: string, type: BridgeQuestion["type"], extra: Partial<BridgeQuestion> = {}): BridgeQuestion {
    const options = type === "single" || type === "multi" ? [{value: "a", label: "甲"}, {value: "b", label: "乙"}] : [];
    return {id, type, label: id, options, required: false, recommend: [], state: "pending", value: null, changed: false, answerText: null, ...extra};
}
const QUESTIONS: BridgeQuestion[] = [
    question("layout", "single", {required: true, recommend: ["a"]}),
    question("groups", "multi"),
    question("note", "text"),
    question("approve", "confirm"),
    question("done", "single", {state: "answered", answerText: "乙"}),
    // ask 登记的题页面上没有元素：不画。
    question("asked", "text"),
];

function mount(options: {inFrame?: boolean} = {}) {
    const shell = new JSDOM("<!doctype html><body></body>", {url: "http://127.0.0.1:4490/"}).window;
    const page = new JSDOM(`<!doctype html><body>${PAGE}</body>`, {url: "http://127.0.0.1:4491/a/p/main/index.html", runScripts: "outside-only"}).window;
    if (options.inFrame !== false) Object.defineProperty(page, "parent", {configurable: true, get: () => shell});
    const sent: PageMessage[] = [];
    // 页面发出的对象属于页面的 realm：转成普通 JSON 再比较。
    shell.postMessage = ((message: unknown) => void sent.push(JSON.parse(JSON.stringify(message)) as PageMessage)) as typeof shell.postMessage;
    page.eval(script);
    const send = (message: ShellMessage, source: Window = shell) => page.dispatchEvent(new page.MessageEvent("message", {data: message, source}));
    const block = (id: string) => page.document.querySelector(`[data-nbdev-answer="${id}"]`)?.shadowRoot ?? null;
    const inputs = (id: string) => [...(block(id)?.querySelectorAll("input") ?? [])];
    const drafts = () => sent.filter((message) => message.type === "nbdev:draft");
    return {shell, page, sent, send, block, inputs, drafts};
}
const state = (questions: BridgeQuestion[] = QUESTIONS, disabledReason: string | null = null): ShellMessage => ({type: "nbdev:state", questions, disabledReason});

describe("页面里的答题控件", () => {
    test("不在面板的 iframe 里（单独打开）什么也不做：不发消息、不画控件", () => {
        const {sent, send, page} = mount({inFrame: false});
        send(state(), page);
        expect([sent, page.document.querySelectorAll("[data-nbdev-answer]").length]).toEqual([[], 0]);
    });

    test("载入就发 ready；收到题表后在每道题的元素末尾放控件，页面上没有元素的题不画，已答的题只写答案", () => {
        const {sent, send, block, inputs, page} = mount();
        expect(sent).toEqual([{type: "nbdev:ready"}]);
        send(state());
        const hosts = [...page.document.querySelectorAll("[data-nbdev-answer]")];
        expect(hosts.map((host) => [host.getAttribute("data-nbdev-answer"), host.parentElement?.getAttribute("data-nbdev-question"), host === host.parentElement?.lastElementChild])).toEqual([
            ["layout", "layout", true], ["groups", "groups", true], ["note", "note", true], ["approve", "approve", true], ["done", "done", true],
        ]);
        expect(inputs("layout").map((input) => [input.type, input.value])).toEqual([["radio", "a"], ["radio", "b"]]);
        expect(block("layout")?.textContent).toContain("必答");
        expect(block("layout")?.querySelector(".rec")?.textContent).toBe("推荐");
        expect(inputs("groups").map((input) => input.type)).toEqual(["checkbox", "checkbox"]);
        expect(inputs("approve").map((input) => input.value)).toEqual(["true", "false"]);
        expect(block("note")?.querySelector("textarea")).not.toBeNull();
        expect([inputs("done").length, block("done")?.textContent?.includes("已答：乙")]).toEqual([0, true]);
    });

    test("改了取值就发草稿：单选发选项值、多选发数组（全取消发 null）、确认发布尔值、清除选择发 null；不发提交", () => {
        const {send, inputs, block, drafts, page} = mount();
        send(state());
        const click = (input: HTMLInputElement) => {
            input.checked = !input.checked;
            input.dispatchEvent(new page.Event("change"));
        };
        click(inputs("layout")[1]!);
        click(inputs("groups")[0]!);
        click(inputs("groups")[1]!);
        click(inputs("groups")[0]!);
        click(inputs("groups")[1]!);
        click(inputs("approve")[1]!);
        block("layout")?.querySelector<HTMLButtonElement>("button.clear")?.click();
        expect(drafts()).toEqual([
            {type: "nbdev:draft", id: "layout", value: "b"},
            {type: "nbdev:draft", id: "groups", value: ["a"]},
            {type: "nbdev:draft", id: "groups", value: ["a", "b"]},
            {type: "nbdev:draft", id: "groups", value: ["b"]},
            {type: "nbdev:draft", id: "groups", value: null},
            {type: "nbdev:draft", id: "approve", value: false},
            {type: "nbdev:draft", id: "layout", value: null},
        ]);
        expect(page.document.querySelectorAll("form, [type=submit]").length).toBe(0);
    });

    test("文字题离开文字框时发；只剩空白发 null", () => {
        const {send, block, drafts, page} = mount();
        send(state());
        const textarea = block("note")!.querySelector("textarea")!;
        textarea.value = "叫 nbdev";
        textarea.dispatchEvent(new page.Event("input"));
        textarea.dispatchEvent(new page.Event("blur"));
        textarea.value = "  ";
        textarea.dispatchEvent(new page.Event("input"));
        textarea.dispatchEvent(new page.Event("blur"));
        expect(drafts()).toEqual([{type: "nbdev:draft", id: "note", value: "叫 nbdev"}, {type: "nbdev:draft", id: "note", value: null}]);
    });

    test("再收到题表时按草稿就地更新：选中项、文字、“已填，还没提交”；正在输入的文字框不被改写", () => {
        const {send, inputs, block, page} = mount();
        send(state());
        const textarea = block("note")!.querySelector("textarea")!;
        send(state(QUESTIONS.map((entry) => entry.id === "layout" ? {...entry, value: "a", changed: true} : entry.id === "groups" ? {...entry, value: ["b"], changed: true} : entry.id === "note" ? {...entry, value: "侧栏里写的", changed: true} : entry)));
        expect([inputs("layout").map((input) => input.checked), inputs("groups").map((input) => input.checked), textarea.value]).toEqual([[true, false], [false, true], "侧栏里写的"]);
        expect([block("layout")?.querySelector(".status")?.textContent, block("approve")?.querySelector(".status")?.textContent]).toEqual(["已填，还没提交：在右边侧栏提交", ""]);
        expect(block("note")!.querySelector("textarea")).toBe(textarea);
        textarea.focus();
        textarea.value = "正在打";
        textarea.dispatchEvent(new page.Event("input"));
        send(state(QUESTIONS.map((entry) => entry.id === "note" ? {...entry, value: "别处来的", changed: true} : entry)));
        expect(textarea.value).toBe("正在打");
    });

    test("只读时控件禁用并写原因；题表里没有了的题，控件拿掉", () => {
        const {send, block, page} = mount();
        send(state(QUESTIONS, "只能对最新一版（v2）答复"));
        expect([block("layout")?.querySelector("fieldset")?.disabled, block("layout")?.textContent?.includes("只能对最新一版（v2）答复")]).toEqual([true, true]);
        send(state(QUESTIONS.filter((entry) => entry.id !== "groups")));
        expect([block("groups"), block("layout")?.querySelector("fieldset")?.disabled]).toEqual([null, false]);
        expect(page.document.querySelectorAll("[data-nbdev-answer]").length).toBe(4);
    });

    test("只听父窗口：别的来源发来的题表与滚动不理", () => {
        const {send, page} = mount();
        const other = new JSDOM("<!doctype html><body></body>").window;
        send(state(), other);
        expect(page.document.querySelectorAll("[data-nbdev-answer]").length).toBe(0);
    });

    test("reveal 把那道题滚进视口", () => {
        const {send, page} = mount();
        send(state());
        const scrolled: string[] = [];
        page.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
            scrolled.push(this.getAttribute("data-nbdev-question") ?? "");
        };
        send({type: "nbdev:reveal", id: "approve"});
        send({type: "nbdev:reveal", id: "asked"});
        expect(scrolled).toEqual(["approve"]);
    });
});

/**
 * 外壳一侧（`host/artifact-bridge.ts`）：页面能伪造任何消息，所以只认 iframe 发来的、只收这一版待答题的合法取值、只写草稿。
 * iframe 的窗口用假的（只记下发给它的消息）；消息经 `web-env` 装的假 `window` 派发，`source` 写成谁就是谁发的。
 */
const scopes: EffectScope[] = [];
useWebEnv(() => {
    for (const scope of scopes.splice(0)) scope.stop();
});

const versionQuestion = (id: string, patch: Partial<VersionQuestion> = {}): VersionQuestion => ({id, type: "single", label: id, options: [{value: "a", label: "甲"}, {value: "b", label: "乙"}], required: false, recommend: ["a"], origin: "markup", page: "index.html", about: null, since: 1, outcome: null, ...patch});
const questionState = (q: VersionQuestion, name: QuestionState["state"], value?: unknown): QuestionState => ({question: q, state: name, answer: value === undefined ? null : {answerId: "x", value, artifactVersion: 1, submittedAt: "2026-11-10T00:00:00.000Z", comment: null}, stale: null});
const SHEET: QuestionState[] = [
    questionState(versionQuestion("pick"), "open"),
    questionState(versionQuestion("many", {type: "multi"}), "open"),
    questionState(versionQuestion("words", {type: "text", options: [], recommend: []}), "open"),
    questionState(versionQuestion("done"), "answered", "b"),
    questionState(versionQuestion("old", {page: null}), "answered", "a"),
    questionState(versionQuestion("gone", {outcome: {kind: "withdrawn", in: 1, reason: "explicit"}}), "withdrawn"),
];

describe("外壳发给页面的题表", () => {
    test("只发这一版待答与已答的题；待答的带草稿里改过的取值，已答的带答案文字", () => {
        const draft = setDraftValue(emptyAnswerDraft(), "pick", "b", false);
        expect(bridgeQuestions(SHEET, draft).map((entry) => [entry.id, entry.state, entry.value, entry.changed, entry.answerText])).toEqual([
            ["pick", "pending", "b", true, null], ["many", "pending", null, false, null], ["words", "pending", null, false, null], ["done", "answered", null, false, "乙"],
        ]);
    });
});

describe("页面发来的取值", () => {
    const accept = (id: unknown, value: unknown, draft: AnswerDraft = emptyAnswerDraft(), disabledReason: string | null = null) => acceptPageDraft({questions: SHEET, draft, disabledReason, id, value});

    test("待答题的合法取值写进草稿并标“页面里填的”；null 与空白是清空，标记也去掉；侧栏里再改就去掉标记", () => {
        const picked = accept("pick", "b");
        expect("draft" in picked && [picked.draft.values.pick, picked.draft.touched.pick, picked.draft.fromPage]).toEqual(["b", true, {pick: true}]);
        const draft = "draft" in picked ? picked.draft : emptyAnswerDraft();
        const cleared = accept("pick", null, draft);
        expect("draft" in cleared && [cleared.draft.touched.pick, cleared.draft.fromPage]).toEqual([false, {}]);
        const blank = accept("words", "   ", draft);
        expect("draft" in blank && [blank.draft.touched.words, blank.draft.fromPage]).toEqual([false, {pick: true}]);
        expect(setDraftValue(draft, "pick", "a", false).fromPage).toEqual({});
    });

    test("不收：已答的题、之前几版的题、撤回的题、不认识的题号、不合法的取值、表单只读时", () => {
        const reasons = [accept("done", "a"), accept("old", "a"), accept("gone", "a"), accept("nope", "a"), accept(7, "a"), accept("pick", "c"), accept("many", ["a", "a"]), accept("words", "带\u0007控制字符"), accept("pick", "a", emptyAnswerDraft(), "产物已关闭，不能再答")];
        expect(reasons.map((outcome) => "rejected" in outcome)).toEqual(Array(9).fill(true));
    });
});

describe("产物页和页面的对话", () => {
    function mountShell(options: {disabledReason?: string | null} = {}) {
        const frameSent: ShellMessage[] = [];
        const frame = {postMessage: (message: ShellMessage) => void frameSent.push(message)} as unknown as Window;
        const draft = ref<AnswerDraft>(emptyAnswerDraft());
        const disabledReason = ref<string | null>(options.disabledReason ?? null);
        const scope = effectScope();
        scopes.push(scope);
        const bridge = scope.run(() => useArtifactBridge({frame: () => frame, questions: () => SHEET, draft, disabledReason: () => disabledReason.value}))!;
        const receive = (data: PageMessage, source: unknown = frame) => window.dispatchEvent(Object.assign(new Event("message"), {data, source}));
        return {frameSent, frame, draft, disabledReason, bridge, receive, scope};
    }
    const states = (sent: ShellMessage[]) => sent.filter((message) => message.type === "nbdev:state");

    test("页面发 ready 之前不发题表；ready 之后发一份，草稿或只读原因变了再发", async () => {
        const shell = mountShell();
        shell.draft.value = setDraftValue(shell.draft.value, "pick", "a", false);
        await nextTick();
        expect(shell.frameSent).toEqual([]);
        shell.receive({type: "nbdev:ready"});
        expect(states(shell.frameSent).map((message) => message.type === "nbdev:state" && message.questions.find((entry) => entry.id === "pick")?.value)).toEqual(["a"]);
        shell.disabledReason.value = "正在提交";
        await nextTick();
        const last = states(shell.frameSent).at(-1);
        expect(last?.type === "nbdev:state" && last.disabledReason).toBe("正在提交");
    });

    test("iframe 发来的合法取值进草稿；别的来源发来的不理；不收的取值写警告并重发题表，页面回到草稿的样子", async () => {
        const shell = mountShell();
        shell.receive({type: "nbdev:ready"});
        shell.receive({type: "nbdev:draft", id: "pick", value: "b"}, {postMessage: () => undefined});
        expect(shell.draft.value.touched).toEqual({});
        shell.receive({type: "nbdev:draft", id: "pick", value: "b"});
        expect([shell.draft.value.values.pick, shell.draft.value.fromPage]).toEqual(["b", {pick: true}]);
        const before = states(shell.frameSent).length;
        const warn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args: unknown[]) => void warnings.push(args);
        try {
            shell.receive({type: "nbdev:draft", id: "done", value: "a"});
        } finally {
            console.warn = warn;
        }
        expect([shell.draft.value.values.done, warnings.length, states(shell.frameSent).length > before]).toEqual([undefined, 1, true]);
    });

    test("表单只读时页面发来的取值不收；reveal 发给页面；页面卸载后不再收消息", () => {
        const shell = mountShell({disabledReason: "只能对最新一版（v2）答复"});
        shell.receive({type: "nbdev:ready"});
        const warn = console.warn;
        console.warn = () => undefined;
        try {
            shell.receive({type: "nbdev:draft", id: "pick", value: "a"});
        } finally {
            console.warn = warn;
        }
        expect(shell.draft.value.touched).toEqual({});
        shell.bridge.reveal("pick");
        expect(shell.frameSent.at(-1)).toEqual({type: "nbdev:reveal", id: "pick"});
        shell.scope.stop();
        shell.disabledReason.value = null;
        shell.receive({type: "nbdev:draft", id: "pick", value: "a"});
        expect(shell.draft.value.touched).toEqual({});
    });
});
