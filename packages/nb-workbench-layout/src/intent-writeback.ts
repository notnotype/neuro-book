/**
 * 意图回写（docs/specs/ui/workbench-layout.md 输出 8、49）：把呈现尺寸写回布局文档的尺寸意图，只有两个时机，各一个入口。
 *
 * - 手势落账后：`applyGestureCommit`。收起状态记到区域的锚上、拉开隐藏的区域时清掉隐藏、这次没动的保留像素节点不写，再写回意图。
 * - 结构操作之前：`rebaseForOperation`。保留像素的节点不写。
 *
 * 入口只导出这两个（`index.ts`）。底下的 `rebaseIntents` 要宿主自己备齐 `collapsedTo` 与“哪些节点不写”，漏一个不报错，只是过一会儿布局不对
 * （t26 深度审查 api-03），所以不从入口导出；测试从本模块直接导入。
 */

import type {GridExtent, GridFailure, GridNodeInput, GridSnapshotNode} from "@notnotype/nb-layout";
import {axisOf, barOfRef, holdsEditor, isSectionCollapsed, setPanelCollapsed, setPanelHidden} from "./layout-doc";
import type {LayoutDoc, LayoutFailureCode} from "./layout-doc";
import type {LayoutProjection} from "./layout-project";

/**
 * 手势前后两份布局里，差不到这个值就算这次没动。两份都来自 nb-layout 的 `layout()`，没有经过 DOM 取整；0.5 是从工作台原来的写法搬来的，
 * 来由没有记录（推断是给浮点误差留的余量）。
 */
const UNTOUCHED_TOLERANCE_PX = 0.5;

/** 被文档拒绝、跳过了的收起或显隐写入：`id` 是要写的面板（区域写在锚上时是锚）。 */
export type IntentWritebackRejection = {readonly id: string; readonly failure: GridFailure<LayoutFailureCode>};

/**
 * 手势落账后写回文档（输出 49）。`before` 是手势开始时呈现的布局（`useGridHost` 的 `onApplied` 第二个参数），`after` 是落账之后的。
 *
 * 先改收起状态再写回意图：这次收起的面板，呈现尺寸是标题行或零，不是意图（`rebaseIntents` 跳过收起的面板）。
 * 网格报的是呈现树的节点 id；区域拖到零报的是代表区域的那个节点，状态记在锚上（输出 11），对那个 id 记的话，只显示一节时会把这一节标成收成标题行。
 * 隐藏的区域按拖到零画（`hiddenRegionsAtZero`）：从那条边界拉开就是显示，隐藏一起清掉（输出 11、12）。
 * 收起或显隐被文档拒绝时跳过这一项、照常写回尺寸，逐项交回 `rejected`：一项被拒不该连带丢掉这次手势的尺寸。
 */
export function applyGestureCommit(doc: LayoutDoc, projection: LayoutProjection, gesture: {
    readonly before: Readonly<Record<string, GridExtent>>;
    readonly after: Readonly<Record<string, GridExtent>>;
    readonly collapsed: Readonly<Record<string, boolean>>;
}): {readonly doc: LayoutDoc; readonly rejected: readonly IntentWritebackRejection[]} {
    const same = (left: GridExtent | undefined, right: GridExtent | undefined): boolean =>
        left !== undefined && right !== undefined && Math.abs(left.width - right.width) < UNTOUCHED_TOLERANCE_PX && Math.abs(left.height - right.height) < UNTOUCHED_TOLERANCE_PX;
    // 这次没动的保留像素节点：呈现尺寸还是压缩的结果，不是意图（输出 8）。
    const untouched = new Set([...fixedNodesOf(projection.input)].filter((id) => same(gesture.before[id], gesture.after[id])));
    const rejected: IntentWritebackRejection[] = [];
    let next = doc;
    for (const [id, value] of Object.entries(gesture.collapsed)) {
        const anchor = projection.regionAnchors.get(id);
        const target = anchor ?? id;
        const updated = setPanelCollapsed(next, target, value);
        if (updated.ok) next = updated.doc;
        else rejected.push({id: target, failure: updated});
        if (anchor === undefined || value || next.panels[anchor]?.hidden !== true) continue;
        const shown = setPanelHidden(next, anchor, false);
        if (shown.ok) next = shown.doc;
        else rejected.push({id: anchor, failure: shown});
    }
    return {doc: rebaseIntents(next, gesture.after, projection.collapsedTo, untouched), rejected};
}

/** 结构操作之前把此刻呈现的尺寸写回意图（输出 8、49）；保留像素的节点不写：不在手势里，它们的呈现只可能是被压缩了，窗口变大要回到原样。 */
export function rebaseForOperation(doc: LayoutDoc, projection: LayoutProjection, presented: Readonly<Record<string, GridExtent>>): LayoutDoc {
    return rebaseIntents(doc, presented, projection.collapsedTo, fixedNodesOf(projection.input));
}

/** 呈现树里保留像素的节点：它们的呈现尺寸小于意图，只可能是放不下被压缩了（输出 7、8）。 */
export function fixedNodesOf(root: GridNodeInput<string>): ReadonlySet<string> {
    const fixed = new Set<string>();
    const visit = (node: GridNodeInput<string>): void => {
        if (node.kind === "leaf") return;
        for (const child of node.children) {
            if (child.sizing === "fixed") fixed.add(child.id);
            visit(child);
        }
    };
    visit(root);
    return fixed;
}

/**
 * 把呈现尺寸写回意图：手势落账后、结构操作之前调。`collapsedTo` 是呈现里塌陷掉的分支由谁代表（`projectLayoutDoc` 给），它们的尺寸就是幸存者的。
 * 不写的：呈现为零的轴；收起的面板（`isSectionCollapsed`；纵向收成标题行时呈现高度是面板头，不是展开尺寸）；条（厚度不是意图）。
 *
 * 全是工具面板的分支按比例分（`projectLayoutDoc`）：里面有收起或隐藏的兄弟时，其余的呈现尺寸是占了它们的空间之后的，直接写进去，兄弟回来时比例就错了，展开只回到一部分。
 * 所以这些子节点只更新彼此的比例，总量保持原来的份额。含编辑组的分支不用：工具面板保留像素，余量归编辑组。
 */
export function rebaseIntents(doc: LayoutDoc, sizes: Readonly<Record<string, GridExtent>>, collapsedTo: ReadonlyMap<string, string> = new Map(), frozen: ReadonlySet<string> = new Set()): LayoutDoc {
    const sizeOfNode = (node: GridSnapshotNode): GridExtent | undefined => sizes[node.id] ?? sizes[collapsedTo.get(node.id) ?? ""];
    // `frozen`：呈现尺寸不是意图的节点。保留像素的节点只会被压缩，不会自己变（输出 8）；由调用方给，因为谁保留像素是呈现树决定的。
    const isFrozen = (node: GridSnapshotNode): boolean => frozen.has(node.id) || frozen.has(collapsedTo.get(node.id) ?? "");
    const isSkipped = (node: GridSnapshotNode): boolean => isFrozen(node) || (node.kind === "leaf" && (barOfRef(node.ref) !== null || isSectionCollapsed(doc, node.id)));

    const write = (node: GridSnapshotNode): GridSnapshotNode => {
        const size = isSkipped(node) ? undefined : sizeOfNode(node);
        const nextSize = size === undefined ? node.size : {width: size.width > 0 ? size.width : node.size.width, height: size.height > 0 ? size.height : node.size.height};
        if (node.kind === "leaf") return {...node, size: nextSize};
        const children = node.children.map(write);
        const main = axisOf(node.orientation);
        const away = (child: GridSnapshotNode): boolean => isSkipped(child) || sizeOfNode(child) === undefined;
        if (!node.children.some(away) || holdsEditor(doc, node)) return {...node, size: nextSize, children};
        const present = node.children.filter((child) => !away(child));
        const before = present.reduce((sum, child) => sum + child.size[main], 0);
        const after = children.filter((_, index) => !away(node.children[index] as GridSnapshotNode)).reduce((sum, child) => sum + child.size[main], 0);
        const scale = before > 0 && after > 0 ? before / after : 1;
        return {...node, size: nextSize, children: children.map((child, index) => (away(node.children[index] as GridSnapshotNode) ? child : {...child, size: {...child.size, [main]: child.size[main] * scale}}))};
    };
    return {...doc, tree: {...doc.tree, root: write(doc.tree.root)}};
}
