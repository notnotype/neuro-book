/** 标签显示的名字：标签条与拖动标签的拖影共用，两处写的是同一个名字。 */

import type {TextResolver} from "nbook/shared/localized-text";

import {editorText} from "../shared/text";
import type {EditorArea} from "./area";
import {nameOf} from "./documents/address";
import {LOST_TAB_ADDRESS} from "./groups/groups";
import type {EditorTab} from "./groups/groups";
import {pageIdOf} from "./pages";
import type {EditorPageSource} from "./pages";

export function tabLabel(area: EditorArea, tab: EditorTab, text: TextResolver, pages: EditorPageSource | null): string {
    // 页面标签（docs/specs/workbench/editor.md 输出 33）按页面的标题显示；贡献方停了、标题取不到时显示页面 id。
    if (tab.address === LOST_TAB_ADDRESS) return text.t(editorText("tab.lost"));
    const page = pageIdOf(tab.address);
    if (page !== null) return pages?.title(page, text) ?? page;
    // 预览视图的标题写“预览 a.html”（输出 47），与同组里这个文件的源码标签分得开。
    const preview = tab.kind === "file" && area.editors.declaration(tab.editor)?.role === "preview";
    return preview ? text.t(editorText("tab.previewOf", {name: nameOf(tab.address)})) : nameOf(tab.address);
}
