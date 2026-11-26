/**
 * 一个运行目录的计划（`<out>/plan.json`）：跑哪几道题（带版本）、哪几个模型与推理档、哪几边、每格几次、最多几步。
 * 第一次跑时写下，之后再跑（续跑）必须一模一样；换了计划、改了题（版本变了）就用新的运行目录。
 * 报表按它算分母：计划里的格没有都计分，这一组就不出区间与每题次数。
 */

import {join} from "node:path";

import {Type} from "typebox";
import type {Static} from "typebox";

import {ARMS} from "./schema";
import {readJson, writeJsonAtomic} from "./store";

export const PLAN_FORMAT = "nbook.browser-eval.plan/v1";

export const RunPlanSchema = Type.Object({
    format: Type.Literal(PLAN_FORMAT),
    tasks: Type.Array(Type.Object({id: Type.String(), version: Type.String()}, {additionalProperties: false})),
    models: Type.Array(Type.Object({id: Type.String(), model: Type.String(), reasoning: Type.String()}, {additionalProperties: false})),
    arms: Type.Array(Type.Enum(ARMS)),
    repeat: Type.Integer({minimum: 1}),
    maxSteps: Type.Integer({minimum: 1}),
}, {additionalProperties: false});

export type RunPlan = Static<typeof RunPlanSchema>;

/** 运行目录里已有的计划与这次的不一样。 */
export class PlanMismatchError extends Error {}

export function planPath(out: string): string {
    return join(out, "plan.json");
}

export async function readPlan(out: string): Promise<RunPlan | null> {
    return readJson(planPath(out), RunPlanSchema);
}

/** 第一次跑时写下计划；已有的计划与这次的不一样时抛 `PlanMismatchError`，说出第一处不同。调用方要先拿到运行目录的锁。 */
export async function claimPlan(out: string, plan: RunPlan): Promise<void> {
    const existing = await readPlan(out);
    if (existing === null) {
        await writeJsonAtomic(planPath(out), plan);
        return;
    }
    for (const key of ["tasks", "models", "arms", "repeat", "maxSteps"] as const) {
        if (JSON.stringify(existing[key]) !== JSON.stringify(plan[key])) {
            throw new PlanMismatchError(`${out} was started with a different ${key}: ${JSON.stringify(existing[key])} (now ${JSON.stringify(plan[key])}); use a new --out`);
        }
    }
}
