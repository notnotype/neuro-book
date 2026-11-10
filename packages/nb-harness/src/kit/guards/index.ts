/**
 * `@notnotype/nb-harness/kit/guards`：运行保护（docs/specs/agent/run-guards.md）：费用告警与上限、重复的工具调用。扩展 id 由宿主给，
 * 设置由宿主的闭包现读。
 */

export {costGuard} from "./cost-guard.js";
export type {CostLimits, SpendScope, SpendTotal} from "./cost-guard.js";
export {loopGuard} from "./loop-guard.js";
export {refusal} from "./refusal.js";
