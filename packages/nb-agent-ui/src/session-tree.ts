/**
 * 分支树的纯逻辑（docs/specs/ui/agent-conversation-view.md 的“分支树”）：宿主给会话树的全部节点与当前路径，这里算出显示的节点、
 * 列表的行（缩进线）与图的位置。内核的节点很细（模型请求、轮次边界都是节点），用户只认说的话、回复和工具，别的节点穿过去，
 * 它们的孩子接到最近的显示节点上。
 */

export type SessionTreeNodeView = {
    id: string;
    parent: string | null;
    type: string;
    label?: string;
};

/** `default`：对话与工具；`no-tools`：只有对话；`user`：只有用户的话；`all`：连内核的内部节点也显示。 */
export type SessionTreeFilter = "default" | "no-tools" | "user" | "all";

export type SessionTreeNodeKind = "user" | "assistant" | "tool" | "other";

export type TreeGuide = "space" | "line" | "branch" | "end";

export type SessionTreeRow = {
    id: string;
    kind: SessionTreeNodeKind;
    type: string;
    label: string;
    /** 缩进线，一层一个。 */
    guides: TreeGuide[];
    /** 每层缩进线属于哪条分支道，和 `guides` 一一对应，颜色按它取。 */
    guideLanes: number[];
    /** 这一行所在的分支道：当前路径是 0，和图用同一种算法。 */
    lane: number;
    onPath: boolean;
    /** 当前路径的末端（显示的节点里最后一个）。 */
    current: boolean;
    /** 从这里分成几条；不分叉时为 0。 */
    forks: number;
    /** 这一行是一条分支的开头，能收起。 */
    collapsible: boolean;
    collapsed: boolean;
    /** 收起时藏了几行。 */
    hidden: number;
};

export type SessionTreeGraphNode = {
    id: string;
    kind: SessionTreeNodeKind;
    label: string;
    onPath: boolean;
    current: boolean;
    /** 沿时间的位置。 */
    depth: number;
    /** 第几条分支道。 */
    lane: number;
    /** 分叉：孩子的 id，当前走到第几个（从 0 起）。 */
    fork: {children: string[]; index: number} | null;
};

export type SessionTreeGraph = {
    nodes: SessionTreeGraphNode[];
    edges: {from: string; to: string; onPath: boolean}[];
    depth: number;
    lanes: number;
};

type Shown = {
    node: SessionTreeNodeView;
    kind: SessionTreeNodeKind;
    children: Shown[];
};

function kindOf(type: string): SessionTreeNodeKind {
    if (type === "input" || type === "steer") return "user";
    if (type === "assistant") return "assistant";
    if (type === "toolStarted") return "tool";
    return "other";
}

function shownBy(filter: SessionTreeFilter, kind: SessionTreeNodeKind): boolean {
    switch (filter) {
        case "all":
            return true;
        case "default":
            return kind !== "other";
        case "no-tools":
            return kind === "user" || kind === "assistant";
        case "user":
            return kind === "user";
    }
}

/**
 * 把内部节点穿过去，建显示用的树；孩子把当前路径上的排在最前（当前路径是主干，别的分支往后排）。循环的 parent 不会出现
 * （内核只追加），找不到父节点的节点算根：出站过滤不改结构，这只是防御。
 */
function buildShown(nodes: readonly SessionTreeNodeView[], filter: SessionTreeFilter, onPath: ReadonlySet<string>): Shown[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const shownParent = new Map<string, string | null>();
    /** 节点最近的显示祖先；按写入顺序算，父节点总在前面。 */
    const nearest = new Map<string, string | null>();
    for (const node of nodes) {
        const parent = node.parent !== null && byId.has(node.parent) ? node.parent : null;
        const up = parent === null ? null : shownBy(filter, kindOf(byId.get(parent)!.type)) ? parent : nearest.get(parent) ?? null;
        nearest.set(node.id, up);
        if (shownBy(filter, kindOf(node.type))) shownParent.set(node.id, up);
    }
    const shown = new Map<string, Shown>();
    for (const id of shownParent.keys()) {
        const node = byId.get(id)!;
        shown.set(id, {node, kind: kindOf(node.type), children: []});
    }
    const roots: Shown[] = [];
    for (const [id, parent] of shownParent) (parent === null ? roots : shown.get(parent)!.children).push(shown.get(id)!);
    const pathFirst = (a: Shown, b: Shown): number => Number(onPath.has(b.node.id)) - Number(onPath.has(a.node.id));
    for (const item of shown.values()) item.children.sort(pathFirst);
    roots.sort(pathFirst);
    return roots;
}

/** 当前路径上最后一个显示的节点：路径的末端常是内部节点（`runEnded`）。 */
function currentOf(roots: readonly Shown[], onPath: ReadonlySet<string>): string | null {
    let current: string | null = null;
    let level: readonly Shown[] = roots;
    for (;;) {
        const next = level.find((item) => onPath.has(item.node.id));
        if (next === undefined) return current;
        current = next.node.id;
        level = next.children;
    }
}

/** 这个节点下面一共几行。递归深度等于对话长度，长会话会撑爆调用栈，所以用显式的栈（下面的遍历同理）。 */
function countRows(item: Shown): number {
    let count = 0;
    const stack = [...item.children];
    while (stack.length > 0) {
        count += 1;
        stack.push(...stack.pop()!.children);
    }
    return count;
}

export function sessionTreeRows(input: {
    nodes: readonly SessionTreeNodeView[];
    activePath: readonly string[];
    filter: SessionTreeFilter;
    query?: string;
    collapsed?: ReadonlySet<string>;
}): SessionTreeRow[] {
    const onPath = new Set(input.activePath);
    const roots = buildShown(input.nodes, input.filter, onPath);
    const current = currentOf(roots, onPath);
    const query = input.query?.trim().toLowerCase() ?? "";
    // 搜索时展开全部：要找的可能就在收起的分支里。
    const collapsed = query === "" ? input.collapsed ?? new Set<string>() : new Set<string>();
    const rows: SessionTreeRow[] = [];

    /** `lead` 是这一行的缩进线，`rest` 是它后面的行（同一条线）接着用的。线性的孩子不缩进，只有分叉才进一层。 */
    let lanes = 0;
    const stack: {item: Shown; lead: TreeGuide[]; rest: TreeGuide[]; leadLanes: number[]; restLanes: number[]; branchHead: boolean; lane: number}[] = [];
    for (let index = roots.length - 1; index >= 0; index -= 1) stack.push({item: roots[index]!, lead: [], rest: [], leadLanes: [], restLanes: [], branchHead: false, lane: -1});
    while (stack.length > 0) {
        const {item, lead, rest, leadLanes, restLanes, branchHead, lane: given} = stack.pop()!;
        const lane = given < 0 ? lanes++ : given;
        const hide = collapsed.has(item.node.id);
        rows.push({
            id: item.node.id,
            kind: item.kind,
            type: item.node.type,
            label: item.node.label ?? item.node.type,
            guides: lead,
            guideLanes: leadLanes,
            lane,
            onPath: onPath.has(item.node.id),
            current: item.node.id === current,
            forks: item.children.length > 1 ? item.children.length : 0,
            collapsible: branchHead && item.children.length > 0,
            collapsed: hide,
            hidden: hide ? countRows(item) : 0,
        });
        if (hide) continue;
        if (item.children.length === 1) {
            stack.push({item: item.children[0]!, lead: rest, rest, leadLanes: restLanes, restLanes, branchHead: false, lane});
            continue;
        }
        // 第一个孩子沿用这一道，别的孩子开新道。反着压栈：第一个孩子先出来，整条分支走完才轮到下一个。
        const childLanes = item.children.map((_, index) => (index === 0 ? lane : lanes++));
        for (let index = item.children.length - 1; index >= 0; index -= 1) {
            const last = index === item.children.length - 1;
            stack.push({
                item: item.children[index]!,
                lead: [...rest, last ? "end" : "branch"],
                rest: [...rest, last ? "space" : "line"],
                leadLanes: [...restLanes, childLanes[index]!],
                restLanes: [...restLanes, childLanes[index]!],
                branchHead: true,
                lane: childLanes[index]!,
            });
        }
    }
    if (query === "") return rows;
    return rows.filter((row) => row.label.toLowerCase().includes(query)).map((row) => ({...row, guides: [], guideLanes: [], collapsible: false}));
}

export function sessionTreeGraph(input: {
    nodes: readonly SessionTreeNodeView[];
    activePath: readonly string[];
    filter: SessionTreeFilter;
    query?: string;
}): SessionTreeGraph {
    const onPath = new Set(input.activePath);
    const roots = buildShown(input.nodes, input.filter, onPath);
    const current = currentOf(roots, onPath);
    const query = input.query?.trim().toLowerCase() ?? "";
    const nodes: SessionTreeGraphNode[] = [];
    const edges: SessionTreeGraph["edges"] = [];
    let lanes = 0;
    let deepest = 0;

    // 递归深度等于对话长度：长会话会撑爆调用栈，所以用显式的栈。子节点按相反顺序压栈，第一个孩子（当前路径）沿用这一道。
    const stack: {item: Shown; depth: number; lane: number; parent: string | null}[] = [];
    for (let index = roots.length - 1; index >= 0; index -= 1) stack.push({item: roots[index]!, depth: 0, lane: -1, parent: null});
    while (stack.length > 0) {
        const {item, depth, lane: given, parent} = stack.pop()!;
        const lane = given < 0 ? lanes++ : given;
        deepest = Math.max(deepest, depth);
        const children = item.children;
        const path = children.findIndex((child) => onPath.has(child.node.id));
        nodes.push({
            id: item.node.id,
            kind: item.kind,
            label: item.node.label ?? item.node.type,
            onPath: onPath.has(item.node.id),
            current: item.node.id === current,
            depth,
            lane,
            fork: children.length > 1 ? {children: children.map((child) => child.node.id), index: Math.max(path, 0)} : null,
        });
        if (parent !== null) edges.push({from: parent, to: item.node.id, onPath: onPath.has(parent) && onPath.has(item.node.id)});
        for (let index = children.length - 1; index >= 0; index -= 1) {
            stack.push({item: children[index]!, depth: depth + 1, lane: index === 0 ? lane : -1, parent: item.node.id});
        }
    }
    const matched = query === "" ? nodes : nodes.filter((node) => node.label.toLowerCase().includes(query));
    const kept = new Set(matched.map((node) => node.id));
    return {
        nodes: matched,
        edges: query === "" ? edges : edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
        depth: deepest + 1,
        lanes,
    };
}

/** 图的布局方向：`down` 从上往下（缺省），`right` 从左往右。 */
export type SessionTreeDirection = "down" | "right";

const NODE_WIDTH = 120;
const NODE_HEIGHT = 28;
const GAP_ALONG = 22;
const GAP_ACROSS = 14;

export const SESSION_TREE_NODE_SIZE = {width: NODE_WIDTH, height: NODE_HEIGHT};

/** 节点在画布上的左上角。两个方向只是沿时间的轴换了一下。 */
export function graphPosition(node: {depth: number; lane: number}, direction: SessionTreeDirection): {x: number; y: number} {
    return direction === "down"
        ? {x: node.lane * (NODE_WIDTH + GAP_ACROSS), y: node.depth * (NODE_HEIGHT + GAP_ALONG)}
        : {x: node.depth * (NODE_WIDTH + GAP_ALONG), y: node.lane * (NODE_HEIGHT + GAP_ACROSS)};
}

export function graphSize(graph: {depth: number; lanes: number}, direction: SessionTreeDirection): {width: number; height: number} {
    return direction === "down"
        ? {width: graph.lanes * (NODE_WIDTH + GAP_ACROSS) - GAP_ACROSS, height: graph.depth * (NODE_HEIGHT + GAP_ALONG) - GAP_ALONG}
        : {width: graph.depth * (NODE_WIDTH + GAP_ALONG) - GAP_ALONG, height: graph.lanes * (NODE_HEIGHT + GAP_ACROSS) - GAP_ACROSS};
}

/** 连线：从父节点沿时间方向的那一边，接到子节点的对面；换道时是一条曲线。 */
export function graphEdgePath(from: {depth: number; lane: number}, to: {depth: number; lane: number}, direction: SessionTreeDirection): string {
    const a = graphPosition(from, direction);
    const b = graphPosition(to, direction);
    if (direction === "down") {
        const x1 = a.x + NODE_WIDTH / 2;
        const y1 = a.y + NODE_HEIGHT;
        const x2 = b.x + NODE_WIDTH / 2;
        const y2 = b.y;
        if (x1 === x2) return `M${x1} ${y1} L${x2} ${y2}`;
        const middle = (y1 + y2) / 2;
        return `M${x1} ${y1} C${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`;
    }
    const x1 = a.x + NODE_WIDTH;
    const y1 = a.y + NODE_HEIGHT / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_HEIGHT / 2;
    if (y1 === y2) return `M${x1} ${y1} L${x2} ${y2}`;
    const middle = (x1 + x2) / 2;
    return `M${x1} ${y1} C${middle} ${y1} ${middle} ${y2} ${x2} ${y2}`;
}

/** 图模式最多画几个节点：再多浏览器撑不住，也看不清，让用户用列表。 */
export const SESSION_TREE_GRAPH_LIMIT = 1500;
