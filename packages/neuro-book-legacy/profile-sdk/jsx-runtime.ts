import * as profileSdk from "nbook/profile-sdk";
import type {ProfileDslChild, ProfileDslNode} from "nbook/profile-sdk/contracts";

type Props = {[key: string]: unknown} & {
    children?: ProfileDslChild | ProfileDslChild[];
};

const components = {
    ProfilePrompt: profileSdk.ProfilePrompt,
    System: profileSdk.System,
    HistorySet: profileSdk.HistorySet,
    ModelContext: profileSdk.ModelContext,
    AppendingSet: profileSdk.AppendingSet,
    FileChangeNotice: profileSdk.FileChangeNotice,
    Message: profileSdk.Message,
    AIMessage: profileSdk.AIMessage,
    ToolCall: profileSdk.ToolCall,
    ToolResult: profileSdk.ToolResult,
    Reminder: profileSdk.Reminder,
    Watch: profileSdk.Watch,
    If: profileSdk.If,
    SystemReminder: profileSdk.SystemReminder,
    LinkedAgentsSummary: profileSdk.LinkedAgentsSummary,
    LinkedAgentsReminder: profileSdk.LinkedAgentsReminder,
    WorkspaceFocusReminder: profileSdk.WorkspaceFocusReminder,
    ModeAvailabilityReminder: profileSdk.ModeAvailabilityReminder,
    TaskReminder: profileSdk.TaskReminder,
    ModeReminder: profileSdk.ModeReminder,
    ModeSlot: profileSdk.ModeSlot,
    MentionedSkillsReminder: profileSdk.MentionedSkillsReminder,
    AgentCatalog: profileSdk.AgentCatalog,
    SkillCatalog: profileSdk.SkillCatalog,
    WorkflowCatalog: profileSdk.WorkflowCatalog,
    ActivatedSkills: profileSdk.ActivatedSkills,
    SqlSchemaSummary: profileSdk.SqlSchemaSummary,
    Import: profileSdk.Import,
};

export const Fragment: typeof profileSdk.Fragment = profileSdk.Fragment;

/** TSX 自动运行时入口。 */
export function jsx(
    type: keyof typeof components | typeof Fragment | ((props: Props) => ProfileDslNode),
    props: Props,
): ProfileDslNode {
    return createElement(type, props);
}

export const jsxs: typeof jsx = jsx;

/** 将 JSX intrinsic 或函数组件转换为 Profile DSL node。 */
export function createElement(
    type: keyof typeof components | typeof Fragment | ((props: Props) => ProfileDslNode),
    props: Props,
): ProfileDslNode {
    if (typeof type === "function") return type(props);
    const component = components[type];
    if (!component) throw new Error(`未知 Profile DSL JSX 节点：${String(type)}`);
    return component(props as never);
}

export namespace JSX {
    export type Element = ProfileDslNode;
    export interface IntrinsicElements {
        ProfilePrompt: Parameters<typeof profileSdk.ProfilePrompt>[0];
        System: Parameters<typeof profileSdk.System>[0];
        HistorySet: Parameters<typeof profileSdk.HistorySet>[0];
        ModelContext: Parameters<typeof profileSdk.ModelContext>[0];
        AppendingSet: Parameters<typeof profileSdk.AppendingSet>[0];
        FileChangeNotice: Parameters<typeof profileSdk.FileChangeNotice>[0];
        Message: Parameters<typeof profileSdk.Message>[0];
        AIMessage: Parameters<typeof profileSdk.AIMessage>[0];
        ToolCall: Parameters<typeof profileSdk.ToolCall>[0];
        ToolResult: Parameters<typeof profileSdk.ToolResult>[0];
        Reminder: Parameters<typeof profileSdk.Reminder>[0];
        Watch: Parameters<typeof profileSdk.Watch>[0];
        If: Parameters<typeof profileSdk.If>[0];
        SystemReminder: Parameters<typeof profileSdk.SystemReminder>[0];
        LinkedAgentsSummary: Parameters<typeof profileSdk.LinkedAgentsSummary>[0];
        LinkedAgentsReminder: Parameters<typeof profileSdk.LinkedAgentsReminder>[0];
        WorkspaceFocusReminder: Parameters<typeof profileSdk.WorkspaceFocusReminder>[0];
        ModeAvailabilityReminder: Parameters<typeof profileSdk.ModeAvailabilityReminder>[0];
        TaskReminder: Parameters<typeof profileSdk.TaskReminder>[0];
        ModeReminder: Parameters<typeof profileSdk.ModeReminder>[0];
        ModeSlot: Parameters<typeof profileSdk.ModeSlot>[0];
        MentionedSkillsReminder: {[key: string]: never};
        AgentCatalog: Parameters<typeof profileSdk.AgentCatalog>[0];
        SkillCatalog: Parameters<typeof profileSdk.SkillCatalog>[0];
        WorkflowCatalog: Parameters<typeof profileSdk.WorkflowCatalog>[0];
        ActivatedSkills: Parameters<typeof profileSdk.ActivatedSkills>[0];
        SqlSchemaSummary: Parameters<typeof profileSdk.SqlSchemaSummary>[0];
        Import: Parameters<typeof profileSdk.Import>[0];
    }
}
