import {describe, expect, it} from "vitest";
import {Value} from "typebox/value";
import directorProfileDefinition from "../../../assets/workspace/.nbook/agent/profiles/builtin/director.profile";
import simulatorLeaderProfileDefinition from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.leader.profile";
import {DirectorInitialSchema, DirectorOutputSchema, SimulatorLeaderInitialSchema, SimulatorLeaderOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {storedMessageText, type StoredMessageLike} from "nbook/server/agent/messages/stored-message-presentation";
import {createTestRuntimeSession as testSession} from "nbook/server/agent/profiles/test/runtime-session";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";
import {normalizeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";

const directorProfile = normalizeAgentProfile(directorProfileDefinition);
const simulatorLeaderProfile = normalizeAgentProfile(simulatorLeaderProfileDefinition);

function messagesText(messages: StoredMessageLike[] | undefined): string {
    return (messages ?? []).map((message) => storedMessageText(message)).join("\n");
}

const validDirectorOutput = {
    summary: "已整理本章 Scene。",
    status: "completed",
    plot_updates: [{
        kind: "scene",
        action: "updated",
        id: "scene-1",
        title: "遭遇",
        summary: "补齐 World Anchor。",
    }],
    chapter_plan: "按 Scene 顺序推进。",
    writer_handoff: "交给 writer 的 Scene / World Context brief。",
    world_engine_requests: ["需要确认 scene-1 结束时 erina 的位置。"],
    open_questions: [],
};

describe("simulation and director builtin profiles", () => {
    it("simulator.leader 暴露世界模拟合同和受限工具", async () => {
        const prepared = await simulatorLeaderProfile.prepare!({
            session: testSession({
                profileKey: "simulator.leader",
                currentProjectRoot: "rp-project",
                customState: {},
                linkedAgents: [],
                archived: false,
                agentMode: "normal",
            }),
            initial: {},
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
            settings: {},
        });
        const systemPrompt = prepared.systemPrompt ?? "";
        const prompt = [systemPrompt, messagesText(prepared.historyInitMessages), messagesText(prepared.modelContextMessages)].join("\n");

        expect(simulatorLeaderProfile.initialSchema).toBe(SimulatorLeaderInitialSchema);
        expect(simulatorLeaderProfile.outputSchema).toBe(SimulatorLeaderOutputSchema);
        expect(simulatorLeaderProfile.rootToolKeys).toEqual([
            "read",
            "write",
            "edit",
            "apply_patch",
            "bash",
            "create_agent",
            "invoke_agent",
            "get_agent",
            "get_agent_profile",
            "get_session",
            "get_story_tree",
            "get_story_thread",
            "get_story_scene_context",
            "get_story_chapter",
        ]);
        expect(simulatorLeaderProfile.rootToolKeys).not.toContain("create_story_plot");
        expect(simulatorLeaderProfile.rootToolKeys).not.toContain("report_result");
        expect(prompt).toContain("世界模拟主管");
        expect(prompt).toContain("RP Tick 模式");
        expect(prompt).toContain("普通写作模式：当前由 leader.default 直接管理");
        expect(prompt).toContain("不设计长期 Thread / Scene");
        expect(prompt).toContain("RP/simulation 模式下的 Plot 落库由调用方");
        expect(prompt).toContain("普通写作模式的 Plot 由 leader.default 管理");
        expect(prompt).toContain("mode: 每轮任务 prompt 指定");
        expect(prompt).toContain("AGENTS.md 和 agents/simulator.leader/context.md");
        expect(prompt).toContain("最小 subject scaffold");
        expect(prompt).toContain("直接用普通 assistant 文本返回最终结果");
        expect(prompt).toContain("projectRoot: rp-project");
        expect(prompt).toContain("reference/agent/profile-routing.md");
        expect(prompt).toContain("RP 用户体验与叙事组装转 `rp.leader`");
        expect(prompt).toContain("reference/agent/workspace-tool-use.md");
        expect(prompt).toContain("reference/content/simulation.md");
    });

    it("director 暴露 Plot System 合同和 Scene World Context", async () => {
        const prepared = await directorProfile.prepare!({
            session: testSession({
                profileKey: "director",
                customState: {},
                linkedAgents: [],
                archived: false,
                agentMode: "normal",
            }),
            initial: {
                projectRoot: "rp-project",
                mode: "writing",
                defaultChapterPath: "rp-project/manuscript/001-volume/001-chapter/",
            },
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
            settings: {},
        });
        const systemPrompt = prepared.systemPrompt ?? "";
        const prompt = [systemPrompt, messagesText(prepared.historyInitMessages), messagesText(prepared.modelContextMessages)].join("\n");

        expect(directorProfile.initialSchema).toBe(DirectorInitialSchema);
        expect(directorProfile.outputSchema).toBe(DirectorOutputSchema);
        expect(directorProfile.rootToolKeys).toContain("get_scene_world_context");
        expect(directorProfile.rootToolKeys).toContain("get_chapter_writer_brief");
        expect(directorProfile.rootToolKeys).not.toContain("create_story_plots");
        expect(directorProfile.rootToolKeys).not.toContain("write");
        expect(directorProfile.rootToolKeys).not.toContain("edit");
        expect(prompt).toContain("剧情导演");
        expect(prompt).toContain("Thread / Scene");
        expect(systemPrompt).toContain("world_engine_requests");
        expect(systemPrompt).toContain("不写 World Engine");
        expect(systemPrompt).toContain("World Engine gate");
        expect(systemPrompt).toContain("get_chapter_writer_brief");
        expect(systemPrompt).toContain("suggestedBriefMarkdown");
        expect(prompt).toContain("不维护 simulation/subjects/**");
        expect(prompt).toContain("reference/plot/agent-spec.md");
        expect(prompt).toContain("defaultChapterPath: rp-project/manuscript/001-volume/001-chapter/");
        expect(systemPrompt).not.toContain("simulator.leader");
        expect(systemPrompt).not.toContain("simulator_requests");
        expect(systemPrompt).not.toContain("Simulation gate");
    });

    it("director output schema 拒绝旧 simulator contract 和额外字段", () => {
        expect(Value.Check(DirectorOutputSchema, validDirectorOutput)).toBe(true);
        expect(Value.Check(DirectorOutputSchema, {
            ...validDirectorOutput,
            simulator_requests: [],
        })).toBe(false);
        expect(Value.Check(DirectorOutputSchema, {
            ...validDirectorOutput,
            extra: true,
        })).toBe(false);
        expect(Value.Check(DirectorOutputSchema, {
            ...validDirectorOutput,
            plot_updates: [{
                ...validDirectorOutput.plot_updates[0],
                kind: "plot",
            }],
        })).toBe(false);
        expect(Value.Check(DirectorOutputSchema, {
            ...validDirectorOutput,
            plot_updates: [{
                ...validDirectorOutput.plot_updates[0],
                extra: true,
            }],
        })).toBe(false);
        const {world_engine_requests, ...withoutWorldEngineRequests} = validDirectorOutput;
        expect(world_engine_requests).toHaveLength(1);
        expect(Value.Check(DirectorOutputSchema, withoutWorldEngineRequests)).toBe(false);
    });
});
