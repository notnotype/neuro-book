/**
 * 拖动标签（docs/specs/workbench/editor.md 输出 55）：来源是标签主体（`[data-editor-tab]`；状态位的按钮带
 * `data-editor-tab-action`，不起拖），落点按这一刻的布局算（`resolveTabDrop`）：标签条里是插入位，正文区里是四边拆分或中央移入。
 * 手势是 nb-layout 的拖动会话（docs/specs/ui/layout-drag.md），这里只给来源、落点与结构键。
 *
 * 结构键由宿主给（组、各组标签与固定状态、多行设置）：之后结构变了整场取消，只是几何变了（窗口尺寸、滚动、换行）时按当下坐标
 * 重算落点。
 */

import {createDragSession, dropTargetAt} from "@notnotype/nb-layout/vue";
import type {DragSession, DropFeedbackPreview} from "@notnotype/nb-layout/vue";
import {defineDropKind, resolveGridEdgeDrop, resolveListInsertion} from "@notnotype/nb-layout";
import type {GridDropRect} from "@notnotype/nb-layout";

import type {GroupEdge, TabPlace} from "./groups/groups";

/** 标签拖到编辑组：编辑组登记这个落点，给出组 id。 */
export const EDITOR_GROUP_TAB = defineDropKind<{readonly group: string}>("nbook.editor.group.tab");

/** 被拖的标签与它所在的组。 */
export interface TabDragSource {
    readonly tabId: string;
    readonly group: string;
}

/** 放下要做的事：移到某组的某个位置，或在某组的一边拆出新组。 */
export type TabDropAction =
    | {readonly kind: "move"; readonly tabId: string; readonly place: TabPlace}
    | {readonly kind: "split"; readonly tabId: string; readonly group: string; readonly edge: GroupEdge};

/** 一个落点：`action` 为 null 时只显示、不提交（放回原位、拆不出东西）。 */
export interface TabDrop {
    readonly action: TabDropAction | null;
    readonly preview: DropFeedbackPreview;
    /** 提示文字的种类，宿主按界面语言翻译。 */
    readonly label: "move" | "split-left" | "split-right" | "split-top" | "split-bottom" | "keep";
}

export interface TabDragHost {
    /** 此刻的结构键：组、各组标签 id 与固定状态、多行设置。起拖后它变了，整场取消。 */
    structure(): string;
    /** 放下且与最后显示的落点相同：提交。 */
    commit(action: TabDropAction): void;
}

const rectOf = (element: Element): GridDropRect => {
    const box = element.getBoundingClientRect();
    return {left: box.left, top: box.top, right: box.right, bottom: box.bottom};
};

/** 标签条里一条看得见的行：属于哪一类（固定或普通）、行里的标签按呈现顺序、整个分区的完整顺序。 */
interface Line {
    readonly partition: "pinned" | "normal";
    readonly rect: GridDropRect;
    readonly members: ReadonlyArray<{readonly id: string; readonly rect: GridDropRect; readonly pinned: boolean}>;
}

/** 标签条的行：多行时普通标签那一行（一个元素）会折成几条，按标签的顶边分开。 */
function linesOf(strip: HTMLElement): Line[] {
    const lines: Line[] = [];
    const stripRect = rectOf(strip);
    for (const row of strip.querySelectorAll<HTMLElement>("[data-row]")) {
        const frames = [...row.querySelectorAll<HTMLElement>("[data-editor-tab]")].map((tab) => ({id: tab.dataset.editorTab as string, rect: rectOf(tab.parentElement as HTMLElement), pinned: tab.hasAttribute("data-editor-tab-pinned")}));
        const byTop = new Map<number, typeof frames>();
        for (const frame of frames) {
            const key = Math.round(frame.rect.top);
            byTop.set(key, [...(byTop.get(key) ?? []), frame]);
        }
        const rowRect = rectOf(row);
        for (const [, members] of [...byTop].sort(([a], [b]) => a - b)) {
            const top = Math.min(...members.map((member) => member.rect.top));
            const bottom = Math.max(...members.map((member) => member.rect.bottom));
            lines.push({partition: row.dataset.row === "pinned" ? "pinned" : "normal", rect: {left: Math.max(stripRect.left, rowRect.left), right: Math.min(stripRect.right, rowRect.right), top, bottom}, members});
        }
        // 空的行（多行时没有普通标签）：整行是一个插入位。
        if (frames.length === 0) lines.push({partition: row.dataset.row === "pinned" ? "pinned" : "normal", rect: rowRect, members: []});
    }
    return lines;
}

/**
 * 指针下的落点（纯读 DOM 的几何，不改任何东西）。`top` 是指针处最上层的业务元素（会话给的），`dragged` 是被拖的标签与它所在的组。
 */
export function resolveTabDrop(root: HTMLElement, top: Element | null, point: {readonly x: number; readonly y: number}, dragged: TabDragSource): TabDrop | null {
    const target = dropTargetAt(top, EDITOR_GROUP_TAB);
    if (top === null || target === null || !root.contains(target.element)) return null;
    const groupElement = target.element as HTMLElement;
    const group = target.data.group;
    const strip = groupElement.querySelector<HTMLElement>("[data-editor-tabs]");
    const header = strip?.parentElement ?? null;
    // 标签条（含它右侧的标题动作那一块）：插入位。
    if (strip !== null && header !== null && header.contains(top)) return stripDrop(strip, point, dragged, group);
    const content = groupElement.querySelector<HTMLElement>("[data-editor-content]");
    if (content === null || !content.contains(top)) return null;
    return contentDrop(groupElement, content, point, dragged, group);
}

function stripDrop(strip: HTMLElement, point: {readonly x: number; readonly y: number}, dragged: TabDragSource, group: string): TabDrop | null {
    const lines = linesOf(strip);
    if (lines.length === 0) return null;
    // 先按纵向距离选行（在行里的距离为 0），再在行里求插入位。
    const distance = (line: Line): number => (point.y < line.rect.top ? line.rect.top - point.y : point.y > line.rect.bottom ? point.y - line.rect.bottom : 0);
    const line = lines.reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best));
    const containerRect = {...line.rect, left: Math.min(line.rect.left, point.x), right: Math.max(line.rect.right, point.x)};
    const insertion = resolveListInsertion({orientation: "horizontal", point: {x: point.x, y: (line.rect.top + line.rect.bottom) / 2}, containerRect, members: line.members.map(({id, rect}) => ({id, rect}))});
    if (insertion === null) return null;
    /** 完整顺序（含滚出视口的、折到别的行的），按呈现顺序。 */
    const all = [...strip.querySelectorAll<HTMLElement>("[data-editor-tab]")].map((tab) => ({id: tab.dataset.editorTab as string, pinned: tab.hasAttribute("data-editor-tab-pinned"), rect: rectOf(tab.parentElement as HTMLElement)}));
    let before = insertion.beforeId;
    let indicator = insertion.indicator;
    let partition: "pinned" | "normal";
    if (before !== null) {
        // 单行时固定与普通同在一行：插在固定标签前面才算进固定区。
        partition = line.partition === "pinned" || all.find((tab) => tab.id === before)?.pinned === true ? "pinned" : "normal";
    } else {
        // 行尾的插入位：共享算法只认这一行看得见的成员，`null` 只是“最后一个看得见的之后”。换算成完整顺序里它的后继
        // （滚出视口的、折到下一行的都算），后继看得见时线画在它前面（换行处归一到下一行行首）；没有后继才是分区末尾。
        const visible = line.members.filter((member) => member.rect.right > containerRect.left && member.rect.left < containerRect.right);
        const after = visible.at(-1);
        partition = line.partition === "pinned" || after?.pinned === true ? "pinned" : "normal";
        const inPartition = all.filter((tab) => tab.pinned === (partition === "pinned"));
        const successor = after === undefined ? undefined : inPartition[inPartition.findIndex((tab) => tab.id === after.id) + 1];
        if (successor !== undefined) {
            before = successor.id;
            const view = rectOf(strip);
            if (successor.rect.left >= view.left && successor.rect.right <= view.right && successor.rect.top >= view.top && successor.rect.bottom <= view.bottom) indicator = {left: successor.rect.left - 1, right: successor.rect.left + 1, top: successor.rect.top, bottom: successor.rect.bottom};
        }
    }
    const place: TabPlace = {group, partition, before};
    // 放回原位：同组、同区，插入位就在它自己的前面或后面。
    const order = all.filter((tab) => tab.pinned === (partition === "pinned")).map((tab) => tab.id);
    const index = order.indexOf(dragged.tabId);
    const insertAt = before === null ? order.length : order.indexOf(before);
    const inPlace = group === dragged.group && index >= 0 && (insertAt === index || insertAt === index + 1);
    return {
        action: inPlace ? null : {kind: "move", tabId: dragged.tabId, place},
        preview: {areaRect: null, entryRect: null, indicator, orientation: "horizontal", armed: !inPlace},
        label: inPlace ? "keep" : "move",
    };
}

function contentDrop(groupElement: HTMLElement, content: HTMLElement, point: {readonly x: number; readonly y: number}, dragged: TabDragSource, group: string): TabDrop | null {
    const rect = rectOf(content);
    const zone = resolveGridEdgeDrop({point, rect});
    if (zone === null) return null;
    const groupRect = rectOf(groupElement);
    if (zone === "center") {
        // 普通区的最后一个（固定标签拖到中央是取消固定，不是原位）。
        const tabs = [...groupElement.querySelectorAll<HTMLElement>("[data-editor-tab]:not([data-editor-tab-pinned])")];
        const last = tabs.at(-1)?.dataset.editorTab;
        // 移到这一组普通标签的末尾；已经在那里（同组且是最后一个）就是原位。
        const inPlace = group === dragged.group && last === dragged.tabId;
        return {
            action: inPlace ? null : {kind: "move", tabId: dragged.tabId, place: {group, partition: "normal", before: null}},
            preview: {areaRect: groupRect, entryRect: null, indicator: null, orientation: "horizontal", armed: !inPlace},
            label: inPlace ? "keep" : "move",
        };
    }
    const width = groupRect.right - groupRect.left;
    const height = groupRect.bottom - groupRect.top;
    const half: GridDropRect = zone === "left" ? {...groupRect, right: groupRect.left + width / 2}
        : zone === "right" ? {...groupRect, left: groupRect.left + width / 2}
            : zone === "top" ? {...groupRect, bottom: groupRect.top + height / 2}
                : {...groupRect, top: groupRect.top + height / 2};
    // 源组只有这一个标签又拆它自己：拆不出东西。
    const alone = group === dragged.group && groupElement.querySelectorAll("[data-editor-tab]").length === 1;
    return {
        action: alone ? null : {kind: "split", tabId: dragged.tabId, group, edge: zone},
        preview: {areaRect: half, entryRect: null, indicator: null, orientation: zone === "left" || zone === "right" ? "horizontal" : "vertical", armed: !alone},
        label: alone ? "keep" : `split-${zone}`,
    };
}

/**
 * 装在编辑器区的根上。按下在冒泡阶段接：组与组之间分隔线的手势在捕获阶段拿下它命中带里的按下并停止传播，所以落在分隔线上的
 * 按下是调整大小，不会再起一场标签拖动。
 */
export function createTabDrag(root: HTMLElement, host: TabDragHost): DragSession<TabDragSource, TabDrop> {
    return createDragSession<TabDragSource, TabDrop>({
        root,
        sourceAt: (target) => {
            if (target.closest("[data-editor-tab-action]") !== null) return null;
            const tab = target.closest<HTMLElement>("[data-editor-tab]");
            const group = dropTargetAt(tab, EDITOR_GROUP_TAB)?.data.group;
            return tab === null || group === undefined || !root.contains(tab) ? null : {tabId: tab.dataset.editorTab as string, group};
        },
        structure: () => host.structure(),
        resolve: ({source, point, top}) => resolveTabDrop(root, top, point, source),
        actionKey: (drop) => (drop.action === null ? null : JSON.stringify(drop.action)),
        commit: (drop) => {
            if (drop.action !== null) host.commit(drop.action);
        },
        onActiveChange: (active) => root.toggleAttribute("data-editor-tab-dragging", active),
    });
}
