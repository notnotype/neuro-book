/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {isAbsolute, posix} from "node:path";
import {Type, type Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, plotReadBindings, toolset} from "nbook/server/agent/profiles/profile-tools";
import {WriterInitialSchema, WriterOutputSchema, WriterPayloadSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, FileChangeNotice, HistorySet, If, Import, Message, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {DEFAULT_WRITING_REFERENCE_PRESET, buildWritingReference, legacyReferenceKeyToHomeKey, loadWritingReferencePresets, normalizeReferenceHomeKey} from "nbook/server/agent/profiles/writer-writing-reference";
import {DEFAULT_WRITING_STYLE_PRESET, buildWritingStyle, legacyStyleKeyToHomeKey, loadWritingStylePresets, normalizeStyleHomeKey} from "nbook/server/agent/profiles/writer-writing-style";
import {buildPersonaPrompt, initializePersonaHome, promptCustomizationDefaults, promptCustomizationFormFields, promptCustomizationSchemaFields, renderCustomBottomPrompt, renderCustomTopPrompt, validatePersonaPreset} from "nbook/server/agent/profiles/prompt-customization";
import {defineLowCodeForm, profileHomeResource} from "nbook/server/low-code-form";
import {defineProfileHome} from "nbook/server/agent/profiles/profile-home";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";
import {readProjectManifest} from "nbook/server/workspace-files/project-workspace";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

const DEFAULT_PARAGRAPH_RHYTHM = "段落节奏偏短段分行，接近网络小说排版：一句话、一个动作节拍或一个情绪转折可以单独成段；不要为了凑短段打碎完整语义，场景描写、复杂动作和连续心理变化可以保留为较短自然段。";
const DEFAULT_WORD_COUNT_CONTROL = "2000-2600 字";
const DEFAULT_POLISHING_WORKFLOW = "润色时使用 .nbook/agent/skills/stop-slop/SKILL.md 作为自查流程，并优先在原文基础上做最小必要修改。不要输出 <refine> JSON，不把润色分析混进正文。";

export const profileManifest = {
    key: "writer",
    name: "正文写作",
    version: 3,
    description: "长期可复用正文写作 agent（autonomous 防全知模式）：创建 initial 为空，每轮 invoke.message 写任务、invoke.input 传 {path, chapterId?, context?}。writer 自主用 get_chapter_writer_brief / execute_world / read 查证设定与状态。brief 格式规范见 reference/plot/writer-brief.md。写正文时不要自己写，总是优先使用 writer。",
} as const;

export const InitialSchema = WriterInitialSchema;
export const PayloadSchema = WriterPayloadSchema;
export const OutputSchema = WriterOutputSchema;
export const SettingsSchema = Type.Object({
    ...promptCustomizationSchemaFields,
    writingStylePreset: Type.String(),
    writingReferencePreset: Type.String(),
    narrativePerson: Type.Union([
        Type.Literal("first"),
        Type.Literal("second"),
        Type.Literal("third"),
    ]),
    paragraphRhythm: Type.String(),
    wordCountControl: Type.String(),
    polishingWorkflow: Type.String(),
    adultStylePrompt: Type.String(),
    fileChangeAwareness: Type.Union([
        Type.Literal("off"),
        Type.Literal("minimal"),
        Type.Literal("full"),
    ]),
}, {additionalProperties: false});

export type Initial = Static<typeof InitialSchema>;
export type Payload = Static<typeof PayloadSchema>;
export type Output = Static<typeof OutputSchema>;
export type Settings = Static<typeof SettingsSchema>;

export const WriterSettingsForm = defineLowCodeForm({
    schema: SettingsSchema,
    defaults: {
        ...promptCustomizationDefaults,
        writingStylePreset: DEFAULT_WRITING_STYLE_PRESET,
        writingReferencePreset: DEFAULT_WRITING_REFERENCE_PRESET,
        narrativePerson: "third",
        paragraphRhythm: DEFAULT_PARAGRAPH_RHYTHM,
        wordCountControl: DEFAULT_WORD_COUNT_CONTROL,
        polishingWorkflow: DEFAULT_POLISHING_WORKFLOW,
        adultStylePrompt: "",
        fileChangeAwareness: "minimal",
    },
    fields: [
        ...promptCustomizationFormFields(),
        {
            path: "writingStylePreset",
            component: "resource-preset",
            label: "文风要求",
            description: "条文式的文风规则（用词、句式、禁用项），作为写作约束注入。",
            placeholder: "选择默认文风要求",
            resource: profileHomeResource({
                directory: "styles",
                extension: ".md",
                template: "在这里写入文风要求。",
            }),
        },
        {
            path: "writingReferencePreset",
            component: "resource-preset",
            label: "文风参考",
            description: "供模仿语感的正文样本，与「文风要求」互补：一个给规则，一个给示例。",
            placeholder: "选择默认参考样本",
            resource: profileHomeResource({
                directory: "references",
                extension: ".md",
                template: "在这里写入文风参考样本。",
            }),
        },
        {
            path: "narrativePerson",
            component: "radio",
            label: "默认人称",
            description: "正文默认叙事人称；本轮写作任务另有要求时以任务为准。",
            options: [
                {value: "third", label: "第三人称"},
                {value: "first", label: "第一人称"},
                {value: "second", label: "第二人称"},
            ],
        },
        {
            path: "paragraphRhythm",
            component: "textarea",
            label: "段落节奏",
            description: "默认段落与分行节奏偏好；本轮写作任务另有要求时以任务为准。",
            rows: 4,
            placeholder: "描述你偏好的长段、短段或分行节奏。",
        },
        {
            path: "wordCountControl",
            component: "text",
            label: "默认字数",
            description: "单章默认字数范围；材料不足时 Writer 不会硬凑字数。",
            placeholder: "例如：2000-2600 字",
        },
        {
            path: "polishingWorkflow",
            component: "text",
            label: "润色工作流",
            description: "写完正文后的自查与润色流程。",
            placeholder: "描述写完后如何复查和润色。",
        },
        {
            path: "adultStylePrompt",
            component: "text",
            label: "成人风格增强",
            description: "填写后作为成人场景写作约束注入；留空则完全不注入。",
            placeholder: "例如：注重情绪推进与关系变化，避免机械描写。",
        },
        {
            path: "fileChangeAwareness",
            component: "radio",
            label: "文件变更感知",
            description: "每轮开始前提醒 agent：上次看过之后，项目文件被其他人（用户 / 其他 agent / 外部工具）改过哪些。",
            options: [
                {value: "minimal", label: "精简", description: "只列变更文件路径和条数。"},
                {value: "full", label: "完整", description: "含归因（谁改的）与操作类型，并提示续写前先重读相关文件。"},
                {value: "off", label: "关闭", description: "不注入文件变更提醒。"},
            ],
        },
    ],
    async validate(value, ctx) {
        const [styles, references] = await Promise.all([
            loadWritingStylePresets(),
            loadWritingReferencePresets(),
        ]);
        const issues: Array<{path: string; severity: "error"; message: string}> = [];
        const styleExists = ctx.home
            ? await ctx.home.exists(normalizeStyleHomeKey(value.writingStylePreset))
            : styles.some((style) => style.key === value.writingStylePreset || legacyStyleKeyToHomeKey(style.key) === value.writingStylePreset);
        const referenceExists = ctx.home
            ? await ctx.home.exists(normalizeReferenceHomeKey(value.writingReferencePreset))
            : references.some((reference) => reference.key === value.writingReferencePreset || legacyReferenceKeyToHomeKey(reference.key) === value.writingReferencePreset);
        if (!styleExists) {
            issues.push({path: "writingStylePreset", severity: "error" as const, message: "选择的文风要求不存在。"});
        }
        if (!referenceExists) {
            issues.push({path: "writingReferencePreset", severity: "error" as const, message: "选择的文风参考不存在。"});
        }
        const personaIssue = await validatePersonaPreset(value.personaPreset, ctx.home);
        if (personaIssue) {
            issues.push(personaIssue);
        }
        return issues;
    },
});

type WriterPayloadTarget = {
    path: string;
    projectSlug: string;
    projectPath: string;
    chapterPath: string | null;
};

async function initializeWriterHome(home: NonNullable<ProfilePrepareContext<Initial, Payload, Settings>["home"]>): Promise<void> {
    const [styles, references] = await Promise.all([
        loadWritingStylePresets(),
        loadWritingReferencePresets(),
    ]);
    for (const style of styles) {
        await home.writeText(legacyStyleKeyToHomeKey(style.key), renderStyleResource(style), {mode: "create"});
    }
    for (const reference of references) {
        await home.writeText(legacyReferenceKeyToHomeKey(reference.key), renderReferenceResource(reference), {mode: "create"});
    }
    await initializePersonaHome(home, "writer");
}

function renderStyleResource(style: Awaited<ReturnType<typeof loadWritingStylePresets>>[number]): string {
    return [
        "---",
        `key: "${style.key}"`,
        `title: "${style.label.replaceAll("\"", "\\\"")}"`,
        `label: "${style.label.replaceAll("\"", "\\\"")}"`,
        `sourcePreset: "${style.sourcePreset.replaceAll("\"", "\\\"")}"`,
        `identifier: "${style.identifier.replaceAll("\"", "\\\"")}"`,
        `name: "${style.name.replaceAll("\"", "\\\"")}"`,
        `enabled: ${style.enabled === null ? "null" : style.enabled}`,
        `role: ${style.role === null ? "null" : `"${style.role.replaceAll("\"", "\\\"")}"`}`,
        "---",
        "",
        style.content,
    ].join("\n");
}

function renderReferenceResource(reference: Awaited<ReturnType<typeof loadWritingReferencePresets>>[number]): string {
    return [
        "---",
        `key: "${reference.key}"`,
        `title: "${reference.label.replaceAll("\"", "\\\"")}"`,
        `label: "${reference.label.replaceAll("\"", "\\\"")}"`,
        `sourceTitle: "${reference.sourceTitle.replaceAll("\"", "\\\"")}"`,
        `sourceChapters: "${reference.sourceChapters.replaceAll("\"", "\\\"")}"`,
        `generatedFrom: "${reference.generatedFrom.replaceAll("\"", "\\\"")}"`,
        "---",
        "",
        reference.content,
    ].join("\n");
}

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    payloadSchema: PayloadSchema,
    outputSchema: OutputSchema,
    settingsForm: WriterSettingsForm,
    home: defineProfileHome({
        async init(ctx) {
            await initializeWriterHome(ctx.home);
        },
        async upgrade(ctx) {
            await initializeWriterHome(ctx.home);
        },
        async reset(ctx) {
            await ctx.home.clear();
            await initializeWriterHome(ctx.home);
        },
    }),
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.file.edit,
        builtin.file.bash,
        builtin.world.execute("readonly"),
        // autonomous 模式:writer 只 spread Plot 读 bundle(Task 97 D7),可自取章节 brief 与场景/世界上下文;不含 save_* 写工具。
        ...plotReadBindings,
        builtin.result.main(),
    ),
    async context(ctx) {
        return buildWriterPrompt(ctx);
    },
});

/**
 * 构造 writer prompt。保留 v2 的同名 helper 入口，但返回当前 v3 TSX Profile DSL。
 */
export async function buildWriterPrompt(ctx: ProfilePrepareContext<Initial, Payload, Settings>) {
    const writingStyle = await buildWritingStyle({preset: ctx.settings.writingStylePreset, home: ctx.home});
    const writingReference = await buildWritingReference({preset: ctx.settings.writingReferencePreset, home: ctx.home});
    const narrativePerson = narrativePersonText(ctx.settings.narrativePerson);
    const customTopPrompt = ctx.settings.customTopSystemPrompt.trim();
    const customBottomPrompt = ctx.settings.customBottomSystemPrompt.trim();
    const personaPrompt = await buildPersonaPrompt({profileKey: "writer", preset: ctx.settings.personaPreset, home: ctx.home});
    const adultStylePrompt = ctx.settings.adultStylePrompt.trim();
    const inputContext = await renderInputContext(ctx);
    return (
        <ProfilePrompt>
            <System>
                <If condition={customTopPrompt.length > 0}>
                    {profileText`
                        <custom_top_system_prompt>
                            ${customTopPrompt}
                        </custom_top_system_prompt>
                    `}
                </If>
                {profileText`
                    <writing_reference>
                        ${writingReference}
                    </writing_reference>

                    ${personaPrompt}

                    <input_contract>
                        你的输入来自结构化的 invoke_agent 调用，包含稳定上下文和明确的写作目标。

                        输入结构：
                        - input.path：本轮唯一写入目标（当前Project Workspace相对Markdown路径）
                        - input.chapterId：本章 StoryChapter id（可选）；有它时用 get_chapter_writer_brief 自取章节 brief
                        - input.context：建议读取的 lorebookEntries 和 readablePaths
                        - message：写作任务正文（brief）

                        详细的输入契约和路径规则见 reference/agent/project-workspace-guide.md。brief 格式规范见 reference/plot/writer-brief.md。
                        <hard_rules>
                            - 只根据已有设定、剧情点和明确要求写作，不新增超出任务范围的关键设定。
                            - 你处于 autonomous（自主全知）模式：拥有 Plot 只读、World Engine 只读、lorebook 读能力。message 里的 brief 只给框架与查询提示，不含可查询状态；HP / 位置 / 属性等状态**由你自己查证**，不要当作 brief 遗漏。
                            - 有 input.chapterId 时优先 get_chapter_writer_brief 自取 brief；需要场景/世界上下文用 get_story_chapter / get_story_scene_context / get_scene_world_context；需要角色当前状态用 execute_world。
                            - Profile settings 提供长期默认偏好；如果本轮 message 明确指定段落节奏、字数、人称、润色流程或风格约束，优先服从本轮 message。
                            - 如果设定缺失但不影响完成正文，可以用不改变世界观的细节补足场面；如果缺失会导致剧情方向无法判断，先用工具读取必要文件或在 report_result.result 里说明限制。
                            - 完成任务后必须调用 report_result 提交最终结果；调用 report_result 成功后对话会自动结束。
                            - report_result.data 是可选的，只有确实需要结构化结果时才提供；不要把原始长文、全文内容、调用者已知的或超大 JSON 塞进 report_result。
                        </hard_rules>
                    </input_contract>

                    <execution_pattern>
                        收到 brief 后：读取目标文件 → 查证世界状态 → 按需加载上下文 → 构思并写入正文 → 报告结果。

                        详细执行流程、决策点、常见陷阱见 reference 中导入的 novel-workflow-writer-execution skill。
                    </execution_pattern>

                    <tool_permissions>
                        Writer 拥有以下工具：
                        - **read / write / edit**：文件操作
                        - **bash**：执行 CLI 工具（如 llmlint）
                        - **execute_world**：World Engine 只读查询（CodeAct 沙盒）
                        - **get_chapter_writer_brief / get_story_chapter / get_story_scene_context / get_scene_world_context / get_story_tree / get_story_thread / get_story_promise / get_story_decision**：Plot 只读。brief 已含本章 Promise 任务与未决决策警告；需要核对某条线的 payoffExpectation 或某条决策（D-x）的详情时，再用 get_story_promise / get_story_decision 按需查询
                        - **report_result**：提交最终结果

                        核心约束：
                        - World Engine 只读，不能写入、修改或删除切面
                        - Plot 只读，不能创建或修改任何 Plot 实体（Thread / Scene / Act / Chapter / Promise / Decision）；剧情设计权在 leader
                        - 默认按 brief 写作，不新增超出范围的关键设定
                        - 只有 brief 明确授权自由发挥时，才可新增角色或改变状态

                        World Engine 查询示例：
                        查询角色当前状态：const erina = await world.subject.get("erina");
                        列出所有角色：const characters = await world.subject.list("character");
                        查询某时间段的切面：const recentSlices = await world.slice.list(options);
                        查询返回规则：已知道 subject schema 字段含义时，在 CodeAct 脚本内把状态整理成文本摘要并 return string；不要默认回传原始 attrs JSON。

                        工具使用详情见 reference/world-engine/workflow.md 和 novel-workflow-writer-execution skill。
                    </tool_permissions>
                    
                    <content_nodes>
                        内容节点（lorebook / manuscript）的结构、frontmatter 字段、读取规则见 reference/content/information-control.md。

                        核心原则：
                        - File Scope 是当前Project Workspace；工具路径直接使用 lorebook/...、manuscript/...
                        - index.md 是节点正文，state.md 是当前状态补充
                        - frontmatter 的 status / knowledge[] 控制可见性
                        - 不要把系统内部字段当作世界观事实
                        - 不要读取其他 profile 的 context memory（如 agents/leader.default/context.md）
                    </content_nodes>

                    <writing_style>
                        ${writingStyle}
                    </writing_style>

                    <paragraph_rhythm>
                        ${ctx.settings.paragraphRhythm}
                    </paragraph_rhythm>

                    <word_count_control>
                        默认字数：${ctx.settings.wordCountControl}。
                        - 如果本轮 message 明确指定字数、篇幅或章节长度，优先服从本轮要求。
                        - 如果材料不足以支撑默认字数，不要硬凑水分；写足必要剧情并在 report_result.result 说明。
                    </word_count_control>
                    
                    <narrative_person>
                        默认人称：${narrativePerson}。
                        - 可以写角色名、代称或贴合当前章节的视角人物。
                        - 不默认使用第二人称“你”称呼用户角色。
                        - 如果输入约束明确要求第一人称、第二人称、书信体、日志体等，优先服从输入约束。
                    </narrative_person>
                    
                    <markdown_dialect>
                        NeuroBook Markdown 扩展格式（详见 reference/content/markdown-dialect.md）：
                        - 工作区引用：相对链接指向节点目录（保留结尾 /）或具体文件
                        - Inline Comment：<inline-comment body=”...”>原文</inline-comment>
                        - Mark 高亮：<mark style=”background-color: #fce7f3”>文本</mark>
                        - 文本颜色：<span style=”color: #ef4444”>文本</span>
                        - 上标/下标：<sup>上标</sup>、<sub>下标</sub>
                        - 对齐块：<align value=”center”>...</align>

                        comment 使用时机：只在对已有草稿做批注时使用，正式正文不要主动塞 comment。
                    </markdown_dialect>

                    <polishing_workflow>
                        ${ctx.settings.polishingWorkflow}
                    </polishing_workflow>

                    <output_protocol>
                        - write 写入 input.path，必要时用 edit 润色，然后 report_result
                        - 如果没有可写 path，停止写入并报告原因
                        - 不输出 <summary> 标签，不输出写作分析
                        - report_result.result：已写入路径 + 润色情况 + 约 100 字剧情总结
                        - report_result.data：默认不填，除非调用方明确需要结构化结果
                    </output_protocol>
                    `}
                    <If condition={adultStylePrompt.length > 0}>
                        {`
                        <adult_style>
                            ${adultStylePrompt}
                        </adult_style>
                        `}
                    </If>
                    <If condition={customBottomPrompt.length > 0}>
                        {profileText`
                            <custom_bottom_system_prompt>
                                ${customBottomPrompt}
                            </custom_bottom_system_prompt>
                        `}
                    </If>
            </System>
            <HistorySet>
                <Message><Import path="reference/agent/project-workspace-guide.md" /></Message>
                <Message><Import path="reference/content/markdown-dialect.md" /></Message>
                <Message><Import path="reference/content/information-control.md" /></Message>
                <Message><Import path="reference/world-engine/workflow.md" /></Message>
                <Message><Import path="reference/agent/profile-context-memory.md" /></Message>
                <Message><Import path="assets/workspace/.nbook/agent/skills/novel-workflow-writer-execution/SKILL.md" /></Message>
                <Message>{inputContext}</Message>
            </HistorySet>
            <AppendingSet>
                <FileChangeNotice mode={ctx.settings.fileChangeAwareness} />
                <If condition={!ctx.invocation?.message}>
                    <Message>本轮没有收到 invoke_agent.message。不要写文件；请通过 report_result.result 要求调用方补充本轮写作任务。</Message>
                </If>
            </AppendingSet>
        </ProfilePrompt>
    );
}

/**
 * 渲染默认叙事人称。
 */
function narrativePersonText(value: Settings["narrativePerson"]): string {
    switch (value) {
        case "first":
            return "第一人称";
        case "second":
            return "第二人称";
        case "third":
            return "第三人称";
    }
}



async function renderInputContext(ctx: ProfilePrepareContext<Initial, Payload>): Promise<string> {
    const payload = ctx.invocation?.payload;
    if (!payload) {
        return [
            "<writer_input_context>",
            `File Scope: ${ctx.session.projectPath ?? ctx.session.workspaceRoot}`,
            "<missing_payload>",
            "当前没有收到 invoke_agent.input。writer 不能写文件，必须通过 report_result.result 要求调用方补充 input.path 和可选 input.context。",
            "</missing_payload>",
            "</writer_input_context>",
        ].join("\n");
    }

    const target = await resolvePayloadTarget(payload.path, ctx.session.workspaceFsRoot, ctx.session.projectPath);
    const context = normalizePayloadContext(target, payload.context);
    return [
        "<writer_input_context>",
        `File Scope: ${ctx.session.projectPath ?? ctx.session.workspaceRoot}`,
        renderTargetFile(target),
        payload.chapterId ? `<chapter_id>${payload.chapterId}</chapter_id>\n用 get_chapter_writer_brief({projectPath: "${target.projectPath}", chapterId: "${payload.chapterId}"}) 自取本章 brief。` : "",
        renderSuggestedContext(target, context),
        "</writer_input_context>",
    ].filter(Boolean).join("\n");
}

/**
 * 解析本轮 writer payload 的唯一写入目标。
 */
async function resolvePayloadTarget(
    rawPath: string,
    workspaceFsRoot: AbsoluteFsPath,
    sessionProjectPath: string | undefined,
): Promise<WriterPayloadTarget> {
    const path = normalizePayloadPath(rawPath, "writer.input.path");
    if (!path.endsWith(".md")) {
        throw new Error("writer.input.path 必须指向当前 Project Workspace 内的 Markdown 文件，例如 manuscript/001-chapter/index.md。");
    }
    if (!sessionProjectPath || isAbsolute(sessionProjectPath)) {
        throw new Error("writer需要绑定managed Project Path，才能解析Project相对input.path。");
    }
    const projectPath = normalizeProjectPath(sessionProjectPath);
    const projectSlug = projectPath.slice("workspace/".length);
    if (path === projectSlug || path.startsWith(`${projectSlug}/`) || path.startsWith("workspace/")) {
        throw new Error("writer.input.path必须相对当前Project Workspace；不要添加Project slug或workspace/<project>/前缀。");
    }
    await readProjectManifest(workspaceFsRoot, projectPath).catch((error: unknown) => {
        throw new Error(`writer.input.path 指向的 Project 不存在或无法读取：${projectPath}。${error instanceof Error ? error.message : String(error)}`);
    });
    const projectRelativePath = path;
    const chapterPath = projectRelativePath.startsWith("manuscript/") && projectRelativePath.endsWith("/index.md")
        ? `${posix.dirname(projectRelativePath)}/`
        : null;
    return {
        path,
        projectSlug,
        projectPath,
        chapterPath,
    };
}

/**
 * 校验并规范化 payload.context 中的建议读取路径。
 */
function normalizePayloadContext(target: WriterPayloadTarget, context: Payload["context"] | undefined): NonNullable<Payload["context"]> {
    return {
        lorebookEntries: context?.lorebookEntries?.map((path) => normalizeProjectPathRef(path, target.projectSlug, "writer.input.context.lorebookEntries", {preserveTrailingSlash: true})),
        readablePaths: context?.readablePaths?.map((path) => normalizeProjectPathRef(path, target.projectSlug, "writer.input.context.readablePaths", {mustBeMarkdown: true})),
    };
}

function renderTargetFile(target: WriterPayloadTarget): string {
    return [
        "<target_file>",
        `path: ${target.path}`,
        `projectSlug: ${target.projectSlug}`,
        `projectPath: ${target.projectPath}`,
        target.chapterPath ? `chapterPath: ${target.chapterPath}` : "",
        "规则：这是本轮唯一允许写入或修改的文件。若文件已存在，写作前先用 read 读取原文；若文件不存在，可按 message 创建。",
        "</target_file>",
    ].filter(Boolean).join("\n");
}

function renderSuggestedContext(target: WriterPayloadTarget, context: NonNullable<Payload["context"]>): string {
    return [
        "<suggested_context>",
        "这些是调用方建议读取的上下文引用，不是任务正文，也不是必须全部读取的清单。请根据本轮 message 判断需要读什么。",
        `projectPath: ${target.projectPath}`,
        renderList("lorebookEntries", context.lorebookEntries, "建议按需用 read 读取节点 index.md，必要时读取同级 state.md。"),
        renderList("readablePaths", context.readablePaths, "建议按需用 read 读取。"),
        "</suggested_context>",
    ].filter(Boolean).join("\n");
}

function renderList(label: string, values: readonly string[] | undefined, hint: string): string {
    if (!values?.length) {
        return `${label}: []`;
    }
    return [
        `${label}:`,
        ...values.map((value) => `- ${value}`),
        `hint: ${hint}`,
    ].join("\n");
}

function normalizeProjectPathRef(rawPath: string, projectSlug: string, label: string, options: {mustBeMarkdown?: boolean; preserveTrailingSlash?: boolean} = {}): string {
    const path = normalizePayloadPath(rawPath, label, {preserveTrailingSlash: options.preserveTrailingSlash});
    if (options.mustBeMarkdown && !path.endsWith(".md")) {
        throw new Error(`${label} 必须指向 Project Workspace 内的 Markdown 文件：${rawPath}`);
    }
    if (path === projectSlug || path.startsWith(`${projectSlug}/`) || path.startsWith("workspace/")) {
        throw new Error(`${label}必须相对当前Project Workspace；不要添加${projectSlug}/或workspace/<project>/前缀。`);
    }
    return path;
}

function normalizePayloadPath(rawPath: string, label: string, options: {preserveTrailingSlash?: boolean} = {}): string {
    const trimmed = rawPath.trim();
    if (!trimmed) {
        throw new Error(`${label} 不能为空。`);
    }
    if (isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/u.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
        throw new Error(`${label}必须是当前Project Workspace相对路径，不能是绝对路径：${rawPath}`);
    }
    const hadTrailingSlash = /[\\/]$/u.test(trimmed);
    const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/u, "");
    const parts = normalized.split("/");
    if (parts.some((part) => part === "." || part === ".." || part === "")) {
        throw new Error(`${label} 不能包含空路径段、. 或 ..：${rawPath}`);
    }
    return options.preserveTrailingSlash && hadTrailingSlash ? `${normalized}/` : normalized;
}
