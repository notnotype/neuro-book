import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {join, resolve} from "node:path";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import rpLeaderProfileDefinition from "../../../assets/workspace/.nbook/agent/profiles/builtin/rp.leader.profile";
import rpWriterProfileDefinition from "../../../assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile";
import simulatorActorProfileDefinition from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.actor.profile";
import simulatorLeaderProfileDefinition from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.leader.profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {RpLeaderInitialSchema, RpLeaderOutputSchema, RpWriterInitialSchema, RpWriterOutputSchema, SimulatorLeaderInitialSchema, SubjectSimulatorInitialSchema, SubjectSimulatorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {storedMessageText, type StoredMessageLike} from "nbook/server/agent/messages/stored-message-presentation";
import {createTestRuntimeSession as testSession} from "nbook/server/agent/profiles/test/runtime-session";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";
import {normalizeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {
    createIsolatedWorkspaceAssets,
    type IsolatedWorkspaceAssets,
} from "nbook/server/workspace-files/test-workspace-fixture";

const rpLeaderProfile = normalizeAgentProfile(rpLeaderProfileDefinition);
const rpWriterProfile = normalizeAgentProfile(rpWriterProfileDefinition);
const simulatorActorProfile = normalizeAgentProfile(simulatorActorProfileDefinition);
const simulatorLeaderProfile = normalizeAgentProfile(simulatorLeaderProfileDefinition);

function messagesText(messages: StoredMessageLike[] | undefined): string {
    return (messages ?? []).map((message) => storedMessageText(message)).join("\n");
}
describe("RP builtin profiles", () => {
    let assets: IsolatedWorkspaceAssets;

    beforeAll(async () => {
        assets = await createIsolatedWorkspaceAssets({purpose: "rp-profile-tests"});
    });

    afterAll(async () => {
        await assets.dispose();
    });

    it("catalog 加载 rp.leader、simulator.leader、simulator.actor、rp.writer，不再加载 leader.rp", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            undefined,
            undefined,
            undefined,
            (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, resolve(import.meta.dirname, "../../..")),
            {install: "assets/workspace/.nbook/agent/profiles"},
        );
        catalog.enableRuntimeRegistry();
        const snapshot = await catalog.snapshot();
        const profileKeys = snapshot.profiles.map((profile) => profile.key);

        expect(profileKeys).toContain("rp.leader");
        expect(profileKeys).toContain("simulator.leader");
        expect(profileKeys).toContain("simulator.actor");
        expect(profileKeys).toContain("rp.writer");
        expect(profileKeys).not.toContain("leader.rp");
    }, 60_000);

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

    it("rp.leader 作为 RP 用户交流层，读取 manual 并调用 simulator.leader", async () => {
        const prepared = await rpLeaderProfile.prepare!({
            session: testSession({
                profileKey: "rp.leader",
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
            "get_story_tree",
            "get_story_thread",
            "get_story_scene_context",
            "get_story_chapter",
            "task_create",
            "task_set_status",
        ]);
        expect(rpLeaderProfile.rootToolKeys).not.toContain("report_result");
        expect(systemPrompt).toContain("你是彩绘");
        expect(systemPrompt).toContain("炉火边的共犯");
        expect(systemPrompt).toContain("小屋（元场景）");
        expect(systemPrompt).toContain("万华镜（世界内）");
        expect(systemPrompt).toContain("manual/README.md、manual/player-guide/、manual/gm-guide.md");
        expect(systemPrompt).toContain("agents/rp.leader/");
        expect(systemPrompt).toContain("需要世界裁决时创建或复用 simulator.leader");
        expect(systemPrompt).toContain("simulator.leader");
        expect(systemPrompt).toContain("每个常规 tick（用户输入 → 世界推进 → 等待下一条指令）");
        expect(systemPrompt).toContain("开场白 / 初始化正文");
        expect(systemPrompt).toContain("simulation/runs/ticks/000000-initial-state/prose.md");
        expect(systemPrompt).toContain("所有世界内用户可见正文都必须由 rp.writer 写");
        expect(systemPrompt).toContain("不要因为“发生在第一个 Tick 之前”就自己写");
        expect(systemPrompt).toContain("第 1 步：解读用户行动");
        expect(systemPrompt).toContain("第 2 步：世界模拟");
        expect(systemPrompt).toContain("准备 Writer Brief");
        expect(systemPrompt).toContain("create_agent({profileKey: \"rp.writer\", initial: {}, title})");
        expect(systemPrompt).toContain("invoke_agent 时把完整 Writer Brief 放进 message");
        expect(systemPrompt).toContain("再次发送完整新版 Brief");
        expect(systemPrompt).toContain("<context>：唯一 read 白名单入口");
        expect(systemPrompt).toContain("<materials>：素材层");
        expect(systemPrompt).toContain("<beats>：剧情骨架");
        expect(systemPrompt).toContain("自定义 tag 不扩大 read 权限");
        expect(systemPrompt).toContain("只允许读取 <context> 内 Markdown 链接的目标路径");
        expect(systemPrompt).not.toContain("<context_references>");
        expect(systemPrompt).not.toContain("<material_layer>");
        expect(systemPrompt).not.toContain("<plot_skeleton>");
        expect(systemPrompt).not.toContain("<ambient_directives>");
        expect(systemPrompt).not.toContain("{phase: 'check'");
        expect(systemPrompt).not.toContain("{phase: 'render'");
        expect(systemPrompt).not.toContain("supplemental_brief");
        expect(systemPrompt).toContain("你是编剧");
        expect(systemPrompt).toContain("不把 meta 讨论或引导建议静默写成 canon");
        expect(systemPrompt).toContain("rp.leader 是当前唯一 canonical RP 主持名称");
        expect(systemPrompt).toContain("直接用 assistant 文本返回");
        expect(historyText).toContain("```AGENTS.md");
        expect(historyText).toContain("```reference/agent/profile-routing.md");
        expect(historyText).toContain("Project 文件/Lorebook 工程整理转 `leader.default`");
        expect(historyText).toContain("模拟器调试转 `simulator.leader`");
        expect(historyText).toContain("资产编辑转 `leader.assets`");
        expect(historyText).toContain("```reference/content/manual.md");
        expect(historyText).toContain("```reference/content/simulation.md");
        expect(historyText).toContain("```reference/agent/workspace-tool-use.md");
        expect(historyText).toContain("```reference/agent/project-workspace-guide.md");
        expect(modelContextText).toContain("projectRoot: rp-project");
        expect(modelContextText).toContain("manualRoot: manual/");
        expect(modelContextText).toContain("simulationRoot: simulation/");
        expect(modelContextText).toContain("mode: 每轮任务 prompt 指定");
        expect(appendingText).toContain("Current Workspace Focus");
    });

    it("simulator.leader 作为 simulation runtime owner 并负责调度 actor", async () => {
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
        expect(modelContextText).toContain("projectRoot: rp-project");
        expect(modelContextText).toContain("mode: 每轮任务 prompt 指定");
    });

    it("simulator.actor 只暴露 report_result，并注入 actor binding 与当前角色提示词", async () => {
        const fixture = await createRoleplayFixture();
        try {
            const prepared = await simulatorActorProfile.prepare!({
                session: testSession({
                    profileKey: "simulator.actor",
                    workspaceRoot: absoluteFsPath(fixture.workspaceRoot),
                    currentProjectRoot: fixture.projectSlug,
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

            expect(simulatorActorProfile.rootToolKeys).toEqual(["report_result"]);
            expect(simulatorActorProfile).not.toHaveProperty("sidecars");
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
            expect(systemPrompt).toContain("记忆的检索与沉淀由外部流程维护");
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
            expect(modelContextText).toContain("这些路径只供外部记忆维护流程使用");
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
            expect(modelContextText).toContain("记忆维护不归我此刻操心");
            expect(appendingText).toContain("Current Workspace Focus");
            expect(appendingText).not.toContain("只回应当前 user message");
        } finally {
            await fixture.cleanup();
        }
    });

    it("simulator.actor 复用 subject simulator 合同并注入新 profile 身份", async () => {
        const fixture = await createRoleplayFixture();
        try {
            const prepared = await simulatorActorProfile.prepare!({
                session: testSession({
                    profileKey: "simulator.actor",
                    workspaceRoot: absoluteFsPath(fixture.workspaceRoot),
                    currentProjectRoot: fixture.projectSlug,
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
            expect(simulatorActorProfile.rootToolKeys).toEqual(["report_result"]);
            expect(simulatorActorProfile).not.toHaveProperty("sidecars");
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
                    workspaceRoot: absoluteFsPath(fixture.workspaceRoot),
                    currentProjectRoot: fixture.projectSlug,
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
                    workspaceRoot: absoluteFsPath(fixture.workspaceRoot),
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
            expect(appendingText).toContain("Current Workspace Focus");
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
    const workspaceRoot = resolveRuntimeWorkspaceRoot();
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
