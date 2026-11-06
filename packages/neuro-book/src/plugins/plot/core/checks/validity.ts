/**
 * 检查记录现在还有效吗（docs/specs/plot/checks.md 输出 7）：按现在的世界与正文重算计划，调用集合与每个输入的摘要都与记录相同才有效。判一致的
 * 输入含试读的答案，用记录里的答案重算。
 */

import type {CanonReadView} from "@notnotype/nb-canon/schema";

import type {CheckRecord, SelfReport, TrialAnswer} from "../../shared/checks";
import type {InstructionSnapshot} from "../../shared/instructions";
import type {Digest} from "../guards";
import {inputDigest, planCheck} from "./plan";
import {judgeRequest} from "./trial";

export interface ValidityInput {
    readonly view: CanonReadView;
    readonly record: CheckRecord;
    readonly instruction?: InstructionSnapshot;
    readonly selfReport?: SelfReport;
    readonly digest: Digest;
}

export function isValid(input: ValidityInput): boolean {
    const {view, record, digest} = input;
    const plan = planCheck({view, chapter: record.chapter, followUps: record.followUps, digest, ...(input.instruction === undefined ? {} : {instruction: input.instruction}), ...(input.selfReport === undefined ? {} : {selfReport: input.selfReport})});
    if ("code" in plan) return false;
    const expected = new Map(plan.calls.map((call) => [call.id, call.digest]));
    for (const call of record.calls) {
        if (call.layer !== "reader") continue;
        const answer = call.answer as TrialAnswer;
        if (answer.confidence === "none") continue;
        const truth = plan.trials.find((trial) => trial.point === call.point)?.truth;
        if (truth === undefined) return false;
        expected.set(`judge:${call.point!}`, inputDigest(judgeRequest(truth, answer), digest));
    }
    return expected.size === record.calls.length && record.calls.every((call) => expected.get(call.id) === call.digest);
}
