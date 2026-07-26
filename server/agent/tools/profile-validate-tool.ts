import {Type} from "typebox";
import type {Static} from "typebox";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import {previewAgentProfilePrepare} from "nbook/server/agent/profiles/profile-http-service";
import type {JsonValue} from "nbook/server/agent/messages/types";

const ValidateAgentProfileSchema = Type.Object({
    profileKey: Type.String({description: "Agent profile key from AgentCatalog, e.g. writer or retrieval."}),
    includeSystemPrompt: Type.Optional(Type.Boolean({
        description: "Default false. Set true to include the full rendered system prompt for semantic review (may be long).",
    })),
});

type ValidateAgentProfileInput = Static<typeof ValidateAgentProfileSchema>;

/**
 * validate_agent_profile：合约校验工具。
 *
 * 修改某个 agent 的提示词预设（profile home prompts/*.md）或 profile 源码后，
 * 用本工具做机器校验：真实走一遍 profile compile + prepare 渲染管线，
 * 确认编译通过、系统提示词渲染非空、结构合约标记（如 report_result 指令）仍然完整。
 * 机器校验通过后，再由调用方（leader）按合约红线清单做语义审查。
 */
export const profileValidateTools = {
    validateAgentProfile: defineAgentTool({
        key: "validate_agent_profile",
        name: "validate_agent_profile",
        label: "Validate Agent Profile",
        executionMode: "parallel",
        description: [
            "Validate that an agent profile still renders and satisfies its structural contract.",
            "Run this after editing a profile's prompt preset files (profile home prompts/*.md) or profile source, before telling the user the change is safe.",
            "It executes the real compile + prepare pipeline and reports: compile/prepare issues, rendered system prompt length, and structural contract checks (report_result instruction present when the profile declares an output schema).",
            "Set includeSystemPrompt=true to get the full rendered system prompt for semantic review.",
        ].join("\n"),
        parameters: ValidateAgentProfileSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as ValidateAgentProfileInput;
            const preview = await previewAgentProfilePrepare(context.harness, {profileKey: input.profileKey});
            const systemPrompt = preview.messages.find((message) => message.role === "system")?.text ?? "";
            const declaresOutputSchema = Boolean(preview.reportResultSchema);
            const checks = {
                prepareOk: preview.ok,
                systemPromptRendered: systemPrompt.trim().length > 0,
                systemPromptChars: systemPrompt.length,
                declaresOutputSchema,
                reportResultInstructionPresent: declaresOutputSchema ? systemPrompt.includes("report_result") : null,
                customTopInjected: systemPrompt.includes("<custom_top_system_prompt>"),
                customBottomInjected: systemPrompt.includes("<custom_bottom_system_prompt>"),
            };
            const failures: string[] = [];
            if (!checks.prepareOk) {
                failures.push("profile compile/prepare 阶段存在 issue，详见 issues。");
            }
            if (!checks.systemPromptRendered) {
                failures.push("系统提示词渲染为空。");
            }
            if (checks.reportResultInstructionPresent === false) {
                failures.push("profile 声明了 OutputSchema，但系统提示词中缺失 report_result 合约指令。");
            }
            const result: Record<string, JsonValue> = {
                profileKey: input.profileKey,
                valid: failures.length === 0,
                failures,
                checks,
                issues: preview.issues as unknown as JsonValue,
                ...(input.includeSystemPrompt ? {systemPrompt} : {}),
            };
            return {
                content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                details: normalizeToolResultDetails(result),
            };
        },
    }),
} as const;
