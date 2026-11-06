/**
 * 写完以后的检查（docs/specs/plot/checks.md）的共用形状与远程合同 `nbook.plot/checks`。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {Type} from "typebox";
import type {Static} from "typebox";

const Text = Type.String({maxLength: 20_000});

/**
 * 写手的自陈（brief.md 输出 11）与它实际拿到的上下文（checks.md 输入）。写完以后世界已经变了，重拼出来的上下文不是写手当时那份，
 * 所以由写作任务连同自陈一起交回。
 */
export const SelfReportSchema = Type.Object({
    chapter: Type.String(),
    report: Type.Object({
        names: Type.Array(Text, {maxItems: 500}),
        unsure: Type.Array(Text, {maxItems: 500}),
        deviations: Type.Array(Text, {maxItems: 500}),
    }, {additionalProperties: false}),
    brief: Type.String({maxLength: 400_000}),
}, {additionalProperties: false});

export type SelfReport = Static<typeof SelfReportSchema>;

const errors = {plot: Type.Object({code: Type.String()})};

const methods = {
    /** 按章替换写手的自陈（`value` 为 null 是删除）。 */
    putSelfReport: {input: Type.Object({chapter: Type.String(), value: Type.Union([SelfReportSchema, Type.Null()])}), output: Type.Object({dataVersion: Type.String()}), effect: "write", errors},
} as const;

export const plotChecksContract = defineRemoteService({id: "nbook.plot/checks", version: 1, provider: "project", callers: ["browser", "tui", "server"], methods, events: {}});
