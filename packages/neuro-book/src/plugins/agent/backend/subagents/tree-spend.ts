/**
 * 会话树的累计花费（docs/specs/agent/run-guards.md 输出 13）：费用上限与告警比的是根会话与它所有后代之和。
 *
 * 不用增量：按会话存绝对值。打开着的会话取它最近一次反应里的 `ctx.spend`（费用守卫每次判断前记下），关着的取启动扫描时索引里的
 * `spend`；进程启动之后跑过的会话都记过，所以扫描值只对之后没再打开过的会话有用，不会过时。树的结构查关系表。
 *
 * fork 出来的会话照常计入：它从来源会话复制来的用量会重复计算，上限偏紧，不扣除（按 `origin` 排除会把用户 fork 出来的根会话也排除掉）。
 */

import type {SessionRelations} from "./relations";

export interface SpendTotal {
    readonly cost: number;
    readonly unpriced: number;
}

export class TreeSpend {
    readonly #spent = new Map<string, SpendTotal>();

    constructor(private readonly relations: SessionRelations) {}

    /** 启动扫描的索引：已经记过的（扫描期间就跑了的）不盖。 */
    load(entries: ReadonlyArray<{readonly id: string; readonly spend?: SpendTotal}>): void {
        for (const entry of entries) if (entry.spend !== undefined && !this.#spent.has(entry.id)) this.#spent.set(entry.id, {cost: entry.spend.cost, unpriced: entry.spend.unpriced});
    }

    record(sessionId: string, spend: SpendTotal): void {
        this.#spent.set(sessionId, {cost: spend.cost, unpriced: spend.unpriced});
    }

    /** 这个会话所在的整棵树。 */
    total(sessionId: string): SpendTotal {
        const root = this.relations.rootOf(sessionId);
        let cost = 0;
        let unpriced = 0;
        for (const id of [root, ...this.relations.descendantsOf(root)]) {
            const spent = this.#spent.get(id);
            if (spent === undefined) continue;
            cost += spent.cost;
            unpriced += spent.unpriced;
        }
        return {cost, unpriced};
    }
}
