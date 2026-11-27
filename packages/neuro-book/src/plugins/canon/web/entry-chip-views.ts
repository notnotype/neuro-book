/**
 * 富文本编辑器里小块的画法（canon/author-ui.md 输出 48）：标签节点与条件节点的节点视图，值经 `Decoration.node` 挂在节点上（`spec.values`，
 * 随事务映射位置，不进文档与撤销历史）。显示什么由 `entry-chip.ts` 的 `chipOf` 算，与阅读视图同一份判断。
 *
 * 外面一层透明的壳、里面才是小块：光标停在小块后面时，DOM 里的位置是“段落的第 n 个子节点前”，Chrome 贴着前面最后一段文字画光标；
 * 那段文字若在小块里，光标就画在值里面。壳的末尾放一个细空格当尾巴，光标贴着它画，落在小块与后文之间的空隙里；壳整个不可编辑
 * （w00055 t01 spike 开发者试过的做法，坑记在 nb-ui 设计语言第 79 条）。
 */

import type {JSONContent} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import type {EditorState} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
import type {EditorView, NodeView, NodeViewConstructor} from "@tiptap/pm/view";

import type {EntryTextValue} from "./components/text/entry-text";
import {chipOf} from "./entry-chip";
import type {ChipContext, ChipModel} from "./entry-chip";
import {ENTRY_IF_NODE, ENTRY_TAG_NODE} from "./entry-syntax";
import type {EntryIfBranch} from "./entry-syntax";
import {alignValues, tagHasValue} from "./entry-values";
import type {TagValue} from "./entry-values";

/** 节点视图向宿主要的东西：小块的上下文（字段、改过、正在算、界面文字）与“显示全部分支”。 */
export interface ChipHost {
    context(): ChipContext;
    showBranches(): boolean;
    /** 条件小块的说明文字：没有一支成立、未知；`named` 拼读屏名字（种类、显示名、值与状态，标点随语言）。 */
    words(): {readonly noBranch: string; readonly unknown: string; readonly condition: string; named: ChipNamer};
}

/** 读屏名字里要说的：种类、显示名、显示的值（条件没有）、状态与“改过”。 */
export type ChipName = Pick<ChipModel, "kind" | "label" | "state" | "changed"> & {readonly text: string | null};
export type ChipNamer = (chip: ChipName) => string;

export const entryValuesKey = new PluginKey<DecorationSet>("canonEntryValues");

/** 挂值的插件：状态是一组节点装饰，文档变了随之映射；`setEntryValues` 整组换掉。 */
export function entryValuesPlugin(): Plugin<DecorationSet> {
    return new Plugin<DecorationSet>({
        key: entryValuesKey,
        state: {
            init: () => DecorationSet.empty,
            apply: (tr, set) => (tr.getMeta(entryValuesKey) as DecorationSet | undefined) ?? set.map(tr.mapping, tr.doc),
        },
        props: {decorations: (state) => entryValuesKey.getState(state)},
    });
}

/** 一个节点带着哪些标签（按先后、只算该有值的）：标签节点是它自己，条件是开标签、各支起头的标签与支里的标签。 */
function tagsOf(node: PMNode): string[] {
    if (node.type.name === ENTRY_TAG_NODE) return [node.attrs.source as string].filter(tagHasValue);
    const tags: string[] = [];
    const fromJSON = (nodes: readonly JSONContent[]): void => {
        for (const child of nodes) {
            if (child.type === ENTRY_TAG_NODE) tags.push(String(child.attrs?.source ?? ""));
            else if (child.content !== undefined) fromJSON(child.content);
        }
    };
    tags.push(node.attrs.open as string);
    for (const branch of node.attrs.branches as readonly EntryIfBranch[]) {
        if (branch.head !== null) tags.push(branch.head);
        fromJSON(branch.content);
    }
    return tags.filter(tagHasValue);
}

/**
 * 把一版值对到此刻的文档上，交回整组装饰（`entry-values.ts` 的对齐）。对不上的标签不挂值：小块按 `chipOf` 显示“计算中”或这一页已读到的值。
 */
export function valueDecorations(state: EditorState, sequence: readonly TagValue[]): DecorationSet {
    const nodes: Array<{node: PMNode; at: number; tags: string[]}> = [];
    state.doc.descendants((node, at) => {
        if (node.type.name === ENTRY_TAG_NODE || node.type.name === ENTRY_IF_NODE) {
            nodes.push({node, at, tags: tagsOf(node)});
            return false;
        }
        return true;
    });
    const aligned = alignValues(nodes.flatMap((item) => item.tags), sequence);
    let cursor = 0;
    const decorations = nodes.map(({node, at, tags}) => {
        const values = aligned.slice(cursor, cursor + tags.length);
        cursor += tags.length;
        return Decoration.node(at, at + node.nodeSize, {}, {values});
    });
    return DecorationSet.create(state.doc, decorations);
}

/** 整组换掉挂在小块上的值：不改文档、不进撤销历史。 */
export function setEntryValues(view: EditorView, set: DecorationSet): void {
    view.dispatch(view.state.tr.setMeta(entryValuesKey, set).setMeta("addToHistory", false));
}

const valuesIn = (decorations: readonly Decoration[]): ReadonlyArray<EntryTextValue | undefined> => {
    for (const decoration of decorations) {
        const values = (decoration.spec as {values?: ReadonlyArray<EntryTextValue | undefined>}).values;
        if (values !== undefined) return values;
    }
    return [];
};

/** 壳：不可编辑，末尾一个细空格。 */
function shell(): {dom: HTMLElement; face: HTMLElement} {
    const dom = document.createElement("span");
    dom.className = "entry-atom";
    dom.contentEditable = "false";
    const face = document.createElement("span");
    const tail = document.createElement("span");
    tail.className = "entry-atom__tail";
    tail.textContent = String.fromCharCode(0x2009);
    dom.append(face, tail);
    return {dom, face};
}

/** 把小块的样子写到壳与面上：测试与读屏看属性，样子看类名。 */
function paintChip(dom: HTMLElement, face: HTMLElement, model: ChipModel, named: ChipNamer): void {
    dom.dataset.entryChip = model.kind;
    dom.dataset.chipState = model.state;
    if (model.changed === undefined) delete dom.dataset.chipChanged;
    else dom.dataset.chipChanged = model.changed;
    dom.setAttribute("aria-label", named(model));
    dom.title = model.changed === undefined ? model.label : `${model.label}（${model.changed}）`;
    face.className = `entry-chip entry-chip--${model.kind} entry-chip--${model.state}`;
    face.textContent = model.text;
}

/** 标签节点的视图。 */
export function tagView(host: ChipHost): NodeViewConstructor {
    return (initial, _view, _getPos, decorations): NodeView => {
        const {dom, face} = shell();
        // 顶层的小块点了（或选中按 Enter）开浮层：读屏当按钮读。条件里各支的小块不单独开，不给。
        dom.setAttribute("role", "button");
        let node = initial;
        let values = valuesIn(decorations);
        const paint = (): void => paintChip(dom, face, chipOf(node.attrs.source as string, values[0], host.context()), host.words().named);
        paint();
        return {
            dom,
            update: (next, nextDecorations) => {
                if (next.type !== node.type) return false;
                node = next;
                values = valuesIn(nextDecorations);
                paint();
                return true;
            },
            // 小块里没有可编辑的内容：DOM 的变化都不交给 ProseMirror 解析。
            ignoreMutation: () => true,
        };
    };
}

/** 一支的行内内容画成 DOM：文字带强调、代码、删除线；链接只画文字；支里的标签画成小块（值按先后取）。 */
function paintBranch(target: HTMLElement, content: readonly JSONContent[], take: () => EntryTextValue | undefined, context: ChipContext, named: ChipNamer): void {
    for (const child of content) {
        if (child.type === "text") {
            let element: Node = document.createTextNode(child.text ?? "");
            for (const mark of child.marks ?? []) {
                const tag = mark.type === "bold" ? "strong" : mark.type === "italic" ? "em" : mark.type === "code" ? "code" : mark.type === "strike" ? "del" : null;
                if (tag === null) continue;
                const wrapper = document.createElement(tag);
                wrapper.append(element);
                element = wrapper;
            }
            target.append(element);
        } else if (child.type === ENTRY_TAG_NODE) {
            const source = String(child.attrs?.source ?? "");
            const {dom, face} = shell();
            paintChip(dom, face, chipOf(source, tagHasValue(source) ? take() : undefined, context), named);
            target.append(dom);
        } else if (child.type === "hardBreak") target.append(document.createElement("br"));
        else if (child.content !== undefined) paintBranch(target, child.content, take, context, named);
    }
}

/** 条件节点的视图：只画生效的那一支（极淡的底色）；没有一支成立是淡的占位；打开“显示全部分支”时每支都画、没生效的变淡。 */
export function conditionView(host: ChipHost): NodeViewConstructor {
    return (initial, _view, _getPos, decorations): NodeView => {
        const {dom, face} = shell();
        dom.setAttribute("role", "button");
        let node = initial;
        let values = valuesIn(decorations);
        // 上一次画时是不是“显示全部分支”：只有翻开的那一次让没生效的几支淡入，值表到了的重画不重放。
        let shownAll = host.showBranches();
        const paint = (): void => {
            const context = host.context();
            const revealing = host.showBranches() && !shownAll;
            shownAll = host.showBranches();
            const words = host.words();
            const branches = node.attrs.branches as readonly EntryIfBranch[];
            const head = values[0] as Extract<EntryTextValue, {result: unknown}> | undefined;
            const taken = head?.taken ?? null;
            const unknown = head !== undefined && taken === null && values.some((value) => value !== undefined && "result" in value && value.result === null);
            dom.dataset.entryChip = "if";
            dom.dataset.chipState = head === undefined ? (context.computing ? "pending" : "uncomputed") : taken === null ? (unknown ? "unknown" : "no-branch") : "value";
            if (taken === null) delete dom.dataset.chipBranch;
            else dom.dataset.chipBranch = String(taken);
            face.className = `entry-if entry-if--${dom.dataset.chipState}${host.showBranches() ? " entry-if--all" : ""}`;
            face.replaceChildren();
            // 支里的标签按先后取值：值的第 0 项是开标签自己，各支起头的 ElseIf 也占一项。
            let cursor = 1;
            const take = (): EntryTextValue | undefined => values[cursor++];
            branches.forEach((branch, index) => {
                if (branch.head !== null && /^<ElseIf\b/u.test(branch.head)) cursor += 1;
                const part = document.createElement("span");
                part.className = `entry-if__branch${index === taken ? " entry-if__branch--taken" : revealing ? " entry-if__branch--entering" : ""}`;
                part.dataset.branch = String(index);
                paintBranch(part, branch.content, take, context, words.named);
                const shown = host.showBranches() || index === taken;
                if (!shown) part.hidden = true;
                face.append(part);
            });
            if (taken === null && !host.showBranches()) {
                // 值还没回来（或整篇太长不算）时不知道哪一支成立：写“条件”，样子同计算中、没有算的小块。
                const placeholder = document.createElement("span");
                placeholder.className = head === undefined ? `entry-chip entry-chip--if entry-chip--${dom.dataset.chipState}` : "entry-if__placeholder";
                placeholder.textContent = head === undefined ? words.condition : unknown ? words.unknown : words.noBranch;
                face.append(placeholder);
            }
            dom.setAttribute("aria-label", words.named({kind: "if", label: node.attrs.open as string, text: null, state: dom.dataset.chipState as ChipModel["state"]}));
            dom.title = node.attrs.open as string;
        };
        paint();
        return {
            dom,
            update: (next, nextDecorations) => {
                if (next.type !== node.type) return false;
                node = next;
                values = valuesIn(nextDecorations);
                paint();
                return true;
            },
            ignoreMutation: () => true,
        };
    };
}
