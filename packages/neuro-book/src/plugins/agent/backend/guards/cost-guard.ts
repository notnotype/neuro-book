/**
 * 费用告警与上限（docs/specs/agent/run-guards.md 输出 3–6）。累计数是内核算的（`ctx.spend`）：这里只判断，所以旧会话打开时
 * 费用也是对的。上限是软的：只在发请求前判断。
 */

import {defineExtension, ext, slice} from "@notnotype/nb-harness/kernel";
import type {ReactCtx} from "@notnotype/nb-harness/kernel/contracts";
import type {AgentExtensionImplementation} from "../../shared/points";

import {refusal} from "./refusal";

export interface CostLimits {
    /** 0 表示不设。 */
    readonly warnCost: number;
    readonly maxCost: number;
}

/** `limits` 每次判断时现读：设置改了立刻生效，也不进 Profile 哈希。 */
export function costGuard(limits: () => CostLimits): AgentExtensionImplementation {
    const check = (ctx: ReactCtx<any, any, any, any, any>): void => {
        const {warnCost, maxCost} = limits();
        if (warnCost > 0 && ctx.spend.cost >= warnCost && warnCost > (ctx.state.warnedAt as number)) ctx.emit("costWarned", {spent: ctx.spend.cost, limit: warnCost});
        if ((warnCost > 0 || maxCost > 0) && ctx.spend.unpriced > 0 && ctx.state.unpricedWarned !== true) ctx.emit("costUnpriced", undefined);
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
                if (ctx.phase === "preview" || maxCost <= 0 || ctx.spend.cost < maxCost) return next(request);
                return refusal(request, "cost-limit", `this session has spent $${ctx.spend.cost.toFixed(4)} of its $${maxCost.toFixed(4)} limit; the model request was not sent`);
            },
        },
    });
}
