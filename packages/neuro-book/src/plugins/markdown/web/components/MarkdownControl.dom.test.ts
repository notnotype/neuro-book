/**
 * MarkdownControl（同名 .md）接编解码器（docs/specs/workspace/markdown-dialect.md 输出 1–3、“状态与转换”；docs/specs/workbench/
 * editor.md 输出 12、19、61）：happy-dom 里的真实 Tiptap 编辑器，绑定来自真实的编辑器区与文档模型，文件客户端是与真实
 * Files 对过契约的内存适配器（Lab 的 `memory-files.ts`）。交出不等 150ms 的停手延迟，经句柄的 `flushPendingChange` 立即结算。
 */

import type {Editor} from "@tiptap/core";
import {Slice} from "@tiptap/pm/model";
import type {Node as PMNode} from "@tiptap/pm/model";
import {EditorState} from "@tiptap/pm/state";
import {mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {computed, defineComponent, h, nextTick, ref, shallowRef} from "vue";
import type {Ref} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {StickerResolver} from "@notnotype/nb-markdown";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {codecFor, defaultMarkdownLanguage as markdownLanguage} from "@notnotype/nb-markdown/language";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";

import {createLabEditorMenus} from "nbook/plugins/editor/web/lab/lab-editor-menus";
import {createMemoryFiles} from "nbook/plugins/explorer/web/lab/memory-files";
import {editorCatalogs} from "nbook/plugins/editor/web/text";

import {holdSelection, listComments, markdownEditingActions} from "@notnotype/nb-markdown/editor";

import {EDITING_ACTIONS, editorMenusKey, markdownEditorOptionsKey, MARKDOWN_EDITOR} from "nbook/plugins/editor/shared/contracts";
import type {EditorControlHandle, EditorMenus, MarkdownEditorOptions, TextEditorBinding} from "nbook/plugins/editor/shared/contracts";
import {createEditorArea} from "nbook/plugins/editor/web/area";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";
import type {EditorArea} from "nbook/plugins/editor/web/area";
import type {WindowText} from "nbook/shared/window-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";
import {createAssetUrls, markdownAssetsKey} from "../parts/asset-urls";
import {markdownStickersKey} from "../parts/stickers";
import {SyntaxCatalog, syntaxCatalogKey} from "../syntax-catalog";
import {memoryPropertiesOpen, markdownPropertiesOpenKey} from "../properties-open";
import type {PropertiesOpen} from "../properties-open";
import {createMarkdownMedia, markdownMediaKey} from "../media";
import type {MarkdownMedia} from "../media";
import {markdownCatalogs} from "../text";
import MarkdownControl from "./MarkdownControl.vue";

/** nbook.markdown 交组件时给的方言目录（`web/plugin.ts`）：这里没有外来方言。 */
const catalog = new SyntaxCatalog({get: () => null, list: () => []}, () => undefined);
/**
 * 图片地址服务：字节路由的 URL 换成可读的 `/raw/<地址>`（真实的 `rawUrl` 带作品与代次，见 `asset-urls.test.ts`）；这里不看
 * 磁盘变化。
 */
const assets = createAssetUrls({rawUrl: (address) => `/raw/${address}`, watch: () => () => undefined});

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

interface Opened {
    readonly area: EditorArea;
    readonly memory: ReturnType<typeof createMemoryFiles>;
    readonly binding: TextEditorBinding;
    readonly editor: Editor;
    readonly handle: EditorControlHandle;
    readonly groupId: string;
    /** 窗口的翻译引擎：登记了内置插件 `nbook.markdown` 的目录，控件经它注入的端口取文字。 */
    readonly text: WindowText;
    readonly wrapper: VueWrapper;
    /** 属性面板的展开状态：每次挂载一份内存里的，用例之间不串。 */
    readonly propertiesOpen: PropertiesOpen;
}

/** 打开 `a.md`（正文 `text`），挂一个 Markdown 控件到活动组。 */
async function opened(text: string, area?: {readonly area: EditorArea; readonly memory: ReturnType<typeof createMemoryFiles>}, onError?: (error: unknown) => void, options: {readonly menus?: boolean; readonly margin?: boolean; readonly media?: MarkdownMedia; readonly wrapMenus?: (menus: EditorMenus) => EditorMenus; readonly paper?: Ref<MarkdownEditorOptions>; readonly stickers?: StickerResolver} = {}): Promise<Opened> {
    const memory = area?.memory ?? createMemoryFiles({project: [["a.md", text]], user: []});
    const editorArea = area?.area ?? createEditorArea({files: memory.files, clock: systemClock, panels: createMemoryEditorPanels(), workspaceKey: "test", generation: 1, initial: null, report: (error) => {
        throw error;
    }});
    if (area === undefined) {
        cleanups.push(() => memory.dispose());
        cleanups.push(() => editorArea.dispose());
        editorArea.open("project://a.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
    }
    const groupId = editorArea.groups.activeGroup.value;
    const binding = await waitUntil("文档读到", () => {
        const found = editorArea.binding(groupId);
        return found?.kind === "text" && editorArea.documentOf(groupId)?.status.value === "ready" ? found : null;
    });
    let handle: EditorControlHandle | null = null;
    const propertiesOpen = memoryPropertiesOpen();
    const tabId = binding.tabId;
    const host = editorArea.tabControlSlot(tabId, MARKDOWN_EDITOR);
    const windowText = createHostTextEngine({locale: "zh-CN", strict: true});
    windowText.register("nbook.markdown", markdownCatalogs.catalogs, markdownCatalogs.source);
    // 要菜单与卡片的用例才提供：Lab 的菜单夹具（命令服务换成直接转给活动控件），文字目录用真实的编辑器目录。
    if (options.menus === true) windowText.register("nbook.editor", editorCatalogs.catalogs, editorCatalogs.source);
    // 句柄交给编辑器区（与 `EditorGroup` 一样），区域的定位、结算经它找到控件。
    const wrapper = mount(MarkdownControl, {props: {binding, host, readonly: false, visible: true, label: "a.md", onReady: (ready: EditorControlHandle | null) => {
        handle = ready;
        editorArea.registerTabHandle(tabId, MARKDOWN_EDITOR, ready);
    }}, attachTo: document.body, global: {provide: {[syntaxCatalogKey as symbol]: catalog, [markdownAssetsKey as symbol]: assets, [TEXT_PORT_KEY as symbol]: windowText.port, [markdownPropertiesOpenKey as symbol]: propertiesOpen, ...(options.menus === true ? {[editorMenusKey as symbol]: ((menus) => (options.wrapMenus === undefined ? menus : options.wrapMenus(menus)))(options.margin === true ? {...createLabEditorMenus(editorArea, windowText.port), commentMargin: ref(true)} : createLabEditorMenus(editorArea, windowText.port))} : {}), ...(options.media === undefined ? {} : {[markdownMediaKey as symbol]: options.media}), ...(options.paper === undefined ? {} : {[markdownEditorOptionsKey as symbol]: options.paper}), ...(options.stickers === undefined ? {} : {[markdownStickersKey as symbol]: options.stickers})}, ...(onError === undefined ? {} : {config: {errorHandler: onError}})}});
    cleanups.push(() => wrapper.unmount());
    const editor = (host.state as {editor: Editor}).editor;
    return {area: editorArea, memory, binding, editor, handle: handle as unknown as EditorControlHandle, groupId, text: windowText, wrapper, propertiesOpen};
}

/** 第 n 个顶层块里第一个文本块的末尾。 */
function endOfBlock(editor: Editor, index: number): number {
    let end = -1;
    editor.state.doc.forEach((node, offset, at) => {
        if (at !== index) return;
        if (node.isTextblock) end = offset + 1 + node.content.size;
        node.descendants((child, pos) => {
            if (end < 0 && child.isTextblock) end = offset + 1 + pos + 1 + child.content.size;
            return end < 0;
        });
    });
    return end;
}

describe("交出（方言 Spec 输出 1–3）", () => {
    it("打开不编辑、结算：正文不变；只改一块：只有那一块重新写出，其余字节不变", async () => {
        const source = "* 甲\r\n\r\n<ruby>汉<rt>hàn</rt></ruby>字\r\n\r\n乙\r\n";
        const {editor, handle, binding} = await opened(source);
        handle.flushPendingChange();
        expect(binding.text.value).toBe(source);
        editor.commands.insertContentAt(endOfBlock(editor, 2), "改");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("* 甲\r\n\r\n<ruby>汉<rt>hàn</rt></ruby>字\r\n\r\n乙改\r\n");
    });

    it("打了字还没到停手：登记的“还有没交出的输入”为真，交出后为假（editor 输出 63）", async () => {
        const {area, editor, handle, binding, groupId} = await opened("甲\n");
        const document = area.documentOf(groupId)!;
        expect(area.documents.pending(document)).toBe(false);
        editor.commands.focus("end");
        type(editor, "乙");
        expect(binding.text.value).toBe("甲\n");
        expect(area.documents.pending(document)).toBe(true);
        handle.flushPendingChange();
        expect(binding.text.value).toBe("甲乙\n");
        expect(area.documents.pending(document)).toBe(false);
    });

    it("写回被接受后写法固定（输出 2）：为分开相邻列表换了符号的新列表，删掉前一个列表再改它，仍写 `*`", async () => {
        const {editor, handle, binding} = await opened("- 甲\n\n正文\n");
        // 把“正文”一段换成一个新列表（编辑器的“转为列表”会并进前一个列表，这里要的是两个相邻的列表）。
        const {schema, doc} = editor.state;
        const list = schema.nodes.bulletList!.create(null, schema.nodes.listItem!.create(null, schema.nodes.paragraph!.create(null, schema.text("正文"))));
        editor.view.dispatch(editor.state.tr.replaceWith(doc.child(0).nodeSize, doc.content.size, list));
        handle.flushPendingChange();
        expect(binding.text.value).toBe("- 甲\n\n* 正文\n");
        editor.commands.deleteRange({from: 0, to: editor.state.doc.child(0).nodeSize});
        editor.commands.insertContentAt(endOfBlock(editor, 0), "改");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("* 正文改\n");
    });

    it("删光正文后默认块是段落，写成空正文", async () => {
        const {editor, handle, binding} = await opened("甲\n\n乙\n");
        editor.commands.selectAll();
        editor.commands.deleteSelection();
        expect(editor.state.doc.child(0).type.name).toBe("paragraph");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("");
    });

    it("只改了 frontmatter（文档属性的事务）：交出写回新的原文、面板跟着换，正文字节不变；撤销回到原来的（方言 Spec 输出 22）", async () => {
        const {editor, handle, binding, wrapper} = await opened("---\na: 1\n---\n\n甲\n");
        const shown = (): string => wrapper.get("[data-property-summary]").text();
        editor.view.dispatch(editor.state.tr.setDocAttribute("frontmatter", "---\na: 2\n---\n"));
        handle.flushPendingChange();
        expect(binding.text.value).toBe("---\na: 2\n---\n\n甲\n");
        await waitUntil("面板换成新的", () => shown() === "a 2");
        editor.commands.undo();
        handle.flushPendingChange();
        expect(binding.text.value).toBe("---\na: 1\n---\n\n甲\n");
        await waitUntil("面板换回原来的", () => shown() === "a 1");
    });
});

/**
 * 打字：与浏览器里打字同一条路径。ProseMirror 读到页面里插入的字后先交 `handleTextInput`（输入规则在这里），没人接手时按
 * 光标处该带的格式插入（`insertText`，见 prosemirror-view 的 `readDOMChange`）。不能用 `insertContentAt`：它不按光标处的格式插入。
 */
function type(editor: Editor, text: string): void {
    const view = editor.view;
    for (const char of text) {
        const {from, to} = view.state.selection;
        const insert = () => view.state.tr.insertText(char, from, to);
        if (!view.someProp("handleTextInput", (handle) => handle(view, from, to, char, insert))) view.dispatch(insert());
    }
}

/**
 * 按键：先交编辑器的按键处理（Tiptap 的键位：回车分段、段首退格并段）。退格删一个字没人接手时是浏览器自己删，ProseMirror
 * 读回这次删除时把被删文字的格式记成接着打字要用的格式（`readDOMChange` 的 `ensureMarks`），这里照做。
 */
function press(editor: Editor, key: "Enter" | "Backspace"): void {
    const view = editor.view;
    if (view.someProp("handleKeyDown", (handle) => handle(view, new KeyboardEvent("keydown", {key})))) return;
    if (key !== "Backspace") throw new Error(`没人接手的 ${key}`);
    const {from} = view.state.selection;
    const marks = view.state.doc.resolve(from - 1).marksAcross(view.state.doc.resolve(from));
    const tr = view.state.tr.delete(from - 1, from);
    if (marks !== null) tr.ensureMarks(marks);
    view.dispatch(tr);
}

/** 打开 `text`，光标放到第一段的行首（`start`）、行尾（`end`）或行尾往前数 n 个字，按键、打字，返回写出的原文。 */
async function typed(text: string, at: "start" | "end" | number, keys: ReadonlyArray<"Enter" | "Backspace">, input: string): Promise<string> {
    const {editor, handle, binding} = await opened(text);
    const end = endOfBlock(editor, 0);
    editor.commands.setTextSelection(at === "start" ? 1 : at === "end" ? end : end - at);
    for (const key of keys) press(editor, key);
    type(editor, input);
    handle.flushPendingChange();
    return binding.text.value;
}

describe("纸面排版（workbench.editor 输出 32、52）", () => {
    it("没有注入：根上不写变量；注入后字号、行距写在根的内联变量上，字体留空不写，改设置立即跟着变", async () => {
        const plain = await opened("甲\n");
        const root = (wrapper: VueWrapper) => (wrapper.element as HTMLElement).style;
        expect(root(plain.wrapper).getPropertyValue("--markdown-font-size")).toBe("");
        const paper = ref<MarkdownEditorOptions>({fontFamily: "", fontSize: 20, lineHeight: 2.2});
        const {wrapper} = await opened("乙\n", undefined, undefined, {paper});
        expect(root(wrapper).getPropertyValue("--markdown-font-size")).toBe("20px");
        expect(root(wrapper).getPropertyValue("--markdown-line-height")).toBe("2.2");
        expect(root(wrapper).getPropertyValue("--markdown-user-font")).toBe("");
        paper.value = {fontFamily: "Noto Serif SC, serif", fontSize: 18, lineHeight: 1.6};
        await nextTick();
        expect(root(wrapper).getPropertyValue("--markdown-font-size")).toBe("18px");
        expect(root(wrapper).getPropertyValue("--markdown-user-font")).toBe("Noto Serif SC, serif");
    });
});

describe("在格式的边界打字（workbench.editor 输出 62）", () => {
    const cases: ReadonlyArray<readonly [string, string, "start" | "end" | number, string, string]> = [
        ["引用小块的行尾", "[123](project://123)\n", "end", "后", "[123](project://123)后\n"],
        ["引用小块的行首", "[123](project://123)\n", "start", "前", "前[123](project://123)\n"],
        ["引用小块的文字中间", "[123](project://123)\n", 1, "x", "[12x3](project://123)\n"],
        ["外部链接的末尾，后面还有字", "看[官网](https://example.com)。\n", 1, "后", "看[官网](https://example.com)后。\n"],
        ["粗体的末尾：接着是粗体", "**粗**\n", "end", "体", "**粗体**\n"],
        ["斜体的末尾：接着是斜体", "*斜*\n", "end", "体", "*斜体*\n"],
        ["删除线的末尾：接着是删除线", "~~删~~\n", "end", "掉", "~~删掉~~\n"],
        ["文字颜色的末尾：接着是同一颜色", "<span style=\"color: red\">红</span>\n", "end", "字", "<span style=\"color: red\">红字</span>\n"],
        ["行内代码的末尾", "`code`\n", "end", "后", "`code`后\n"],
        ["高亮的末尾", "==亮==\n", "end", "后", "==亮==后\n"],
        ["批注的末尾", "她<comment body=\"节奏\">看了他一眼</comment>\n", "end", "。", "她<comment body=\"节奏\">看了他一眼</comment>。\n"],
        ["注音的末尾", "<ruby>临川<rt>línchuān</rt></ruby>\n", "end", "城", "<ruby>临川<rt>línchuān</rt></ruby>城\n"],
    ];
    for (const [name, text, at, input, expected] of cases) {
        it(name, async () => {
            expect(await typed(text, at, [], input)).toBe(expected);
        });
    }

    it("引用小块的行尾回车再打字：新的一段是普通文字", async () => {
        expect(await typed("[123](project://123)\n", "end", ["Enter"], "下")).toBe("[123](project://123)\n\n下\n");
    });

    it("链接末尾退格再打字：字在链接外（不带的格式删字后同样不带）；链接文字删光再打字是普通文字，不留空链接", async () => {
        expect(await typed("[123](project://123)\n", "end", ["Backspace"], "4")).toBe("[12](project://123)4\n");
        expect(await typed("看[12](project://12)\n", "end", ["Backspace", "Backspace"], "新")).toBe("看新\n");
    });

    it("粗体删光再打字仍是粗体（与常见的文字处理软件相同）", async () => {
        expect(await typed("看**粗**\n", "end", ["Backspace"], "体")).toBe("看**体**\n");
    });

    it("刚打完字就用快捷键关掉粗体、开斜体，停手交出之后再打字：后面的字用切换后的格式", async () => {
        const {editor, handle, binding} = await opened("看\n");
        editor.commands.setTextSelection(endOfBlock(editor, 0));
        // 与 prosemirror-keymap 认 `Mod` 的办法相同：苹果平台是 Meta，其余是 Ctrl。
        const mod = /Mac|iP(?:hone|[oa]d)/u.test(navigator.platform) ? {metaKey: true} : {ctrlKey: true};
        const shortcut = (key: string): void => {
            expect(editor.view.someProp("handleKeyDown", (onKeyDown) => onKeyDown(editor.view, new KeyboardEvent("keydown", {key, ...mod})))).toBe(true);
        };
        shortcut("b");
        type(editor, "粗");
        shortcut("b");
        shortcut("i");
        // 停手的交出落在快捷键与下一个字之间：新加的粗体写回被接受后，控件把写法回填进编辑器，这一步不能冲掉刚切换的格式。
        handle.flushPendingChange();
        expect(binding.text.value).toBe("看**粗**\n");
        type(editor, "斜");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("看**粗***斜*\n");
    });

    it("打网址与邮箱再打空格：是文字，写回时转义", async () => {
        expect(await typed("见\n", "end", [], " https://example.com 与 me@example.com 了")).toBe("见 https\\://example.com 与 me\\@example.com 了\n");
    });
});

describe("编辑动作（workbench.markdown-editing）", () => {
    it("句柄的动作作用于编辑器；勾选状态跟着选区变", async () => {
        const {editor, handle} = await opened("字\n\n别的\n");
        const editing = handle.editing!;
        const bold = computed(() => editing.active("bold"));
        editor.commands.setTextSelection({from: 1, to: 2});
        expect(editing.hasSelection.value).toBe(true);
        expect(bold.value).toBe(false);
        expect(editing.run("bold")).toBe(true);
        expect(bold.value).toBe(true);
        editor.commands.setTextSelection(5);
        expect(bold.value).toBe(false);
        expect(editing.hasSelection.value).toBe(false);
    });

    it("只读时动作不生效，可用性为假", async () => {
        const {wrapper, editor, handle} = await opened("字\n");
        await wrapper.setProps({readonly: true});
        editor.commands.selectAll();
        const before = editor.getJSON();
        expect(handle.editing!.enabled("bold")).toBe(false);
        expect(handle.editing!.run("bold")).toBe(false);
        expect(editor.getJSON()).toEqual(before);
    });

    it("目录里的每个动作都有实现", () => {
        const missing = Object.keys(EDITING_ACTIONS).filter((id) => markdownEditingActions[id] === undefined);
        expect(missing).toEqual([]);
    });

    it("不认识的动作不可用", async () => {
        const {handle} = await opened("字\n");
        expect(handle.editing!.enabled("没有这个")).toBe(false);
        expect(handle.editing!.run("没有这个")).toBe(false);
    });
});

describe("显示（方言 Spec 输出 23）", () => {
    it("带 `-` 的提示块一开始折叠，点标题展开、再点折叠；折叠状态不写回文件；没有折叠标记的不能折叠", async () => {
        const source = "> [!WARNING]- 伏笔\n> 她早就知道。\n\n> [!NOTE]\n> 普通。\n";
        const {handle, binding} = await opened(source);
        const [foldable, plain] = [...document.querySelectorAll<HTMLElement>(".nb-callout")];
        const content = (callout: HTMLElement | undefined): HTMLElement => callout?.querySelector(".nb-callout__content") as HTMLElement;
        expect(content(foldable).hidden).toBe(true);
        foldable?.querySelector<HTMLElement>(".nb-callout__label")?.click();
        expect(content(foldable).hidden).toBe(false);
        expect(foldable?.querySelector(".nb-callout__toggle")?.getAttribute("aria-expanded")).toBe("true");
        foldable?.querySelector<HTMLElement>(".nb-callout__toggle")?.click();
        expect(content(foldable).hidden).toBe(true);
        plain?.querySelector<HTMLElement>(".nb-callout__label")?.click();
        expect(content(plain).hidden).toBe(false);
        expect((plain?.querySelector(".nb-callout__toggle") as HTMLElement).hidden).toBe(true);
        handle.flushPendingChange();
        expect(binding.text.value).toBe(source);
    });

    it("折叠的提示块里看不见的内容不会被悄悄改掉：在后一段段首退格并进去、或光标移进去，它就展开", async () => {
        const {editor} = await opened("> [!WARNING]- 伏笔\n> 内容\n\n后一段\n");
        const content = (): HTMLElement => document.querySelector(".nb-callout__content") as HTMLElement;
        expect(content().hidden).toBe(true);
        editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 1);
        expect(content().hidden).toBe(true);
        editor.commands.joinBackward();
        expect(editor.state.doc.childCount).toBe(1);
        expect(content().hidden).toBe(false);

        const second = await opened("> [!WARNING]- 伏笔\n> 内容\n\n后一段\n");
        second.editor.commands.setTextSelection(3);
        expect((document.querySelectorAll(".nb-callout__content")[1] as HTMLElement).hidden).toBe(false);
    });

    it("同一个编辑器换到另一份文档：提示块按新文档的折叠标记显示，不沿用前一份的", async () => {
        const {editor} = await opened("> [!NOTE] 甲\n> 内容\n");
        expect((document.querySelector(".nb-callout__content") as HTMLElement).hidden).toBe(false);
        // 控件换文档时的做法（`load`）：按新正文建编辑状态。
        const read = codecFor(editor.schema, markdownLanguage()).read("> [!WARNING]- 乙\n> 内容\n");
        editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
        expect((document.querySelector(".nb-callout__content") as HTMLElement).hidden).toBe(true);
    });
});

describe("结算（同一文档的几个控件）", () => {
    it("先挂的有缓冲输入、后挂的还没跟上：结算不把后挂的当输入，不产生假冲突，保存照常", async () => {
        const first = await opened("甲\n");
        expect(first.area.split("right")).toEqual({ok: true});
        const second = await opened("甲\n", {area: first.area, memory: first.memory});
        first.editor.commands.insertContentAt(endOfBlock(first.editor, 0), "乙");
        const document = first.area.documentOf(first.groupId);
        if (document === null) throw new Error("没有文档");
        first.area.documents.settle(document);
        expect(first.binding.text.value).toBe("甲乙\n");
        expect(second.binding.unresolved()).toBe(false);
        expect(await first.area.documents.save(document)).toEqual({ok: true});
    });

    it("真的两边都有输入：后挂的有缓冲输入、基于旧修订，照常是未裁决", async () => {
        const first = await opened("甲\n");
        expect(first.area.split("right")).toEqual({ok: true});
        const second = await opened("甲\n", {area: first.area, memory: first.memory});
        first.editor.commands.insertContentAt(endOfBlock(first.editor, 0), "左");
        second.editor.commands.insertContentAt(endOfBlock(second.editor, 0), "右");
        const document = first.area.documentOf(first.groupId);
        if (document === null) throw new Error("没有文档");
        first.area.documents.settle(document);
        expect(first.binding.unresolved() !== second.binding.unresolved()).toBe(true);
    });
});

describe("换文档（“状态与转换”）", () => {
    it("注音卡片开着时画的选区高亮不随编辑状态存下：换到别的文档再换回来，正文里没有残留（markdown-editing 输出 9）", async () => {
        const memory = createMemoryFiles({project: [["a.md", "甲乙\n"], ["b.md", "丙\n"]], user: []});
        const area = createEditorArea({files: memory.files, clock: systemClock, panels: createMemoryEditorPanels(), workspaceKey: "test", generation: 1, initial: null, report: (error) => {
            throw error;
        }});
        cleanups.push(() => memory.dispose());
        cleanups.push(() => area.dispose());
        const groupId = area.groups.activeGroup.value;
        const read = async (path: string, text: string): Promise<TextEditorBinding> => {
            area.open(`project://${path}`, {mode: "permanent", editor: MARKDOWN_EDITOR});
            return waitUntil(`${path} 读到`, () => {
                const found = area.binding(groupId);
                return found?.kind === "text" && found.text.value === text && area.documentOf(groupId)?.status.value === "ready" ? found : null;
            });
        };
        const a = await read("a.md", "甲乙\n");
        const b = await read("b.md", "丙\n");
        area.open("project://a.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
        const windowText = createHostTextEngine({locale: "zh-CN", strict: true});
        windowText.register("nbook.markdown", markdownCatalogs.catalogs, markdownCatalogs.source);
        // 与 EditorGroup 一样，换标签时绑定与实例槽一起换。不用 setProps：绑定里有 ref，测试工具把这样的属性另存，setProps 改不到。
        const current = shallowRef(a);
        const wrapper = mount(defineComponent(() => () => h(MarkdownControl, {binding: current.value, host: area.tabControlSlot(current.value.tabId, MARKDOWN_EDITOR), readonly: false, visible: true, label: "a.md"})), {attachTo: document.body, global: {provide: {[syntaxCatalogKey as symbol]: catalog, [markdownAssetsKey as symbol]: assets, [TEXT_PORT_KEY as symbol]: windowText.port}}});
        cleanups.push(() => wrapper.unmount());
        const editor = (area.tabControlSlot(a.tabId, MARKDOWN_EDITOR).state as {editor: Editor}).editor;
        editor.commands.setTextSelection({from: 1, to: 3});
        expect(holdSelection(editor)).toBe(true);
        expect(document.querySelectorAll(".nb-markdown-held-selection")).toHaveLength(1);

        // 焦点还在卡片里时换了文档（快捷键、文件被删、别处打开）：控件先存下这份的编辑状态，再换。
        current.value = b;
        await nextTick();
        expect(editor.state.doc.textContent).toBe("丙");
        current.value = a;
        await nextTick();
        expect(editor.state.doc.textContent).toBe("甲乙");
        expect(document.querySelectorAll(".nb-markdown-held-selection")).toHaveLength(0);
    });
});

describe("卸载", () => {
    it("编辑器区先释放了实例（组关闭、Lab 切走）再卸载控件：卸载前的结算照常写出，不报错", async () => {
        const errors: unknown[] = [];
        const {editor, binding, area, groupId} = await opened("甲\n", undefined, (error) => errors.push(error));
        editor.commands.insertContentAt(endOfBlock(editor, 0), "乙");
        area.tabControlSlot(binding.tabId, MARKDOWN_EDITOR).dispose?.();
        // 最后登记的清理是卸载控件（见 `opened`）：文档还在，只卸载控件。
        cleanups.pop()?.();
        expect(errors).toEqual([]);
        expect(binding.text.value).toBe("甲乙\n");
    });
});

describe("重载（“状态与转换”、editor 输出 12）", () => {
    it("有批注的文件：别处只改了末段，本组之前的输入仍能撤销，撤销后末段保留别处的修改", async () => {
        const {editor, handle, binding, memory, area, groupId} = await opened("<comment body=\"意见\">甲</comment>\n\n中间\n\n尾\n");
        editor.commands.insertContentAt(endOfBlock(editor, 1), "改");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("<comment body=\"意见\">甲</comment>\n\n中间改\n\n尾\n");
        // 保存之后磁盘的新内容才直接换进正文（没保存时只提示磁盘变了）。
        expect(await area.documents.save(area.documentOf(groupId)!)).toEqual({ok: true});
        memory.externalWrite("project://a.md", "<comment body=\"意见\">甲</comment>\n\n中间改\n\n尾外改\n");
        await waitUntil("重载", () => editor.state.doc.textContent.includes("尾外改"));
        editor.commands.undo();
        expect(editor.state.doc.textContent).toBe("甲中间尾外改");
    });

    it("磁盘的新内容：只换不同的那一段，之后只改一块时其余块按新原文写回", async () => {
        const {editor, handle, binding, memory} = await opened("* 甲&amp;\n\n乙\n");
        // 新内容里也有重新写出时会变的写法（`&amp;` 会写成 `&`）：只有按新原文写回时才保持。
        memory.externalWrite("project://a.md", "* 甲&amp;\n\n丙&amp;\n\n戊\n");
        await waitUntil("重载", () => editor.state.doc.textContent.includes("戊"));
        editor.commands.insertContentAt(endOfBlock(editor, 2), "丁");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("* 甲&amp;\n\n丙&amp;\n\n戊丁\n");
    });

    it("frontmatter 在正文上方的属性面板里、不在正文里；磁盘改了它，面板跟着换，改正文时它的字节不变（方言 Spec 输出 22）", async () => {
        const {editor, handle, binding, memory, wrapper, area, groupId} = await opened("\uFEFF---\r\na: 1\r\n---\r\n甲\r\n");
        const shown = (): string | null => (wrapper.find("[data-property-summary]").exists() ? wrapper.get("[data-property-summary]").text() : null);
        expect(shown()).toBe("a 1");
        expect(editor.state.doc.textContent).toBe("甲");
        memory.externalWrite("project://a.md", "\uFEFF---\r\na: 2\r\n---\r\n甲\r\n");
        await waitUntil("重载", () => shown() === "a 2");
        editor.commands.insertContentAt(endOfBlock(editor, 0), "乙");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("\uFEFF---\r\na: 2\r\n---\r\n甲乙\r\n");
        // 保存之后磁盘的新内容才直接换进正文（没保存时只提示磁盘变了）。
        expect(await area.documents.save(area.documentOf(groupId)!)).toEqual({ok: true});
        memory.externalWrite("project://a.md", "\uFEFF甲乙\r\n");
        await waitUntil("去掉 frontmatter 后重载", () => shown() === null);
    });
});

describe("属性面板（workbench.markdown-editing 输出 39–51）", () => {
    const panelInput = (wrapper: VueWrapper, label: string) => wrapper.get<HTMLInputElement>(`[data-markdown-properties] input[aria-label="${label}"]`);

    it("没有 frontmatter 不画；面板改一个值：交出只换这一行，一个撤销步；展开按文件记下", async () => {
        const plain = await opened("甲\n");
        expect(plain.wrapper.find("[data-markdown-properties]").exists()).toBe(false);
        const {wrapper, editor, handle, binding, propertiesOpen} = await opened("---\r\n# 注\r\n视角: 林雪\r\n---\r\n甲\r\n");
        expect(wrapper.find(`[data-markdown-properties] input[aria-label="视角"]`).exists()).toBe(false);
        await wrapper.get("[data-markdown-properties] button[aria-expanded]").trigger("click");
        expect(propertiesOpen.isOpen(binding.address.value)).toBe(true);
        const input = panelInput(wrapper, "视角");
        input.element.focus();
        await input.setValue("yes");
        await input.trigger("keydown", {key: "Enter"});
        handle.flushPendingChange();
        expect(binding.text.value).toBe("---\r\n# 注\r\n视角: \"yes\"\r\n---\r\n甲\r\n");
        editor.commands.undo();
        handle.flushPendingChange();
        expect(binding.text.value).toBe("---\r\n# 注\r\n视角: 林雪\r\n---\r\n甲\r\n");
    });

    it("面板里还没写回的输入算没交出的输入：结算先写回，再交出", async () => {
        const {wrapper, handle, binding, propertiesOpen} = await opened("---\na: 1\n---\n甲\n");
        propertiesOpen.set(binding.address.value, true);
        await nextTick();
        const input = panelInput(wrapper, "a");
        input.element.focus();
        await input.setValue("2");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("---\na: 2\n---\n甲\n");
    });

    it("面板写回后停手的计时到点：另一个输入里打了一半的字不当成写回（输出 42）", async () => {
        const {wrapper, binding, propertiesOpen} = await opened("---\na: 1\nb: 2\n---\n甲\n");
        propertiesOpen.set(binding.address.value, true);
        await nextTick();
        const value = panelInput(wrapper, "b");
        value.element.focus();
        await value.setValue("5");
        await value.trigger("keydown", {key: "Enter"});
        const name = panelInput(wrapper, "属性名：a");
        name.element.focus();
        await name.setValue("ti");
        await waitUntil("停手后交出 b 的写回", () => binding.text.value.includes("b: 5"));
        expect(binding.text.value).toBe("---\na: 1\nb: 5\n---\n甲\n");
        expect(name.element.value).toBe("ti");
    });

    it("只用回车换行的文档新建 frontmatter：写成 \\n 的一段，面板照常挂上、能交出", async () => {
        const {wrapper, handle, binding} = await opened("甲\r乙\r");
        expect(handle.editing?.run("properties")).toBe(true);
        await waitUntil("面板挂上", () => wrapper.find("[data-markdown-properties]").exists());
        handle.flushPendingChange();
        expect(binding.text.value).toBe("---\n---\n甲\r乙\r");
    });

    it("编辑动作 properties：没有 frontmatter 时建一段空的，面板展开、焦点在新属性的名字上；打名字回车写回", async () => {
        const {wrapper, handle, binding, propertiesOpen} = await opened("甲\r\n");
        expect(handle.editing?.run("properties")).toBe(true);
        const newName = () => wrapper.find<HTMLInputElement>(`[data-markdown-properties] input[aria-label="属性名"]`);
        await waitUntil("面板挂上并聚焦新属性名", () => newName().exists() && document.activeElement === newName().element);
        expect(propertiesOpen.isOpen(binding.address.value)).toBe(true);
        const name = panelInput(wrapper, "属性名");
        await name.setValue("视角");
        await name.trigger("keydown", {key: "Enter"});
        handle.flushPendingChange();
        expect(binding.text.value).toBe("---\r\n视角:\r\n---\r\n甲\r\n");
    });

    it("正文第一块开头按上方向键进面板；面板里按 Esc 回到正文", async () => {
        const {wrapper, editor} = await opened("---\na: 1\n---\n甲\n");
        editor.commands.focus("start");
        editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowUp", bubbles: true, cancelable: true}));
        const toggle = wrapper.get<HTMLButtonElement>("[data-markdown-properties] button[aria-expanded]");
        expect(document.activeElement).toBe(toggle.element);
        await toggle.trigger("keydown", {key: "Escape"});
        // Tiptap 的 `focus()` 在下一帧才把焦点给正文。
        await waitUntil("焦点回到正文", () => editor.view.hasFocus());
        expect(editor.state.selection.from).toBe(1);
    });
});

describe("写不出（editor 输出 61）", () => {
    /** 在第一块开头放一个会开启 HTML 块的原样片段：哪一级写法都读不回来。 */
    const breakFirst = (editor: Editor): void => {
        editor.commands.insertContentAt(1, {type: "rawInline", attrs: {raw: "<div>"}});
    };

    it("这次输入不交，文档记下写不出并能定位；改好之后交出成功即解除", async () => {
        const {editor, handle, binding, area, groupId} = await opened("甲\n\n乙\n");
        breakFirst(editor);
        handle.flushPendingChange();
        expect(binding.blocked()).toBe(true);
        expect(binding.text.value).toBe("甲\n\n乙\n");
        const blocked = area.documentOf(groupId)?.blocked.value.get(binding.token);
        expect(blocked?.fallback).toBe("\\<div>甲\n\n乙\n");
        // 组顶部的提示写明是哪一块：第几块与开头几个字。
        expect([blocked?.index, blocked?.excerpt]).toEqual([1, "甲"]);
        area.locate(groupId);
        const {from, to, empty} = editor.state.selection;
        expect(blocked !== undefined && !empty && from >= blocked.from && to <= blocked.to).toBe(true);
        editor.commands.deleteRange({from: 1, to: 2});
        editor.commands.insertContentAt(endOfBlock(editor, 0), "改");
        handle.flushPendingChange();
        expect(binding.blocked()).toBe(false);
        expect(binding.text.value).toBe("甲改\n\n乙\n");
    });

    it("写不出期间文档的正文被别处改了：这个视图不随之更新，保留自己的内容（editor 输出 61）", async () => {
        const {editor, handle, binding, memory} = await opened("甲\n\n乙\n");
        breakFirst(editor);
        editor.commands.insertContentAt(endOfBlock(editor, 1), "改");
        handle.flushPendingChange();
        expect(binding.blocked()).toBe(true);
        memory.externalWrite("project://a.md", "甲\n\n乙外\n");
        await waitUntil("文档换成磁盘内容", () => binding.text.value === "甲\n\n乙外\n");
        expect(editor.state.doc.textContent).toBe("甲乙改");
        expect(binding.blocked()).toBe(true);
    });

    it("采用当前正文：丢弃这个视图的输入，按文档的正文重载", async () => {
        const {editor, handle, binding, area, groupId} = await opened("甲\n\n乙\n");
        breakFirst(editor);
        editor.commands.insertContentAt(endOfBlock(editor, 1), "也改了");
        handle.flushPendingChange();
        expect(binding.blocked()).toBe(true);
        area.unblock(groupId);
        await waitUntil("重载", () => !editor.state.doc.textContent.includes("也改了"));
        expect(editor.state.doc.textContent).toBe("甲乙");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("甲\n\n乙\n");
    });
});

describe("引用小块与图片（方言 Spec 输出 18、27）", () => {
    it("指向作品里文件的链接是一个引用小块，被批注盖住一半时也是一个；文字照常可编辑，写回不变；外部链接仍是普通链接；悬停提示跟着窗口换语言", async () => {
        const source = "见[<comment body=\"意见\">林</comment>雪](设定/林雪.md)与[官网](https://example.com)。\n";
        const {editor, handle, binding, text} = await opened(source);
        const root = editor.view.dom;
        expect(root.querySelectorAll(".nb-chip-link__icon")).toHaveLength(1);
        expect(root.querySelectorAll(".nb-chip-link--end")).toHaveLength(1);
        expect([...root.querySelectorAll("[data-reference-link]")].map((element) => element.textContent).join("")).toBe("林雪");
        expect(root.querySelector(".nb-chip-link__icon svg[data-file-icon]")?.getAttribute("data-icon")).toBe("markdown");
        handle.flushPendingChange();
        expect(binding.text.value).toBe(source);
        // 在链接文字中间打字：仍是同一个链接、同一个小块。
        let inside = -1;
        editor.state.doc.descendants((node, pos) => {
            if (inside < 0 && node.isText && node.text === "雪") inside = pos + 1;
        });
        editor.commands.insertContentAt(inside, "儿");
        handle.flushPendingChange();
        // 重新写出时批注写在最外层（它的优先级最高），链接的原文可能拆成两个 `[…](…)`；读回仍是同一个链接，仍是一个小块。
        const linked = (doc: PMNode): string[] => {
            const runs: string[] = [];
            doc.descendants((node) => {
                const href = node.marks.find((mark) => mark.type.name === "link")?.attrs.href as string | undefined;
                if (node.isText && href !== undefined) runs.push(`${node.text ?? ""}→${href}`);
            });
            return runs;
        };
        expect(linked(codecFor(editor.schema, markdownLanguage()).read(binding.text.value).doc)).toEqual(linked(editor.state.doc));
        expect(root.querySelectorAll(".nb-chip-link__icon")).toHaveLength(1);
        const title = (): string | null | undefined => root.querySelector("[data-reference-link]")?.getAttribute("title");
        const chinese = title() ?? "";
        expect(chinese).toMatch(/^引用：/u);
        text.setLocale("en-US");
        await nextTick();
        expect(title()).toBe(chinese.replace(/^引用：/u, "Reference: "));
    });

    it("图片按所在文件的目录解析，经文件服务显示；作品根以外的不显示、写明原因（窗口换语言时跟着换）；不编辑写回不变", async () => {
        const source = "![封面](images/a.png) ![外面](../外面.png)\n";
        const {editor, handle, binding, text} = await opened(source);
        await waitUntil("图片显示", () => editor.view.dom.querySelector("img"));
        expect(editor.view.dom.querySelector("img")?.getAttribute("src")).toBe("/raw/project://images/a.png");
        const missing = (): string | undefined => editor.view.dom.querySelector("[data-markdown-image][data-state='none']")?.textContent?.trim();
        expect(missing()).toBe("外面（不在作品里，不显示）");
        text.setLocale("en-US");
        await nextTick();
        expect(missing()).toBe("外面 (not in the work, not shown)");
        handle.flushPendingChange();
        expect(binding.text.value).toBe(source);
    });
});

/** 批注卡片（workbench.markdown-editing 输出 28–35）：真实编辑器、真实菜单层，浮层传送到 body，用 data 属性找。 */
describe("批注卡片（workbench.markdown-editing 输出 28–35）", () => {
    const TWO = "甲<comment body=\"第一条\">乙丙</comment>丁戊<comment body=\"第二条\">己庚</comment>辛\n";
    // 关上的浮层要等退场动画结束才摘掉，按 `data-state` 判断开着的那一个。
    const card = (): HTMLElement | null => document.querySelector('[data-anchored-popover][data-state="open"] [data-markdown-comment-layer]');
    const cardText = (): string => card()?.textContent ?? "";
    const find = (editor: Editor, text: string): {from: number; to: number} => {
        let found: {from: number; to: number} | null = null;
        editor.state.doc.descendants((node, pos) => {
            const at = node.isText ? (node.text as string).indexOf(text) : -1;
            if (found === null && at >= 0) found = {from: pos + at, to: pos + at + text.length};
        });
        if (found === null) throw new Error(`找不到 ${text}`);
        return found;
    };
    /** 把光标放到这个位置（选区变化的事务，不改文档）。 */
    const moveTo = async (editor: Editor, pos: number): Promise<void> => {
        editor.commands.setTextSelection(pos);
        await nextTick();
    };
    const commentElement = (editor: Editor, text: string): HTMLElement => {
        const found = [...editor.view.dom.querySelectorAll<HTMLElement>("comment")].find((element) => element.textContent?.includes(text));
        if (found === undefined) throw new Error(`没有批注元素含 ${text}`);
        return found;
    };
    const moveOver = (target: Element, init: MouseEventInit = {}): void => {
        target.dispatchEvent(new MouseEvent("pointermove", {bubbles: true, clientX: 5, clientY: 5, ...init}));
    };
    /** 按住 Ctrl 把指针停在这段批注上，等卡片弹出来（输出 30）。 */
    const hover = async (editor: Editor, text: string): Promise<void> => {
        moveOver(commentElement(editor, text), {ctrlKey: true});
        await vi.waitFor(() => expect(card()).not.toBeNull(), {timeout: 3000});
    };
    /** 指针移到正文里没有批注的地方，等卡片收起（250 毫秒后）。 */
    const leave = async (editor: Editor): Promise<void> => {
        moveOver(editor.view.dom.querySelector("p") as Element);
        await vi.waitFor(() => expect(card()).toBeNull(), {timeout: 3000});
    };
    /** 键盘事件；happy-dom 把 `getModifierState("AltGraph")` 报成 Alt 是否按下，浏览器里 AltGr 才是真，这里按浏览器的写。 */
    const keyEvent = (init: KeyboardEventInit): KeyboardEvent => {
        const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
        Object.defineProperty(event, "getModifierState", {value: (key: string) => key !== "AltGraph" && (key === "Alt" ? event.altKey : key === "Control" ? event.ctrlKey : key === "Meta" ? event.metaKey : key === "Shift" ? event.shiftKey : false)});
        return event;
    };
    const pressKey = (editor: Editor, init: KeyboardEventInit): void => {
        editor.view.dom.dispatchEvent(keyEvent(init));
    };
    const click = async (label: string): Promise<void> => {
        const target = card()?.querySelector<HTMLElement>(`[aria-label="${label}"]`);
        if (target === null || target === undefined) throw new Error(`卡片上没有 ${label}`);
        target.click();
        await nextTick();
    };
    const bodies = (editor: Editor): string[] => listComments(editor.state.doc).map((info) => info.body);

    it("按住 Ctrl 把鼠标停在批注上出卡片，写着意见与“第 i 条，共 n 条”；移开就收起；不按 Ctrl 的悬停与光标走进批注不弹", async () => {
        const {editor} = await opened(TWO, undefined, undefined, {menus: true});
        editor.view.focus();
        await moveTo(editor, find(editor, "乙丙").from + 1);
        expect(card()).toBeNull();
        moveOver(commentElement(editor, "己庚"));
        await nextTick();
        expect(card()).toBeNull();
        await hover(editor, "乙丙");
        expect(cardText()).toContain("第一条");
        expect(cardText()).toContain("第 1 条，共 2 条");
        await leave(editor);
        await hover(editor, "己庚");
        expect(cardText()).toContain("第二条");
        expect(cardText()).toContain("第 2 条，共 2 条");
    });

    it("Esc 与输入收起卡片，同一次悬停不再弹；移出再移进才出", async () => {
        const {editor} = await opened(TWO, undefined, undefined, {menus: true});
        editor.view.focus();
        const target = commentElement(editor, "乙丙");
        await hover(editor, "乙丙");
        document.dispatchEvent(keyEvent({key: "Escape"}));
        await nextTick();
        expect(card()).toBeNull();
        moveOver(target, {ctrlKey: true});
        await moveTo(editor, find(editor, "乙丙").from + 1);
        expect(card()).toBeNull();
        moveOver(editor.view.dom.querySelector("p") as Element);
        await hover(editor, "乙丙");
        editor.commands.insertContentAt(find(editor, "乙丙").from, "字");
        await nextTick();
        expect(card()).toBeNull();
    });

    it("下一条、上一条：光标跳到那条的开头，卡片换成它，到头置灰", async () => {
        const {editor} = await opened(TWO, undefined, undefined, {menus: true});
        editor.view.focus();
        await hover(editor, "乙丙");
        await click("下一条批注");
        expect(editor.state.selection.from).toBe(find(editor, "己庚").from);
        expect(cardText()).toContain("第二条");
        expect(card()?.querySelector('[aria-label="下一条批注"]')?.hasAttribute("disabled")).toBe(true);
        await click("上一条批注");
        expect(editor.state.selection.from).toBe(find(editor, "乙丙").from);
        expect(cardText()).toContain("第一条");
    });

    it("紧挨的两条：光标没动，点“下一条”当前批注也换到后一条（正文里标出的是后一条）", async () => {
        const {editor} = await opened("<comment body=\"前\">甲乙</comment><comment body=\"后\">丙丁</comment>\n", undefined, undefined, {menus: true});
        editor.view.focus();
        const seam = find(editor, "丙丁").from;
        await hover(editor, "丙丁");
        expect(cardText()).toContain("前");
        expect(cardText()).toContain("后");
        await click("下一条批注");
        expect(editor.state.selection.from).toBe(seam);
        await nextTick();
        await nextTick();
        expect(editor.view.dom.querySelector(".nb-comment-current")?.textContent).toBe("丙丁");
    });

    it("改意见：点编辑、改、Ctrl+Enter，文档里意见变了，回到看；空意见是取消，卡片收起", async () => {
        const {editor} = await opened(TWO, undefined, undefined, {menus: true});
        editor.view.focus();
        await hover(editor, "乙丙");
        await click("编辑批注");
        const field = card()?.querySelector("textarea") as HTMLTextAreaElement;
        expect(field.value).toBe("第一条");
        field.value = "  ";
        field.dispatchEvent(new Event("input", {bubbles: true}));
        field.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
        await nextTick();
        expect(bodies(editor)).toEqual(["第一条", "第二条"]);
        await vi.waitFor(() => expect(card()).toBeNull());
        moveOver(editor.view.dom.querySelector("p") as Element);
        await hover(editor, "乙丙");
        await click("编辑批注");
        const again = card()?.querySelector("textarea") as HTMLTextAreaElement;
        again.value = "改后的\n两行";
        again.dispatchEvent(new Event("input", {bubbles: true}));
        again.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
        await nextTick();
        expect(bodies(editor)).toEqual(["改后的\n两行", "第二条"]);
        await vi.waitFor(() => expect(cardText()).toContain("改后的"));
        expect(card()?.querySelector("textarea")).toBeNull();
    });

    it("删除：这一条的标记去掉、字留着，卡片收起；Ctrl+Z 回来", async () => {
        const {editor} = await opened(TWO, undefined, undefined, {menus: true});
        editor.view.focus();
        await hover(editor, "乙丙");
        await click("删除批注");
        expect(bodies(editor)).toEqual(["第二条"]);
        expect(editor.state.doc.textContent).toBe("甲乙丙丁戊己庚辛");
        await nextTick();
        expect(card()).toBeNull();
        editor.commands.undo();
        expect(bodies(editor)).toHaveLength(2);
    });

    it("Ctrl+Alt+M：选区在字上开新批注的“写”，原选区仍画成选中，保存加上批注；光标在批注里改这条的意见", async () => {
        const {editor} = await opened("甲乙丙\n\n丁<comment body=\"旧\">戊己</comment>\n", undefined, undefined, {menus: true});
        editor.view.focus();
        editor.commands.setTextSelection(find(editor, "乙"));
        await nextTick();
        pressKey(editor, {code: "KeyM", key: "m", ctrlKey: true, altKey: true});
        await nextTick();
        const field = card()?.querySelector("textarea") as HTMLTextAreaElement;
        expect(field.value).toBe("");
        expect(editor.view.dom.querySelector(".nb-markdown-held-selection")?.textContent).toBe("乙");
        field.value = "新意见";
        field.dispatchEvent(new Event("input", {bubbles: true}));
        field.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
        await nextTick();
        await nextTick();
        expect(bodies(editor)).toEqual(["新意见", "旧"]);
        expect(editor.view.dom.querySelector(".nb-markdown-held-selection")).toBeNull();

        await moveTo(editor, find(editor, "戊己").from + 1);
        pressKey(editor, {code: "KeyM", key: "m", ctrlKey: true, altKey: true});
        await nextTick();
        expect((card()?.querySelector("textarea") as HTMLTextAreaElement).value).toBe("旧");
    });

    it("选区在代码块里或光标不在批注里时 Ctrl+Alt+M 不开卡片、不拦截按键", async () => {
        const {editor} = await opened("甲乙\n\n```\ncode\n```\n", undefined, undefined, {menus: true});
        editor.view.focus();
        editor.commands.setTextSelection(find(editor, "code"));
        const event = keyEvent({code: "KeyM", key: "m", ctrlKey: true, altKey: true});
        editor.view.dom.dispatchEvent(event);
        await nextTick();
        expect(card()).toBeNull();
        expect(event.defaultPrevented).toBe(false);
        await moveTo(editor, 1);
        const plain = keyEvent({code: "KeyM", key: "m", ctrlKey: true, altKey: true});
        editor.view.dom.dispatchEvent(plain);
        expect(card()).toBeNull();
        expect(plain.defaultPrevented).toBe(false);
    });

    it("“写”着改已有批注时正文被程序换掉、这条批注的意见变了：卡片收起，不改别的批注", async () => {
        const {editor} = await opened(TWO, undefined, undefined, {menus: true});
        editor.view.focus();
        await hover(editor, "乙丙");
        await click("编辑批注");
        expect(card()?.querySelector("textarea")).not.toBeNull();
        const codec = codecFor(editor.schema, markdownLanguage());
        editor.commands.setContent(codec.read("甲<comment body=\"别的批注\">乙丙</comment>丁\n").doc.toJSON());
        await nextTick();
        await nextTick();
        expect(card()?.querySelector("textarea") ?? null).toBeNull();
        expect(bodies(editor)).toEqual(["别的批注"]);
    });

    it("“写”着改已有批注时正文被程序改了、前面多出一条批注（序号变了）：按唯一的指纹找到原来那条，保存改的还是它，别的不动（验收 17）", async () => {
        const {editor} = await opened(TWO, undefined, undefined, {menus: true});
        editor.view.focus();
        await hover(editor, "乙丙");
        await click("编辑批注");
        const codec = codecFor(editor.schema, markdownLanguage());
        editor.commands.setContent(codec.read(`新<comment body="前面新增的">增</comment>${TWO}`).doc.toJSON());
        await nextTick();
        await nextTick();
        const field = card()?.querySelector("textarea") as HTMLTextAreaElement;
        expect(field).not.toBeNull();
        field.value = "改好的第一条";
        field.dispatchEvent(new Event("input", {bubbles: true}));
        field.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
        await nextTick();
        expect(bodies(editor)).toEqual(["前面新增的", "改好的第一条", "第二条"]);
    });

    it("换文档（控件不可见）时卡片与没保存的字都收起", async () => {
        const {editor, wrapper} = await opened(TWO, undefined, undefined, {menus: true});
        editor.view.focus();
        await hover(editor, "乙丙");
        await click("编辑批注");
        await wrapper.setProps({visible: false});
        await nextTick();
        expect(card()).toBeNull();
    });
});

/** 批注页边（workbench.markdown-editing 输出 33）：宽度来自 ResizeObserver，happy-dom 没有排版，用可控的假观察者喂宽度。 */
describe("批注页边（workbench.markdown-editing 输出 33）", () => {
    /** 页边按段排槽位：两条批注在两段里，各一个槽位。 */
    const TWO = "甲<comment body=\"第一条\">乙丙</comment>丁\n\n戊<comment body=\"第二条\">己庚</comment>辛\n";
    type Observer = {readonly callback: ResizeObserverCallback; readonly targets: Element[]};
    const observers: Observer[] = [];
    const original = globalThis.ResizeObserver;
    beforeEach(() => {
        observers.length = 0;
        globalThis.ResizeObserver = class {
            private readonly entry: Observer;
            constructor(callback: ResizeObserverCallback) {
                this.entry = {callback, targets: []};
                observers.push(this.entry);
            }
            observe(target: Element): void {
                this.entry.targets.push(target);
            }
            unobserve(): void {}
            disconnect(): void {
                this.entry.targets.length = 0;
            }
        } as unknown as typeof ResizeObserver;
    });
    afterEach(() => {
        globalThis.ResizeObserver = original;
    });
    /** 控件根（`.markdown-control-root`）的宽度变了。 */
    const resize = async (width: number): Promise<void> => {
        for (const observer of observers) {
            if (observer.targets.some((target) => target.classList.contains("markdown-control-root"))) observer.callback([{contentRect: {width}} as ResizeObserverEntry], {} as ResizeObserver);
        }
        await nextTick();
        await nextTick();
    };
    const margin = (): HTMLElement | null => document.querySelector("[data-markdown-comment-margin]");
    const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-markdown-comment-margin] [data-mode]")].filter((element) => element.classList.contains("markdown-comment-margin__item"));
    const popover = (): HTMLElement | null => document.querySelector('[data-anchored-popover][data-state="open"] [data-markdown-comment-layer]');
    const find = (editor: Editor, text: string): {from: number; to: number} => {
        let found: {from: number; to: number} | null = null;
        editor.state.doc.descendants((node, pos) => {
            const at = node.isText ? (node.text as string).indexOf(text) : -1;
            if (found === null && at >= 0) found = {from: pos + at, to: pos + at + text.length};
        });
        if (found === null) throw new Error(`找不到 ${text}`);
        return found;
    };
    const keyEvent = (init: KeyboardEventInit): KeyboardEvent => {
        const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
        Object.defineProperty(event, "getModifierState", {value: (key: string) => key !== "AltGraph" && (key === "Alt" ? event.altKey : key === "Control" ? event.ctrlKey : false)});
        return event;
    };
    const commentElement = (editor: Editor, text: string): HTMLElement => {
        const found = [...editor.view.dom.querySelectorAll<HTMLElement>("comment")].find((element) => element.textContent?.includes(text));
        if (found === undefined) throw new Error(`没有批注元素含 ${text}`);
        return found;
    };
    const moveOver = (target: Element, init: MouseEventInit = {}): void => {
        target.dispatchEvent(new MouseEvent("pointermove", {bubbles: true, clientX: 5, clientY: 5, ...init}));
    };

    it("开关开着、控件够宽才画：稿纸让位、每段一个槽位，光标所在的是当前批注、其余不是，浮层不出", async () => {
        const {editor, wrapper} = await opened(TWO, undefined, undefined, {menus: true, margin: true});
        await resize(1100);
        expect(margin()).not.toBeNull();
        expect(wrapper.get(".markdown-control-root").attributes("data-comment-margin")).toBeDefined();
        expect((wrapper.get("[data-editor-control]").element as HTMLElement).style.paddingInlineEnd).toBe("280px");
        expect(items().map((item) => item.dataset.mode)).toEqual(["idle", "idle"]);
        editor.view.focus();
        editor.commands.setTextSelection(find(editor, "己庚").from + 1);
        await nextTick();
        await nextTick();
        expect(items().map((item) => item.dataset.mode)).toEqual(["idle", "current"]);
        expect(items()[1]?.textContent).toContain("第二条");
        // 页边里没有“第 i 条，共 n 条”（页边本身就是总览）。
        expect(items()[1]?.textContent).not.toContain("共 2 条");
        expect(popover()).toBeNull();
        expect(editor.view.dom.querySelector(".nb-comment-current")?.textContent).toBe("己庚");
    });

    it("宽度的迟滞：1032 起画、窄于 1000 才收起，之间不闪；收起后退回浮层，开关不变", async () => {
        const {editor} = await opened(TWO, undefined, undefined, {menus: true, margin: true});
        await resize(1020);
        expect(margin()).toBeNull();
        await resize(1040);
        expect(margin()).not.toBeNull();
        await resize(1010);
        expect(margin()).not.toBeNull();
        await resize(990);
        expect(margin()).toBeNull();
        editor.view.focus();
        moveOver(commentElement(editor, "乙丙"), {ctrlKey: true});
        await vi.waitFor(() => expect(popover()?.textContent).toContain("第一条"), {timeout: 3000});
    });

    it("点卡片：光标移到那条批注、它成为当前；开关关着时没有页边", async () => {
        const {editor} = await opened(TWO, undefined, undefined, {menus: true, margin: true});
        await resize(1100);
        (items()[1]?.querySelector("[data-markdown-comment-card]") as HTMLElement).click();
        await nextTick();
        await nextTick();
        expect(editor.state.selection.from).toBe(find(editor, "己庚").from);
        expect(items().map((item) => item.dataset.mode)).toEqual(["idle", "current"]);
        const off = await opened(TWO, undefined, undefined, {menus: true});
        await resize(1100);
        expect(off.wrapper.find("[data-markdown-comment-margin]").exists()).toBe(false);
        expect(off.wrapper.get(".markdown-control-root").attributes("data-comment-margin")).toBeUndefined();
    });

    it("加批注的“写”卡片在页边里：是一个待写的槽位，保存后成为一条并进这一段的槽位", async () => {
        const {editor} = await opened(TWO, undefined, undefined, {menus: true, margin: true});
        await resize(1100);
        editor.view.focus();
        editor.commands.setTextSelection(find(editor, "丁"));
        await nextTick();
        editor.view.dom.dispatchEvent(keyEvent({code: "KeyM", key: "m", ctrlKey: true, altKey: true}));
        await nextTick();
        await nextTick();
        expect(items().map((item) => item.dataset.mode)).toEqual(["idle", "idle", "write"]);
        expect(popover()).toBeNull();
        const field = items()[2]?.querySelector("textarea") as HTMLTextAreaElement;
        field.value = "新的";
        field.dispatchEvent(new Event("input", {bubbles: true}));
        field.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
        await nextTick();
        await nextTick();
        await nextTick();
        expect(listComments(editor.state.doc).map((info) => info.body)).toEqual(["第一条", "新的", "第二条"]);
        // 新批注与第一条在同一段：两个槽位，第一段的有 `1/2`。
        expect(items()).toHaveLength(2);
        expect(items()[0]?.querySelector("[data-markdown-comment-pager]")?.textContent).toBe("1/2");
    });

    it("控件交出批注条数（编辑区标题的“批注 N”读它），随增删当场变；没有菜单层时不交出", async () => {
        const {editor, handle} = await opened(TWO, undefined, undefined, {menus: true});
        expect(handle.comments?.count.value).toBe(2);
        editor.commands.setTextSelection(find(editor, "辛"));
        editor.commands.addComment("第三条");
        expect(handle.comments?.count.value).toBe(3);
        const plain = await opened(TWO);
        expect(plain.handle.comments).toBeUndefined();
    });
});

describe("链接与图片的宿主（markdown-editing.md 输出 53、55、58）", () => {
    const png = (name = "image.png", type = "image/png"): File => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], name, {type});
    /** 走 ProseMirror 的粘贴入口：只有一张图、没有文字。 */
    const pasteImage = (editor: Editor, file: File): boolean => {
        const event = {clipboardData: {files: [file], getData: () => ""}, preventDefault: () => undefined} as unknown as ClipboardEvent;
        return editor.view.someProp("handlePaste", (handle) => handle(editor.view, event, Slice.empty)) === true;
    };
    /** 真实的 `createMarkdownMedia`，只有文件服务的 `upload` 记下收到的地址。 */
    function mediaOf(options: {readonly bound?: boolean; readonly location?: "folder" | "root" | "same" | "sibling"} = {}) {
        const uploads: string[] = [];
        const media = createMarkdownMedia({
            files: {
                list: () => Promise.resolve({ok: true, value: {folder: "plain", contentRoot: null, entries: []}}),
                upload: (address) => {
                    uploads.push(address);
                    return Promise.resolve({ok: true, address, renamed: false});
                },
                rawUrl: () => null,
            },
            find: null,
            bound: options.bound ?? true,
            settings: {location: () => options.location ?? "folder", folder: () => "插图"},
            now: () => new Date(2026, 10, 17, 14, 5, 33),
        });
        return {media, uploads};
    }
    /** 编辑器区的通知与命令：记下，不真的执行。 */
    function recorded() {
        const notices: Array<{key: string; params?: unknown}> = [];
        const executed: Array<{command: string; args?: unknown}> = [];
        const wrapMenus = (menus: EditorMenus): EditorMenus => ({
            ...menus,
            notify: (key, params) => notices.push({key, ...(params === undefined ? {} : {params})}),
            execute: (command, args) => executed.push({command, ...(args === undefined ? {} : {args})}),
        });
        return {notices, executed, wrapMenus};
    }

    it("粘贴一张图：按设置存进作品，成功的插进光标处，正文里是相对当前文件的地址", async () => {
        const {media, uploads} = mediaOf();
        const {editor, binding, handle} = await opened("甲乙\n", undefined, undefined, {menus: true, media});
        editor.commands.setTextSelection(endOfBlock(editor, 0));
        expect(pasteImage(editor, png())).toBe(true);
        await waitUntil("图片插进了正文", () => (editor.state.doc.textContent === "甲乙" && editor.view.dom.querySelector("img, .nb-markdown-image") !== null ? true : null));
        expect(uploads).toEqual(["project://插图/粘贴的图片 20261117-140533.png"]);
        handle.flushPendingChange();
        expect(binding.text.value).toContain("插图/粘贴的图片 20261117-140533.png");
    });

    it("控件卸载后在同一个标签的实例槽里重挂：粘贴仍按当前文件存放（宿主读当前挂载，不读第一次挂载的）", async () => {
        const {media, uploads} = mediaOf({location: "sibling"});
        const first = await opened("甲乙\n", undefined, undefined, {menus: true, media});
        first.wrapper.unmount();
        const again = await opened("甲乙\n", {area: first.area, memory: first.memory}, undefined, {menus: true, media});
        // 同一个槽里的同一个编辑器实例：撤销历史等都留着，换的只是挂载。
        expect(again.editor).toBe(first.editor);
        again.editor.commands.setTextSelection(endOfBlock(again.editor, 0));
        expect(pasteImage(again.editor, png())).toBe(true);
        await waitUntil("上传发出了", () => (uploads.length > 0 ? true : null));
        expect(uploads).toEqual(["project://插图/粘贴的图片 20261117-140533.png"]);
    });

    it("宿主提供了、但没有绑定作品：粘贴被接手，不上传，给一条通知；宿主没有提供（Lab）：照原来的粘贴", async () => {
        const unbound = recorded();
        const {media, uploads} = mediaOf({bound: false});
        const first = await opened("甲乙\n", undefined, undefined, {menus: true, media, wrapMenus: unbound.wrapMenus});
        first.editor.commands.setTextSelection(endOfBlock(first.editor, 0));
        expect(pasteImage(first.editor, png())).toBe(true);
        await waitUntil("给了通知", () => (unbound.notices.length > 0 ? true : null));
        expect(unbound.notices).toEqual([{key: "imageUnavailable"}]);
        expect(uploads).toEqual([]);
        const lab = await opened("甲乙\n", undefined, undefined, {menus: true});
        lab.editor.commands.setTextSelection(endOfBlock(lab.editor, 0));
        expect(pasteImage(lab.editor, png())).toBe(false);
    });

    it("按住 Ctrl 点链接：作品里的文件交编辑器区打开，外部网址新标签页，`javascript:` 与文件内的片段不处理；单击与没有编辑器区时不接手", async () => {
        const {notices, executed, wrapMenus} = recorded();
        const {editor} = await opened("[设定](设定/林雪.md)与[官网](https://example.com)与[脚本](javascript:alert(1))与[本页](#标题)\n", undefined, undefined, {menus: true, wrapMenus});
        const anchor = (label: string): HTMLAnchorElement => {
            const found = [...editor.view.dom.querySelectorAll("a")].find((element) => element.textContent === label);
            if (found === undefined) throw new Error(`没有链接 ${label}`);
            return found;
        };
        const click = (label: string, init: MouseEventInit): boolean => {
            const target = anchor(label);
            const event = new MouseEvent("click", {bubbles: true, cancelable: true, button: 0, ...init});
            Object.defineProperty(event, "target", {value: target});
            const pos = editor.view.posAtDOM(target, 0) + 1;
            editor.commands.setTextSelection(pos);
            return editor.view.someProp("handleClick", (handle) => handle(editor.view, pos, event)) === true;
        };
        // happy-dom 的临时 `<a>` 点击不会开标签页：记下点的是什么（真实浏览器按 `target="_blank"` 开新标签页，e2e 里看）。
        const clicked: Array<{href: string; target: string; rel: string}> = [];
        const originalClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function recordClick(this: HTMLAnchorElement): void {
            clicked.push({href: this.href, target: this.target, rel: this.rel});
        };
        cleanups.push(() => {
            HTMLAnchorElement.prototype.click = originalClick;
        });
        expect(click("设定", {ctrlKey: true})).toBe(true);
        expect(executed).toEqual([{command: "nbook.editor.open", args: {address: "project://设定/林雪.md", mode: "permanent"}}]);
        // 外部网址：临时的 `<a target="_blank">` 点一下（浏览器按它开新标签页），不经编辑器区。
        expect(click("官网", {ctrlKey: true})).toBe(true);
        expect(clicked).toEqual([{href: "https://example.com/", target: "_blank", rel: "noopener noreferrer"}]);
        expect(executed).toHaveLength(1);
        clicked.length = 0;
        // 不按 Ctrl 的单击：选中整条链接，不打开。
        executed.length = 0;
        click("设定", {});
        expect(executed).toEqual([]);
        for (const label of ["脚本", "本页"]) click(label, {metaKey: true});
        expect(executed).toEqual([]);
        expect(clicked).toEqual([]);
        expect(notices).toEqual([]);
    });
});

describe("表情的大图预览（docs/specs/agent/stickers.md 输出 46）", () => {
    it("单击正文里表情的图打开预览：标题“名字 · 包名”、复制写法、图的地址（光标落在点击处在 e2e 里看）", async () => {
        const stickers: StickerResolver = async (ref) => (ref.name === "开心" ? {url: "/img/开心.webp", width: 128, height: 128, pack: "user.lyra", packTitle: "星璃", release: () => undefined} : null);
        const {editor} = await opened("前:lyra/开心:后\n", undefined, undefined, {stickers});
        const image = await waitUntil("换成图", () => editor.view.dom.querySelector<HTMLImageElement>(".nb-sticker img"));
        image.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, button: 0, detail: 1}));
        const dialog = await waitUntil("预览打开", () => document.body.querySelector<HTMLElement>("[role=dialog]"));
        expect(dialog.textContent).toContain("开心 · 星璃");
        expect(dialog.querySelector("img")?.getAttribute("src")).toBe("/img/开心.webp");
        expect(dialog.querySelector("[data-image-preview-copy] button")?.getAttribute("aria-label")).toBe("复制写法");
    });
});
