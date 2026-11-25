/**
 * 审批钩子在 NeuroBook 一侧的选项（docs/specs/agent/permissions.md）：判定本身在宿主套件（`createApprovalHook`），这里给它
 * NeuroBook 的规则来源（设置、作品的 `.nbook/permissions.json`）、Agent 模式的闸门与它的文字、审批模型的称呼与原因串。
 * 不传 `escalate`：要问人的一律交回内核问用户（w00032 t14 决定 8）。
 */

import type {ApprovalCtx, ApproveHook} from "@notnotype/nb-harness/kernel/contracts";
import {createApprovalHook, modelReviewer} from "@notnotype/nb-harness/kit/approval";
import type {ModeWriteAction} from "@notnotype/nb-harness/kit/approval";
import type {Dialects} from "@notnotype/nb-harness/kit/commands";

import type {WorkspaceFiles} from "nbook/plugins/files/shared/contracts";

import {AUTO_ESCALATED_PREFIX, AUTO_FAILED_REASON, MODE_ASK_REASON} from "../../shared/permissions";
import type {Rule} from "../../shared/permissions";
import type {ToolSubject} from "../../shared/points";
import {EVAL_TOOL} from "../eval/tool";
import {filesFor} from "../resources";
import {readProjectRules} from "./project-rules";

/** 模式闸门拒绝时给模型的话（进日志）：说的是 NeuroBook 的 `switch_mode` 与 discuss、plan 两种模式。 */
export const MODE_BLOCKED_TEXT = "This session is in a read-only mode (discuss or plan), so this call was not run. Call switch_mode to ask the user to change modes (without that tool, ask the user in your reply), or use a read-only approach.";
/** 项目规则读不了时的诊断消息（进日志）。 */
const PROJECT_RULES_INVALID = "the project's .nbook/permissions.json could not be read or is not a valid list of rules";

export interface PermissionHookOptions {
    readonly files: WorkspaceFiles;
    readonly userRules: () => readonly Rule[];
    readonly dialects: Dialects;
    readonly modeWriteAction: () => ModeWriteAction;
    /** 工具交出的判定对象。`activate` 为真时提供方没激活就先激活；取不到（激活失败、抛错）交回 null。 */
    readonly subjectsOf: (tool: string, args: Readonly<Record<string, unknown>>, activate: boolean) => Promise<readonly ToolSubject[] | null>;
    /** 当前 Agent 模式；`normal` 或没装扩展时没有闸门。 */
    readonly modeOf: (read: ApprovalCtx["read"]) => string;
    readonly report: (code: string, message: string, params?: Record<string, unknown>) => void;
}

export function createPermissionHook(options: PermissionHookOptions): ApproveHook {
    const files = filesFor(options.files);
    return createApprovalHook({
        files,
        userRules: options.userRules,
        projectRules: (context, signal) => readProjectRules(options.files, context.project, signal),
        projectRulesInvalidMessage: PROJECT_RULES_INVALID,
        dialects: options.dialects,
        gated: (read) => options.modeOf(read) !== "normal",
        modeWriteAction: options.modeWriteAction,
        gate: {askReason: MODE_ASK_REASON, blockedText: MODE_BLOCKED_TEXT},
        subjectsOf: options.subjectsOf,
        rememberable: (tool) => tool !== EVAL_TOOL,
        review: modelReviewer({
            agentDescription: "a writing and coding agent",
            provider: "nbook.agent",
            // 模型不必自己解析 `project://`：交给它全局地址，没有主项目为 null。
            projectOf: (context) => {
                const expanded = files(context, null).expand("project://");
                return expanded.ok ? expanded.address : null;
            },
            reasons: {failed: AUTO_FAILED_REASON, escalatedPrefix: AUTO_ESCALATED_PREFIX},
            report: options.report,
        }),
        report: options.report,
    });
}
