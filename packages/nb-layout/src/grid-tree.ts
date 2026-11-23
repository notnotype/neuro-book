/**
 * 拆分树的两个纯工具：按 id 查找与克隆。
 *
 * 结构操作（`grid.ts`）与手势预览（`grid-gesture.ts`）都要在树上查节点、在副本上试写意图，两处共用这一份，
 * 免得“克隆要拷哪几层”这类规则各写一遍后走样。
 */
import type {GridBranch, GridNode} from "./grid-types";

/** 查找结果：命中的节点与它的父分支（根节点的父是 null）。 */
export type GridHit<T> = {node: GridNode<T>; parent: GridBranch<T> | null};

/** 从 `node` 起深度优先找 `id`；`parent` 是 `node` 自己的父分支。 */
export function findInTree<T>(id: string, node: GridNode<T>, parent: GridBranch<T> | null = null): GridHit<T> | null {
    if (node.id === id) {
        return {node, parent};
    }
    if (node.kind === "branch") {
        for (const child of node.children) {
            const hit = findInTree(id, child, node);
            if (hit) {
                return hit;
            }
        }
    }
    return null;
}

/** 克隆一棵可写的副本：结构与三组尺寸各拷一份；`ref` 与 `collapse` 对象与原树共用，所以副本上改收起状态要整个替换 `collapse`，不能改它的字段。 */
export function cloneNode<T>(node: GridNode<T>): GridNode<T> {
    return node.kind === "leaf"
        ? {...node, size: {...node.size}, minimumSize: {...node.minimumSize}, maximumSize: {...node.maximumSize}}
        : {...node, size: {...node.size}, minimumSize: {...node.minimumSize}, maximumSize: {...node.maximumSize}, children: node.children.map(cloneNode)};
}
