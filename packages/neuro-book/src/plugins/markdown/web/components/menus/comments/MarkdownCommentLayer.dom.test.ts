/**
 * 批注层（docs/specs/workbench/markdown-editing.md 输出 28–33）：真实的 Tiptap 编辑器与真实的动作实现，单独挂批注层，直接控制它的属性
 * （别的弹层开着、页边画不画、换文档、只读）。控件整体的流程在 `MarkdownControl.dom.test.ts`。
 */
import {codecFor, defaultMarkdownLanguage} from "@notnotype/nb-markdown/language";
import {holdSelection, listComments, markdownEditingActions, MarkdownShownComment} from "@notnotype/nb-markdown/editor";
import {Editor} from "@tiptap/core";
import {EditorState} from "@tiptap/pm/state";
import {mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {markRaw, nextTick, ref} from "vue";

import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";
import {keyEventMatches} from "nbook/plugins/editor/web/key-event";

import MarkdownCommentLayer from "./MarkdownCommentLayer.vue";

const language = defaultMarkdownLanguage();
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const TWO = "甲<comment body=\"第一条\">乙丙</comment>丁戊<comment body=\"第二条\">己庚</comment>辛\n";

function find(editor: Editor, text: string): {from: number; to: number} {
    let found: {from: number; to: number} | null = null;
    editor.state.doc.descendants((node, pos) => {
        const at = node.isText ? (node.text as string).indexOf(text) : -1;
        if (found === null && at >= 0) found = {from: pos + at, to: pos + at + text.length};
    });
    if (found === null) throw new Error(`找不到 ${text}`);
    return found;
}

function stateOf(editor: Editor, markdown: string): EditorState {
    const read = codecFor(editor.schema, language).read(markdown);
    return EditorState.create({doc: read.doc, plugins: editor.state.plugins});
}

/** 批注层要的最小宿主：编辑器、滚动容器、动作（真实实现）与菜单（文字取键名，键位用真实的匹配）。 */
function harness(markdown: string, props: {readonly?: boolean; blocked?: boolean; marginDrawn?: boolean} = {}) {
    const scroller = document.createElement("div");
    const element = document.createElement("div");
    scroller.append(element);
    document.body.append(scroller);
    const editor = new Editor({element, extensions: [...language.extensions, MarkdownShownComment]});
    editor.view.updateState(stateOf(editor, markdown));
    const editing: EditorEditing = {
        run: (action, args = {}) => {
            const implementation = markdownEditingActions[action];
            return implementation !== undefined && implementation.enabled(editor, args) && implementation.run(editor, args);
        },
        active: () => false,
        enabled: (action) => markdownEditingActions[action]?.enabled(editor, {}) === true,
        hasSelection: ref(false),
    };
    const menus = {
        label: (key: string, params?: Readonly<Record<string, string | number>>) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`),
        matches: (action: "comment", event: KeyboardEvent) => keyEventMatches("Mod+Alt+M", "other", event),
        run: () => undefined,
    } as unknown as EditorMenus;
    const wrapper = mount(MarkdownCommentLayer, {props: {editor: markRaw(editor), scroller, editing, menus, readonly: props.readonly ?? false, binding: "a", blocked: props.blocked ?? false, marginDrawn: props.marginDrawn ?? false}, attachTo: document.body});
    cleanups.push(() => {
        wrapper.unmount();
        editor.destroy();
        scroller.remove();
    });
    editor.view.focus();
    return {editor, wrapper, scroller};
}

/** 开着的浮层卡片（关上的要等退场动画结束才摘掉，按 `data-state` 判断）。 */
const popover = (): HTMLElement | null => document.querySelector('[data-anchored-popover][data-state="open"] [data-markdown-comment-layer]');
const marginItems = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-markdown-comment-margin] .markdown-comment-margin__item")];
const moveTo = async (editor: Editor, pos: number): Promise<void> => {
    editor.commands.setTextSelection(pos);
    await nextTick();
    await nextTick();
};
const keyDown = (target: EventTarget, init: KeyboardEventInit): void => {
    const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
    Object.defineProperty(event, "getModifierState", {value: () => false});
    target.dispatchEvent(event);
};
const type = async (wrapper: VueWrapper, root: ParentNode, text: string): Promise<void> => {
    const field = root.querySelector("textarea") as HTMLTextAreaElement;
    field.value = text;
    field.dispatchEvent(new Event("input", {bubbles: true}));
    await nextTick();
    void wrapper;
};

describe("什么时候不弹（输出 30）", () => {
    it("注音、双语卡片或右键菜单开着（blocked）时光标进批注不弹；放开后移出再移进才弹", async () => {
        const {editor, wrapper} = harness(TWO, {blocked: true});
        await moveTo(editor, find(editor, "乙丙").from + 1);
        expect(popover()).toBeNull();
        await wrapper.setProps({blocked: false});
        await moveTo(editor, find(editor, "丁戊").from + 1);
        await moveTo(editor, find(editor, "乙丙").from + 1);
        expect(popover()?.textContent).toContain("第一条");
    });

    it("输入法组字中光标进批注不弹", async () => {
        const {editor} = harness(TWO);
        editor.view.dom.dispatchEvent(new Event("compositionstart", {bubbles: true}));
        expect(editor.view.composing).toBe(true);
        await moveTo(editor, find(editor, "乙丙").from + 1);
        expect(popover()).toBeNull();
    });

    it("程序改的文档（不进历史：重载、写回回填）既不让收起的卡片再弹，也不让光标原地不动时弹出来", async () => {
        const {editor} = harness(TWO);
        const inside = find(editor, "乙丙").from + 1;
        await moveTo(editor, inside);
        expect(popover()).not.toBeNull();
        keyDown(editor.view.dom, {key: "Escape"});
        await nextTick();
        expect(popover()).toBeNull();
        // 光标之外的地方被程序改了一个字。
        editor.view.dispatch(editor.state.tr.insertText("新", find(editor, "辛").from).setMeta("addToHistory", false));
        await nextTick();
        await nextTick();
        expect(popover()).toBeNull();
        // 同一条批注里走一格：不弹。
        await moveTo(editor, inside + 1);
        expect(popover()).toBeNull();
    });

    it("只读的正文拿不到焦点：浏览器选区在正文里就出卡片，没有编辑与删除；Esc 收起", async () => {
        const {editor} = harness(TWO, {readonly: true});
        editor.view.dom.blur();
        const text = [...editor.view.dom.querySelectorAll("comment")][0]?.firstChild as Text;
        document.getSelection()?.setBaseAndExtent(text, 1, text, 1);
        document.dispatchEvent(new Event("selectionchange"));
        await moveTo(editor, find(editor, "乙丙").from + 1);
        expect(popover()?.textContent).toContain("第一条");
        expect(popover()?.querySelector('[aria-label="commentEdit"]')).toBeNull();
        keyDown(document, {key: "Escape"});
        await nextTick();
        expect(popover()).toBeNull();
    });
});

describe("换文档（状态与转换）", () => {
    it("页边开着换到别的文档：卡片按新文档重排，不对着旧文档的位置；换到的文档里光标已在批注里时，在里面走一格不弹", async () => {
        const {editor, wrapper} = harness(TWO, {marginDrawn: true});
        await nextTick();
        expect(marginItems()).toHaveLength(2);
        // 换成另一份没有批注的文档（只换编辑状态，不产生事务）。
        editor.view.updateState(stateOf(editor, "丙\n"));
        await wrapper.setProps({binding: "b"});
        await nextTick();
        await nextTick();
        expect(marginItems()).toHaveLength(0);
        // 换回来：光标本来就在批注里（标签记着上次的光标）。
        const state = stateOf(editor, TWO);
        const inside = find({state: state} as unknown as Editor, "乙丙").from + 1;
        editor.view.updateState(state.apply(state.tr.setSelection((await import("@tiptap/pm/state")).TextSelection.create(state.doc, inside))));
        await wrapper.setProps({binding: "a", marginDrawn: false});
        await nextTick();
        await nextTick();
        expect(popover()).toBeNull();
        await moveTo(editor, inside + 1);
        expect(popover()).toBeNull();
    });
});

describe("页边（输出 33）", () => {
    it("两条意见与开头文字都相同的批注：光标进其中一条只展开这一条，点编辑只有一张卡片进入“写”", async () => {
        const {editor} = harness("甲<comment body=\"改\">的</comment>乙丙<comment body=\"改\">的</comment>丁<comment body=\"别\">戊</comment>\n", {marginDrawn: true});
        await nextTick();
        await moveTo(editor, find(editor, "的").from + 1);
        expect(marginItems().map((item) => item.dataset.mode)).toEqual(["view", "compact", "compact"]);
        (marginItems()[0]?.querySelector('[aria-label="commentEdit"]') as HTMLElement).click();
        await nextTick();
        await nextTick();
        expect(marginItems().map((item) => item.dataset.mode)).toEqual(["write", "compact", "compact"]);
        expect(document.querySelectorAll("[data-markdown-comment-margin] textarea")).toHaveLength(1);
    });

    it("写着的字在控件宽度跨过阈值（页边与浮层互相切换）时不丢", async () => {
        const {editor, wrapper} = harness("甲乙丙丁\n", {marginDrawn: true});
        editor.commands.setTextSelection(find(editor, "乙丙"));
        keyDown(editor.view.dom, {code: "KeyM", key: "m", ctrlKey: true, altKey: true});
        await nextTick();
        await nextTick();
        expect(marginItems().map((item) => item.dataset.mode)).toEqual(["write"]);
        await type(wrapper, document.querySelector("[data-markdown-comment-margin]") as ParentNode, "写了很久的意见");
        await wrapper.setProps({marginDrawn: false});
        for (let index = 0; index < 6; index += 1) await nextTick();
        expect(document.querySelector("[data-markdown-comment-margin]")).toBeNull();
        expect((popover()?.querySelector("textarea") as HTMLTextAreaElement).value).toBe("写了很久的意见");
        await wrapper.setProps({marginDrawn: true});
        for (let index = 0; index < 6; index += 1) await nextTick();
        expect((document.querySelector("[data-markdown-comment-margin] textarea") as HTMLTextAreaElement).value).toBe("写了很久的意见");
    });

    it("光标在同一条批注里走动不重复标出：每次选区变化只有一个事务", async () => {
        const {editor} = harness(TWO, {marginDrawn: true});
        const inside = find(editor, "乙丙").from;
        await moveTo(editor, inside);
        let transactions = 0;
        editor.on("transaction", () => {
            transactions += 1;
        });
        await moveTo(editor, inside + 1);
        await moveTo(editor, inside + 2);
        expect(transactions).toBe(2);
    });
});

describe("加批注加不上（输出 28）", () => {
    it("保存时选区所在的块已经不允许批注：卡片留在“写”里，字还在，文档不变", async () => {
        const {editor, wrapper} = harness("甲乙丙\n");
        editor.commands.setTextSelection(find(editor, "乙"));
        keyDown(editor.view.dom, {code: "KeyM", key: "m", ctrlKey: true, altKey: true});
        await nextTick();
        await nextTick();
        await type(wrapper, popover() as ParentNode, "要加的意见");
        // 写着的时候选区所在的段被换成代码块（代码块里不允许批注）。
        editor.commands.setCodeBlock();
        await nextTick();
        keyDown(popover()?.querySelector("textarea") as HTMLElement, {key: "Enter", ctrlKey: true});
        await nextTick();
        await nextTick();
        expect(listComments(editor.state.doc)).toEqual([]);
        expect((popover()?.querySelector("textarea") as HTMLTextAreaElement).value).toBe("要加的意见");
        void holdSelection;
    });
});
