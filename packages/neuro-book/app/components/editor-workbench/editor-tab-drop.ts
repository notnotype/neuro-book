import {resolveGridEdgeDrop, resolveListInsertion, type GridDropMember, type GridDropPoint, type GridDropRect} from "@notnotype/nb-ui/layout";
import type {DropFeedbackPreview} from "@notnotype/nb-ui/components";
import type {EditorGroupState, EditorTabPresentation} from "./editor-view.types";
import type {EditorSplitPayload, TabTransferPayload} from "./editor-intents";

export type EditorDragGroup = Pick<EditorGroupState, "id" | "tabs">;
export type EditorTabSource = Readonly<{groupId: string; path: string}>;
export type EditorTabDropAction =
    | {kind: "move"; request: TabTransferPayload}
    | {kind: "transfer"; request: TabTransferPayload}
    | {kind: "split"; request: EditorSplitPayload};
export type EditorTabDrop = {
    /** `null` 表示可见但不可提交的预览：原位插入线与正文中央仍提供反馈。 */
    action: EditorTabDropAction | null;
    preview: DropFeedbackPreview;
    labelKey: string;
    iconClass: string;
};
export type EditorTabDropTarget =
    | {kind: "tabs"; groupId: string; pinned: boolean; wrap?: boolean; rect: GridDropRect; members: readonly GridDropMember[]}
    | {kind: "content"; groupId: string; rect: GridDropRect};

/** 只有语义事实参与失效：标题、脏标记与像素变化不取消；换面、组/标签顺序、固定状态变化取消。 */
export function editorDragStructure(groups: readonly EditorDragGroup[], contextKey: string, revision: number, allowSplit: boolean): string {
    return JSON.stringify([contextKey, revision, allowSplit, groups.map(group => [group.id, group.tabs.map(tab => [tab.path, tab.pinned])])]);
}

function unchangedOrder(tabs: readonly EditorTabPresentation[], source: EditorTabPresentation, beforeId: string | null, pinned: boolean): boolean {
    if (source.pinned !== pinned) return false;
    const partition = tabs.filter(tab => tab.pinned === pinned);
    const from = partition.findIndex(tab => tab.path === source.path);
    const others = partition.filter(tab => tab.path !== source.path);
    const to = beforeId === null ? others.length : others.findIndex(tab => tab.path === beforeId);
    return from === to;
}

/** 多行按纵向距离选一行，再交给共享列表算法求横向插入位；固定标签的高度可以比普通标签略矮。 */
function membersAtRow(members: readonly GridDropMember[], point: GridDropPoint): readonly GridDropMember[] {
    let nearest: GridDropMember | undefined;
    let distance = Infinity;
    for (const member of members) {
        const dy = Math.abs(point.y - (member.rect.top + member.rect.bottom) / 2);
        if (dy < distance) { nearest = member; distance = dy; }
    }
    if (!nearest) return members;
    const row = nearest.rect;
    return members.filter(member => member.rect.top < row.bottom && member.rect.bottom > row.top);
}

/** 单次求值同时给出动作与绘制几何；原位与正文中央照常预览，但不产生提交。 */
export function resolveEditorTabDrop(input: {
    source: EditorTabSource;
    groups: readonly EditorDragGroup[];
    target: EditorTabDropTarget;
    point: GridDropPoint;
    allowSplit: boolean;
}): EditorTabDrop | null {
    const {source, groups, target, point, allowSplit} = input;
    const sourceGroup = groups.find(group => group.id === source.groupId);
    const sourceTab = sourceGroup?.tabs.find(tab => tab.path === source.path);
    const targetGroup = groups.find(group => group.id === target.groupId);
    if (!sourceGroup || !sourceTab || !targetGroup) return null;
    const request: TabTransferPayload = {
        path: source.path, sourceGroupId: source.groupId, targetGroupId: target.groupId,
        targetPath: null, targetPinned: false, position: "after",
    };
    if (target.kind === "tabs") {
        // 单行固定区只通过菜单固定标签，不接受任何拖入；多行固定区是独立落点。
        if (target.pinned && !target.wrap) return null;
        const members = target.wrap ? membersAtRow(target.members, point) : target.members;
        let insertion = resolveListInsertion({orientation: "horizontal", point, containerRect: target.rect, members, edgeGap: 4});
        if (!insertion) return null;
        const pinned = target.pinned;
        let beforeId = insertion.beforeId;
        // 行尾或滚动裁剪尾部不等于分区末尾：按该行最后可见项回到完整分区找后继。
        if (beforeId === null && members.length > 0) {
            const lastVisible = members[members.length - 1]!.id;
            const partition = targetGroup.tabs.filter(tab => tab.pinned === pinned);
            beforeId = partition[partition.findIndex(tab => tab.path === lastVisible) + 1]?.path ?? null;
            // 换行边界仍只有一条线：上一行尾部与下一行首项前半都画在下一行首项前。
            const next = target.members.find(member => member.id === beforeId);
            if (target.wrap && next && !members.includes(next)) {
                insertion = resolveListInsertion({orientation: "horizontal", point: {x: next.rect.left, y: next.rect.top}, containerRect: target.rect, members: [next], edgeGap: 4});
                if (!insertion) return null;
            }
        }
        if (source.groupId === target.groupId && beforeId === source.path) {
            const partition = targetGroup.tabs.filter(tab => tab.pinned === pinned);
            beforeId = partition[partition.findIndex(tab => tab.path === source.path) + 1]?.path ?? null;
        }
        const unchanged = source.groupId === target.groupId && unchangedOrder(targetGroup.tabs, sourceTab, beforeId, pinned);
        request.targetPath = beforeId;
        request.targetPinned = pinned;
        request.position = beforeId === null ? "after" : "before";
        return {
            action: unchanged ? null : {kind: source.groupId === target.groupId ? "move" : "transfer", request},
            preview: {areaRect: null, entryRect: null, indicator: insertion.indicator, orientation: "horizontal"},
            labelKey: unchanged ? "editorWorkbench.dropKeepLayout" : pinned ? "editorWorkbench.dropPinned" : "editorWorkbench.dropTab",
            iconClass: "i-lucide-move",
        };
    }
    // 与旧正文合同一致：宿主不开放分屏时，正文不接收内部标签。
    if (!allowSplit) return null;
    const zone = resolveGridEdgeDrop({point, rect: target.rect});
    if (!zone) return null;
    // 中央承诺「保持当前布局」：整区反馈可见，但没有可提交动作。同组唯一标签也照画——它在这里同样无处可去。
    if (zone === "center") {
        return {
            action: null,
            preview: {areaRect: {...target.rect}, entryRect: null, indicator: null, orientation: "horizontal"},
            labelKey: "editorWorkbench.dropKeepLayout",
            iconClass: "i-lucide-layout-dashboard",
        };
    }
    // 唯一标签留在自己组里没有分组变化，四边依旧拒绝。
    if (source.groupId === target.groupId && sourceGroup.tabs.length === 1) return null;
    const area = {...target.rect};
    const centerX = (area.left + area.right) / 2;
    const centerY = (area.top + area.bottom) / 2;
    if (zone === "left") area.right = centerX;
    if (zone === "right") area.left = centerX;
    if (zone === "top") area.bottom = centerY;
    if (zone === "bottom") area.top = centerY;
    return {
        action: {
            kind: "split", request: {sourceGroupId: source.groupId, targetGroupId: target.groupId, path: source.path, direction: zone, mode: "move"},
        },
        preview: {areaRect: area, entryRect: null, indicator: null, orientation: "horizontal"},
        labelKey: `editorWorkbench.drop${zone[0]!.toUpperCase()}${zone.slice(1)}`,
        iconClass: "i-lucide-panels-top-left",
    };
}

/**
 * 几何变化不改变意图；释放不得偷偷提交与最后一次预览不同的插入位。
 * 两次空动作预览算同一意图——它们都只承诺不改变布局。
 */
export function sameEditorDrop(a: EditorTabDrop | null, b: EditorTabDrop | null): boolean {
    return a !== null && b !== null && JSON.stringify(a.action) === JSON.stringify(b.action);
}
