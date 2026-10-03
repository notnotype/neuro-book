import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {LeaderDefaultInitialSchema, LeaderDefaultOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";

/**
 * 最小内置 profile。真实 builtin profile 从 assets/workspace/.nbook 迁移。
 */
export const defaultAgentProfile = defineAgentProfile({
    manifest: {
        key: "leader.default",
        name: "Default Leader",
        description: "最小 leader profile，用于 harness 闭环和测试。",
    },
    initialSchema: LeaderDefaultInitialSchema,
    outputSchema: LeaderDefaultOutputSchema,
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.file.edit,
        builtin.file.applyPatch,
        builtin.file.bash,
        builtin.control.requestUserInput,
        builtin.control.switchMode,
        builtin.agent.create,
        builtin.agent.invoke,
        builtin.agent.get,
        builtin.agent.getProfile,
        builtin.agent.getSession,
        builtin.agent.detach,
    ),
    prepare() {
        return {
            systemPrompt: "You are Neuro Book Agent.",
        };
    },
});
