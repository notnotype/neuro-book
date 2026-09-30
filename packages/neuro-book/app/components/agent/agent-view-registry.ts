/**
 * AgentConversationView 的扩展点注册表。
 *
 * 内置功能与将来的插件使用同一种登记方式：每个来源提交一份 `AgentViewContribution`，
 * `createAgentViewRegistry` 把它们合并成视图消费的只读注册表。视图只认注册表，不认具体来源，
 * 所以新增一种工具的呈现只需要登记一项，不需要改任何分派代码。
 *
 * 对插件稳定的形状要等插件运行时（`runtime.plugins`）定型后再确认，在此之前可以随内置需要调整。
 */
import type {Component} from "vue";
import type {AgentConversationContext, AgentViewAction, MessageView, SystemMessageSource, ToolCallView, ViewText} from "./agent-view.types";

/** 所有登记项共有的字段。 */
export type RegistryEntryBase = {
    /** 同一扩展点内唯一。 */
    id: string;
    /** 升序排列；缺省为 0，同值按登记先后。 */
    order?: number;
    /** 显示条件；缺省为始终显示。 */
    when?: (ctx: AgentConversationContext) => boolean;
};

// ─── 工具渲染器 ──────────────────────────────────────────────────────────

/**
 * 工具类别决定工具在思维链里的归并与统计：
 * `explore` 连续出现时合成工具组并计入读取文件数；`mutate` 每次单独一行并计入本轮改动文件；
 * `interact` 与 `other` 不合并。呈现层级由 `presentation` 决定，与类别无关。
 */
export type ToolCategory = "explore" | "mutate" | "interact" | "other";

export type FileChangeView = {
    path: string;
    /** 增删行数；参数只公开了预览、无法统计时为 null。 */
    added: number | null;
    removed: number | null;
};

/** 工具对文件的影响，用于摘要行的读写文件数和改动文件 chip。 */
export type ToolEffects = {
    read: string[];
    changed: FileChangeView[];
};

export type ToolRendererEntry = RegistryEntryBase & {
    /** 精确匹配的工具名。 */
    toolNames?: readonly string[];
    /** 工具名前缀匹配，例如 `list_`。 */
    toolNamePrefix?: string;
    category: ToolCategory;
    /** 图标 class。 */
    icon: string;
    /** 工具的动作名，例如“读取”。 */
    label: ViewText;
    /** 单行摘要，通常是操作对象，例如文件路径；没有合适的对象时返回空串。 */
    summary: (call: ToolCallView) => string;
    /** 探查组合并摘要中本工具的那一段，例如“读取 5 个文件”。`explore` 类必填。 */
    groupPhrase?: (count: number) => ViewText;
    /** 对文件的影响；缺省为无。 */
    effects?: (call: ToolCallView) => ToolEffects;
    /** 展开后的详细内容组件，接收 `ToolDetailProps`；缺省时显示原始参数与结果。 */
    detail?: Component;
    /**
     * 呈现层级：
     * - `line`、`card`：属于思维链，默认随思维链折叠；展开后分别是一行或一张可展开的卡片。
     * - `node`：人机交互控件（提问、任务清单、Workflow 等），常显，并把思维链切开。
     */
    presentation: "line" | "card" | "node";
    /** `node` 呈现时的专用组件，接收 `ToolNodeProps`；缺省时用通用卡片。 */
    node?: Component;
};

/** `ToolRendererEntry.node` 组件接收的 props。 */
export type ToolNodeProps = {
    call: ToolCallView;
    /** 对话视图的完整 ctx；例如任务清单要从更早的消息里找上一版清单。 */
    ctx: AgentConversationContext;
};

/** `ToolRendererEntry.detail` 组件接收的 props，与 `node` 组件相同。 */
export type ToolDetailProps = ToolNodeProps;

// ─── 角色 ───────────────────────────────────────────────────────────────

/**
 * 消息流中的说话者。现在只有用户与 Agent 两种，登记成扩展点是为将来的第三种角色
 * （例如协作的子 Agent）预留：气泡版式不区分角色，只从这里取头像与名称。
 */
export type RoleEntry = RegistryEntryBase & {
    icon: string;
    label: ViewText;
    /** 头像与气泡的色调：`accent` 用强调色，`neutral` 用中性色。 */
    tone: "accent" | "neutral";
};

// ─── 其余扩展点 ──────────────────────────────────────────────────────────

export type EntryRendererEntry = RegistryEntryBase & {
    messageKind: MessageView["kind"];
    /** 只对系统条目有意义；缺省匹配全部来源。 */
    systemSource?: SystemMessageSource;
    component: Component;
};

export type MessageActionEntry = RegistryEntryBase & {
    messageKinds: ReadonlyArray<MessageView["kind"]>;
    /** 按单条消息判断是否显示，例如尚未确认送达的用户消息不能编辑或分支；缺省对所有匹配类型的消息显示。 */
    appliesTo?: (message: MessageView) => boolean;
    icon: string;
    label: ViewText;
    toAction: (message: MessageView) => AgentViewAction;
};

export type HeaderActionEntry = RegistryEntryBase & {
    icon: string;
    label: ViewText;
    /** 角标数；0 或 null 时不显示。 */
    badge?: (ctx: AgentConversationContext) => number | null;
    /** 点击后发出 action，或打开某个已登记的面板。 */
    target: {kind: "action"; action: AgentViewAction} | {kind: "panel"; panelId: string};
    /** 是否允许常驻顶栏；常驻的最多两个，其余进溢出菜单。 */
    pinnable: boolean;
};

export type PanelEntry = RegistryEntryBase & {
    component: Component;
    presentation: "popover" | "dialog";
};

export type TrayItemEntry = RegistryEntryBase & {component: Component};

export type StatusItemEntry = RegistryEntryBase & {component: Component};

export type ComposerCommandEntry = RegistryEntryBase & {
    /** 命令名，不含 `/`。 */
    name: string;
    description: ViewText;
    argsHint?: ViewText;
};

export type ComposerTriggerEntry = RegistryEntryBase & {
    /** 单个字符，例如 `@`。 */
    char: string;
};

export type ToolbarButtonEntry = RegistryEntryBase & {
    icon: string;
    label: ViewText;
    action: AgentViewAction;
};

// ─── 注册表 ─────────────────────────────────────────────────────────────

/** 各扩展点的登记项类型。 */
export type ExtensionPointEntries = {
    roles: RoleEntry;
    tools: ToolRendererEntry;
    entries: EntryRendererEntry;
    messageActions: MessageActionEntry;
    headerActions: HeaderActionEntry;
    panels: PanelEntry;
    trayItems: TrayItemEntry;
    statusItems: StatusItemEntry;
    commands: ComposerCommandEntry;
    triggers: ComposerTriggerEntry;
    toolbarButtons: ToolbarButtonEntry;
};

export type ExtensionPoint = keyof ExtensionPointEntries;

/**
 * 视图消费的注册表。只暴露查询方法：登记项里有函数与组件，注册表是运行期能力而不是数据，
 * 不进入可 JSON 化的 ctx；匹配规则（例如工具名优先于前缀）也封装在这里，视图与分轮规则不各写一份。
 */
export type AgentViewRegistry = {
    /** 某个扩展点的全部登记项，已按 order 排序。 */
    list<P extends ExtensionPoint>(point: P): readonly ExtensionPointEntries[P][];
    /** 工具名对应的渲染器：精确工具名优先，其次前缀；都不匹配时是通用渲染器。 */
    resolveTool(toolName: string): ToolRendererEntry;
};

type ContributedEntries = {[P in ExtensionPoint]?: readonly ExtensionPointEntries[P][]};

/** 一个来源（内置模块或插件）提交的登记项。 */
export type AgentViewContribution = {
    /** 来源名，只用于冲突诊断。 */
    source: string;
} & ContributedEntries;

export class AgentViewRegistryConflictError extends Error {
    constructor(
        readonly point: ExtensionPoint,
        readonly id: string,
        readonly sources: readonly [string, string],
    ) {
        super(`扩展点 ${point} 中的 id「${id}」重复登记：${sources[0]} 与 ${sources[1]}`);
        this.name = "AgentViewRegistryConflictError";
    }
}

/** 没有匹配渲染器的工具使用它：类别 `other`，以卡片显示工具原名。 */
export const GENERIC_TOOL_RENDERER: ToolRendererEntry = {
    id: "generic",
    category: "other",
    icon: "i-lucide-wrench",
    label: {key: "agentView.tool.generic"},
    summary: (call) => call.name,
    presentation: "card",
};

function mergePoint<P extends ExtensionPoint>(contributions: readonly AgentViewContribution[], point: P): ExtensionPointEntries[P][] {
    const owners = new Map<string, string>();
    const items: Array<{entry: ExtensionPointEntries[P]; seq: number}> = [];
    for (const contribution of contributions) {
        const contributed: ContributedEntries = contribution;
        const entries: readonly ExtensionPointEntries[P][] = contributed[point] ?? [];
        for (const entry of entries) {
            const owner = owners.get(entry.id);
            if (owner !== undefined) {
                throw new AgentViewRegistryConflictError(point, entry.id, [owner, contribution.source]);
            }
            owners.set(entry.id, contribution.source);
            items.push({entry, seq: items.length});
        }
    }
    items.sort((a, b) => (a.entry.order ?? 0) - (b.entry.order ?? 0) || a.seq - b.seq);
    return items.map((item) => item.entry);
}

/**
 * 合并各来源的登记项。同一扩展点出现重复 id 时抛出 `AgentViewRegistryConflictError`，
 * 不静默覆盖——覆盖会让后登记的来源悄悄改掉内置行为，而且谁生效取决于加载顺序。
 */
export function createAgentViewRegistry(contributions: readonly AgentViewContribution[]): AgentViewRegistry {
    const merged: {[P in ExtensionPoint]: readonly ExtensionPointEntries[P][]} = {
        roles: mergePoint(contributions, "roles"),
        tools: mergePoint(contributions, "tools"),
        entries: mergePoint(contributions, "entries"),
        messageActions: mergePoint(contributions, "messageActions"),
        headerActions: mergePoint(contributions, "headerActions"),
        panels: mergePoint(contributions, "panels"),
        trayItems: mergePoint(contributions, "trayItems"),
        statusItems: mergePoint(contributions, "statusItems"),
        commands: mergePoint(contributions, "commands"),
        triggers: mergePoint(contributions, "triggers"),
        toolbarButtons: mergePoint(contributions, "toolbarButtons"),
    };
    const tools = merged.tools;
    return {
        list: (point) => merged[point],
        resolveTool: (toolName) => tools.find((entry) => entry.toolNames?.includes(toolName))
            ?? tools.find((entry) => entry.toolNamePrefix !== undefined && toolName.startsWith(entry.toolNamePrefix))
            ?? GENERIC_TOOL_RENDERER,
    };
}

/** 按显示条件筛出当前可见的登记项。 */
export function visibleEntries<T extends RegistryEntryBase>(entries: readonly T[], ctx: AgentConversationContext): T[] {
    return entries.filter((entry) => entry.when?.(ctx) ?? true);
}
