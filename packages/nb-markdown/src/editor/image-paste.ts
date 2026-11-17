/**
 * 粘贴图片（docs/specs/workbench/markdown-editing.md 输出 55）：剪贴板里有图片文件、而文字部分没有实质内容时，把图片存进作品
 * 并插入；别的粘贴照原来。
 *
 * - **判据**（`imageFilesOf`）：有图片文件，且纯文字去掉空白后为空、或每一行都只是某个文件的名字、路径或 `file://` 地址（从文件
 *   管理器复制文件），HTML 去掉标签后没有文字（从网页、Word 里复制一张图）。表格软件复制的单元格带实质的文字，不接手。
 * - **时序**：先在光标处放一个占位（插件状态里的挂件装饰，随事务映射），图片一张接一张地传（同一秒的几张，序号与剪贴板里的先后
 *   一致），每张传完就按占位的位置插入，全部传完撤掉占位。传的过程中文档照常可以编辑。
 * - **放弃**：占位不在了（换了文档：同一个编辑器实例在标签间换 `EditorState`，新的状态里没有它）、编辑器变成只读或被销毁，没传的不
 *   再传，传完了没有插入的告诉宿主（图在作品里，只是没插入）。
 * - 相对地址在插入那一刻按宿主此刻的 `base()` 算：传的过程中文件可能被改名、移动。
 */

import {Extension} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import type {EditorState} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
import type {EditorView} from "@tiptap/pm/view";

import {markdownTextIn} from "../host/text";
import {relativeTarget} from "../targets";
import {imageLayout, imageNode} from "./images";
import type {MarkdownViewHost} from "./view-host";

type Clipboard = Pick<DataTransfer, "files" | "getData">;

const FILE_URL = /^file:\/\//iu;

/** HTML 里的文字：去掉标签、注释与实体空白后剩下的。 */
function htmlText(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(?:style|script|head)[\s\S]*?<\/(?:style|script|head)>/giu, "").replace(/<[^>]*>/gu, "").replace(/&nbsp;|&#160;/giu, " ").replace(/\s+/gu, "");
}

/** 剪贴板里要当图片存的文件；不接手（没有图片，或文字部分有实质内容）为 null。 */
export function imageFilesOf(data: Clipboard): File[] | null {
    const files = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return null;
    const names = new Set(files.map((file) => file.name));
    const lines = data.getData("text/plain").split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "");
    // 文件管理器复制文件时的文字：文件名、路径或 file:// 地址。
    const isFileLine = (line: string): boolean => names.has(line) || FILE_URL.test(line) || names.has(line.split(/[\\/]/u).at(-1) ?? "");
    if (!lines.every(isFileLine)) return null;
    if (htmlText(data.getData("text/html")) !== "") return null;
    return files;
}

interface Placeholder {
    readonly id: string;
    readonly count: number;
}

const key = new PluginKey<DecorationSet>("markdownImagePaste");

type Meta = {readonly add: Placeholder & {readonly pos: number}} | {readonly move: {readonly id: string; readonly pos: number}} | {readonly remove: string};

/** 占位挂件：`side: 1`，在它的位置插入内容时挂件被推到内容之后，所以连着插几张图，占位总在最后一张的后面。 */
function widgetFor(host: MarkdownViewHost, placeholder: Placeholder, pos: number): Decoration {
    return Decoration.widget(pos, () => {
        const element = document.createElement("span");
        element.className = "nb-markdown-image-uploading";
        element.contentEditable = "false";
        element.setAttribute("data-image-uploading", placeholder.id);
        element.textContent = markdownTextIn(host.context).t("imagePaste.uploading", {count: placeholder.count});
        return element;
    }, {side: 1, id: placeholder.id, key: placeholder.id, count: placeholder.count});
}

const positionOf = (state: EditorState, id: string): number | null => key.getState(state)?.find(undefined, undefined, (spec) => spec.id === id)[0]?.from ?? null;

let counter = 0;

export const MarkdownImagePaste = Extension.create<{host: MarkdownViewHost | null}>({
    name: "markdownImagePaste",

    addOptions() {
        return {host: null};
    },

    addProseMirrorPlugins() {
        const {host} = this.options;
        if (host === null) return [];
        /** 还在传的一次粘贴：占位 id 与放弃它的控制器。 */
        const jobs = new Map<string, AbortController>();

        /** 把一张传好的图插进占位处；占位不在、位置放不下为 false。 */
        const place = (view: EditorView, id: string, node: PMNode, layout: "inline" | "paragraphs"): boolean => {
            const pos = positionOf(view.state, id);
            if (pos === null || !view.editable) return false;
            const $pos = view.state.doc.resolve(pos);
            const {tr} = view.state;
            // 各占一段：第一张放进占位所在的空段落，之后每张放进它后面新建的段落，占位随之挪到最后一张的后面。
            if (layout === "paragraphs" && $pos.parent.childCount > 0) {
                const paragraph = view.state.schema.nodes.paragraph;
                if (paragraph === undefined) return false;
                const after = $pos.after();
                tr.insert(after, paragraph.create(null, node));
                tr.setMeta(key, {move: {id, pos: after + 1 + node.nodeSize}} satisfies Meta);
            } else {
                if (!$pos.parent.canReplaceWith($pos.index(), $pos.index(), node.type)) return false;
                tr.insert(pos, node);
            }
            view.dispatch(tr.scrollIntoView());
            return true;
        };

        const run = async (view: EditorView, id: string, files: readonly File[], layout: "inline" | "paragraphs", controller: AbortController): Promise<void> => {
            const images = host.images;
            if (images === undefined) return;
            /** 传完了没有插入的：图在作品里，告诉用户。 */
            const notInserted = (file: File, address: string): void => images.failed({file: file.name, code: "not-inserted", detail: address, stored: true});
            try {
                for (const file of files) {
                    if (controller.signal.aborted) break;
                    const result = await images.upload(file, controller.signal);
                    if (!result.ok) {
                        images.failed({file: file.name, code: result.code, detail: result.detail, stored: result.code === "unknown-outcome" || result.code === "cancelled" || result.code === "network"});
                        continue;
                    }
                    // 插入那一刻的地址：传的过程中文件可能被改名或移动。
                    const src = relativeTarget(host.base(), result.address, host.chips.targets) ?? result.address;
                    const type = view.state.schema.nodes.image;
                    const node = type === undefined ? null : imageNode(type, {src, alt: result.alt});
                    if (node === null || controller.signal.aborted || !place(view, id, node, layout)) {
                        // 占位没了（换了文档）、变只读或被放弃：这张已经在作品里，没传的不再传。
                        controller.abort();
                        notInserted(file, result.address);
                    }
                }
            } finally {
                jobs.delete(id);
                if (!view.isDestroyed && positionOf(view.state, id) !== null) view.dispatch(view.state.tr.setMeta(key, {remove: id} satisfies Meta));
            }
        };

        return [
            new Plugin<DecorationSet>({
                key,
                state: {
                    init: () => DecorationSet.empty,
                    apply(tr, set) {
                        const mapped = set.map(tr.mapping, tr.doc);
                        const meta = tr.getMeta(key) as Meta | undefined;
                        if (meta === undefined) return mapped;
                        if ("add" in meta) return mapped.add(tr.doc, [widgetFor(host, meta.add, meta.add.pos)]);
                        const target = "remove" in meta ? meta.remove : meta.move.id;
                        const found = mapped.find(undefined, undefined, (spec) => spec.id === target);
                        const without = mapped.remove(found);
                        if ("remove" in meta) return without;
                        const old = found[0];
                        const count = Number((old?.spec as {count?: number} | undefined)?.count ?? 0);
                        return without.add(tr.doc, [widgetFor(host, {id: target, count}, meta.move.pos)]);
                    },
                },
                props: {
                    decorations: (state) => key.getState(state),
                    handlePaste(view, event) {
                        const images = host.images;
                        const data = event.clipboardData;
                        if (images === undefined || data === null || !view.editable) return false;
                        // 纯文字粘贴（Ctrl+Shift+V）：ProseMirror 记在 `input.shiftKey`，不接手图片。
                        if ((view as unknown as {input?: {shiftKey?: boolean}}).input?.shiftKey === true) return false;
                        // 同步取出文件：事件结束后剪贴板的内容就清空了。
                        const files = imageFilesOf(data);
                        if (files === null) return false;
                        event.preventDefault();
                        const {selection} = view.state;
                        const probe = view.state.schema.nodes.image;
                        const $from = selection.$from;
                        if (probe === undefined || !selection.$from.sameParent(selection.$to) || !$from.parent.inlineContent || !$from.parent.canReplaceWith($from.index(), selection.$to.index(), probe)) {
                            for (const file of files) images.failed({file: file.name, code: "not-allowed-here", detail: "这里不能插入图片", stored: false});
                            return true;
                        }
                        const layout = imageLayout(view.state, files.length);
                        const id = `image-paste-${String(++counter)}`;
                        const {tr} = view.state;
                        tr.deleteSelection();
                        tr.setMeta(key, {add: {id, count: files.length, pos: tr.selection.from}} satisfies Meta);
                        view.dispatch(tr);
                        const controller = new AbortController();
                        jobs.set(id, controller);
                        void run(view, id, files, layout, controller);
                        return true;
                    },
                },
                view: () => ({
                    // 换了文档（新状态里没有占位）、编辑器销毁：放弃还在传的。
                    update(view) {
                        for (const [id, controller] of jobs) if (positionOf(view.state, id) === null) controller.abort();
                    },
                    destroy() {
                        for (const controller of jobs.values()) controller.abort();
                    },
                }),
            }),
        ];
    },
});
