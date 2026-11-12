/**
 * 费用告警与上限（docs/specs/agent/run-guards.md 输出 3–6、13）。每个会话的累计数是内核算的（`ctx.spend`）：这里只判断，所以旧会话
 * 打开时费用也是对的。宿主给了 `scope` 时，先把这个会话的累计记进去，再比整个范围的累计（例如整棵会话树：子代理花的算进派它的会话
 * 那棵树）。上限是软的：只在发请求前判断，几个会话同时发请求时至多超出同时在途的那几个。告警按会话记：每个会话看到的是范围的累计，
 * 过线时各写一次。
 */

import {defineExtension, ext, slice} from "../../kernel/index.js";
import type {AnyExtension, ReactCtx} from "../../kernel/contracts.js";
import {refusal} from "./refusal.js";

export interface CostLimits {
    /** 0 表示不设。 */
    readonly warnCost: number;
    readonly maxCost: number;
}

export interface SpendTotal {
    readonly cost: number;
    readonly unpriced: number;
}

/** 累计按哪个范围算，宿主给（例如整棵会话树）。 */
export interface SpendScope {
    /** 记下这个会话现在的累计（内核算的绝对值，不是增量）。 */
    record(sessionId: string, spend: SpendTotal): void;
    /** 这个会话所在范围的累计。 */
    total(sessionId: string): SpendTotal;
}

/**
 * `id` 是扩展 id（事件名是 `<id>/<名字>`，进日志），宿主给；`limits` 每次判断时现读：设置改了立刻生效，也不进 Profile 哈希。
 * `scope` 不给时只算这个会话自己的。
 */
export function costGuard(options: {readonly id: string; readonly limits: () => CostLimits; readonly scope?: SpendScope}): AnyExtension {
    const {limits, scope} = options;
    /** 不带会话的单次请求（`complete`）只看自己的。 */
    const spentOf = (ctx: {readonly session?: {readonly sessionId: string} | undefined; readonly spend: SpendTotal}): SpendTotal => {
        if (scope === undefined || ctx.session === undefined) return ctx.spend;
        scope.record(ctx.session.sessionId, ctx.spend);
        return scope.total(ctx.session.sessionId);
    };
    const check = (ctx: ReactCtx<any, any, any, any, any>): void => {
        const {warnCost, maxCost} = limits();
        const spent = spentOf(ctx);
        if (warnCost > 0 && spent.cost >= warnCost && warnCost > (ctx.state.warnedAt as number)) ctx.emit("costWarned", {spent: spent.cost, limit: warnCost});
        if ((warnCost > 0 || maxCost > 0) && spent.unpriced > 0 && ctx.state.unpricedWarned !== true) ctx.emit("costUnpriced", undefined);
    };
    return defineExtension({
        id: options.id,
        state: {
            /** 已经告警到的线：记线而不是“告警过”，调高之后到新的线还要再告警。 */
            warnedAt: slice.session(0),
            unpricedWarned: slice.session(false),
        },
        events: {
            costWarned: ext.session<{spent: number; limit: number}>(),
            costUnpriced: ext.session(),
        },
        reduce: {
            costWarned: (event) => ({warnedAt: event.data.limit}),
            costUnpriced: () => ({unpricedWarned: true}),
        },
        on: {
            assistant: (_event, ctx) => check(ctx),
            modelEnded: (_event, ctx) => check(ctx),
            modelFailed: (_event, ctx) => check(ctx),
        },
        intercept: {
            model: async (request, next, ctx) => {
                const {maxCost} = limits();
                if (ctx.phase === "preview" || maxCost <= 0) return next(request);
                const spent = spentOf(ctx).cost;
                if (spent < maxCost) return next(request);
                const who = scope === undefined ? "this session" : "this session tree";
                return refusal(request, "cost-limit", `${who} has spent $${spent.toFixed(4)} of its $${maxCost.toFixed(4)} limit; the model request was not sent`);
            },
        },
    });
}
