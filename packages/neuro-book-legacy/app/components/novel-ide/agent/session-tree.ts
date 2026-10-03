import type {SessionTreeNode} from "nbook/server/agent/session/types";
import type {AgentMessageSwitcherState} from "nbook/app/components/novel-ide/agent/agent-message";

export type AgentSessionTreeFilterMode = "default" | "no-tools" | "user" | "labeled" | "all";

export type TreeGuidePart = "space" | "line" | "branch" | "end" | "root";

export type AgentSessionTreeRow = {
    node: SessionTreeNode;
    visibleParentId: string | null;
    /** 节点所在 lane 的深度，不是原始树递归深度。线性子节点继承父 lane，例如 D1 与 C1 同 depth。 */
    laneDepth: number;
    isBranchPoint: boolean;
    collapsible: boolean;
    collapsed: boolean;
    /** 当前折叠状态下实际隐藏的、原本可见的 descendant 行数。 */
    hiddenDescendantCount: number;
    branchSiblingCount: number;
    branchIndex: number | null;
    guideParts: TreeGuidePart[];
};

export type AgentTreeDerivedState = {
    nodeById: Map<string, SessionTreeNode>;
    childrenByParentId: Map<string | null, SessionTreeNode[]>;
    activePathIds: Set<string>;
    flattenedNodes: SessionTreeNode[];
    terminalByBranchRootId: Map<string, SessionTreeNode>;
    /**
     * 消息气泡上的分支切换状态，按承载切换器的气泡 id 建索引。
     *
     * nodeIds 是同一分叉下的对话分支锚点，运行期记账 entry 已被条件化掉，
     * 因此每个 id 都对应一个真实气泡。切换目标仍落到该分支在原始树里的最新终点。
     */
    switcherByMessageId: Record<string, AgentMessageSwitcherState>;
};

/**
 * 将原始 session tree 投影成 UI 可直接渲染的 continuation tree rows。
 *
 * 这里的 lane 深度只在真实 branch point 下进入 continuation 时增加；
 * 线性 parent-child 不会让行继续右移。
 */
export function deriveAgentSessionTreeRows(input: {
    tree: SessionTreeNode[];
    filterMode: AgentSessionTreeFilterMode;
    query?: string;
    collapsedBranchIds?: ReadonlySet<string>;
}): AgentSessionTreeRow[] {
    const state = deriveAgentTreeState(input.tree);
    const query = input.query?.trim().toLowerCase() ?? "";
    const activeCollapsedBranchIds = query ? undefined : input.collapsedBranchIds;
    const hasCollapsedBranches = Boolean(activeCollapsedBranchIds?.size);
    const fullVisibleIds = deriveVisibleIds(state, input.filterMode, query);
    const visibleIds = hasCollapsedBranches && activeCollapsedBranchIds
        ? applyCollapsedBranches(state, fullVisibleIds, activeCollapsedBranchIds)
        : fullVisibleIds;
    const hiddenDescendantCountById = hasCollapsedBranches && activeCollapsedBranchIds
        ? deriveHiddenDescendantCountById(state, fullVisibleIds, visibleIds, activeCollapsedBranchIds)
        : new Map<string, number>();
    const depthById = deriveLaneDepthById(state);

    return state.flattenedNodes
        .filter((node) => visibleIds.has(node.id))
        .map((node) => {
            const parent = node.parentId ? state.nodeById.get(node.parentId) ?? null : null;
            const branchSiblings = parent && isRawBranchPoint(parent)
                ? state.childrenByParentId.get(parent.id) ?? []
                : [];
            const branchIndex = branchSiblings.findIndex((item) => item.id === node.id);
            const laneDepth = depthById.get(node.id) ?? 0;
            const isBranchPoint = isRawBranchPoint(node);
            const collapsed = Boolean(isBranchPoint && activeCollapsedBranchIds?.has(node.id));

            return {
                node,
                visibleParentId: nearestVisibleParentId(node, state, visibleIds),
                laneDepth,
                isBranchPoint,
                collapsible: isBranchPoint,
                collapsed,
                hiddenDescendantCount: hiddenDescendantCountById.get(node.id) ?? 0,
                branchSiblingCount: branchSiblings.length,
                branchIndex: branchIndex >= 0 ? branchIndex : null,
                guideParts: treeGuideParts(node, state, laneDepth),
            };
        });
}

function deriveVisibleIds(
    state: AgentTreeDerivedState,
    filterMode: AgentSessionTreeFilterMode,
    query: string,
): Set<string> {
    const baseVisibleIds = new Set<string>();
    for (const node of state.flattenedNodes) {
        if (matchesTreeFilterMode(node, filterMode) || isRawBranchPoint(node)) {
            baseVisibleIds.add(node.id);
        }
    }
    const visibleIds = query
        ? visibleIdsForSearch(state, baseVisibleIds, query)
        : new Set(baseVisibleIds);
    if (!query) {
        addBranchLaneRoots(state, visibleIds);
    }
    for (const nodeId of [...visibleIds]) {
        const node = state.nodeById.get(nodeId);
        if (node) {
            addBranchAnchors(node, state, visibleIds);
        }
    }
    return visibleIds;
}

function applyCollapsedBranches(
    state: Pick<AgentTreeDerivedState, "flattenedNodes" | "nodeById">,
    visibleIds: Set<string>,
    collapsedBranchIds: ReadonlySet<string>,
): Set<string> {
    const nextVisibleIds = new Set<string>();
    for (const node of state.flattenedNodes) {
        if (!visibleIds.has(node.id) || nearestCollapsedAncestorId(node, state.nodeById, collapsedBranchIds)) {
            continue;
        }
        nextVisibleIds.add(node.id);
    }
    return nextVisibleIds;
}

/**
 * 统计每个已收起 branch point 会隐藏多少条当前过滤下原本可见的 descendant。
 */
function deriveHiddenDescendantCountById(
    state: Pick<AgentTreeDerivedState, "flattenedNodes" | "nodeById">,
    fullVisibleIds: Set<string>,
    foldedVisibleIds: Set<string>,
    collapsedBranchIds: ReadonlySet<string>,
): Map<string, number> {
    const counts = new Map<string, number>();
    for (const node of state.flattenedNodes) {
        if (!fullVisibleIds.has(node.id) || foldedVisibleIds.has(node.id)) {
            continue;
        }
        const ancestorId = nearestCollapsedAncestorId(node, state.nodeById, collapsedBranchIds);
        if (ancestorId) {
            counts.set(ancestorId, (counts.get(ancestorId) ?? 0) + 1);
        }
    }
    return counts;
}

/**
 * 返回当前节点最近的已折叠 branch point 祖先；节点自身不参与判断。
 */
function nearestCollapsedAncestorId(
    node: SessionTreeNode,
    nodeById: Map<string, SessionTreeNode>,
    collapsedBranchIds: ReadonlySet<string>,
): string | null {
    let cursor = node.parentId;
    while (cursor) {
        const ancestor = nodeById.get(cursor);
        if (!ancestor) {
            return null;
        }
        if (isRawBranchPoint(ancestor) && collapsedBranchIds.has(ancestor.id)) {
            return ancestor.id;
        }
        cursor = ancestor.parentId;
    }
    return null;
}

/**
 * 计算 continuation lane 深度：只有经过真实 branch point 进入子 lane 时才加深。
 */
function deriveLaneDepthById(state: Pick<AgentTreeDerivedState, "flattenedNodes" | "nodeById">): Map<string, number> {
    const depthById = new Map<string, number>();

    const resolveLaneDepth = (node: SessionTreeNode): number => {
        const cached = depthById.get(node.id);
        if (cached !== undefined) {
            return cached;
        }
        const parent = node.parentId ? state.nodeById.get(node.parentId) ?? null : null;
        const depth = parent
            ? resolveLaneDepth(parent) + (isRawBranchPoint(parent) ? 1 : 0)
            : 0;
        depthById.set(node.id, depth);
        return depth;
    };

    for (const node of state.flattenedNodes) {
        resolveLaneDepth(node);
    }

    return depthById;
}

/**
 * 从 session tree DTO 派生前端切分支所需索引。
 */
export function deriveAgentTreeState(tree: SessionTreeNode[]): AgentTreeDerivedState {
    const nodeById = new Map<string, SessionTreeNode>();
    const childrenByParentId = new Map<string | null, SessionTreeNode[]>();
    const activePathIds = new Set<string>();

    for (const node of tree) {
        nodeById.set(node.id, node);
        if (node.active) {
            activePathIds.add(node.id);
        }
        const siblings = childrenByParentId.get(node.parentId) ?? [];
        siblings.push(node);
        childrenByParentId.set(node.parentId, siblings);
    }

    for (const siblings of childrenByParentId.values()) {
        siblings.sort((left, right) => left.timestamp - right.timestamp);
    }

    const terminalByBranchRootId = new Map<string, SessionTreeNode>();
    for (const node of tree) {
        terminalByBranchRootId.set(node.id, resolveLatestTerminal(node, childrenByParentId));
    }

    const flattenedNodes = flattenTreeNodes(childrenByParentId);

    return {
        nodeById,
        childrenByParentId,
        activePathIds,
        flattenedNodes,
        terminalByBranchRootId,
        switcherByMessageId: deriveSwitcherByMessageId({flattenedNodes, nodeById}),
    };
}

/**
 * 根据当前消息节点和方向，找到应该切换到的 terminal entry。
 */
export function resolveBranchSwitchTarget(
    state: AgentTreeDerivedState,
    messageId: string,
    direction: -1 | 1,
): SessionTreeNode | null {
    const switcher = state.switcherByMessageId[messageId];
    if (!switcher || switcher.total <= 1) {
        return null;
    }
    const nextMessageNodeId = switcher.nodeIds[(switcher.currentIndex + direction + switcher.total) % switcher.total];
    if (!nextMessageNodeId) {
        return null;
    }
    return state.terminalByBranchRootId.get(nextMessageNodeId) ?? state.nodeById.get(nextMessageNodeId) ?? null;
}

/**
 * 判断 tree 面板默认过滤下是否显示节点。
 */
export function isDefaultVisibleTreeNode(node: SessionTreeNode): boolean {
    if (node.type === "message" || node.type === "custom_message") {
        return Boolean(node.preview || node.toolName || node.role);
    }
    return node.type === "compaction" || node.type === "branch_summary";
}

function matchesTreeFilterMode(node: SessionTreeNode, filterMode: AgentSessionTreeFilterMode): boolean {
    if (filterMode === "all") {
        return true;
    }
    if (filterMode === "no-tools") {
        const assistantToolOnly = node.role === "assistant" && (node.preview ?? "").startsWith("[tool:");
        return isDefaultVisibleTreeNode(node) && node.role !== "toolResult" && !node.toolName && !assistantToolOnly;
    }
    if (filterMode === "user") {
        return node.role === "user";
    }
    if (filterMode === "labeled") {
        return Boolean(node.label) || node.type === "branch_summary";
    }
    return isDefaultVisibleTreeNode(node);
}

function visibleIdsForSearch(
    state: AgentTreeDerivedState,
    baseVisibleIds: Set<string>,
    query: string,
): Set<string> {
    const visibleIds = new Set<string>();
    for (const node of state.flattenedNodes) {
        if (!baseVisibleIds.has(node.id) || !matchesSearchQuery(node, query)) {
            continue;
        }
        visibleIds.add(node.id);
        addBranchAnchors(node, state, visibleIds);
    }
    return visibleIds;
}

function matchesSearchQuery(node: SessionTreeNode, query: string): boolean {
    return [
        node.id,
        node.parentId ?? "",
        node.role ?? "",
        node.type,
        node.preview ?? "",
        node.toolName ?? "",
        node.label ?? "",
    ].some((value) => value.toLowerCase().includes(query));
}

function addBranchAnchors(
    node: SessionTreeNode,
    state: Pick<AgentTreeDerivedState, "nodeById">,
    visibleIds: Set<string>,
): void {
    const path = pathToRoot(node, state.nodeById).reverse();
    for (let index = 0; index < path.length - 1; index += 1) {
        const ancestor = path[index]!;
        if (!isRawBranchPoint(ancestor)) {
            continue;
        }
        visibleIds.add(ancestor.id);
        visibleIds.add(path[index + 1]!.id);
    }
}

function addBranchLaneRoots(
    state: Pick<AgentTreeDerivedState, "flattenedNodes" | "childrenByParentId">,
    visibleIds: Set<string>,
): void {
    for (const node of state.flattenedNodes) {
        if (!visibleIds.has(node.id) || !isRawBranchPoint(node)) {
            continue;
        }
        for (const child of state.childrenByParentId.get(node.id) ?? []) {
            visibleIds.add(child.id);
        }
    }
}

function pathToRoot(node: SessionTreeNode, nodeById: Map<string, SessionTreeNode>): SessionTreeNode[] {
    const path: SessionTreeNode[] = [];
    let cursor: SessionTreeNode | undefined = node;
    while (cursor) {
        path.push(cursor);
        cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
    }
    return path;
}

function nearestVisibleParentId(
    node: SessionTreeNode,
    state: Pick<AgentTreeDerivedState, "nodeById">,
    visibleIds: Set<string>,
): string | null {
    let cursor = node.parentId;
    while (cursor) {
        if (visibleIds.has(cursor)) {
            return cursor;
        }
        cursor = state.nodeById.get(cursor)?.parentId ?? null;
    }
    return null;
}

function treeGuideParts(
    node: SessionTreeNode,
    state: Pick<AgentTreeDerivedState, "nodeById" | "childrenByParentId">,
    laneDepth: number,
): TreeGuidePart[] {
    if (laneDepth <= 0) {
        return ["root"];
    }

    const path = pathToRoot(node, state.nodeById).reverse();
    const laneRoots = path.filter((item) => {
        const parent = item.parentId ? state.nodeById.get(item.parentId) ?? null : null;
        return Boolean(parent && isRawBranchPoint(parent));
    });

    return laneRoots.map((laneRoot) => {
        const laneHasFollowingSibling = hasFollowingRawSibling(laneRoot, state.childrenByParentId);
        if (laneRoot.id === node.id) {
            return laneHasFollowingSibling ? "branch" : "end";
        }
        return laneHasFollowingSibling ? "line" : "space";
    });
}

function hasFollowingRawSibling(
    node: SessionTreeNode,
    childrenByParentId: Map<string | null, SessionTreeNode[]>,
): boolean {
    const siblings = childrenByParentId.get(node.parentId) ?? [];
    const index = siblings.findIndex((item) => item.id === node.id);
    return index >= 0 && index < siblings.length - 1;
}

function isRawBranchPoint(node: SessionTreeNode): boolean {
    return node.childCount > 1;
}

/**
 * 判断节点能否充当一条对话分支的锚点。
 *
 * 服务端只给事实（`chatEntry` = 这条 entry 会渲染成哪种气泡），这里定的是 UI 策略：
 * 只有带消息工具条、能承载切换器的气泡才算一条分支的开头。
 *
 * - `tool_result` 并入所属 assistant 气泡，没有独立工具条，排除。
 * - `system` 是每轮注入的提醒 / 压缩摘要这类脚手架卡片，不是「另一个版本」，排除。
 * - `invocation_error` 保留：跑挂的那次运行也是一条真实结果，否则重试失败后会切不回上一个好答案。
 * - 缺 `chatEntry` 的记账 entry（lifecycle、model_change、custom 等）一律透明。
 */
function isBranchAnchor(node: SessionTreeNode): boolean {
    return node.chatEntry === "user" || node.chatEntry === "assistant" || node.chatEntry === "invocation_error";
}

/**
 * 派生消息气泡上的分支切换状态。
 *
 * 原始 entry 树同时承载对话内容和运行期记账，直接按 `childCount > 1` 找分叉会把
 * `invocation_lifecycle` / `model_change` / `custom(agent.link.*)` 也算成分支——既让真实的
 * 重试分支显示不出来（每次运行的第一条 entry 必然是 lifecycle start，它抢占了分支根的位置），
 * 又会造出切过去就把对话截断的假分支。
 *
 * 这里改为在锚点之间连线：每个锚点归属到最近的锚点祖先，记账 entry 全部透明。
 * 只含记账 entry 的分叉自然消失，`model_change` 也因此不构成独立分支。
 */
function deriveSwitcherByMessageId(
    state: Pick<AgentTreeDerivedState, "flattenedNodes" | "nodeById">,
): Record<string, AgentMessageSwitcherState> {
    /** 沿 parentId 上溯到最近的锚点；null 表示该锚点直接挂在会话虚拟根下。 */
    const nearestAnchorId = (node: SessionTreeNode): string | null => {
        let cursor = node.parentId;
        while (cursor) {
            const ancestor = state.nodeById.get(cursor);
            if (!ancestor) {
                return null;
            }
            if (isBranchAnchor(ancestor)) {
                return ancestor.id;
            }
            cursor = ancestor.parentId;
        }
        return null;
    };

    const lanesByAnchorParentId = new Map<string | null, SessionTreeNode[]>();
    for (const node of state.flattenedNodes) {
        if (!isBranchAnchor(node)) {
            continue;
        }
        const anchorParentId = nearestAnchorId(node);
        const lanes = lanesByAnchorParentId.get(anchorParentId) ?? [];
        lanes.push(node);
        lanesByAnchorParentId.set(anchorParentId, lanes);
    }

    const result: Record<string, AgentMessageSwitcherState> = {};
    for (const lanes of lanesByAnchorParentId.values()) {
        if (lanes.length <= 1) {
            continue;
        }
        lanes.sort((left, right) => left.timestamp - right.timestamp);
        // 分叉整体不在 active path 上时不显示切换器；这类分支只在 Session Tree 对话框审计。
        const currentIndex = lanes.findIndex((lane) => lane.active);
        if (currentIndex < 0) {
            continue;
        }
        result[lanes[currentIndex]!.id] = {
            nodeIds: lanes.map((lane) => lane.id),
            currentIndex,
            total: lanes.length,
        };
    }
    return result;
}

function flattenTreeNodes(childrenByParentId: Map<string | null, SessionTreeNode[]>): SessionTreeNode[] {
    const result: SessionTreeNode[] = [];
    const visit = (parentId: string | null): void => {
        const children = childrenByParentId.get(parentId) ?? [];
        const activeChildren = children.filter((node) => node.active);
        const inactiveChildren = children.filter((node) => !node.active);
        for (const child of [...activeChildren, ...inactiveChildren]) {
            result.push(child);
            visit(child.id);
        }
    };

    visit(null);
    return result;
}

function resolveLatestTerminal(
    root: SessionTreeNode,
    childrenByParentId: Map<string | null, SessionTreeNode[]>,
): SessionTreeNode {
    let latest = root;
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }
        const children = childrenByParentId.get(current.id) ?? [];
        if (children.length === 0 && current.timestamp >= latest.timestamp) {
            latest = current;
        }
        for (const child of children) {
            stack.push(child);
        }
    }
    return latest;
}
