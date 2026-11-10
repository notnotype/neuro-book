/**
 * 费用告警与上限（docs/specs/agent/run-guards.md 输出 3–6、13）。每个会话的累计数是内核算的（`ctx.spend`），这里记进会话树的累计
 * （`TreeSpend`）再判断，比的是整棵树：子代理花的算进派它的会话那棵树。上限是软的：只在发请求前判断，几个会话同时发请求时至多超出
 * 同时在途的那几个。告警按会话记：每个会话看到的是树的累计，过线时各写一次。
 */

import {defineExtension, ext, slice} from "@notnotype/nb-harness/kernel";
import type {ReactCtx} from "@notnotype/nb-harness/kernel/contracts";
import type {AgentExtensionImplementation} from "../../shared/points";

import type {TreeSpend} from "../subagents/tree-spend";

import {refusal} from "./refusal";

export interface CostLimits {
    /** 0 表示不设。 */
    readonly warnCost: number;
    readonly maxCost: number;
}

/** `limits` 每次判断时现读：设置改了立刻生效，也不进 Profile 哈希。 */
export function costGuard(limits: () => CostLimits, tree: TreeSpend): AgentExtensionImplementation {
    const check = (ctx: ReactCtx<any, any, any, any, any>): void => {
        const {warnCost, maxCost} = limits();
        tree.record(ctx.session.sessionId, ctx.spend);
        const spent = tree.total(ctx.session.sessionId);
        if (warnCost > 0 && spent.cost >= warnCost && warnCost > (ctx.state.warnedAt as number)) ctx.emit("costWarned", {spent: spent.cost, limit: warnCost});
        if ((warnCost > 0 || maxCost > 0) && spent.unpriced > 0 && ctx.state.unpricedWarned !== true) ctx.emit("costUnpriced", undefined);
    };
    return defineExtension({
        id: "nbook.agent.cost-guard",
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
                // 不带会话的单次请求（`complete`）只看自己的。
                let spent = ctx.spend.cost;
                if (ctx.session !== undefined) {
                    tree.record(ctx.session.sessionId, ctx.spend);
                    spent = tree.total(ctx.session.sessionId).cost;
                }
                if (spent < maxCost) return next(request);
                return refusal(request, "cost-limit", `this session tree has spent $${spent.toFixed(4)} of its $${maxCost.toFixed(4)} limit; the model request was not sent`);
            },
        },
    });
}
