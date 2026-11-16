/**
 * 新建 frontmatter（docs/specs/workbench/markdown-editing.md 输出 48）：第一块开头打 `---` 的输入规则与编辑动作 `properties`。
 * frontmatter 在文档的属性上（`language/codec`），这里只建一段空的（开栏、闭栏两行）。面板的展开与聚焦归宿主：事务带
 * `FRONTMATTER_REQUEST` meta，宿主在事务回调里看到它就展开面板、把焦点放到新属性的名字上。
 *
 * 换行符取文档自己的：编辑器不知道原文的换行符，由宿主在换文档、重载时写进 `editor.storage.frontmatter.eol`
 * （`setFrontmatterEol`）。实例按标签保留、一个标签只开一份文档，所以存在实例上不会串到别的文档。
 */

import {Extension, InputRule} from "@tiptap/core";
import type {Editor} from "@tiptap/core";

/** 事务的 meta：要展开属性面板并聚焦新属性的名字（新建的，或已有时的“添加属性”）。 */
export const FRONTMATTER_REQUEST = "nbMarkdownFrontmatterRequest";

interface FrontmatterStorage {
    eol: string;
}

declare module "@tiptap/core" {
    interface Storage {
        frontmatter: FrontmatterStorage;
    }
}

const empty = (eol: string): string => `---${eol}---${eol}`;

export const MarkdownFrontmatter = Extension.create<Record<string, never>, FrontmatterStorage>({
    name: "frontmatter",
    // 先于 StarterKit 的分割线规则（同样认 `---`、`—-`）：命中时那一条不再跑。
    priority: 1000,

    addStorage() {
        return {eol: "\n"};
    },

    addInputRules() {
        const storage = this.storage;
        return [
            new InputRule({
                // `—-`：有的系统把连打的两个 `-` 自动换成破折号。
                find: /^(?:---|—-)$/u,
                handler: ({state, range}) => {
                    // 只在没有 frontmatter、第一块是文字块、光标前只有这三个字符时（`find` 从块首匹配）；否则交给分割线规则。
                    const {doc} = state;
                    if (doc.attrs.frontmatter != null || doc.firstChild?.isTextblock !== true || range.from !== 1) return null;
                    state.tr.delete(range.from, range.to).setDocAttribute("frontmatter", empty(storage.eol)).setMeta(FRONTMATTER_REQUEST, true);
                    return undefined;
                },
            }),
        ];
    },
});

/**
 * 宿主在换文档、重载之后调用：新建 frontmatter 用的换行符。只用单独回车（`\r`）换行的文档写 `\n`：frontmatter 的开栏只认
 * `\n` 与 `\r\n`（`language/codec/source.ts`），`---\r---\r` 不是 frontmatter。
 */
export function setFrontmatterEol(editor: Editor, eol: string): void {
    editor.storage.frontmatter.eol = eol === "\r\n" ? "\r\n" : "\n";
}

/**
 * 编辑动作 `properties`：没有 frontmatter 时建一段空的（一个撤销步）；已有时不改文档，只发请求（不进撤销历史）。
 */
export function requestProperties(editor: Editor): boolean {
    const tr = editor.state.tr.setMeta(FRONTMATTER_REQUEST, true);
    if (editor.state.doc.attrs.frontmatter == null) tr.setDocAttribute("frontmatter", empty(editor.storage.frontmatter.eol));
    else tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
    return true;
}
