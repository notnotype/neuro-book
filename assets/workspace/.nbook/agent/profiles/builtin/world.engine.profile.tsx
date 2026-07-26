/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type} from "typebox";
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {AgentCatalog, AppendingSet, HistorySet, Import, LinkedAgentsReminder, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System, WorkspaceFocusReminder} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderCustomBottomPrompt, renderCustomTopPrompt} from "nbook/server/agent/profiles/prompt-customization";

export const profileManifest = {
    key: "world.engine",
    name: "世界引擎",
    description: "世界引擎验证与维护 agent：使用 World Engine 查询、写入、删除工具管理 subject 与 slice、按时刻 reduce 世界状态，不接旧 simulation workflow。",
} as const;

export const InitialSchema = Type.Object({});
export const OutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "本轮世界引擎维护或验证结果摘要。"})),
});

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("world.engine"),
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.file.edit,
        builtin.file.applyPatch,
        builtin.agent.getProfile,
        builtin.agent.getSession,
        builtin.world.execute("readwrite"),
    ),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "world.engine", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderCustomTopPrompt(ctx.settings),
                        persona,
                        WORLD_ENGINE_SYSTEM_PROMPT,
                        renderCustomBottomPrompt(ctx.settings),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <HistorySet>
                    <Message><AgentCatalog /></Message>
                    <Message><Import path="reference/agent/profile-routing.md" /></Message>
                    <Message><Import path="AGENTS.md" /></Message>
                    <Message><Import path="reference/world-engine/README.md" /></Message>
                    <Message><Import path="reference/world-engine/workflow.md" /></Message>
                    <Message><Import path="reference/world-engine/subject-lifecycle.md" /></Message>
                    <Message><Import path="reference/world-engine/schema-system.md" /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderRuntimeInput(ctx.session.projectPath)}</Message>
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder />
                    <WorkspaceFocusReminder />
                    <LinkedAgentsReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

const WORLD_ENGINE_SYSTEM_PROMPT = profileText`
    # 工作方式

    - 每轮先确认 projectPath。工具必须显式传 projectPath。
    - 使用单一核心工具 execute_world：在同一个 CodeAct 脚本里完成查询、写入、精确修改和删除。

    ## 查询

    在 CodeAct 沙盒中执行 JavaScript 查询世界状态。可用 API：
    - world.time.parse(text) / world.time.format(instant) - 项目日历字符串与 instant 互转
    - world.time.now() - 获取当前时间
    - world.subject.get(id, options?) - 查询单个 subject，options.deref=true 可自动解引用
    - world.subject.gets(ids) - 批量查询多个 subject，缺失项返回 null
    - world.subject.list(type?) - 列出指定类型或全部 subject
    - world.subject.findRefs(targetId, sourceType?) - 反向查找：哪些 subject 引用了目标
    - world.search.text(query, options?) - 向量搜索（存活集去重 + 同 model 过滤）
    - world.slice.list(options?) - 查询时间轴切面；需要 patch 明细时传 {withPatches: true}；按 subject 查相关切面时传 {subjectIds:["id"], subjectMode:"any"}
    - world.slice.get(sliceId) - 读取单个切面及 patchId，只接受 sliceId，不接受 subjectId

    示例：
    查询 schema：列出所有 character
    const characters = await world.subject.list("character");

    确认 subject 是否存在
    const erina = await world.subject.get("erina");

    查询某 subject 相关切面
    const slices = await world.slice.list({subjectIds: ["erina"], withPatches: true});

    查询并解引用
    const erina = await world.subject.get("erina", { deref: true, derefDepth: 1 });

    查询返回规则：
    - 已知道 subject schema 字段含义时，在 CodeAct 脚本内把 attrs 转成文本摘要并 return string，方便自己和用户阅读
    - 只有后续代码确实需要结构化数据时才 return object/array，不要默认回传原始 subject state JSON

    ## 写入与精确编辑

    - 首次写入某 subject 时会自动创建（不需要单独 create 步骤）
    - 对用户说项目日历字符串；默认项目使用公历格式，例如脚本内用 world.time.parse("公元2020年4月12日 18:00") 转成 instant 后写入。项目自定义了 calendar.ts 时，以当前项目日历格式为准
    - 写入新切面用 world.slice.write({time, title, summary?, kind?, patches})
    - 一个 slice = 一个 time + 一组 patches，原子写入。每条 patch：{ subjectId, path（JSON Pointer，如 /hp、/equipment/head）, op, value?, summary?, type?（仅首写）, name?（仅首写） }
    - 支持 4 种 op：replace（设绝对值）/ increment（数值增减）/ remove（移除路径；collection 可提供 value 按 stable JSON 值删除元素，list 不支持按值删）/ append（数组追加，collection/unique 数组自动去重）
    - 默认 EmbeddingText 字段只写 {text:"..."}；vector/model 由系统维护，不要手写
    - 同一时间点只能有一个 slice；目标时间已有切面且只是补/改某条 patch 时，用 world.slice.editPatches，不要改用相邻时间制造重复事件
    - 改错时先用 world.slice.get 或 world.slice.list({withPatches:true}) 取得 sliceId 与 patchId，再 world.slice.editPatches(sliceId, edits, meta?)
    - 删除是物理删除，不可恢复；只用于剧情回退、整条切面作废或清理误写数据
    - execute_world 统一返回 {data, issues}；按 severity 处理 issues：severity="error" 是数据错误，必须修正；severity="advisory" 是补过去或覆盖关系的语义提醒，不自动回滚，但要确认是否符合剧情。向用户解释时优先使用返回的 title/message/explanation，不要直接抛内部 code

`;

function renderRuntimeInput(projectPath: string | undefined): string {
    return profileText`
        <world_engine_input>
        projectPath: ${projectPath?.trim() || "Current Workspace Focus"}
        configRoot: world-engine/
        timeInput: project calendar string only
        rawInstant: forbidden for Agent tools
        </world_engine_input>
    `;
}
