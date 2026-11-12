/**
 * nb-markdown 的 MarkdownDisplay 经 nbook 的宿主挂上（docs/specs/ui/markdown-display.md）：方言的外观与编辑器一致、流式更新只
 * 替换变了的块、交互出口与释放、作品文件的引用小块与外来方言。语言与编辑器同一份（内置方言），编辑器一侧用同一套扩展建
 * 真实的 Tiptap 编辑器。不经插件挂上的用法在 nb-markdown 自己的 `display/MarkdownDisplay.dom.test.ts`。
 */

import {Editor, Mark, Node} from "@tiptap/core";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {MarkdownDisplay} from "@notnotype/nb-markdown/display";
import type {ResolveAsset} from "@notnotype/nb-markdown/display";
import {createMarkdownEditorExtensions} from "@notnotype/nb-markdown/editor";
import {markdownHostKey} from "@notnotype/nb-markdown/host";
import {codecFor, defaultMarkdownLanguage as markdownLanguage} from "@notnotype/nb-markdown/language";

import {nbookChips, nbookMarkdownHost} from "../host";
import {languageFor} from "../language-registry";
import {SyntaxCatalog} from "../syntax-catalog";
import {startMarkdownBrowserHost} from "../testing/browser-host";
import {kbdDialectPlugin, kbdSyntax} from "../testing/kbd-dialect";

/** nbook.markdown 交组件时给的方言目录：没有外来方言。 */
const catalog = new SyntaxCatalog({get: () => null, list: () => []}, () => undefined);
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function display(props: {text: string; streaming?: boolean; resolveAsset?: ResolveAsset}, options: {catalog?: SyntaxCatalog; reports?: string[]} = {}) {
    const host = nbookMarkdownHost({language: () => languageFor(options.catalog ?? catalog), report: (event) => options.reports?.push(event)});
    const provide: Record<symbol, unknown> = {[markdownHostKey as symbol]: host};
    const wrapper = mount(MarkdownDisplay, {props: {locale: "zh-CN", ...props}, attachTo: document.body, global: {provide}});
    cleanups.push(() => wrapper.unmount());
    return wrapper;
}

/** 等下一帧的更新做完（展示器在下一帧读入）。 */
async function settled(wrapper: ReturnType<typeof display>, check: (root: HTMLElement) => boolean): Promise<void> {
    await waitUntil("展示器更新", () => (check(wrapper.element as HTMLElement) ? true : null));
}

const CORPUS = [
    "她抬头<comment body=\"节奏太快\">看了他一眼</comment>，远处站着<ruby text=\"hàn zì\">汉字</ruby>先生，==高亮==与 x<sup>2</sup>。",
    "",
    "<bilingual text=\"老人缓缓走向祭坛。\">",
    "The old man walked toward the altar.",
    "</bilingual>",
    "",
    "> [!WARNING]- 伏笔",
    "> 折叠的内容。",
    "",
    "<html>",
    "<b>卡片</b>",
    "</html>",
    "",
    "见[<comment body=\"出场\">林</comment>雪](/设定/林雪.md)与[官网](https://example.com)，按 <kbd>Ctrl</kbd> 保存。",
    "",
].join("\n");

/** 方言元素的结构：标签名、`nb-` 开头的类名与方言的数据属性，按文档顺序。批注末尾的小符号只在编辑器里有（输出 38），不是方言元素。 */
function dialectShape(root: Element): string[] {
    return [...root.querySelectorAll("*")]
        .filter((element) => !element.matches(".nb-comment-marker"))
        .filter((element) => [...element.classList].some((name) => name.startsWith("nb-")) || ["comment", "ruby", "mark", "sup"].includes(element.tagName.toLowerCase()) || element.hasAttribute("data-callout"))
        .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].filter((name) => name.startsWith("nb-")).sort().join(".")}${element.hasAttribute("data-callout") ? `[${element.getAttribute("data-callout")}]` : ""}`);
}

describe("Spec ui.markdown-display", () => {
    it("场景 3、输出 2、3：同一份语料，展示器与编辑器的方言元素结构与类名一致；作品里的链接是一个引用小块", async () => {
        const wrapper = display({text: CORPUS});
        await settled(wrapper, (root) => root.querySelector(".nb-callout") !== null);
        const language = markdownLanguage();
        const element = document.createElement("div");
        document.body.append(element);
        const editor = new Editor({element, extensions: createMarkdownEditorExtensions({language, placeholder: "", host: {base: () => null, assets: null, chips: nbookChips}, commentMarkerLabel: ""}), editable: false});
        cleanups.push(() => {
            editor.destroy();
            element.remove();
        });
        editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, codecFor(editor.schema, language).read(CORPUS).doc.content));
        expect(dialectShape(wrapper.element)).toEqual(dialectShape(editor.view.dom));
        expect(wrapper.element.querySelectorAll(".nb-chip-link__icon")).toHaveLength(1);
        expect(wrapper.element.querySelector(".nb-callout")?.getAttribute("data-callout-folded")).toBe("true");
    });

    it("场景 1、输出 6、7：流式追加时开头的批注与折叠的提示块元素不变、仍折叠；光标在末尾，流式结束后去掉", async () => {
        const start = "<comment body=\"意见\">完整的第一段。</comment>\n\n> [!NOTE]- 伏笔\n> 内容\n\n末段";
        const wrapper = display({text: start, streaming: true});
        await settled(wrapper, (root) => root.querySelector(".nb-callout") !== null);
        const first = wrapper.element.firstElementChild;
        const callout = wrapper.element.querySelector(".nb-callout");
        expect(wrapper.element.querySelector(".nb-markdown-display__cursor")?.parentElement?.textContent).toContain("末段");
        let text = start;
        for (const piece of ["继续", "写下去。", "\n\n新的一段"]) {
            text += piece;
            await wrapper.setProps({text});
            await settled(wrapper, (root) => (root.textContent ?? "").includes(piece.trim()));
            expect(wrapper.element.firstElementChild).toBe(first);
            expect(wrapper.element.querySelector(".nb-callout")).toBe(callout);
            expect(callout?.getAttribute("data-callout-folded")).toBe("true");
        }
        expect(wrapper.element.querySelector(".nb-markdown-display__cursor")?.parentElement?.textContent).toContain("新的一段");
        await wrapper.setProps({streaming: false});
        expect(wrapper.element.querySelector(".nb-markdown-display__cursor")).toBeNull();
    });

    it("输出 6：后面新出现的引用定义改变了前面块的含义，前面那块也重画", async () => {
        const wrapper = display({text: "见[甲][r]。\n\n末段\n"});
        await settled(wrapper, (root) => (root.textContent ?? "").includes("末段"));
        expect(wrapper.element.querySelector("a")).toBeNull();
        await wrapper.setProps({text: "见[甲][r]。\n\n末段\n\n[r]: /设定/甲.md\n"});
        await settled(wrapper, (root) => root.querySelector("a") !== null);
        expect(wrapper.element.querySelector("a .nb-chip-link")?.textContent).toBe("甲");
    });

    it("输出 5：点引用小块、外部链接与图片发出 activate，不自己跳转；提示块的标题切换折叠", async () => {
        const wrapper = display({text: "见[林雪](/设定/林雪.md)与[官网](https://example.com)。\n\n![封面](/图/封面.png)\n\n> [!TIP]- 标题\n> 内容\n", resolveAsset: async () => ({url: "/raw/封面.png", release: () => undefined})});
        await settled(wrapper, (root) => root.querySelector("img") !== null);
        const anchors = wrapper.element.querySelectorAll("a");
        const click = (target: Element): boolean => target.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
        expect(click(anchors[0] as Element)).toBe(false);
        click(anchors[1] as Element);
        click(wrapper.element.querySelector("img") as Element);
        expect(wrapper.emitted("activate")).toEqual([[{kind: "reference", target: "/设定/林雪.md"}], [{kind: "link", href: "https://example.com"}], [{kind: "image", address: "/图/封面.png"}]]);
        const title = wrapper.element.querySelector(".nb-callout__title") as HTMLElement;
        expect(wrapper.element.querySelector(".nb-callout")?.getAttribute("data-callout-folded")).toBe("true");
        title.click();
        expect(wrapper.element.querySelector(".nb-callout")?.getAttribute("data-callout-folded")).toBe("false");
    });

    it("场景 4、输出 8：块被替换与卸载时释放图片；渲染中的 `<html>` 块被替换后沙箱不在了", async () => {
        const released: string[] = [];
        const resolveAsset = async (src: string) => ({url: `/raw/${src}`, release: () => released.push(src)});
        const wrapper = display({text: "![甲](a.png)\n\n<html>\n<b>卡片</b>\n</html>\n", resolveAsset});
        await settled(wrapper, (root) => root.querySelector("img") !== null);
        (wrapper.element.querySelector(".nb-html-embed__toggle") as HTMLElement).click();
        expect(document.querySelectorAll(".nb-html-embed__frame")).toHaveLength(1);
        await wrapper.setProps({text: "![乙](b.png)\n\n<html>\n<b>换了</b>\n</html>\n"});
        await settled(wrapper, (root) => root.querySelector("img")?.getAttribute("src") === "/raw/b.png");
        await flushPromises();
        expect(released).toEqual(["a.png"]);
        expect(document.querySelectorAll(".nb-html-embed__frame")).toHaveLength(0);
        wrapper.unmount();
        cleanups.pop();
        expect(released).toEqual(["a.png", "b.png"]);
        expect(document.querySelector("[data-markdown-display]")).toBeNull();
    });

    it("输出 3、5：`project://`、`user://` 与旧应用的 `chapter://` 都是引用小块（地址不被清掉），点击交出原文地址；外部链接是普通链接", async () => {
        const wrapper = display({text: "[甲](project://设定/甲.md) [乙](user://b.png) [丙](chapter://c1) [丁](https://example.com)\n"});
        await settled(wrapper, (root) => root.querySelectorAll("a").length === 4);
        const anchors = [...wrapper.element.querySelectorAll("a")];
        expect(anchors.map((anchor) => [anchor.getAttribute("href"), anchor.querySelector(".nb-chip-link") !== null])).toEqual([["project://设定/甲.md", true], ["user://b.png", true], ["chapter://c1", true], ["https://example.com", false]]);
        for (const anchor of anchors) anchor.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
        expect(wrapper.emitted("activate")).toEqual([[{kind: "reference", target: "project://设定/甲.md"}], [{kind: "reference", target: "user://b.png"}], [{kind: "reference", target: "chapter://c1"}], [{kind: "link", href: "https://example.com"}]]);
    });

    it("宽表格包在 `tableWrapper` 里，在自己里面横向滚动", async () => {
        const wrapper = display({text: "| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n"});
        await settled(wrapper, (root) => root.querySelector("table") !== null);
        expect(wrapper.element.querySelector("table")?.parentElement?.classList.contains("tableWrapper")).toBe(true);
    });

    it("输出 1 与“失败与恢复”：某一块画不出来时按文字显示、记诊断，别的块与之后的更新照常", async () => {
        const broken = kbdSyntax();
        const throwing = Mark.create({name: "test-kbd", priority: 700, parseHTML: () => [{tag: "kbd"}], renderHTML: () => {
            throw new Error("画不出来");
        }});
        const host = await startMarkdownBrowserHost([kbdDialectPlugin({implementation: {load: async () => ({...broken, extensions: [throwing]})}})], "display-broken");
        cleanups.push(() => void host.application.stop());
        await waitUntil("方言生效", () => (host.catalog.active.value.length === 1 ? true : null));
        const reports: string[] = [];
        const wrapper = display({text: "按 <kbd>K</kbd>\n\n第二段\n"}, {catalog: host.catalog, reports});
        await settled(wrapper, (root) => root.querySelector(".nb-markdown-display__plain") !== null);
        expect(wrapper.element.querySelector(".nb-markdown-display__plain")?.textContent).toBe("按 K");
        expect(wrapper.element.querySelector("p")?.textContent).toBe("第二段");
        expect(reports).toEqual(["markdown.display.block-failed"]);
        await wrapper.setProps({text: "按 <kbd>K</kbd>\n\n第二段，继续写\n"});
        await settled(wrapper, (root) => (root.textContent ?? "").includes("继续写"));
    });

    it("“失败与恢复”：组不成 schema 时按纯文字显示原文、记诊断，之后的更新照常显示新的原文", async () => {
        const base = kbdSyntax();
        const invalid = Node.create({name: "test-broken", group: "block", content: "nosuch+"});
        const host = await startMarkdownBrowserHost([kbdDialectPlugin({implementation: {load: async () => ({...base, extensions: [...base.extensions, invalid]})}})], "display-invalid");
        cleanups.push(() => void host.application.stop());
        await waitUntil("方言生效", () => (host.catalog.active.value.length === 1 ? true : null));
        const reports: string[] = [];
        const wrapper = display({text: "**粗**\n"}, {catalog: host.catalog, reports});
        await settled(wrapper, (root) => root.textContent === "**粗**\n");
        expect(reports).toEqual(["markdown.display.failed"]);
        await wrapper.setProps({text: "**粗** 又一句\n"});
        await settled(wrapper, (root) => root.textContent === "**粗** 又一句\n");
    });
});
