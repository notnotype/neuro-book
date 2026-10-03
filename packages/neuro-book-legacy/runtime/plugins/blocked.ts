/**
 * 根据入口位置、服务依赖与当前状态纯推导受阻；输入只含存活登记的快照。
 * 本模块不创建资源、不触发激活、不产生诊断，也不保留跨查询状态。
 */

import type {RuntimeLocation} from "../lifecycle/lifecycle";
import type {ServiceDependency, ServiceKey} from "../services/services";

import type {EntryBlocked, EntryRef, EntryStatus} from "./contracts";

export interface EntrySnapshot extends EntryRef {
    readonly location: RuntimeLocation;
    readonly provides: ReadonlyArray<ServiceKey<unknown>>;
    readonly dependencies: ReadonlyArray<ServiceDependency>;
    readonly status: EntryStatus;
}

export function entryIdentity(entry: EntryRef): string {
    return `${entry.plugin}/${entry.entry}`;
}

/** 本地能力不归插件所有；提供项存在即满足本层可用性约束，初始化失败仍由 services 报告。 */
export function deriveBlocked(
    entries: ReadonlyArray<EntrySnapshot>,
    location: RuntimeLocation,
    // 插件键按对象身份匹配；AssemblyReport 只给出键名，本地能力因此按名称匹配。
    localServices: ReadonlySet<string>,
): ReadonlyMap<string, EntryBlocked | null> {
    const local = entries.filter((entry) => entry.location === location);
    const providers = new Map<ServiceKey<unknown>, EntrySnapshot>();
    const foreign = new Set<ServiceKey<unknown>>();
    for (const entry of entries) {
        for (const key of entry.provides) {
            if (entry.location === location) {
                providers.set(key, entry);
            } else {
                foreign.add(key);
            }
        }
    }
    const edges = new Map<EntrySnapshot, Array<{key: ServiceKey<unknown>; provider: EntrySnapshot}>>();
    for (const entry of local) {
        const dependencies = [];
        for (const dependency of entry.dependencies) {
            const provider = providers.get(dependency.key);
            if (dependency.required !== false && provider !== undefined && !localServices.has(dependency.key.name)) {
                dependencies.push({key: dependency.key, provider});
            }
        }
        edges.set(entry, dependencies);
    }

    // 强连通分量区分真正的环成员与依赖环的外部消费者。
    const indices = new Map<EntrySnapshot, number>();
    const low = new Map<EntrySnapshot, number>();
    const stack: EntrySnapshot[] = [];
    const stacked = new Set<EntrySnapshot>();
    const components = new Map<EntrySnapshot, ReadonlySet<EntrySnapshot>>();
    let index = 0;
    const visit = (entry: EntrySnapshot): void => {
        indices.set(entry, index);
        low.set(entry, index++);
        stack.push(entry);
        stacked.add(entry);
        for (const {provider} of edges.get(entry)!) {
            if (!indices.has(provider)) {
                visit(provider);
                low.set(entry, Math.min(low.get(entry)!, low.get(provider)!));
            } else if (stacked.has(provider)) {
                low.set(entry, Math.min(low.get(entry)!, indices.get(provider)!));
            }
        }
        if (low.get(entry) !== indices.get(entry)) {
            return;
        }
        const component = new Set<EntrySnapshot>();
        let member: EntrySnapshot;
        do {
            member = stack.pop()!;
            stacked.delete(member);
            component.add(member);
        } while (member !== entry);
        if (component.size > 1 || edges.get(entry)!.some(({provider}) => provider === entry)) {
            for (const item of component) {
                components.set(item, component);
            }
        }
    };
    for (const entry of local) {
        if (!indices.has(entry)) {
            visit(entry);
        }
    }

    const results = new Map<string, EntryBlocked | null>();
    const cycle = (entry: EntrySnapshot): EntryBlocked => {
        const component = components.get(entry)!;
        const path: EntrySnapshot[] = [entry];
        const seen = new Set<EntrySnapshot>(path);
        const find = (current: EntrySnapshot): ServiceKey<unknown> | null => {
            for (const {key, provider} of edges.get(current)!) {
                if (!component.has(provider)) {
                    continue;
                }
                if (provider === entry) {
                    path.push(entry);
                    return key;
                }
                if (!seen.has(provider)) {
                    seen.add(provider);
                    path.push(provider);
                    const found = find(provider);
                    if (found !== null) {
                        return current === entry ? key : found;
                    }
                    path.pop();
                }
            }
            return null;
        };
        const key = find(entry)!;
        return {reason: "dependency-cycle", key: key.name, path: path.map(entryIdentity)};
    };
    const compute = (entry: EntrySnapshot): EntryBlocked | null => {
        const id = entryIdentity(entry);
        if (results.has(id)) {
            return results.get(id)!;
        }
        if (components.has(entry)) {
            const blocked = cycle(entry);
            results.set(id, blocked);
            return blocked;
        }
        let blocked: EntryBlocked | null = null;
        for (const dependency of entry.dependencies) {
            if (dependency.required === false || localServices.has(dependency.key.name)) {
                continue;
            }
            const key = dependency.key.name;
            const provider = providers.get(dependency.key);
            if (provider === undefined) {
                blocked = {reason: foreign.has(dependency.key) ? "location-mismatch" : "missing-service", key, path: [id]};
            } else if (provider.status === "failed") {
                blocked = {reason: "provider-failed", key, path: [id, entryIdentity(provider)]};
            } else {
                const upstream = compute(provider);
                if (upstream !== null) {
                    blocked = {reason: "provider-blocked", key, path: [id, ...upstream.path]};
                }
            }
            if (blocked !== null) {
                break;
            }
        }
        results.set(id, blocked);
        return blocked;
    };
    for (const entry of entries) {
        if (entry.location === location) {
            compute(entry);
        } else {
            results.set(entryIdentity(entry), null);
        }
    }
    return results;
}
