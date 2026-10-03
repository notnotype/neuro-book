/**
 * 关闭波次规划：纯函数，只看节点状态与依赖图，不触碰作用域对象。
 *
 * 节点是一个作用域自己的资源与它持有的借用。消费者先释放、提供者后释放；
 * 无依赖关系的节点同一波并行。被释放失败的消费者或停滞的借用者挡住的提供者
 * 不进入释放，保持可诊断状态等待显式恢复。
 */

export type ReleasePlanNodeStatus = "registered" | "releasing" | "released" | "release-failed";

export interface ReleasePlanBorrower<ScopeKey extends string> {
    readonly scopeId: ScopeKey;
    /**
     * 借用者仍可能自行结束使用：它处于 creating/available，或正处于一次在途关闭尝试。
     * 已停止且没有在途尝试的借用者不会再释放借用，其借用的资源视为被阻塞。
     */
    readonly active: boolean;
}

export interface ReleasePlanNode<Id extends string, ScopeKey extends string> {
    readonly id: Id;
    readonly status: ReleasePlanNodeStatus;
    /** 本节点消费的提供者；必须都是同一批节点里的 id。 */
    readonly dependsOn: ReadonlyArray<Id>;
    /** 本次关闭尝试已对它发起过释放；失败后同一尝试不再重试。 */
    readonly attempted: boolean;
    readonly borrowers: ReadonlyArray<ReleasePlanBorrower<ScopeKey>>;
}

export interface BlockedPlanNode<Id extends string, ScopeKey extends string> {
    readonly id: Id;
    readonly blockedBy: ReadonlyArray<Id>;
    readonly blockedByBorrowers: ReadonlyArray<ScopeKey>;
}

export interface ReleasePlan<Id extends string, ScopeKey extends string> {
    /** 现在就可以发起释放的节点。 */
    readonly releasable: ReadonlyArray<Id>;
    /** 等待消费者释放或借用结束后才能释放的节点。 */
    readonly waiting: ReadonlyArray<Id>;
    /** 释放已发起、尚未结算的节点。 */
    readonly inFlight: ReadonlyArray<Id>;
    /** 本次尝试无法推进的节点：消费者释放失败，或借用者已停滞。 */
    readonly blocked: ReadonlyArray<BlockedPlanNode<Id, ScopeKey>>;
}

export function computeReleasePlan<Id extends string, ScopeKey extends string>(
    nodes: ReadonlyArray<ReleasePlanNode<Id, ScopeKey>>,
): ReleasePlan<Id, ScopeKey> {
    const byId = new Map<Id, ReleasePlanNode<Id, ScopeKey>>();
    const consumersOf = new Map<Id, Id[]>();
    for (const node of nodes) {
        byId.set(node.id, node);
        consumersOf.set(node.id, []);
    }
    for (const node of nodes) {
        for (const providerId of node.dependsOn) {
            consumersOf.get(providerId)?.push(node.id);
        }
    }

    const isDone = (node: ReleasePlanNode<Id, ScopeKey>): boolean => node.status === "released";
    const isStuck = (node: ReleasePlanNode<Id, ScopeKey>): boolean => node.status === "release-failed" && node.attempted;

    // 依赖只能指向登记时已存在的节点，因此图是无环的，直接沿消费者方向递归即可。
    const blockedMemo = new Map<Id, BlockedPlanNode<Id, ScopeKey> | null>();
    const blockedInfo = (node: ReleasePlanNode<Id, ScopeKey>): BlockedPlanNode<Id, ScopeKey> | null => {
        const memo = blockedMemo.get(node.id);
        if (memo !== undefined) {
            return memo;
        }
        const blockedBy: Id[] = [];
        for (const consumerId of consumersOf.get(node.id) ?? []) {
            const consumer = byId.get(consumerId);
            if (consumer === undefined || isDone(consumer)) {
                continue;
            }
            if (isStuck(consumer) || blockedInfo(consumer) !== null) {
                blockedBy.push(consumerId);
            }
        }
        const blockedByBorrowers = node.borrowers.filter((borrower) => !borrower.active).map((borrower) => borrower.scopeId);
        const info = blockedBy.length === 0 && blockedByBorrowers.length === 0
            ? null
            : {id: node.id, blockedBy, blockedByBorrowers};
        blockedMemo.set(node.id, info);
        return info;
    };

    const releasable: Id[] = [];
    const waiting: Id[] = [];
    const inFlight: Id[] = [];
    const blocked: BlockedPlanNode<Id, ScopeKey>[] = [];
    for (const node of nodes) {
        if (isDone(node) || isStuck(node)) {
            continue;
        }
        if (node.status === "releasing") {
            inFlight.push(node.id);
            continue;
        }
        const info = blockedInfo(node);
        if (info !== null) {
            blocked.push(info);
            continue;
        }
        const consumersDone = (consumersOf.get(node.id) ?? []).every((consumerId) => {
            const consumer = byId.get(consumerId);
            return consumer === undefined || isDone(consumer);
        });
        if (consumersDone && node.borrowers.length === 0) {
            releasable.push(node.id);
        } else {
            waiting.push(node.id);
        }
    }
    return {releasable, waiting, inFlight, blocked};
}
