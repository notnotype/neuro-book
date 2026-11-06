/**
 * PromptEditor（同名 .md；docs/specs/ui/prompt-editor.md）：草稿、粘贴分档、粘贴块编辑、附件、按键、`@` 菜单与界面语言。
 * 由旧应用的同名测试移植（分支 `archive/legacy-ui-tuning`，`865c9f593`），期望值不变；文字表改由 `locale` 属性给出，撤销分组
 * 用 ProseMirror 历史的真实边界（`closeHistory`）代替假时钟。“`@` 菜单”与“界面语言”两组是新加的（场景 4、5）。
 */

import type {Editor} from "@tiptap/core";
import {closeHistory} from "@tiptap/pm/history";
import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import type {ChipEnv} from "../chip/chip";
import {defaultMarkdownHost, markdownHostKey} from "../host";
import {classifyScheme, schemeTargets} from "../targets";
import PromptEditor from "./PromptEditor.vue";
import type {PromptEditorAttachment, PromptEditorDraft, PromptEditorExpose, PromptEditorMenuContext} from "./prompt-editor.types";
import {promptReferenceText} from "./prompt-text";

const TARGET = "session://attachments/a.png";
const mounted: VueWrapper[] = [];

type Props = InstanceType<typeof PromptEditor>["$props"];

async function mountEditor(props: Partial<Props> & {draft: PromptEditorDraft}): Promise<VueWrapper> {
    const wrapper = mount(PromptEditor, {props: {locale: "zh-CN", ...props}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    await nextTick();
    return wrapper;
}

function prosemirror(wrapper: VueWrapper): HTMLElement {
    return wrapper.element.querySelector(".ProseMirror") as HTMLElement;
}

function exposed(wrapper: VueWrapper): PromptEditorExpose {
    return wrapper.vm as unknown as PromptEditorExpose;
}

function changes(wrapper: VueWrapper): string[] {
    return (wrapper.emitted("change") ?? []).map((args) => args[0] as string);
}

/** 在正文元素上派发一次粘贴。 */
function paste(wrapper: VueWrapper, fill: {text?: string; html?: string; files?: File[]}): void {
    const data = {
        files: fill.files ?? [],
        getData: (type: string) => type === "text/plain" ? fill.text ?? "" : type === "text/html" ? fill.html ?? "" : "",
    };
    const event = new Event("paste", {bubbles: true, cancelable: true}) as Event & {clipboardData: unknown};
    Object.defineProperty(event, "clipboardData", {value: data});
    prosemirror(wrapper).dispatchEvent(event);
}

function lines(count: number): string {
    return Array.from({length: count}, (_, index) => `line ${index}`).join("\n");
}

/** Tiptap 把编辑器挂在正文元素上；测试经它在两次改动之间放一个撤销边界。 */
function editorOf(wrapper: VueWrapper): Editor {
    return (prosemirror(wrapper) as HTMLElement & {editor: Editor}).editor;
}

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    document.body.replaceChildren();
});

describe("PromptEditor 草稿", () => {
    it("读入草稿，换版本时替换正文且不发 change", async () => {
        const wrapper = await mountEditor({draft: {text: "第一版 $writer", version: 1}});
        expect(prosemirror(wrapper).textContent).toContain("第一版");
        await wrapper.setProps({draft: {text: "第二版", version: 2}});
        expect(prosemirror(wrapper).textContent).toBe("第二版");
        expect(changes(wrapper)).toEqual([]);
    });

    it("同一版本内的文字变化被当作回声忽略", async () => {
        const wrapper = await mountEditor({draft: {text: "原文", version: 1}});
        await wrapper.setProps({draft: {text: "宿主写回的别的文字", version: 1}});
        expect(prosemirror(wrapper).textContent).toBe("原文");
    });

    it("insertText 识别写法并发出完整文字", async () => {
        const wrapper = await mountEditor({draft: {text: "看", version: 1}});
        exposed(wrapper).focus("end");
        exposed(wrapper).insertText(" [第一章](chapter://c1)");
        expect(changes(wrapper).at(-1)).toBe("看 [第一章](chapter://c1)");
        // 有意改变：小块的外观换成 InlineChip，标记属性随之从 `data-prompt-token` 换成 `data-inline-chip`。
        expect(wrapper.element.querySelector("[data-inline-chip='reference']")).not.toBeNull();
    });

    it("只读时 insertText 不做任何事，正文带 aria-readonly", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}, readonly: true});
        exposed(wrapper).insertText("x");
        expect(changes(wrapper)).toEqual([]);
        expect(prosemirror(wrapper).getAttribute("aria-readonly")).toBe("true");
        expect([prosemirror(wrapper).getAttribute("role"), prosemirror(wrapper).getAttribute("aria-multiline")]).toEqual(["textbox", "true"]);
    });
});

describe("PromptEditor 粘贴分档", () => {
    it("小段原样插入", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}});
        paste(wrapper, {text: "a\nb $writer"});
        expect(changes(wrapper).at(-1)).toBe("a\nb $writer");
    });

    it("中等在粘贴处成为粘贴块", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}});
        paste(wrapper, {text: lines(12)});
        expect(changes(wrapper).at(-1)).toBe(`<paste id="1">\n${lines(12)}\n</paste>\n`);
        await nextTick();
        expect(wrapper.element.querySelector("[data-prompt-paste]")).not.toBeNull();
    });

    it("放到开头时粘贴处留位置标记，编号与文件共用一套", async () => {
        const wrapper = await mountEditor({draft: {text: `/plan 看 [file #3 · a.pdf](${TARGET})`, version: 1}, commands: ["plan"], pastePolicy: {blockPlacement: "start"}});
        exposed(wrapper).focus("end");
        paste(wrapper, {text: lines(12)});
        expect(changes(wrapper).at(-1)).toBe(`/plan 看 [file #3 · a.pdf](${TARGET})[paste #4]\n<paste id="4">\n${lines(12)}\n</paste>`);
    });

    it("大段在接受文件时转为附件，不接受时成为粘贴块", async () => {
        const accepting = await mountEditor({draft: {text: "", version: 1}, acceptFiles: true});
        paste(accepting, {text: lines(120)});
        const added = accepting.emitted("attachment-add")?.[0]?.[0] as {localId: string; kind: string; file: File};
        expect(added.kind).toBe("file");
        expect(added.file.name).toBe("paste-1.txt");
        expect(changes(accepting)).toEqual([]);

        const refusing = await mountEditor({draft: {text: "", version: 1}});
        paste(refusing, {text: lines(120)});
        expect(changes(refusing).at(-1)?.startsWith("<paste id=\"1\">")).toBe(true);
    });

    it("本编辑器复制出来的文字按结构读回并换掉撞号", async () => {
        const block = "<paste id=\"1\">\nx\n</paste>";
        const wrapper = await mountEditor({draft: {text: block, version: 1}});
        exposed(wrapper).focus("end");
        paste(wrapper, {text: block, html: "<pre data-pm-slice=\"0 0 []\">x</pre>"});
        expect(changes(wrapper).at(-1)).toBe(`${block}\n<paste id="2">\nx\n</paste>\n`);
    });
});

describe("PromptEditor 粘贴块编辑", () => {
    function withBlock(content: string): string {
        return `前\n<paste id="1">\n${content}\n</paste>\n后`;
    }

    function area(wrapper: VueWrapper): HTMLTextAreaElement | null {
        return wrapper.element.querySelector("[data-prompt-paste-area]") as HTMLTextAreaElement | null;
    }

    async function type(wrapper: VueWrapper, value: string): Promise<void> {
        const element = area(wrapper)!;
        element.value = value;
        element.dispatchEvent(new Event("input", {bubbles: true}));
        await nextTick();
    }

    function press(element: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
        element.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true, ...init}));
    }

    it("不超过 3 行的直接可编辑，输入写回文字", async () => {
        const wrapper = await mountEditor({draft: {text: withBlock("a\nb"), version: 1}});
        await type(wrapper, "a\nb\nc");
        expect(changes(wrapper).at(-1)).toBe(withBlock("a\nb\nc"));
        await type(wrapper, "a\nb\nc\nd");
        expect(area(wrapper), "输入中超过 3 行也不收起").not.toBeNull();
    });

    it("收起时是预览，展开后可编辑；只读时展开也不能编辑", async () => {
        const wrapper = await mountEditor({draft: {text: withBlock(lines(5)), version: 1}});
        expect(area(wrapper)).toBeNull();
        await wrapper.find("[data-prompt-paste-action='expand']").trigger("click");
        expect(area(wrapper)).not.toBeNull();

        const readonly = await mountEditor({draft: {text: withBlock(lines(5)), version: 1}, readonly: true});
        await readonly.find("[data-prompt-paste-action='expand']").trigger("click");
        expect(area(readonly)).toBeNull();
        expect(readonly.element.querySelector("[data-prompt-paste] pre")?.textContent).toBe(lines(5));
    });

    it("有恰好是 </paste> 的一行时不写回，离开后恢复", async () => {
        const wrapper = await mountEditor({draft: {text: withBlock("a\nb"), version: 1}});
        await type(wrapper, "a\n</paste>\nb");
        expect(changes(wrapper)).toEqual([]);
        expect(area(wrapper)!.getAttribute("aria-invalid")).toBe("true");
        area(wrapper)!.dispatchEvent(new FocusEvent("blur"));
        await nextTick();
        expect(area(wrapper)!.value).toBe("a\nb");
        expect(area(wrapper)!.getAttribute("aria-invalid")).toBe("false");
    });

    it("文本框里的撤销走编辑器历史，连续输入算一步", async () => {
        const wrapper = await mountEditor({draft: {text: withBlock("a\nb"), version: 1}});
        await type(wrapper, "a\nbx");
        await type(wrapper, "a\nbxy");
        press(area(wrapper)!, "z", {ctrlKey: true});
        await flushPromises();
        expect(changes(wrapper).at(-1)).toBe(withBlock("a\nb"));
        expect(area(wrapper)!.value).toBe("a\nb");
        press(area(wrapper)!, "z", {ctrlKey: true, shiftKey: true});
        await flushPromises();
        expect(changes(wrapper).at(-1)).toBe(withBlock("a\nbxy"));
    });

    it("Escape 回到正文粘贴块之后，Ctrl+回车发送", async () => {
        const wrapper = await mountEditor({draft: {text: withBlock("a"), version: 1}});
        press(area(wrapper)!, "Enter", {ctrlKey: true});
        expect(wrapper.emitted("submit")).toEqual([[{mod: true}]]);
        press(area(wrapper)!, "Escape");
        exposed(wrapper).insertText("X");
        expect(changes(wrapper).at(-1)).toBe(withBlock("a").replace("后", "X后"));
    });

    it("焦点在正文与文本框之间移动不发 focus、blur，离开编辑器才发", async () => {
        const wrapper = await mountEditor({draft: {text: withBlock("a"), version: 1}});
        prosemirror(wrapper).focus();
        area(wrapper)!.focus();
        prosemirror(wrapper).focus();
        area(wrapper)!.focus();
        expect(wrapper.emitted("focus")).toHaveLength(1);
        expect(wrapper.emitted("blur")).toBeUndefined();
        area(wrapper)!.blur();
        expect(wrapper.emitted("blur")).toHaveLength(1);
    });
});

describe("PromptEditor 附件", () => {
    it("就绪后写回图片标签并发出 change；撤销带回已移除的附件时换新 localId", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}, acceptImages: true});
        paste(wrapper, {files: [new File(["x"], "a.png", {type: "image/png"})]});
        const added = wrapper.emitted("attachment-add")?.[0]?.[0] as {localId: string};
        await nextTick();
        expect(wrapper.element.querySelector("[data-prompt-card-state='uploading']")).not.toBeNull();

        const attachments: PromptEditorAttachment[] = [{localId: added.localId, state: "ready", target: TARGET}];
        await wrapper.setProps({attachments});
        expect(changes(wrapper).at(-1)).toBe(`![image #1](${TARGET})`);
        expect(wrapper.emitted("attachment-remove")).toBeUndefined();
    });

    it("删掉未就绪的附件发出 remove，撤销后用新 localId 重新登记", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}, acceptImages: true});
        paste(wrapper, {files: [new File(["x"], "a.png", {type: "image/png"})]});
        const first = (wrapper.emitted("attachment-add")?.[0]?.[0] as {localId: string}).localId;
        await nextTick();
        // 撤销历史把 500ms 内的改动并成一步；放一个边界，撤销只撤回删除。
        const editor = editorOf(wrapper);
        editor.view.dispatch(closeHistory(editor.state.tr));
        (wrapper.element.querySelector("[data-prompt-card-action='remove']") as HTMLButtonElement).click();
        expect(wrapper.emitted("attachment-remove")?.[0]?.[0]).toEqual({localId: first});

        prosemirror(wrapper).dispatchEvent(new KeyboardEvent("keydown", {key: "z", ctrlKey: true, bubbles: true}));
        const readded = wrapper.emitted("attachment-add")?.[1]?.[0] as {localId: string};
        expect(readded.localId).not.toBe(first);
    });

    it("不接受的文件发出 reject", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}, acceptImages: true});
        paste(wrapper, {files: [new File(["x"], "a.pdf", {type: "application/pdf"}), new File(["y"], "b.txt", {type: "text/plain"})]});
        expect(wrapper.emitted("attachment-reject")?.[0]?.[0]).toEqual({kind: "file", count: 2});
        expect(wrapper.emitted("attachment-add")).toBeUndefined();
    });

    it("insertFiles 与粘贴文件相同：接受的登记，不接受的发出 reject；只读时不做任何事", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}, acceptFiles: true});
        exposed(wrapper).insertFiles([new File(["x"], "a.png", {type: "image/png"}), new File(["y"], "设定.pdf", {type: "application/pdf"})]);
        expect(wrapper.emitted("attachment-reject")?.[0]?.[0]).toEqual({kind: "image", count: 1});
        expect(wrapper.emitted("attachment-add")?.map((args) => (args[0] as {kind: string}).kind)).toEqual(["file"]);

        const readonly = await mountEditor({draft: {text: "", version: 1}, acceptFiles: true, readonly: true});
        exposed(readonly).insertFiles([new File(["y"], "设定.pdf", {type: "application/pdf"})]);
        expect(readonly.emitted("attachment-add")).toBeUndefined();
    });

    it("换草稿版本时未就绪的附件发出 remove", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}, acceptImages: true});
        paste(wrapper, {files: [new File(["x"], "a.png", {type: "image/png"})]});
        const added = (wrapper.emitted("attachment-add")?.[0]?.[0] as {localId: string}).localId;
        await wrapper.setProps({draft: {text: "", version: 2}});
        expect(wrapper.emitted("attachment-remove")?.[0]?.[0]).toEqual({localId: added});
    });
});

describe("PromptEditor 按键", () => {
    function keydown(wrapper: VueWrapper, init: KeyboardEventInit): void {
        prosemirror(wrapper).dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init}));
    }

    it("回车发送，Ctrl+回车带 mod，Shift+回车换行", async () => {
        const wrapper = await mountEditor({draft: {text: "ab", version: 1}});
        exposed(wrapper).focus("end");
        keydown(wrapper, {key: "Enter"});
        keydown(wrapper, {key: "Enter", ctrlKey: true});
        expect(wrapper.emitted("submit")).toEqual([[{mod: false}], [{mod: true}]]);
        keydown(wrapper, {key: "Enter", shiftKey: true});
        expect(changes(wrapper).at(-1)).toBe("ab\n");
    });

    it("enterSubmits 为假时回车换行", async () => {
        const wrapper = await mountEditor({draft: {text: "ab", version: 1}, enterSubmits: false});
        exposed(wrapper).focus("end");
        keydown(wrapper, {key: "Enter"});
        expect(wrapper.emitted("submit")).toBeUndefined();
        expect(changes(wrapper).at(-1)).toBe("ab\n");
    });

    it("Escape 与 Shift+Tab 发出事件", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}, captureShiftTab: true});
        keydown(wrapper, {key: "Escape"});
        keydown(wrapper, {key: "Tab", shiftKey: true});
        expect(wrapper.emitted("escape")).toHaveLength(1);
        expect(wrapper.emitted("shift-tab")).toHaveLength(1);
    });

    it("不占用 Shift+Tab 时不吞：它还是反向移动焦点", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}});
        const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, key: "Tab", shiftKey: true});
        prosemirror(wrapper).dispatchEvent(event);
        expect(wrapper.emitted("shift-tab")).toBeUndefined();
        expect(event.defaultPrevented).toBe(false);
    });

    it("空正文按上方向键调出最近一条，再按下回到空正文", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}, recall: ["最近一条", "更早一条"]});
        exposed(wrapper).focus("end");
        keydown(wrapper, {key: "ArrowUp"});
        expect(changes(wrapper).at(-1)).toBe("最近一条");
        keydown(wrapper, {key: "ArrowUp"});
        expect(changes(wrapper).at(-1)).toBe("更早一条");
    });

    it("正文不空时上方向键不调出历史", async () => {
        const wrapper = await mountEditor({draft: {text: "正在写", version: 1}, recall: ["最近一条"]});
        exposed(wrapper).focus("end");
        keydown(wrapper, {key: "ArrowUp"});
        expect(changes(wrapper)).toEqual([]);
    });
});

describe("PromptEditor `@` 菜单", () => {
    const resolveMenu = (context: PromptEditorMenuContext) => ({
        items: context.trigger === "@" ? [{id: "林雪", label: "林雪", description: "设定/林雪.md", insertText: promptReferenceText("林雪", "/设定/林雪.md", schemeTargets)}] : [],
    });

    it("场景 4：确认作品里的文件，文字是以 `/` 开头的作品根地址，显示为引用小块，后面补一个空格", async () => {
        const wrapper = await mountEditor({draft: {text: "", version: 1}, triggers: ["@"], resolveMenu});
        exposed(wrapper).focus("end");
        prosemirror(wrapper).dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        exposed(wrapper).insertText("@林");
        await nextTick();
        expect(wrapper.emitted("menu-open")).toEqual([[{trigger: "@"}]]);
        // 菜单传送到了 body：在整个文档里找；正文区的 aria-activedescendant 指向的就是高亮的那一项。
        const option = document.querySelector<HTMLElement>("[role='option']");
        expect(option?.textContent).toContain("林雪");
        expect(option?.hasAttribute("data-highlighted")).toBe(true);
        expect(prosemirror(wrapper).getAttribute("aria-activedescendant")).toBe(option?.id);
        expect(document.getElementById(prosemirror(wrapper).getAttribute("aria-controls")!)?.getAttribute("role")).toBe("listbox");
        prosemirror(wrapper).dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await nextTick();
        expect(changes(wrapper).at(-1)).toBe("[林雪](/设定/林雪.md) ");
        expect(wrapper.element.querySelector("[data-inline-chip='reference']")?.textContent).toContain("林雪");
        expect(wrapper.emitted("submit")).toBeUndefined();
    });
});

describe("PromptEditor openTrigger", () => {
    const resolveMenu = (context: PromptEditorMenuContext) => ({items: context.trigger === "@" ? [{id: "林雪", label: "林雪", insertText: "林雪"}] : []});

    it("正文以中文结尾时先补一个空格再插触发字符，菜单打开；空正文、以空格或中文标点结尾时直接插", async () => {
        for (const [text, expected] of [["介绍一下", "介绍一下 @"], ["", "@"], ["介绍一下 ", "介绍一下 @"], ["介绍一下，", "介绍一下，@"]] as const) {
            const wrapper = await mountEditor({draft: {text, version: 1}, triggers: ["@"], resolveMenu});
            prosemirror(wrapper).dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
            exposed(wrapper).openTrigger("@");
            await nextTick();
            expect(changes(wrapper).at(-1)).toBe(expected);
            expect(wrapper.emitted("menu-open")).toEqual([[{trigger: "@"}]]);
        }
    });

    it("只读时什么也不做", async () => {
        const wrapper = await mountEditor({draft: {text: "介绍一下", version: 1}, triggers: ["@"], resolveMenu, readonly: true});
        exposed(wrapper).openTrigger("@");
        await nextTick();
        expect(changes(wrapper)).toEqual([]);
    });
});

describe("PromptEditor 界面语言", () => {
    it("场景 5：换成英文后粘贴块与附件条的按钮文字跟着换，正文与撤销历史不变", async () => {
        const wrapper = await mountEditor({draft: {text: "前", version: 1}, acceptImages: true});
        exposed(wrapper).focus("end");
        paste(wrapper, {text: lines(12)});
        paste(wrapper, {files: [new File(["x"], "a.png", {type: "image/png"})]});
        await nextTick();
        const label = (selector: string): string | null => wrapper.element.querySelector(selector)?.getAttribute("aria-label") ?? null;
        expect(label("[data-prompt-paste-action='to-text']")).toBe("转为文字");
        expect(label("[data-prompt-card-action='remove']")).toBe("移除 图片 #1");
        const before = changes(wrapper).at(-1);
        await wrapper.setProps({locale: "en-US"});
        expect(label("[data-prompt-paste-action='to-text']")).toBe("Convert to text");
        expect(label("[data-prompt-card-action='remove']")).toBe("Remove Image #1");
        expect(changes(wrapper).at(-1)).toBe(before);
        editorOf(wrapper).commands.undo();
        expect(changes(wrapper).at(-1)).toBe("前");
    });

    it("宿主经 provideMarkdownHost 给的目标分类与文件图标到达正文里的引用小块（节点视图拿得到祖先的宿主）；不给时用缺省分类", async () => {
        const chips: ChipEnv = {
            targets: {classify: (target) => (target.startsWith("/") ? {kind: "file", variant: "work", name: "林雪.md"} : classifyScheme(target)), encodeFile: (target) => target},
            fileIcon: (name) => ({render: (document) => Object.assign(document.createElement("i"), {className: "test-file-icon", title: name})}),
        };
        const draft = {text: "看 [林雪](/设定/林雪.md)", version: 1};
        const hosted = mount(PromptEditor, {props: {locale: "zh-CN", draft}, attachTo: document.body, global: {provide: {[markdownHostKey as symbol]: {...defaultMarkdownHost, chips}}}});
        mounted.push(hosted);
        await flushPromises();
        await nextTick();
        const chip = hosted.find("[data-inline-chip='reference']");
        expect(chip.classes()).toContain("nb-chip--work");
        expect(chip.find("i.test-file-icon").attributes("title")).toBe("林雪.md");

        const plain = await mountEditor({draft});
        expect(plain.find("[data-inline-chip='reference']").classes()).toContain("nb-chip--other");
    });
});
