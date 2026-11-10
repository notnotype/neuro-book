/**
 * 会话之间的父子关系（docs/specs/agent/subagents.md）：内存里的一张表。插件启动时按会话索引的 `caller` 扫一遍（扫完才开门），之后
 * 由派发与 `fork` 登记。深度、`tree`、`sessions://` 的根、费用按树算都查它，不再每次扫全部索引。
 *
 * 只记调用方是会话的（`caller.kind === "session"`）；Workflow 发起的会话没有父会话。关系不另存：会话头就是真相，进程重启后重扫。
 */

import type {SessionIndexEntry} from "@notnotype/nb-harness/kernel/contracts";

export interface RelationEntry {
    readonly id: string;
    readonly caller?: SessionIndexEntry["caller"];
    /** fork 的来源会话。 */
    readonly origin?: string;
}

interface Node {
    readonly parent: string | null;
    readonly callId?: string;
    readonly invocation?: string;
    readonly forked: boolean;
}

export class SessionRelations {
    readonly #nodes = new Map<string, Node>();
    readonly #children = new Map<string, Set<string>>();

    /** 启动时的扫描结果；与扫描期间已经登记的按会话 id 合并，已登记的优先（扫描读到的可能是旧的）。 */
    load(entries: readonly RelationEntry[]): void {
        for (const entry of entries) if (!this.#nodes.has(entry.id)) this.register(entry);
    }

    register(entry: RelationEntry): void {
        const caller = entry.caller?.kind === "session" ? entry.caller : undefined;
        const node: Node = {
            parent: caller?.id ?? null,
            ...(caller === undefined ? {} : {callId: caller.callId}),
            ...(caller?.invocation === undefined ? {} : {invocation: caller.invocation}),
            forked: entry.origin !== undefined,
        };
        const previous = this.#nodes.get(entry.id);
        if (previous?.parent != null) this.#children.get(previous.parent)?.delete(entry.id);
        this.#nodes.set(entry.id, node);
        if (node.parent !== null) {
            let set = this.#children.get(node.parent);
            if (set === undefined) this.#children.set(node.parent, (set = new Set()));
            set.add(entry.id);
        }
    }

    parentOf(id: string): string | null {
        return this.#nodes.get(id)?.parent ?? null;
    }

    /** 派它的那次调用；不是子会话时 undefined。 */
    callOf(id: string): {readonly callId: string; readonly invocation?: string} | undefined {
        const node = this.#nodes.get(id);
        return node?.callId === undefined ? undefined : {callId: node.callId, ...(node.invocation === undefined ? {} : {invocation: node.invocation})};
    }

    isForked(id: string): boolean {
        return this.#nodes.get(id)?.forked ?? false;
    }

    childrenOf(id: string): readonly string[] {
        return [...(this.#children.get(id) ?? [])];
    }

    /** 全部后代，先父后子（广度优先）。 */
    descendantsOf(id: string): readonly string[] {
        const result: string[] = [];
        const seen = new Set([id]);
        const queue = [id];
        for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
            for (const child of this.#children.get(current) ?? []) {
                if (seen.has(child)) continue;
                seen.add(child);
                result.push(child);
                queue.push(child);
            }
        }
        return result;
    }

    /** 祖先，从父会话起往上。会话头是用户的数据，防一下成环。 */
    ancestorsOf(id: string): readonly string[] {
        const result: string[] = [];
        const seen = new Set([id]);
        for (let parent = this.parentOf(id); parent !== null && !seen.has(parent); parent = this.parentOf(parent)) {
            seen.add(parent);
            result.push(parent);
        }
        return result;
    }

    rootOf(id: string): string {
        return this.ancestorsOf(id).at(-1) ?? id;
    }

    /** 根会话是 0。 */
    depthOf(id: string): number {
        return this.ancestorsOf(id).length;
    }
}
