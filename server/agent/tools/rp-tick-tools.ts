import {Type} from "typebox";
import type {Static} from "typebox";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";
import {listTicks} from "nbook/server/rp/prose-store";

/**
 * RP 模式 Tick 总账工具：`rp/ticks/` 目录是编号的唯一权威。
 * rp.leader 在每 Tick 开始时调用并向全管线宣告编号；其他 agent 只用被告知的编号，
 * 禁止自行推算（实测各 agent 自行计数会出现断号与互相不一致）。
 */

const TickInfoSchema = Type.Object({
    projectPath: Type.String({minLength: 1, description: "Project Workspace path, e.g. workspace/my-novel."}),
}, {additionalProperties: false});

type TickInfoInput = Static<typeof TickInfoSchema>;

export const rpTickTools = {
    rpTickInfo: defineAgentTool({
        key: "rp_tick_info",
        name: "rp_tick_info",
        label: "RP Tick Info",
        executionMode: "parallel",
        description: [
            "Authoritative RP tick ledger from rp/ticks/: existing ticks (with prose/report presence), maxTick, and nextTick.",
            "nextTick is THE tick number to use when starting a new tick — announce it to every downstream agent; never compute tick numbers yourself.",
            "Also useful to spot gaps (a tick without prose/report means an unfinished pipeline run).",
        ].join("\n"),
        parameters: TickInfoSchema,
        async executeWithContext(context: ToolExecutionContext, _toolCallId, params: unknown) {
            const input = params as TickInfoInput;
            const normalized = normalizeProjectPath(input.projectPath);
            assertProjectOpen(normalized);
            markProjectActivity(normalized);
            const projectRoot = resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
            const overview = await listTicks(projectRoot);
            const details = normalizeToolResultDetails(overview as unknown as JsonValue);
            return {
                content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}],
                details,
            };
        },
    }),
} as const;
