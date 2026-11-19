/**
 * 计划还算不算数（canon.model 输出 13 的计入规则在剧情插件里的那一半）：作者读取、目标“动过”与诊断共用。
 */

import type {CanonReadView, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

/**
 * 拆出的计划（`splitFrom`）只在拆出它的那条兑现变更（`by`）还生效、补丁套上时才算数（canon.model 输出 13；同引擎计入计划的
 * 规则）：兑现被撤销以后，拆出的计划不再是打算（plot/knowledge.md 输出 14 的“失效拆出的不列”）。不是拆出的计划总算数。
 */
export function splitStillHolds(view: CanonReadView, plan: StoryChange): boolean {
    const split = plan.links.find((link) => link.kind === "splitFrom");
    if (split === undefined || split.kind !== "splitFrom") return true;
    const by = view.object({kind: "change", id: split.by}) as StoryChange | undefined;
    return by !== undefined && by.status === "active" && view.outcome(split.by)?.applied === true;
}

/** 一条计划在读取位置上还是打算：未兑现、未取消、未被取代，拆出的还作数（同引擎计入计划的规则，不含补丁套没套上）。 */
export function planStillIntended(view: CanonReadView, plan: StoryChange, at: ReadPosition): boolean {
    return view.progress(plan.id, at) === "unfulfilled" && splitStillHolds(view, plan);
}
