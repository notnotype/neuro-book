/**
 * 写入失败给作者看的一句（docs/specs/canon/author-ui.md 输出 29 与“失败与恢复”）。不把码给作者看；码只用来选写法，服务给的
 * 说明（校验不过的第一条、结果不符时读回的值）原样带上。写入的各个入口共用。
 */

import {displayText} from "@notnotype/nb-canon";
import type {Text} from "@notnotype/nb-ui/text";

import {canonText} from "../shared/text";
import type {CanonFailure} from "../shared/contracts";

export interface FailureText {
    readonly text: Text;
    /** `unknown-outcome`：给“再查一次”（同一输入、同一请求 id）。 */
    readonly recheck: boolean;
}

const firstProblem = (failure: CanonFailure): string => {
    const problems = failure.problems;
    const first = Array.isArray(problems) ? (problems[0] as {message?: unknown} | undefined) : undefined;
    return typeof first?.message === "string" ? first.message : "";
};

export function failureText(failure: CanonFailure): FailureText {
    const plain = (text: Text): FailureText => ({text, recheck: false});
    switch (failure.code) {
        case "value-conflict": return plain(canonText("failure.valueConflict"));
        case "version-conflict": return plain(canonText("failure.versionConflict"));
        case "validation-failed": return plain(canonText("failure.validation", {reason: firstProblem(failure)}));
        case "result-mismatch": return plain(canonText("failure.resultMismatch", {reason: displayText(failure.got)}));
        case "write-failed": return plain(canonText("failure.writeFailed"));
        case "world-locked": return plain(canonText("failure.worldLocked"));
        case "too-large": return plain(canonText("failure.tooLarge"));
        case "accumulated-value": return plain(canonText("failure.accumulated"));
        case "unknown-outcome": return {text: canonText("failure.unknownOutcome"), recheck: true};
        case "world-read-only": return plain(canonText("blocked.readOnly", {reason: typeof failure.reason === "string" ? failure.reason : ""}));
        case "busy": return plain(canonText("blocked.busy", {holder: typeof failure.holder === "string" ? failure.holder : ""}));
        // `not-deletable` 只在给条目、剧情变更 `after: null` 时出现（canon.revisions 输出 20）；界面删除条目写墓碑，碰不到它，
        // 万一出现按“别的失败”。
        default: return plain(canonText("failure.other"));
    }
}
