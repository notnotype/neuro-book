<script setup lang="ts">
/**
 * 查看器的网络图（docs/specs/story/viewer.md 输出 22 到 29、31），画法与交互沿用 w00024 t01 评审定下的草稿。
 *
 * 三种用法共用这一个组件：
 * - relation：关系图。点与线来自 `graph.relations`，类别筛选由宿主在取数时做。
 * - data：全书图“按关联”。对象、主线（或逐段情节）、秘密、悬念，来自 `graph.book`。
 * - ego：人物卡里的小图（relation 加 `ego`）。只画关系最多的十来个，放射排布。
 *
 * 画法：点一样大、线一样粗，多少写在线上的字里，不靠粗细；一对点之间的几种联系（关系说法、同场、认知）
 * 合并成一条直线，颜色按最要紧的一种，认知用箭头标方向（两边都知道就是双向箭头）。点画成类型色的空心圆圈，
 * 选中时圈加粗、填上淡色、外面一圈光晕（参照 viewer-v7）。
 */
import {createNodeBorderProgram} from "@sigma/node-border";
import {fitViewportToNodes} from "@sigma/utils";
import Graph from "graphology";
import Sigma from "sigma";
import {EdgeArrowProgram, EdgeDoubleArrowProgram} from "sigma/rendering";
import {animateNodes} from "sigma/utils";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";

import {IconButton} from "@notnotype/nb-ui/components";

import {chooseForcedLabels, edgeLabelDrawer, estimateLabelWidth, FADE_MS, fitAll, fixedColors, Focus, isFitted, labelWaits, hoverDrawer, labelDrawer, layoutCircle, layoutConcentric, layoutForce, layoutStress, mix, readTheme, seedSpiral, zoom} from "./sigma-kit";
import type {LayoutFrame, Theme} from "./sigma-kit";
import type {CameraState} from "sigma/types";
import {edgeParts, hasParts} from "./edge-parts";

import type {IdentityState} from "../../contract/contract";
import {useLayoutMotion} from "../host/motion";
import {appearance} from "../host/theme";

/** 点：`kind` 是对象类别，或全书图里的 arc、episode、secret、question。 */
/** `names`：这个点的其他称呼，搜索也按它们匹配。 */
export type NetworkNode = {id: string; label: string; kind: string; weight: number; names?: readonly string[]};
/** 关系图的线：一对点一条，几种联系合在一起（RelationEdge 的形状）。 */
export type NetworkEdge = {a: string; b: string; word: string | null; statements: number; together: number; ab: number; ba: number; identity: IdentityState | null};
/** 全书图的线。 */
export type DataEdge = {a: string; b: string; type: "participates" | "about" | "link" | "relation"; count: number};
import type {GraphLayout} from "./layout";

export type {GraphLayout};

const props = withDefaults(defineProps<{
    nodes: NetworkNode[];
    mode: "relation" | "data";
    /** relation 的线。 */
    edges?: NetworkEdge[];
    /** data 的线。 */
    dataEdges?: DataEdge[];
    /** relation：画哪几层连线（relation、co、know）。 */
    layers?: string[];
    /** relation：排版方式。 */
    layout?: GraphLayout;
    /** 点了“重新排版”就加一，组件按当前方式从头排一次。 */
    relayoutKey?: number;
    /** 只画这个点和关系最多的邻居（人物卡里的小图）。 */
    ego?: string | null;
    selected?: string | null;
    /** 选中一个点后只显示它和它的邻居。 */
    neighborhood?: boolean;
    /** data：不画的类型。 */
    hiddenTypes?: string[];
    minCo?: number;
    compact?: boolean;
    /** 在图里找：命中的点高亮，镜头移到第一个。 */
    query?: string;
    /** 一定出标签、名字加粗的点（主要人物）。 */
    pinned?: string[];
}>(), {
    edges: () => [], dataEdges: () => [], layers: () => ["relation", "co"], layout: "force", relayoutKey: 0, ego: null, selected: null, neighborhood: false,
    hiddenTypes: () => [], minCo: 2, compact: false, query: "", pinned: () => [],
});

/**
 * 交互（输出 27）：单击选中一个点（拖动不算）→ select；双击或在图上按 Enter → open，宿主打开它的人物卡或连线说明；
 * 右键 → menu（带视口坐标，宿主弹出右键菜单；右键也会先选中这个点）；按 F → neighborhood，宿主切换“只看周边”；
 * 点空白处或按 Escape → clear。快捷键只在焦点在图上时生效（按下画布时焦点移到图上）。
 */
const emit = defineEmits<{
    (event: "select", id: string): void;
    (event: "open", id: string): void;
    (event: "menu", payload: {id: string; x: number; y: number}): void;
    (event: "neighborhood", value: boolean): void;
    (event: "clear"): void;
}>();

const root = ref<HTMLElement | null>(null);
const host = ref<HTMLElement | null>(null);
let sigma: Sigma | null = null;
let graph: Graph | null = null;
let focus: Focus | null = null;
let theme: Theme | null = null;
let stopAnimation: (() => void) | null = null;
/** 最近一次铺满给的镜头位置：容器尺寸变了时，镜头还在这个位置（用户没动过）才重新铺满。 */
let fitted: CameraState | null = null;
function refit(animate: boolean): void {
    if (sigma !== null) fitted = fitAll(sigma, animate);
}
const EGO_LIMIT = 12;
const NODE_SIZE = 8;
const EDGE_SIZE = 2;

/** 取景时四周留的边（Sigma 的 `stagePadding`）：取景只看点不看名字，名字画在点的右边、环形排版两侧朝外，要留出地方。 */
const stagePadding = () => (props.compact ? 36 : 90);

/** 排版用的画布区域：容器量出来的宽高减去取景的边。容器还没量出尺寸时按一个常见大小。 */
function layoutFrame(): LayoutFrame {
    const pad = 2 * stagePadding();
    return {width: Math.max(240, (host.value?.clientWidth ?? 960) - pad), height: Math.max(180, (host.value?.clientHeight ?? 600) - pad)};
}

function kindColor(kind: string): string {
    const t = theme!;
    const palette: Record<string, string> = {
        person: t.accent, persona: t.accent, group: t.success, item: t.warning, place: fixedColors(t).place, task: fixedColors(t).task,
        concept: t.muted, other: t.muted, episode: fixedColors(t).episode, arc: fixedColors(t).arc, secret: t.danger, question: t.warning,
    };
    return palette[kind] ?? t.muted;
}

function edgeWeight(edge: NetworkEdge): number {
    return edge.statements * 3 + edge.together;
}

function addNode(target: Graph, id: string, attributes: Record<string, unknown>): void {
    target.addNode(id, {size: props.compact ? 5.5 : NODE_SIZE, ...attributes, fillColor: theme!.surface, ringPx: 2, bold: props.pinned.includes(id)});
}

/** 关系图里要画的点（不含线）。线在 `fillRelationEdges` 里另加，切换连线的层时只换线、点留在原处。 */
function relationNodes(): NetworkNode[] {
    let nodes = props.nodes;
    if (props.ego !== null) {
        const ids = new Set(nodes.map((node) => node.id));
        const ranked = props.edges.filter((edge) => (edge.a === props.ego || edge.b === props.ego) && ids.has(edge.a) && ids.has(edge.b) && edge.identity === null)
            .sort((a, b) => edgeWeight(b) - edgeWeight(a) || (a.a + a.b < b.a + b.b ? -1 : 1)).slice(0, EGO_LIMIT);
        const keep = new Set([props.ego, ...ranked.map((edge) => edge.a === props.ego ? edge.b : edge.a)]);
        nodes = nodes.filter((node) => keep.has(node.id));
    }
    return nodes;
}

/** 身份线上的字（输出 28）。 */
const IDENTITY_LABEL: Record<IdentityState, string> = {
    uncertain: "可能是同一人", unaware: "其实是同一人（不知道）", heard: "其实是同一人（听说）", believes: "其实是同一人（认为）",
    suspects: "其实是同一人（怀疑）", "no-record": "可能知道（没有记录）",
};

/**
 * 一对点之间的几种联系合并成一条线（输出 22）。颜色按最要紧的一种：关系说法（蓝）、认知（粉）、同场（灰）；
 * 认知用箭头标方向：只有 A 知道关于 B 的事是 A→B，两边都知道是双向箭头。线上的字把几种都写上，平时只写关系词。
 */
function fillRelationEdges(target: Graph): void {
    const t = theme!;
    target.clearEdges();
    const nameOf = (node: string) => String(target.getNodeAttribute(node, "label"));
    for (const edge of props.edges) {
        if (!target.hasNode(edge.a) || !target.hasNode(edge.b) || edge.a === edge.b) continue;
        const aside = props.ego !== null && edge.a !== props.ego && edge.b !== props.ego;
        if (edge.identity !== null) {
            if (aside) continue;
            // 身份线单独一种样式：读者视角下不确定、角色视角下他不知道的“其实是同一人”用提醒色；没有记录的用灰色
            const color = edge.identity === "no-record" ? t.muted : t.warning;
            const label = IDENTITY_LABEL[edge.identity];
            target.addUndirectedEdgeWithKey(`same:${edge.a}|${edge.b}`, edge.a, edge.b, {
                size: EDGE_SIZE, color: mix(color, t.bg, 0.35), focusColor: color, type: "line", label, shortLabel: label, alwaysLabel: true, weight: 4, identity: true, group: "identity",
            });
            continue;
        }
        const parts = edgeParts(edge, props.layers, props.minCo, props.ego === null);
        const {relation, co, ab, ba} = parts;
        if (!hasParts(parts)) continue;
        const knows = ab > 0 || ba > 0;
        const color = relation ? t.accent : knows ? fixedColors(t).know : t.muted;
        const word = relation ? (edge.word ?? "") : "";
        const labelParts = [
            relation ? (word ? `${word}（说法 ${edge.statements}）` : `说法 ${edge.statements}`) : "",
            co ? `同场 ${edge.together}` : "",
            ab > 0 ? `${nameOf(edge.a)}知道关于${nameOf(edge.b)}的 ${ab} 条` : "",
            ba > 0 ? `${nameOf(edge.b)}知道关于${nameOf(edge.a)}的 ${ba} 条` : "",
        ].filter(Boolean);
        const attributes = {
            size: aside ? 0.8 : EDGE_SIZE,
            color: aside ? mix(t.muted, t.bg, 0.7) : mix(color, t.bg, 0.3),
            focusColor: color,
            // 人物卡小图地方小，线上只写关系词
            label: aside ? "" : props.compact ? word : labelParts.join(" · "),
            shortLabel: word,
            alwaysLabel: !aside && Boolean(word),
            weight: Math.max(1, (relation ? edge.statements * 3 : 0) + (co ? edge.together : 0) + (knows ? Math.log2(1 + ab + ba) : 0)),
            type: aside ? "line" : knows ? (ab > 0 && ba > 0 ? "doubleArrow" : "arrow") : "line",
            // “只看周边”时邻居按最要紧的联系分组排（输出 26）
            group: relation ? "relation" : knows ? "know" : "co",
        };
        // 单向的认知箭头从知道的人指向被知道的人
        if (knows && !(ab > 0 && ba > 0) && ba > 0) target.addDirectedEdgeWithKey(`p:${edge.b}>${edge.a}`, edge.b, edge.a, attributes);
        else if (knows && !(ab > 0 && ba > 0)) target.addDirectedEdgeWithKey(`p:${edge.a}>${edge.b}`, edge.a, edge.b, attributes);
        else target.addUndirectedEdgeWithKey(`p:${edge.a}|${edge.b}`, edge.a, edge.b, attributes);
    }
}

function buildRelation(target: Graph): void {
    for (const node of relationNodes()) {
        addNode(target, node.id, {label: node.label, color: kindColor(node.kind), forceLabel: true, weight: node.weight, names: node.names ?? []});
    }
    fillRelationEdges(target);
    // 没有任何线连着的点不画（人物卡小图里的中心点除外）。人物卡小图只画和中心直接相连的点：选邻居时按全部联系排，
    // 但小图不画认知层，只靠认知连着中心的点会只剩和别的邻居之间的线，放射排布给不了它位置。
    for (const node of target.nodes()) {
        if (node === props.ego) continue;
        if (target.degree(node) === 0 || (props.ego !== null && target.hasNode(props.ego) && !target.areNeighbors(node, props.ego))) target.dropNode(node);
    }
}

/** 全书图：对象、主线（或情节）、秘密、悬念。情节、主线标题很长，图上只显示前 12 个字，悬停显示全文。 */
function buildData(target: Graph): void {
    const t = theme!;
    const hidden = new Set(props.hiddenTypes);
    const nodes = props.nodes.filter((node) => !hidden.has(node.kind));
    const ids = new Set(nodes.map((node) => node.id));
    const edges = props.dataEdges.filter((edge) => ids.has(edge.a) && ids.has(edge.b));
    const linked = new Set(edges.flatMap((edge) => [edge.a, edge.b]));
    for (const node of nodes) {
        if (!linked.has(node.id)) continue;
        const short = node.label.length > 12 ? `${node.label.slice(0, 12)}…` : node.label;
        addNode(target, node.id, {
            label: short, fullLabel: node.label, size: node.kind === "episode" ? 4 : 6,
            color: kindColor(node.kind),
            // 点一样大以后，标签格子按 weight 挑谁出名字：出场多的先出
            forceLabel: props.pinned.includes(node.id), weight: node.weight, names: node.names ?? [],
        });
    }
    // 线用先和背景色混好的不透明色：半透明的线在 WebGL 里混色会发青，叠多了也会越叠越深
    const EDGE: Record<string, string> = {participates: mix(t.muted, t.bg, 0.72), link: mix(fixedColors(t).link, t.bg, 0.55), about: mix(t.danger, t.bg, 0.65), relation: mix(t.accent, t.bg, 0.5)};
    for (const edge of edges) {
        if (!target.hasNode(edge.a) || !target.hasNode(edge.b) || edge.a === edge.b) continue;
        const key = `${edge.type}:${edge.a}|${edge.b}`;
        if (target.hasEdge(key)) continue;
        target.addUndirectedEdgeWithKey(key, edge.a, edge.b, {
            weight: edge.count * (edge.type === "relation" ? 3 : edge.type === "link" ? 2 : 1),
            size: 1,
            color: EDGE[edge.type] ?? mix(t.muted, t.bg, 0.72),
            focusColor: edge.type === "relation" ? t.accent : t.muted,
            label: edge.type === "participates" && edge.count > 1 ? `${edge.count} 段` : "",
            type: "line",
            group: edge.type,
        });
    }
}

/** 人物卡小图：中心是这个人，邻居按关系多少顺时针排一圈；左半边的点标签画在左边。 */
function layoutEgo(target: Graph): void {
    const center = props.ego!;
    target.mergeNodeAttributes(center, {x: 0, y: 0});
    const weightTo = (node: string) => Math.max(0, ...target.edges(center, node).map((edge) => Number(target.getEdgeAttribute(edge, "weight"))));
    const others = target.neighbors(center).sort((a, b) => weightTo(b) - weightTo(a));
    // Sigma 的 y 轴朝上：从正上方开始顺时针排，关系最多的在 12 点钟方向
    others.forEach((node, index) => {
        const angle = Math.PI / 2 - index * 2 * Math.PI / others.length;
        // 竖向的椭圆：标签横着排，环的上下两端最挤，纵向多拉开一些
        target.mergeNodeAttributes(node, {x: Math.cos(angle) * 9, y: Math.sin(angle) * 13, labelSide: Math.cos(angle) < -0.15 ? "left" : "right"});
    });
    // Sigma 取景只看点不看标签：左右各放一个看不见的点，给两侧朝外的标签留出地方
    for (const side of [-1, 1]) target.addNode(`pad-${side}`, {x: side * 15.5, y: 0, size: 0.01, color: theme!.bg, fillColor: theme!.bg, ringPx: 0, label: "", weight: 0});
}

/** 关系图里哪些点强制出名字：名字框合计不超过画布的一定比例，点多时只出主要的（`chooseForcedLabels`）。 */
function chooseLabels(target: Graph): void {
    if (props.mode !== "relation" || props.ego !== null) return;
    chooseForcedLabels(target, layoutFrame(), {pinned: new Set(props.pinned), labelWidth: (node) => estimateLabelWidth(String(target.getNodeAttribute(node, "label")), 12)});
}

/** 按当前排版方式给点算位置。`fresh` 为真时从固定的螺旋起点排，否则从现在的位置接着排（切换连线的层时，点只挪需要挪的）。 */
function applyLayout(target: Graph, fresh: boolean): void {
    if (props.ego !== null && target.hasNode(props.ego)) {
        layoutEgo(target);
        return;
    }
    target.updateEachNodeAttributes((_, attributes) => ({...attributes, labelSide: "right"}));
    if (props.mode === "relation" && props.layout === "concentric") {
        const center = focus?.selected !== null && focus?.selected !== undefined && target.hasNode(focus.selected) ? focus.selected
            : target.nodes().sort((a, b) => target.degree(b) - target.degree(a))[0];
        if (center !== undefined) layoutConcentric(target, center);
        return;
    }
    if (props.mode === "relation" && props.layout === "circle") {
        const KIND: Record<string, string> = {persona: "person", other: "concept"};
        const kinds = new Map(props.nodes.map((item) => [item.id, item.kind]));
        layoutCircle(target, (node) => {
            const kind = kinds.get(node) ?? "other";
            return KIND[kind] ?? kind;
        });
        return;
    }
    if (fresh || target.someNode((_, attributes) => attributes.x === undefined)) seedSpiral(target, (node) => Number(target.getNodeAttribute(node, "weight")));
    if (props.mode === "relation" && props.layout === "stress") {
        layoutStress(target, {frame: layoutFrame(), labelWidth: (node) => estimateLabelWidth(String(target.getNodeAttribute(node, "label")), props.compact ? 11 : 12)});
        return;
    }
    layoutForce(target, {
        frame: layoutFrame(), linLog: false, iterations: props.mode === "data" ? 600 : fresh ? 300 : 150,
        labelWidth: (node) => estimateLabelWidth(String(target.getNodeAttribute(node, "label")), props.compact ? 11 : 12),
    });
}

/** “只看周边”的放射排布是临时的：重新排版、换数据之前先放回全图位置，排完再按新位置围一圈。 */
function restoreHome(): void {
    if (home === null || graph === null) return;
    for (const [node, position] of home) if (graph.hasNode(node)) graph.mergeNodeAttributes(node, {x: position.x, y: position.y, labelSide: position.side});
    home = null;
}

/** 重新排版：在一份拷贝上算出新位置，再让点从旧位置滑过去，看得出谁挪到了哪里。 */
function relayout(fresh: boolean): void {
    if (sigma === null || graph === null) return;
    restoreHome();
    chooseLabels(graph);
    const copy = graph.copy();
    applyLayout(copy, fresh);
    const targets: Record<string, {x: number; y: number}> = {};
    copy.forEachNode((node, attributes) => {
        targets[node] = {x: Number(attributes.x), y: Number(attributes.y)};
        // 名字写在哪一边由排版决定（环形左半圈朝左），动画只移坐标，这个属性要先同步过去。
        graph!.setNodeAttribute(node, "labelSide", attributes.labelSide ?? "right");
    });
    stopAnimation?.();
    // 拖动时固定过的取景范围要放开，否则新位置跑到框外
    sigma.setCustomBBox(null);
    stopAnimation = animateNodes(graph, targets, {duration: 600, easing: "quadraticInOut"}, () => {
        if (props.neighborhood && focus?.selected !== null) enterNeighborhood();
        else refit(true);
    });
}

type Point = {x: number; y: number};
/** “只看周边”打开时记下的全图位置与名字朝向；关掉或取消选中时点滑回这里。为 null 表示现在就是全图排版。 */
let home: Map<string, Point & {side: string}> | null = null;

function positionsOf(target: Graph): Map<string, Point & {side: string}> {
    const result = new Map<string, Point & {side: string}>();
    target.forEachNode((node, attributes) => result.set(node, {x: Number(attributes.x), y: Number(attributes.y), side: String(attributes.labelSide ?? "right")}));
    return result;
}

/** 由 id 算出的固定角度：新点放在邻居旁边时朝哪个方向错开，同一份数据每次一样。 */
function angleOf(id: string): number {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return (hash % 360) * Math.PI / 180;
}

/**
 * 接着排的起点（输出 25）：已有的点放回原位置；新出现的点放在已放好的邻居的重心旁边，没有邻居的放在外圈。
 * 返回是否每个点都有原位置。
 */
function placeFrom(target: Graph, previous: Map<string, Point>): boolean {
    let complete = true;
    const placed = new Set<string>();
    target.forEachNode((node) => {
        const position = previous.get(node);
        if (position === undefined) return;
        target.mergeNodeAttributes(node, position);
        placed.add(node);
    });
    if (placed.size === 0) return false;
    const xs = [...placed].map((node) => Number(target.getNodeAttribute(node, "x")));
    const ys = [...placed].map((node) => Number(target.getNodeAttribute(node, "y")));
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    target.forEachNode((node) => {
        if (placed.has(node)) return;
        complete = false;
        const anchors = target.neighbors(node).filter((other) => placed.has(other));
        const angle = angleOf(node);
        if (anchors.length > 0) {
            const ax = anchors.reduce((sum, other) => sum + Number(target.getNodeAttribute(other, "x")), 0) / anchors.length;
            const ay = anchors.reduce((sum, other) => sum + Number(target.getNodeAttribute(other, "y")), 0) / anchors.length;
            target.mergeNodeAttributes(node, {x: ax + Math.cos(angle) * span * 0.05, y: ay + Math.sin(angle) * span * 0.05});
        } else {
            target.mergeNodeAttributes(node, {x: cx + Math.cos(angle) * span * 0.6, y: cy + Math.sin(angle) * span * 0.6});
        }
    });
    return complete;
}

/** 淡入的重画循环：只在 `syncData`、`fadeIn` 里写；`fadeStart` 是这一轮淡入的起点。 */
let fadeFrame: number | null = null;
let fadeStart = 0;

/** 淡入期间每帧重画一次，到时间为止（点与线的颜色在 `Focus` 的 reducer 里按 `bornAt` 算）。 */
function fadeIn(): void {
    if (fadeFrame !== null) return;
    const step = () => {
        fadeFrame = null;
        if (sigma === null) return;
        sigma.refresh({skipIndexation: true});
        if (performance.now() - fadeStart < FADE_MS) fadeFrame = requestAnimationFrame(step);
    };
    fadeFrame = requestAnimationFrame(step);
}

/**
 * 点被去掉之后收口：悬停、选中的点不在图里了就放掉（Sigma 去点时不发 leaveNode）；选中的点没了要告诉页面取消选中，
 * 并退出“只看周边”的放射位置，不然镜头还框在上一圈周边上。
 */
function forgetDropped(): void {
    if (graph === null || focus === null) return;
    if (focus.hovered !== null && !graph.hasNode(focus.hovered)) {
        focus.hovered = null;
        if (host.value !== null) host.value.style.cursor = "";
    }
    if (focus.selected !== null && !graph.hasNode(focus.selected)) {
        focus.selected = null;
        emit("clear");
    }
}

/**
 * 点与线的数据变了（往后挪阅读位置、勾选“只画最强的线”、改视角后新数据回来）：原地改现有的图，不重建 Sigma（输出 25，
 * issue 268）。已有的点留在原位，新出现的点放在已放好的邻居旁边（`placeFrom`），没有了的点和线直接去掉，然后和换层一样
 * 从当前位置接着排、点滑到新位置（`relayout`）；新点新线淡入。人物卡小图（放射排布，没有“接着排”）仍然整张重画。
 */
function syncData(): void {
    if (sigma === null || graph === null || focus === null || props.ego !== null) {
        render("fresh");
        return;
    }
    restoreHome();
    const next = new Graph({type: "mixed", multi: true});
    if (props.mode === "data") buildData(next);
    else buildRelation(next);
    placeFrom(next, positionsOf(graph));
    // 现有的点一个都不在新数据里（视角、类别换得彻底）：没有位置可接，和整张重画一样从螺旋起点排。
    if (next.someNode((_, attributes) => attributes.x === undefined)) seedSpiral(next, (node) => Number(next.getNodeAttribute(node, "weight")));
    const now = performance.now();
    for (const node of graph.nodes()) if (!next.hasNode(node)) graph.dropNode(node);
    forgetDropped();
    next.forEachNode((node, attributes) => {
        if (graph!.hasNode(node)) graph!.mergeNodeAttributes(node, attributes);
        else graph!.addNode(node, {...attributes, bornAt: now});
    });
    // 还在淡入的线（半秒内连着挪）把 bornAt 带到新线上，不然下一次同步它就一下变实了
    const oldEdges = new Map(graph.mapEdges((key, attributes) => [key, attributes.bornAt] as const));
    graph.clearEdges();
    next.forEachEdge((key, attributes, source, target) => {
        const added = oldEdges.has(key) ? {...attributes, ...(oldEdges.get(key) === undefined ? {} : {bornAt: oldEdges.get(key)})} : {...attributes, bornAt: now};
        if (next.isDirected(key)) graph!.addDirectedEdgeWithKey(key, source, target, added);
        else graph!.addUndirectedEdgeWithKey(key, source, target, added);
    });
    focus.matches = matchesOf(graph);
    fadeStart = now;
    sigma.refresh();
    fadeIn();
    relayout(false);
}

const GROUP_ORDER = ["identity", "relation", "know", "co", "participates", "about", "link"];

/**
 * “只看选中的周边”的放射排布（输出 26）：选中的点在原位置，一跳邻居按最要紧的联系分组（身份、关系说法、认知、
 * 同场），组内按联系多少排，从正上方顺时针围一圈，组与组之间空一格；邻居多时内外两圈交错，名字不挤。
 */
function radialTargets(target: Graph, center: string, base: Map<string, Point>): Record<string, Point> {
    const origin = base.get(center) ?? {x: 0, y: 0};
    const xs = [...base.values()].map((point) => point.x);
    const ys = [...base.values()].map((point) => point.y);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    const best = new Map<string, {group: number; weight: number}>();
    for (const edge of target.edges(center)) {
        const other = target.opposite(center, edge);
        const attributes = target.getEdgeAttributes(edge);
        const group = Math.max(0, GROUP_ORDER.indexOf(String(attributes.group ?? "co")));
        const weight = Number(attributes.weight ?? 1);
        const current = best.get(other);
        if (current === undefined || group < current.group || (group === current.group && weight > current.weight)) best.set(other, {group, weight});
    }
    const ordered = [...best].sort((a, b) => a[1].group - b[1].group || b[1].weight - a[1].weight || (a[0] < b[0] ? -1 : 1));
    const slots: (string | null)[] = [];
    ordered.forEach(([node, info], index) => {
        if (index > 0 && ordered[index - 1]![1].group !== info.group) slots.push(null);
        slots.push(node);
    });
    const radius = span * 0.22;
    const twoRings = ordered.length > 16;
    const targets: Record<string, Point> = {[center]: origin};
    slots.forEach((node, index) => {
        if (node === null) return;
        // Sigma 的 y 轴朝上：从正上方开始顺时针
        const angle = Math.PI / 2 - index * 2 * Math.PI / slots.length;
        const r = twoRings && index % 2 === 1 ? radius * 1.4 : radius;
        targets[node] = {x: origin.x + Math.cos(angle) * r, y: origin.y + Math.sin(angle) * r};
        target.setNodeAttribute(node, "labelSide", Math.cos(angle) < -0.15 ? "left" : "right");
    });
    return targets;
}

function enterNeighborhood(): void {
    if (sigma === null || graph === null || focus === null || focus.selected === null || !graph.hasNode(focus.selected)) return;
    if (home === null) home = positionsOf(graph);
    const targets = radialTargets(graph, focus.selected, home);
    stopAnimation?.();
    sigma.setCustomBBox(null);
    stopAnimation = animateNodes(graph, targets, {duration: 500, easing: "quadraticInOut"}, () => fitNeighborhood());
}

function leaveNeighborhood(): void {
    if (sigma === null || graph === null || home === null) return;
    const back: Record<string, Point> = {};
    for (const [node, position] of home) {
        if (!graph.hasNode(node)) continue;
        back[node] = {x: position.x, y: position.y};
        graph.setNodeAttribute(node, "labelSide", position.side);
    }
    home = null;
    stopAnimation?.();
    stopAnimation = animateNodes(graph, back, {duration: 500, easing: "quadraticInOut"}, () => refit(true));
}

/**
 * 整张重画。`how`：fresh 从固定起点排（首次显示、换用法、人物卡小图换数据）；keep 位置不动只换颜色（换明暗）。
 * 数据变了不走这里，原地改图（`syncData`）。
 */
function render(how: "fresh" | "keep" = "fresh"): void {
    if (host.value === null) return;
    const previous = how === "keep" && graph !== null && props.ego === null ? (home ?? positionsOf(graph)) : null;
    home = null;
    stopAnimation?.();
    sigma?.kill();
    theme = readTheme(host.value);
    graph = new Graph({type: "mixed", multi: true});
    if (props.mode === "data") buildData(graph);
    else buildRelation(graph);
    focus = new Focus(graph, theme);
    focus.selected = props.selected !== null && graph.hasNode(props.selected) ? props.selected : null;
    focus.onlyNeighborhood = props.neighborhood;
    chooseLabels(graph);
    if (previous === null) applyLayout(graph, true);
    else {
        const complete = placeFrom(graph, previous);
        if (how === "keep" && complete) {
            for (const [node, position] of previous) {
                if (graph.hasNode(node)) graph.setNodeAttribute(node, "labelSide", position.side);
            }
        } else {
            applyLayout(graph, false);
        }
    }
    const drawLabel = labelDrawer(theme);
    const drawHover = hoverDrawer(theme);
    const drawEdgeLabel = edgeLabelDrawer(theme);
    sigma = new Sigma(graph, host.value, {
        renderEdgeLabels: true,
        defaultNodeType: "ring",
        nodeProgramClasses: {
            // 类型色的空心圆圈：外圈 2 像素的类型色，里面填面板底色；选中时外圈加粗、里面填淡的类型色
            ring: createNodeBorderProgram({
                borders: [
                    {size: {attribute: "ringPx", defaultValue: 2, mode: "pixels"}, color: {attribute: "color"}},
                    {size: {fill: true}, color: {attribute: "fillColor"}},
                ],
                drawLabel: drawLabel as never,
                drawHover: drawHover as never,
            }),
        },
        edgeProgramClasses: {arrow: EdgeArrowProgram, doubleArrow: EdgeDoubleArrowProgram},
        labelFont: theme.font,
        labelSize: props.compact ? 11 : 12,
        labelWeight: "500",
        labelColor: {color: theme.text},
        edgeLabelFont: theme.font,
        edgeLabelSize: 11,
        edgeLabelColor: {color: theme.muted},
        // 标签按格子去重：同一格只画 weight 最大的点的标签，放大后格子里的点变少，标签逐级出来
        labelDensity: props.mode === "data" ? 0.5 : 1,
        labelGridCellSize: props.mode === "data" ? 110 : 70,
        labelRenderedSizeThreshold: 0,
        defaultDrawNodeLabel: drawLabel as never,
        defaultDrawNodeHover: drawHover as never,
        defaultDrawEdgeLabel: drawEdgeLabel as never,
        nodeReducer: focus.node as never,
        edgeReducer: ((edge: string, data: Record<string, unknown>) => {
            const result = focus!.edge(edge, data);
            // 平时线上只写关系词；悬停、选中时写全（几种联系都列出）
            if (result.forceLabel !== true && !result.hidden && result.alwaysLabel === true) result.label = data.shortLabel;
            if (labelWaits(data.bornAt)) result.label = "";
            return result;
        }) as never,
        zIndex: true,
        // 取景只看点不看名字：留足边距，环形排版左右两侧朝外的名字才不会被裁掉
        stagePadding: stagePadding(),
        minCameraRatio: 0.06,
        maxCameraRatio: 3,
    });
    // 线上的字互相避让：每画一帧前清空已占的位置
    sigma.on("beforeRender", drawEdgeLabel.reset);
    bindEvents(sigma, graph);
    fitted = null;
    if (props.ego === null) refit(false);
    applyQuery();
    if (props.neighborhood && focus.selected !== null) enterNeighborhood();
}

/**
 * 悬停、点选与拖动。按下一个点时先记下它，鼠标移动超过几个像素才算拖动：拖动结束不算点选，免得拖完就打开人物卡。
 * 拖动时固定取景范围（custom bbox），否则 Sigma 每帧按新的外框重新取景，整张图会跟着跑。
 */
function bindEvents(instance: Sigma, target: Graph): void {
    let dragged: string | null = null;
    let moved = false;
    let downAt: {x: number; y: number} | null = null;
    instance.on("enterNode", ({node}) => {
        if (dragged !== null) return;
        focus!.hovered = node;
        host.value!.style.cursor = "grab";
        instance.refresh({skipIndexation: true});
    });
    instance.on("leaveNode", () => {
        if (dragged !== null) return;
        focus!.hovered = null;
        host.value!.style.cursor = "";
        instance.refresh({skipIndexation: true});
    });
    instance.on("downNode", ({node, event}) => {
        // 只有左键拖点：右键按下是为了开上下文菜单，菜单开着时鼠标一动点就跟着走（反馈第 3 条）。
        if ((event.original as MouseEvent).button > 0) return;
        // 页面上已有的文字选区会让浏览器把这次按下当成拖文字，点就拖不动了：先清掉选区、拦下默认行为。
        window.getSelection()?.removeAllRanges();
        event.original.preventDefault();
        dragged = node;
        moved = false;
        downAt = {x: event.x, y: event.y};
        stopAnimation?.();
        if (instance.getCustomBBox() === null) instance.setCustomBBox(instance.getBBox());
    });
    const captor = instance.getMouseCaptor();
    captor.on("mousemovebody", (event) => {
        if (dragged === null || downAt === null) return;
        // 松开发生在图外或被菜单吞掉时 mouseup 到不了这里：按键已不是左键就收住，不再拖。
        if (event.original instanceof MouseEvent && (event.original.buttons & 1) === 0) {
            dragged = null;
            downAt = null;
            return;
        }
        if (!moved && Math.hypot(event.x - downAt.x, event.y - downAt.y) < 4) return;
        moved = true;
        host.value!.style.cursor = "grabbing";
        // 拖动途中新数据回来、被拖的点恰好被去掉：收住拖动
        if (!target.hasNode(dragged)) {
            dragged = null;
            downAt = null;
            return;
        }
        const position = instance.viewportToGraph(event);
        target.mergeNodeAttributes(dragged, {x: position.x, y: position.y});
        event.preventSigmaDefault();
        event.original.preventDefault();
        event.original.stopPropagation();
    });
    captor.on("mouseup", () => {
        if (dragged !== null && moved) host.value!.style.cursor = "grab";
        dragged = null;
        downAt = null;
    });
    instance.on("clickNode", ({node}) => {
        if (moved) {
            moved = false;
            return;
        }
        focus!.selected = node;
        instance.refresh({skipIndexation: true});
        if (props.neighborhood) enterNeighborhood();
        else if (props.layout === "concentric") relayout(false);
        emit("select", node);
    });
    // 双击打开，不做 Sigma 默认的双击放大。
    instance.on("doubleClickNode", ({node, event}) => {
        event.preventSigmaDefault();
        emit("open", node);
    });
    instance.on("rightClickNode", ({node, event}) => {
        event.original.preventDefault();
        if (focus!.selected !== node) {
            focus!.selected = node;
            instance.refresh({skipIndexation: true});
            if (props.neighborhood) enterNeighborhood();
            emit("select", node);
        }
        const original = event.original as MouseEvent;
        emit("menu", {id: node, x: original.clientX, y: original.clientY});
    });
    instance.on("clickStage", () => {
        if (focus!.selected === null) return;
        focus!.selected = null;
        instance.refresh({skipIndexation: true});
        leaveNeighborhood();
        emit("clear");
    });
}

/** 图上的快捷键：监听挂在图的根元素上，焦点在图上才生效（输入框里的 Escape、Enter 不受影响）。 */
function onKey(event: KeyboardEvent): void {
    if (focus === null || focus.selected === null || sigma === null) return;
    if (event.key === "Enter") {
        event.preventDefault();
        emit("open", focus.selected);
        return;
    }
    if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        emit("neighborhood", !props.neighborhood);
        return;
    }
    if (event.key !== "Escape") return;
    focus.selected = null;
    sigma.refresh({skipIndexation: true});
    leaveNeighborhood();
    emit("clear");
}

/** “只看选中的周边”：镜头框住选中的点和它的邻居。 */
function fitNeighborhood(): void {
    if (sigma === null || focus === null || focus.selected === null || graph === null) return;
    if (!graph.hasNode(focus.selected)) return;
    void fitViewportToNodes(sigma, [focus.selected, ...graph.neighbors(focus.selected)], {animate: true});
}

/** 搜索命中的点：按名字、其他称呼（情节按标题）包含匹配；没有查询时为 null。 */
function matchesOf(target: Graph): Set<string> | null {
    const query = props.query.trim();
    return query === "" ? null : new Set(target.filterNodes((_, attributes) => String(attributes.fullLabel ?? attributes.label).includes(query) || ((attributes.names as readonly string[] | undefined) ?? []).some((name) => name.includes(query))));
}

/** 搜索：命中的点高亮，镜头移到第一个命中的点。 */
function applyQuery(): void {
    if (sigma === null || focus === null || graph === null) return;
    focus.matches = matchesOf(graph);
    sigma.refresh({skipIndexation: true});
    const first = focus.matches?.values().next().value;
    if (first !== undefined) {
        const position = sigma.getNodeDisplayData(first);
        if (position !== undefined) void sigma.getCamera().animate({x: position.x, y: position.y, ratio: 0.45}, {duration: 400});
    }
}

function toggleFullscreen(): void {
    if (document.fullscreenElement !== null) void document.exitFullscreen();
    else void root.value?.requestFullscreen();
}

const themeReady = ref(0);
const legend = computed(() => {
    if (themeReady.value === 0 || theme === null) return [];
    if (props.mode === "data") {
        return [{label: "人物", color: kindColor("person")}, {label: "组织", color: kindColor("group")}, {label: "物品", color: kindColor("item")},
            {label: "主线", color: kindColor("arc")}, {label: "情节", color: kindColor("episode")}, {label: "秘密", color: kindColor("secret")},
            {label: "悬念", color: kindColor("question")}]
            .filter((item) => !(item.label === "悬念" && props.hiddenTypes.includes("question")) && !(item.label === "秘密" && props.hiddenTypes.includes("secret")));
    }
    const KIND: Record<string, string> = {person: "人物", group: "组织", item: "物品", place: "地点", task: "任务", concept: "概念"};
    const present = new Set(props.nodes.map((node) => node.kind === "persona" ? "person" : node.kind));
    return Object.entries(KIND).filter(([kind]) => present.has(kind)).map(([kind, label]) => ({label, color: kindColor(kind)}));
});

let observer: ResizeObserver | null = null;
let lastSize = "";
let resizeFrame: number | null = null;
const layoutMotion = useLayoutMotion();
/** 分栏过渡期间收到的尺寸变化先记下，过渡结束后再换（见 host/motion.ts）。 */
let resizePending = false;
function resizeCanvas(): void {
    if (layoutMotion.value) {
        resizePending = true;
        return;
    }
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (sigma === null) return;
        // 排版按铺满时的画布比例排的：画布变宽变窄后，没动过镜头的就重新铺满，免得图被裁掉或缩在中间
        const atFit = props.ego === null && isFitted(sigma, fitted);
        sigma.resize();
        if (atFit) refit(false);
        sigma.refresh();
    });
}
watch(layoutMotion, (moving) => {
    if (moving || !resizePending) return;
    resizePending = false;
    resizeCanvas();
});
onMounted(() => {
    // 容器在 Splitter 量好尺寸之前是 0：有了尺寸才排版。之后尺寸变了（收起、展开右侧栏，拖分隔条，全屏）
    // Sigma 不会自己发现，要调 resize 重设画布大小再重画（输出 27）。一帧里最多重设一次；分栏收起、展开的过渡期间
    // 不换，结束后换一次（输出 1）。
    observer = new ResizeObserver(([entry]) => {
        const size = `${Math.round(entry!.contentRect.width)}x${Math.round(entry!.contentRect.height)}`;
        if (size === lastSize || entry!.contentRect.width === 0 || entry!.contentRect.height === 0) return;
        const first = lastSize === "";
        lastSize = size;
        if (first) {
            render();
            themeReady.value += 1;
            return;
        }
        resizeCanvas();
    });
    if (host.value !== null) observer.observe(host.value);
});
// 换用法（人物卡小图、关系图、全书图）整张重画，由排版重新决定位置；点与线的数据变了（换阅读位置、视角、类别）原地改图、
// 点从当前位置接着排（`syncData`）；只换连线的层或同场门槛时换线、重新排版，点从原位置滑到新位置（输出 24）
watch(() => [props.ego, props.mode], () => { if (lastSize !== "") render("fresh"); });
watch(() => [props.hiddenTypes.join(","), props.nodes, props.edges, props.dataEdges], () => { if (lastSize !== "") syncData(); });
// 换明暗：Sigma 的颜色在绘制时读一次，要按新颜色重画，位置不动。
watch(appearance, () => {
    if (lastSize === "") return;
    render("keep");
    themeReady.value += 1;
});
watch(() => [props.layers.join(","), props.minCo], () => {
    if (sigma === null || graph === null || props.mode !== "relation") return;
    fillRelationEdges(graph);
    sigma.refresh();
    relayout(false);
});
watch(() => props.layout, () => relayout(true));
watch(() => props.relayoutKey, () => relayout(true));
watch(() => props.selected, (value) => {
    if (sigma === null || focus === null || graph === null) return;
    const next = value !== null && graph.hasNode(value) ? value : null;
    if (next === focus.selected && (next === null || !props.neighborhood)) return;
    focus.selected = next;
    sigma.refresh({skipIndexation: true});
    if (!props.neighborhood) return;
    if (next === null) leaveNeighborhood();
    else enterNeighborhood();
});
watch(() => props.neighborhood, (value) => {
    if (sigma === null || focus === null) return;
    focus.onlyNeighborhood = value;
    sigma.refresh({skipIndexation: true});
    if (value) enterNeighborhood();
    else leaveNeighborhood();
});
watch(() => props.query, applyQuery);
onBeforeUnmount(() => { observer?.disconnect(); if (resizeFrame !== null) cancelAnimationFrame(resizeFrame); if (fadeFrame !== null) cancelAnimationFrame(fadeFrame); stopAnimation?.(); sigma?.kill(); });
</script>

<template>
    <!-- 按下画布时把焦点从“在图里找”等输入框移到图上，图的快捷键才生效（见 onKey）。画布上不弹浏览器自己的右键菜单，
         也不让这次 contextmenu 冒泡到 document：nb-ui 的 ContextMenu 在 document 上监听“外部右键”，会把刚打开的菜单关掉。 -->
    <div
        ref="root" class="story-graph" tabindex="-1" :style="{'--know-color': themeReady > 0 && theme ? fixedColors(theme).know : 'transparent'}"
        @pointerdown="root?.focus({preventScroll: true})" @keydown="onKey" @contextmenu.prevent.stop
    >
        <div ref="host" class="canvas" />
        <div v-if="!compact && themeReady > 0" class="legend">
            <span v-for="item in legend" :key="item.label"><i :style="{borderColor: item.color}" />{{ item.label }}</span>
            <template v-if="mode === 'relation'">
                <span v-if="layers.includes('relation')"><b class="line rel" />关系说法</span>
                <span v-if="layers.includes('co')"><b class="line co" />只有同场</span>
                <span v-if="layers.includes('know')"><b class="line know" />只有认知（箭头：谁知道关于谁的事）</span>
            </template>
        </div>
        <!-- 页面放进来的浮层（选中浮条）：在全屏根里，进入全屏后仍看得到。 -->
        <slot name="overlay" />
        <div v-if="!compact" class="zoom">
            <IconButton size="xs" icon-class="i-lucide-plus" aria-label="放大" @click="zoom(sigma, 'in')" />
            <IconButton size="xs" icon-class="i-lucide-minus" aria-label="缩小" @click="zoom(sigma, 'out')" />
            <IconButton size="xs" icon-class="i-lucide-scan" aria-label="铺满" @click="zoom(sigma, 'fit')" />
            <IconButton size="xs" icon-class="i-lucide-maximize" aria-label="全屏" @click="toggleFullscreen" />
        </div>
    </div>
</template>

<style scoped>
.story-graph { position: relative; width: 100%; height: 100%; background: var(--panel-surface); user-select: none; outline: none; }
.canvas { position: absolute; inset: 0; }
.legend { position: absolute; left: 10px; bottom: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 3px 8px; border-radius: 6px; background: color-mix(in srgb, var(--panel-surface) 88%, transparent); color: var(--text-secondary); font-size: var(--text-2xs); pointer-events: none; }
.legend span { display: inline-flex; align-items: center; gap: 4px; }
.legend i { width: 9px; height: 9px; border: 2px solid; border-radius: 50%; }
.legend .line { display: inline-block; width: 18px; height: 0; border-top: 2px solid; }
.legend .line.rel { border-color: var(--accent-main); }
.legend .line.co { border-color: var(--text-muted); }
.legend .line.know { border-color: var(--know-color); }
.zoom { position: absolute; right: 8px; bottom: 8px; display: flex; flex-direction: column; gap: 2px; padding: 2px; border-radius: 6px; background: color-mix(in srgb, var(--panel-surface) 88%, transparent); }
</style>
