/**
 * 批注层（docs/specs/workbench/markdown-editing.md 输出 28–33、38）：真实的 Tiptap 编辑器与真实的动作实现，单独挂批注层，直接控制它的属性
 * （别的弹层开着、页边画不画、换文档、只读）。收起的计时用属性传小值，不用假计时器；位置与对齐要真实布局，在 e2e 里看。控件整体的流程在
 * `MarkdownControl.dom.test.ts`。
 */
import {codecFor, defaultMarkdownLanguage} from "@notnotype/nb-markdown/language";
import {listComments, markdownEditingActions, MarkdownCommentMarkers, MarkdownShownComment} from "@notnotype/nb-markdown/editor";
import {Editor} from "@tiptap/core";
import {EditorState} from "@tiptap/pm/state";
import {mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
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

/** 收起的计时：10 毫秒，足够快，又不是同步的（同步的话“移开再回来”的竞态测不出来）。 */
const DELAY = 10;

/** 批注层要的最小宿主：编辑器、滚动容器、动作（真实实现）与菜单（文字取键名，键位用真实的匹配）。 */
function harness(markdown: string, props: {readonly?: boolean; blocked?: boolean; marginDrawn?: boolean} = {}) {
    const scroller = document.createElement("div");
    const element = document.createElement("div");
    scroller.append(element);
    document.body.append(scroller);
    const editor = new Editor({element, extensions: [...language.extensions, MarkdownShownComment, MarkdownCommentMarkers.configure({label: "marker"})]});
    editor.view.updateState(stateOf(editor, markdown));
    const editing: EditorEditing = {
        run: (action, args = {}) => {
            const implementation = markdownEditingActions[action];
            return implementation !== undefined && implementation.enabled(editor, args) && implementation.run(editor, args);
        },
        active: () => false,
        enabled: (action, args = {}) => markdownEditingActions[action]?.enabled(editor, args) === true,
        hasSelection: ref(false),
    };
    const menus = {
        label: (key: string, params?: Readonly<Record<string, string | number>>) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`),
        matches: (action: "comment", event: KeyboardEvent) => keyEventMatches("Mod+Alt+M", "other", event),
        run: () => undefined,
    } as unknown as EditorMenus;
    const wrapper = mount(MarkdownCommentLayer, {
        props: {editor: markRaw(editor), scroller, editing, menus, readonly: props.readonly ?? false, binding: "a", blocked: props.blocked ?? false, marginDrawn: props.marginDrawn ?? false, closeDelay: DELAY},
        attachTo: document.body,
    });
    cleanups.push(() => {
        wrapper.unmount();
        editor.destroy();
        scroller.remove();
    });
    editor.view.focus();
    return {editor, wrapper, scroller};
}

/** 开着的浮层卡片（关上的要等退场动画结束才摘掉，按 `data-state` 判断）。 */
const popoverSurface = (): HTMLElement | null => document.querySelector('[data-anchored-popover][data-state="open"]');
const popover = (): HTMLElement | null => document.querySelector('[data-anchored-popover][data-state="open"] [data-markdown-comment-layer]');
const marginItems = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-markdown-comment-margin] .markdown-comment-margin__item")];
const keyDown = (target: EventTarget, init: KeyboardEventInit): void => {
    const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
    Object.defineProperty(event, "getModifierState", {value: () => false});
    target.dispatchEvent(event);
};
const type = async (root: ParentNode, text: string): Promise<void> => {
    const field = root.querySelector("textarea") as HTMLTextAreaElement;
    field.value = text;
    field.dispatchEvent(new Event("input", {bubbles: true}));
    await nextTick();
};

/** 编辑器里带这段文字的批注元素。 */
const commentElement = (editor: Editor, text: string): HTMLElement => {
    const found = [...editor.view.dom.querySelectorAll<HTMLElement>("comment")].find((element) => element.textContent?.includes(text));
    if (found === undefined) throw new Error(`没有批注元素含 ${text}`);
    return found;
};
const moveOver = (target: Element, init: MouseEventInit = {}): void => {
    target.dispatchEvent(new MouseEvent("pointermove", {bubbles: true, clientX: 5, clientY: 5, ...init}));
};
/** 按住 Ctrl 把指针停在这段批注上，卡片弹出来（悬停的）。 */
const peekOpen = async (editor: Editor, text: string): Promise<void> => {
    moveOver(commentElement(editor, text), {ctrlKey: true});
    await vi.waitFor(() => expect(popover()).not.toBeNull());
};
/** 按住 Ctrl 点这段批注，卡片弹出来（点开的）。 */
const ctrlClick = async (editor: Editor, text: string): Promise<void> => {
    const target = commentElement(editor, text);
    moveOver(target, {ctrlKey: true});
    target.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, ctrlKey: true, clientX: 5, clientY: 5}));
    await vi.waitFor(() => expect(popover()).not.toBeNull());
};
/** 批注末尾的第 n 个小符号。 */
const marker = (editor: Editor, index = 0): HTMLElement => {
    const found = editor.view.dom.querySelectorAll<HTMLElement>("[data-comment-marker]")[index];
    if (found === undefined) throw new Error(`没有第 ${index} 个符号`);
    return found;
};
/** 点符号；`mousedown` 的默认动作被取消了才算（否则浏览器会把光标移过去）。 */
const clickMarker = (editor: Editor, index = 0): boolean => {
    const target = marker(editor, index);
    const down = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
    target.dispatchEvent(down);
    target.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
    return down.defaultPrevented;
};
/** 断言“没有弹出来”：状态是同步的、卡片的渲染要几个 tick，没有别的可观察信号能说明一个没发生的事；等一小会儿再看。 */
const settle = async (): Promise<void> => {
    // test-lint-allow fixed-wait: 断言“没有弹出来”，没有可等的信号，等过渲染的几个 tick 再看
    await new Promise((resolve) => setTimeout(resolve, 60));
};
const leaveComments = (editor: Editor): void => {
    // 指针移到正文里没有批注的地方。
    moveOver(editor.view.dom.querySelector("p") as Element);
};

describe("打开与收起（输出 30、38）", () => {
    it("按住 Ctrl 把鼠标停在批注上立刻弹出“看”卡片，写着意见与“第 i 条，共 n 条”；不按 Ctrl 的悬停与停在没有批注的字上不弹", async () => {
        const {editor} = harness(TWO);
        leaveComments(editor);
        moveOver(commentElement(editor, "乙丙"));
        await settle();
        expect(popover()).toBeNull();
        await peekOpen(editor, "乙丙");
        expect(popover()?.textContent).toContain("第一条");
        expect(popover()?.textContent).toContain("commentCounter");
        expect(popover()?.textContent).toContain('"i":1');
    });

    it("先把指针停在批注上、再按下 Ctrl（或 ⌘）同样弹；松开不收", async () => {
        const {editor} = harness(TWO);
        moveOver(commentElement(editor, "乙丙"));
        await settle();
        expect(popover()).toBeNull();
        keyDown(document, {key: "Control", ctrlKey: true});
        await vi.waitFor(() => expect(popover()?.textContent).toContain("第一条"));
        document.dispatchEvent(new KeyboardEvent("keyup", {key: "Control", bubbles: true}));
        await settle();
        expect(popover()).not.toBeNull();
        leaveComments(editor);
        await vi.waitFor(() => expect(popover()).toBeNull());
        moveOver(commentElement(editor, "己庚"));
        keyDown(document, {key: "Meta", metaKey: true});
        await vi.waitFor(() => expect(popover()?.textContent).toContain("第二条"));
    });

    it("光标走进批注（点击、方向键）、没按 Ctrl 的点击、在批注里打字都不弹", async () => {
        const {editor} = harness(TWO);
        editor.commands.setTextSelection(find(editor, "乙丙").from + 1);
        await nextTick();
        editor.commands.setTextSelection(find(editor, "乙丙").from + 2);
        editor.view.dispatch(editor.state.tr.insertText("字", find(editor, "乙丙").from + 1));
        const target = commentElement(editor, "己庚");
        moveOver(target);
        target.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, clientX: 5, clientY: 5}));
        await settle();
        expect(popover()).toBeNull();
    });

    it("按 Ctrl 悬停出来的卡片：指针换到另一条批注上卡片换成它；指针离开批注与卡片后收起", async () => {
        const {editor} = harness(TWO);
        await peekOpen(editor, "乙丙");
        moveOver(commentElement(editor, "己庚"), {ctrlKey: true});
        await vi.waitFor(() => expect(popover()?.textContent).toContain("第二条"));
        expect(popover()?.textContent).not.toContain("第一条");
        leaveComments(editor);
        await vi.waitFor(() => expect(popover()).toBeNull());
    });

    it("指针移向卡片：经过空白（离开批注）时不收，进了卡片就留着，从卡片出来才收", async () => {
        const {editor} = harness(TWO);
        await peekOpen(editor, "乙丙");
        leaveComments(editor);
        // 收起的计时已经起了，指针这时进到卡片上。
        (popover() as HTMLElement).dispatchEvent(new Event("pointerenter"));
        await settle();
        expect(popover()?.textContent).toContain("第一条");
        (popover() as HTMLElement).dispatchEvent(new Event("pointerleave"));
        await vi.waitFor(() => expect(popover()).toBeNull());
    });

    it("在正文里按下鼠标、输入、Esc 收起；同一次悬停不再弹，指针离开批注再回来才弹", async () => {
        const {editor, scroller} = harness(TWO);
        const target = commentElement(editor, "乙丙");
        await peekOpen(editor, "乙丙");
        scroller.dispatchEvent(new Event("pointerdown", {bubbles: true}));
        await vi.waitFor(() => expect(popover()).toBeNull());
        // 点击以后指针还在这条批注上、Ctrl 也按着：再动一动（落在同一个元素上）不弹。
        moveOver(target, {ctrlKey: true});
        await settle();
        expect(popover()).toBeNull();
        // 离开再回来：弹。
        leaveComments(editor);
        moveOver(target, {ctrlKey: true});
        await vi.waitFor(() => expect(popover()?.textContent).toContain("第一条"));
        // 输入：收起，同一次悬停不再弹。
        editor.view.dispatch(editor.state.tr.insertText("字", find(editor, "辛").from));
        await vi.waitFor(() => expect(popover()).toBeNull());
        moveOver(target, {ctrlKey: true});
        await settle();
        expect(popover()).toBeNull();
        leaveComments(editor);
        await peekOpen(editor, "乙丙");
        keyDown(document, {key: "Escape"});
        await vi.waitFor(() => expect(popover()).toBeNull());
        moveOver(target, {ctrlKey: true});
        await settle();
        expect(popover()).toBeNull();
    });

    it("收起之后指针直接移到另一条批注上：同一次悬停不再弹；离开批注再回来才弹", async () => {
        const {editor, scroller} = harness(TWO);
        await peekOpen(editor, "乙丙");
        scroller.dispatchEvent(new Event("pointerdown", {bubbles: true}));
        await vi.waitFor(() => expect(popover()).toBeNull());
        moveOver(commentElement(editor, "己庚"), {ctrlKey: true});
        await settle();
        expect(popover()).toBeNull();
        leaveComments(editor);
        moveOver(commentElement(editor, "己庚"), {ctrlKey: true});
        await vi.waitFor(() => expect(popover()?.textContent).toContain("第二条"));
    });

    it("按住 Ctrl 点批注文字：弹出点开的卡片，光标不动、浏览器的默认动作被取消；指针离开也不收，Esc 收起", async () => {
        const {editor} = harness(TWO);
        const before = editor.state.selection.from;
        const target = commentElement(editor, "乙丙");
        const plain = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
        target.dispatchEvent(plain);
        expect(plain.defaultPrevented).toBe(false);
        const held = new MouseEvent("mousedown", {bubbles: true, cancelable: true, ctrlKey: true});
        target.dispatchEvent(held);
        expect(held.defaultPrevented).toBe(true);
        await ctrlClick(editor, "乙丙");
        expect(editor.state.selection.from).toBe(before);
        leaveComments(editor);
        await settle();
        expect(popover()?.textContent).toContain("第一条");
        keyDown(document, {key: "Escape"});
        await vi.waitFor(() => expect(popover()).toBeNull());
    });

    it("程序改的文档（不进历史：重载、写回回填）不收起开着的卡片，选区不空时收起", async () => {
        const {editor} = harness(TWO);
        await peekOpen(editor, "乙丙");
        editor.view.dispatch(editor.state.tr.insertText("新", find(editor, "辛").from).setMeta("addToHistory", false));
        await settle();
        expect(popover()?.textContent).toContain("第一条");
        editor.commands.setTextSelection(find(editor, "丁戊"));
        await vi.waitFor(() => expect(popover()).toBeNull());
    });

    it("注音、双语卡片或右键菜单开着（blocked）、页边画着时不弹，写着时不弹；放开后才弹", async () => {
        const {editor, wrapper} = harness(TWO, {blocked: true});
        moveOver(commentElement(editor, "乙丙"), {ctrlKey: true});
        clickMarker(editor);
        await settle();
        expect(popover()).toBeNull();
        await wrapper.setProps({blocked: false, marginDrawn: true});
        leaveComments(editor);
        moveOver(commentElement(editor, "乙丙"), {ctrlKey: true});
        clickMarker(editor);
        await settle();
        expect(popover()).toBeNull();
        await wrapper.setProps({marginDrawn: false});
        leaveComments(editor);
        await peekOpen(editor, "乙丙");
    });

    it("重叠的几条在一张卡片里上下排，每条各有序号", async () => {
        const {editor} = harness("甲<comment body=\"外\">乙<comment body=\"内\">丙</comment></comment>丁\n");
        await peekOpen(editor, "丙");
        expect([...(popover()?.querySelectorAll("[data-markdown-comment-body]") ?? [])].map((body) => body.textContent)).toEqual(["外", "内"]);
    });

    it("只读文档：没有焦点也弹，没有编辑与删除；Esc 收起", async () => {
        const {editor} = harness(TWO, {readonly: true});
        editor.view.dom.blur();
        await peekOpen(editor, "乙丙");
        expect(popover()?.querySelector('[aria-label="commentEdit"]')).toBeNull();
        keyDown(document, {key: "Escape"});
        await vi.waitFor(() => expect(popover()).toBeNull());
        clickMarker(editor, 1);
        await vi.waitFor(() => expect(popover()?.textContent).toContain("第二条"));
    });

    it("上一条、下一条：光标到目标批注开头，卡片留着并换成它；点开的仍是点开的", async () => {
        const {editor} = harness(TWO);
        clickMarker(editor, 0);
        await vi.waitFor(() => expect(popover()).not.toBeNull());
        (popover()?.querySelector('[aria-label="commentNext"]') as HTMLElement).click();
        await vi.waitFor(() => expect(popover()?.textContent).toContain("第二条"));
        expect(editor.state.selection.from).toBe(find(editor, "己庚").from);
        leaveComments(editor);
        await settle();
        expect(popover()?.textContent).toContain("第二条");
    });

    describe("小符号", () => {
        it("点符号弹出在这里结束的批注，光标与焦点不动、mousedown 的默认动作被取消；指针离开不收；再点同一个符号收起", async () => {
            const {editor} = harness(TWO);
            const before = editor.state.selection.from;
            expect(clickMarker(editor, 1)).toBe(true);
            await vi.waitFor(() => expect(popover()?.textContent).toContain("第二条"));
            expect(popover()?.textContent).not.toContain("第一条");
            expect(editor.state.selection.from).toBe(before);
            leaveComments(editor);
            await settle();
            expect(popover()).not.toBeNull();
            clickMarker(editor, 1);
            await vi.waitFor(() => expect(popover()).toBeNull());
        });

        it("点另一个符号换成它；两条结束在同一处的批注合成一个符号，卡片里是这两条，不含只是盖过这里的", async () => {
            const {editor} = harness("甲<comment body=\"长\">乙<comment body=\"短\">丙</comment></comment>丁<comment body=\"后\">戊</comment>\n");
            expect(editor.view.dom.querySelectorAll("[data-comment-marker]")).toHaveLength(2);
            clickMarker(editor, 0);
            await vi.waitFor(() => expect([...(popover()?.querySelectorAll("[data-markdown-comment-body]") ?? [])].map((body) => body.textContent)).toEqual(["长", "短"]));
            clickMarker(editor, 1);
            await vi.waitFor(() => expect([...(popover()?.querySelectorAll("[data-markdown-comment-body]") ?? [])].map((body) => body.textContent)).toEqual(["后"]));
        });

        it("点开的卡片：点正文别处、卡片与正文之外的地方、输入、Esc 收起；点卡片里不收", async () => {
            const {editor} = harness(TWO);
            clickMarker(editor, 0);
            await vi.waitFor(() => expect(popover()).not.toBeNull());
            (popover() as HTMLElement).dispatchEvent(new Event("pointerdown", {bubbles: true}));
            await settle();
            expect(popover()).not.toBeNull();
            document.body.dispatchEvent(new Event("pointerdown", {bubbles: true}));
            await vi.waitFor(() => expect(popover()).toBeNull());
            clickMarker(editor, 0);
            await vi.waitFor(() => expect(popover()).not.toBeNull());
            editor.view.dom.dispatchEvent(new Event("pointerdown", {bubbles: true}));
            await vi.waitFor(() => expect(popover()).toBeNull());
            clickMarker(editor, 0);
            await vi.waitFor(() => expect(popover()).not.toBeNull());
            editor.view.dispatch(editor.state.tr.insertText("字", find(editor, "辛").from));
            await vi.waitFor(() => expect(popover()).toBeNull());
        });

        it("从点开的卡片点编辑、保存：回到同一张卡片，仍是点开的", async () => {
            const {editor} = harness(TWO);
            clickMarker(editor, 0);
            await vi.waitFor(() => expect(popover()).not.toBeNull());
            (popover()?.querySelector('[aria-label="commentEdit"]') as HTMLElement).click();
            await vi.waitFor(() => expect(popover()?.querySelector("textarea")).not.toBeNull());
            await type(popover() as ParentNode, "符号处改的意见");
            keyDown(popover()?.querySelector("textarea") as HTMLElement, {key: "Enter", ctrlKey: true});
            await vi.waitFor(() => expect(popover()?.textContent).toContain("符号处改的意见"));
            leaveComments(editor);
            await settle();
            expect(popover()?.textContent).toContain("符号处改的意见");
        });
    });
});

describe("写（输出 28、29）", () => {
    it("悬停卡片上点编辑：同一张浮层变成“写”；保存后回到“看”，意见换了", async () => {
        const {editor} = harness(TWO);
        await peekOpen(editor, "乙丙");
        (popover()?.querySelector('[aria-label="commentEdit"]') as HTMLElement).click();
        await vi.waitFor(() => expect(popover()?.querySelector("textarea")).not.toBeNull());
        expect((popover()?.querySelector("textarea") as HTMLTextAreaElement).value).toBe("第一条");
        await type(popover() as ParentNode, "改过的意见");
        keyDown(popover()?.querySelector("textarea") as HTMLElement, {key: "Enter", ctrlKey: true});
        await vi.waitFor(() => expect(popover()?.textContent).toContain("改过的意见"));
        expect(listComments(editor.state.doc).map((info) => info.body)).toEqual(["改过的意见", "第二条"]);
        expect(popover()?.querySelector("textarea")).toBeNull();
    });

    it("鼠标停在批注 A 上、光标在批注 B 里按 Ctrl+Alt+M：改的是 B，保存后回到“看”的卡片对着 B，不是 A", async () => {
        const {editor} = harness(TWO);
        await peekOpen(editor, "乙丙");
        editor.commands.setTextSelection(find(editor, "己庚").from + 1);
        keyDown(editor.view.dom, {code: "KeyM", key: "m", ctrlKey: true, altKey: true});
        await vi.waitFor(() => expect(popover()?.querySelector("textarea")).not.toBeNull());
        expect((popover()?.querySelector("textarea") as HTMLTextAreaElement).value).toBe("第二条");
        await type(popover() as ParentNode, "改的是第二条");
        keyDown(popover()?.querySelector("textarea") as HTMLElement, {key: "Enter", ctrlKey: true});
        await vi.waitFor(() => expect(popover()?.textContent).toContain("改的是第二条"));
        expect(popover()?.textContent).not.toContain("第一条");
    });

    it("光标在批注里按 Ctrl+Alt+M 直接进“写”，取消后收起", async () => {
        const {editor} = harness(TWO);
        editor.commands.setTextSelection(find(editor, "乙丙").from + 1);
        keyDown(editor.view.dom, {code: "KeyM", key: "m", ctrlKey: true, altKey: true});
        await vi.waitFor(() => expect(popover()?.querySelector("textarea")).not.toBeNull());
        keyDown(popover()?.querySelector("textarea") as HTMLElement, {key: "Escape"});
        await vi.waitFor(() => expect(popoverSurface()).toBeNull());
    });

    it("块菜单的整块批注：beginAddBlock 开“写”，保存把这一块包进块批注；块变了就保存不了、字还在", async () => {
        const {editor, wrapper} = harness("甲\n\n```\ncode\n```\n");
        const block = editor.state.doc.child(0).nodeSize;
        (wrapper.vm as unknown as {beginAddBlock: (pos: number) => void}).beginAddBlock(block);
        await vi.waitFor(() => expect(popover()?.querySelector("textarea")).not.toBeNull());
        await type(popover() as ParentNode, "整块的意见");
        // 写着的时候这一块被换掉了。
        editor.view.dispatch(editor.state.tr.replaceWith(block, block + editor.state.doc.child(1).nodeSize, editor.schema.nodes.paragraph?.create(null, editor.schema.text("换了")) ?? []));
        keyDown(popover()?.querySelector("textarea") as HTMLElement, {key: "Enter", ctrlKey: true});
        await nextTick();
        await nextTick();
        expect(listComments(editor.state.doc)).toEqual([]);
        expect((popover()?.querySelector("textarea") as HTMLTextAreaElement).value).toBe("整块的意见");
    });

    it("整块批注保存：包进块批注，卡片收起", async () => {
        const {editor, wrapper} = harness("甲\n\n```\ncode\n```\n");
        const block = editor.state.doc.child(0).nodeSize;
        (wrapper.vm as unknown as {beginAddBlock: (pos: number) => void}).beginAddBlock(block);
        await vi.waitFor(() => expect(popover()?.querySelector("textarea")).not.toBeNull());
        await type(popover() as ParentNode, "整块的意见");
        keyDown(popover()?.querySelector("textarea") as HTMLElement, {key: "Enter", ctrlKey: true});
        await vi.waitFor(() => expect(popoverSurface()).toBeNull());
        expect(listComments(editor.state.doc).map((info) => [info.block, info.body])).toEqual([[true, "整块的意见"]]);
    });
});

describe("换文档（状态与转换）", () => {
    it("页边开着换到别的文档：卡片按新文档重排，不对着旧文档的位置", async () => {
        const {editor, wrapper} = harness(TWO, {marginDrawn: true});
        await nextTick();
        expect(marginItems()).toHaveLength(2);
        // 换成另一份没有批注的文档（只换编辑状态，不产生事务）。
        editor.view.updateState(stateOf(editor, "丙\n"));
        await wrapper.setProps({binding: "b"});
        await nextTick();
        await nextTick();
        expect(marginItems()).toHaveLength(0);
    });

    it("浮层开着时换文档：卡片收起，写着的字放弃", async () => {
        const {editor, wrapper} = harness(TWO);
        await peekOpen(editor, "乙丙");
        editor.view.updateState(stateOf(editor, TWO));
        await wrapper.setProps({binding: "b"});
        await vi.waitFor(() => expect(popover()).toBeNull());
    });
});

describe("页边（输出 33）", () => {
    it("两条意见与开头文字都相同的批注：光标进其中一条只有这一条是当前，点编辑只有一张卡片进入“写”", async () => {
        const {editor} = harness("甲<comment body=\"改\">的</comment>乙丙<comment body=\"改\">的</comment>丁<comment body=\"别\">戊</comment>\n", {marginDrawn: true});
        await nextTick();
        editor.commands.setTextSelection(find(editor, "的").from + 1);
        await nextTick();
        await nextTick();
        expect(marginItems().map((item) => item.dataset.mode)).toEqual(["current", "idle", "idle"]);
        (marginItems()[0]?.querySelector('[aria-label="commentEdit"]') as HTMLElement).click();
        await nextTick();
        await nextTick();
        expect(marginItems().map((item) => item.dataset.mode)).toEqual(["write", "idle", "idle"]);
        expect(document.querySelectorAll("[data-markdown-comment-margin] textarea")).toHaveLength(1);
    });

    it("写着的字在控件宽度跨过阈值（页边与浮层互相切换）时不丢", async () => {
        const {editor, wrapper} = harness("甲乙丙丁\n", {marginDrawn: true});
        editor.commands.setTextSelection(find(editor, "乙丙"));
        keyDown(editor.view.dom, {code: "KeyM", key: "m", ctrlKey: true, altKey: true});
        await nextTick();
        await nextTick();
        expect(marginItems().map((item) => item.dataset.mode)).toEqual(["write"]);
        await type(document.querySelector("[data-markdown-comment-margin]") as ParentNode, "写了很久的意见");
        await wrapper.setProps({marginDrawn: false});
        for (let index = 0; index < 6; index += 1) await nextTick();
        expect(document.querySelector("[data-markdown-comment-margin]")).toBeNull();
        expect((popover()?.querySelector("textarea") as HTMLTextAreaElement).value).toBe("写了很久的意见");
        await wrapper.setProps({marginDrawn: true});
        for (let index = 0; index < 6; index += 1) await nextTick();
        expect((document.querySelector("[data-markdown-comment-margin] textarea") as HTMLTextAreaElement).value).toBe("写了很久的意见");
    });

    it("块批注的卡片跨事务不重建：它前面打字、块的位置变了，页边里还是同一张卡片（重建会丢掉已显示的状态、重放入场动画）", async () => {
        const {editor} = harness("前文\n\n<comment body=\"块\">\n\n正文一\n\n正文二\n\n</comment>\n\n后文\n", {marginDrawn: true});
        await vi.waitFor(() => expect(marginItems()[0]?.hasAttribute("data-ready")).toBe(true));
        const card = marginItems()[0];
        for (let index = 0; index < 3; index += 1) {
            editor.view.dispatch(editor.state.tr.insertText("字", find(editor, "前文").from));
            await nextTick();
            await nextTick();
        }
        expect(marginItems()).toHaveLength(1);
        expect(marginItems()[0]).toBe(card);
        expect(card?.hasAttribute("data-ready")).toBe(true);
        // 新加的块批注是另一张卡片。
        editor.view.dispatch(editor.state.tr.insertText("字", find(editor, "后文").from));
        await nextTick();
        expect(marginItems()[0]).toBe(card);
    });

    it("光标在同一条批注里走动不重复标出：每次选区变化只有一个事务", async () => {
        const {editor} = harness(TWO, {marginDrawn: true});
        const inside = find(editor, "乙丙").from;
        editor.commands.setTextSelection(inside);
        await nextTick();
        await nextTick();
        let transactions = 0;
        editor.on("transaction", () => {
            transactions += 1;
        });
        editor.commands.setTextSelection(inside + 1);
        await nextTick();
        editor.commands.setTextSelection(inside + 2);
        await nextTick();
        expect(transactions).toBe(2);
    });
});

describe("加批注加不上（输出 28）", () => {
    it("保存时选区所在的块已经不允许批注：卡片留在“写”里，字还在，文档不变", async () => {
        const {editor} = harness("甲乙丙\n");
        editor.commands.setTextSelection(find(editor, "乙"));
        keyDown(editor.view.dom, {code: "KeyM", key: "m", ctrlKey: true, altKey: true});
        await vi.waitFor(() => expect(popover()?.querySelector("textarea")).not.toBeNull());
        await type(popover() as ParentNode, "要加的意见");
        // 写着的时候选区所在的段被换成代码块（代码块里不允许批注）。
        editor.commands.setCodeBlock();
        await nextTick();
        keyDown(popover()?.querySelector("textarea") as HTMLElement, {key: "Enter", ctrlKey: true});
        await nextTick();
        await nextTick();
        expect(listComments(editor.state.doc)).toEqual([]);
        expect((popover()?.querySelector("textarea") as HTMLTextAreaElement).value).toBe("要加的意见");
    });
});
