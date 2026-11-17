/**
 * 粘贴图片与 Ctrl 点链接（docs/specs/workbench/markdown-editing.md 输出 53、55）：真实的语言、真实的 Tiptap 与编辑器扩展组。宿主的
 * `upload` 是测试控制的（记下每次调用、由测试决定何时完成），其余都是真的：占位、串行、插入位置、放弃与告知、写回的 Markdown。
 * 浏览器真实剪贴板里各类内容带什么类型，在 e2e 与开发者真机试用里看；这里按它们的形状（`files`、`text/plain`、`text/html`）逐类对照。
 */

import {Editor} from "@tiptap/core";
import {Slice} from "@tiptap/pm/model";
import {EditorState, TextSelection} from "@tiptap/pm/state";
import {afterEach, describe, expect, it} from "vitest";

import {schemeTargets} from "../targets";
import {defaultChipEnv} from "../chip/chip";
import {codecFor, defaultMarkdownLanguage} from "../language";
import {imageFilesOf} from "./image-paste";
import {createMarkdownEditorExtensions} from "./markdown-editor-extensions";
import type {ImageFailure, ImageUploadResult, MarkdownViewHost} from "./view-host";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});

const language = defaultMarkdownLanguage();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const file = (name: string, type = "image/png"): File => new File([PNG], name, {type});

interface Upload {
    readonly file: File;
    readonly signal: AbortSignal;
    resolve(result: ImageUploadResult): void;
}

/** 测试控制的宿主：`upload` 的每次调用都等测试 `resolve`。 */
function hostOf(options: {readonly images?: boolean; readonly base?: string | null} = {}) {
    const uploads: Upload[] = [];
    const failures: ImageFailure[] = [];
    const opened: string[] = [];
    let base = options.base === undefined ? "project://章/一.md" : options.base;
    const host: MarkdownViewHost = {
        base: () => base,
        assets: null,
        chips: {...defaultChipEnv, targets: schemeTargets},
        openLink: (href) => opened.push(href),
        ...(options.images === false ? {} : {images: {
            upload: (picked, signal) => new Promise<ImageUploadResult>((resolve) => {
                uploads.push({file: picked, signal, resolve});
                signal.addEventListener("abort", () => resolve({ok: false, code: "cancelled", detail: "已取消"}), {once: true});
            }),
            failed: (failure) => failures.push(failure),
        }}),
    };
    return {host, uploads, failures, opened, setBase: (next: string | null) => {
        base = next;
    }};
}

function open(markdown: string, host: MarkdownViewHost) {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: createMarkdownEditorExtensions({language, placeholder: "", host, commentMarkerLabel: null})});
    editors.push(editor);
    const codec = codecFor(editor.schema, language);
    const read = codec.read(markdown);
    editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
    return {
        editor,
        codec,
        write: () => {
            const written = codec.write(editor.state.doc, read.map);
            if (!written.ok) throw new Error(`写不出：${written.reason}`);
            return written.text;
        },
        select: (from: number, to = from) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to))),
    };
}

interface Pasted {
    readonly files?: File[];
    readonly text?: string;
    readonly html?: string;
}

/** 走 ProseMirror 的粘贴入口：返回有没有人接手，以及 `preventDefault` 调了几次。 */
function paste(editor: Editor, pasted: Pasted): {handled: boolean; prevented: number} {
    let prevented = 0;
    const event = {
        clipboardData: {
            files: pasted.files ?? [],
            getData: (type: string) => (type === "text/plain" ? pasted.text ?? "" : type === "text/html" ? pasted.html ?? "" : ""),
        },
        preventDefault: () => {
            prevented += 1;
        },
    } as unknown as ClipboardEvent;
    const view = editor.view;
    const handled = view.someProp("handlePaste", (handle) => handle(view, event, Slice.empty)) === true;
    return {handled, prevented};
}

const flush = async (): Promise<void> => {
    for (let round = 0; round < 5; round += 1) await Promise.resolve();
};
const done = (address: string, alt = ""): ImageUploadResult => ({ok: true, address, alt});
const widgets = (editor: Editor): number => editor.view.dom.querySelectorAll("[data-image-uploading]").length;

describe("剪贴板里什么算图片（输出 55 的判据）", () => {
    const data = (pasted: Pasted) => ({files: pasted.files ?? [], getData: (type: string) => (type === "text/plain" ? pasted.text ?? "" : type === "text/html" ? pasted.html ?? "" : "")}) as unknown as Pick<DataTransfer, "files" | "getData">;
    const shot = [file("image.png")];

    it("接手：只有图片；文件管理器复制文件（文字是文件名、路径或 file:// 地址）；网页、Word 里复制一张图（HTML 里只有 <img> 与样式）", () => {
        expect(imageFilesOf(data({files: shot}))).toHaveLength(1);
        for (const text of ["image.png", "/home/林/图/image.png", "C:\\Users\\林\\image.png", "file:///home/x/image.png", "image.png\nimage.png"]) expect(imageFilesOf(data({files: shot, text}))).toHaveLength(1);
        expect(imageFilesOf(data({files: shot, html: '<img src="https://example.com/a.png">'}))).toHaveLength(1);
        expect(imageFilesOf(data({files: shot, html: '<html><head><meta charset="utf-8"><style>p{margin:0}</style></head><body><!--StartFragment--><p><img src="file:///C:/x.png"></p><!--EndFragment--></body></html>'}))).toHaveLength(1);
    });

    it("不接手：带实质文字（表格软件的单元格、图文混排）、只有文字、不是图片的文件", () => {
        expect(imageFilesOf(data({files: shot, text: "甲\t乙", html: "<table><tr><td>甲</td><td>乙</td></tr></table>"}))).toBeNull();
        expect(imageFilesOf(data({files: shot, text: "一段文字"}))).toBeNull();
        expect(imageFilesOf(data({files: shot, html: "<p>一段文字</p><img src='a.png'>"}))).toBeNull();
        expect(imageFilesOf(data({text: "只有文字"}))).toBeNull();
        expect(imageFilesOf(data({files: [file("a.pdf", "application/pdf")]}))).toBeNull();
    });
});

describe("粘贴一张图（输出 55）", () => {
    it("占位出现；传完换成图片：地址是按当前文件算的相对地址，说明取宿主给的；占位撤掉；写回正确", async () => {
        const {host, uploads, failures} = hostOf();
        const harness = open("前半后半\n", host);
        harness.select(3);
        const result = paste(harness.editor, {files: [file("image.png")]});
        expect(result).toEqual({handled: true, prevented: 1});
        expect(widgets(harness.editor)).toBe(1);
        expect(harness.editor.view.dom.textContent).toContain("正在上传 1 张图片");
        expect(uploads).toHaveLength(1);
        uploads[0]?.resolve(done("project://插图/粘贴的图片 1.png", "说明"));
        await flush();
        expect(widgets(harness.editor)).toBe(0);
        expect(harness.write()).toBe("前半![说明](<../插图/粘贴的图片 1.png>)后半\n");
        expect(failures).toEqual([]);
    });

    it("几张图一张接一张地传：第一张传完才传第二张；一张失败不影响别的，失败的告诉宿主；先传完的先插入", async () => {
        const {host, uploads, failures} = hostOf();
        const harness = open("前半后半\n", host);
        harness.select(3);
        paste(harness.editor, {files: [file("a.png"), file("b.png"), file("c.png")]});
        expect(uploads.map((upload) => upload.file.name)).toEqual(["a.png"]);
        uploads[0]?.resolve({ok: false, code: "too-large", detail: "过大"});
        await flush();
        expect(failures).toEqual([{file: "a.png", code: "too-large", detail: "过大", stored: false}]);
        expect(uploads.map((upload) => upload.file.name)).toEqual(["a.png", "b.png"]);
        uploads[1]?.resolve(done("project://章/b.png"));
        await flush();
        uploads[2]?.resolve({ok: false, code: "unknown-outcome", detail: "结果未知"});
        await flush();
        expect(failures.map((failure) => [failure.file, failure.stored])).toEqual([["a.png", false], ["c.png", true]]);
        expect(widgets(harness.editor)).toBe(0);
        expect(harness.write()).toBe("前半![](b.png)后半\n");
    });

    it("传的过程中可以继续编辑：占位随文字移动，图插在占位处", async () => {
        const {host, uploads} = hostOf();
        const harness = open("甲乙\n", host);
        harness.select(2);
        paste(harness.editor, {files: [file("a.png")]});
        harness.editor.commands.insertContentAt(1, "前");
        harness.editor.commands.insertContentAt(harness.editor.state.doc.content.size - 1, "后");
        uploads[0]?.resolve(done("project://章/a.png"));
        await flush();
        expect(harness.write()).toBe("前甲![](a.png)乙后\n");
    });

    it("选中的字被替换；原来的选区在占位之后不再有", async () => {
        const {host, uploads} = hostOf();
        const harness = open("前半后半\n", host);
        harness.select(3, 5);
        paste(harness.editor, {files: [file("a.png")]});
        uploads[0]?.resolve(done("project://章/a.png"));
        await flush();
        expect(harness.write()).toBe("前半![](a.png)\n");
    });
});

describe("几张图的落点（输出 55）", () => {
    it("光标在不在表格里的空段落：各占一段，第一张用这个空段落，占位挪到最后一张后面", async () => {
        const {host, uploads} = hostOf();
        const harness = open("甲\n\n\n\n乙\n", host);
        let empty = -1;
        harness.editor.state.doc.forEach((node, offset, index) => {
            if (empty < 0 && index > 0 && node.type.name === "paragraph" && node.content.size === 0) empty = offset;
        });
        harness.select(empty + 1);
        paste(harness.editor, {files: [file("a.png"), file("b.png"), file("c.png")]});
        for (const [index, name] of ["a", "b", "c"].entries()) {
            uploads[index]?.resolve(done(`project://章/${name}.png`));
            await flush();
        }
        expect(widgets(harness.editor)).toBe(0);
        // 三张才看得出占位有没有随各占一段的图往后挪：不挪的话第三张会插到第二张前面。
        expect(harness.write()).toContain("![](a.png)\n\n![](b.png)\n\n![](c.png)");
    });

    it("表格单元格：几张图依次放进同一段，写得出来", async () => {
        const {host, uploads} = hostOf();
        const harness = open("| 甲 | 乙 |\n| --- | --- |\n| 丙 | 丁 |\n", host);
        let at = -1;
        harness.editor.state.doc.descendants((node, pos) => {
            if (at < 0 && node.isText && node.text === "丙") at = pos;
            return at < 0;
        });
        harness.select(at);
        paste(harness.editor, {files: [file("a.png"), file("b.png")]});
        uploads[0]?.resolve(done("project://章/a.png"));
        await flush();
        uploads[1]?.resolve(done("project://章/b.png"));
        await flush();
        expect(harness.write()).toContain("| ![](a.png)![](b.png)丙 | 丁 |");
    });

    it("代码块里：不上传，每张给一条“这里不能插入”的通知，粘贴被接手（原来的粘贴在代码块里也不会放进图片）", () => {
        const {host, uploads, failures} = hostOf();
        const harness = open("```js\nlet a\n```\n", host);
        harness.select(3);
        expect(paste(harness.editor, {files: [file("a.png"), file("b.png")]}).handled).toBe(true);
        expect(uploads).toEqual([]);
        expect(failures.map((failure) => [failure.file, failure.code, failure.stored])).toEqual([["a.png", "not-allowed-here", false], ["b.png", "not-allowed-here", false]]);
        expect(harness.write()).toBe("```js\nlet a\n```\n");
    });
});

describe("放弃与告知（输出 55 的时序）", () => {
    it("换了文档（同一个编辑器换 EditorState）：没传的取消、不再传；传完了没有插入的告诉宿主；新文档不受影响", async () => {
        const {host, uploads, failures} = hostOf();
        const harness = open("甲乙\n", host);
        harness.select(2);
        paste(harness.editor, {files: [file("a.png"), file("b.png")]});
        const other = harness.codec.read("别的文件\n");
        harness.editor.view.updateState(EditorState.create({doc: other.doc, plugins: harness.editor.state.plugins}));
        expect(uploads[0]?.signal.aborted).toBe(true);
        // 第一张在换文档之前就传完了、只是还没来得及插入：已经在作品里，告诉用户。
        uploads[0]?.resolve(done("project://章/a.png"));
        await flush();
        expect(uploads).toHaveLength(1);
        expect(failures.some((failure) => failure.file === "a.png" && (failure.code === "not-inserted" || failure.code === "cancelled") && failure.stored)).toBe(true);
        expect(harness.editor.state.doc.textContent).toBe("别的文件");
        expect(harness.editor.view.dom.querySelectorAll("img").length).toBe(0);
    });

    it("换文档再换回来：放弃的占位不再画，没传的也不会接着传", async () => {
        const {host, uploads} = hostOf();
        const harness = open("甲乙\n", host);
        harness.select(2);
        paste(harness.editor, {files: [file("a.png"), file("b.png")]});
        expect(widgets(harness.editor)).toBe(1);
        const original = harness.editor.state;
        const other = harness.codec.read("别的文件\n");
        harness.editor.view.updateState(EditorState.create({doc: other.doc, plugins: harness.editor.state.plugins}));
        uploads[0]?.resolve(done("project://章/a.png"));
        await flush();
        harness.editor.view.updateState(original);
        expect(widgets(harness.editor)).toBe(0);
        expect(uploads).toHaveLength(1);
    });

    it("变成只读：传完的不插入、告诉宿主，后面的不再传", async () => {
        const {host, uploads, failures} = hostOf();
        const harness = open("甲乙\n", host);
        harness.select(2);
        paste(harness.editor, {files: [file("a.png"), file("b.png")]});
        harness.editor.setEditable(false);
        uploads[0]?.resolve(done("project://章/a.png"));
        await flush();
        expect(failures).toEqual([{file: "a.png", code: "not-inserted", detail: "project://章/a.png", stored: true}]);
        expect(uploads).toHaveLength(1);
        expect(harness.write()).toBe("甲乙\n");
    });

    it("编辑器销毁：还在传的取消", () => {
        const {host, uploads} = hostOf();
        const harness = open("甲乙\n", host);
        harness.select(2);
        paste(harness.editor, {files: [file("a.png")]});
        harness.editor.destroy();
        expect(uploads[0]?.signal.aborted).toBe(true);
    });

    it("宿主没有图片能力、剪贴板有实质文字、Ctrl+Shift+V（纯文字）、只读：不接手，不调用 preventDefault", () => {
        const none = open("甲乙\n", hostOf({images: false}).host);
        none.select(2);
        expect(paste(none.editor, {files: [file("a.png")]})).toEqual({handled: false, prevented: 0});
        const {host, uploads} = hostOf();
        const harness = open("甲乙\n", host);
        harness.select(2);
        expect(paste(harness.editor, {files: [file("a.png")], text: "一段文字"})).toEqual({handled: false, prevented: 0});
        (harness.editor.view as unknown as {input: {shiftKey: boolean}}).input.shiftKey = true;
        expect(paste(harness.editor, {files: [file("a.png")]})).toEqual({handled: false, prevented: 0});
        (harness.editor.view as unknown as {input: {shiftKey: boolean}}).input.shiftKey = false;
        harness.editor.setEditable(false);
        expect(paste(harness.editor, {files: [file("a.png")]})).toEqual({handled: false, prevented: 0});
        expect(uploads).toEqual([]);
    });
});

describe("按住 Ctrl 点链接（输出 53）", () => {
    function clicked(editor: Editor, modifiers: {readonly ctrlKey?: boolean; readonly metaKey?: boolean; readonly shiftKey?: boolean; readonly altKey?: boolean}, text = "设定"): {handled: boolean; prevented: boolean} {
        const anchor = Array.from(editor.view.dom.querySelectorAll("a")).find((candidate) => candidate.textContent?.includes(text));
        if (anchor === undefined) throw new Error("没有这条链接");
        const event = new MouseEvent("click", {button: 0, bubbles: true, cancelable: true, ...modifiers});
        Object.defineProperty(event, "target", {value: anchor});
        // 不先把光标放进被点的链接：ProseMirror 的选区在点击处理时还是点击之前的（浏览器的光标要等 `selectionchange` 才同步进来）。
        const pos = editor.view.posAtDOM(anchor, 0) + 1;
        const handled = editor.view.someProp("handleClick", (handle) => handle(editor.view, pos, event)) === true;
        return {handled, prevented: event.defaultPrevented};
    }

    it("Ctrl 或 ⌘ 点：交宿主打开链接标记上的地址，不选中链接", () => {
        const {host, opened} = hostOf();
        const harness = open("见[林雪的设定](设定/林雪.md)吧\n", host);
        harness.select(1);
        expect(clicked(harness.editor, {ctrlKey: true})).toEqual({handled: true, prevented: true});
        expect(clicked(harness.editor, {metaKey: true})).toEqual({handled: true, prevented: true});
        expect(opened).toEqual(["设定/林雪.md", "设定/林雪.md"]);
        expect(harness.editor.state.selection.empty).toBe(true);
    });

    it("单击选中被点的那条整条链接，宿主没被调用；光标原来在别的链接里也一样（不是之前的选区）", () => {
        const {host, opened} = hostOf();
        const harness = open("见[林雪的设定](设定/林雪.md)与[官网](https://example.com)\n", host);
        // 光标先放进“官网”，再点“林雪的设定”：选中的必须是被点的这一条。
        harness.select(harness.editor.state.doc.textContent.indexOf("官网") + 2);
        expect(clicked(harness.editor, {}).handled).toBe(true);
        expect(opened).toEqual([]);
        const {from, to} = harness.editor.state.selection;
        expect(harness.editor.state.doc.textBetween(from, to)).toBe("林雪的设定");
        expect(clicked(harness.editor, {}, "官网").handled).toBe(true);
        expect(harness.editor.state.doc.textBetween(harness.editor.state.selection.from, harness.editor.state.selection.to)).toBe("官网");
    });

    it("Shift、Alt 加点（扩展选区）与不在链接上的点击不接手；只读时单击不选中", () => {
        const {host} = hostOf();
        const harness = open("见[林雪](a.md)乙\n", host);
        harness.select(1);
        expect(clicked(harness.editor, {shiftKey: true}, "林雪").handled).toBe(false);
        expect(clicked(harness.editor, {altKey: true}, "林雪").handled).toBe(false);
        harness.editor.setEditable(false);
        expect(clicked(harness.editor, {}, "林雪").handled).toBe(false);
    });

    it("宿主此刻没有打开的能力：Ctrl 点也不接手，照单击", () => {
        const {host} = hostOf();
        const bare: MarkdownViewHost = {base: host.base, assets: null, chips: host.chips};
        const harness = open("见[林雪的设定](设定/林雪.md)吧\n", bare);
        harness.select(1);
        clicked(harness.editor, {ctrlKey: true});
        const {from, to} = harness.editor.state.selection;
        expect(harness.editor.state.doc.textBetween(from, to)).toBe("林雪的设定");
    });
});
