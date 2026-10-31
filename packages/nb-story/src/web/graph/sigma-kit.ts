/**
 * 查看器里几张 Sigma 图共用的部分：主题色、标签与悬停的画法、聚焦高亮、排版（docs/specs/story/viewer.md 输出 22 到 31）。
 * 画法与排版沿用 w00024 t01 第 6 到 9 轮评审定下的草稿。
 *
 * Sigma 用 WebGL 画点和线，标签画在 canvas 上，都读不到 CSS 变量：挂载时从宿主元素上把主题色取成十六进制再交给它。
 */
import type Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type Sigma from "sigma";
import type {CameraState, NodeDisplayData, PartialButFor} from "sigma/types";

export type Theme = {
    text: string; muted: string; accent: string; success: string; warning: string; danger: string;
    divider: string; surface: string; bg: string; font: string;
    /** 暗色：主题里没有的几种类别色、泳道色要换成提亮的一组。 */
    dark: boolean;
};

/** 主题变量覆盖不到的固定色（地点、任务、主线、情节、认知线、故事线泳道），各有明暗两组。 */
export const FIXED_COLORS = {
    light: {place: "#0d9488", task: "#8b5cf6", episode: "#94a3b8", arc: "#475569", link: "#64748b", know: "#b35375", lanes: ["#2563eb", "#db2777", "#0891b2", "#7c3aed", "#ea580c", "#65a30d", "#92400e"]},
    dark: {place: "#2dd4bf", task: "#a78bfa", episode: "#94a3b8", arc: "#cbd5e1", link: "#94a3b8", know: "#f472b6", lanes: ["#60a5fa", "#f472b6", "#22d3ee", "#a78bfa", "#fb923c", "#a3e635", "#fbbf24"]},
} as const;

export function fixedColors(theme: Theme) {
    return theme.dark ? FIXED_COLORS.dark : FIXED_COLORS.light;
}

function toHex(element: HTMLElement, name: string, fallback: string): string {
    const value = getComputedStyle(element).getPropertyValue(name).trim();
    if (value === "") return fallback;
    // color-mix、oklch 算出来是 color(srgb …)，Sigma 不认；画到 1×1 画布上读回像素
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", {willReadFrequently: true});
    if (context === null) return fallback;
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((part) => (part ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

export function readTheme(element: HTMLElement): Theme {
    return {
        text: toHex(element, "--text-main", "#222222"),
        muted: toHex(element, "--text-muted", "#888888"),
        accent: toHex(element, "--accent-main", "#2563eb"),
        success: toHex(element, "--status-success", "#16a34a"),
        warning: toHex(element, "--status-warning", "#d97706"),
        danger: toHex(element, "--status-danger", "#dc2626"),
        divider: toHex(element, "--divider", "#dddddd"),
        surface: toHex(element, "--panel-surface", "#ffffff"),
        bg: toHex(element, "--bg-panel", "#fafafa"),
        font: getComputedStyle(element).getPropertyValue("--font-ui").trim() || "system-ui, sans-serif",
        dark: document.documentElement.dataset.nbAppearance === "dark",
    };
}

/** 两个十六进制色按比例混合；聚焦时把无关的点淡到接近背景色，而不是用透明度（WebGL 里半透明的点叠在一起会发脏）。 */
export function mix(a: string, b: string, weight: number): string {
    const parse = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
    const [ar, ag, ab] = parse(a);
    const [br, bg, bb] = parse(b);
    const channel = (x: number, y: number) => Math.round(x * (1 - weight) + y * weight).toString(16).padStart(2, "0");
    return `#${channel(ar!, br!)}${channel(ag!, bg!)}${channel(ab!, bb!)}`;
}

/** 带透明度的颜色。Sigma 3 不认八位十六进制（#rrggbbaa），要写成 rgba()。 */
export function alpha(hex: string, value: number): string {
    const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${value})`;
}

type LabelData = PartialButFor<NodeDisplayData, "x" | "y" | "size" | "label" | "color"> & {labelSide?: "left" | "right"; fullLabel?: string; bold?: boolean; dim?: boolean};

/** 带描边的文字（参照 viewer-v7）：先用背景色描一圈粗边，再写字，压在线上也看得清，又不像底色块那样挡住线。 */
function haloText(context: CanvasRenderingContext2D, theme: Theme, text: string, x: number, y: number, color: string): void {
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = theme.surface;
    context.strokeText(text, x, y);
    context.fillStyle = color;
    context.fillText(text, x, y);
}

/** 标签：带描边的文字，画在点的右边；`labelSide: "left"` 时画在左边（放射布局左半边的点用）。 */
export function labelDrawer(theme: Theme) {
    return (context: CanvasRenderingContext2D, data: LabelData, settings: {labelSize: number; labelFont: string; labelWeight: string}): void => {
        if (!data.label) return;
        const size = settings.labelSize;
        context.font = `${data.bold === true ? "700" : settings.labelWeight} ${size}px ${settings.labelFont}`;
        const width = context.measureText(data.label).width;
        const left = data.labelSide === "left";
        const x = left ? data.x - data.size - 5 - width : data.x + data.size + 5;
        haloText(context, theme, data.label, x, data.y + size / 3, data.dim === true ? mix(theme.text, theme.surface, 0.6) : theme.text);
    };
}

type EdgeLabelData = {label?: string | null; color: string; size: number; identity?: boolean};
type EndData = {x: number; y: number; size: number};

/**
 * 连线上的字横着写在线的中点，带描边；中文沿线旋转很难读。两端点离得太近、放不下字时不写；
 * 和这一帧里已经写过的字重叠时也不写，先画的占住位置；聚焦时不相干的线都隐藏了，不会和聚焦的线抢位置。
 * 每帧开始前要调 `reset`。
 */
export function edgeLabelDrawer(theme: Theme) {
    let occupied: Array<{x: number; y: number; w: number; h: number}> = [];
    const draw = (context: CanvasRenderingContext2D, edge: EdgeLabelData, source: EndData, target: EndData,
        settings: {edgeLabelSize: number; edgeLabelFont: string; edgeLabelWeight: string}): void => {
        if (!edge.label) return;
        const size = settings.edgeLabelSize;
        context.font = `${settings.edgeLabelWeight} ${size}px ${settings.edgeLabelFont}`;
        const width = context.measureText(edge.label).width;
        const length = Math.hypot(target.x - source.x, target.y - source.y) - source.size - target.size;
        // 身份线上的字（“其实是同一人”等）是视角的要点：线短、和别的字重叠时也照样写。
        if (length < width + 8 && edge.identity !== true) return;
        const box = {x: (source.x + target.x) / 2 - width / 2 - 2, y: (source.y + target.y) / 2 - size / 2 - 2, w: width + 4, h: size + 4};
        if (edge.identity !== true && occupied.some((item) => box.x < item.x + item.w && item.x < box.x + box.w && box.y < item.y + item.h && item.y < box.y + box.h)) return;
        occupied.push(box);
        haloText(context, theme, edge.label, box.x + 2, (source.y + target.y) / 2 + size / 3, theme.muted);
    };
    return Object.assign(draw, {reset: () => { occupied = []; }});
}

/** 悬停与选中（参照 viewer-v7 的选中效果）：点外一圈同色的淡光晕，名字加粗；名字换成完整的（情节标题在图上只显示前十几个字）。 */
export function hoverDrawer(theme: Theme) {
    const drawLabel = labelDrawer(theme);
    return (context: CanvasRenderingContext2D, data: LabelData, settings: {labelSize: number; labelFont: string; labelWeight: string}): void => {
        context.beginPath();
        context.arc(data.x, data.y, data.size + 6, 0, Math.PI * 2);
        context.fillStyle = alpha(data.color.startsWith("#") ? data.color : theme.accent, 0.18);
        context.fill();
        drawLabel(context, {...data, label: data.fullLabel ?? data.label, bold: true}, settings);
    };
}

/**
 * 聚焦（决定 17 第 3 条、决定 23）：悬停优先于选中。焦点和它的邻居照常显示并强制出标签；其余的点和线
 * 只是变淡（点和名字都还在，线上的字去掉），不隐藏。`onlyNeighborhood` 打开时（“只看选中的周边”）其余的点才隐藏。
 * 搜索有结果时，没命中的同样淡掉。调用方改了状态后要 `sigma.refresh({skipIndexation: true})`。
 */
/** 新出现的点和线淡入多久（毫秒）。 */
export const FADE_MS = 500;

export class Focus {
    /** 带 `bornAt` 的点和线（数据变了新出现的，`StoryNetwork.syncData`）：颜色从背景色渐变到本色，淡入完成前不写名字。 */
    private appear(result: Record<string, unknown>, bornAt: unknown): void {
        if (typeof bornAt !== "number") return;
        const t = Math.min(1, (performance.now() - bornAt) / FADE_MS);
        if (t >= 1) return;
        result.color = mix(this.theme.bg, String(result.color), t);
        if (t < 0.6) result.label = "";
    }

    private fadeEdge(result: Record<string, unknown>, data: Record<string, unknown>): void {
        result.color = mix(String(data.color), this.theme.bg, 0.65);
        result.label = "";
        result.alwaysLabel = false;
        result.zIndex = 0;
    }

    hovered: string | null = null;
    selected: string | null = null;
    matches: Set<string> | null = null;
    onlyNeighborhood = false;

    constructor(private readonly graph: Graph, private readonly theme: Theme) {}

    private active(): string | null {
        const focus = this.hovered ?? this.selected;
        return focus !== null && this.graph.hasNode(focus) ? focus : null;
    }

    private near(node: string, focus: string): boolean {
        return node === focus || this.graph.areNeighbors(node, focus);
    }

    node = (node: string, data: Record<string, unknown>): Record<string, unknown> => {
        const focus = this.active();
        const result: Record<string, unknown> = {...data};
        const fade = () => {
            result.color = mix(String(data.color), this.theme.bg, 0.6);
            result.dim = true;
            result.zIndex = 0;
        };
        if (this.onlyNeighborhood && this.selected !== null && this.graph.hasNode(this.selected) && !this.near(node, this.selected)) {
            result.hidden = true;
            return result;
        }
        if (focus !== null) {
            if (this.near(node, focus)) {
                result.forceLabel = true;
                result.zIndex = 2;
            } else fade();
        } else if (this.matches !== null && this.matches.size > 0) {
            if (this.matches.has(node)) {
                result.forceLabel = true;
                result.zIndex = 2;
            } else fade();
        }
        if (node === this.selected || node === this.hovered) {
            result.highlighted = true;
            result.ringPx = 3.5;
            result.fillColor = mix(String(data.color), this.theme.bg, 0.72);
            result.size = Number(data.size) + 1.5;
        }
        this.appear(result, data.bornAt);
        return result;
    };

    edge = (edge: string, data: Record<string, unknown>): Record<string, unknown> => {
        const focus = this.active();
        const result: Record<string, unknown> = {...data};
        if (focus !== null) {
            if (this.graph.hasExtremity(edge, focus)) {
                result.color = data.focusColor ?? data.color;
                result.size = Number(data.size ?? 1) + 1;
                result.zIndex = 1;
                result.forceLabel = Boolean(data.label);
            } else this.fadeEdge(result, data);
        } else if (this.matches !== null && this.matches.size > 0) {
            const [source, target] = this.graph.extremities(edge);
            if (!this.matches.has(source) && !this.matches.has(target)) this.fadeEdge(result, data);
        } else if (!data.alwaysLabel) result.label = "";
        this.appear(result, data.bornAt);
        return result;
    };
}

/** 确定的初始位置：按权重排好，沿黄金角螺旋摆开，权重大的靠中间。同样的数据每次排出来一样，截图和对照都稳定。 */
export function seedSpiral(graph: Graph, weight: (node: string) => number): void {
    const nodes = graph.nodes().sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
    nodes.forEach((node, index) => {
        const radius = Math.sqrt(index + 1) * 10;
        const angle = index * 2.399963;
        graph.mergeNodeAttributes(node, {x: radius * Math.cos(angle), y: radius * Math.sin(angle)});
    });
}

/**
 * 坐标完全相同的点按 id 顺序错开一点：重合的点连推开的方向都没有，结果取决于数组次序，排出来就不固定了
 * （输出 25 要求同一数据同一结果）。
 */
function separateCoincident(graph: Graph): void {
    const seen = new Map<string, number>();
    for (const node of [...graph.nodes()].sort()) {
        const x = Number(graph.getNodeAttribute(node, "x"));
        const y = Number(graph.getNodeAttribute(node, "y"));
        const key = `${x},${y}`;
        const count = seen.get(key) ?? 0;
        seen.set(key, count + 1);
        if (count > 0) graph.mergeNodeAttributes(node, {x: x + count * 0.37, y: y + count * 0.23});
    }
}

/** 放图的画布区域（像素）：容器的宽高减去 Sigma 的 `stagePadding`。排版按它的宽高比铺开、按它算点和名字占的位置。 */
export interface LayoutFrame {
    width: number;
    height: number;
}

/**
 * 力导向排版：ForceAtlas2 拉开结构，再按画布的宽高比与点、名字占的像素把重叠推开（`separateNodes`）。两步都没有随机数
 * （重合的点先错开），同一份数据、同样的起点、同样的画布总是排出同样的位置。
 */
export function layoutForce(graph: Graph, options: {frame: LayoutFrame; linLog: boolean; iterations?: number; labelWidth?: (node: string) => number}): void {
    const inferred = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, {
        iterations: options.iterations ?? 400,
        getEdgeWeight: "weight",
        settings: {...inferred, linLogMode: options.linLog, outboundAttractionDistribution: true, adjustSizes: false,
            gravity: options.linLog ? 0.4 : 1, scalingRatio: options.linLog ? 2 : 6, slowDown: 4, barnesHutOptimize: graph.order > 300},
    });
    separateNodes(graph, options);
}

/** 排版的外框拉到和画布一样的宽高比时，最多把一个方向拉长到这么多倍；再多就会把图拉成一条线。 */
const MAX_STRETCH = 3;
/** 每一轮按当前的取景比例推开重叠，最多几轮、每轮最多几遍。 */
const SEPARATE_ROUNDS = 4;
const SEPARATE_PASSES = 80;

/** 一个点在屏幕上占的矩形（相对点中心的四个方向的像素）：圆圈，加上画在右边的名字。 */
interface Footprint {
    left: number;
    right: number;
    up: number;
    down: number;
}

function extent(values: number[]): number {
    return Math.max(...values) - Math.min(...values);
}

/**
 * 把排版的外框拉到和画布一样的宽高比。镜头铺满时按外框的宽高比放进画布（`fitAll`），外框是正方形而画布是宽的，
 * 图就只占画布中间一块；先把外框拉成画布的比例，横竖两个方向才都用得上。只做仿射拉伸，点的相对次序与连线的交叉数不变。
 * 原地改 `x`、`y`。
 */
function stretchToFrame(x: number[], y: number[], frame: LayoutFrame): void {
    const wide = Math.max(extent(x), 1e-6);
    const tall = Math.max(extent(y), 1e-6);
    const want = frame.width / frame.height;
    const have = wide / tall;
    if (Math.abs(Math.log(have / want)) < 0.05) return;
    const factor = Math.min(MAX_STRETCH, Math.max(have / want, want / have));
    const target = have < want ? x : y;
    const centre = (Math.max(...target) + Math.min(...target)) / 2;
    for (let i = 0; i < target.length; i += 1) target[i] = centre + (target[i]! - centre) * factor;
}

/** 屏幕上矩形重叠的点对数。 */
function overlapCount(x: number[], y: number[], boxes: Footprint[]): number {
    let count = 0;
    for (let i = 0; i < x.length; i += 1) {
        for (let j = i + 1; j < x.length; j += 1) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            const ox = Math.min(x[i]! + a.right, x[j]! + b.right) - Math.max(x[i]! - a.left, x[j]! - b.left);
            const oy = Math.min(y[i]! + a.down, y[j]! + b.down) - Math.max(y[i]! - a.up, y[j]! - b.up);
            if (ox > 0 && oy > 0) count += 1;
        }
    }
    return count;
}

/**
 * 把重叠的矩形沿重叠少的那个方向互相推开（逐对、按点的次序，没有随机数）。`x`、`y` 是屏幕像素，原地改。
 * 返回推完后还重叠的点对数。
 */
function relaxBoxes(x: number[], y: number[], boxes: Footprint[]): number {
    const MARGIN = 2;
    for (let pass = 0; pass < SEPARATE_PASSES; pass += 1) {
        let moved = false;
        for (let i = 0; i < x.length; i += 1) {
            for (let j = i + 1; j < x.length; j += 1) {
                const a = boxes[i]!;
                const b = boxes[j]!;
                const ox = Math.min(x[i]! + a.right, x[j]! + b.right) - Math.max(x[i]! - a.left, x[j]! - b.left) + MARGIN;
                if (ox <= 0) continue;
                const oy = Math.min(y[i]! + a.down, y[j]! + b.down) - Math.max(y[i]! - a.up, y[j]! - b.up) + MARGIN;
                if (oy <= 0) continue;
                moved = true;
                // 两个矩形的中心谁在左（上）谁往左（上）退；中心重合时按次序，保证结果固定。
                if (ox < oy) {
                    const dir = x[i]! + (a.right - a.left) / 2 <= x[j]! + (b.right - b.left) / 2 ? -1 : 1;
                    x[i] = x[i]! + (dir * ox) / 2;
                    x[j] = x[j]! - (dir * ox) / 2;
                } else {
                    const dir = y[i]! <= y[j]! ? -1 : 1;
                    y[i] = y[i]! + (dir * oy) / 2;
                    y[j] = y[j]! - (dir * oy) / 2;
                }
            }
        }
        if (!moved) return 0;
    }
    return overlapCount(x, y, boxes);
}

/**
 * 按画布的宽高比与点、名字占的像素把点推开（力导向与应力排版共用）。
 *
 * 点的大小和名字都是屏幕像素，而排版在图坐标里：镜头铺满时每个图坐标单位占 `min(画布宽 / 外框宽, 画布高 / 外框高)` 个像素
 * （`fitAll`）。先把外框拉成画布的宽高比，再按这个比例换算成像素，把“圆圈加右边的名字”这样的矩形互相推开，换回图坐标。
 * 推开会让外框变大、每单位占的像素变小，所以按新的比例再推一轮，直到不重叠或到轮数上限。图太大、画布放不下时
 * 到上限仍有重叠，只记一条诊断。
 */
function separateNodes(graph: Graph, options: {frame: LayoutFrame; labelWidth?: (node: string) => number}): void {
    if (graph.order < 2) return;
    separateCoincident(graph);
    const ids = [...graph.nodes()].sort();
    const boxes: Footprint[] = ids.map((id) => footprint(graph.getNodeAttributes(id), options.labelWidth?.(id) ?? 0));
    const x = ids.map((id) => Number(graph.getNodeAttribute(id, "x")));
    const y = ids.map((id) => Number(graph.getNodeAttribute(id, "y")));
    let remaining = 0;
    for (let round = 0; round < SEPARATE_ROUNDS; round += 1) {
        // 推开时多半沿竖向（名字又宽又扁），外框会越推越高：每一轮先按画布的比例拉回来
        stretchToFrame(x, y, options.frame);
        const scale = Math.min(options.frame.width / Math.max(extent(x), 1e-6), options.frame.height / Math.max(extent(y), 1e-6));
        const px = x.map((value) => value * scale);
        const py = y.map((value) => value * scale);
        remaining = relaxBoxes(px, py, boxes);
        for (let i = 0; i < x.length; i += 1) {
            x[i] = px[i]! / scale;
            y[i] = py[i]! / scale;
        }
        if (remaining === 0) break;
    }
    ids.forEach((id, index) => graph.mergeNodeAttributes(id, {x: x[index]!, y: y[index]!}));
    if (remaining > 0) console.warn({nodes: graph.order, overlapping: remaining}, "排版到上限仍有点重叠");
}

/** 一个点在屏幕上占的矩形：圆圈，加上强制出名字时画在右边的名字（`labelWidth` 是名字估出来的宽度，已含左右余量）。 */
function footprint(attributes: Record<string, unknown>, labelWidth: number): Footprint {
    const size = Number(attributes.size);
    const label = attributes.forceLabel === true ? 5 + labelWidth : 0;
    return {left: size + 3, right: size + 3 + label, up: Math.max(size, 8) + 2, down: Math.max(size, 8) + 2};
}

/** 强制出名字的点，名字框合起来最多占画布面积的多少。再多，名字怎么排都叠在一起。 */
const LABEL_BUDGET = 0.3;

/**
 * 挑出强制出名字的点（`forceLabel`）：先放一定要出的（`pinned`），再按权重从大到小，直到名字框的面积合计到画布的
 * `LABEL_BUDGET`。点少的图名字全出；点多的图只出主要的，其余的名字等放大、悬停或选中时出（Sigma 按格子去重，
 * 放大后格子里的点变少）。排版按这个结果留位置，所以要在排版之前调。
 */
export function chooseForcedLabels(graph: Graph, frame: LayoutFrame, options: {pinned: ReadonlySet<string>; labelWidth: (node: string) => number}): void {
    const area = (node: string) => {
        const box = footprint({size: graph.getNodeAttribute(node, "size"), forceLabel: true}, options.labelWidth(node));
        return (box.left + box.right) * (box.up + box.down);
    };
    const order = graph.nodes().sort((a, b) => Number(options.pinned.has(b)) - Number(options.pinned.has(a)) || Number(graph.getNodeAttribute(b, "weight")) - Number(graph.getNodeAttribute(a, "weight")) || a.localeCompare(b));
    let used = 0;
    const budget = LABEL_BUDGET * frame.width * frame.height;
    for (const node of order) {
        used += area(node);
        graph.setNodeAttribute(node, "forceLabel", options.pinned.has(node) || used <= budget);
    }
}

/** 应力排版超过这么多个点就改用力导向：每轮要算全部点对，点数的平方乘迭代次数。 */
export const STRESS_MAX_NODES = 400;

/**
 * 应力排版（SMACOF 应力最小化）：点与点在画面上的距离逼近它们在图里的最短路径跳数，所以连着的点靠得近、线短而匀、
 * 不相干的点自然分开，线与线交叉、线穿过别的点都比力导向少（w00024 t21 评审板的对比：108 条线的真实图，交叉最少）。
 * 起点沿用点现在的位置（调用方先给螺旋起点），没有随机数，同样的起点总是排出同样的位置。不连通的点按“最远的跳数加一”
 * 摆开。点数超过 `STRESS_MAX_NODES` 时退回力导向。
 */
export function layoutStress(graph: Graph, options: {frame: LayoutFrame; labelWidth?: (node: string) => number; iterations?: number}): void {
    const ids = graph.nodes();
    const n = ids.length;
    if (n > STRESS_MAX_NODES) {
        layoutForce(graph, {frame: options.frame, linLog: false, ...(options.labelWidth === undefined ? {} : {labelWidth: options.labelWidth})});
        return;
    }
    if (n < 2) return;
    const index = new Map(ids.map((id, i) => [id, i]));
    // 全部点对的最短路径跳数（逐点广度优先）；够不到的先记 -1，之后换成最大跳数加一。
    const dist = Array.from({length: n}, () => new Array<number>(n).fill(-1));
    let longest = 1;
    for (let source = 0; source < n; source += 1) {
        const row = dist[source]!;
        row[source] = 0;
        let frontier = [source];
        while (frontier.length > 0) {
            const next: number[] = [];
            for (const node of frontier) {
                for (const other of graph.neighbors(ids[node]!)) {
                    const at = index.get(other)!;
                    if (row[at] === -1) {
                        row[at] = row[node]! + 1;
                        longest = Math.max(longest, row[at]!);
                        next.push(at);
                    }
                }
            }
            frontier = next;
        }
    }
    const far = longest + 1;
    const x = ids.map(id => Number(graph.getNodeAttribute(id, "x")));
    const y = ids.map(id => Number(graph.getNodeAttribute(id, "y")));
    const scratchX = new Array<number>(n);
    const scratchY = new Array<number>(n);
    for (let iteration = 0; iteration < (options.iterations ?? 300); iteration += 1) {
        for (let i = 0; i < n; i += 1) {
            let weightSum = 0;
            let sumX = 0;
            let sumY = 0;
            for (let j = 0; j < n; j += 1) {
                if (i === j) continue;
                const target = dist[i]![j]! < 0 ? far : dist[i]![j]!;
                const weight = 1 / (target * target);
                const dx = x[i]! - x[j]!;
                const dy = y[i]! - y[j]!;
                const length = Math.hypot(dx, dy) || 1e-6;
                sumX += weight * (x[j]! + (target * dx) / length);
                sumY += weight * (y[j]! + (target * dy) / length);
                weightSum += weight;
            }
            scratchX[i] = sumX / weightSum;
            scratchY[i] = sumY / weightSum;
        }
        for (let i = 0; i < n; i += 1) {
            x[i] = scratchX[i]!;
            y[i] = scratchY[i]!;
        }
    }
    ids.forEach((id, i) => graph.mergeNodeAttributes(id, {x: x[i]!, y: y[i]!}));
    separateNodes(graph, options);
}

/** 中文标签的大致像素宽度：按字号逐字估，用于给强制出标签的点留位置。 */
export function estimateLabelWidth(label: string, size: number): number {
    let width = 0;
    for (const char of label) width += char.charCodeAt(0) > 0x2e80 ? size : size * 0.6;
    return width + 12;
}

/**
 * 镜头铺满全部点：外框按自己的宽高比放进画布。Sigma 的默认镜头（`animatedReset`）把外框的长边放进画布的短边，
 * 宽画布上图只占中间一块；`stagePadding` 仍然留着（名字画在点的右边，要留出地方）。
 * `animate` 为 false 时直接设，给第一次画用。
 */
export function fitAll(sigma: Sigma, animate: boolean): CameraState | null {
    const nodes = sigma.getGraph().nodes();
    if (nodes.length === 0) return null;
    // 在 Sigma 的“框住的图坐标”里量点的外框；ratio 为 1 时一个框住的图坐标单位占几个像素（两个方向相同）要问 Sigma，
    // 它按画布的短边和 stagePadding 换算。ratio 越大看到的越多，所以铺满要的 ratio 是外框占的像素除以画布能放的像素。
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
        const data = sigma.getNodeDisplayData(node);
        if (data === undefined) continue;
        minX = Math.min(minX, data.x);
        maxX = Math.max(maxX, data.x);
        minY = Math.min(minY, data.y);
        maxY = Math.max(maxY, data.y);
    }
    if (!Number.isFinite(minX)) return null;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const probe = {x: cx, y: cy, ratio: 1, angle: 0};
    const origin = sigma.framedGraphToViewport({x: cx, y: cy}, {cameraState: probe});
    const unit = sigma.framedGraphToViewport({x: cx + 1, y: cy}, {cameraState: probe});
    const pixels = Math.abs(unit.x - origin.x);
    const {width, height} = sigma.getDimensions();
    const padding = sigma.getSetting("stagePadding") ?? 0;
    const ratio = Math.max(((maxX - minX) * pixels) / Math.max(1, width - 2 * padding), ((maxY - minY) * pixels) / Math.max(1, height - 2 * padding), 1e-3);
    const state = {x: cx, y: cy, ratio, angle: 0};
    if (animate) void sigma.getCamera().animate(state, {duration: 300});
    else sigma.getCamera().setState(state);
    return state;
}

/** 镜头还在 `fitAll` 给的位置（用户没缩放、没平移过）。 */
export function isFitted(sigma: Sigma, fitted: CameraState | null): boolean {
    if (fitted === null) return false;
    const now = sigma.getCamera().getState();
    return Math.abs(now.x - fitted.x) < 1e-3 && Math.abs(now.y - fitted.y) < 1e-3 && Math.abs(now.ratio - fitted.ratio) < 1e-3 * Math.max(1, fitted.ratio);
}

/** 图下方的缩放按钮。 */
export function zoom(sigma: Sigma | null, direction: "in" | "out" | "fit"): void {
    const camera = sigma?.getCamera();
    if (sigma === null || camera === undefined) return;
    if (direction === "in") void camera.animatedZoom({duration: 200});
    else if (direction === "out") void camera.animatedUnzoom({duration: 200});
    else fitAll(sigma, true);
}

/** 同心圆：中心是给定的点（选中的人，没选就是关系最多的人），一圈是一跳邻居，二圈是两跳……每圈内按关系多少排。 */
export function layoutConcentric(graph: Graph, center: string): void {
    const depth = new Map<string, number>([[center, 0]]);
    let frontier = [center];
    while (frontier.length > 0) {
        const next: string[] = [];
        for (const node of frontier) {
            for (const other of graph.neighbors(node)) {
                if (!depth.has(other)) {
                    depth.set(other, depth.get(node)! + 1);
                    next.push(other);
                }
            }
        }
        frontier = next;
    }
    const maxDepth = Math.max(0, ...depth.values()) + 1;
    const rings = new Map<number, string[]>();
    graph.forEachNode((node) => {
        const level = depth.get(node) ?? maxDepth;
        rings.set(level, [...(rings.get(level) ?? []), node]);
    });
    // 半径：每一圈至少放得下它的点（相邻两点弧长不小于 ARC），且比里一圈至少大 RING_GAP；不然一圈里点多时挤成一团、
    // 名字叠在一起。
    const ARC = 5.5;
    const RING_GAP = 14;
    let previous = 0;
    for (const [level, nodes] of [...rings].sort((a, b) => a[0] - b[0])) {
        nodes.sort((a, b) => graph.degree(b) - graph.degree(a) || a.localeCompare(b));
        const radius = level === 0 ? 0 : Math.max(level * RING_GAP, (nodes.length * ARC) / (2 * Math.PI), previous + RING_GAP);
        previous = radius;
        nodes.forEach((node, index) => {
            const angle = Math.PI / 2 - index * 2 * Math.PI / nodes.length + level * 0.35;
            graph.mergeNodeAttributes(node, {x: Math.cos(angle) * radius, y: Math.sin(angle) * radius});
        });
    }
}

/** 环形：所有点排成一圈，同类别的挨着、类别内按关系多少排；名字朝圈外写（左半边写在点的左边）。点和字都不会叠在一起。 */
export function layoutCircle(graph: Graph, group: (node: string) => string): void {
    const nodes = graph.nodes().sort((a, b) => group(a).localeCompare(group(b)) || graph.degree(b) - graph.degree(a) || a.localeCompare(b));
    const radius = Math.max(10, nodes.length * 1.4);
    nodes.forEach((node, index) => {
        const angle = Math.PI / 2 - index * 2 * Math.PI / nodes.length;
        graph.mergeNodeAttributes(node, {x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, labelSide: Math.cos(angle) < -0.15 ? "left" : "right"});
    });
}
