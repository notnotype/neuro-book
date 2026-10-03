import {readFile} from "node:fs/promises";
import {isAbsolute, resolve, join, relative} from "node:path";
import type {AgentToolCall} from "@earendil-works/pi-agent-core";
import type {AssistantMessage, JsonValue} from "nbook/server/agent/messages/types";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {createAssistantTextMessage, createStoredTextToolResult, createStoredUserMessage} from "nbook/server/agent/messages/message-utils";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import type {AgentCatalogItem, AgentProfile, ProfilePrepareContext, ProfileTurnPlan} from "nbook/server/agent/profiles/types";
import {planModeToolDirectory} from "nbook/server/agent/plan-mode-directory";
import {AGENT_MODE_STATE_KEY, AGENT_TASKS_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {NeuroSessionContext, SessionEntryDraft} from "nbook/server/agent/session/types";
import type {ProfileVariablePathInput} from "nbook/server/agent/variables/types";
import type {AgentMode} from "nbook/shared/dto/agent-session.dto";
import type {FileChangeAwareness} from "nbook/server/agent/profiles/profile-turn-context";
import {absoluteFsPath, resolveContainedFilePath} from "nbook/server/runtime/paths/file-path";
import {resolveApplicationRoot, resolveSystemNbookRoot, resolveSystemReferenceRoot} from "nbook/server/workspace-files/system-workspace-assets";
import type {
    ModeSlotKind,
    ProfileBuiltinNode,
    ProfileDslChild,
    ProfileDslNode,
    ProfileFileChangeNoticeNode,
    ProfileFragmentNode,
    ProfileIfNode,
    ProfileImportAs,
    ProfileImportProps,
    ProfileMessageNode,
    ProfileModeSlotNode,
    ProfilePromptNode,
    ProfileReminderNode,
    ProfileRuntimeState,
    ProfileSetNode,
    ProfileStringFragmentNode,
    ProfileToolCallNode,
    ProfileWatchNode,
    ReminderChange,
    ReminderState,
    WatchChange,
    WatchState,
} from "nbook/profile-sdk/contracts";
export type {
    ModeSlotKind,
    ProfileDslChild,
    ProfileDslNode,
    ProfileFileChangeNoticeNode,
    ProfileFragmentNode,
    ProfileIfNode,
    ProfileImportAs,
    ProfileImportProps,
    ProfileMessageNode,
    ProfileModeSlotNode,
    ProfilePromptNode,
    ProfileReminderNode,
    ProfileRuntimeState,
    ProfileSetNode,
    ProfileStringFragmentNode,
    ProfileToolCallNode,
    ProfileWatchNode,
    ReminderChange,
    ReminderState,
    WatchChange,
    WatchState,
} from "nbook/profile-sdk/contracts";

type RenderZone = "root" | "system" | "history" | "model" | "appending" | "message" | "assistant" | "reminder" | "watch";

type CompileState = {
    context: ProfilePrepareContext<any>;
    profileKey: string;
    currentRuntimeState: ProfileRuntimeState;
    nextRuntimeState: ProfileRuntimeState;
    stateTouched: boolean;
    currentTurn: number;
    pendingToolCallIds: string[];
    plan: ProfileTurnPlan;
    /** 当前消息渲染过程中命中的具名 fragment 标签；renderMessageNode 进出时保存 / 恢复（Task 126）。 */
    pendingLabels: string[];
    /** 外层作用域标签（Reminder / Watch），对其内部产生的每条消息都生效。 */
    scopeLabels: string[];
    /**
     * 每条产物消息的来源名，按**对象标识**关联。
     * 刻意不写进消息体：消息体会原样发给 provider，塞归因字段等于污染 prompt。
     */
    messageLabels: WeakMap<StoredAgentMessage, readonly string[]>;
};

/** 新建一份空的归因收集态。 */
function emptyLabelState(): Pick<CompileState, "pendingLabels" | "scopeLabels" | "messageLabels"> {
    return {pendingLabels: [], scopeLabels: [], messageLabels: new WeakMap()};
}

/** 从渲染产物按分区抽出与消息数组一一对应的来源名。无来源的位置为 null。 */
function collectPromptSourceLabels(state: CompileState): ProfileTurnPlan["promptSourceLabels"] {
    const pick = (messages: StoredAgentMessage[] | undefined): (readonly string[] | null)[] | undefined => {
        if (!messages?.length) {
            return undefined;
        }
        const labels = messages.map((message) => state.messageLabels.get(message) ?? null);
        return labels.some((label) => label !== null) ? labels : undefined;
    };
    const collected = {
        historyInit: pick(state.plan.historyInitMessages),
        modelContext: pick(state.plan.modelContextMessages),
        modelContextAppending: pick(state.plan.modelContextAppendingMessages),
        appending: pick(state.plan.appendingMessages),
    };
    return Object.values(collected).some(Boolean) ? collected : undefined;
}

const PROFILE_STATE_KEY_PREFIX = "profileState.";

/**
 * 编译 profile TSX DSL，产出 harness 可消费的 ProfileTurnPlan。
 */
export async function compileProfileContext(
    profile: Pick<AgentProfile, "manifest">,
    context: ProfilePrepareContext<any>,
    tree: ProfileDslNode,
): Promise<ProfileTurnPlan> {
    const materializedTree = materializeProfileDslNode(tree);
    const currentRuntimeState = readProfileRuntimeState(context.session.customState[profileStateKey(profile.manifest.key)]);
    const state: CompileState = {
        context,
        profileKey: profile.manifest.key,
        currentRuntimeState,
        nextRuntimeState: cloneProfileRuntimeState(currentRuntimeState),
        stateTouched: false,
        currentTurn: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
        pendingToolCallIds: [],
        plan: {},
        ...emptyLabelState(),
    };
    await renderRoot(state, materializedTree);
    const promptSourceLabels = collectPromptSourceLabels(state);
    if (promptSourceLabels) {
        state.plan.promptSourceLabels = promptSourceLabels;
    }
    if (state.stateTouched) {
        state.plan.stateWrites = [{
            type: "custom",
            key: profileStateKey(profile.manifest.key),
            value: state.nextRuntimeState as JsonValue,
        }];
    }
    validateProfileTurnPlan(profile.manifest.key, state.plan);
    return state.plan;
}

/**
 * 只编译 ProfilePrompt 里的 System 分区，用于 session snapshot 展示当前 profile system prompt。
 */
export async function compileProfileSystemPrompt(
    profile: Pick<AgentProfile, "manifest">,
    context: ProfilePrepareContext<any>,
    tree: ProfileDslNode,
): Promise<string | undefined> {
    const materializedTree = materializeProfileDslNode(tree);
    if (materializedTree.kind !== "ProfilePrompt") {
        throw new Error("context(ctx) 必须返回 <ProfilePrompt> 根节点。");
    }
    const state: CompileState = {
        context,
        profileKey: profile.manifest.key,
        currentRuntimeState: {},
        nextRuntimeState: {},
        stateTouched: false,
        currentTurn: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
        pendingToolCallIds: [],
        plan: {},
        ...emptyLabelState(),
    };
    const systemPrompt = await renderSystemOnlyChildren(state, materializedTree.children);
    return systemPrompt.trim() ? systemPrompt : undefined;
}

/**
 * 校验底层 prepare 返回的受控状态写入。
 */
export function validateProfileTurnPlan(profileKey: string, plan: ProfileTurnPlan | undefined): asserts plan is ProfileTurnPlan {
    if (!plan || typeof plan !== "object") {
        throw new Error(`profile ${profileKey} prepare/context 必须返回 ProfileTurnPlan。`);
    }
    const allowedKeys = new Set(["systemPrompt", "historyInitMessages", "appendingMessages", "modelContextAppendingMessages", "modelContextMessages", "turnContexts", "promptSourceLabels", "stateWrites"]);
    const illegalKey = Object.keys(plan).find((key) => !allowedKeys.has(key));
    if (illegalKey) {
        throw new Error(`profile ${profileKey} ProfileTurnPlan 不允许返回 ${illegalKey}。`);
    }
    for (const write of plan.stateWrites ?? []) {
        if (write.type !== "custom") {
            throw new Error(`profile ${profileKey} stateWrites 只允许写 custom entry。`);
        }
        if (write.key !== profileStateKey(profileKey)) {
            throw new Error(`profile ${profileKey} stateWrites 只允许写 ${profileStateKey(profileKey)}。`);
        }
        validateProfileRuntimeStateWrite(profileKey, write.value);
    }
    if ((plan.turnContexts?.length ?? 0) > 1) {
        throw new Error(`profile ${profileKey} 第一版只允许声明一个 FileChangeNotice。`);
    }
    for (const context of plan.turnContexts ?? []) {
        if (
            context.kind !== "file-change-notice"
            || !Number.isInteger(context.appendingIndex)
            || context.appendingIndex < 0
        ) {
            throw new Error(`profile ${profileKey} turnContexts 非法。`);
        }
    }
}

/**
 * profile runtime state 在 session custom entry 中的固定 key。
 */
export function profileStateKey(profileKey: string): string {
    return `${PROFILE_STATE_KEY_PREFIX}${profileKey}`;
}

/**
 * ProfilePrompt 根节点。
 */
export function ProfilePrompt(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfilePromptNode {
    return {
        kind: "ProfilePrompt",
        children: normalizeChildren(props.children),
    };
}

/**
 * Provider 级 system prompt 分区。
 */
export function System(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileSetNode {
    return {
        kind: "System",
        children: normalizeChildren(props.children),
    };
}

/**
 * 空会话首轮初始化历史。
 */
export function HistorySet(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileSetNode {
    return {
        kind: "HistorySet",
        children: normalizeChildren(props.children),
    };
}

/**
 * 本轮模型可见但不落 session 的上下文。
 */
export function ModelContext(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileSetNode {
    return {
        kind: "ModelContext",
        children: normalizeChildren(props.children),
    };
}

/**
 * 本轮 ReAct 前写入 session 的上下文。
 */
export function AppendingSet(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileSetNode {
    return {
        kind: "AppendingSet",
        children: normalizeChildren(props.children),
    };
}

/**
 * Profile 控制的文件变更提醒。
 *
 * 必须作为 AppendingSet 的直接子节点；off 时不声明运行时上下文。
 */
export function FileChangeNotice(props: {mode: FileChangeAwareness}): ProfileFileChangeNoticeNode {
    return {
        kind: "FileChangeNotice",
        mode: props.mode,
    };
}

/**
 * 用户消息节点。system role 明确非法。
 */
export function Message(props: {role?: "user" | "system"; children?: ProfileDslChild | ProfileDslChild[]}): ProfileMessageNode {
    if (props.role === "system") {
        throw new Error("<Message role=\"system\"> 不被支持，请使用 <System> 或 <AppendingSet><Message>。");
    }
    return {
        kind: "Message",
        role: props.role ?? "user",
        children: normalizeChildren(props.children),
    };
}

/**
 * Assistant 示例消息节点。
 */
export function AIMessage(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileMessageNode {
    return {
        kind: "AIMessage",
        role: "assistant",
        children: normalizeChildren(props.children),
    };
}

/**
 * Assistant tool call 子节点。
 */
export function ToolCall(props: {id: string; name: string; args?: Record<string, JsonValue>}): ProfileToolCallNode {
    return {
        kind: "ToolCall",
        id: props.id,
        name: props.name,
        args: props.args,
    };
}

/**
 * Tool result 示例消息节点。
 */
export function ToolResult(props: {
    toolCallId: string;
    toolName: string;
    isError?: boolean;
    children?: ProfileDslChild | ProfileDslChild[];
}): ProfileMessageNode {
    return {
        kind: "ToolResult",
        role: "toolResult",
        toolCallId: props.toolCallId,
        toolName: props.toolName,
        isError: props.isError,
        children: normalizeChildren(props.children),
    };
}

/**
 * 按条件和状态控制 AppendingSet 注入。
 */
export function Reminder(props: {
    id: string;
    when?: boolean;
    watchPath?: string;
    watchValue?: JsonValue;
    watch?: (ctx: ProfilePrepareContext<any>) => JsonValue | undefined | Promise<JsonValue | undefined>;
    render?: (change: ReminderChange) => ProfileDslChild | Promise<ProfileDslChild>;
    repeatEveryTurns?: number;
    children?: ProfileDslChild | ProfileDslChild[];
}): ProfileReminderNode {
    return {
        kind: "Reminder",
        id: props.id,
        when: props.when ?? true,
        watchPath: props.watchPath,
        watchValue: props.watchValue,
        watch: props.watch,
        render: props.render,
        repeatEveryTurns: props.repeatEveryTurns,
        children: normalizeChildren(props.children),
    };
}

/**
 * 观察上下文值变化，并在变化时渲染子树或 render 结果。
 */
export function Watch(props: {
    id?: string;
    path?: string;
    value?: JsonValue;
    render?: (change: WatchChange) => ProfileDslChild | Promise<ProfileDslChild>;
    children?: ProfileDslChild | ProfileDslChild[];
}): ProfileWatchNode {
    return {
        kind: "Watch",
        id: props.id,
        path: props.path,
        value: props.value,
        render: props.render,
        children: normalizeChildren(props.children),
    };
}

/**
 * 条件渲染节点。
 */
export function If(props: {condition?: boolean; children?: ProfileDslChild | ProfileDslChild[]}): ProfileIfNode {
    return {
        kind: "If",
        condition: props.condition ?? false,
        children: normalizeChildren(props.children),
    };
}

/**
 * Skill catalog string fragment。mode 只切换默认文案中与运行位置相关的行：
 * userAssets 供 cwd=Workspace Root .nbook 的 profile 使用，其余原则两种 mode 共享同一份文本。
 */
export function SkillCatalog(props: {mode?: "workspace" | "userAssets"; text?: string | ((ctx: ProfilePrepareContext<any>) => string | Promise<string>)}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: props.text ?? ((ctx) => defaultSkillCatalogText(ctx, props.mode ?? "workspace")),
        label: "SkillCatalog",
    };
}

/**
 * Agent catalog string fragment。用于向模型展示可创建/调用的 profile 与 schema 摘要。
 */
export function AgentCatalog(props: {text?: string | ((ctx: ProfilePrepareContext<any>) => string | Promise<string>)}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: props.text ?? defaultAgentCatalogText,
        label: "AgentCatalog",
    };
}

/**
 * Workflow catalog string fragment（Task 111）。列出可运行的 workflow 索引与使用纪律；
 * API 细节不进 prompt（渐进式加载：编写指南在 reference/agent/workflow/，需要时用 read 工具读取）。
 */
export function WorkflowCatalog(props: {text?: string | ((ctx: ProfilePrepareContext<any>) => string | Promise<string>)}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: props.text ?? defaultWorkflowCatalogText,
        label: "WorkflowCatalog",
    };
}

/**
 * Activated skills string fragment。
 */
export function ActivatedSkills(props: {text?: string | ((ctx: ProfilePrepareContext<any>) => string | Promise<string>)}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: props.text ?? defaultActivatedSkillsText,
        label: "ActivatedSkills",
    };
}

/**
 * Agent SQL schema 摘要 string fragment。profile 作者决定注入到 System、ModelContext 或其他 string 节点。
 */
export function SqlSchemaSummary(props: {text?: string | ((ctx: ProfilePrepareContext<any>) => string | Promise<string>)}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: props.text ?? defaultSqlSchemaSummaryText,
        label: "SqlSchemaSummary",
    };
}

/**
 * 导入共享文本上下文。适合在 HistorySet 的 Message 中显式加载 reference/docs/AGENTS.md 或系统 skill。
 */
export function Import(props: ProfileImportProps): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: (ctx) => renderImportedContext(props, ctx),
        // 归因用 path 而非 label：面板要能定位到具体文件，作者的展示 label 可能重名。
        label: `Import:${props.path}`,
    };
}

/**
 * 通用 system-reminder string fragment。推荐用于动态 runtime 提醒。
 */
export function SystemReminder(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: async (ctx) => {
            const body = await renderStandaloneString(ctx, normalizeChildren(props.children));
            return body.trim() ? systemReminder(body) : "";
        },
        label: "SystemReminder",
    };
}

/**
 * 已关联 agent 摘要。可嵌入普通 Message 或 SystemReminder。
 */
export function LinkedAgentsSummary(_props: Record<string, never> = {}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: (ctx) => linkedAgentsSummaryText(ctx.session),
        label: "LinkedAgentsSummary",
    };
}

/**
 * 已关联 agent 变化提醒。
 */
export function LinkedAgentsReminder(props: {id?: string; repeatEveryTurns?: number} = {}): ProfileReminderNode {
    return Reminder({
        id: props.id ?? "linked-agents",
        watch: (ctx) => ctx.session.linkedAgents as JsonValue,
        repeatEveryTurns: props.repeatEveryTurns,
        render: (change) => Array.isArray(change.currentValue) && change.currentValue.length > 0
            ? Message({children: LinkedAgentsReminderText()})
            : null,
    });
}

/**
 * 首轮注入当前 cwd、路径合同和用户在IDE中选中的文件；后续在焦点变化时注入变化提醒。
 */
export function WorkspaceFocusReminder(props: {id?: string; repeatEveryTurns?: number} = {}): ProfileReminderNode {
    return Reminder({
        id: props.id ?? "workspace-focus",
        watch: readWorkspaceFocus,
        repeatEveryTurns: props.repeatEveryTurns,
        render: (change) => {
            const focus = readWorkspaceFocusState(change.currentValue);
            if (!focus.currentProjectWorkspace) {
                return Message({children: systemReminder([
                    "Current Workspace Focus:",
                    "- Current Project Workspace: none",
                    "- Current selected file: none",
                    "- File tools and bash use the Workspace Root as cwd.",
                    "- Relative paths resolve from cwd. Any absolute filesystem path can be used directly.",
                    "- Managed Project APIs use a single-segment projectRoot.",
                ].join("\n"))});
            }
            const projectRoot = projectRootFromWorkspace(focus.currentProjectWorkspace);
            const selectedFile = renderSelectedWorkspaceFile(projectRoot, focus.selectedFilePath);
            if (change.hasPreviousValue && change.didChange) {
                const previous = readWorkspaceFocusState(change.previousValue);
                const projectChanged = previous.currentProjectWorkspace !== focus.currentProjectWorkspace;
                const selectedChanged = previous.selectedFilePath !== focus.selectedFilePath;
                if (projectChanged) {
                    return Message({children: systemReminder([
                        `User switched Current Project Workspace to ${focus.currentProjectWorkspace}.`,
                        "The next invocation uses this Project Workspace as cwd for file tools and bash.",
                        "Use lorebook/..., manuscript/..., and reference/... directly for current project files.",
                        `Use ${projectRoot} when a tool explicitly asks for projectRoot.`,
                        "Any absolute filesystem path can be used directly.",
                        "For another managed Project file, prefer workspace/<project-slug>/<relative-path> when Project identity, open gate, History, or Context Access matters.",
                        `Current selected file: ${selectedFile}`,
                    ].join("\n"))});
                }
                if (selectedChanged) {
                    return Message({children: systemReminder([
                        `Current selected file changed to ${selectedFile}.`,
                        "Use this cwd-relative path directly in file tools.",
                    ].join("\n"))});
                }
            }
            return Message({children: systemReminder([
                "Current Workspace Focus:",
                `- Current Project Workspace: ${focus.currentProjectWorkspace}`,
                "- File tools and bash use this Project Workspace as cwd.",
                "- For focused project files, use lorebook/..., manuscript/..., or reference/... directly.",
                "- Any absolute filesystem path can be used directly; cwd is only the base for relative paths, not an access boundary.",
                "- For another managed Project file, prefer workspace/<project-slug>/<relative-path> when Project identity, open gate, History, or Context Access matters.",
                `- Current selected file: ${selectedFile}`,
                "- project.yaml is at project.yaml.",
                `- Use ${projectRoot} when a tool explicitly asks for projectRoot.`,
            ].join("\n"))});
        },
    });
}

/**
 * normal 模式下提示 switch_mode 可用性（Task 90）。活跃只读模式的持续提醒由 ModeReminder 负责。
 */
export function ModeAvailabilityReminder(props: {id?: string; repeatEveryTurns?: number} = {}): ProfileReminderNode {
    return Reminder({
        id: props.id ?? "mode-availability",
        watch: (ctx) => ctx.session.agentMode,
        repeatEveryTurns: props.repeatEveryTurns,
        render: (change) => change.currentValue === "normal"
            ? Message({children: systemReminder("You are in normal mode. switch_mode is available: propose \"plan\" before large, risky, or multi-step changes to prepare a read-only plan first, or \"discuss\" when the user wants to talk through direction before any changes. Each switch takes effect only after user approval.")})
            : null,
    });
}

/**
 * 当前任务清单提醒。默认读取 agent.tasks custom state。
 */
export function TaskReminder(props: {id?: string; stateKey?: string; repeatEveryTurns?: number} = {}): ProfileReminderNode {
    const stateKey = props.stateKey ?? AGENT_TASKS_STATE_KEY;
    return Reminder({
        id: props.id ?? "tasks",
        watch: (ctx) => ctx.session.customState[stateKey] ?? null,
        repeatEveryTurns: props.repeatEveryTurns ?? 8,
        children: Message({children: TaskReminderText({stateKey})}),
    });
}

/**
 * Agent 工作模式生命周期提醒（Task 90）。默认读取 agent.mode custom state。
 * 状态变化（didChange=true）按 phase 渲染 enter/reentry/exit 全文；
 * repeatEveryTurns 周期重放（didChange=false）渲染 steady 轻提醒，normal 模式渲染空。
 */
export function ModeReminder(props: {
    id?: string;
    stateKey?: string;
    repeatEveryTurns?: number;
    children?: ProfileDslChild | ProfileDslChild[];
} = {}): ProfileReminderNode {
    const stateKey = props.stateKey ?? AGENT_MODE_STATE_KEY;
    const slots = readModeSlots(normalizeChildren(props.children));
    return Reminder({
        id: props.id ?? "agent-mode",
        watch: (ctx) => ({
            mode: ctx.session.agentMode,
            state: ctx.session.customState[stateKey] ?? null,
        }),
        repeatEveryTurns: props.repeatEveryTurns ?? 6,
        render: (change) => Message({children: ModeReminderText({stateKey, slots, steadyOnly: !change.didChange})}),
    });
}

/**
 * 用户输入中显式 $skill 时的提醒。
 */
export function MentionedSkillsReminder(_props: Record<string, never> = {}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: mentionedSkillsReminderText,
        label: "MentionedSkillsReminder",
    };
}

/**
 * ModeReminder 自定义插槽（Task 90）。只能作为 ModeReminder 直接子节点，每个 kind 至多一次。
 */
export function ModeSlot(props: {kind: ModeSlotKind; children?: ProfileDslChild | ProfileDslChild[]}): ProfileModeSlotNode {
    return {
        kind: "ModeSlot",
        slot: props.kind,
        children: normalizeChildren(props.children),
    };
}

export function Fragment(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileFragmentNode {
    return {
        kind: "Fragment",
        children: normalizeChildren(props.children),
    };
}

function readModeSlots(children: ProfileDslChild[]): Partial<Record<ModeSlotKind, ProfileDslChild[]>> {
    const slots: Partial<Record<ModeSlotKind, ProfileDslChild[]>> = {};
    const flat = children.flatMap(flattenChildren);
    for (const child of flat) {
        if (child === null || child === undefined || child === false || child === true) {
            continue;
        }
        if (typeof child === "string" || typeof child === "number") {
            if (String(child).trim() !== "") {
                throw new Error("ModeReminder 只能直接包含 ModeSlot。");
            }
            continue;
        }
        if (Array.isArray(child)) {
            continue;
        }
        if (child.kind !== "ModeSlot") {
            throw new Error(`ModeReminder 只能直接包含 ModeSlot，不能包含 ${child.kind}。`);
        }
        if (slots[child.slot]) {
            throw new Error(`ModeSlot kind="${child.slot}" 只能出现一次。`);
        }
        slots[child.slot] = child.children;
    }
    return slots;
}

async function renderRoot(state: CompileState, tree: ProfileDslNode): Promise<void> {
    if (!tree || typeof tree !== "object" || Array.isArray(tree) || tree.kind !== "ProfilePrompt") {
        throw new Error("context(ctx) 必须返回 <ProfilePrompt> 根节点。");
    }
    await renderChildren(state, "root", tree.children);
}

async function renderSystemOnlyChildren(state: CompileState, children: ProfileDslChild[]): Promise<string> {
    const prompts: string[] = [];
    for (const child of children) {
        if (child === null || child === undefined || child === false || child === true) {
            continue;
        }
        if (Array.isArray(child)) {
            const text = await renderSystemOnlyChildren(state, child);
            if (text) {
                prompts.push(text);
            }
            continue;
        }
        if (typeof child === "string" || typeof child === "number") {
            if (String(child).trim() !== "") {
                throw new Error("root 中的文本必须放在支持 string 的节点内部。");
            }
            continue;
        }
        if (child.kind === "Fragment") {
            const text = await renderSystemOnlyChildren(state, child.children);
            if (text) {
                prompts.push(text);
            }
            continue;
        }
        if (child.kind === "If") {
            if (!child.condition) {
                continue;
            }
            const text = await renderSystemOnlyChildren(state, child.children);
            if (text) {
                prompts.push(text);
            }
            continue;
        }
        if (child.kind !== "System") {
            continue;
        }
        validateSystemChildren(child.children);
        const text = await renderStringChildren(state, "system", child.children);
        if (text) {
            prompts.push(text);
        }
    }
    return prompts.join("\n\n");
}

async function renderChildren(state: CompileState, zone: RenderZone, children: ProfileDslChild[]): Promise<StoredAgentMessage[]> {
    const messages: StoredAgentMessage[] = [];
    for (const child of children) {
        messages.push(...await renderChild(state, zone, child));
    }
    return messages;
}

async function renderChild(state: CompileState, zone: RenderZone, child: ProfileDslChild): Promise<StoredAgentMessage[]> {
    if (child === null || child === undefined || child === false || child === true) {
        return [];
    }
    if (Array.isArray(child)) {
        return renderChildren(state, zone, child);
    }
    if (typeof child === "string" || typeof child === "number") {
        if (String(child).trim() !== "") {
            throw new Error(`${zone} 中的文本必须放在支持 string 的节点内部。`);
        }
        return [];
    }
    if (child.kind === "Fragment") {
        return renderChildren(state, zone, child.children);
    }
    if (child.kind === "If") {
        if (!child.condition) {
            return [];
        }
        return renderChildren(state, zone, child.children);
    }
    if (child.kind === "System") {
        assertZone(zone, "root", "System 只能放在 ProfilePrompt 顶层。");
        validateSystemChildren(child.children);
        const text = await renderStringChildren(state, "system", child.children);
        state.plan.systemPrompt = [state.plan.systemPrompt, text].filter(Boolean).join("\n\n");
        return [];
    }
    if (child.kind === "HistorySet") {
        assertZone(zone, "root", "HistorySet 只能放在 ProfilePrompt 顶层。");
        const messages = await renderChildren(state, "history", child.children);
        state.plan.historyInitMessages = [...state.plan.historyInitMessages ?? [], ...onlyMessages(messages, "HistorySet")];
        return [];
    }
    if (child.kind === "ModelContext") {
        assertZone(zone, "root", "ModelContext 只能放在 ProfilePrompt 顶层。");
        const messages = await renderChildren(state, "model", child.children);
        if (messages.length > 0) {
            state.plan.modelContextMessages = [...state.plan.modelContextMessages ?? [], ...messages];
        }
        return [];
    }
    if (child.kind === "AppendingSet") {
        assertZone(zone, "root", "AppendingSet 只能放在 ProfilePrompt 顶层。");
        const messages: StoredAgentMessage[] = [];
        const baseIndex = state.plan.appendingMessages?.length ?? 0;
        for (const appendingChild of child.children) {
            if (appendingChild && !Array.isArray(appendingChild) && typeof appendingChild === "object" && appendingChild.kind === "FileChangeNotice") {
                if (appendingChild.mode !== "off") {
                    state.plan.turnContexts = [
                        ...state.plan.turnContexts ?? [],
                        {
                            kind: "file-change-notice",
                            mode: appendingChild.mode,
                            appendingIndex: baseIndex + messages.length,
                        },
                    ];
                }
                continue;
            }
            messages.push(...await renderChild(state, "appending", appendingChild));
        }
        state.plan.appendingMessages = [...state.plan.appendingMessages ?? [], ...onlyMessages(messages, "AppendingSet")];
        return [];
    }
    if (child.kind === "FileChangeNotice") {
        throw new Error("FileChangeNotice 必须作为 AppendingSet 的直接子节点。");
    }
    if (child.kind === "Reminder") {
        if (zone !== "appending" && zone !== "model") {
            throw new Error("Reminder 只允许放在 AppendingSet 或 ModelContext 内。");
        }
        const messages = await renderReminder(state, child);
        if (zone === "model") {
            state.plan.modelContextAppendingMessages = [
                ...state.plan.modelContextAppendingMessages ?? [],
                ...onlyMessages(messages, "ModelContext Reminder"),
            ];
            return [];
        }
        return messages;
    }
    if (child.kind === "Watch") {
        if (zone !== "appending" && zone !== "model") {
            throw new Error("Watch 只允许放在 AppendingSet 或 ModelContext 内。");
        }
        return renderWatch(state, zone, child);
    }
    if (child.kind === "Message" || child.kind === "AIMessage" || child.kind === "ToolResult") {
        if (!["history", "model", "appending", "reminder", "watch"].includes(zone)) {
            throw new Error(`${child.kind} 不能直接放在 ${zone} 内。`);
        }
        return onlyNonEmptyMessage(await renderMessageNode(state, child));
    }
    if (child.kind === "ToolCall") {
        throw new Error("ToolCall 只能作为 AIMessage 的子节点。");
    }
    if (child.kind === "StringFragment") {
        if (zone !== "message" && zone !== "system" && zone !== "assistant" && zone !== "reminder" && zone !== "watch") {
            throw new Error("string fragment 只能放在支持 string 的节点内部。");
        }
        return [];
    }
    if (child.kind === "ModeSlot") {
        throw new Error(`ModeSlot kind="${child.slot}" 只能作为 ModeReminder 的直接子节点。`);
    }
    throw new Error(`未知 Profile DSL 节点：${JSON.stringify(child)}`);
}

function validateSystemChildren(children: ProfileDslChild[]): void {
    for (const child of children.flatMap(flattenChildren)) {
        if (Array.isArray(child)) {
            validateSystemChildren(child);
            continue;
        }
        if (!child || typeof child !== "object") {
            continue;
        }
        if (child.kind === "StringFragment" || child.kind === "Fragment" || child.kind === "If") {
            if (child.kind === "Fragment" || child.kind === "If") {
                validateSystemChildren(child.children);
            }
            continue;
        }
        throw new Error(`System 只能包含 string-like children，不能包含 ${child.kind}。`);
    }
}

/**
 * 渲染一个消息节点，并把它命中的 Profile DSL 来源名登记到旁表（Task 126）。
 *
 * 归因是纯可观测产物：登记走 WeakMap 对象标识，绝不写进消息体（消息体会原样发给 provider）。
 */
async function renderMessageNode(state: CompileState, node: ProfileMessageNode): Promise<StoredAgentMessage> {
    const outerLabels = state.pendingLabels;
    state.pendingLabels = [];
    try {
        const message = await renderMessageNodeContent(state, node);
        const labels = [...state.scopeLabels, ...state.pendingLabels];
        if (labels.length > 0) {
            state.messageLabels.set(message, labels);
        }
        return message;
    } finally {
        state.pendingLabels = outerLabels;
    }
}

async function renderMessageNodeContent(state: CompileState, node: ProfileMessageNode): Promise<StoredAgentMessage> {
    if (node.kind === "Message") {
        if (node.role === "system") {
            throw new Error("<Message role=\"system\"> 不被支持，请使用 <System> 或 <AppendingSet><Message>。");
        }
        return createStoredUserMessage(await renderStringChildren(state, "message", node.children));
    }
    if (node.kind === "AIMessage") {
        validateAssistantChildren(node.children);
        const contentText = await renderStringChildren(state, "assistant", node.children);
        const toolCalls = collectToolCalls(node.children).map((toolCall): AgentToolCall => ({
            type: "toolCall",
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.args ?? {},
        }));
        const assistant = createAssistantTextMessage({
            text: contentText,
            stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
        });
        state.pendingToolCallIds.push(...toolCalls.map((toolCall) => toolCall.id));
        return {
            ...assistant,
            content: [
                ...contentText ? [{type: "text" as const, text: contentText}] : [],
                ...toolCalls,
            ],
        } satisfies AssistantMessage;
    }
    if (!node.toolCallId || !node.toolName) {
        throw new Error("ToolResult 必须提供 toolCallId 和 toolName。");
    }
    if (!state.pendingToolCallIds.includes(node.toolCallId)) {
        throw new Error(`ToolResult.toolCallId 未匹配前序 ToolCall：${node.toolCallId}`);
    }
    state.pendingToolCallIds = state.pendingToolCallIds.filter((toolCallId) => toolCallId !== node.toolCallId);
    return createStoredTextToolResult({
        toolCallId: node.toolCallId,
        toolName: node.toolName,
        text: await renderStringChildren(state, "message", node.children),
        isError: node.isError,
    });
}

function validateAssistantChildren(children: ProfileDslChild[]): void {
    validateAssistantChildSequence(children, false);
}

function collectToolCalls(children: ProfileDslChild[]): ProfileToolCallNode[] {
    const toolCalls: ProfileToolCallNode[] = [];
    const visit = (child: ProfileDslChild): void => {
        if (child === null || child === undefined || child === false || child === true) {
            return;
        }
        if (Array.isArray(child)) {
            for (const item of child) {
                visit(item);
            }
            return;
        }
        if (typeof child === "string" || typeof child === "number" || child.kind === "StringFragment") {
            return;
        }
        if (child.kind === "ToolCall") {
            toolCalls.push(child);
            return;
        }
        if (child.kind === "Fragment") {
            for (const item of child.children) {
                visit(item);
            }
            return;
        }
        if (child.kind === "ModeSlot") {
            for (const item of child.children) {
                visit(item);
            }
            return;
        }
        if (child.kind === "If" && child.condition) {
            for (const item of child.children) {
                visit(item);
            }
        }
    };
    for (const child of children) {
        visit(child);
    }
    return toolCalls;
}

function validateAssistantChildSequence(children: ProfileDslChild[], seenToolCall: boolean): boolean {
    let localSeenToolCall = seenToolCall;
    for (const child of children) {
        if (child === null || child === undefined || child === false || child === true) {
            continue;
        }
        if (Array.isArray(child)) {
            localSeenToolCall = validateAssistantChildSequence(child, localSeenToolCall);
            continue;
        }
        if (typeof child === "string" || typeof child === "number") {
            if (localSeenToolCall && String(child).trim() !== "") {
                throw new Error("AIMessage 的 ToolCall 后不能再追加非 ToolCall 子节点。");
            }
            continue;
        }
        if (child.kind === "ToolCall") {
            localSeenToolCall = true;
            continue;
        }
        if (child.kind === "StringFragment") {
            if (localSeenToolCall) {
                throw new Error("AIMessage 的 ToolCall 后不能再追加非 ToolCall 子节点。");
            }
            continue;
        }
        if (child.kind === "Fragment") {
            localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
            continue;
        }
        if (child.kind === "ModeSlot") {
            localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
            continue;
        }
        if (child.kind === "If") {
            if (child.condition) {
                localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
            }
            continue;
        }
        if (localSeenToolCall) {
            throw new Error("AIMessage 的 ToolCall 后不能再追加非 ToolCall 子节点。");
        }
    }
    return localSeenToolCall;
}

async function renderReminder(state: CompileState, node: ProfileReminderNode): Promise<StoredAgentMessage[]> {
    if (!node.when) {
        return [];
    }
    const watchSourceCount = [node.watchPath, node.watchValue, node.watch].filter((source) => source !== undefined).length;
    if (watchSourceCount > 1) {
        throw new Error("Reminder.watchPath、Reminder.watchValue 与 Reminder.watch 只能提供一个。");
    }
    if (node.repeatEveryTurns !== undefined && (!Number.isInteger(node.repeatEveryTurns) || node.repeatEveryTurns <= 0)) {
        throw new Error("Reminder.repeatEveryTurns 必须是正整数。");
    }
    assertAllowedWatchPath(node.watchPath, "Reminder.watchPath");
    const currentValue = node.watch
        ? await node.watch(state.context)
        : node.watchPath ? await readPath(state.context, node.watchPath) : node.watchValue;
    const hasWatchValue = node.watchPath !== undefined || node.watchValue !== undefined || node.watch !== undefined;
    const fingerprint = hasWatchValue ? stableStringifyJsonValue(currentValue) : undefined;
    const previous = state.currentRuntimeState.reminders?.[node.id];
    const didFingerprintChange = hasWatchValue && previous?.fingerprint !== fingerprint;
    const shouldRepeat = typeof node.repeatEveryTurns === "number"
        && (previous?.injectedAtTurn === undefined || state.currentTurn - previous.injectedAtTurn >= node.repeatEveryTurns);
    if (hasWatchValue && didFingerprintChange) {
        state.nextRuntimeState.reminders = {
            ...state.nextRuntimeState.reminders,
            [node.id]: {
                hasValue: currentValue !== undefined,
                value: currentValue === undefined ? null : currentValue,
                fingerprint,
                ...(previous?.injectedAtTurn !== undefined ? {injectedAtTurn: previous.injectedAtTurn} : {}),
            },
        };
        state.stateTouched = true;
    }
    const shouldInject = hasWatchValue || node.repeatEveryTurns
        ? didFingerprintChange || shouldRepeat
        : true;
    if (!shouldInject) {
        return [];
    }
    const change: ReminderChange = {
        previousValue: previous?.hasValue ? previous.value ?? null : undefined,
        currentValue,
        hasPreviousValue: Boolean(previous?.hasValue),
        hasCurrentValue: currentValue !== undefined,
        didChange: didFingerprintChange,
        session: state.context.session,
    };
    const rendered = node.render ? await node.render(change) : node.children;
    if (!rendered || rendered === true) {
        return [];
    }
    const messages = await withScopeLabel(state, `Reminder:${node.id}`, () => renderChildren(state, "reminder", normalizeChildren(rendered)));
    if (messages.length === 0) {
        return [];
    }
    if (hasWatchValue || node.repeatEveryTurns) {
        const observed = state.nextRuntimeState.reminders?.[node.id] ?? previous;
        state.nextRuntimeState.reminders = {
            ...state.nextRuntimeState.reminders,
            [node.id]: {
                ...(observed ?? {}),
                ...(hasWatchValue && !observed ? {
                    hasValue: currentValue !== undefined,
                    value: currentValue === undefined ? null : currentValue,
                    fingerprint,
                } : {}),
                injectedAtTurn: state.currentTurn,
            },
        };
        state.stateTouched = true;
    }
    return messages;
}

async function renderWatch(state: CompileState, zone: RenderZone, node: ProfileWatchNode): Promise<StoredAgentMessage[]> {
    if (node.path !== undefined && node.value !== undefined) {
        throw new Error("Watch.path 与 Watch.value 不能同时提供。");
    }
    assertAllowedWatchPath(node.path, "Watch.path");
    if (node.value !== undefined && !node.id) {
        throw new Error("Watch.value 模式必须提供 id。");
    }
    const key = node.id ?? node.path;
    if (!key) {
        throw new Error("Watch 必须提供 path 或 id。");
    }
    const currentValue = node.path ? await readPath(state.context, node.path) : node.value;
    const currentBaseline: WatchState = {
        hasValue: currentValue !== undefined,
        value: currentValue === undefined ? null : currentValue,
        fingerprint: stableStringifyJsonValue(currentValue),
    };
    const previous = state.nextRuntimeState.watches?.[key] ?? state.currentRuntimeState.watches?.[key];
    state.nextRuntimeState.watches = {
        ...state.nextRuntimeState.watches,
        [key]: currentBaseline,
    };
    state.stateTouched = true;
    if (!previous && currentValue === undefined) {
        return [];
    }
    if (previous?.fingerprint === currentBaseline.fingerprint) {
        return [];
    }
    const change: WatchChange = {
        previousValue: previous?.hasValue ? previous.value : undefined,
        currentValue,
        path: key,
        hasPreviousValue: Boolean(previous?.hasValue),
        hasCurrentValue: currentValue !== undefined,
        session: state.context.session,
    };
    const rendered = node.render ? await node.render(change) : node.children;
    if (!rendered || rendered === true) {
        return [];
    }
    return withScopeLabel(state, `Watch:${key}`, () => renderChildren(state, zone === "model" ? "watch" : "watch", normalizeChildren(rendered)));
}

/**
 * 在作用域标签下渲染子树：期间产生的每条消息都会带上该标签（Task 126）。
 * 用于 Reminder / Watch —— 它们的消息由内部 Message 节点产出，光靠 fragment 标签认不出归属。
 */
async function withScopeLabel<T>(state: CompileState, label: string, render: () => Promise<T>): Promise<T> {
    state.scopeLabels.push(label);
    try {
        return await render();
    } finally {
        state.scopeLabels.pop();
    }
}

async function renderImportedContext(props: ProfileImportProps, context: ProfilePrepareContext<any>): Promise<string> {
    if (props.as && props.as !== "text") {
        throw new Error(`Import.as 第一版只支持 text：${props.as}`);
    }
    const path = normalizeImportPath(props.path);
    const readResult = await readImportFile(path, props.required === true, context);
    if (!readResult.exists) {
        return "";
    }
    let body = readResult.text;
    if (props.heading) {
        const extracted = extractMarkdownHeading(body, props.heading);
        if (extracted === null) {
            if (props.required === false) {
                return "";
            }
            throw new Error(`Import 未找到 Markdown heading：${path}#${props.heading}`);
        }
        body = extracted;
    }
    const truncated = props.maxBytes ? truncateUtf8(body, props.maxBytes) : {text: body, truncated: false};
    return renderImportFence({
        path,
        maxBytes: props.maxBytes,
        truncated: truncated.truncated,
        text: truncated.text,
    });
}

function normalizeImportPath(input: string): string {
    const path = input.trim().replaceAll("\\", "/");
    if (!path) {
        throw new Error("Import.path 不能为空。");
    }
    if (isAbsolute(path) || path.startsWith("/") || path.includes("://")) {
        throw new Error(`Import.path 只允许 repo / app root 相对路径：${input}`);
    }
    const normalized = path.split("/").filter((part) => part && part !== ".").join("/");
    if (!normalized || normalized.split("/").includes("..")) {
        throw new Error(`Import.path 不允许使用 .. 越界：${input}`);
    }
    if (!isAllowedImportPath(normalized)) {
        throw new Error(`Import.path 只允许 AGENTS.md、reference/**、docs/**、assets/workspace/.nbook/agent/skills/** 或 workspace/**：${input}`);
    }
    return normalized;
}

function isAllowedImportPath(path: string): boolean {
    return path === "AGENTS.md"
        || path.startsWith("reference/")
        || path.startsWith("docs/")
        || path.startsWith("assets/workspace/.nbook/agent/skills/")
        || path.startsWith("workspace/"); // 放开 Project 运行态文件（如 subject soul.md）Import；细粒度权限以后再收
}

async function readImportFile(path: string, required: boolean, context: ProfilePrepareContext<any>): Promise<{exists: true; text: string} | {exists: false}> {
    const target = path.startsWith("workspace/")
        ? resolveContainedFilePath(absoluteFsPath(context.session.workspaceRoot), path.slice("workspace/".length))
        : resolveApplicationImportPath(path);
    try {
        return {
            exists: true,
            text: await readFile(target, "utf8"),
        };
    } catch (error) {
        if (!isMissingFileError(error) || required) {
            throw error;
        }
        return {exists: false};
    }
}

function isMissingFileError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}

function extractMarkdownHeading(text: string, heading: string): string | null {
    const expected = normalizeMarkdownHeadingText(heading);
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    let start = -1;
    let level = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index]?.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (!match) {
            continue;
        }
        const title = normalizeMarkdownHeadingText(match[2] ?? "");
        if (title === expected) {
            start = index;
            level = match[1]?.length ?? 1;
            break;
        }
    }
    if (start < 0) {
        return null;
    }
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
        const match = lines[index]?.match(/^(#{1,6})\s+/);
        if (match && (match[1]?.length ?? 1) <= level) {
            end = index;
            break;
        }
    }
    return lines.slice(start, end).join("\n").trim();
}

function normalizeMarkdownHeadingText(text: string): string {
    return text.trim().replace(/\s+/g, " ");
}

function truncateUtf8(text: string, maxBytes: number): {text: string; truncated: boolean} {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
        throw new Error("Import.maxBytes 必须是正整数。");
    }
    if (Buffer.byteLength(text, "utf8") <= maxBytes) {
        return {text, truncated: false};
    }
    const chars = Array.from(text);
    let low = 0;
    let high = chars.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(chars.slice(0, middle).join(""), "utf8") <= maxBytes) {
            low = middle;
            continue;
        }
        high = middle - 1;
    }
    return {
        text: chars.slice(0, low).join(""),
        truncated: true,
    };
}

function renderImportFence(props: {
    path: string;
    maxBytes?: number;
    truncated: boolean;
    text: string;
}): string {
    return [
        props.truncated ? `[Import truncated: ${props.path} maxBytes=${props.maxBytes}]` : "",
        `\`\`\`${props.path}`,
        props.text.trim(),
        "```",
    ].filter((line) => line !== "").join("\n");
}

async function renderStringChildren(state: CompileState, zone: RenderZone, children: ProfileDslChild[]): Promise<string> {
    const parts: string[] = [];
    const visit = async (child: ProfileDslChild): Promise<void> => {
        if (child === null || child === undefined || child === false || child === true) {
            return;
        }
        if (Array.isArray(child)) {
            for (const item of child) {
                await visit(item);
            }
            return;
        }
        if (typeof child === "string" || typeof child === "number") {
            parts.push(String(child));
            return;
        }
        if (child.kind === "Fragment") {
            for (const item of child.children) {
                await visit(item);
            }
            return;
        }
        if (child.kind === "If") {
            if (!child.condition) {
                return;
            }
            for (const item of child.children) {
                await visit(item);
            }
            return;
        }
        if (child.kind === "StringFragment") {
            const text = typeof child.text === "function" ? await child.text(state.context) : child.text;
            // 只登记真正产出内容的具名 fragment：空 Import / 空 catalog 不该在面板里占一行。
            if (child.label && text.trim()) {
                state.pendingLabels.push(child.label);
            }
            parts.push(text);
            return;
        }
        if (child.kind === "ModeSlot") {
            throw new Error(`ModeSlot kind="${child.slot}" 只能作为 ModeReminder 的直接子节点。`);
        }
        if (child.kind === "ToolCall" && zone === "assistant") {
            return;
        }
        throw new Error(`${child.kind} 不能放在 string 内容节点内。`);
    };
    for (const child of children) {
        await visit(child);
    }
    return parts.join("").trim();
}

async function renderStandaloneString(context: ProfilePrepareContext<any>, children: ProfileDslChild[]): Promise<string> {
    const state: CompileState = {
        context,
        profileKey: context.session.profileKey,
        currentRuntimeState: {},
        nextRuntimeState: {},
        stateTouched: false,
        currentTurn: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
        pendingToolCallIds: [],
        plan: {},
        // 独立子渲染用一次性归因态：内嵌 fragment 的标签随之丢弃。
        // 这是有意的——调用方（如 SystemReminder）自身的标签已经代表整块内容，
        // 再把内部标签冒泡上去会让面板出现重复且无法定位的条目。
        ...emptyLabelState(),
    };
    return renderStringChildren(state, "message", children);
}

/**
 * 将 SDK artifact 中的宿主能力描述符转换为本进程实现。
 * 这里是 DSL 宿主能力的唯一 materialize seam。
 */
function materializeProfileBuiltinNode(node: ProfileBuiltinNode): Exclude<ProfileDslNode, ProfileBuiltinNode> {
    switch (node.name) {
        case "SkillCatalog": return SkillCatalog(node.props);
        case "AgentCatalog": return AgentCatalog(node.props);
        case "WorkflowCatalog": return WorkflowCatalog(node.props);
        case "ActivatedSkills": return ActivatedSkills(node.props);
        case "SqlSchemaSummary": return SqlSchemaSummary(node.props);
        case "Import": return Import(node.props);
        case "SystemReminder": return SystemReminder(node.props);
        case "LinkedAgentsSummary": return LinkedAgentsSummary(node.props);
        case "MentionedSkillsReminder": return MentionedSkillsReminder(node.props);
        case "LinkedAgentsReminder": return LinkedAgentsReminder(node.props);
        case "WorkspaceFocusReminder": return WorkspaceFocusReminder(node.props);
        case "ModeAvailabilityReminder": return ModeAvailabilityReminder(node.props);
        case "TaskReminder": return TaskReminder(node.props);
        case "ModeReminder": return ModeReminder(node.props);
    }
}

/** 递归 materialize 一个 SDK DSL 节点，并在宿主侧执行结构校验。 */
function materializeProfileDslNode(node: ProfileDslNode): Exclude<ProfileDslNode, ProfileBuiltinNode> {
    const concrete = node.kind === "ProfileBuiltin" ? materializeProfileBuiltinNode(node) : node;
    if (concrete.kind === "Message" && concrete.role === "system") {
        throw new Error("<Message role=\"system\"> 不被支持，请使用 <System> 或 <AppendingSet><Message>。");
    }
    if (
        concrete.kind === "ProfilePrompt"
        || concrete.kind === "System"
        || concrete.kind === "HistorySet"
        || concrete.kind === "ModelContext"
        || concrete.kind === "AppendingSet"
        || concrete.kind === "Message"
        || concrete.kind === "AIMessage"
        || concrete.kind === "ToolResult"
        || concrete.kind === "Reminder"
        || concrete.kind === "Watch"
        || concrete.kind === "If"
        || concrete.kind === "ModeSlot"
        || concrete.kind === "Fragment"
    ) {
        return {
            ...concrete,
            children: normalizeChildren(concrete.children),
        };
    }
    return concrete;
}

/** 递归 materialize 动态 render 返回的 DSL child。 */
function materializeProfileDslChild(child: ProfileDslChild): ProfileDslChild {
    if (Array.isArray(child)) return child.map(materializeProfileDslChild);
    if (child && typeof child === "object") return materializeProfileDslNode(child);
    return child;
}

function normalizeChildren(children: ProfileDslChild | ProfileDslChild[] | undefined): ProfileDslChild[] {
    if (children === undefined) {
        return [];
    }
    const values = Array.isArray(children) ? children : [children];
    return values.map(materializeProfileDslChild);
}

function flattenChildren(child: ProfileDslChild): ProfileDslChild[] {
    if (child === null || child === undefined || child === false || child === true) {
        return [];
    }
    if (Array.isArray(child)) {
        return child.flatMap(flattenChildren);
    }
    return [child];
}

function onlyMessages(messages: StoredAgentMessage[], label: string): StoredAgentMessage[] {
    return messages.filter((message): message is StoredAgentMessage => {
        if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
            return true;
        }
        throw new Error(`${label} 只能产出 user/assistant/toolResult message。`);
    });
}

function onlyNonEmptyMessage(message: StoredAgentMessage): StoredAgentMessage[] {
    if (message.role === "toolResult") {
        return [message];
    }
    if (message.role === "assistant") {
        const hasContent = message.content.some((block) => {
            return block.type !== "text" || block.text.trim().length > 0;
        });
        return hasContent ? [message] : [];
    }
    return storedMessageText(message).trim() ? [message] : [];
}

function assertZone(current: RenderZone, expected: RenderZone, message: string): void {
    if (current !== expected) {
        throw new Error(message);
    }
}

function countUserTurns(messages: StoredAgentMessage[]): number {
    // runtime.promptUserTurnCount 由 harness 在挂起用户消息前计算；这里保留 session 回退，方便脚本直接调用 profile.prepare。
    return messages.filter((message) => {
        return message.role === "user";
    }).length;
}

function assertAllowedWatchPath(path: string | undefined, label: string): void {
    if (!path) {
        return;
    }
    if (!["client", "global", "project", "session"].some((prefix) => path === prefix || path.startsWith(`${prefix}.`))) {
        throw new Error(`${label} 字符串形式只能从 client、global、project、session 变量路径开始；非变量上下文请使用函数 watch：${path}`);
    }
}

async function readPath(context: ProfilePrepareContext<any>, path: string): Promise<JsonValue | undefined> {
    return context.vars.get(path);
}

function toJsonValue(value: unknown): JsonValue | undefined {
    if (value === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function stableStringifyJsonValue(value: JsonValue | undefined): string {
    if (value === undefined) {
        return "__undefined__";
    }
    return JSON.stringify(sortJson(value));
}

function sortJson(value: JsonValue): JsonValue {
    if (Array.isArray(value)) {
        return value.map(sortJson);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
    }
    return value;
}

function cloneProfileRuntimeState(state: ProfileRuntimeState): ProfileRuntimeState {
    return {
        reminders: state.reminders ? {...state.reminders} : undefined,
        watches: state.watches ? {...state.watches} : undefined,
    };
}

function readProfileRuntimeState(value: JsonValue | undefined): ProfileRuntimeState {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const state = value as Record<string, JsonValue>;
    return {
        reminders: readReminderStateMap(state.reminders),
        watches: readWatchStateMap(state.watches),
    };
}

function validateProfileRuntimeStateWrite(profileKey: string, value: JsonValue): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`profile ${profileKey} stateWrites 的 profile runtime state 必须是 object。`);
    }
    const state = value as Record<string, JsonValue>;
    const illegalKey = Object.keys(state).find((key) => key !== "reminders" && key !== "watches");
    if (illegalKey) {
        throw new Error(`profile ${profileKey} stateWrites 的 profile runtime state 不允许写 ${illegalKey}。`);
    }
    assertOptionalStateMap(profileKey, state.reminders, "reminders");
    assertOptionalStateMap(profileKey, state.watches, "watches");
    readReminderStateMap(state.reminders);
    readWatchStateMap(state.watches);
}

function assertOptionalStateMap(profileKey: string, value: JsonValue | undefined, key: "reminders" | "watches"): void {
    if (value === undefined) {
        return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`profile ${profileKey} stateWrites 的 ${key} 必须是 object map。`);
    }
}

function readReminderStateMap(value: JsonValue | undefined): Record<string, ReminderState> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const reminders: Record<string, ReminderState> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!item || typeof item !== "object" || Array.isArray(item) || (item.injectedAtTurn !== undefined && typeof item.injectedAtTurn !== "number")) {
            throw new Error(`profile runtime reminder state 非法：${key}`);
        }
        reminders[key] = {
            hasValue: typeof item.hasValue === "boolean" ? item.hasValue : false,
            value: item.value ?? null,
            fingerprint: typeof item.fingerprint === "string" ? item.fingerprint : undefined,
            injectedAtTurn: typeof item.injectedAtTurn === "number" ? item.injectedAtTurn : undefined,
        };
    }
    return reminders;
}

function readWatchStateMap(value: JsonValue | undefined): Record<string, WatchState> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const watches: Record<string, WatchState> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.hasValue !== "boolean" || typeof item.fingerprint !== "string") {
            throw new Error(`profile runtime watch state 非法：${key}`);
        }
        watches[key] = {
            hasValue: item.hasValue,
            value: item.value ?? null,
            fingerprint: item.fingerprint,
        };
    }
    return watches;
}

function renderAgentCatalogIndexItem(profile: AgentCatalogItem): string {
    const lines = [
        `- key: ${profile.key}`,
        `  name: ${profile.name}`,
        profile.description ? `  description: ${profile.description}` : "",
        profile.source ? `  source: ${profile.source}` : "",
        `  creation: ${profile.creationMode}`,
    ].filter(Boolean);
    return lines.join("\n");
}

export function renderSchemaSummary(schema: unknown): string {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return "- type: unknown";
    }
    const record = schema as Record<string, unknown>;
    if (record.type === "object" && record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)) {
        const required = new Set(Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === "string") : []);
        const properties = Object.entries(record.properties as Record<string, unknown>);
        if (properties.length === 0) {
            return "- no fields";
        }
        return properties.map(([key, value]) => {
            const field = readSchemaField(value);
            return [
                `- ${key}: ${required.has(key) ? "required" : "optional"} ${field.type}`,
                field.description ? ` - ${field.description}` : "",
            ].join("");
        }).join("\n");
    }
    if (record.type === "array") {
        const item = readSchemaField(record.items);
        const description = typeof record.description === "string" ? ` - ${record.description}` : "";
        return `- array<${item.type}>${description}`;
    }
    const field = readSchemaField(record);
    return `- ${field.type}${field.description ? ` - ${field.description}` : ""}`;
}

function readSchemaField(schema: unknown): {type: string; description?: string} {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return {type: "unknown"};
    }
    const record = schema as Record<string, unknown>;
    const description = typeof record.description === "string" ? record.description : undefined;
    if (typeof record.type === "string") {
        return {
            type: schemaTypeText(record),
            description,
        };
    }
    if (Array.isArray(record.anyOf)) {
        return {
            type: record.anyOf.map((item) => readSchemaField(item).type).join(" | "),
            description,
        };
    }
    if (Array.isArray(record.oneOf)) {
        return {
            type: record.oneOf.map((item) => readSchemaField(item).type).join(" | "),
            description,
        };
    }
    return {
        type: "unknown",
        description,
    };
}

function schemaTypeText(schema: Record<string, unknown>): string {
    if (schema.type === "array") {
        return `array<${readSchemaField(schema.items).type}>`;
    }
    if (schema.type === "object") {
        return "object";
    }
    return String(schema.type);
}

function systemReminder(body: string): string {
    return [
        "<system-reminder>",
        body.trim(),
        "</system-reminder>",
    ].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

async function readCurrentProjectWorkspace(ctx: ProfilePrepareContext<any>): Promise<string> {
    const value = ctx.invocation?.clientState?.studio?.workspace;
    const projectWorkspace = typeof value === "string" && value.trim()
        ? value
        : ctx.session.currentProject ? `workspace/${ctx.session.currentProject.workspace.ref.projectRoot}` : "";
    return projectWorkspace ? normalizeDisplayPath(projectWorkspace) : "";
}

async function readWorkspaceFocus(ctx: ProfilePrepareContext<any>): Promise<JsonValue> {
    const selectedFilePath = ctx.invocation?.clientState?.studio?.selectedFilePath;
    return {
        currentProjectWorkspace: await readCurrentProjectWorkspace(ctx),
        selectedFilePath: typeof selectedFilePath === "string" && selectedFilePath.trim() ? normalizeDisplayPath(selectedFilePath) : null,
    };
}

function readWorkspaceFocusState(value: JsonValue | undefined): {currentProjectWorkspace: string; selectedFilePath: string | null} {
    const record = readRecord(value);
    return {
        currentProjectWorkspace: typeof record.currentProjectWorkspace === "string" ? record.currentProjectWorkspace : "",
        selectedFilePath: typeof record.selectedFilePath === "string" && record.selectedFilePath.trim() ? record.selectedFilePath : null,
    };
}

function normalizeDisplayPath(value: string): string {
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
    const relativeToRepo = relative(process.cwd(), value).replace(/\\/g, "/");
    if (relativeToRepo && !relativeToRepo.startsWith("..") && !relativeToRepo.startsWith("/")) {
        return relativeToRepo.replace(/\/+$/g, "");
    }
    return normalized;
}

function projectRootFromWorkspace(projectWorkspace: string): string {
    const normalized = projectWorkspace.replace(/\\/g, "/").replace(/\/+$/g, "");
    return normalized.startsWith("workspace/") ? normalized.slice("workspace/".length) : normalized;
}

function renderSelectedWorkspaceFile(projectRoot: string, selectedFilePath: string | null): string {
    if (!selectedFilePath) {
        return "none";
    }
    const normalized = selectedFilePath.replace(/\\/g, "/").replace(/^\/+/g, "").replace(/\/+$/g, "");
    if (!projectRoot) {
        return normalized;
    }
    if (normalized === projectRoot) {
        return ".";
    }
    if (normalized.startsWith(`${projectRoot}/`)) {
        return normalized.slice(projectRoot.length + 1);
    }
    if (normalized.startsWith("workspace/")) {
        const withoutWorkspace = normalized.slice("workspace/".length);
        if (withoutWorkspace === projectRoot) {
            return ".";
        }
        return withoutWorkspace.startsWith(`${projectRoot}/`)
            ? withoutWorkspace.slice(projectRoot.length + 1)
            : normalized;
    }
    if (/^(manuscript|lorebook|reference|upload|simulation|\.nbook)(\/|$)/.test(normalized)) {
        return normalized;
    }
    return normalized;
}

function linkedAgentsSummaryText(session: NeuroSessionContext): string {
    if (session.linkedAgents.length === 0) {
        return "";
    }
    return `Linked agents:\n${linkedAgentItemsText(session)}`;
}

/** Repo/Application Root import 只服务静态 AGENTS/docs；系统资产与 Reference 始终从发布根解析。 */
function resolveApplicationImportPath(importPath: string): string {
    const applicationRoot = resolveApplicationRootForImport();
    const isReferenceImport = importPath.startsWith("reference/");
    const isSystemAssetImport = importPath.startsWith("assets/workspace/.nbook/");
    const baseRoot = isReferenceImport
        ? resolveSystemReferenceRoot(applicationRoot)
        : isSystemAssetImport
            ? resolveSystemNbookRoot(applicationRoot)
            : resolveRepositoryRootForImport();
    const relativeImportPath = isReferenceImport
        ? importPath.slice("reference/".length)
        : isSystemAssetImport
            ? importPath.slice("assets/workspace/.nbook/".length)
            : importPath;
    const target = resolve(baseRoot, relativeImportPath);
    if (relative(baseRoot, target).split(/[\\/]/u).includes("..")) throw new Error(`Import.path 解析后越界：${importPath}`);
    return target;
}

function resolveApplicationRootForImport(): string {
    return resolve(resolveApplicationRoot());
}

function resolveRepositoryRootForImport(): string {
    const configuredRepositoryRoot = process.env.NEURO_BOOK_REPOSITORY_ROOT?.trim();
    if (!configuredRepositoryRoot) {
        throw new Error("Import.path 缺少显式 NEURO_BOOK_REPOSITORY_ROOT。Product Runtime 不允许从 checkout 或 import.meta.dirname 推断仓库根。");
    }
    return resolve(configuredRepositoryRoot);
}

/** 已关联 agent 列表正文；标题由具体消费方决定。 */
function linkedAgentItemsText(session: NeuroSessionContext): string {
    return session.linkedAgents
        .map((agent) => `- session ${agent.sessionId}: ${agent.profileKey}`)
        .join("\n");
}

function readTaskList(ctx: ProfilePrepareContext<any>, stateKey = AGENT_TASKS_STATE_KEY): {
    title?: string;
    steps: Array<{id: string; text: string; status: string; note?: string}>;
} | null {
    const value = ctx.session.customState[stateKey];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.steps)) {
        return null;
    }
    return {
        title: typeof record.title === "string" ? record.title : undefined,
        steps: record.steps.flatMap((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return [];
            }
            const step = item as Record<string, unknown>;
            if (typeof step.id !== "string" || typeof step.text !== "string" || typeof step.status !== "string") {
                return [];
            }
            return [{
                id: step.id,
                text: step.text,
                status: step.status,
                note: typeof step.note === "string" ? step.note : undefined,
            }];
        }),
    };
}

function LinkedAgentsReminderText(): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: (ctx) => {
            const items = linkedAgentItemsText(ctx.session);
            return items ? systemReminder(`Current linked agents:\n${items}`) : "";
        },
    };
}

function TaskReminderText(props: {stateKey: string}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: (ctx) => {
            const taskList = readTaskList(ctx, props.stateKey);
            if (!taskList) {
                return "";
            }
            const openSteps = taskList.steps.filter((step) => step.status !== "completed");
            if (openSteps.length === 0) {
                return "";
            }
            return systemReminder([
                taskList.title ? `Current task list: ${taskList.title}` : "Current task list:",
                ...openSteps.map((step) => `- [${step.status}] ${step.id}: ${step.text}${step.note ? ` (${step.note})` : ""}`),
                "Use task_set_status when you start or complete a step.",
            ].join("\n"));
        },
    };
}

function ModeReminderText(props: {stateKey: string; slots: Partial<Record<ModeSlotKind, ProfileDslChild[]>>; steadyOnly: boolean}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: async (ctx) => {
            const modeState = readRecord(ctx.session.customState[props.stateKey]);
            const mode = modeState.mode === "discuss" || modeState.mode === "plan" || modeState.mode === "normal"
                ? modeState.mode
                : ctx.session.agentMode;
            const phase = modeState.phase === "enter" || modeState.phase === "reentry" || modeState.phase === "exit" || modeState.phase === "steady"
                ? modeState.phase
                : "steady";
            const fromMode = modeState.fromMode === "discuss" || modeState.fromMode === "plan" || modeState.fromMode === "normal"
                ? modeState.fromMode
                : "normal";
            const toolDirectory = planModeToolDirectory({
                workspaceRoot: ctx.session.workspaceRoot,
                currentProject: ctx.session.currentProject,
            });
            // workDirectory是运行时投影，不信任旧session可能持久化的安装机绝对路径。
            // cwd切换后始终展示当前工具可直接使用的逻辑目录。
            const workDirectory = toolDirectory;
            // 周期重放只出 steady 档；状态变化按 phase 出全文
            const slotKind = resolveModeSlotKind(mode, props.steadyOnly ? "steady" : phase, fromMode);
            if (!slotKind) {
                return "";
            }
            const custom = props.slots[slotKind];
            if (custom) {
                return renderModeSlotText(ctx, custom, workDirectory);
            }
            return renderModeReminderText(slotKind, workDirectory, toolDirectory);
        },
    };
}

/**
 * mode × phase(× fromMode) → 插槽档位。normal 非 exit 阶段无 reminder（返回 null）。
 * mode 用穷尽 switch：未来给 AgentMode 新增模式时这里会编译报错，强制补全映射矩阵（Task 90）。
 */
function resolveModeSlotKind(mode: AgentMode, phase: "enter" | "reentry" | "exit" | "steady", fromMode: AgentMode): ModeSlotKind | null {
    switch (mode) {
        case "plan":
            return phase === "reentry" ? "plan_reentry" : phase === "steady" ? "plan_steady" : "plan_enter";
        case "discuss":
            return phase === "steady" ? "discuss_steady" : "discuss_enter";
        case "normal":
            return phase === "exit" ? (fromMode === "plan" ? "exit_from_plan" : "exit_plain") : null;
        default: {
            const exhaustive: never = mode;
            return exhaustive;
        }
    }
}

/**
 * Task 90 模式 reminder 默认文案矩阵。全文契约见 docs/tasks/90-agent-mode-system/README.md 4.6。
 */
function renderModeReminderText(kind: ModeSlotKind, workDirectory: string, toolDirectory: string): string {
    if (kind === "exit_from_plan") {
        return systemReminder([
            "## Left Plan Mode",
            "",
            "You are now in normal mode. You can make edits, run tools, and take actions.",
            `Implement the approved plan from the switch approval. If a Markdown plan file was shown from ${workDirectory}, treat that Project Workspace plan file as the implementation reference and read or cite only that file for details.`,
        ].join("\n"));
    }
    if (kind === "exit_plain") {
        return systemReminder([
            "## Left Discuss Mode",
            "",
            "You are now in normal mode. You can make edits, run tools, and take actions.",
            "Act on the conclusions agreed in the conversation. If scope was not settled during the discussion, confirm it with the user before large or risky changes.",
        ].join("\n"));
    }
    if (kind === "plan_steady") {
        return systemReminder([
            "Plan mode is still active (full instructions appeared earlier in this conversation).",
            `- Read-only except Markdown work files under ${workDirectory}. File write tools targeting other paths will pause for user approval; bash stays read-only inspection, and state-changing tools (execute_sql / execute_world / plot save_*) stay read-only.`,
            `- Write or edit plan files via ${toolDirectory}/<slug>.md. For switch_mode to normal, pass planFilePath as .agent/plan/<slug>.md so the approval UI can preview the Project Workspace file.`,
            "- Do not create or invoke Explore agents.",
            "- Keep the user informed in chat: summarize important findings, unresolved decisions, and the current plan direction.",
            "- Do not put scratch/cache/command-output drafts under Project Workspace .agent; use the system temp directory for temporary files.",
            "- If an unresolved decision materially changes the plan, use request_user_input before switching.",
            "- Do not start implementing. Call switch_mode with targetMode \"normal\" when the plan is ready for approval; never ask for plan approval via plain text or request_user_input.",
        ].join("\n"));
    }
    if (kind === "discuss_enter") {
        return systemReminder([
            "Discuss mode is active. The user wants a read-only discussion: analysis, answers, options, and recommendations — not execution.",
            "",
            "## Mode Constraints",
            "",
            "- Read-only exploration is allowed and encouraged: read files, search, and run read-only commands to ground your answers in the real project.",
            "- File write tools will pause and ask the user for approval before executing. Do not attempt writes unless the user explicitly asks for a specific change mid-discussion; prefer describing what you would change and where.",
            "- bash is for read-only inspection only. Never write files through shell redirection or scripts.",
            "- Do not change project state through non-file tools either: no execute_sql INSERT/UPDATE/DELETE, no execute_world slice writes or patches, and no plot save_* tools. Keep these to read-only use (SELECT queries, world reads, and get_* lookups) and request writes via switch_mode to normal.",
            "- Do not create or invoke Explore agents. Work locally with read/search tools.",
            "",
            "## How to Work in Discuss Mode",
            "",
            "- Focus on the conversation: answer questions, compare options with tradeoffs, point out risks, and give concrete recommendations.",
            "- Ground claims in evidence: cite file paths and actual content you inspected rather than guessing.",
            "- This is not plan mode: do not produce .agent/plan files or push toward an implementation plan unless the user asks for one.",
            "- If a plan draft already exists from earlier planning, treat it as discussion material: clarify and challenge it with the user instead of implementing it.",
            "- When the discussion converges and the user wants action, call switch_mode with targetMode \"normal\" to start executing, or \"plan\" if the task first needs a written plan. The switch takes effect only after user approval.",
        ].join("\n"));
    }
    if (kind === "discuss_steady") {
        return systemReminder([
            "Discuss mode is still active (full instructions appeared earlier in this conversation).",
            "Stay read-only: discuss, analyze, and recommend. File write tools pause for user approval; bash and state-changing tools (execute_sql / execute_world / plot save_*) stay read-only.",
            "Do not start implementing or producing plan files. When the user wants execution, request it via switch_mode.",
        ].join("\n"));
    }
    const reentry = kind === "plan_reentry"
        ? [
            "## Re-entering Plan Mode",
            "",
            `You are returning to plan mode after previously leaving it. Before proceeding, inspect the latest chat context and any relevant Markdown plan file under ${workDirectory} when available. Revise the visible plan in chat and update the plan file when the task still requires an implementation plan.`,
            "",
        ].join("\n")
        : "";
    return systemReminder([
        reentry,
        "Plan mode is active. The user wants a plan before execution, not execution itself.",
        "",
        "## Mode Constraints",
        "",
        "- Read-only exploration is allowed and encouraged: read files, search, and run read-only commands.",
        `- The only directly writable location is Markdown files under ${workDirectory}. File write tools targeting any other path will pause and ask the user for approval; do not attempt such writes unless the user explicitly asks for a specific change mid-planning.`,
        "- bash is for read-only inspection only. Never write files through shell redirection or scripts; use file tools so the mode rules apply.",
        "- Do not change project state through non-file tools either: no execute_sql INSERT/UPDATE/DELETE, no execute_world slice writes or patches, and no plot save_* tools. Keep these to read-only use (SELECT queries, world reads, and get_* lookups) and request writes via switch_mode to normal.",
        "- Do not create or invoke Explore agents. Work locally with read/search tools.",
        "- Tests or commands are allowed only when they are read-only enough to refine the plan and do not update tracked files.",
        "- If the user asks you to implement while plan mode is active, keep planning instead. Explain that implementation starts after switching to normal mode through switch_mode once the plan is ready.",
        "- Do not work silently for long stretches. After meaningful exploration, report concise findings and the current direction in chat.",
        "",
        "## Plan Work Directory",
        "",
        `- The Project Workspace plan directory is ${workDirectory}. It can contain plan files, walkthrough files, or research notes for this project.`,
        `- File tools and bash use the current Project Workspace as cwd. Write plan files via ${toolDirectory}/<slug>.md. The switch_mode planFilePath argument uses the same Project-relative path, so the approval UI can preview the file.`,
        "- No file is bound when entering plan mode. Choose a short readable Markdown file name when the task needs persisted planning or walkthrough notes. Do not create files just for formality for small non-editing tasks.",
        "- If a relevant Markdown file already exists in this exact plan directory, you can read it and make incremental edits using read and edit.",
        "- Do not put scratch/cache/command-output drafts under Project Workspace .agent; use the system temp directory for temporary files.",
        "- Build the plan visibly in chat as you learn and keep any Markdown work file aligned when one is used. Do not hide important decisions only in a file.",
        "",
        "## Workflow",
        "",
        "1. If the preceding conversation already worked through this task (for example in discuss mode), consolidate the agreed conclusions into the plan before new exploration.",
        "2. Ground in the real repository with read-only exploration: inspect relevant files, schemas, tools, tests, and existing patterns.",
        "3. Report what you learned in chat when it changes the plan, including unresolved decisions and the next intended step.",
        "4. Ask the user via request_user_input only when an unresolved decision cannot be discovered from the repo and materially changes the implementation.",
        `5. Present a concise execution-ready plan in chat. For non-trivial implementation work, also write or update a readable Markdown plan, walkthrough, or research note under ${workDirectory}; the file name is your choice and the system will not generate a random slug.`,
        "6. Before requesting the switch, briefly report the plan status in chat and cite the Markdown file path when you wrote one. If you skip the file because the task is only a small non-editing task, say that briefly before requesting approval.",
        "7. Call switch_mode with targetMode \"normal\" when the plan is complete and ready for approval. When a plan file exists, pass planFilePath like .agent/plan/<slug>.md so the approval UI displays that Project Workspace file. Never ask for plan approval via plain text or request_user_input; switch_mode is the approval request.",
        "8. After approval, implement from the approved chat plan or the approved Markdown plan file shown during the switch approval.",
        "",
        "The user explicitly requested no Explore agent for this project.",
    ].join("\n"));
}

async function renderModeSlotText(ctx: ProfilePrepareContext<any>, children: ProfileDslChild[], workDirectory: string): Promise<string> {
    const body = await renderStandaloneString(ctx, [
        `Thread work directory: ${workDirectory}\n`,
        ...children,
    ]);
    return body.trim() ? systemReminder(body) : "";
}

function mentionedSkillsReminderText(ctx: ProfilePrepareContext<any>): string {
    const latestUser = ctx.runtime?.pendingUserMessage
        ?? [...ctx.session.messages].reverse().find((message) => message.role === "user");
    if (!latestUser || latestUser.role !== "user") {
        return "";
    }
    const text = storedMessageText(latestUser);
    const names = [...text.matchAll(/\$([^\s$]+)/gu)].map((match) => match[1]).filter(Boolean);
    if (names.length === 0) {
        return "";
    }
    return systemReminder([
        `The user explicitly mentioned skill(s): ${names.map((name) => `$${name}`).join(", ")}.`,
        "If these skills are visible in the catalog, read the matching SKILL.md location from SkillCatalog before continuing.",
        "Use the original skill key exactly. Do not translate it into English, pinyin, or a new slug.",
    ].join("\n"));
}

function indentLines(text: string, spaces: number): string {
    const prefix = " ".repeat(spaces);
    return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function displaySkillLocation(skillPath: string): string {
    return resolve(skillPath);
}

async function defaultSkillCatalogText(ctx: ProfilePrepareContext<any>, mode: "workspace" | "userAssets" = "workspace"): Promise<string> {
    if (ctx.skills.length === 0) {
        return "";
    }
    const skillLines = ctx.skills
        .map((skillItem) => [
            `- key: ${skillItem.key}`,
            `  name: ${skillItem.name}`,
            `  description: ${skillItem.description ?? skillItem.key}`,
            skillItem.whenToUse ? `  when_to_use: ${skillItem.whenToUse}` : "",
            skillItem.version ? `  version: ${skillItem.version}` : "",
            `  root: ${displaySkillLocation(skillItem.rootPath)}`,
            `  location: ${displaySkillLocation(skillItem.skillPath)}`,
        ].filter(Boolean).join("\n"))
        .join("\n\n");
    return [
        "<system-reminder>",
        "## Skill",
        "",
        "Skills are reusable work methods. They are not long-term memory and they are not mandatory for every turn.",
        "",
        // userAssets：cwd 已经是 Workspace Root .nbook，用 cwd 相对视角描述 skill roots。
        mode === "userAssets"
            ? "- Skill roots: agent/skills/ overrides assets/workspace/.nbook/agent/skills/."
            : "- Skill roots: workspace/.nbook/agent/skills/ overrides assets/workspace/.nbook/agent/skills/.",
        "- User assets override system assets by whole skill directory, not by merging individual files.",
        "- There is no separate skill tool. To use a skill, read the SKILL.md file at the catalog location.",
        "- Read SKILL.md first as the entry card; if it references relative files such as references, scripts, templates, or examples, read only the needed files under the same skill directory.",
        "- Skill keys may be Chinese. Use the original key from the catalog exactly; do not translate, romanize, or invent a slug.",
        "- If the user explicitly types $skill-key, or the task clearly matches a catalog description, read the matching SKILL.md before continuing.",
        "- You may proactively choose a skill when it is likely to materially improve the turn, even if the user did not mention it.",
        "- Do not read skills merely for formality; use the catalog description and when_to_use to keep selection focused.",
        // userAssets：Lorebook/Plot 归属行对用户资产 agent 不适用，换成长期资产的对应纪律。
        mode === "userAssets"
            ? "- A skill guides this turn only. Do not hard-code temporary conversation preferences into long-term profiles or skill files unless the user explicitly asks."
            : "- A skill guides this turn only. Stable world facts belong in Lorebook, plot progress belongs in Plot System, and temporary plans stay in the conversation.",
        "- If a skill conflicts with the user's goal, prioritize the user's goal; ask one minimal clarification only when the conflict materially changes the result.",
        "- After using a skill, the final response should report key output and necessary verification, not repeat the full skill content.",
        "",
        "## Available Skills",
        "",
        skillLines,
        "</system-reminder>",
    ].join("\n");
}

async function defaultAgentCatalogText(ctx: ProfilePrepareContext<any>): Promise<string> {
    const profiles = ctx.catalog.profiles
        .filter((profile) => profile.loadStatus === "loaded" && profile.creationMode === "public")
        .map(renderAgentCatalogIndexItem);
    if (profiles.length === 0) {
        return "";
    }
    return [
        "<system-reminder>",
        "## Available Agents",
        "",
        "These public agent profiles are currently available through create_agent / invoke_agent.",
        "This catalog is only an index. Before creating or invoking an unfamiliar profile, call get_agent_profile({ profileKey }) to inspect InitialSchema, PayloadSchema, OutputSchema, and profile root tools.",
        "",
        ...profiles,
        "</system-reminder>",
    ].join("\n");
}

async function defaultWorkflowCatalogText(ctx: ProfilePrepareContext<any>): Promise<string> {
    const workflows = ctx.workflows ?? [];
    const visibleModels = ctx.agentVisibleModels ?? [];
    if (workflows.length === 0 && visibleModels.length === 0) {
        return "";
    }
    const workflowLines = workflows
        .map((item) => [
            `- key: ${item.key}`,
            `  title: ${item.title}`,
            item.description ? `  description: ${item.description}` : "",
            item.whenToUse ? `  when_to_use: ${item.whenToUse}` : "",
        ].filter(Boolean).join("\n"))
        .join("\n\n");
    const modelLines = visibleModels.map((item) => `- ${item.modelKey}${item.note ? ` —— ${item.note}` : ""}`);
    return [
        "<system-reminder>",
        "## Workflows",
        "",
        "Workflows orchestrate multiple agent sessions as a durable script (parallel fan-out, review loops, human checkpoints, live state chart). They are heavier than a single sub-agent call; use one when the task genuinely needs multi-agent structure or the user asks for it.",
        "",
        "- Run a catalog workflow with run_workflow({ workflowKey, args }); list details with list_workflows.",
        "- run_workflow is non-blocking by default: it registers a background job and returns a jobId immediately. Finish your current reply normally; when the workflow completes, its result card arrives as a new message in this session. Do NOT poll or busy-wait for it. Pass wait: true only for short runs whose result you need within the same reply.",
        "- Background jobs (workflows, background invoke_agent / bash) are managed with list_jobs / get_job / cancel_job. After starting one, do not call list_jobs or get_job merely to wait. Use them only when the user explicitly asks for status, a follow-up result was truncated and you need the full result, or you need to cancel an obsolete job.",
        "- You may also write an ad-hoc workflow and pass it as run_workflow({ script }). Before writing one, read reference/agent/workflow/README.md and reference/agent/workflow/authoring.md. Before designing wf.chart output, also read reference/agent/workflow/chart.md so the run stays visible to the user.",
        "- Every run_workflow call requires user approval; the user watches progress in the workflow panel, so keep args and script self-explanatory.",
        "- The Agent-visible Models list below is the sole allowlist for both run_workflow({ model }) and invoke_agent({ model }). list_workflows can refresh the same resolved list; job management tools do not provide a separate model list.",
        "- Need a one-off helper agent without a profile file? Create profileKey \"adhoc\" with initial = { name?, systemPrompt, outputSchema? }. For direct use, create_agent first, then invoke_agent({ sessionId, model, ... }); for workflows use wf.agents.create(\"adhoc\", { initial, model, ephemeral: true }). Any model must come from the same Agent-visible Models list. outputSchema (a JSON Schema object) makes report_result.data required and structurally validated.",
        "- Workflow keys may be Chinese. Use the original key from the catalog exactly.",
        "",
        "## Agent-visible Models",
        "",
        "为子 agent / workflow 指定模型时只能从下列清单中选择：",
        ...modelLines,
        "",
        "## Available Workflows",
        "",
        workflowLines,
        "</system-reminder>",
    ].join("\n");
}

async function defaultActivatedSkillsText(ctx: ProfilePrepareContext<any>): Promise<string> {
    const latestUser = ctx.runtime?.pendingUserMessage
        ?? [...ctx.session.messages].reverse().find((message) => message.role === "user");
    const text = latestUser && latestUser.role === "user" ? storedMessageText(latestUser) : "";
    const skillNames = [...text.matchAll(/\$([^\s$]+)/gu)].map((match) => match[1]).filter(Boolean);
    if (skillNames.length === 0) {
        return "";
    }
    return systemReminder([
        `The user explicitly mentioned skill(s): ${skillNames.map((name) => `$${name}`).join(", ")}.`,
        "If each mentioned skill is visible in SkillCatalog, read the matching SKILL.md location before continuing.",
        "If a mentioned skill is not visible in the catalog, say that directly and continue with the best fallback.",
    ].join("\n"));
}

async function defaultSqlSchemaSummaryText(ctx: ProfilePrepareContext<any>): Promise<string> {
    try {
        // SQL schema 摘要经宿主注入获得；artifact 依赖图不允许携带 project-session / @libsql。
        const sqlSchemaSummary = ctx.runtime?.sqlSchemaSummary;
        if (!sqlSchemaSummary) {
            throw new Error("当前运行环境没有注入 SQL schema 摘要");
        }
        return [
            "<sql-schema-summary>",
            "Target database is current Project Workspace .nbook/project.sqlite. App SQLite is not accessible from execute_sql.",
            "Double-quote business tables with uppercase letters and camelCase columns, e.g. \"createdAt\", \"sortOrder\".",
            await sqlSchemaSummary(),
            "</sql-schema-summary>",
        ].join("\n");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ["<sql-schema-summary>", `SQL schema summary 暂不可用：${message}`, "</sql-schema-summary>"].join("\n");
    }
}
