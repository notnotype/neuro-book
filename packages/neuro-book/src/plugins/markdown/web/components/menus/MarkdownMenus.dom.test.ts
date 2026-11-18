/**
 * 菜单层里的链接卡片与插图卡片（docs/specs/workbench/markdown-editing.md 输出 52、54、57、58）：真实的 Tiptap 编辑器与真实的动作实现、
 * 真实的 `createMarkdownMedia`；文件服务只有 `list`、`upload` 与 `rawUrl`（记下收到的入参）。浮层位置要真实布局，在 e2e 里看。
 */
import {codecFor, defaultMarkdownLanguage} from "@notnotype/nb-markdown/language";
import {createMarkdownEditorExtensions, markdownEditingActions} from "@notnotype/nb-markdown/editor";
import {schemeTargets} from "@notnotype/nb-markdown";
import {Editor} from "@tiptap/core";
import {EditorState} from "@tiptap/pm/state";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {markRaw, nextTick, ref} from "vue";

import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";
import {keyEventMatches} from "nbook/plugins/editor/web/key-event";
import type {FilesResult, FindResult, Listing} from "nbook/plugins/files/shared/contracts";
import type {UploadResult} from "nbook/plugins/files/shared/upload";
import type {BrowserStickerPack, StickerPicker} from "nbook/plugins/stickers/shared/contracts";
import {createStickerPicker} from "nbook/plugins/stickers/web/picker-service";
import {memoryRecent} from "nbook/plugins/stickers/web/recent";
import {createStickerDirectory} from "nbook/plugins/stickers/web/resolver";

import {createMarkdownMedia} from "../../media";
import type {MarkdownMedia} from "../../media";
import {markdownStickerPickerKey} from "../../parts/stickers";
import MarkdownMenus from "./MarkdownMenus.vue";

const language = defaultMarkdownLanguage();
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    document.body.innerHTML = "";
});

const BASE = "project://卷一/第一章.md";
const png = (name = "a.png", type = "image/png"): File => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], name, {type});

function find(editor: Editor, text: string): {from: number; to: number} {
    let found: {from: number; to: number} | null = null;
    editor.state.doc.descendants((node, pos) => {
        const at = node.isText ? (node.text as string).indexOf(text) : -1;
        if (found === null && at >= 0) found = {from: pos + at, to: pos + at + text.length};
    });
    if (found === null) throw new Error(`找不到 ${text}`);
    return found;
}

interface MediaScene {
    readonly entries?: readonly string[];
    readonly found?: ReadonlyArray<{path: string; name: string}>;
    readonly bound?: boolean;
    readonly uploadReply?: (address: string) => UploadResult;
    /** 换掉按名字找图：测迟到的结果。 */
    readonly find?: (query: string, signal: AbortSignal | undefined) => Promise<{readonly ok: true; readonly value: FindResult} | {readonly ok: false; readonly detail: string}>;
}

/** 存放目录里有 `entries`（文件名），按名字找得到 `found`；`upload` 记下地址。 */
function mediaOf(scene: MediaScene = {}) {
    const uploads: Array<{address: string; name: string; options: unknown}> = [];
    const searches: string[] = [];
    const media = createMarkdownMedia({
        files: {
            list: () => Promise.resolve<FilesResult<Listing>>({ok: true, value: {folder: "plain", contentRoot: null, entries: (scene.entries ?? []).map((name) => ({name, kind: "file" as const}))}}),
            upload: (address, body, options) => {
                uploads.push({address, name: body instanceof File ? body.name : "", options});
                return Promise.resolve(scene.uploadReply?.(address) ?? {ok: true, address, renamed: false});
            },
            rawUrl: (address) => `/raw/${address.slice("project://".length)}`,
        },
        find: (input, options) => {
            searches.push(input.query);
            return scene.find?.(input.query, options.signal) ?? Promise.resolve({ok: true, value: {items: [...(scene.found ?? [])], truncated: false}});
        },
        bound: scene.bound ?? true,
        settings: {location: () => "folder", folder: () => "插图"},
        now: () => new Date(2026, 10, 17, 14, 5, 33),
    });
    return {media, uploads, searches};
}

function harness(markdown: string, options: {readonly readonly?: boolean; readonly media?: MarkdownMedia | null; readonly picker?: StickerPicker} = {}) {
    const scroller = document.createElement("div");
    const element = document.createElement("div");
    scroller.append(element);
    document.body.append(scroller);
    const editor = new Editor({element, extensions: createMarkdownEditorExtensions({language, placeholder: "", host: {base: () => BASE, assets: null, chips: {targets: schemeTargets, fileIcon: () => null as never}}, commentMarkerLabel: null})});
    editor.view.updateState(EditorState.create({doc: codecFor(editor.schema, language).read(markdown).doc, plugins: editor.state.plugins}));
    const readonly = options.readonly ?? false;
    const ran: Array<{action: string; args: unknown}> = [];
    const notices: Array<{key: string; params?: unknown}> = [];
    // 与控件一样：选区或文档变了版本号加一，`active`、`enabled` 依赖它，菜单才会跟着重画。
    const version = ref(0);
    editor.on("transaction", () => {
        version.value += 1;
    });
    const editing: EditorEditing = {
        run: (action, args = {}) => {
            const implementation = markdownEditingActions[action];
            return !readonly && implementation !== undefined && implementation.enabled(editor, args) && implementation.run(editor, args);
        },
        active: (action) => {
            void version.value;
            return markdownEditingActions[action]?.active?.(editor) === true;
        },
        enabled: (action, args = {}) => {
            void version.value;
            return !readonly && markdownEditingActions[action]?.enabled(editor, args) === true;
        },
        hasSelection: ref(false),
    };
    const menus = {
        label: (key: string, params?: Readonly<Record<string, string | number>>) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`),
        title: (action: string) => action,
        matches: (action: string, event: KeyboardEvent) => action === "link" && keyEventMatches("Mod+K", "other", event),
        run: (action: string, args?: Record<string, unknown>) => {
            ran.push({action, args});
            editing.run(action, args);
        },
        notify: (key: string, params?: unknown) => notices.push({key, params}),
        shortcut: () => null,
        has: () => false,
        execute: () => undefined,
        keyLabel: (keybinding: string) => keybinding,
        contributed: () => [],
        runContributed: () => undefined,
        toolbarVisible: ref(true),
        toolbarPlacement: ref("full"),
        commentMargin: ref(false),
        reportError: () => undefined,
    } as unknown as EditorMenus;
    const media = options.media === undefined ? null : options.media;
    const wrapper = mount(MarkdownMenus, {
        props: {editor: markRaw(editor), scroller, editing, menus, readonly, binding: "a", marginDrawn: false, base: () => BASE, media},
        attachTo: document.body,
        ...(options.picker === undefined ? {} : {global: {provide: {[markdownStickerPickerKey as symbol]: options.picker}}}),
    });
    cleanups.push(() => {
        wrapper.unmount();
        editor.destroy();
        scroller.remove();
    });
    editor.view.focus();
    return {editor, wrapper, scroller, ran, notices};
}

const keyDown = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
    Object.defineProperty(event, "getModifierState", {value: () => false});
    target.dispatchEvent(event);
    return event;
};
const ctrlK = (editor: Editor): KeyboardEvent => keyDown(editor.view.dom, {code: "KeyK", key: "k", ctrlKey: true});
const prompt = (): HTMLElement | null => document.querySelector<HTMLElement>("[data-markdown-text-prompt]");
const promptInput = (): HTMLInputElement => {
    const found = prompt()?.querySelector("input");
    if (found === null || found === undefined) throw new Error("卡片没有输入框");
    return found;
};
const typeInto = async (input: HTMLInputElement, text: string): Promise<void> => {
    input.value = text;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await nextTick();
};
const enter = (input: HTMLElement): void => void keyDown(input, {key: "Enter"});
const links = (editor: Editor): Array<{text: string; href: string}> => {
    const found: Array<{text: string; href: string}> = [];
    editor.state.doc.descendants((node) => {
        const mark = node.marks.find((candidate) => candidate.type.name === "link");
        if (mark !== undefined && node.isText) found.push({text: node.text ?? "", href: String(mark.attrs.href)});
    });
    return found;
};
const held = (): string[] => [...document.querySelectorAll(".nb-markdown-held-selection")].map((element) => element.textContent ?? "");
const caret = (): number => document.querySelectorAll(".nb-markdown-held-caret").length;

describe("链接卡片（输出 52、57）", () => {
    it("选着字时 Ctrl+K：卡片开着时选区画成选中，填作品地址回车，选中的字成为链接、地址写成相对当前文件的写法，卡片收起、高亮撤掉", async () => {
        const {editor, ran} = harness("见林雪的设定\n");
        editor.commands.setTextSelection(find(editor, "林雪"));
        const event = ctrlK(editor);
        await flushPromises();
        expect(event.defaultPrevented).toBe(true);
        expect(prompt()).not.toBeNull();
        expect(prompt()?.classList.contains("markdown-text-prompt--wide")).toBe(true);
        expect(promptInput().value).toBe("");
        expect(held()).toEqual(["林雪"]);
        await typeInto(promptInput(), "project://设定/林雪.md");
        enter(promptInput());
        await flushPromises();
        expect(links(editor)).toEqual([{text: "林雪", href: "../设定/林雪.md"}]);
        expect(ran).toEqual([{action: "link", args: {href: "../设定/林雪.md", label: "林雪"}}]);
        expect(held()).toEqual([]);
        expect(document.querySelector("[data-markdown-text-prompt][data-state='open']")).toBeNull();
    });

    it("没有选区时：光标处画一条竖线；回车插入一段链接，文字取文件名（去掉扩展名），外部网址取网址本身", async () => {
        const {editor} = harness("甲乙\n");
        editor.commands.setTextSelection(2);
        ctrlK(editor);
        await flushPromises();
        expect(caret()).toBe(1);
        await typeInto(promptInput(), "../设定/林雪.md");
        enter(promptInput());
        await flushPromises();
        expect(caret()).toBe(0);
        expect(links(editor)).toEqual([{text: "林雪", href: "../设定/林雪.md"}]);
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        ctrlK(editor);
        await flushPromises();
        await typeInto(promptInput(), "https://example.com/a");
        enter(promptInput());
        await flushPromises();
        expect(links(editor)).toEqual([{text: "林雪", href: "../设定/林雪.md"}, {text: "https://example.com/a", href: "https://example.com/a"}]);
    });

    it("光标在链接里：预填地址，选区只盖住一部分也改整条，不把链接切开；点“去掉链接”文字留着", async () => {
        const {editor, ran} = harness("见[林雪的设定](旧.md)吧\n");
        editor.commands.setTextSelection(find(editor, "雪的"));
        ctrlK(editor);
        await flushPromises();
        expect(promptInput().value).toBe("旧.md");
        await typeInto(promptInput(), "新.md");
        enter(promptInput());
        await flushPromises();
        expect(links(editor)).toEqual([{text: "林雪的设定", href: "新.md"}]);
        editor.commands.setTextSelection(find(editor, "雪").from + 1);
        ctrlK(editor);
        await flushPromises();
        const remove = prompt()?.querySelector<HTMLButtonElement>("button[aria-label='link-remove']");
        expect(remove).not.toBeNull();
        expect(remove?.querySelector(".i-lucide-unlink")).not.toBeNull();
        remove?.click();
        await flushPromises();
        expect(links(editor)).toEqual([]);
        expect(editor.state.doc.textContent).toBe("见林雪的设定吧");
        expect(ran.at(-1)).toEqual({action: "link-remove", args: undefined});
    });

    it("碰到的几条链接地址不同：不预填、输入框与确认不能用，只能去掉链接", async () => {
        const {editor} = harness("[甲](a.md)与[乙](b.md)\n");
        editor.commands.setTextSelection({from: 1, to: editor.state.doc.content.size - 1});
        ctrlK(editor);
        await flushPromises();
        expect(promptInput().value).toBe("");
        expect(promptInput().disabled).toBe(true);
        expect(prompt()?.querySelector<HTMLButtonElement>("button[aria-label='promptConfirm']")?.disabled).toBe(true);
        prompt()?.querySelector<HTMLButtonElement>("button[aria-label='link-remove']")?.click();
        await flushPromises();
        expect(links(editor)).toEqual([]);
    });

    it("javascript: 这类地址不能确认；清空再确认等于取消；Esc 取消、选区高亮撤掉", async () => {
        const {editor, ran} = harness("见林雪\n");
        editor.commands.setTextSelection(find(editor, "林雪"));
        ctrlK(editor);
        await flushPromises();
        await typeInto(promptInput(), "javascript:alert(1)");
        const confirm = prompt()?.querySelector<HTMLButtonElement>("button[aria-label='promptConfirm']");
        expect(confirm?.disabled).toBe(true);
        enter(promptInput());
        await flushPromises();
        expect(ran).toEqual([]);
        expect(prompt()).not.toBeNull();
        await typeInto(promptInput(), "");
        enter(promptInput());
        await flushPromises();
        expect(ran).toEqual([]);
        expect(links(editor)).toEqual([]);
        ctrlK(editor);
        await flushPromises();
        expect(held()).toEqual(["林雪"]);
        keyDown(promptInput(), {key: "Escape"});
        await flushPromises();
        expect(held()).toEqual([]);
    });

    it("只读、代码块里、焦点不在正文里、输入法组字中：Ctrl+K 不响应，也不拦浏览器自己的 Ctrl+K", async () => {
        const readonly = harness("见林雪\n", {readonly: true});
        readonly.editor.commands.setTextSelection(find(readonly.editor, "林雪"));
        expect(ctrlK(readonly.editor).defaultPrevented).toBe(false);
        const code = harness("```js\nlet a\n```\n");
        code.editor.commands.setTextSelection(find(code.editor, "let"));
        expect(ctrlK(code.editor).defaultPrevented).toBe(false);
        const body = harness("见林雪\n");
        body.editor.commands.setTextSelection(find(body.editor, "林雪"));
        const outside = document.createElement("input");
        body.scroller.append(outside);
        expect(keyDown(outside, {code: "KeyK", key: "k", ctrlKey: true}).defaultPrevented).toBe(false);
        expect(keyDown(body.editor.view.dom, {code: "KeyK", key: "k", ctrlKey: true, isComposing: true}).defaultPrevented).toBe(false);
        await flushPromises();
        expect(prompt()).toBeNull();
    });
});

describe("选区菜单里的链接按钮（输出 6、52）", () => {
    it("选着字、选完之后菜单出现；点链接按钮开链接卡片（选区菜单收起），光标在链接里时按钮是按下的", async () => {
        const {editor, scroller} = harness("见[林雪](a.md)与甲乙\n");
        const select = async (text: string): Promise<void> => {
            scroller.dispatchEvent(new Event("pointerdown", {bubbles: true}));
            editor.commands.setTextSelection(find(editor, text));
            window.dispatchEvent(new Event("pointerup"));
            await flushPromises();
        };
        const linkButton = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>("[data-markdown-selection-menu] button[aria-label='link']");
        await select("甲乙");
        expect(linkButton()?.getAttribute("aria-pressed")).toBe("false");
        await select("林雪");
        expect(linkButton()?.getAttribute("aria-pressed")).toBe("true");
        linkButton()?.click();
        await flushPromises();
        expect(promptInput().value).toBe("a.md");
        expect(document.querySelector("[data-markdown-selection-menu]")).toBeNull();
    });
});

describe("插图卡片（输出 54、58）", () => {
    const card = (): HTMLElement | null => document.querySelector<HTMLElement>("[data-markdown-image-card]");
    const query = (): HTMLInputElement => {
        const found = card()?.querySelector<HTMLInputElement>("input[data-markdown-image-query]");
        if (found === null || found === undefined) throw new Error("卡片没有输入框");
        return found;
    };
    const rows = (): string[] => [...document.querySelectorAll("[data-markdown-image-row] .markdown-image-card__name")].map((element) => element.textContent ?? "");
    const open = async (scene: MediaScene = {}, markdown = "甲乙\n") => {
        const made = mediaOf(scene);
        const opened = harness(markdown, {media: made.media});
        opened.editor.commands.setTextSelection(2);
        (opened.wrapper.vm as unknown as {prompt: (action: string) => void}).prompt("image");
        await flushPromises();
        return {...opened, ...made};
    };
    const images = (editor: Editor): string[] => {
        const found: string[] = [];
        editor.state.doc.descendants((node) => {
            if (node.type.name === "image") found.push(`${String(node.attrs.src)}|${String(node.attrs.alt)}`);
        });
        return found;
    };

    it("打开：光标处画竖线，列出存放目录里的图（名字倒序）；回车插入高亮的第一张，地址相对当前文件，说明取文件名，卡片收起", async () => {
        const {editor, ran} = await open({entries: ["a.png", "c.jpg", "b.webp", "说明.txt"]});
        expect(caret()).toBe(1);
        expect(rows()).toEqual(["c.jpg", "b.webp", "a.png"]);
        expect(document.activeElement).toBe(query());
        enter(query());
        await flushPromises();
        expect(images(editor)).toEqual(["../插图/c.jpg|c"]);
        expect(ran).toEqual([{action: "image", args: {src: "../插图/c.jpg", alt: "c"}}]);
        expect(caret()).toBe(0);
    });

    it("上下键移动、点击插入；回车时没有选中项（读取中、没有结果）什么也不做", async () => {
        const {editor} = await open({entries: ["a.png", "b.png"]});
        keyDown(query(), {key: "ArrowDown"});
        await nextTick();
        expect(document.querySelector("[data-markdown-image-row][data-highlighted] .markdown-image-card__name")?.textContent).toBe("a.png");
        keyDown(query(), {key: "ArrowDown"});
        await nextTick();
        expect(document.querySelector("[data-markdown-image-row][data-highlighted] .markdown-image-card__name")?.textContent).toBe("b.png");
        document.querySelectorAll<HTMLElement>("[data-markdown-image-row]")[1]?.click();
        await flushPromises();
        expect(images(editor)).toEqual(["../插图/a.png|a"]);
        const empty = await open({entries: []});
        expect(card()?.textContent).toContain("imageCardEmpty");
        enter(query());
        await flushPromises();
        expect(images(empty.editor)).toEqual([]);
        expect(card()).not.toBeNull();
    });

    it("输入文字时按名字在整部作品里找（停手后才发），结果的目录显示在名字旁；网址只有“插入网址的图片”一行", async () => {
        const {editor, searches} = await open({entries: ["a.png"], found: [{path: "卷二/图/林雪.png", name: "林雪.png"}]});
        await typeInto(query(), "林");
        await vi.waitFor(() => expect(rows()).toEqual(["林雪.png"]));
        expect(searches).toEqual(["林"]);
        expect(document.querySelector("[data-markdown-image-row] .markdown-image-card__directory")?.textContent).toBe("卷二/图");
        await typeInto(query(), "https://example.com/图/封面.png");
        await flushPromises();
        expect(document.querySelectorAll("[data-markdown-image-row]")).toHaveLength(0);
        expect(document.querySelector("[data-markdown-image-url]")?.textContent).toContain("imageCardUrl");
        enter(query());
        await flushPromises();
        expect(images(editor)).toEqual(["https://example.com/图/封面.png|封面"]);
    });

    it("迟到的结果丢弃：输入又变了、前一次的结果后到也不覆盖当前的；卡片关了再开，上一次没回来的结果也不进新的列表", async () => {
        const pending: Array<{query: string; resolve: (name: string) => void}> = [];
        // 与真实的远程调用一样：被中止的请求不是挂着不回，而是立刻回一个 `cancelled` 失败。
        await open({find: (query, signal) => new Promise((resolve) => {
            pending.push({query, resolve: (name) => resolve({ok: true, value: {items: [{path: name, name}], truncated: false}})});
            signal?.addEventListener("abort", () => resolve({ok: false, detail: "已取消"}), {once: true});
        })});
        await typeInto(query(), "林");
        await vi.waitFor(() => expect(pending.map((entry) => entry.query)).toEqual(["林"]));
        await typeInto(query(), "雪");
        // 第一次请求已被中止、立刻回了“已取消”（第二次请求还在等停手的延迟里）：不能显示成读取失败。
        await flushPromises();
        expect(card()?.textContent).not.toContain("imageCardFailed");
        await vi.waitFor(() => expect(pending.map((entry) => entry.query)).toEqual(["林", "雪"]));
        pending[1]?.resolve("雪.png");
        await vi.waitFor(() => expect(rows()).toEqual(["雪.png"]));
        pending[0]?.resolve("林.png");
        await flushPromises();
        expect(rows()).toEqual(["雪.png"]);
    });

    it("上传：选了本机文件，复制进存放目录（保留原名、重名加序号）再插入，插入的是实际写下的地址；失败给通知、卡片留着", async () => {
        const first = await open({uploadReply: (address) => ({ok: true, address: address.replace(".png", " 2.png"), renamed: true})});
        const input = document.querySelector<HTMLInputElement>("[data-markdown-image-file]") as HTMLInputElement;
        expect(input.accept).toBe("image/png,image/jpeg,image/gif,image/webp");
        Object.defineProperty(input, "files", {value: [png("封面.png")], configurable: true});
        input.dispatchEvent(new Event("change", {bubbles: true}));
        await vi.waitFor(() => expect(images(first.editor)).toEqual(["../插图/封面 2.png|封面 2"]));
        expect(first.uploads).toEqual([{address: "project://插图/封面.png", name: "封面.png", options: {exists: "rename", signal: expect.any(AbortSignal)}}]);
        cleanups.pop()?.();
        const failing = await open({uploadReply: () => ({ok: false, code: "too-large", detail: "太大了"})});
        const again = document.querySelector<HTMLInputElement>("[data-markdown-image-file]") as HTMLInputElement;
        Object.defineProperty(again, "files", {value: [png("大图.png")], configurable: true});
        again.dispatchEvent(new Event("change", {bubbles: true}));
        await vi.waitFor(() => expect(failing.notices).toEqual([{key: "imageTooLarge", params: {name: "大图.png"}}]));
        expect(images(failing.editor)).toEqual([]);
        expect(card()).not.toBeNull();
    });

    it("系统的选文件框开着：失焦不收卡片；选完（或取消）后回到输入框，之后点别处才收", async () => {
        await open();
        document.querySelector<HTMLButtonElement>("[data-markdown-image-upload]")?.click();
        card()?.dispatchEvent(new FocusEvent("focusout", {bubbles: true, relatedTarget: null}));
        await flushPromises();
        expect(card()).not.toBeNull();
        document.querySelector<HTMLInputElement>("[data-markdown-image-file]")?.dispatchEvent(new Event("cancel"));
        card()?.dispatchEvent(new FocusEvent("focusout", {bubbles: true, relatedTarget: document.body}));
        await vi.waitFor(() => expect(document.querySelector("[data-markdown-image-card]")).toBeNull());
    });

    it("宿主没有提供插图能力：只能插入网址的图片，上传置灰；提供了但没有绑定作品：列表为空、上传置灰", async () => {
        const bare = harness("甲乙\n", {media: null});
        bare.editor.commands.setTextSelection(2);
        (bare.wrapper.vm as unknown as {prompt: (action: string) => void}).prompt("image");
        await flushPromises();
        expect(card()?.textContent).toContain("imageCardUrlOnly");
        expect(document.querySelector<HTMLButtonElement>("[data-markdown-image-upload]")?.disabled).toBe(true);
        await typeInto(query(), "https://example.com/a.png");
        enter(query());
        await flushPromises();
        expect(bare.ran).toEqual([{action: "image", args: {src: "https://example.com/a.png", alt: "a"}}]);
        cleanups.pop()?.();
        await open({bound: false, entries: ["a.png"]});
        expect(rows()).toEqual([]);
        expect(document.querySelector<HTMLButtonElement>("[data-markdown-image-upload]")?.disabled).toBe(true);
    });

    it("斜杠菜单“块”组里有“图片”：选了以后 `/查询` 被删掉，卡片在光标处开着", async () => {
        const made = mediaOf({entries: ["a.png"]});
        const {editor, scroller} = harness("\n", {media: made.media});
        editor.commands.focus("start");
        // 一个字符一个事务，像真实输入；菜单项的名字在这里取动作 id（真实的是“图片”），所以按 id 查。
        for (const char of "/image") editor.view.dispatch(editor.state.tr.insertText(char));
        await flushPromises();
        const item = [...document.querySelectorAll<HTMLElement>("[role='option']")].find((element) => element.textContent?.includes("image"));
        expect(item).toBeDefined();
        keyDown(scroller, {key: "Enter"});
        await flushPromises();
        expect(editor.state.doc.textContent).toBe("");
        expect(card()).not.toBeNull();
        expect(rows()).toEqual(["a.png"]);
    });

    it("只读时不开；代码块里不开；Esc 取消并撤掉高亮", async () => {
        const made = mediaOf();
        const readonly = harness("甲乙\n", {readonly: true, media: made.media});
        (readonly.wrapper.vm as unknown as {prompt: (action: string) => void}).prompt("image");
        await flushPromises();
        expect(card()).toBeNull();
        cleanups.pop()?.();
        const code = harness("```js\nlet a\n```\n", {media: made.media});
        code.editor.commands.setTextSelection(find(code.editor, "let"));
        (code.wrapper.vm as unknown as {prompt: (action: string) => void}).prompt("image");
        await flushPromises();
        expect(card()).toBeNull();
        cleanups.pop()?.();
        await open();
        expect(caret()).toBe(1);
        keyDown(query(), {key: "Escape"});
        await flushPromises();
        expect(caret()).toBe(0);
    });
});

describe("表情（stickers 输出 39 到 43，输出 62）", () => {
    const sticker = (name: string) => ({name, width: 64, height: 64, url: `/img/${name}.png`});
    const LYRA: BrowserStickerPack = {id: "user.lyra", folder: "lyra", title: "星璃", source: "user", writing: "lyra", stickers: ["开心", "困", "害羞"].map(sticker)};
    /** 真的选择器服务：真的浏览器目录、内存里的最近用过。 */
    function picker(): StickerPicker {
        const directory = createStickerDirectory();
        directory.set([LYRA]);
        const controller = new AbortController();
        cleanups.push(() => controller.abort());
        return createStickerPicker({directory, recent: memoryRecent(), openPacksPage: () => undefined, report: () => undefined, signal: controller.signal});
    }
    const stickersIn = (editor: Editor): string[] => {
        const found: string[] = [];
        editor.state.doc.descendants((node) => {
            if (node.type.name === "sticker") found.push(String(node.attrs.raw));
        });
        return found;
    };
    const openPicker = async (wrapper: ReturnType<typeof harness>["wrapper"]): Promise<HTMLElement> => {
        (wrapper.vm as unknown as {prompt: (action: string) => void}).prompt("sticker");
        // 面板的代码第一次打开时才加载：等到格子画出来。
        await waitUntil("选择器的格子画出来", () => document.querySelector("[data-markdown-sticker-card] [data-sticker-cell]"));
        return document.querySelector<HTMLElement>("[data-markdown-sticker-card]") as HTMLElement;
    };
    const cell = (card: HTMLElement, raw: string): HTMLElement => {
        const found = [...card.querySelectorAll<HTMLElement>("[data-sticker-cell]")].find((element) => element.dataset.stickerRaw === raw);
        if (found === undefined) throw new Error(`没有 ${raw}`);
        return found;
    };

    it("打 `:开`：补全一行是小图、名字与表情包名；回车换成表情、记进最近用过", async () => {
        const chosen = picker();
        const {editor} = harness("写完啦\n", {picker: chosen});
        editor.commands.setTextSelection(find(editor, "写完啦").to);
        for (const char of ":开") editor.view.dispatch(editor.state.tr.insertText(char));
        await nextTick();
        const option = document.querySelector<HTMLElement>("[role='option']");
        expect(option?.querySelector("[data-suggestion-menu-image]")?.getAttribute("src")).toBe("/img/开心.png");
        expect(option?.textContent?.replace(/\s+/gu, "")).toBe("开心星璃");
        keyDown(editor.view.dom, {key: "Enter"});
        await nextTick();
        expect(stickersIn(editor)).toEqual([":lyra/开心:"]);
        expect(chosen.recent().map((item) => item.raw)).toEqual([":lyra/开心:"]);
        expect(document.querySelector("[role='option']")).toBeNull();
    });

    it("选择器：开着时光标处画竖线、选区菜单让位；点一下插在光标处、关上、焦点回正文；Shift 点插入后不关", async () => {
        const {editor, wrapper} = harness("今天很开心\n", {picker: picker()});
        editor.commands.setTextSelection(find(editor, "今天").to);
        const card = await openPicker(wrapper);
        expect(caret()).toBe(1);
        cell(card, ":lyra/困:").dispatchEvent(new MouseEvent("click", {bubbles: true, shiftKey: true}));
        await nextTick();
        expect(document.querySelector("[data-state='open'] [data-markdown-sticker-card]")).not.toBeNull();
        expect(caret()).toBe(1);
        cell(card, ":lyra/害羞:").click();
        await nextTick();
        expect(stickersIn(editor)).toEqual([":lyra/困:", ":lyra/害羞:"]);
        expect(editor.getText()).toBe("今天:lyra/困::lyra/害羞:很开心");
        expect(document.querySelector("[data-state='open'] [data-markdown-sticker-card]")).toBeNull();
        expect(caret()).toBe(0);
        // Tiptap 的 focus 延到下一帧才落到正文上。
        await waitUntil("焦点回到正文", () => editor.view.dom.contains(document.activeElement) || null);
    });

    it("Esc 关上不插；没装表情包插件、只读、代码块里打不开", async () => {
        const {editor, wrapper} = harness("今天\n", {picker: picker()});
        editor.commands.setTextSelection(3);
        const card = await openPicker(wrapper);
        keyDown(card.querySelector("input")!, {key: "Escape"});
        await nextTick();
        expect(document.querySelector("[data-state='open'] [data-markdown-sticker-card]")).toBeNull();
        expect(stickersIn(editor)).toEqual([]);
        // Esc 关上：焦点回正文。
        await waitUntil("焦点回到正文", () => editor.view.dom.contains(document.activeElement) || null);
        // 焦点去了别处（点了别的控件）：关上，不把焦点抢回正文。
        const elsewhere = document.body.appendChild(document.createElement("button"));
        const reopened = await openPicker(wrapper);
        reopened.querySelector("input")!.focus();
        elsewhere.focus();
        await nextTick();
        expect(document.querySelector("[data-state='open'] [data-markdown-sticker-card]")).toBeNull();
        // Tiptap 的 focus 延到下一帧：过两帧再看焦点还在不在别处。
        for (let frame = 0; frame < 2; frame += 1) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        expect(document.activeElement).toBe(elsewhere);
        for (const scene of [harness("今天\n"), harness("今天\n", {picker: picker(), readonly: true}), harness("```\nx\n```\n", {picker: picker()})]) {
            scene.editor.commands.setTextSelection(2);
            (scene.wrapper.vm as unknown as {prompt: (action: string) => void}).prompt("sticker");
            await flushPromises();
            expect(document.querySelector("[data-state='open'] [data-markdown-sticker-card]")).toBeNull();
        }
    });
});
