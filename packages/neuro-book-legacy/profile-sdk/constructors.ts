import type {
    ModeSlotKind,
    ProfileBuiltinNode,
    ProfileDslChild,
    ProfileFileChangeNoticeNode,
    ProfileFragmentNode,
    ProfileIfNode,
    ProfileImportProps,
    ProfileJsonValue,
    ProfileMessageNode,
    ProfileModeSlotNode,
    ProfilePrepareContext,
    ProfilePromptNode,
    ProfileReminderNode,
    ProfileSetNode,
    ProfileToolCallNode,
    ProfileWatchNode,
    ReminderChange,
    WatchChange,
} from "nbook/profile-sdk/contracts";

type ChildrenProps = {children?: ProfileDslChild | ProfileDslChild[]};
type DynamicText = string | ((ctx: ProfilePrepareContext) => string | Promise<string>);

/** 将可选单个 child 规范为稳定数组，不执行任何宿主逻辑。 */
function children(value: ProfileDslChild | ProfileDslChild[] | undefined): ProfileDslChild[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

/** 定义 ProfilePrompt 根节点。 */
export function ProfilePrompt(props: ChildrenProps): ProfilePromptNode {
    return {kind: "ProfilePrompt", children: children(props.children)};
}

/** 定义 Provider system prompt 分区。 */
export function System(props: ChildrenProps): ProfileSetNode {
    return {kind: "System", children: children(props.children)};
}

/** 定义空会话首轮历史分区。 */
export function HistorySet(props: ChildrenProps): ProfileSetNode {
    return {kind: "HistorySet", children: children(props.children)};
}

/** 定义只供本轮模型消费的上下文分区。 */
export function ModelContext(props: ChildrenProps): ProfileSetNode {
    return {kind: "ModelContext", children: children(props.children)};
}

/** 定义本轮写入 Session 的附加消息分区。 */
export function AppendingSet(props: ChildrenProps): ProfileSetNode {
    return {kind: "AppendingSet", children: children(props.children)};
}

/** 声明 Profile 的文件变更提醒模式。 */
export function FileChangeNotice(props: {mode: "off" | "minimal" | "full"}): ProfileFileChangeNoticeNode {
    return {kind: "FileChangeNotice", mode: props.mode};
}

/** 定义用户消息节点；role 合法性由宿主 materializer 校验。 */
export function Message(props: {role?: "user" | "system"; children?: ProfileDslChild | ProfileDslChild[]}): ProfileMessageNode {
    return {kind: "Message", role: props.role ?? "user", children: children(props.children)};
}

/** 定义 Assistant 示例消息节点。 */
export function AIMessage(props: ChildrenProps): ProfileMessageNode {
    return {kind: "AIMessage", role: "assistant", children: children(props.children)};
}

/** 定义 Assistant tool call 子节点。 */
export function ToolCall(props: {id: string; name: string; args?: {[key: string]: ProfileJsonValue}}): ProfileToolCallNode {
    return {kind: "ToolCall", id: props.id, name: props.name, args: props.args};
}

/** 定义工具结果示例消息节点。 */
export function ToolResult(props: {toolCallId: string; toolName: string; isError?: boolean; children?: ProfileDslChild | ProfileDslChild[]}): ProfileMessageNode {
    return {
        kind: "ToolResult",
        role: "toolResult",
        toolCallId: props.toolCallId,
        toolName: props.toolName,
        isError: props.isError,
        children: children(props.children),
    };
}

/** 定义按状态或周期注入的 Reminder。 */
export function Reminder(props: {
    id: string;
    when?: boolean;
    watchPath?: string;
    watchValue?: ProfileJsonValue;
    watch?: (ctx: ProfilePrepareContext) => ProfileJsonValue | undefined | Promise<ProfileJsonValue | undefined>;
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
        children: children(props.children),
    };
}

/** 定义上下文值变化观察节点。 */
export function Watch(props: {
    id?: string;
    path?: string;
    value?: ProfileJsonValue;
    render?: (change: WatchChange) => ProfileDslChild | Promise<ProfileDslChild>;
    children?: ProfileDslChild | ProfileDslChild[];
}): ProfileWatchNode {
    return {
        kind: "Watch",
        id: props.id,
        path: props.path,
        value: props.value,
        render: props.render,
        children: children(props.children),
    };
}

/** 定义条件渲染节点。 */
export function If(props: {condition?: boolean; children?: ProfileDslChild | ProfileDslChild[]}): ProfileIfNode {
    return {kind: "If", condition: props.condition ?? false, children: children(props.children)};
}

/** 声明 Skill catalog 宿主片段。 */
export function SkillCatalog(props: {mode?: "workspace" | "userAssets"; text?: DynamicText}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "SkillCatalog", props};
}

/** 声明 Agent catalog 宿主片段。 */
export function AgentCatalog(props: {text?: DynamicText}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "AgentCatalog", props};
}

/** 声明 Workflow catalog 宿主片段。 */
export function WorkflowCatalog(props: {text?: DynamicText}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "WorkflowCatalog", props};
}

/** 声明已激活 Skill 宿主片段。 */
export function ActivatedSkills(props: {text?: DynamicText}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "ActivatedSkills", props};
}

/** 声明 SQL schema 摘要宿主片段。 */
export function SqlSchemaSummary(props: {text?: DynamicText}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "SqlSchemaSummary", props};
}

/** 声明共享文本导入，实际文件读取由宿主执行。 */
export function Import(props: ProfileImportProps): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "Import", props};
}

/** 声明 system-reminder 宿主包装。 */
export function SystemReminder(props: ChildrenProps): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "SystemReminder", props};
}

/** 声明已关联 Agent 摘要。 */
export function LinkedAgentsSummary(props: {[key: string]: never} = {}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "LinkedAgentsSummary", props};
}

/** 声明已关联 Agent 变化提醒。 */
export function LinkedAgentsReminder(props: {id?: string; repeatEveryTurns?: number} = {}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "LinkedAgentsReminder", props};
}

/** 声明当前 Project Workspace 焦点提醒。 */
export function WorkspaceFocusReminder(props: {id?: string; repeatEveryTurns?: number} = {}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "WorkspaceFocusReminder", props};
}

/** 声明工作模式可用性提醒。 */
export function ModeAvailabilityReminder(props: {id?: string; repeatEveryTurns?: number} = {}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "ModeAvailabilityReminder", props};
}

/** 声明任务清单提醒。 */
export function TaskReminder(props: {id?: string; stateKey?: string; repeatEveryTurns?: number} = {}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "TaskReminder", props};
}

/** 声明工作模式生命周期提醒。 */
export function ModeReminder(props: {id?: string; stateKey?: string; repeatEveryTurns?: number; children?: ProfileDslChild | ProfileDslChild[]} = {}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "ModeReminder", props};
}

/** 声明用户显式提及 Skill 时的提醒。 */
export function MentionedSkillsReminder(props: {[key: string]: never} = {}): ProfileBuiltinNode {
    return {kind: "ProfileBuiltin", name: "MentionedSkillsReminder", props};
}

/** 定义 ModeReminder 自定义插槽。 */
export function ModeSlot(props: {kind: ModeSlotKind; children?: ProfileDslChild | ProfileDslChild[]}): ProfileModeSlotNode {
    return {kind: "ModeSlot", slot: props.kind, children: children(props.children)};
}

/** 定义无额外语义的 Profile DSL fragment。 */
export function Fragment(props: ChildrenProps): ProfileFragmentNode {
    return {kind: "Fragment", children: children(props.children)};
}
