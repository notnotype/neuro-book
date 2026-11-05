/**
 * 时间约束网络（docs/specs/canon/time.md 输出 1、2、10、17）：差分约束（STN）。每条约束是 `to - from ∈ [lo, hi]`，拆成两条带权边：
 * `from → to` 权 `hi`（to - from ≤ hi）、`to → from` 权 `-lo`（from - to ≤ -lo）；无穷的那一边不建边。
 *
 * - 分量只按事件之间的约束划：日期说法是一件事对元年的常量约束，不把两件都有日期的事连起来。每个分量各带一份元年；逐分量求与
 *   整体求等价（约束只有差分形式，每个分量的解可以各自平移），这样一条日期打架只影响它所在的分量（输出 2）。
 * - 每个分量：队列版 Bellman-Ford 从“到每个节点距离 0 的虚源”出发求势；某个节点进队的次数超过节点数就有负环，在前驱图里取出环。
 *   有环就标掉环上的约束再求，最多取 20 个环；有环的分量里的事都不可确定。
 * - 可行的分量按势重赋权（边权都不小于 0），从元年（没有锚时从分量里安放最早的事）正反各跑一次 Dijkstra 得到最早与最晚；
 *   依据走紧边（`d(u) + w = d(v)`），跳数少的优先、再按约束的先后，结果不随处理次序变（输出 10）。
 */

import type {Edge, Endpoint, Lowered, StatementInvalid} from "./statements";

/** 网络里的一个点：元年，或一件事的起点、终点。 */
export type NodeRef = {readonly kind: "origin"} | {readonly kind: "event"; readonly id: string; readonly edge: Edge};

/** 解析好端点的约束；`ref` 是它来自的那条说法的键（打架与依据里列的就是它）。 */
export interface NetworkConstraint {
    readonly from: NodeRef;
    readonly to: NodeRef;
    readonly lo: number;
    readonly hi: number;
    readonly ref: string;
}

/** 组网的输入：一件事（安放的先后排好）与它的说法降好的结果。 */
export interface NetworkEventInput {
    readonly id: string;
    readonly statements: readonly {readonly ref: string; readonly lowered: Lowered}[];
}

export type EndpointInvalid = "target-missing" | "birth-ambiguous";

export interface AssembledNetwork {
    readonly events: readonly string[];
    readonly constraints: readonly NetworkConstraint[];
    /** 不成立的说法（输出 3 与输出 17）。`involves` 是除说法所在的事以外牵涉的事（`birth-ambiguous` 时是那几件出生事件）。 */
    readonly invalid: readonly {readonly event: string; readonly ref: string; readonly reason: StatementInvalid | EndpointInvalid; readonly involves?: readonly string[]}[];
    /** 每个人（本体）在这份事件集里的出生事件。 */
    readonly births: ReadonlyMap<string, readonly string[]>;
}

/**
 * 组网（输出 17）：`of` 指向的变更不在事件集里时这条说法不进网络、不报；变更已经不存在（`exists` 为假）时报 `target-missing`。
 * `who` 按 `bodyOf` 归到本体；一个人几件出生事件时关于他的 `age` 不进网络、报 `birth-ambiguous`；没有出生事件的不进、不报。
 */
export function assembleNetwork(input: {readonly events: readonly NetworkEventInput[]; readonly exists: (change: string) => boolean; readonly bodyOf: (entry: string) => string}): AssembledNetwork {
    const inSet = new Set(input.events.map((event) => event.id));
    const births = new Map<string, string[]>();
    for (const event of input.events) {
        for (const statement of event.statements) {
            if (statement.lowered.kind !== "birth") continue;
            const who = input.bodyOf(statement.lowered.who);
            append(births, who, event.id);
        }
    }
    const constraints: NetworkConstraint[] = [];
    const invalid: {event: string; ref: string; reason: StatementInvalid | EndpointInvalid; involves?: readonly string[]}[] = [];
    for (const event of input.events) {
        for (const statement of event.statements) {
            const lowered = statement.lowered;
            if (lowered.kind === "invalid") {
                invalid.push({event: event.id, ref: statement.ref, reason: lowered.reason});
                continue;
            }
            if (lowered.kind === "birth") continue;
            const resolved: NetworkConstraint[] = [];
            let skip: EndpointInvalid | "absent" | null = null;
            let involves: readonly string[] = [];
            const resolve = (endpoint: Endpoint): NodeRef | null => {
                if (endpoint.kind === "origin") return endpoint;
                if (endpoint.kind === "birth") {
                    const found = births.get(input.bodyOf(endpoint.who)) ?? [];
                    if (found.length === 1) return {kind: "event", id: found[0]!, edge: "start"};
                    skip = found.length === 0 ? "absent" : "birth-ambiguous";
                    involves = found;
                    return null;
                }
                const id = endpoint.event === "self" ? event.id : endpoint.event;
                if (inSet.has(id)) return {kind: "event", id, edge: endpoint.edge};
                skip = input.exists(id) ? "absent" : "target-missing";
                return null;
            };
            for (const template of lowered.constraints) {
                const from = resolve(template.from);
                const to = resolve(template.to);
                if (from === null || to === null) break;
                resolved.push({from, to, lo: template.lo, hi: template.hi, ref: statement.ref});
            }
            if (skip === null) constraints.push(...resolved);
            else if (skip !== "absent") invalid.push({event: event.id, ref: statement.ref, reason: skip, ...(involves.length === 0 ? {} : {involves})});
        }
    }
    return {events: input.events.map((event) => event.id), constraints, invalid, births};
}

/** 依据：从源头起的说法的键，最多 20 条，另给总数。 */
export interface RangeBasis {
    readonly refs: readonly string[];
    readonly total: number;
}

export type EventRange =
    | {readonly state: "unconstrained"}
    | {readonly state: "conflict"; readonly conflicts: readonly number[]}
    | {readonly state: "ok"; readonly anchored: boolean; readonly relativeTo?: string; readonly lo: number; readonly hi: number; readonly earliest: RangeBasis; readonly latest: RangeBasis};

export type EventBounds =
    | {readonly state: "unconstrained"}
    | {readonly state: "conflict"; readonly conflicts: readonly number[]}
    | {readonly state: "ok"; readonly anchored: boolean; readonly relativeTo?: string; readonly lo: number; readonly hi: number};

export type Between =
    | {readonly state: "unrelated"}
    | {readonly state: "conflict"}
    | {readonly state: "ok"; readonly lo: number; readonly hi: number};

/** 一个打架的环：环上的说法（按约束的先后，去重）与涉及的事。 */
export interface Conflict {
    readonly refs: readonly string[];
    readonly events: readonly string[];
}

export interface TimeNetwork {
    readonly events: readonly string[];
    readonly conflicts: readonly Conflict[];
    /** 一件事起点（或终点）的范围与依据。 */
    range(event: string, edge?: Edge): EventRange;
    /** 只要范围、不要依据（对不上、一章的范围这类要扫全部事件的用它）。 */
    bounds(event: string, edge?: Edge): EventBounds;
    /** `b - a`（两件事的起点）的范围。 */
    between(a: string, b: string): Between;
    /** 事件所在分量的编号；不在网络里时为 undefined。 */
    component(event: string): number | undefined;
}

export const MAX_CYCLES_PER_COMPONENT = 20;
const BASIS_LIMIT = 20;

/** 往按键分桶的表里追加一项（包内用；不要写成整段复制的 `[...old, value]`，桶大时是平方级）。 */
export function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const bucket = map.get(key);
    if (bucket === undefined) map.set(key, [value]);
    else bucket.push(value);
}

interface Edge_ {
    readonly from: number;
    readonly to: number;
    readonly weight: number;
    /** 约束的下标；`e ≥ s` 的隐含边为 -1。 */
    readonly constraint: number;
}

interface Component {
    readonly id: number;
    /** 本分量的节点（全局编号），最后一个是本分量的元年。 */
    readonly nodes: readonly number[];
    readonly origin: number;
    readonly anchored: boolean;
    /** 没有锚时的原点（安放最早的事的起点）。 */
    readonly root: number;
    readonly rootEvent: string;
    readonly edges: readonly Edge_[];
    readonly conflicts: readonly number[];
    readonly potential: Map<number, number>;
    readonly constrained: boolean;
}

/** 二叉堆（Dijkstra 用）：按距离、再按节点编号，结果确定。 */
class Heap {
    readonly #items: [number, number][] = [];
    push(distance: number, node: number): void {
        const items = this.#items;
        items.push([distance, node]);
        let index = items.length - 1;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (!less(items[index]!, items[parent]!)) break;
            [items[index], items[parent]] = [items[parent]!, items[index]!];
            index = parent;
        }
    }
    pop(): [number, number] | undefined {
        const items = this.#items;
        if (items.length === 0) return undefined;
        const top = items[0]!;
        const last = items.pop()!;
        if (items.length > 0) {
            items[0] = last;
            let index = 0;
            for (;;) {
                const left = index * 2 + 1;
                const right = left + 1;
                let smallest = index;
                if (left < items.length && less(items[left]!, items[smallest]!)) smallest = left;
                if (right < items.length && less(items[right]!, items[smallest]!)) smallest = right;
                if (smallest === index) break;
                [items[index], items[smallest]] = [items[smallest]!, items[index]!];
                index = smallest;
            }
        }
        return top;
    }
}
const less = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

export function solveNetwork(input: {readonly events: readonly string[]; readonly constraints: readonly NetworkConstraint[]}): TimeNetwork {
    // ---------- 节点 ----------
    // 只有写了 `lasts` 的事有终点节点（它降成“自己的起点到自己的终点”的约束）；没有的，终点就是起点（输入表“没有这条说法时
    // E.e = E.s”），别的说法指到它的终点时解析成它的起点。
    const usesEnd = new Set<string>();
    for (const {from, to} of input.constraints) if (from.kind === "event" && to.kind === "event" && from.id === to.id && from.edge === "start" && to.edge === "end") usesEnd.add(from.id);
    const startNode = new Map<string, number>();
    const endNode = new Map<string, number>();
    const eventOfNode: string[] = [];
    for (const id of input.events) {
        startNode.set(id, eventOfNode.length);
        eventOfNode.push(id);
        if (usesEnd.has(id)) {
            endNode.set(id, eventOfNode.length);
            eventOfNode.push(id);
        }
    }
    const placement = new Map(input.events.map((id, index) => [id, index]));
    const nodeOf = (ref: NodeRef): number | "origin" => (ref.kind === "origin" ? "origin" : ref.edge === "end" ? (endNode.get(ref.id) ?? startNode.get(ref.id)!) : startNode.get(ref.id)!);
    const eventCount = eventOfNode.length;

    // ---------- 分量：只按事件之间的约束（与 e、s 之间的隐含约束）合并 ----------
    const parent = Array.from({length: eventCount}, (_, index) => index);
    const find = (x: number): number => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]!]!;
            x = parent[x]!;
        }
        return x;
    };
    const union = (a: number, b: number) => {
        const [ra, rb] = [find(a), find(b)];
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    };
    for (const [id, end] of endNode) union(startNode.get(id)!, end);
    for (const constraint of input.constraints) {
        const from = nodeOf(constraint.from);
        const to = nodeOf(constraint.to);
        if (from !== "origin" && to !== "origin") union(from, to);
    }
    const groups = new Map<number, number[]>();
    for (let node = 0; node < eventCount; node += 1) {
        const root = find(node);
        append(groups, root, node);
    }

    // 每个分量的元年副本编号从 eventCount 起。
    const componentOfNode = new Int32Array(eventCount);
    const componentList: {nodes: number[]; origin: number}[] = [];
    for (const nodes of groups.values()) {
        const id = componentList.length;
        for (const node of nodes) componentOfNode[node] = id;
        componentList.push({nodes, origin: eventCount + id});
    }
    const edgesOf: Edge_[][] = componentList.map(() => []);
    const constrainedComponents = new Set<number>();
    const selfLoopConflicts: {component: number; constraint: number; node: number}[] = [];
    for (const [index, constraint] of input.constraints.entries()) {
        const fromRaw = nodeOf(constraint.from);
        const toRaw = nodeOf(constraint.to);
        const component = fromRaw !== "origin" ? componentOfNode[fromRaw]! : toRaw !== "origin" ? componentOfNode[toRaw]! : -1;
        if (component < 0) continue;
        constrainedComponents.add(component);
        const from = fromRaw === "origin" ? componentList[component]!.origin : fromRaw;
        const to = toRaw === "origin" ? componentList[component]!.origin : toRaw;
        if (from === to) {
            // 自己对自己：要求的差不含 0 就是一条说法自己成的环。
            if (constraint.lo > 0 || constraint.hi < 0) selfLoopConflicts.push({component, constraint: index, node: from});
            continue;
        }
        if (Number.isFinite(constraint.hi)) edgesOf[component]!.push({from, to, weight: constraint.hi, constraint: index});
        if (Number.isFinite(constraint.lo)) edgesOf[component]!.push({from: to, to: from, weight: -constraint.lo, constraint: index});
    }
    // 终点不早于起点（没有 `lasts` 的事终点就是起点，不建节点）。
    for (const [id, end] of endNode) edgesOf[componentOfNode[end]!]!.push({from: end, to: startNode.get(id)!, weight: 0, constraint: -1});

    // ---------- 每个分量求可行与势，取环 ----------
    const conflicts: Conflict[] = [];
    const loopsOf = new Map<number, {constraint: number; node: number}[]>();
    for (const loop of selfLoopConflicts) append(loopsOf, loop.component, loop);
    const components: Component[] = componentList.map((group, id) => {
        const edges = edgesOf[id]!;
        // 没有任何约束的分量（没有说法、也没被说法指到的事）不求解：它的事“没有约束”（大多数事是这样）。
        if (!constrainedComponents.has(id)) return {id, nodes: group.nodes, origin: group.origin, anchored: false, root: group.nodes[0]!, rootEvent: eventOfNode[group.nodes[0]!]!, edges, conflicts: [], potential: new Map(), constrained: false};
        const removed = new Set<number>();
        const mine: number[] = [];
        for (const {constraint, node} of loopsOf.get(id) ?? []) {
            removed.add(constraint);
            mine.push(conflicts.length);
            conflicts.push({refs: [input.constraints[constraint]!.ref], events: [eventOfNode[node]!]});
        }
        let potential = new Map<number, number>();
        for (let attempt = 0; ; attempt += 1) {
            const live = edges.filter((edge) => edge.constraint < 0 || !removed.has(edge.constraint));
            const result = bellmanFord([...group.nodes, group.origin], live);
            if (result.cycle === null) {
                potential = result.distance;
                break;
            }
            const constraintIds = [...new Set(result.cycle.filter((edge) => edge.constraint >= 0).map((edge) => edge.constraint))].sort((a, b) => a - b);
            for (const constraint of constraintIds) removed.add(constraint);
            mine.push(conflicts.length);
            conflicts.push({
                refs: [...new Set(constraintIds.map((constraint) => input.constraints[constraint]!.ref))],
                events: [...new Set(result.cycle.flatMap((edge) => [edge.from, edge.to]).filter((node) => node < eventCount).map((node) => eventOfNode[node]!))],
            });
            if (mine.length >= MAX_CYCLES_PER_COMPONENT) break;
        }
        const anchored = edges.some((edge) => edge.from === group.origin || edge.to === group.origin);
        const root = group.nodes.reduce((best, node) => (placement.get(eventOfNode[node]!)! < placement.get(eventOfNode[best]!)! ? node : best), group.nodes[0]!);
        return {id, nodes: group.nodes, origin: group.origin, anchored, root: startNode.get(eventOfNode[root]!)!, rootEvent: eventOfNode[root]!, edges, conflicts: mine, potential, constrained: constrainedComponents.has(id)};
    });

    // ---------- 范围与依据（按需，按分量与源缓存） ----------
    const shortest = new Map<string, {distance: Map<number, number>; adjacency: Map<number, Edge_[]>}>();
    /** 从 source 出发的最短距离（`reverse` 时在反向图上，得到各点到 source 的距离）与这个方向的邻接表。 */
    const paths = (component: Component, source: number, reverse: boolean) => {
        const key = `${String(component.id)}|${String(source)}|${String(reverse)}`;
        const cached = shortest.get(key);
        if (cached !== undefined) return cached;
        const potential = component.potential;
        const adjacency = new Map<number, Edge_[]>();
        for (const edge of component.edges) {
            const tail = reverse ? edge.to : edge.from;
            append(adjacency, tail, edge);
        }
        // 重赋权：w' = w + π(from) - π(to) ≥ 0；反向图里沿原边逆着走，权不变。
        const reduced = (edge: Edge_) => edge.weight + potential.get(edge.from)! - potential.get(edge.to)!;
        const settled = new Map<number, number>();
        const heap = new Heap();
        heap.push(0, source);
        for (let item = heap.pop(); item !== undefined; item = heap.pop()) {
            const [distance, node] = item;
            if (settled.has(node)) continue;
            settled.set(node, distance);
            for (const edge of adjacency.get(node) ?? []) {
                const next = reverse ? edge.from : edge.to;
                if (!settled.has(next)) heap.push(distance + reduced(edge), next);
            }
        }
        // 还原真实距离：正向 d(s, v) = d' - π(s) + π(v)；反向 d(v, s) = d' - π(v) + π(s)。
        const distance = new Map<number, number>();
        for (const [node, value] of settled) distance.set(node, reverse ? value - potential.get(node)! + potential.get(source)! : value - potential.get(source)! + potential.get(node)!);
        const value = {distance, adjacency};
        shortest.set(key, value);
        return value;
    };
    /** 依据要的紧边信息（最少跳数、每个点的入边），只在读依据时才算。 */
    const tightCache = new Map<string, {distance: Map<number, number>; hops: Map<number, number>; incoming: Map<number, Edge_[]>}>();
    const tight = (component: Component, source: number, reverse: boolean) => {
        const key = `${String(component.id)}|${String(source)}|${String(reverse)}`;
        const cached = tightCache.get(key);
        if (cached !== undefined) return cached;
        const {distance, adjacency} = paths(component, source, reverse);
        // 紧边上从源头起的最少跳数（宽度优先，按节点与约束的先后，确定）。
        const hops = new Map<number, number>([[source, 0]]);
        const queue = [source];
        for (let head = 0; head < queue.length; head += 1) {
            const node = queue[head]!;
            for (const edge of (adjacency.get(node) ?? []).slice().sort((a, b) => a.constraint - b.constraint)) {
                const next = reverse ? edge.from : edge.to;
                if (hops.has(next) || !isTight(edge, distance, reverse)) continue;
                hops.set(next, hops.get(node)! + 1);
                queue.push(next);
            }
        }
        // 每个点的入边（按这个方向），回溯依据时用。
        const incoming = new Map<number, Edge_[]>();
        for (const edge of component.edges) {
            const head = reverse ? edge.from : edge.to;
            append(incoming, head, edge);
        }
        const value = {distance, hops, incoming};
        tightCache.set(key, value);
        return value;
    };
    const isTight = (edge: Edge_, distance: Map<number, number>, reverse: boolean) => {
        const [tail, head] = reverse ? [edge.to, edge.from] : [edge.from, edge.to];
        const a = distance.get(tail);
        const b = distance.get(head);
        return a !== undefined && b !== undefined && a + edge.weight === b;
    };
    /** 从源头到 target 的一条紧边路径上的说法：每一步取跳数少一、约束序最小的那条入边。 */
    const basisOf = (component: Component, source: number, target: number, reverse: boolean): RangeBasis => {
        const {distance, hops, incoming: into} = tight(component, source, reverse);
        const refs: string[] = [];
        let node = target;
        while (node !== source && hops.has(node)) {
            const incoming = (into.get(node) ?? [])
                .filter((edge) => isTight(edge, distance, reverse) && hops.get(reverse ? edge.to : edge.from) === hops.get(node)! - 1)
                .sort((a, b) => a.constraint - b.constraint)[0];
            if (incoming === undefined) break;
            if (incoming.constraint >= 0) refs.push(input.constraints[incoming.constraint]!.ref);
            node = reverse ? incoming.to : incoming.from;
        }
        refs.reverse();
        const unique = [...new Set(refs)];
        return {refs: unique.slice(0, BASIS_LIMIT), total: unique.length};
    };

    const componentByEvent = new Map<string, Component>();
    for (const component of components) for (const node of component.nodes) componentByEvent.set(eventOfNode[node]!, component);

    /** 一件事一端的范围；求依据时还要它用到的分量、源头与节点。 */
    const boundsOf = (event: string, edge: Edge): {bounds: EventBounds; component?: Component; source?: number; node?: number} => {
        const component = componentByEvent.get(event);
        if (component === undefined || !component.constrained) return {bounds: {state: "unconstrained"}};
        if (component.conflicts.length > 0) return {bounds: {state: "conflict", conflicts: component.conflicts}};
        const node = edge === "end" ? (endNode.get(event) ?? startNode.get(event)!) : startNode.get(event)!;
        const source = component.anchored ? component.origin : component.root;
        const forward = paths(component, source, false).distance.get(node);
        const backward = paths(component, source, true).distance.get(node);
        const bounds: EventBounds = {state: "ok", anchored: component.anchored, ...(component.anchored ? {} : {relativeTo: component.rootEvent}), lo: backward === undefined ? Number.NEGATIVE_INFINITY : 0 - backward, hi: forward ?? Number.POSITIVE_INFINITY};
        return {bounds, component, source, node};
    };

    return {
        events: input.events,
        conflicts,
        component: (event) => componentByEvent.get(event)?.id,
        bounds: (event, edge = "start") => boundsOf(event, edge).bounds,
        range: (event, edge = "start") => {
            const {bounds, component, source, node} = boundsOf(event, edge);
            if (bounds.state !== "ok") return bounds;
            return {
                ...bounds,
                earliest: bounds.lo === Number.NEGATIVE_INFINITY ? {refs: [], total: 0} : basisOf(component!, source!, node!, true),
                latest: bounds.hi === Number.POSITIVE_INFINITY ? {refs: [], total: 0} : basisOf(component!, source!, node!, false),
            };
        },
        between: (a, b) => {
            const ca = componentByEvent.get(a);
            const cb = componentByEvent.get(b);
            if (ca === undefined || cb === undefined) return {state: "unrelated"};
            if (ca.conflicts.length > 0 || cb.conflicts.length > 0) return {state: "conflict"};
            // 没有约束的分量只有这一件事：和自己相差 0，和别的事没有关系。
            if (!ca.constrained || !cb.constrained) return a === b ? {state: "ok", lo: 0, hi: 0} : {state: "unrelated"};
            const [na, nb] = [startNode.get(a)!, startNode.get(b)!];
            if (ca === cb) {
                const hi = paths(ca, na, false).distance.get(nb);
                const back = paths(ca, nb, false).distance.get(na);
                return {state: "ok", lo: back === undefined ? Number.NEGATIVE_INFINITY : 0 - back, hi: hi ?? Number.POSITIVE_INFINITY};
            }
            if (!ca.anchored || !cb.anchored) return {state: "unrelated"};
            // 两个有锚的分量：各自相对元年的范围相减。
            const ra = paths(ca, ca.origin, false).distance.get(na);
            const la = paths(ca, ca.origin, true).distance.get(na);
            const rb = paths(cb, cb.origin, false).distance.get(nb);
            const lb = paths(cb, cb.origin, true).distance.get(nb);
            const loA = la === undefined ? Number.NEGATIVE_INFINITY : 0 - la;
            const hiA = ra ?? Number.POSITIVE_INFINITY;
            const loB = lb === undefined ? Number.NEGATIVE_INFINITY : 0 - lb;
            const hiB = rb ?? Number.POSITIVE_INFINITY;
            return {state: "ok", lo: loB - hiA, hi: hiB - loA};
        },
    };
}

/**
 * 队列版 Bellman-Ford，从“到每个节点距离 0 的虚源”出发（节点按给的先后的逆序进队）。没有负环时每个节点最多进队“节点数”次
 * （一轮一次，至多那么多轮）；超过就有负环，在前驱图里找出一个环（前驱图里的环一定是负环）。
 */
function bellmanFord(nodes: readonly number[], edges: readonly Edge_[]): {readonly distance: Map<number, number>; readonly cycle: null} | {readonly distance: Map<number, number>; readonly cycle: readonly Edge_[]} {
    const distance = new Map<number, number>(nodes.map((node) => [node, 0]));
    const predecessor = new Map<number, Edge_>();
    const entered = new Map<number, number>(nodes.map((node) => [node, 1]));
    const outgoing = new Map<number, Edge_[]>();
    for (const edge of edges) append(outgoing, edge.from, edge);
    const queue = [...nodes].reverse();
    const queued = new Set(queue);
    for (let head = 0; head < queue.length; head += 1) {
        const node = queue[head]!;
        queued.delete(node);
        for (const edge of outgoing.get(node) ?? []) {
            const candidate = distance.get(node)! + edge.weight;
            if (candidate >= distance.get(edge.to)!) continue;
            distance.set(edge.to, candidate);
            predecessor.set(edge.to, edge);
            if (queued.has(edge.to)) continue;
            const times = entered.get(edge.to)! + 1;
            entered.set(edge.to, times);
            if (times > nodes.length) {
                const cycle = predecessorCycle(nodes, predecessor);
                if (cycle !== null) return {distance, cycle};
            }
            queued.add(edge.to);
            queue.push(edge.to);
        }
    }
    return {distance, cycle: null};
}

/** 前驱图里的一个环（按节点的先后找第一个），边按沿环的方向排；没有时为 null。 */
function predecessorCycle(nodes: readonly number[], predecessor: ReadonlyMap<number, Edge_>): Edge_[] | null {
    const state = new Map<number, number>();
    for (const [index, start] of nodes.entries()) {
        let node: number | undefined = start;
        while (node !== undefined && !state.has(node)) {
            state.set(node, index);
            node = predecessor.get(node)?.from;
        }
        if (node === undefined || state.get(node) !== index) continue;
        // node 在这一趟走过的路上又遇到：从它起绕一圈就是环。
        const cycle: Edge_[] = [];
        let walk = node;
        do {
            const via = predecessor.get(walk)!;
            cycle.push(via);
            walk = via.from;
        } while (walk !== node);
        return cycle.reverse();
    }
    return null;
}
