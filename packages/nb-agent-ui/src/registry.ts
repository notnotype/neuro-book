/**
 * AgentConversationView 的扩展点注册表。
 *
 * 内置功能与将来的插件使用同一种登记方式：每个来源提交一份 `AgentViewContribution`，
 * `createAgentViewRegistry` 把它们合并成视图消费的只读注册表。视图只认注册表，不认具体来源，
 * 所以新增一种工具的呈现只需要登记一项，不需要改任何分派代码。
 *
 * 对插件稳定的形状要等插件运行时（`runtime.plugins`）定型后再确认，在此之前可以随内置需要调整。
 */
import type {Text} from "@notnotype/nb-ui/text";
import type {Component} from "vue";

import {agentRef} from "./text";
import type {AgentConversationContext, AgentConversationServices, AgentLocale, AgentViewAction, AssistantMessageView, MessageAnnotationView, MessageView, SystemMessageSource, ToolCallView} from "./types";
import type {CodeLine} from "./tool-detail-lines";

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

type ToolRendererBase = RegistryEntryBase & {
    /** 精确匹配的工具名。 */
    toolNames?: readonly string[];
    /** 工具名前缀匹配，例如 `list_`。精确名优先；前缀互相包含时取最长的。 */
    toolNamePrefix?: string;
    /** 图标 class。 */
    icon: string;
    /** 工具的动作名，例如“读取”。 */
    label: Text;
    /**
     * 单行摘要，通常是操作对象，例如文件路径；没有合适的对象时返回空串。调用出错时也会调用，可以写出失败原因（`call.error` 可能为空：运行结束时还没有结果的调用也算出错）。
     * 同一句用在步骤行、工具组的明细与详情的代码块标签上。
     */
    summary: (call: ToolCallView) => string;
    /** 对文件的影响；缺省为无。 */
    effects?: (call: ToolCallView) => ToolEffects;
    /**
     * 改文件的 diff 行；没有 `detail` 时详情画成 diff。返回 null 表示这次调用给不出 diff（例如参数还是半截），
     * 详情退回原始参数与结果；空数组是“内容为空”。
     */
    diff?: (call: ToolCallView) => CodeLine[] | null;
    /** 展开后的详细内容组件，接收 `ToolComponentProps`、发 `HostComponentEmits`；缺省时画 `diff`，再缺省时显示原始参数与结果。 */
    detail?: Component;
    /**
     * 呈现层级：
     * - `line`、`card`：属于思维链，默认随思维链折叠；展开后分别是一行或一张可展开的卡片。
     * - `node`：人机交互控件（提问、任务清单、Workflow 等），常显，并把思维链切开；`outcome` 的调用被退回时例外，是思维链里的一行。
     */
    presentation: "line" | "card" | "node";
    /**
     * 按调用定层级（例如 `shell` 带 `async` 时是 `node`）：参数生成完（不在 `streaming`）才调用，之前按 `presentation`。
     * 读呈现层级的地方都经 `presentationOf(renderer, call)`。
     */
    presentationOf?: (call: ToolCallView) => "line" | "card" | "node";
    /** `node` 呈现时的专用组件，接收 `ToolComponentProps`、发 `HostComponentEmits`；缺省时用通用卡片。 */
    node?: Component;
    /** `node` 呈现时改用宿主注入的渲染组件（`renderers` 里这个名字的）；宿主没注入时同 `node` 缺省，画通用卡片。 */
    hostNode?: "backgroundCommand";
    /**
     * 只对 `node` 有效：成功的调用排在一轮末尾时算这一轮的结果（Spec 的“结果节点”），整轮收起后仍显示，不计入整轮摘要的
     * 操作次数。例如问答里交答案的收尾工具；被退回（出错）的那几次仍是过程。
     */
    outcome?: boolean;
};

/**
 * 工具渲染器。按类别分开写：`explore` 连续调用要合成工具组，所以必须给组里自己那一段的说法；其余类别不合并，不给。
 */
export type ToolRendererEntry =
    | (ToolRendererBase & {
        category: "explore";
        /**
         * 探查组合并摘要中本工具的那一段，例如“读了 5 个文件”“读了第 33–37 章”。收到这一组里由本渲染器处理的全部调用，
         * 按时间顺序，含出错与运行中的：只想说成功的要自己按 `call.status` 过滤；运行中的参数可能是半截（用 argString 等读），
         * 短语会随之变化。一组至少两次调用才成形，但同一渲染器在组里可能只有一次。
         */
        groupPhrase: (calls: readonly ToolCallView[]) => Text;
    })
    | (ToolRendererBase & {category: "mutate" | "interact" | "other"; groupPhrase?: never});

/**
 * 注册表里宿主登记的组件都收到的部分（Spec“注册表”的宿主组件）。走 props 而不是注入：组件是宿主写的，签名上要看得出
 * 它拿到了什么。t11 接上的条目、面板与状态栏条目沿用，再各加自己的数据。
 */
export type HostComponentContext = {
    /** 对话视图的完整 ctx；例如任务清单要从更早的消息里找上一版清单。 */
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    locale: AgentLocale;
};

/** 工具的 `detail` 与 `node` 组件接收的 props。 */
export type ToolComponentProps = HostComponentContext & {call: ToolCallView};

/** 宿主组件只发一种事件，视图原样交给宿主。 */
export type HostComponentEmits = {action: [action: AgentViewAction]};

// ─── 角色 ───────────────────────────────────────────────────────────────

/**
 * 消息流中的说话者。现在只有用户与 Agent 两种，登记成扩展点是为将来的第三种角色
 * （例如协作的子 Agent）预留：气泡版式不区分角色，只从这里取头像与名称。
 */
export type RoleEntry = RegistryEntryBase & {
    icon: string;
    label: Text;
    /** 头像与气泡的色调：`accent` 用强调色，`neutral` 用中性色。 */
    tone: "accent" | "neutral";
};

// ─── 其余扩展点 ──────────────────────────────────────────────────────────

/**
 * 条目渲染器，一项只走一种匹配：按 `customType` 匹配附注，或按消息类型与系统条目来源匹配内置消息。现在视图只读取前一种
 * （Spec“注册表”）；后一种还没有消费者，写成单独一支，免得登记了却以为已经生效，两样都不写也过不了类型检查。
 */
export type EntryRendererEntry = RegistryEntryBase & {
    /** 附注由它画时，props 是 `EntryComponentProps`，事件是 `HostComponentEmits`。 */
    component: Component;
} & (
    | {
        /** 附注的 `customType`，精确匹配。两个渲染器不能声明同一个。 */
        customType: string;
        messageKind?: never;
        systemSource?: never;
    }
    | {
        messageKind: MessageView["kind"];
        /** 只对系统条目有意义；缺省匹配全部来源。 */
        systemSource?: SystemMessageSource;
        customType?: never;
    }
);

/** 条目组件收到的 props：与工具组件同一套宿主通道，加上这条附注与它所在的消息。 */
export type EntryComponentProps = HostComponentContext & {annotation: MessageAnnotationView; message: AssistantMessageView};

export type MessageActionEntry = RegistryEntryBase & {
    messageKinds: ReadonlyArray<MessageView["kind"]>;
    /** 按单条消息判断是否显示，例如尚未确认送达的用户消息不能编辑或分支；缺省对所有匹配类型的消息显示。 */
    appliesTo?: (message: MessageView) => boolean;
    icon: string;
    label: Text;
    toAction: (message: MessageView, target: MessageActionTarget) => AgentViewAction;
};

/** 消息操作作用的对象：结果是结果节点时带上那次调用的 id（例如复制要复制工具参数里的答案，而不是消息正文）。 */
export type MessageActionTarget = {outcomeCallId: string | null};

export type HeaderActionEntry = RegistryEntryBase & {
    icon: string;
    label: Text;
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
    description: Text;
    argsHint?: Text;
};

export type ComposerTriggerEntry = RegistryEntryBase & {
    /** 单个字符，例如 `@`。 */
    char: string;
};

/**
 * 输入框工具栏上的按钮。点了发出 `action`，或者（给了 `trigger` 时）往编辑器里插这个触发字符、打开它的菜单，不发 action，
 * 例如 nb-story 的 `+` 插 `@` 选引用。`placement` 为 `leading` 时放在正文前面（单行版式）或工具栏最前（两层版式）。
 */
export type ToolbarButtonEntry = RegistryEntryBase & {
    icon: string;
    label: Text;
    placement?: "leading" | "trailing";
} & ({action: AgentViewAction; trigger?: never} | {trigger: string; action?: never});

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
    /** 工具名对应的渲染器：精确工具名优先，其次最长的匹配前缀；都不匹配时是通用渲染器。 */
    resolveTool(toolName: string): ToolRendererEntry;
    /** 附注的 `customType` 对应的条目渲染器；没有登记时为 null，视图画默认的淡色一行。与 resolveTool 一样不看 when。 */
    resolveEntry(customType: string): EntryRendererEntry | null;
};

type ContributedEntries = {[P in ExtensionPoint]?: readonly ExtensionPointEntries[P][]};

/** 一个来源（内置模块或插件）提交的登记项。 */
export type AgentViewContribution = {
    /** 来源名，只用于冲突诊断。 */
    source: string;
} & ContributedEntries;

/** 冲突在哪：同一扩展点里重复的 id，两个工具渲染器声明的同一个工具名、同一个前缀，或两个条目渲染器声明的同一个 customType。 */
export type RegistryConflict =
    | {kind: "id"; id: string}
    | {kind: "toolName"; name: string}
    | {kind: "toolNamePrefix"; prefix: string}
    | {kind: "customType"; customType: string};

function describeConflict(conflict: RegistryConflict): string {
    switch (conflict.kind) {
        case "id": return `id「${conflict.id}」重复登记`;
        case "toolName": return `工具名「${conflict.name}」被两个渲染器声明`;
        case "toolNamePrefix": return `工具名前缀「${conflict.prefix}」被两个渲染器声明`;
        case "customType": return `条目类型「${conflict.customType}」被两个渲染器声明`;
    }
}

export class AgentViewRegistryConflictError extends Error {
    constructor(
        readonly point: ExtensionPoint,
        readonly conflict: RegistryConflict,
        readonly sources: readonly [string, string],
    ) {
        super(`扩展点 ${point} 中${describeConflict(conflict)}：${sources[0]} 与 ${sources[1]}`);
        this.name = "AgentViewRegistryConflictError";
    }
}

/** 没有匹配渲染器的工具使用它：类别 `other`，以卡片显示工具原名。 */
export const GENERIC_TOOL_RENDERER: ToolRendererEntry = {
    id: "generic",
    category: "other",
    icon: "i-lucide-wrench",
    label: agentRef("tool.generic"),
    summary: (call) => call.name,
    presentation: "card",
};

/**
 * 宿主与插件写的工具回调可能抛错（docs/specs/ui/agent-conversation-view.md“失败与恢复”）。合并时包一层：抛错的那一次
 * 退回通用结果，并打一条开发诊断，其余消息照常显示。每个回调只报一次，免得一次渲染刷满控制台。
 */
function guardTool(entry: ToolRendererEntry): ToolRendererEntry {
    const reported = new Set<string>();
    const report = (callback: string, error: unknown): void => {
        if (reported.has(callback)) return;
        reported.add(callback);
        console.error(`nb-agent-ui: 工具渲染器 ${entry.id} 的 ${callback} 抛错，这一项按通用渲染器显示`, error);
    };
    function guarded<A extends unknown[], R>(name: string, callback: (...args: A) => R, fallback: (...args: A) => R): (...args: A) => R {
        return (...args) => {
            try {
                return callback(...args);
            } catch (error) {
                report(name, error);
                return fallback(...args);
            }
        };
    }
    const {effects, diff} = entry;
    // 只替换函数字段，类别与 groupPhrase 的对应留在展开的 entry 里；explore 的 groupPhrase 单独再包一层。
    const common = {
        summary: guarded("summary", entry.summary, GENERIC_TOOL_RENDERER.summary),
        ...(effects === undefined ? {} : {effects: guarded("effects", effects, (): ToolEffects => ({read: [], changed: []}))}),
        ...(diff === undefined ? {} : {diff: guarded("diff", diff, () => null)}),
    };
    if (entry.category === "explore") {
        return {...entry, ...common, groupPhrase: guarded("groupPhrase", entry.groupPhrase, (calls: readonly ToolCallView[]): Text => (agentRef("toolGroup.generic", {count: calls.length})))};
    }
    return {...entry, ...common};
}

/**
 * 两个工具渲染器声明同一个精确名或同一个前缀时，谁生效取决于登记先后；与 id 重复一样当成冲突（Spec“失败与恢复”）。
 * 精确名与前缀互相覆盖是有意的（精确名优先），不算冲突。
 */
function checkToolNames(contributions: readonly AgentViewContribution[]): void {
    const names = new Map<string, string>();
    const prefixes = new Map<string, string>();
    for (const contribution of contributions) {
        for (const entry of contribution.tools ?? []) {
            for (const name of entry.toolNames ?? []) {
                const owner = names.get(name);
                if (owner !== undefined) throw new AgentViewRegistryConflictError("tools", {kind: "toolName", name}, [owner, contribution.source]);
                names.set(name, contribution.source);
            }
            const prefix = entry.toolNamePrefix;
            if (prefix === undefined) continue;
            const owner = prefixes.get(prefix);
            if (owner !== undefined) throw new AgentViewRegistryConflictError("tools", {kind: "toolNamePrefix", prefix}, [owner, contribution.source]);
            prefixes.set(prefix, contribution.source);
        }
    }
}

function mergePoint<P extends ExtensionPoint>(contributions: readonly AgentViewContribution[], point: P): ExtensionPointEntries[P][] {
    const owners = new Map<string, string>();
    const items: Array<{entry: ExtensionPointEntries[P]; seq: number}> = [];
    for (const contribution of contributions) {
        const contributed: ContributedEntries = contribution;
        const entries: readonly ExtensionPointEntries[P][] = contributed[point] ?? [];
        for (const entry of entries) {
            const owner = owners.get(entry.id);
            if (owner !== undefined) {
                throw new AgentViewRegistryConflictError(point, {kind: "id", id: entry.id}, [owner, contribution.source]);
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
    checkToolNames(contributions);
    checkEntryTypes(contributions);
    checkHeaderTargets(contributions);
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
    const tools = merged.tools.map(guardTool);
    // 前缀按长度降序：`list_x_` 先于 `list_`，结果与登记顺序无关。
    const byPrefix = tools
        .filter((entry) => entry.toolNamePrefix !== undefined)
        .sort((a, b) => b.toolNamePrefix!.length - a.toolNamePrefix!.length);
    return {
        list: (point) => merged[point],
        resolveTool: (toolName) => tools.find((entry) => entry.toolNames?.includes(toolName))
            ?? byPrefix.find((entry) => toolName.startsWith(entry.toolNamePrefix!))
            ?? GENERIC_TOOL_RENDERER,
        resolveEntry: (customType) => merged.entries.find((entry) => entry.customType === customType) ?? null,
    };
}

/** 两个条目渲染器声明同一个 customType 时，谁生效取决于登记先后；与工具名一样当成冲突。 */
function checkEntryTypes(contributions: readonly AgentViewContribution[]): void {
    const owners = new Map<string, string>();
    for (const contribution of contributions) {
        for (const entry of contribution.entries ?? []) {
            if (entry.customType === undefined) continue;
            const owner = owners.get(entry.customType);
            if (owner !== undefined) throw new AgentViewRegistryConflictError("entries", {kind: "customType", customType: entry.customType}, [owner, contribution.source]);
            owners.set(entry.customType, contribution.source);
        }
    }
}

/**
 * 顶栏动作的目标是面板时现在就拒绝（docs/specs/ui/agent-conversation-view.md 的“顶栏”）：视图还没有按面板 id 打开面板的实现，
 * 登记进来只会点了没反应。面板实现之后去掉这一条。
 */
function checkHeaderTargets(contributions: readonly AgentViewContribution[]): void {
    for (const contribution of contributions) {
        for (const entry of contribution.headerActions ?? []) {
            if (entry.target.kind === "panel") throw new TypeError(`header action ${entry.id} from ${contribution.source} targets panel ${entry.target.panelId}; header actions can only emit actions until panels are implemented`);
        }
    }
}

/** 按显示条件筛出当前可见的登记项。 */
export function visibleEntries<T extends RegistryEntryBase>(entries: readonly T[], ctx: AgentConversationContext): T[] {
    return entries.filter((entry) => entry.when?.(ctx) ?? true);
}

/** 出过错的 `presentationOf`：每整理一次轮次（流式时每个增量）都会调用，同一个回调只报一次。 */
const failedPresentations = new WeakSet<object>();

/** 这次调用的呈现层级（见 `ToolRendererBase.presentationOf`）；回调抛错时按登记的缺省层级。 */
export function presentationOf(renderer: Pick<ToolRendererEntry, "presentation" | "presentationOf">, call: ToolCallView): "line" | "card" | "node" {
    if (renderer.presentationOf === undefined || call.status === "streaming") return renderer.presentation;
    try {
        return renderer.presentationOf(call);
    } catch (error) {
        if (!failedPresentations.has(renderer.presentationOf)) {
            failedPresentations.add(renderer.presentationOf);
            console.error("nb-agent-ui: 工具渲染器的 presentationOf 出错，按登记的层级显示", error);
        }
        return renderer.presentation;
    }
}
