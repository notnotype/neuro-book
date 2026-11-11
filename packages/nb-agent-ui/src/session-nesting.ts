/**
 * 会话面板里子会话挂在父会话下（docs/specs/ui/agent-conversation-view.md“会话面板的子会话”）：把宿主给的平铺条目按 `parentId` 组成树，
 * 算出哪些父会话要自动展开。只给渲染层用。
 */

import type {AgentSessionListItem} from "./types";

export type SessionNode = {readonly item: AgentSessionListItem; readonly children: readonly SessionNode[]};

/** 平铺条目组成树，保持宿主给的顺序；父会话不在条目里的子会话不列出（宿主过滤命中子会话时会把它的祖先一并交进来，带 `dimmed`）。 */
export function nestSessions(items: readonly AgentSessionListItem[]): SessionNode[] {
    const present = new Set(items.map((item) => item.id));
    const children = new Map<string, AgentSessionListItem[]>();
    for (const item of items) {
        if (item.parentId === undefined || !present.has(item.parentId)) continue;
        const list = children.get(item.parentId) ?? [];
        list.push(item);
        children.set(item.parentId, list);
    }
    const reached = new Set<string>();
    const build = (item: AgentSessionListItem): SessionNode => {
        reached.add(item.id);
        return {item, children: (children.get(item.id) ?? []).filter((child) => !reached.has(child.id)).map(build)};
    };
    const nodes = items.filter((item) => item.parentId === undefined).map(build);
    // 父子关系成环（数据坏了）时没有根能到它们：按根列出，不让它们消失。父会话不在条目里的不算。
    for (const item of items) if (!reached.has(item.id) && item.parentId !== undefined && present.has(item.parentId)) nodes.push(build(item));
    return nodes;
}

/**
 * 要自动展开的会话：选中会话的祖先、`expandFor` 列出的会话的祖先，以及有后代在等用户的（`childWaiting`）。宿主据此在这些输入变化时
 * 展开一次，之后用户手动的优先。
 */
export function autoExpanded(items: readonly AgentSessionListItem[], selectedId: string | null, expandFor: readonly string[] = []): Set<string> {
    const byId = new Map(items.map((item) => [item.id, item]));
    const result = new Set<string>();
    const ancestors = (id: string) => {
        const seen = new Set<string>();
        let parent = byId.get(id)?.parentId;
        while (parent !== undefined && byId.has(parent) && !seen.has(parent)) {
            seen.add(parent);
            result.add(parent);
            parent = byId.get(parent)?.parentId;
        }
    };
    if (selectedId !== null) ancestors(selectedId);
    for (const id of expandFor) ancestors(id);
    for (const item of items) if (item.childWaiting === true && (item.childCount ?? 0) > 0) result.add(item.id);
    return result;
}
