import {join, resolve} from "node:path";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import rpLeaderProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/rp.leader.profile";
import rpWriterProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile";
import simulatorActorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.actor.profile";
import simulatorLeaderProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.leader.profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {RpLeaderInitialSchema, RpLeaderOutputSchema, RpWriterInitialSchema, RpWriterOutputSchema, SimulatorLeaderInitialSchema, SubjectSimulatorInitialSchema, SubjectSimulatorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {storedMessageText, type StoredMessageLike} from "nbook/server/agent/messages/stored-message-presentation";
import {createTestRuntimeSession as testSession} from "nbook/server/agent/profiles/test/runtime-session";
import type {SidecarContext} from "nbook/server/agent/profiles/types";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

type SchemaWithProperties = {
    properties: Record<string, unknown>;
};

type SchemaWithType = {
    type?: string;
};

function messagesText(messages: StoredMessageLike[] | undefined): string {
    return (messages ?? []).map((message) => storedMessageText(message)).join("\n");
}
describe("RP builtin profiles", () => {
    it("catalog 加载 rp.leader、simulator.leader、simulator.actor、rp.writer，不再加载 leader.rp", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);
        const snapshot = await catalog.snapshot();
        const profileKeys = snapshot.profiles.map((profile) => profile.key);

        expect(profileKeys).toContain("rp.leader");
        expect(profileKeys).toContain("simulator.leader");
        expect(profileKeys).toContain("simulator.actor");
        expect(profileKeys).toContain("rp.writer");
        expect(profileKeys).not.toContain("leader.rp");
    }, 120_000);

    it("rp contracts 使用 RP 专用输入输出，不复用普通 writer chapterPaths", () => {
        expect(SimulatorLeaderInitialSchema.properties).toEqual({});

        expect(RpLeaderInitialSchema.properties).toEqual({});
        expect(RpLeaderOutputSchema.properties).not.toHaveProperty("result");

        expect(SubjectSimulatorInitialSchema.properties).toHaveProperty("subjectPath");
        expect(SubjectSimulatorInitialSchema.properties).not.toHaveProperty("actorId");
        expect(SubjectSimulatorInitialSchema.properties).not.toHaveProperty("instructionPath");
        expect(SubjectSimulatorInitialSchema.properties).not.toHaveProperty("eventsPath");
        expect(SubjectSimulatorInitialSchema.properties).not.toHaveProperty("memoryPath");
        expect(SubjectSimulatorInitialSchema.properties).not.toHaveProperty("mindPath");
        expect(SubjectSimulatorInitialSchema.properties).not.toHaveProperty("statePath");
        expect(SubjectSimulatorOutputSchema.properties).toHaveProperty("visible_response");
        expect(SubjectSimulatorOutputSchema.properties).toHaveProperty("spoken_dialogue");
        expect(SubjectSimulatorOutputSchema.properties).toHaveProperty("inner_response");
        expect(SubjectSimulatorOutputSchema.properties).not.toHaveProperty("updates");
        expect(SubjectSimulatorOutputSchema.properties).not.toHaveProperty("questions");

        expect(RpWriterInitialSchema.properties).toEqual({});
        expect(RpWriterInitialSchema.properties).not.toHaveProperty("phase");
        expect(RpWriterInitialSchema.properties).not.toHaveProperty("brief");
        expect(RpWriterInitialSchema.properties).not.toHaveProperty("supplemental_brief");
        expect(RpWriterInitialSchema.properties).not.toHaveProperty("writerInstructionPath");
        expect(RpWriterInitialSchema.properties).not.toHaveProperty("style");
        expect(RpWriterInitialSchema.properties).not.toHaveProperty("outputRequirements");
        expect(RpWriterInitialSchema.properties).not.toHaveProperty("language");
        expect(RpWriterInitialSchema.properties).not.toHaveProperty("chapterPaths");
        expect(RpWriterInitialSchema.properties).not.toHaveProperty("lorebookEntries");
        expect(RpWriterOutputSchema.properties).not.toHaveProperty("result");
        expect(RpWriterOutputSchema.properties).not.toHaveProperty("prose");
        expect(RpWriterOutputSchema.properties).not.toHaveProperty("summary");
    });

    it("rp.leader 作为 RP v2 编排层，读取 manual 并编排六角色流水线", async () => {
        const prepared = await rpLeaderProfile.prepare!({
            session: testSession({
                profileKey: "rp.leader",
                workspaceRoot: "workspace",
                projectPath: "workspace/rp-project",
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
        const historyText = messagesText(prepared.historyInitMessages);
        const modelContextText = messagesText(prepared.modelContextMessages);
        const appendingText = messagesText(prepared.appendingMessages);

        expect(rpLeaderProfile.initialSchema).toBe(RpLeaderInitialSchema);
        expect(rpLeaderProfile.outputSchema).toBe(RpLeaderOutputSchema);
        expect(rpLeaderProfile.rootToolKeys).toEqual([
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
            "rp_character_recall",
            "rp_character_update",
            "rp_tick_info",
            "task_create",
            "task_set_status",
        ]);
        expect(rpLeaderProfile.rootToolKeys).not.toContain("report_result");
        expect(systemPrompt).toContain("你是彩绘");
        expect(systemPrompt).toContain("炉火边的共犯");
        expect(systemPrompt).toContain("小屋（元场景）");
        expect(systemPrompt).toContain("万华镜（世界内）");
        expect(systemPrompt).toContain("rp/manual/README.md、rp/manual/player-guide/、rp/manual/gm-guide.md");
        // 完全分离:写作模式目录是禁区
        expect(systemPrompt).toContain("写作模式目录是禁区");
        expect(systemPrompt).toContain("rp/world-engine/");
        expect(systemPrompt).toContain("agents/rp.leader/");
        // v2 流水线：编排六角色,不再直接调 simulator.leader
        expect(systemPrompt).not.toContain("simulator.leader");
        expect(systemPrompt).toContain("每个常规 tick（用户输入 → 世界推进 → 等待下一条指令）");
        expect(systemPrompt).toContain("开场白 / 初始化正文");
        expect(systemPrompt).toContain("rp/ticks/000000-initial-state/prose.md");
        expect(systemPrompt).toContain("所有世界内用户可见正文都必须由 rp.writer 写");
        expect(systemPrompt).toContain("P1 读状态");
        expect(systemPrompt).toContain("P2 事前判断");
        expect(systemPrompt).toContain("轻量通道");
        expect(systemPrompt).toContain("P4 终裁");
        expect(systemPrompt).toContain("rp.world");
        expect(systemPrompt).toContain("rp.screenwriter");
        expect(systemPrompt).toContain("rp.cast");
        expect(systemPrompt).toContain("rp.extras");
        expect(systemPrompt).toContain("准备 Writer Brief");
        expect(systemPrompt).toContain("create_agent({profileKey: \"rp.writer\", initial: {}, title");
        expect(systemPrompt).toContain("invoke_agent 时把完整 Writer Brief 放进 message");
        expect(systemPrompt).toContain("再次发给同一个 session");
        expect(systemPrompt).toContain("Brief 本身就是信息过滤器");
        expect(systemPrompt).toContain("你是编剧");
        expect(systemPrompt).toContain("rp.leader 是当前唯一 canonical RP 主持名称");
        expect(systemPrompt).toContain("直接用 assistant 文本返回");
        expect(historyText).toContain("```AGENTS.md");
        expect(historyText).toContain("```reference/agent/profile-routing.md");
        expect(historyText).toContain("Project 文件/Lorebook 工程整理转 `leader.default`");
        expect(historyText).toContain("模拟器调试转 `simulator.leader`");
        expect(historyText).toContain("资产编辑转 `leader.assets`");
        expect(historyText).toContain("```reference/content/manual.md");
        expect(historyText).toContain("```reference/agent/rp-v2/README.md");
        expect(historyText).toContain("```reference/agent/rp-v2/character-memory.md");
        expect(historyText).toContain("```reference/agent/workspace-tool-use.md");
        expect(historyText).toContain("```reference/agent/project-workspace-guide.md");
        expect(modelContextText).toContain("projectPath: workspace/rp-project");
        expect(modelContextText).toContain("manualRoot: rp/manual/");
        expect(modelContextText).toContain("rpRoot: rp/");
        expect(modelContextText).toContain("pipeline: rp.world");
        expect(appendingText).toContain("Runtime Location");
    });

    it("simulator.leader 作为 simulation runtime owner 并负责调度 actor", async () => {
        const prepared = await simulatorLeaderProfile.prepare!({
            session: testSession({
                profileKey: "simulator.leader",
                workspaceRoot: "workspace",
                projectPath: "workspace/rp-project",
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
        const historyText = messagesText(prepared.historyInitMessages);
        const modelContextText = messagesText(prepared.modelContextMessages);

        expect(simulatorLeaderProfile.rootToolKeys).toContain("create_agent");
        expect(simulatorLeaderProfile.rootToolKeys).toContain("invoke_agent");
        expect(simulatorLeaderProfile.rootToolKeys).toContain("bash");
        expect(simulatorLeaderProfile.rootToolKeys).not.toContain("report_result");
        expect(systemPrompt).toContain("世界模拟主管");
        expect(systemPrompt).toContain("AGENTS.md 和 agents/simulator.leader/context.md");
        expect(systemPrompt).toContain("leader.default 和用户入口通常只与你交流");
        expect(systemPrompt).toContain("为需要模拟的 subject 创建或复用 simulator.actor");
        expect(systemPrompt).toContain("最小 subject scaffold");
        expect(systemPrompt).toContain("全自动下一 tick");
        expect(systemPrompt).toContain("直接用普通 assistant 文本返回最终结果");
        expect(historyText).toContain("```AGENTS.md");
        expect(historyText).toContain("```reference/agent/profile-routing.md");
        expect(historyText).toContain("RP 用户体验与叙事组装转 `rp.leader`");
        expect(historyText).toContain("长期 Thread / Scene 设计");
        expect(historyText).toContain("World Engine 数据维护转 `world.engine`");
        expect(historyText).toContain("正式章节正文由上级调用 `writer`");
        expect(historyText).toContain("```reference/agent/workspace-tool-use.md");
        expect(modelContextText).toContain("projectPath: workspace/rp-project");
        expect(modelContextText).toContain("mode: 每轮任务 prompt 指定");
    });

    it("simulator.actor 主路只注入 actor binding，subject 文件由 sidecar 加载", async () => {
        const fixture = await createRoleplayFixture();
        try {
            const prepared = await simulatorActorProfile.prepare!({
                session: testSession({
                    profileKey: "simulator.actor",
                    workspaceRoot: "workspace",
                    projectPath: `workspace/${fixture.projectSlug}`,
                    customState: {},
                    linkedAgents: [],
                    archived: false,
                    agentMode: "normal",
                }),
                initial: {
                    subjectPath: "simulation/subjects/heroine",
                    kind: "npc",
                },
                vars: createTestVariableAccessor(),
                catalog: {profiles: [], issues: []},
                skills: [],
                settings: {},
            });
            const systemPrompt = prepared.systemPrompt ?? "";
            const modelContextText = messagesText(prepared.modelContextMessages);
            const appendingText = messagesText(prepared.appendingMessages);
            const sidecars = simulatorActorProfile.sidecars ?? [];
            const contextLoad = sidecars.find((sidecar) => sidecar.name === "actor.context-load");
            const memorySave = sidecars.find((sidecar) => sidecar.name === "actor.memory-save");

            expect(simulatorActorProfile.rootToolKeys).toEqual(["subject_rag_search", "subject_event_append", "subject_memory_update", "read", "edit", "report_result", "report_sidecar_result"]);
            expect(sidecars.map((sidecar) => sidecar.name)).toEqual(["actor.context-load", "actor.memory-save"]);
            expect(contextLoad).toEqual(expect.objectContaining({
                stage: "prepareRun",
                toolKeys: ["subject_rag_search", "report_sidecar_result"],
            }));
            expect(memorySave).toEqual(expect.objectContaining({
                stage: "settleRun",
                toolKeys: ["subject_event_append", "subject_memory_update", "read", "edit", "report_sidecar_result"],
            }));
            expect(simulatorActorProfile.toolKeys).toEqual(["report_result"]);
            expect((contextLoad?.sidecarDataSchema as SchemaWithProperties | undefined)?.properties).toEqual({});
            expect((memorySave?.sidecarDataSchema as SchemaWithProperties | undefined)?.properties).toEqual({});
            const memorySavePrompt = typeof memorySave?.enterPrompt === "function"
                ? memorySave.enterPrompt({
                    name: "actor.memory-save",
                    stage: "settleRun",
                    sessionId: -1,
                    session: testSession({
                        profileKey: "simulator.actor",
                        workspaceRoot: "workspace",
                        projectPath: `workspace/${fixture.projectSlug}`,
                    }),
                    initial: {
                        subjectPath: "simulation/subjects/heroine",
                        kind: "npc",
                    },
                    runResult: {
                        status: "completed",
                        reportResult: {
                            result: "ok",
                            data: {
                                visible_response: "她向后退了一步。",
                                spoken_dialogue: "",
                                inner_response: "她开始警惕这条新消息。",
                            },
                        },
                    },
                    invocationId: "test-invocation",
                    profileKey: "simulator.actor",
                    caller: {kind: "sidecar"},
                } satisfies SidecarContext<Parameters<typeof memorySave.merge>[0]["initial"]>)
                : memorySave?.enterPrompt ?? "";
            const contextLoadPrompt = typeof contextLoad?.enterPrompt === "function"
                ? contextLoad.enterPrompt({
                    name: "actor.context-load",
                    stage: "prepareRun",
                    sessionId: -1,
                    session: testSession({
                        profileKey: "simulator.actor",
                        workspaceRoot: "workspace",
                        projectPath: `workspace/${fixture.projectSlug}`,
                    }),
                    initial: {
                        subjectPath: "simulation/subjects/heroine",
                        kind: "npc",
                    },
                    invocationId: "test-invocation",
                    profileKey: "simulator.actor",
                    caller: {kind: "sidecar"},
                } satisfies SidecarContext<Parameters<typeof contextLoad.merge>[0]["initial"]>)
                : contextLoad?.enterPrompt ?? "";
            expect(contextLoadPrompt).toContain("subjectPath: simulation/subjects/heroine");
            expect(contextLoadPrompt).toContain("subjectPath 必须使用上面的 subjectPath");
            expect(contextLoadPrompt).toContain("不要关键词 fallback");
            expect(memorySavePrompt).toContain("eventsPath");
            expect(memorySavePrompt).toContain("subjectPath: simulation/subjects/heroine");
            expect(memorySavePrompt).toContain("subjectPath 必须使用上面的 subjectPath");
            expect(memorySavePrompt).toContain("从上面的 report_result.data 提取 visible_response、spoken_dialogue、inner_response");
            expect(memorySavePrompt).toContain("不读取也不写 subject.md、soul.md、state.md");
            expect(memorySavePrompt).toContain("只有对应写入工具实际调用成功后");
            expect(memorySavePrompt).toContain("report_sidecar_result.result");
            expect(memorySavePrompt).toContain("\"actor.memory-save\"");
            expect(memorySavePrompt).toContain("{ \"actor.memory-save\": {} }");
            expect(contextLoadPrompt).toContain("{ \"actor.context-load\": {} }");
            expect(memorySavePrompt).not.toContain("\"payload\": {}");
            expect(contextLoadPrompt).not.toContain("\"sidecar\": \"actor.context-load\"");
            expect(systemPrompt).toContain("<actor>");
            expect(systemPrompt).toContain("<subject id=\"heroine\" kind=\"npc\" />");
            expect(systemPrompt).toContain("你就是 soul.md 描述的那个人");
            expect(systemPrompt).toContain("<thinking_mode>");
            expect(systemPrompt).toContain("请以 soul.md 里这个人的第一人称进行人物分析");
            expect(systemPrompt).toContain("我先按 soul.md 确认我是谁");
            expect(systemPrompt).toContain("你的思考应严格按以下顺序进行");
            expect(systemPrompt).toContain("回顾 <actor-sidecar-context>");
            expect(systemPrompt).toContain("<message_tags>");
            expect(systemPrompt).toContain("必须调用 report_result");
            expect(systemPrompt).toContain("report_result.result");
            expect(systemPrompt).toContain("inner_response");
            expect(systemPrompt).not.toContain("questions");
            expect(systemPrompt).toContain("<npc_rules>");
            expect(systemPrompt).not.toContain("<player_rules>");
            expect(systemPrompt).toContain("主扮演阶段实际只能执行 report_result");
            expect(systemPrompt).toContain("不要调用 read、write、edit、subject_rag_search、subject_event_append 或 subject_memory_update");
            expect(systemPrompt).toContain("你看不到 subject.md（全知秘密档，只给上级模拟器）");
            expect(systemPrompt).toContain("文件维护由 actor.context-load / actor.memory-save 旁路处理");
            expect(systemPrompt).toContain("visible_response");
            expect(systemPrompt).toContain("我只表达角色反应本身");
            expect(systemPrompt).toContain("必须调用 report_result");
            expect(systemPrompt).toContain("<gm>");
            expect(systemPrompt).toContain("<character name=\"...\">");
            expect(systemPrompt).toContain("<knowledge>");
            expect(systemPrompt).toContain("<directive>");
            expect(systemPrompt).toContain("<actor-sidecar-context>");
            expect(systemPrompt).toContain("人设以 soul.md 为准");
            expect(systemPrompt).not.toContain("knowledge.md 使用二级章节归类");
            expect(systemPrompt).not.toContain("not_known_to_you");
            expect(systemPrompt).not.toContain("必要时可更新");
            expect(modelContextText).toContain("<actor_binding>");
            expect(modelContextText).toContain("actorId: heroine");
            expect(modelContextText).toContain("kind: npc");
            expect(modelContextText).not.toContain("actorName: heroine");
            expect(modelContextText).toContain("subjectPath: simulation/subjects/heroine");
            expect(modelContextText).toContain("这些路径只供 actor.context-load / actor.memory-save 旁路使用");
            expect(modelContextText).not.toContain("<subject_instruction>");
            expect(modelContextText).not.toContain("保持礼貌但警惕");
            expect(modelContextText).not.toContain("她第一次在广场边缘见到主角");
            expect(modelContextText).not.toContain("她相信主角值得观察");
            expect(modelContextText).not.toContain("她正在判断主角的用意");
            expect(modelContextText).not.toContain("她位于学院区广场边缘");
            expect(modelContextText).toContain("memoryPath");
            expect(modelContextText).toContain("eventsPath");
            expect(modelContextText).toContain("mindPath");
            expect(modelContextText).toContain("statePath");
            expect(modelContextText).toContain("<actor_run_reminder actorId=\"heroine\">");
            expect(modelContextText).toContain("只回应当前 user message");
            expect(modelContextText).toContain("并必须调用 report_result");
            expect(modelContextText).toContain("不要主动读写文件");
            expect(modelContextText).toContain("记忆维护交给 sidecar");
            expect(appendingText).toContain("Runtime Location");
            expect(appendingText).not.toContain("只回应当前 user message");
        } finally {
            await fixture.cleanup();
        }
    });

    it("simulator.actor context-load 从 report_sidecar_result.result 注入文本", async () => {
        const contextLoad = simulatorActorProfile.sidecars?.find((sidecar) => sidecar.name === "actor.context-load");
        const schema = contextLoad?.sidecarDataSchema;
        if (!contextLoad || !schema) {
            throw new Error("actor.context-load sidecarDataSchema missing");
        }

        expect((schema as SchemaWithProperties).properties).toEqual({});
        const pureTextPlan = await contextLoad.merge({
            name: "actor.context-load",
            stage: "prepareRun",
            sessionId: -1,
            session: testSession({profileKey: "simulator.actor"}),
            initial: {subjectPath: "simulation/subjects/heroine", kind: "npc"},
            invocationId: "test-invocation",
            profileKey: "simulator.actor",
            caller: {kind: "sidecar"},
        }, {
            result: "她知道自己正在学院区广场。",
            sidecarData: {},
        });
        const text = pureTextPlan.persistedMessages?.map((message) => storedMessageText(message)).join("\n") ?? "";
        expect(text).toContain("<actor-sidecar-context source=\"actor.context-load\">");
        expect(text).toContain("她知道自己正在学院区广场。");
    });

    it("simulator.actor 复用 subject simulator 合同并注入新 profile 身份", async () => {
        const fixture = await createRoleplayFixture();
        try {
            const prepared = await simulatorActorProfile.prepare!({
                session: testSession({
                    profileKey: "simulator.actor",
                    workspaceRoot: "workspace",
                    projectPath: `workspace/${fixture.projectSlug}`,
                    customState: {},
                    linkedAgents: [],
                    archived: false,
                    agentMode: "normal",
                }),
                initial: {
                    subjectPath: "simulation/subjects/heroine",
                    kind: "npc",
                },
                vars: createTestVariableAccessor(),
                catalog: {profiles: [], issues: []},
                skills: [],
                settings: {},
            });
            const systemPrompt = prepared.systemPrompt ?? "";
            const modelContextText = messagesText(prepared.modelContextMessages);

            expect(simulatorActorProfile.initialSchema).toBe(SubjectSimulatorInitialSchema);
            expect(simulatorActorProfile.outputSchema).toBe(SubjectSimulatorOutputSchema);
            expect(simulatorActorProfile.rootToolKeys).toEqual(["subject_rag_search", "subject_event_append", "subject_memory_update", "read", "edit", "report_result", "report_sidecar_result"]);
            expect(simulatorActorProfile.toolKeys).toEqual(["report_result"]);
            expect(systemPrompt).toContain("<profile>simulator.actor</profile>");
            expect(systemPrompt).toContain("<subject id=\"heroine\" kind=\"npc\" />");
            expect(modelContextText).toContain("<actor_binding>");
            expect(modelContextText).toContain("memoryPath");
        } finally {
            await fixture.cleanup();
        }
    });

    it("simulator.actor kind=player 注入 player_rules 而非 npc_rules", async () => {
        const fixture = await createRoleplayFixture();
        try {
            const prepared = await simulatorActorProfile.prepare!({
                session: testSession({
                    profileKey: "simulator.actor",
                    workspaceRoot: "workspace",
                    projectPath: `workspace/${fixture.projectSlug}`,
                    customState: {},
                    linkedAgents: [],
                    archived: false,
                    agentMode: "normal",
                }),
                initial: {
                    subjectPath: "simulation/subjects/heroine",
                    kind: "player",
                },
                vars: createTestVariableAccessor(),
                catalog: {profiles: [], issues: []},
                skills: [],
                settings: {},
            });
            const systemPrompt = prepared.systemPrompt ?? "";
            const modelContextText = messagesText(prepared.modelContextMessages);

            expect(systemPrompt).toContain("<subject id=\"heroine\" kind=\"player\" />");
            expect(systemPrompt).toContain("<player_rules>");
            expect(systemPrompt).not.toContain("<npc_rules>");
            expect(modelContextText).toContain("kind: player");
        } finally {
            await fixture.cleanup();
        }
    });

    it("rp.writer 只消费上级注入的 writer brief，直接输出讲故事口吻正文并允许指定文件工具", async () => {
        const fixture = await createRoleplayFixture();
        try {
            const prepared = await rpWriterProfile.prepare!({
                session: testSession({
                    profileKey: "rp.writer",
                    workspaceRoot: "workspace",
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
            const historyText = messagesText(prepared.historyInitMessages);
            const modelContextText = messagesText(prepared.modelContextMessages);
            const appendingText = messagesText(prepared.appendingMessages);

            expect(rpWriterProfile.rootToolKeys).toEqual(["read", "write", "edit", "bash", "report_result"]);
            expect(systemPrompt).toContain("<writing_reference>");
            expect(systemPrompt).toContain("<role>小猫之神</role>");
            expect(systemPrompt).toContain("<thinking_mode>");
            expect(systemPrompt).toContain("思维模式要求喵");
            expect(systemPrompt).toContain("<viewpoint_boundary>");
            expect(systemPrompt).toContain("<char_performance>");
            expect(systemPrompt).toContain("<important>");
            expect(systemPrompt).toContain("<paragraph_rhythm>");
            expect(systemPrompt).toContain("<markdown_dialect>");
            expect(systemPrompt).toContain("profile initial 为空");
            expect(systemPrompt).toContain("每轮任务只从最新 user message 读取");
            expect(systemPrompt).toContain("最新 user message 本身就是完整 Writer Brief");
            expect(systemPrompt).toContain("不需要外层 invocation wrapper");
            expect(systemPrompt).toContain("report_result.result");
            expect(systemPrompt).toContain("不使用 report_result.data 的结构化字段");
            expect(systemPrompt).not.toContain("report_result.data.questions");
            expect(systemPrompt).not.toContain("report_result.data.prose");
            expect(systemPrompt).not.toContain("职责根据 phase 参数分为两个阶段");
            expect(systemPrompt).not.toContain("Phase 4a（phase=check）：素材检查与提问");
            expect(systemPrompt).not.toContain("Phase 4c（phase=render）：渲染 prose");
            expect(systemPrompt).not.toContain("profile initial 包含 phase、brief、supplemental_brief");
            expect(systemPrompt).not.toContain("supplemental_brief");
            expect(systemPrompt).toContain("旧 Brief 输入字段、chapterPaths、lorebookEntries、writerInstructionPath");
            expect(systemPrompt).toContain("一切素材都由上级在 writer brief 中注入");
            expect(systemPrompt).toContain("不主动读取 lorebook/、manual/、simulation/、agents/ 或 reference/");
            expect(systemPrompt).toContain("<context> 内 Markdown 链接的目标路径");
            expect(systemPrompt).toContain("<materials>、<beats> 和 <style> 内允许自定义语义 tag");
            expect(systemPrompt).toContain("其他标签或正文里出现的路径不进入允许列表");
            expect(systemPrompt).toContain("<context> 里的 Markdown 链接只是读取元数据，不能原样写进正文");
            expect(systemPrompt).not.toContain("作为用户可见引用，你可以在正文中保留 Markdown link");
            expect(systemPrompt).not.toContain("<context_references>");
            expect(systemPrompt).not.toContain("<lorebook_refs>");
            expect(systemPrompt).not.toContain("<prose_file>");
            expect(systemPrompt).toContain("<storytelling_voice>");
            expect(systemPrompt).toContain("用讲故事的口吻");
            expect(systemPrompt).toContain("默认人称：第二人称");
            expect(systemPrompt).toContain("普通 assistant 文本");
            expect(systemPrompt).toContain("prose.md");
            expect(systemPrompt).toContain("不输出行动选项、确认问题");
            expect(systemPrompt).toContain("你不是 simulator leader");
            expect(systemPrompt).toContain("不替用户角色添加未输入");
            expect(systemPrompt).toContain("不输出标题、摘要");
            expect(historyText).toContain("```assets/workspace/.nbook/agent/skills/stop-slop/SKILL.md");
            expect(historyText).toContain("# Stop Slop");
            expect(modelContextText).toContain("最新 user message 读取完整 Writer Brief");
            expect(modelContextText).toContain("profile initial 为空");
            expect(modelContextText).toContain("report_result.result");
            expect(modelContextText).toContain("不生成选项、标题、摘要");
            expect(appendingText).toContain("Runtime Location");
        } finally {
            await fixture.cleanup();
        }
    });

    it("simulation 模板使用 subject frontmatter、runs 新结构和不产生断链的 entity 示例", async () => {
        const activeTemplateRoot = resolve("assets", "workspace", ".nbook", "templates", "project-directory-templates", "simulation");
        await expect(readFile(join(activeTemplateRoot, "config.yaml"), "utf-8")).rejects.toThrow();
        await expect(readFile(join(activeTemplateRoot, "cast.yaml"), "utf-8")).rejects.toThrow();
        await expect(readFile(join(activeTemplateRoot, "simulator.md"), "utf-8")).rejects.toThrow();
        await expect(readFile(join(activeTemplateRoot, "writer.md"), "utf-8")).rejects.toThrow();

        const templateRoot = resolve("assets", "workspace", ".nbook", "templates", "archived", "project-directory-templates", "simulation");

        const playerSubject = await readFile(join(templateRoot, "subjects", "player", "subject.md"), "utf-8");
        const npcSubject = await readFile(join(templateRoot, "subjects", "sample-npc", "subject.md"), "utf-8");
        expect(playerSubject).toContain("profile: simulator.actor");
        expect(playerSubject).toContain("controlledBy: user");
        expect(playerSubject).toContain("隐藏设定与真相");
        expect(npcSubject).toContain("id: sample-npc");
        expect(npcSubject).toContain("controlledBy: simulator");
        expect(npcSubject).toContain("隐藏设定与真相");
        const playerSoul = await readFile(join(templateRoot, "subjects", "player", "soul.md"), "utf-8");
        const npcSoul = await readFile(join(templateRoot, "subjects", "sample-npc", "soul.md"), "utf-8");
        expect(playerSoul).toContain("我是谁");
        expect(playerSoul).not.toMatch(/^---/);
        expect(npcSoul).toContain("我是谁");
        expect(npcSoul).not.toMatch(/^---/);
        await expect(readFile(join(templateRoot, "subjects", "player", "memory-seed.md"), "utf-8")).rejects.toThrow();
        await expect(readFile(join(templateRoot, "subjects", "sample-npc", "memory-seed.md"), "utf-8")).rejects.toThrow();
        await expect(readFile(join(templateRoot, "subjects", "player", "events.jsonl"), "utf-8")).resolves.toMatch(/起始场景/);
        await expect(readFile(join(templateRoot, "subjects", "player", "memory.jsonl"), "utf-8")).resolves.toMatch(/示例 NPC/);
        await expect(readFile(join(templateRoot, "subjects", "sample-npc", "events.jsonl"), "utf-8")).resolves.toMatch(/学徒女仆/);
        await expect(readFile(join(templateRoot, "subjects", "sample-npc", "memory.jsonl"), "utf-8")).resolves.toMatch(/当前主人/);
        await expect(readFile(join(templateRoot, "subjects", "player", "events.md"), "utf-8")).rejects.toThrow();
        await expect(readFile(join(templateRoot, "subjects", "player", "knowledge.md"), "utf-8")).rejects.toThrow();

        const entityText = await readFile(join(templateRoot, "entities", "example-item", "entity.md"), "utf-8");
        await expect(readFile(join(templateRoot, "entities", "example-item", "state.md"), "utf-8")).resolves.toContain("subjectVisibleName");
        expect(entityText).toContain("prototype: null");
        expect(entityText).not.toContain("lorebook/item/example/");

        const reportText = await readFile(join(templateRoot, "runs", "ticks", "000000-initial-state", "report.md"), "utf-8");
        const proseText = await readFile(join(templateRoot, "runs", "ticks", "000000-initial-state", "prose.md"), "utf-8");
        const currentText = await readFile(join(templateRoot, "runs", "current.md"), "utf-8");
        const indexText = await readFile(join(templateRoot, "runs", "index.md"), "utf-8");
        expect(currentText).toContain("Active Subjects");
        expect(currentText).toContain("sample-npc");
        expect(indexText).toContain("000000");
        expect(indexText).toContain("`rp.writer` 输出的完整正文");
        expect(indexText).toContain("`rp.leader` 只负责链接和元场景组装");
        expect(reportText).toContain("Writer-safe Brief");
        expect(reportText).toContain("交给 `rp.writer` 写入本目录 `prose.md`");
        expect(reportText).toContain("Commits");
        expect(proseText).toContain("用户可见正文");
        expect(proseText).toContain("由 `rp.writer` 根据 `rp.leader` 提供的 Writer Brief 写入");
        expect(proseText).not.toContain("或 leader 输出");
        await expect(readFile(join(templateRoot, "runs", "ticks", "000001", "user-input.md"), "utf-8")).rejects.toThrow();
        await expect(readFile(join(templateRoot, "runs", "ticks", "000001", "gm-scratch.md"), "utf-8")).rejects.toThrow();
        await expect(readFile(join(templateRoot, "runs", "ticks", "000001", "writer-brief.md"), "utf-8")).rejects.toThrow();
    });
});

async function createRoleplayFixture(): Promise<{workspaceRoot: string; projectSlug: string; cleanup: () => Promise<void>}> {
    // actor 主路 Import soul.md 时按 repo-root 解析 workspace/${subjectPath}/soul.md，
    // 所以 fixture 必须把 subject 目录放在 repo-root workspace/ 下，workspaceRoot 指向 resolve("workspace")。
    const workspaceRoot = resolve("workspace");
    const projectSlug = `rp-project-${randomUUID()}`;
    const projectRoot = join(workspaceRoot, projectSlug);
    const actorRoot = join(projectRoot, "simulation", "subjects", "heroine");
    await mkdir(actorRoot, {recursive: true});
    await writeFile(join(actorRoot, "soul.md"), "# 我是谁\n\n我是海音。我话不多，遇到未知物品会先问来源。", "utf-8");
    await writeFile(join(actorRoot, "subject.md"), "全知秘密档：海音其实受学院密令观察主角。", "utf-8");
    await writeFile(join(actorRoot, "events.jsonl"), "{\"text\":\"她第一次在广场边缘见到主角，还没有确认对方目的。\"}\n", "utf-8");
    await writeFile(join(actorRoot, "memory.jsonl"), "{\"topic\":\"主角\",\"view\":\"她相信主角值得观察，但还不知道世界之心的真名。\"}\n", "utf-8");
    await writeFile(join(actorRoot, "mind.md"), "她正在判断主角的用意，暂时不想显露紧张。", "utf-8");
    await writeFile(join(actorRoot, "state.md"), "她位于学院区广场边缘，双手空着，状态正常。", "utf-8");
    await mkdir(join(projectRoot, "agents", "rp.writer"), {recursive: true});
    await writeFile(join(projectRoot, "agents", "rp.writer", "context.md"), "正文要保留角色信息差，不泄露 simulator leader 隐藏设定。", "utf-8");
    return {
        workspaceRoot,
        projectSlug,
        cleanup: async () => {
            await rm(projectRoot, {recursive: true, force: true});
        },
    };
}
