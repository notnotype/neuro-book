/**
 * 静态依赖检查：纯函数，只看声明与作用域祖先关系，不触碰任何实例。
 *
 * 规则：
 * - 候选提供者 = 声明在入口作用域或其祖先上的提供者（寿命不短于入口）；只在更短寿命作用域上
 *   存在的提供者不可达，不隐式解析。
 * - 同一键的两个提供者若处于同一条祖先链上即冲突，全部隔离，不按声明顺序挑选。
 * - 依赖环（含可选边与自环）在此静态发现，环内提供者全部拒绝。
 * - 必需依赖缺失、冲突、环或必需依赖的提供者被拒绝，都让入口进入拒绝闭包；可选缺失只标记该边。
 */

import type {Scope, ScopeId} from "../lifecycle/lifecycle";

import type {AssemblyReport, DependencyVerdict, EntryId, EntryProblem, EntryReport, ServiceKey} from "./contracts";

export interface EntryNode {
    readonly id: EntryId;
    readonly kind: "provider" | "consumer";
    readonly key: ServiceKey<unknown> | null;
    readonly scope: Scope;
    readonly dependencies: ReadonlyArray<{readonly key: ServiceKey<unknown>; readonly required: boolean}>;
}

/** Tarjan 强连通分量；只返回含环的分量（成员多于一个，或自环）。 */
function findCycles(nodes: ReadonlyArray<EntryId>, edges: ReadonlyMap<EntryId, ReadonlyArray<EntryId>>): EntryId[][] {
    const index = new Map<EntryId, number>();
    const low = new Map<EntryId, number>();
    const onStack = new Set<EntryId>();
    const stack: EntryId[] = [];
    const cycles: EntryId[][] = [];
    let counter = 0;

    function visit(node: EntryId): void {
        index.set(node, counter);
        low.set(node, counter);
        counter += 1;
        stack.push(node);
        onStack.add(node);
        for (const next of edges.get(node) ?? []) {
            if (!index.has(next)) {
                visit(next);
                low.set(node, Math.min(low.get(node)!, low.get(next)!));
            } else if (onStack.has(next)) {
                low.set(node, Math.min(low.get(node)!, index.get(next)!));
            }
        }
        if (low.get(node) === index.get(node)) {
            const component: EntryId[] = [];
            let member: EntryId;
            do {
                member = stack.pop()!;
                onStack.delete(member);
                component.push(member);
            } while (member !== node);
            component.reverse();
            if (component.length > 1 || (edges.get(node) ?? []).includes(node)) {
                cycles.push(component);
            }
        }
    }

    for (const node of nodes) {
        if (!index.has(node)) {
            visit(node);
        }
    }
    return cycles;
}

export function checkAssembly(entries: ReadonlyArray<EntryNode>): AssemblyReport {
    const lineage = new Map<EntryId, Set<ScopeId>>();
    const providersByKey = new Map<ServiceKey<unknown>, EntryNode[]>();
    for (const entry of entries) {
        const ids = new Set<ScopeId>();
        for (let current: Scope | null = entry.scope; current !== null; current = current.parent) {
            ids.add(current.id);
        }
        lineage.set(entry.id, ids);
        if (entry.kind === "provider" && entry.key !== null) {
            const group = providersByKey.get(entry.key) ?? [];
            group.push(entry);
            providersByKey.set(entry.key, group);
        }
    }

    // 冲突：同一键、同一祖先链。
    const conflicted = new Map<EntryId, EntryId[]>();
    for (const group of providersByKey.values()) {
        const clashing = new Set<EntryId>();
        for (const a of group) {
            for (const b of group) {
                if (a !== b && lineage.get(b.id)!.has(a.scope.id)) {
                    clashing.add(a.id);
                    clashing.add(b.id);
                }
            }
        }
        const ids = group.filter((entry) => clashing.has(entry.id)).map((entry) => entry.id);
        for (const id of ids) {
            conflicted.set(id, ids);
        }
    }

    // 每条依赖边的候选与初步判定；提供者之间的 satisfied 边构成环检测图。
    const verdicts = new Map<EntryId, DependencyVerdict[]>();
    const providerEdges = new Map<EntryId, EntryId[]>();
    for (const entry of entries) {
        const own = lineage.get(entry.id)!;
        const entryVerdicts: DependencyVerdict[] = [];
        const edges: EntryId[] = [];
        for (const dependency of entry.dependencies) {
            const all = providersByKey.get(dependency.key) ?? [];
            const candidates = all.filter((provider) => own.has(provider.scope.id));
            const clash = candidates.filter((provider) => conflicted.has(provider.id));
            const key = dependency.key.name;
            const required = dependency.required;
            if (clash.length > 0) {
                entryVerdicts.push({status: "conflict", key, required, providerIds: conflicted.get(clash[0]!.id)!});
            } else if (candidates.length === 0) {
                entryVerdicts.push(
                    all.length === 0
                        ? {status: "missing", key, required}
                        : {status: "unreachable", key, required, providerIds: all.map((provider) => provider.id)},
                );
            } else {
                // 不变量：同一祖先链上的两个候选必然已被判为冲突，所以这里恰好一个。
                const provider = candidates[0]!;
                entryVerdicts.push({status: "satisfied", key, required, providerId: provider.id});
                edges.push(provider.id);
            }
        }
        verdicts.set(entry.id, entryVerdicts);
        if (entry.kind === "provider") {
            providerEdges.set(entry.id, edges);
        }
    }

    const cycleOf = new Map<EntryId, EntryId[]>();
    for (const cycle of findCycles([...providerEdges.keys()], providerEdges)) {
        for (const id of cycle) {
            cycleOf.set(id, cycle);
        }
    }

    // 拒绝闭包：自身问题先定，再沿必需边反向传播到不动点。
    const problems = new Map<EntryId, EntryProblem[]>();
    const rejected = new Set<EntryId>();
    for (const entry of entries) {
        const own: EntryProblem[] = [];
        const clash = conflicted.get(entry.id);
        if (clash !== undefined && entry.key !== null) {
            own.push({kind: "conflict", key: entry.key.name, providerIds: clash});
        }
        const cycle = cycleOf.get(entry.id);
        if (cycle !== undefined) {
            own.push({kind: "cycle", path: cycle});
        }
        for (const verdict of verdicts.get(entry.id)!) {
            if (verdict.required && verdict.status !== "satisfied") {
                own.push({kind: "missing-required", key: verdict.key});
            }
        }
        problems.set(entry.id, own);
        if (own.length > 0) {
            rejected.add(entry.id);
        }
    }
    for (let changed = true; changed; ) {
        changed = false;
        for (const entry of entries) {
            if (rejected.has(entry.id)) {
                continue;
            }
            for (const verdict of verdicts.get(entry.id)!) {
                if (verdict.status === "satisfied" && verdict.required && rejected.has(verdict.providerId)) {
                    problems.get(entry.id)!.push({kind: "rejected-dependency", key: verdict.key, providerId: verdict.providerId});
                    rejected.add(entry.id);
                    changed = true;
                    break;
                }
            }
        }
    }

    return {
        entries: entries.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            key: entry.key?.name ?? null,
            scopeId: entry.scope.id,
            dependencies: verdicts.get(entry.id)!.map((verdict) =>
                verdict.status === "satisfied" && rejected.has(verdict.providerId)
                    ? {status: "provider-rejected", key: verdict.key, required: verdict.required, providerId: verdict.providerId}
                    : verdict,
            ),
            problems: problems.get(entry.id)!,
            verdict: rejected.has(entry.id) ? "rejected" : "usable",
        })),
    };
}
