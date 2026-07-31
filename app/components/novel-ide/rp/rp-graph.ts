import type {JsonValue} from "nbook/app/utils/world-engine-preview";
import type {SubjectStateDto, WorldSubjectDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {RpPlayerCharacterDto, RpPlayerMapNodeDto, RpPlayerMapRouteDto, RpPlayerRelationDto} from "nbook/shared/dto/rp-runtime.dto";

/**
 * RP 侧栏图谱构建：从 World Engine（rp 世界线）的 subject 状态里提取引用关系，
 * 供地图（地点连接）与角色关系图（vue-flow）渲染。
 *
 * 自适应策略：不硬编码属性名——遍历 attrs（深度 ≤ 2），凡是值命中其他 subject id
 * （裸 id 或 subject://id）就记一条边，边标签用属性名 + 可读字段（类型/好感/距离/方向）。
 */

export type RpGraphNode = {
    id: string;
    label: string;
    type: string;
};

export type RpGraphEdge = {
    id: string;
    source: string;
    target: string;
    label: string;
};

export type RpGraph = {
    nodes: RpGraphNode[];
    edges: RpGraphEdge[];
};

export type RpGraphNodeDetail = {
    id: string;
    label: string;
    category: string;
    summary: string;
    fields: Array<{label: string; value: string}>;
};

/** 只从玩家地图投影构建图谱，不读取尚未 materialize 的 World Engine 地点。 */
export function buildRpMapGraph(map: {nodes: RpPlayerMapNodeDto[]; routes: RpPlayerMapRouteDto[]} | null): RpGraph {
    if (!map) return {nodes: [], edges: []};
    const nodes = map.nodes.map((node) => ({id: node.id, label: node.label, type: "location"}));
    const edges: RpGraphEdge[] = [];
    for (const node of map.nodes) {
        if (node.parentId && map.nodes.some((parent) => parent.id === node.parentId)) {
            edges.push({id: `hierarchy:${node.parentId}->${node.id}`, source: node.parentId, target: node.id, label: "包含"});
        }
    }
    for (const route of map.routes) {
        edges.push({id: `route:${route.id}`, source: route.fromId, target: route.toId, label: route.label || "路线"});
    }
    return {nodes, edges};
}

/** 从正式关系账本的玩家投影构建有向角色关系图。 */
export function buildRpRelationGraph(characters: RpPlayerCharacterDto[], relations: RpPlayerRelationDto[]): RpGraph {
    const characterIds = new Set(characters.map((character) => character.id));
    return {
        nodes: characters.map((character) => ({id: character.id, label: character.name, type: "character"})),
        edges: relations
            .filter((relation) => characterIds.has(relation.sourceId) && characterIds.has(relation.targetId))
            .map((relation) => ({
                id: relation.id,
                source: relation.sourceId,
                target: relation.targetId,
                label: relation.tags.length > 0 ? relation.tags.join("、") : "关系",
            })),
    };
}

/** 从 subject 状态集中构建指定 type 集合的关系图。 */
export function buildRpGraph(input: {
    subjects: WorldSubjectDto[];
    states: SubjectStateDto[];
    /** 节点类型过滤；空 = 全部类型。 */
    nodeTypes?: string[];
}): RpGraph {
    const typeFilter = input.nodeTypes?.length ? new Set(input.nodeTypes) : null;
    const subjectById = new Map(input.subjects.map((subject) => [subject.id, subject]));
    const nodes: RpGraphNode[] = input.subjects
        .filter((subject) => !typeFilter || typeFilter.has(subject.type))
        .map((subject) => ({id: subject.id, label: subject.name || subject.id, type: subject.type}));
    const nodeIds = new Set(nodes.map((node) => node.id));

    const edges: RpGraphEdge[] = [];
    const seenEdgeKeys = new Set<string>();
    for (const state of input.states) {
        if (!nodeIds.has(state.subjectId)) continue;
        for (const [attrName, value] of Object.entries(state.attrs)) {
            collectRefs(value, 0, (targetId, detail) => {
                if (targetId === state.subjectId || !nodeIds.has(targetId)) return;
                const key = `${state.subjectId}->${targetId}:${attrName}`;
                if (seenEdgeKeys.has(key)) return;
                seenEdgeKeys.add(key);
                edges.push({
                    id: key,
                    source: state.subjectId,
                    target: targetId,
                    label: [attrName, detail].filter(Boolean).join(" "),
                });
            }, subjectById);
        }
    }
    return {nodes, edges};
}

/** 描述性字段：边标签里带上这些字段的值（类型/好感/距离/方向等）。 */
const EDGE_DETAIL_KEYS = ["类型", "好感", "距离", "方向", "kind", "relation", "distance", "direction"];

function collectRefs(
    value: JsonValue | undefined,
    depth: number,
    emit: (targetId: string, detail: string) => void,
    subjectById: Map<string, WorldSubjectDto>,
): void {
    if (value === undefined || value === null || depth > 2) return;
    if (typeof value === "string") {
        const id = refTargetId(value, subjectById);
        if (id) emit(id, "");
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectRefs(item, depth + 1, emit, subjectById);
        }
        return;
    }
    if (typeof value === "object") {
        // 对象条目：先找 ref 字段，把可读字段拼成 detail
        const record = value as Record<string, JsonValue>;
        const detail = EDGE_DETAIL_KEYS
            .filter((key) => record[key] !== undefined && (typeof record[key] === "string" || typeof record[key] === "number"))
            .map((key) => `${key}:${String(record[key])}`)
            .join(" ");
        let emitted = false;
        for (const item of Object.values(record)) {
            if (typeof item === "string") {
                const id = refTargetId(item, subjectById);
                if (id) {
                    emit(id, detail);
                    emitted = true;
                }
            }
        }
        if (!emitted) {
            for (const item of Object.values(record)) {
                collectRefs(item, depth + 1, emit, subjectById);
            }
        }
    }
}

function refTargetId(value: string, subjectById: Map<string, WorldSubjectDto>): string | null {
    const raw = value.startsWith("subject://") ? value.slice("subject://".length) : value;
    return subjectById.has(raw) ? raw : null;
}

/** 环形布局：无持久坐标时的默认摆放。 */
export function circleLayout(nodes: RpGraphNode[], radius = 220): Map<string, {x: number; y: number}> {
    const positions = new Map<string, {x: number; y: number}>();
    const count = Math.max(nodes.length, 1);
    const effectiveRadius = Math.max(radius, count * 28);
    nodes.forEach((node, index) => {
        const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
        positions.set(node.id, {
            x: Math.round(Math.cos(angle) * effectiveRadius),
            y: Math.round(Math.sin(angle) * effectiveRadius * 0.72),
        });
    });
    return positions;
}
