/**
 * Agent 模式（docs/specs/agent/modes.md）：扩展拥有模式与提示，工具 `switch_mode` 让模型申请切换。闸门在 `hook.ts`，经 `ApprovalCtx.read` 读这里。
 *
 * 模式放在扩展设置里：`settingsChanged` 只在会话层，所以回退不切回，重开保留，`fork` 带上，都是现有语义。
 */

import {Type} from "typebox";

import {defineContract, implement, reminder, shape} from "@notnotype/nb-harness/kernel";
import type {ApprovalMode, JsonValue, ToolResult} from "@notnotype/nb-harness/kernel/contracts";

import {AGENT_MODES_EXTENSION, MODE_SWITCH_KIND} from "../../shared/permissions";
import type {AgentMode, ModeSwitchAnswer, ModeSwitchRequest} from "../../shared/permissions";
import type {AgentToolDeclaration, AgentToolImplementation} from "../../shared/points";
import {failed} from "../builtin/common";

const AGENT_MODES: readonly AgentMode[] = ["normal", "discuss", "plan"];
const APPROVAL_MODES: readonly ApprovalMode[] = ["ask", "allow-writes", "auto", "yolo"];
/** 计划进审批请求与工具结果，也就进日志与模型上下文：和审批预览的上限一样。 */
const PLAN_LIMIT_BYTES = 256 * 1024;
const PLAN_ADDRESS = "session://plan.md";

export const modesContract = defineContract(AGENT_MODES_EXTENSION, {exports: shape<{mode: AgentMode}>()});

const modesExtension = implement(modesContract, {
    settings: Type.Object({mode: Type.Union(AGENT_MODES.map((mode) => Type.Literal(mode)), {default: "normal"})}),
    exports: {mode: (_state, settings) => settings.mode as AgentMode},
});

const FULL: Readonly<Record<Exclude<AgentMode, "normal">, string>> = {
    discuss: "现在是讨论模式：只讨论，不改作品。可以读文件、跑只读命令，中间产物写 tmp:// 或 session://。写作品与别的命令会被拒绝；要动手时用 switch_mode 申请切到 normal，用户同意后再做。",
    plan: "现在是计划模式：先把要做的事想清楚，不改作品。可以读文件、跑只读命令。把计划写到 session://plan.md，写完单独调用 switch_mode 申请切到 normal，用户批准后再动手。",
};
const SHORT: Readonly<Record<Exclude<AgentMode, "normal">, string>> = {
    discuss: "（讨论模式：不改作品。）",
    plan: "（计划模式：不改作品，计划写在 session://plan.md。）",
};

/** 值变了那轮一条完整的，之后每轮一句短的；回到 `normal` 时一句“已退出”，之后不写。放消息里：工具集与系统提示词不随模式变，缓存不受影响。 */
const modeReminder = reminder({
    id: "nbook.agent.mode-reminder",
    dependsOn: [modesContract],
    every: 1,
    watch: (view) => view.read(modesContract).mode,
    text: ({value, previous}) => {
        const mode = value as AgentMode;
        if (mode !== "normal") return mode === previous ? SHORT[mode] : FULL[mode];
        return previous === "discuss" || previous === "plan" ? "已退出讨论或计划模式，可以正常修改作品了。" : null;
    },
});

export const modesExtensions = [modesExtension, modeReminder];

export const switchModeDeclaration: AgentToolDeclaration = {
    description: "申请切换 Agent 模式（normal 正常干活，discuss 只讨论，plan 讨论并写计划），用户同意后生效。从 plan 切走时用户会看到 session://plan.md 的全文，写好计划再申请，不要和写计划放在同一条回复里。",
    parameters: {
        type: "object",
        properties: {mode: {type: "string", enum: [...AGENT_MODES]}},
        required: ["mode"],
    },
    version: "1",
    concurrency: "exclusive",
    // 不走审批：它自己问用户，任何审批模式下都要用户答（输出 8）。声明成读，闸门、放行规则与 `yolo` 都碰不到它，拒绝规则还能禁掉它。
    effect: "read",
};

const isAnswer = (data: unknown): data is ModeSwitchAnswer => {
    if (typeof data !== "object" || data === null) return false;
    const {approved, approvalMode} = data as {approved?: unknown; approvalMode?: unknown};
    return typeof approved === "boolean" && (approvalMode === undefined || APPROVAL_MODES.includes(approvalMode as ApprovalMode));
};

export type ChangeModeSettings = (sessionId: string, patch: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>) => Promise<{readonly ok: boolean; readonly code?: string}>;

export const switchModeTool = (changeSettings: ChangeModeSettings): AgentToolImplementation => ({
    create: (context, {resources}) => ({
        execute: async (args, call): Promise<ToolResult> => {
            const to = args.mode as AgentMode;
            const from = call.read(modesContract)?.mode;
            if (from === undefined) return failed("mode-unavailable", "mode-unavailable: 这个会话没有 Agent 模式。");
            if (from === to) return {text: `已经是 ${to} 模式。`};
            if (context.background === true || call.ask === undefined) return failed("ask-unavailable", "ask-unavailable: 这个会话没有人能回答，按当前模式继续。");
            let plan: string | undefined;
            if (from === "plan") {
                const read = await resources.call(call).read(PLAN_ADDRESS);
                if (!read.ok) return failed("no-plan", `no-plan: 还没有计划，先写到 ${PLAN_ADDRESS}（${read.code}）。`);
                if (read.value.bytes.length > PLAN_LIMIT_BYTES) return failed("plan-too-large", `plan-too-large: ${PLAN_ADDRESS} 超过 256 KB，写短一些。`);
                plan = new TextDecoder().decode(read.value.bytes);
            }
            // 正文进请求：同一回复里先写的计划这时已落盘；用户看到的和下面交给模型的是同一份。
            const request: ModeSwitchRequest = {kind: MODE_SWITCH_KIND, from, to, ...(plan === undefined ? {} : {plan})};
            const reply = await call.ask({question: `切换到 ${to} 模式？`, data: request as unknown as JsonValue});
            if (reply.kind === "unavailable") return failed("ask-declined", "ask-declined: 用户没有回答，模式没变。");
            if (!isAnswer(reply.data)) return failed("ask-invalid-answer", "ask-invalid-answer: the answer is not in the expected shape");
            if (!reply.data.approved) return {text: `用户没有同意，还是 ${from} 模式。${reply.data.note === undefined ? "" : `用户说：${reply.data.note}`}`, details: reply.data as unknown as JsonValue};
            // 一次指令同时改模式与审批模式：第二步失败时计划已经开始执行，用户选的审批模式却没生效，不能拆开。
            const changed = await changeSettings(context.sessionId, {
                [AGENT_MODES_EXTENSION]: {mode: to},
                ...(reply.data.approvalMode === undefined ? {} : {core: {approvalMode: reply.data.approvalMode}}),
            });
            if (!changed.ok) return failed("mode-change-failed", `mode-change-failed: 模式没变（${changed.code ?? "unknown"}）。`);
            const text = plan === undefined ? `已切到 ${to} 模式。` : `用户批准了计划，已切到 ${to} 模式。按下面的计划开始实现：\n\n${plan}`;
            return {text, details: reply.data as unknown as JsonValue};
        },
    }),
});
