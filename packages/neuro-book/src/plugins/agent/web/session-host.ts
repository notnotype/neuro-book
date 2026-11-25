/**
 * 一个对话位置（右栏的视图、编辑区的页面）的宿主（docs/specs/agent/conversation.md）：持有这个位置的当前会话，把日志与帧合成视图要的 `ctx`，
 * 把视图的 action 换成远程指令。组件只是它的消费者，所以放在插件级：编辑区页面切标签就卸载，也没有“被关闭”的信号，未提交的答案、收起状态
 * 放在这里，切回来还在。组件借用并计数，归零后 30 秒取消订阅。
 *
 * 打开一个会话（输出 5）的先后：先订阅并缓存帧；取快照，得 `head`、`leaf` 与会话级基线；固定这个 `leaf` 分页取路径；再处理缓存。
 * seq 不大于 `head` 的日志帧由适配器丢掉；快照之前的状态帧过时了，这里丢掉。内联放不下的事件要经 `eventChunk` 拼回，拼的时候后面的帧排队，
 * 按 seq 保序。收到 `leafChanged` 按新叶子重取路径，不把各分支的日志接在一起。
 *
 * 用 `bun test` 跑真实的服务端（`agentWorld`），所以这里不导入 `.vue`。
 */

import {computed, ref, shallowRef, watch} from "vue";
import type {ComputedRef, ShallowRef} from "vue";

import {createAgentContext, createKernelTranscript} from "@notnotype/nb-agent-ui";
import {findPromptLinks} from "@notnotype/nb-markdown";
import type {KernelNotice, KernelQueued} from "@notnotype/nb-agent-ui";
import type {AgentConversationContext, AgentViewAction, ApprovalPreviewView, ComposerApprovalOption, ComposerEffortView, ComposerGroupView, ComposerIcon, ComposerModelView, BranchView, ComposerRoleView, ContextInspectionView, EditingView, KernelAnchor, KernelIssuer, MessageView, SessionTreeNodeView, SessionTreeView, KernelTranscript, PendingInputView, PendingQuestionView, SystemPromptView} from "@notnotype/nb-agent-ui";
import type {RemoteClient} from "@notnotype/nb-runtime/remote";
import type {Text} from "@notnotype/nb-ui/text";

import type {TextResolver} from "nbook/shared/localized-text";
import type {TextRef} from "@notnotype/nb-ui/text";
import type {BranchPoint, EffortSource, ModelReasoning, PreviewResult, RewindTarget, SessionOwner} from "@notnotype/nb-harness/kernel/contracts";

import {roleOfReference, roleReference} from "nbook/plugins/models/shared/contracts";
import {MAIN_PROFILE} from "../shared/contracts";
import {AGENT_MODES_EXTENSION, AUTO_ESCALATED_PREFIX, AUTO_FAILED_REASON, MODE_ASK_REASON, MODE_SWITCH_KIND} from "../shared/permissions";
import type {AgentMode, ModeSwitchRequest, Rule} from "../shared/permissions";
import {rulesToRemember} from "./permission-rules";
import type {SettingWriteResult} from "nbook/shared/settings";
import type {ProfileEntry} from "../shared/contracts";
import {modelNeedsText} from "./profile-view";
import {MODEL_KEYS, modelNotice} from "./model-notice";
import type {ModelFailure, ModelNoticeInput} from "./model-notice";
import type {agentSessionsContract, ApprovalPreview, ApprovalPreviewItem, LogItem, RemoteFrame} from "../shared/remote";
import type {AncestorItem, JobItem, TreeItem} from "../shared/subagents";
import {agentText} from "../shared/text";
import {heldReason} from "./held-reason";
import {mergeHeld} from "./resume-merge";
import type {SubagentStore} from "./subagent-store";
import {OPEN_REQUEST_ACTION, OPEN_REQUESTS_ACTION} from "./request-entries";

type SessionsRemote = RemoteClient<typeof agentSessionsContract>;

/** 归零之后等这么久才取消订阅：切标签回来不用重新打开。 */
export const RELEASE_DELAY_MS = 30_000;
/** 切走的会话至多记这么多个的向导与停靠区状态。 */
const KEPT_UI_STATES = 20;
const TICK_MS = 1_000;

/** 发出去、结果还没定的一句话：重发用同一个指令 id 和同一份附件，明确被拒时 `restore` 把附件放回输入框。 */
/**
 * 发出去还没确认的一条。合并留着的话发出的那一条带 `replaces`（重发沿用）与 `typed`（用户这次写的字；被拒时只放回它，空着继续时为 null，
 * 合成的文字不放回输入框，conversation.md 输出 50）。
 */
type PendingSend = {
    readonly commandId: string;
    readonly input: {readonly text: string; readonly attachments?: readonly UploadedAttachment[]};
    readonly replaces?: readonly {readonly id: string; readonly edits: number}[];
    /** 有归属的会话（bot 档）：运行中的投递方式与一并结算（重发要带上，否则结果未知后重发会丢掉结算）。 */
    readonly mode?: "steer" | "followup";
    readonly settlePending?: "deny";
    /** 恢复方式不是合并、写了字时的放行方式。 */
    readonly release?: "keep" | "followups";
    readonly typed?: string | null;
    restore(): void;
};

/** 结果未知的失败码：指令可能已经受理，不能当成被拒。 */
const UNKNOWN_OUTCOME = new Set(["unknown-outcome", "unavailable", "timeout", "disconnected", "server-restarted", "provider-error"]);
const REJECT_KEYS = {
    "empty-input": "conversation.reject.emptyInput",
    "input-too-large": "conversation.reject.inputTooLarge",
    "input-rejected": "conversation.reject.inputRejected",
    "read-only": "conversation.reject.readOnly",
} as const;
/** `compact` 被拒的码（runtime.md 输出 52）。 */
const COMPACT_REJECT_KEYS = {
    "nothing-to-compact": "conversation.compact.nothingToCompact",
    "no-compaction-model": "conversation.compact.noModel",
    "read-only": "conversation.reject.readOnly",
} as const;
/** 宿主做了的输入框命令。 */
const HOST_COMMANDS = ["compact", "new", "fork", "rename", "model", "plan", "mode"] as const;
/** 有归属的会话（bot 档）做的命令（agent/conversation.md 输出 53）：不换会话、不分叉；标题是归属插件给的身份，不改名。 */
const OWNED_COMMANDS: readonly string[] = ["compact", "plan", "mode"];
/**
 * 能切 Agent 模式的 Profile：目录项按 id 引用了模式扩展（modes.md；`switch_mode` 工具只决定 Agent 能不能主动申请，不影响这里）。
 * 目录里还没有它（还在加载）时按能算，免得选择器闪一下。只看目录、不追会话自己的装配：两边不一致只在用户级 Profile 改了引用、
 * 会话还没重新装配时出现，那时切换得 `unknown-extension`，提示见 `setMode`。
 */
const hasModes = (entry: ProfileEntry | undefined): boolean => entry === undefined || (entry.referencedExtensions ?? []).includes(AGENT_MODES_EXTENSION);
/** 宿主总是做了的触发字符；表情的 `:` 只在有表情选择器时做（`SessionHostDeps.triggers`）。 */
const HOST_TRIGGERS: readonly string[] = ["@", "/", "$"];
/** 打字时攒一下再写草稿。 */
const DRAFT_SAVE_DELAY_MS = 500;
/** 上方向键最多翻多少条。 */
const RECALL_LIMIT = 50;
const ROLE_STATUS_KEYS = {
    unbound: MODEL_KEYS["role-unbound"],
    "unknown-model": MODEL_KEYS["unknown-model"],
    "no-credentials": MODEL_KEYS["no-credentials"],
} as const;
/** `preview` 的 `tokens.byArea` 里的几块，按它们在请求里的位置。 */
const AREA_KEYS = ["system", "tools", "opening", "history", "turn"] as const;
const PHASE_KEYS = {
    requesting: "conversation.phase.requesting",
    streaming: "conversation.phase.streaming",
    tools: "conversation.phase.tools",
    compacting: "conversation.phase.compacting",
} as const;

const APPROVAL_OPTIONS: readonly ComposerApprovalOption[] = [
    {key: "ask", label: agentText("conversation.approval.ask.label"), description: agentText("conversation.approval.ask.description"), icon: "i-lucide-shield-question"},
    {key: "allow-writes", label: agentText("conversation.approval.allowWrites.label"), description: agentText("conversation.approval.allowWrites.description"), icon: "i-lucide-pencil-line"},
    {key: "auto", label: agentText("conversation.approval.auto.label"), description: agentText("conversation.approval.auto.description"), icon: "i-lucide-bot"},
    {key: "yolo", label: agentText("conversation.approval.yolo.label"), description: agentText("conversation.approval.yolo.description"), icon: "i-lucide-triangle-alert", danger: true},
];

const MODE_OPTIONS: readonly {readonly key: AgentMode; readonly icon: string}[] = [
    {key: "normal", icon: "i-lucide-feather"},
    {key: "discuss", icon: "i-lucide-messages-square"},
    {key: "plan", icon: "i-lucide-clipboard-list"},
];

/** 选择器里思考档的状态：能力、夹取后的有效档与来源由内核按这次解析算好（`effectiveEffort`、`effortSource`），这里只翻成视图。 */
function effortViewFor(reasoning: ModelReasoning, effective: string | null, source: EffortSource | null, follow: ComposerEffortView["follow"]): ComposerEffortView {
    if (reasoning.kind !== "levels") return {kind: reasoning.kind, levels: [], canOff: false, verified: true, value: null, source: null, follow: null};
    return {kind: "levels", levels: [...reasoning.levels], canOff: reasoning.off === "disable", verified: reasoning.verified, value: effective, source, follow};
}

/**
 * “用默认”会回到哪里：内核这次解析走的角色设了默认档时是它，否则是模型自己的默认（线上不指定档时模型决定，
 * 不一定知道具体是哪一档）。会话钉了档之后总能回到跟随，所以只要模型能调档就有去处。
 * 角色与它的默认档来自内核的解析（Profile 声明的角色、会话选的角色、设置覆盖都已经算进去），这里不再自己推。
 */
function followOf(model: {readonly role?: string; readonly defaultEffort?: string}, roles: readonly ComposerRoleView[]): ComposerEffortView["follow"] {
    if (model.role !== undefined && model.defaultEffort !== undefined) return {source: "role", name: roles.find((item) => item.key === roleReference(model.role!))?.name ?? model.role};
    return {source: "model"};
}

/** 上方向键翻的内容：当前路径上用户说的话，最新在前，去重。补充说明与命令不算；回退掉的分支不在路径上，也不算（输出 29）。 */
function recallOf(messages: readonly MessageView[]): string[] {
    const seen = new Set<string>();
    for (let index = messages.length - 1; index >= 0 && seen.size < RECALL_LIMIT; index -= 1) {
        const message = messages[index]!;
        // 父 Agent 发来的话（带 `author`）不是用户说的。
        if (message.kind !== "user" || message.intent !== "normal" || message.delivery !== undefined || message.author !== undefined) continue;
        const text = message.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("");
        if (text !== "") seen.add(text);
    }
    return [...seen];
}

/** 这条日志事件会不会让解析到的模型变：核心设置里的模型与推理档，或换了 Profile（解析按 Profile 声明的角色，默认档随之变）。 */
function changesResolvedModel(event: unknown): boolean {
    const {type, data} = event as {readonly type?: unknown; readonly data?: {readonly extension?: unknown; readonly patch?: Readonly<Record<string, unknown>>}};
    if (type === "profileChanged") return true;
    return type === "settingsChanged" && data?.extension === "core" && data.patch !== undefined && ("model" in data.patch || "effort" in data.patch);
}

/**
 * 子代理与任务中心的工具显式映射到界面认的键：只认 `nbook.agent` 自己的这几个，别的插件的 `x.wait` 不会被画成任务中心的行
 * （docs/specs/agent/conversation.md 输出 33）。
 */
const AGENT_TOOL_KEYS: Readonly<Record<string, string>> = {
    "nbook.agent.spawn": "agent_spawn",
    "nbook.agent.send": "agent_send",
    "nbook.agent.answer": "agent_answer",
    "nbook.agent.wait": "agent.wait",
    "nbook.agent.kill": "agent.kill",
    "nbook.agent.jobs": "agent.jobs",
};

/**
 * 事项是不是代码里调的工具的（eval 里的 `tool.write`），交回外层工具的 id：本会话的从适配器取（事件上的 `within`）；后代会话的
 * 事项来自会话树，项里不带事件上的字段，只有审批的原文里带着。后代会话里提问的原文没有，取不到，向导不写来源（已知限制）。
 */
export function pendingWithin(item: {readonly within?: {readonly tool: string}; readonly request: unknown}): string | undefined {
    if (item.within !== undefined) return item.within.tool;
    const request = item.request as {within?: {tool?: unknown}} | null | undefined;
    return typeof request?.within?.tool === "string" ? request.within.tool : undefined;
}

/** 给视图看的工具名：`nbook.agent.edit-replace` 和 `edit` 给模型的名字相同，画法也相同。 */
export function displayToolName(id: string): string {
    const mapped = AGENT_TOOL_KEYS[id];
    if (mapped !== undefined) return mapped;
    const name = id.slice(id.lastIndexOf(".") + 1);
    if (name === "edit-replace") return "edit";
    if (name === "ask-form") return "ask";
    return name;
}

export interface SessionHostDeps {
    readonly remote: SessionsRemote;
    /** 窗口绑定的作品；新建的会话归它。 */
    readonly project: string | null;
    readonly now: () => number;
    readonly schedule: (run: () => void, delayMs: number) => () => void;
    readonly text: TextResolver;
    readonly newId: () => string;
    /** 这个位置最近用过的会话（`nbook.storage` 的本地记录）。 */
    readonly recent: {read(): Promise<string | null>; write(id: string | null): void};
    /** 上传附件（docs/specs/agent/sessions.md 的“附件”）；地址给 `<img>` 用。 */
    readonly attachments: {
        upload(session: string, file: File): Promise<{readonly ok: true; readonly value: UploadedAttachment} | {readonly ok: false; readonly code: string}>;
    };
    /** 按会话的草稿；写是尽力而为，丢了只是少一份没发的字。 */
    readonly drafts: {read(session: string): Promise<string | null>; write(session: string, text: string): void};
    readonly warnCost: () => number;
    /** 有留着的话时继续怎么发（conversation.md 输出 47）；点继续时现读。 */
    readonly resumeMode: () => "merge" | "keep" | "followups";
    /** “以后都允许”：加到用户规则末尾（permissions.md 输出 23）。 */
    readonly rememberRules: (rules: readonly Rule[]) => Promise<SettingWriteResult>;
    /** 模型下拉；模型服务不在时为 null。 */
    readonly models: () => readonly ComposerModelView[] | null;
    /** 模型角色；模型服务不在时为 null。`status` 是模型服务按解析规则算的有效性。 */
    readonly roles: () => readonly RoleOption[] | null;
    /** 模型库的分组（服务商的名字与图标引用）；模型行只带 `groupId`。 */
    readonly groups: () => readonly ComposerGroupView[];
    /** 模型服务快照里的服务商（提示卡查名字、判断一家都没有）；还没读到、模型服务不在时为 null。 */
    readonly providers: () => readonly {readonly id: string; readonly name: string}[] | null;
    readonly profiles: () => readonly ProfileEntry[];
    readonly copy: (text: string) => void;
    /** 打开设置；给了 `target` 时到那个分区、交给那一页 `focus`（settings-window.md 输出 15）。 */
    readonly openSettings: (target?: {readonly section: string; readonly focus?: string; readonly layer?: "user" | "project"}) => void;
    /** 打开“模型请求”页，只看这个会话；带 `request` 时选中那一次（request-trace.md 的入口）。 */
    readonly openRequests: (target: {readonly sessionId: string; readonly request?: number}) => void;
    readonly openAddress: (address: string) => void;
    readonly openLink: (href: string) => void;
    /** 宿主在 `@`、`/`、`$` 之外做了的触发字符（有表情选择器时是 `:`，docs/specs/agent/stickers.md 输出 42）；不给时没有。 */
    readonly triggers?: readonly string[];
    /** `:` 菜单里选了一个表情（`id` 是写法）：记进最近用过（输出 43）。 */
    readonly stickerSelected?: (raw: string) => void;
    /** Skill（skills.md 输出 26–28）：`$` 菜单选中之后的事、点开标签的地址；`profile` 是当前会话的 Profile。 */
    readonly skills: {
        selected(id: string, profile: string): void;
        /** 认不到时交回 null，视图上提示。 */
        address(name: string, profile: string): string | null;
    };
    /**
     * 会话的归属（agent/conversation.md 输出 53）：有归属的会话（bot 的主对话）按 bot 档画，档位跟着打开的会话走。表在插件级，几个宿主共用。
     * 不给时都没有归属。
     */
    readonly owners?: SessionOwners;
    /** 视图要换新的会话面板（点标题）；打开列表的动作归面板。 */
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export interface SessionOwners {
    /** 表里有的同步交回；还没读过为 undefined。 */
    known(id: string): SessionOwner | null | undefined;
    /**
     * 查表，没有再读会话头。会话不在为 `"missing"`（照常打开、失败，恢复时清记录）；别的读不出来为 `"unreadable"`（不当成没有归属：那会
     * 放宽限制；恢复时记录留着，可能只是服务端刚重启）。
     */
    ownerOf(id: string): Promise<SessionOwner | null | "unreadable" | "missing">;
    /** 归属插件给的身份（名字与头像）；归属插件不在或没有这个联系人时为 null，头回落到会话标题与 Profile 图标。读的是响应式数据。 */
    identity(owner: SessionOwner): {readonly name: string; readonly avatar?: string} | null;
    /** 这个联系人“看到”的位置；归属插件不在、没有这个联系人、未读还没数完时为 null。读的是响应式数据。 */
    seenOf(owner: SessionOwner): number | null;
    /**
     * 只有编辑区页面的宿主给：有归属的会话不在这里开，交给它（打开到消息视图），等它打开完或失败。页面没有联系人列表，也不记“看到”。
     */
    elsewhere?(id: string): Promise<void>;
}

export interface UploadedAttachment {
    readonly uri: string;
    readonly kind: "image" | "file";
    readonly name?: string;
    readonly mime?: string;
    readonly width?: number;
    readonly height?: number;
}

/** 宿主从模型服务的快照映射来，界面文字在这里按 `status` 取。 */
export interface RoleOption {
    readonly key: string;
    /** 角色 id（`key` 去掉 `role:` 前缀）。 */
    readonly id: string;
    /** 内置角色的名字是文字引用，按界面语言显示。 */
    readonly name: string | TextRef;
    readonly axis: "gradient" | "specialist";
    readonly modelLabel: string | null;
    readonly status: "ok" | "unbound" | "unknown-model" | "no-credentials";
    readonly icon?: ComposerIcon;
    readonly modelIcon?: ComposerIcon;
    /** 角色的默认思考档（`off` 或档位）；没设为 null。 */
    readonly effort: string | null;
}

export interface SessionHost {
    readonly ctx: ComputedRef<AgentConversationContext>;
    readonly sessionId: ShallowRef<string | null>;
    /** 当前会话已经应用到的日志 seq（快照的 `head` 与之后到的日志帧）：bot 视图据此报“看到”。没有会话时为 0。 */
    readonly shownSeq: ShallowRef<number>;
    /**
     * 每打开一次会话（不论从哪里：列表、命令、新建、恢复）加一：消息视图与书房的面板据此知道聊天区被别处换了，撤掉自己的盖层。
     * 借用时重新订阅同一个会话（借用数归零 30 秒后放开过）不算打开。
     */
    readonly opened: ShallowRef<number>;
    /** 当前会话的归属：没有会话、没有归属为 null；还没读到为 undefined。消息视图据此切标签、交“看到”。 */
    readonly owner: ComputedRef<SessionOwner | null | undefined>;
    /** 子代理与后台命令卡片的数据与动作（见 `subagent-store.ts`）。 */
    readonly subagents: SubagentStore;
    /** 回到这个位置最近用过的会话；不在了就显示未选择。 */
    restore(): Promise<void>;
    open(id: string): Promise<void>;
    /** 新建并打开；`profile` 缺省用主创。 */
    create(profile?: string): Promise<string | null>;
    act(action: AgentViewAction): void;
    /** 当前会话的 Profile；还没有会话时是新建要用的主创。`$` 菜单按它取白名单。响应式：快照到了会跟着变。 */
    profileKey(): string;
    /** 组件借用，交回归还函数。 */
    borrow(): () => void;
    /**
     * 这个聊天又一次出现在用户面前（书房的面板打开）：未读线按此刻重新定（agent/conversation.md 输出 55）。还没开着会话、或接着要开
     * 别的会话时什么都不用做，`open` 会重新定。
     */
    markOpened(): void;
    /**
     * 这次打开的计时（输出 56 的首屏指标）：`openHere` 开始时换一个新对象，快照与路径都应用完后再换一个带 `loaded` 的。没打开过为 null。
     */
    readonly painting: ShallowRef<PaintStart | null>;
    dispose(): void;
}

export interface PaintStart {
    readonly sessionId: string;
    readonly startedAt: number;
    /** 借用放开之后重新订阅（不是一次打开，见 `opened`）。 */
    readonly reattach: boolean;
    /** 快照与路径都应用完：`events` 是快照的 `head`。还在读、或打开失败为 null。 */
    readonly loaded: {readonly events: number} | null;
}

type Current = {
    readonly id: string;
    readonly transcript: KernelTranscript;
    release: (() => void) | null;
    /** 正在拼大事件或重取路径时，后面的帧排在这里。 */
    chain: Promise<void>;
    /** 这个会话打开失败的说明。 */
    failed: {readonly code: string} | null;
    /** 快照和路径还没到：视图显示加载中，不说“还没有消息”。 */
    loading: boolean;
    /** 树上的分叉；空闲时取，运行中不会变。 */
    branchPoints: readonly BranchPoint[];
    /** 后代与它们的进度（`treeChanged` 推整份）：卡片、停靠区里后代的事项、`activeCalls` 都读它。 */
    tree: readonly TreeItem[];
    /** 这个会话启动的任务（`jobsChanged` 推整份）。 */
    jobs: readonly JobItem[];
    /** 祖先，从父会话起：顶栏路径与父 Agent 发来的话的作者。 */
    ancestors: readonly AncestorItem[];
    /** 会话头的归属；还没读到为 undefined（这时按最严的档：加载中也画不出可操作的东西）。 */
    owner: SessionOwner | null | undefined;
    /** 读不到会话头（不是“不在了”）：档位留在最严的一档；恢复时不清“最近的会话”的记录。与 `failed` 分开记，不和快照的失败码互相覆盖。 */
    headerUnreadable: boolean;
};

/** 子代理卡片与后台命令卡片读的数据：按会话一份，宿主经 `provide` 交给卡片，不进 ctx（推送只替换变了的项）。 */
export interface SubagentData {
    readonly sessionId: string | null;
    /** 按子会话 id。 */
    readonly tree: ReadonlyMap<string, TreeItem>;
    /** 按任务 id。 */
    readonly jobs: ReadonlyMap<string, JobItem>;
}

export function createSessionHost(deps: SessionHostDeps): SessionHost {
    const {remote} = deps;
    const sessionId = shallowRef<string | null>(null);
    const shownSeq = shallowRef(0);
    const painting = shallowRef<PaintStart | null>(null);

    /**
     * 这次打开的未读线（agent/conversation.md 输出 55）：只标打开时就已经未读的回复，定下来就不再挪。宿主打开另一个会话、或书房面板
     * 打开（`markOpened`）时重来；重试与借用后的重新订阅打开的是同一个会话，沿用。
     *
     * 先后：`baseline` 是联系人的“看到”，在这次打开之后第一次读到时拍下，之后不再读。自己交的“看到”（`contact-opener` 的 `watchSeen`，
     * 路径应用完 `shownSeq` 才前进）要等服务端往返、`botsChanged` 回来才改联系人的值，拍的那一刻读到的是交之前的。`from` 在基线拍到、
     * 路径读完之后算一次：`undefined` 是还没算，算出来（消息 id 或 null）就不再变，之后到的回复不画线。
     */
    let unreadMark: {readonly sessionId: string; baseline: number | null; from: string | null | undefined} | null = null;
    /** 联系人的“看到”。归属插件是别的插件，读它出错时记诊断、当作没读到：这次不画未读线，聊天照常打开。 */
    const seenOf = (owner: SessionOwner): number | null => {
        try {
            return deps.owners?.seenOf(owner) ?? null;
        } catch (error) {
            deps.report("conversation-owner-failed", `seen of ${owner.plugin}/${owner.id}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    const captureUnread = (target: Current): void => {
        const mark = unreadMark;
        if (mark === null || mark.sessionId !== target.id || current !== target) return;
        if (mark.baseline === null && target.owner !== null && target.owner !== undefined) mark.baseline = seenOf(target.owner);
        if (mark.baseline === null || mark.from !== undefined || target.loading) return;
        const baseline = mark.baseline;
        mark.from = target.transcript.messages().find((message) => (target.transcript.countedSeq(message.id) ?? 0) > baseline)?.id ?? null;
        bump();
    };
    const showUpTo = (target: Current, seq: number): void => {
        if (current === target && seq > shownSeq.value) shownSeq.value = seq;
    };
    const revision = ref(0);
    const nowValue = ref(deps.now());
    const bump = (): void => {
        revision.value += 1;
    };

    let current: Current | null = null;
    /** 打开的代数：切走之后，还在路上的结果不再算数。 */
    let generation = 0;
    let disposed = false;

    // 输入框
    let draft = {text: "", version: 0};
    let draftText = "";
    let notice: Text | null = null;
    /** 运行中受理压缩时给的那句话：运行结束就收掉。 */
    let queuedCompactNotice: Text | null = null;
    /** 说明挂上时路径上已有的压缩分隔线条数：多出一条就是排着的压缩做完了。 */
    let queuedCompactDividers = 0;
    /** 结果未知的乐观消息，可以重发（同一个指令 id）或移除。 */
    const unknownSends = new Map<string, PendingSend>();

    // 向导与停靠区
    let wizardState: AgentConversationContext["wizardState"];
    let dockState: AgentConversationContext["dockState"];
    /** 进行中的调用；集合没变就不换引用，轮次不因此重算（ctx `activeCalls`）。 */
    let activeCalls: readonly string[] = [];
    /** 上次推给视图的后代事项（会话 id 与事项 id）：子树推送只有它或 `activeCalls` 变了才重建 ctx。 */
    let descendantPending = "";
    /**
     * 切走的会话的向导与停靠区状态（conversation.md 输出 37：按会话存，切走再回来还在），最近的在后，至多 `KEPT_UI_STATES` 个。
     * 事项答完了的话，回来时 `afterChange` 会清。
     */
    const keptUiStates = new Map<string, {readonly wizard: AgentConversationContext["wizardState"]; readonly dock: AgentConversationContext["dockState"]}>();
    function keepUiState(id: string): void {
        keptUiStates.delete(id);
        if (wizardState !== undefined || dockState !== undefined) keptUiStates.set(id, {wizard: wizardState, dock: dockState});
        for (const oldest of keptUiStates.keys()) {
            if (keptUiStates.size <= KEPT_UI_STATES) break;
            keptUiStates.delete(oldest);
        }
    }
    const subagentData = shallowRef<SubagentData>({sessionId: null, tree: new Map(), jobs: new Map()});
    const subagentNow = ref(deps.now());
    let cancelSubagentTick: (() => void) | null = null;
    /** 卡片的 `now`：有进行中的项时每秒走，没有就停（不拖着整个 ctx）。 */
    const syncSubagentTicker = (active: boolean): void => {
        if (active && cancelSubagentTick === null) {
            const tick = (): void => {
                subagentNow.value = deps.now();
                cancelSubagentTick = deps.schedule(tick, TICK_MS);
            };
            tick();
        } else if (!active && cancelSubagentTick !== null) {
            cancelSubagentTick();
            cancelSubagentTick = null;
            subagentNow.value = deps.now();
        }
    };
    const subagents: SubagentStore = {
        data: subagentData,
        now: subagentNow,
        tail: async (jobId, lines) => {
            const session = subagentData.value.sessionId;
            if (session === null) return null;
            const tail = await remote.jobTail({sessionId: session, jobId, lines});
            return tail.ok ? tail.value : null;
        },
        status: async (jobId) => {
            const session = subagentData.value.sessionId;
            if (session === null) return null;
            const statuses = await remote.jobStatuses({sessionId: session, jobIds: [jobId]});
            return statuses.ok ? statuses.value[0] ?? null : null;
        },
        kill: async (jobId) => {
            const session = subagentData.value.sessionId;
            if (session === null) return;
            const killed = await remote.killJob({sessionId: session, jobId});
            if (!killed.ok && killed.code !== "job-unknown") {
                // 停不下来（jobs.md 输出 4）：它可能还在跑，原因里的码是会话给的。
                const stuck = killed.code === "stop-failed" ? (killed.detail as {code?: unknown} | undefined)?.code : undefined;
                notice = killed.code === "stop-failed" ? agentText("conversation.reject.stopFailed", {code: typeof stuck === "string" ? stuck : killed.code}) : agentText("conversation.reject.other", {code: killed.code});
                bump();
            }
        },
        stopRun: async (child) => {
            const stopped = await remote.abort({sessionId: child, commandId: deps.newId(), keepQueue: true});
            if (!stopped.ok) {
                notice = agentText("conversation.reject.other", {code: stopped.code});
                bump();
            }
        },
        runResult: async (child, runId) => {
            const result = await remote.runResult({sessionId: child, runId});
            return result.ok ? result.value : null;
        },
    };
    let previews = new Map<string, ApprovalPreviewView>();
    let stopRequestedAt: number | null = null;

    /** 还没写下去的草稿：`at` 是哪个会话的。切会话、发送时先写，定时写的是最新的字。 */
    let cancelDraftSave: (() => void) | null = null;
    let unsavedDraft: {readonly session: string; readonly text: string} | null = null;
    const flushDraft = (): void => {
        cancelDraftSave?.();
        cancelDraftSave = null;
        if (unsavedDraft !== null) deps.drafts.write(unsavedDraft.session, unsavedDraft.text);
        unsavedDraft = null;
    };
    const noteDraft = (text: string): void => {
        if (sessionId.value === null) return;
        unsavedDraft = {session: sessionId.value, text};
        cancelDraftSave?.();
        cancelDraftSave = deps.schedule(flushDraft, DRAFT_SAVE_DELAY_MS);
    };

    /** 换视图里的草稿，不算用户改的：切会话、读回存着的。 */
    const setDraftSilently = (text: string): void => {
        draft = {text, version: draft.version + 1};
        draftText = text;
    };

    const setDraft = (text: string): void => {
        setDraftSilently(text);
        noteDraft(text);
    };

    async function readChunks(fetch: (index: number) => Promise<{ok: true; value: {text: string; last: boolean}} | {ok: false; code: string}>): Promise<string | null> {
        let text = "";
        for (let index = 0; ; index += 1) {
            const page = await fetch(index);
            if (!page.ok) return null;
            text += page.value.text;
            if (page.value.last) return text;
        }
    }

    /** 把一条日志条目还原成事件；放不下的经 `eventChunk` 拼回。拼不回的跳过并写诊断，别的事件照常。 */
    async function eventOf(id: string, item: LogItem): Promise<unknown | null> {
        if (item.kind === "event") return item.event;
        const text = await readChunks((index) => remote.eventChunk({sessionId: id, seq: item.seq, index}) as never);
        if (text !== null) return JSON.parse(text) as unknown;
        deps.report("conversation-event-unreadable", `event ${String(item.seq)} of session ${id} could not be read`);
        return null;
    }

    /** 固定叶子分页取路径（打开、切分支时；回退后不能把各分支的日志接在一起）。 */
    async function loadPath(target: Current, leaf: string | null): Promise<boolean> {
        const events: unknown[] = [];
        let from = 0;
        for (;;) {
            const page = await remote.path({sessionId: target.id, leaf, from});
            if (!page.ok) return false;
            for (const item of page.value.items) {
                const event = await eventOf(target.id, item);
                if (event !== null) events.push(event);
            }
            if (!page.value.more) break;
            from = page.value.next;
        }
        if (current === target) target.transcript.applyPath(events);
        return true;
    }

    async function refresh(target: Current): Promise<void> {
        const epoch = modelEpoch;
        const snapshot = await remote.snapshot({sessionId: target.id});
        if (!snapshot.ok || current !== target) return;
        target.transcript.applySnapshot(snapshot.value);
        if (epoch !== modelEpoch) void refreshModel(target);
        await loadPath(target, snapshot.value.leaf);
        showUpTo(target, snapshot.value.head);
        void loadBranchPoints(target);
        bump();
    }

    /**
     * 解析到的模型只在快照里，日志与帧都不带：模型库变了（绑定角色、设密钥）或会话的模型设置变了，就重读一次，只取这一个字段
     * （不走 `refresh`：它重建路径，会清掉正在生成的那条）。`modelEpoch` 记变化的次数：只有最新一次的结果算数，
     * 打开或重连的整份快照若取得比变化早，读完再补一次。
     */
    let modelEpoch = 0;
    async function refreshModel(target: Current): Promise<void> {
        modelEpoch += 1;
        const epoch = modelEpoch;
        const snapshot = await remote.snapshot({sessionId: target.id});
        if (!snapshot.ok || current !== target || epoch !== modelEpoch) return;
        target.transcript.setModel(snapshot.value.model);
        bump();
    }

    /** 处理一帧。只有要拼大事件、要重取路径时才真的异步；这之前的先后由 `take` 排好。 */
    async function processFrame(target: Current, frame: RemoteFrame): Promise<void> {
        if (frame.type !== "log") {
            target.transcript.applyFrame(frame);
        } else {
            const event = frame.item.kind === "event" ? frame.item.event : await eventOf(target.id, frame.item);
            if (current !== target) return;
            if (event !== null && target.transcript.applyEvent(event) === "leaf-changed") await refresh(target);
            if (event !== null && changesResolvedModel(event)) void refreshModel(target);
            if (event !== null) showUpTo(target, (event as {seq: number}).seq);
        }
        afterChange(target);
    }

    /**
     * 一个接一个处理帧：大事件拼回来之前，后面的帧不能先走。没有活在排队、这一帧又不用等的时候同步处理，流式增量不多绕一个微任务。
     */
    let working = 0;
    function queueWork(target: Current, run: () => Promise<void>): void {
        working += 1;
        target.chain = target.chain.then(run).catch((error: unknown) => {
            deps.report("conversation-frame-failed", error instanceof Error ? error.message : String(error));
        }).finally(() => {
            working -= 1;
        });
    }

    function take(target: Current, frame: RemoteFrame): void {
        const immediate = working === 0 && (frame.type !== "log" || frame.item.kind === "event" && frame.item.event.type !== "leafChanged");
        if (immediate) void processFrame(target, frame);
        else queueWork(target, () => processFrame(target, frame));
    }

    /** 等用户的事项变了：给新的审批取预览；运行状态变了：开关计时。 */
    function afterChange(target: Current): void {
        if (current !== target || disposed) return;
        // 一次运行写了新的路径：可能多出分叉（重试、编辑重发），结束时取一次。
        const status = target.transcript.run().status;
        if (status === "idle" && lastRunStatus !== "idle") void loadBranchPoints(target);
        lastRunStatus = status;
        const pending = target.transcript.pending();
        for (const item of pending) if (item.kind === "approval" && !previews.has(item.id)) loadPreview(target, item.id, target.id);
        for (const child of target.tree) for (const item of child.pending ?? []) if (item.kind === "approval" && !previews.has(item.id)) loadPreview(target, item.id, child.id);
        // 这一批答完了：下一批从头来，不沿用“收起”和第几步。只看阻塞的：异步提问与后代的事项在停靠区，状态另存；有归属的会话（停靠档）
        // 自己的同步事项也在停靠区。
        if (!pending.some((item) => item.async !== true)) wizardState = undefined;
        const docked = (item: {readonly async?: boolean}): boolean => target.owner !== null || item.async === true;
        if (!pending.some(docked) && !target.tree.some((child) => (child.pending?.length ?? 0) > 0)) dockState = undefined;
        syncTicker(target);
        bump();
    }

    /** 事项 id 全局唯一（内核随机生成），所以预览按 id 存；取的时候按事项所在的会话。 */
    function loadPreview(target: Current, id: string, session: string): void {
        previews.set(id, {state: "loading"});
        void (async () => {
            const view = await fetchPreview(session, id);
            if (current !== target) return;
            previews.set(id, view);
            bump();
        })();
    }

    // ─── 附件 ───────────────────────────────────────────────────────────

    /** 这一条草稿的附件，按编辑器给的 `localId`。切会话时清掉：迟到的上传结果找不到自己，就不算数。 */
    type Uploading = {readonly file: File; state: "uploading" | "failed" | "ready"; error?: string; uploaded?: UploadedAttachment};
    let uploads = new Map<string, Uploading>();

    async function startUpload(localId: string, file: File): Promise<void> {
        const entry: Uploading = {file, state: "uploading"};
        uploads.set(localId, entry);
        bump();
        const owner = uploads;
        // 第一次加附件就建会话：地址要带会话 id。迟到时用户已经去了别的会话：`create` 不抢界面，这个附件标失败。
        const session = sessionId.value ?? await createOnce();
        if (owner !== uploads || uploads.get(localId) !== entry) return;
        if (session === null) {
            entry.state = "failed";
            entry.error = deps.text.t(agentText("conversation.attachment.noSession"));
            bump();
            return;
        }
        const result = await deps.attachments.upload(session, file);
        if (owner !== uploads || uploads.get(localId) !== entry) return;
        if (result.ok) {
            entry.state = "ready";
            entry.uploaded = result.value;
        } else {
            entry.state = "failed";
            entry.error = deps.text.t(agentText(result.code === "too-large" ? "conversation.attachment.tooLarge" : "conversation.attachment.failed", {code: result.code}));
        }
        bump();
    }

    /**
     * 这句话带哪些附件：按文字里的标签算，一个标签一项，范围指向标签，图片放在那个位置。用户删掉标签的不带；同一张图的标签出现两次，
     * 两处都放（内容相同的两次上传地址相同，也走这里）。代码片段与转义里的地址不是标签。
     */
    function attachmentsFor(text: string, candidates: readonly UploadedAttachment[]): UploadedAttachment[] {
        const byUri = new Map(candidates.map((candidate) => [candidate.uri, candidate]));
        return findPromptLinks(text).flatMap((link) => {
            const found = byUri.get(link.destination);
            if (found === undefined) return [];
            // 逐项取字段：路由还交回 `bytes` 这些，指令的校验不收多余的字段。
            const {uri, kind, name, mime, width, height} = found;
            return [{uri, kind, ...(name === undefined ? {} : {name}), ...(mime === undefined ? {} : {mime}), ...(width === undefined ? {} : {width}), ...(height === undefined ? {} : {height}), from: link.start, to: link.end} as UploadedAttachment];
        });
    }

    /** 发送时取走附件。交回的 `restore` 在明确被拒时放回：文字回到输入框，附件也得回去，不然用户要重选文件。 */
    function takeAttachments(text: string): {readonly attachments: readonly UploadedAttachment[]; restore(): void} {
        const taken = uploads;
        const ready = [...taken.values()].flatMap((entry) => (entry.uploaded === undefined ? [] : [entry.uploaded]));
        uploads = new Map();
        return {attachments: attachmentsFor(text, ready), restore: () => {
            uploads = new Map([...taken, ...uploads]);
        }};
    }

    // ─── 改写历史 ───────────────────────────────────────────────────────

    let editing: EditingView | null = null;
    let lastRunStatus: string = "idle";

    /** 打开、重连、运行结束都会取，并发时只有最新发起的算数：先发的可能读到分叉出现之前，结果却后到。 */
    let branchPointsToken = 0;
    async function loadBranchPoints(target: Current): Promise<void> {
        const token = ++branchPointsToken;
        const points = await remote.branchPoints({sessionId: target.id});
        if (current !== target || token !== branchPointsToken) return;
        if (!points.ok) {
            deps.report("conversation-branches-failed", points.code);
            return;
        }
        target.branchPoints = points.value;
        bump();
    }

    /**
     * 消息上的分支切换：分叉的孩子里，当前路径走的是哪个；切换器放在分叉之后第一条消息上。同一条消息是几处分叉之后的第一条时，
     * 取最近的那处：按路径顺序走，后面的盖前面的。
     */
    function branchesOf(target: Current): {views: Record<string, BranchView>; nodes: Map<string, readonly string[]>} {
        const views: Record<string, BranchView> = {};
        const nodes = new Map<string, readonly string[]>();
        const path = target.transcript.pathIds();
        const positions = new Map(path.map((id, index) => [id, index]));
        const messageIds = new Set(target.transcript.messages().map((message) => message.id));
        const located = target.branchPoints.flatMap((point) => {
            const at = point.parent === null ? -1 : positions.get(point.parent);
            return at === undefined ? [] : [{point, at}];
        }).sort((a, b) => a.at - b.at);
        for (const {point, at} of located) {
            const index = point.children.findIndex((child) => child.node === path[at + 1]);
            const message = path.slice(at + 1).find((id) => messageIds.has(id));
            if (index < 0 || message === undefined) continue;
            views[message] = {index: index + 1, total: point.children.length};
            nodes.set(message, point.children.map((child) => child.node));
        }
        return {views, nodes};
    }

    /** 按操作选回退目标（输出 25）。找不到就交回 null，不猜最近的。 */
    function rewindTargetFor(targets: readonly RewindTarget[], anchor: KernelAnchor, action: "retry" | "edit" | "branch", isUser: boolean): RewindTarget | null {
        const turn = targets.filter((item) => item.turnId === anchor.turnId);
        if (action === "edit") return turn.find((item) => item.kind === "before-turn") ?? null;
        const firstStep = turn.find((item) => item.kind === "after-step") ?? null;
        if (isUser) return firstStep;
        const step = turn.findIndex((item) => item.kind === "after-step" && item.id === anchor.modelParent);
        if (step < 0) return null;
        // 重试回到这条回复之前；从此处分支要留下这条回复，回到它之后：下一步之前，或这一轮结束处。
        return action === "retry" ? turn[step]! : turn[step + 1] ?? null;
    }

    /**
     * 同一个操作结果未知时再来一次，用同一个指令 id（内核按它幂等）：不然服务端其实受理了的话，会多写一条分支、多跑一轮。键是操作的
     * 全部身份：换了目标或文字就是新的操作。明确成功或被拒就忘掉。
     */
    const pendingCommands = new Map<string, string>();
    const commandIdOf = (key: string): string => {
        const known = pendingCommands.get(key);
        if (known !== undefined) return known;
        const id = commandId();
        pendingCommands.set(key, id);
        return id;
    };
    const settleCommand = (key: string, code?: string): void => {
        if (code === undefined || !UNKNOWN_OUTCOME.has(code)) pendingCommands.delete(key);
    };

    /** 复合操作（回退再开始）进行中：双击或连点两条消息时，第二次不算，免得后一次回退夹在前一次的回退和开始之间。 */
    let rewriting = false;

    /** 交回是否成功。失败时说明只写给还在看这个会话的人。 */
    async function rewriteHistory(messageId: string, action: "retry" | "edit" | "branch", resend?: string): Promise<boolean> {
        const target = current;
        if (target === null || rewriting) return false;
        rewriting = true;
        const fail = (code: string): false => {
            if (current === target) {
                notice = UNKNOWN_OUTCOME.has(code) ? agentText("conversation.history.unknown") : agentText("conversation.history.failed", {code});
                bump();
            }
            return false;
        };
        try {
            const anchor = target.transcript.anchorOf(messageId);
            const message = target.transcript.messages().find((item) => item.id === messageId);
            if (anchor === null || message === undefined) return fail("unknown-message");
            const targets = await remote.rewindTargets({sessionId: target.id});
            if (current !== target) return false;
            if (!targets.ok) return fail(targets.code);
            const to = rewindTargetFor(targets.value, anchor, action, message.kind === "user");
            // 已经退到这句话之后（从此处分支留下的暂停）：这句话的第一次请求还不存在，没有目标，直接接着跑。
            const pausedHere = to === null && action === "retry" && message.kind === "user" && target.transcript.messages().at(-1)?.id === messageId;
            if (to === null && !pausedHere) return fail("no-target");
            if (to !== null) {
                const key = `rewind:${target.id}:${to.id}:${resend ?? ""}`;
                const attachments = resend === undefined ? [] : attachmentsFor(resend, target.transcript.attachmentsOf(messageId) as unknown as readonly UploadedAttachment[]);
                const rewound = await remote.rewind({sessionId: target.id, commandId: commandIdOf(key), to: to.id, ...(resend === undefined ? {} : {resend: attachments.length === 0 ? {text: resend} : {text: resend, attachments}})});
                settleCommand(key, rewound.ok ? undefined : rewound.code);
                if (!rewound.ok) return fail(rewound.code);
            }
            if (action !== "retry") return true;
            // 用户已经离开这个会话：回退算做了，不再替他开跑。
            if (current !== target) return true;
            const key = `start:${target.id}:${to?.id ?? messageId}`;
            const started = await remote.start({sessionId: target.id, commandId: commandIdOf(key)});
            settleCommand(key, started.ok ? undefined : started.code);
            return started.ok ? true : fail(started.code);
        } finally {
            rewriting = false;
        }
    }

    async function switchBranch(messageId: string, direction: "previous" | "next"): Promise<void> {
        const target = current;
        if (target === null) return;
        const {views, nodes} = branchesOf(target);
        const view = views[messageId];
        const node = nodes.get(messageId)?.[(view?.index ?? 0) - 1 + (direction === "next" ? 1 : -1)];
        if (view === undefined || node === undefined) return;
        const result = await remote.switchBranch({sessionId: target.id, commandId: commandId(), node});
        if (!result.ok && current === target) {
            notice = agentText("conversation.history.failed", {code: result.code});
            bump();
        }
    }

    // ─── 分支树 ─────────────────────────────────────────────────────────

    let sessionTree: SessionTreeView | null = null;
    let treeToken = 0;

    function closeTree(): void {
        treeToken += 1;
        sessionTree = null;
    }

    /** 分页读整棵树的结构；读的时候不挡对话。 */
    async function loadTree(): Promise<void> {
        const target = current;
        const token = ++treeToken;
        if (target === null) return;
        sessionTree = {state: "loading", loaded: 0};
        bump();
        const nodes: SessionTreeNodeView[] = [];
        let afterSeq = 0;
        for (;;) {
            const page = await remote.treeNodes({sessionId: target.id, afterSeq});
            if (token !== treeToken || current !== target) return;
            if (!page.ok) {
                sessionTree = {state: "unavailable", reason: deps.text.t(agentText("conversation.history.failed", {code: page.code}))};
                bump();
                return;
            }
            for (const {id, parent, type, label} of page.value.nodes) nodes.push({id, parent, type, ...(label === undefined ? {} : {label})});
            afterSeq = page.value.through;
            if (!page.value.more) break;
            sessionTree = {state: "loading", loaded: nodes.length};
            bump();
        }
        sessionTree = {state: "ready", nodes, activePath: [...target.transcript.pathIds()]};
        bump();
    }

    async function activateTreeNode(node: string): Promise<void> {
        const target = current;
        if (target === null) return;
        const result = await remote.switchBranch({sessionId: target.id, commandId: commandId(), node});
        if (!result.ok && current === target) {
            notice = agentText("conversation.history.failed", {code: result.code});
            bump();
        }
    }

    // ─── 上下文详情 ─────────────────────────────────────────────────────

    /** 弹窗开着时的数据。系统提示词随同一次 `preview` 回来，展开时才交给视图，不常驻 `ctx`。 */
    let inspection: ContextInspectionView | null = null;
    let inspectionPrompt: SystemPromptView | null = null;
    let inspectionSystem: string | null = null;
    let inspectionToken = 0;

    function closeInspection(): void {
        inspectionToken += 1;
        inspection = null;
        inspectionPrompt = null;
        inspectionSystem = null;
    }

    async function refreshInspection(): Promise<void> {
        const target = current;
        const token = ++inspectionToken;
        const hadPrompt = inspectionPrompt !== null;
        if (target === null) return;
        inspection = {state: "loading"};
        bump();
        const preview = await fetchRequestPreview(target.id);
        if (token !== inspectionToken || current !== target) return;
        if (preview === null) {
            inspection = {state: "unavailable", reason: deps.text.t(agentText("conversation.context.unavailable"))};
            inspectionSystem = null;
            inspectionPrompt = null;
        } else {
            const {tokens} = preview;
            inspection = {
                state: "ready",
                estimated: tokens.estimated,
                window: tokens.window,
                threshold: tokens.threshold,
                areas: AREA_KEYS.map((key) => ({key, tokens: tokens.byArea[key]})),
                slots: preview.slots.map(({name, extension, tokens: slotTokens, placed}) => ({name, extension, tokens: slotTokens, placed})),
                diagnostics: preview.diagnostics.map(({id, level, message}) => ({id, level, message})),
            };
            inspectionSystem = preview.request.system.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n\n");
            inspectionPrompt = hadPrompt ? {text: inspectionSystem} : null;
        }
        bump();
    }

    async function fetchRequestPreview(session: string): Promise<PreviewResult | null> {
        const result = await remote.preview({sessionId: session});
        if (!result.ok) return null;
        if (result.value.kind === "inline") return result.value.preview;
        const {token} = result.value;
        const text = await readChunks((index) => remote.previewChunk({token, index}) as never);
        return text === null ? null : JSON.parse(text) as PreviewResult;
    }

    async function fetchPreview(session: string, interactionId: string): Promise<ApprovalPreviewView> {
        const result = await remote.approvalPreview({sessionId: session, interactionId});
        if (!result.ok) return {state: "failed"};
        const item: ApprovalPreviewItem = result.value;
        if (item.kind === "inline") return {state: "ready", files: [...item.preview.files]};
        const text = await readChunks((index) => remote.previewChunk({token: item.token, index}) as never);
        if (text === null) return {state: "failed"};
        return {state: "ready", files: [...(JSON.parse(text) as ApprovalPreview).files]};
    }

    let cancelTick: (() => void) | null = null;
    function syncTicker(target: Current): void {
        const running = target.transcript.run().status !== "idle";
        if (!running) stopRequestedAt = null;
        // 排着的压缩已经做过或运行已结束：“将在这一步结束后压缩”不再成立。
        if (queuedCompactNotice !== null && (!running || countCompactions(target) > queuedCompactDividers)) {
            if (notice === queuedCompactNotice) notice = null;
            queuedCompactNotice = null;
        }
        if (running && cancelTick === null) {
            const tick = (): void => {
                nowValue.value = deps.now();
                cancelTick = deps.schedule(tick, TICK_MS);
            };
            nowValue.value = deps.now();
            cancelTick = deps.schedule(tick, TICK_MS);
        } else if (!running && cancelTick !== null) {
            cancelTick();
            cancelTick = null;
            nowValue.value = deps.now();
        }
    }

    function closeCurrent(): void {
        current?.release?.();
        current = null;
        cancelTick?.();
        cancelTick = null;
        previews = new Map();
        wizardState = undefined;
        dockState = undefined;
        activeCalls = [];
        descendantPending = "";
        subagentData.value = {sessionId: null, tree: new Map(), jobs: new Map()};
        syncSubagentTicker(false);
        stopRequestedAt = null;
        unknownSends.clear();
        notice = null;
        closeInspection();
        closeTree();
        editing = null;
    }

    /**
     * 别的发出者的话的作者：宿主（插件）写它给的显示名（ui/agent-conversation-view.md）；父 Agent 写父会话的 Profile 名字与图标，
     * 读不到祖先时写“另一个会话”。
     */
    function authorOf(target: Current, by: KernelIssuer): {label: string; icon: string} {
        if (by.kind === "host") return {label: by.source.label, icon: "i-lucide-puzzle"};
        const ancestor = target.ancestors.find((item) => item.id === by.id);
        const profile = ancestor?.profile === null || ancestor?.profile === undefined ? undefined : deps.profiles().find((entry) => entry.key === ancestor.profile);
        return {label: profile?.name ?? deps.text.t(agentText("conversation.author.otherSession")), icon: ancestor?.icon ?? profile?.icon ?? "i-lucide-bot"};
    }

    /**
     * 子树与任务换了：卡片的数据经 `subagentData` 给（不进 ctx），只替换变了的项。ctx 只在后代的事项（停靠区）或进行中的调用
     * （`activeCalls`）变了时重建：后代每走一步工具都推一次，不能每次都让整个对话重算。
     */
    function publishSubtree(target: Current): void {
        if (current !== target) return;
        const previous = subagentData.value;
        const same = <T>(before: T | undefined, item: T): T => (before !== undefined && JSON.stringify(before) === JSON.stringify(item) ? before : item);
        const tree = new Map(target.tree.map((item) => [item.id, same(previous.tree.get(item.id), item)]));
        const jobs = new Map(target.jobs.map((item) => [item.id, same(previous.jobs.get(item.id), item)]));
        subagentData.value = {sessionId: target.id, tree, jobs};
        // 子代理的任务在两边都有（后代的 `runInvocation` 与任务的 `invocation` 是同一次调用），去重。
        const active = [...new Set([
            ...target.tree.flatMap((item) => (item.state !== "idle" && item.runInvocation !== undefined ? [item.runInvocation] : [])),
            ...target.jobs.flatMap((item) => (item.state === "running" || item.state === "question" ? [item.invocation] : [])),
        ])].sort();
        const callsChanged = active.join(" ") !== activeCalls.join(" ");
        if (callsChanged) activeCalls = active;
        // 还在加载时不走：页面显示的是加载中，加载失败也不该留下一个走着的计时器；到齐之后 `open` 会再推一次。
        if (!target.loading) syncSubagentTicker(active.length > 0);
        const pending = target.tree.flatMap((item) => (item.pending ?? []).map((entry) => `${item.id}/${entry.id}`)).join(" ");
        const pendingChanged = pending !== descendantPending;
        descendantPending = pending;
        if (!callsChanged && !pendingChanged) return;
        // 路径还没到时事项表是空的：这时走 `afterChange` 会把重开前保留的向导状态当成“答完了”清掉。到齐之后 `open` 会走一次。
        if (target.loading) bump();
        else afterChange(target);
    }

    /**
     * 跟着这个会话的后代与任务：先订阅再取（重连时重取）。后代等用户的事项进停靠区，所以它们的审批也要取预览（`afterChange`）。
     * 交回取消订阅的函数。
     */
    async function followSubtree(target: Current): Promise<() => void> {
        // 取不到时卡片退回调用自己的结果、停靠区里没有后代的事项：界面上没有别的线索，留诊断。
        const reloadTree = async () => {
            const tree = await remote.tree({sessionId: target.id});
            if (!tree.ok) deps.report("conversation-subtree-failed", `tree of session ${target.id}: ${tree.code}`);
            else if (current === target) {
                target.tree = tree.value;
                publishSubtree(target);
            }
        };
        const reloadJobs = async () => {
            const jobs = await remote.jobs({sessionId: target.id});
            if (!jobs.ok) deps.report("conversation-subtree-failed", `jobs of session ${target.id}: ${jobs.code}`);
            else if (current === target) {
                target.jobs = jobs.value;
                publishSubtree(target);
            }
        };
        const [treeSubscription, jobsSubscription] = await Promise.all([
            remote.events.treeChanged.subscribe({sessionId: target.id}, (items) => {
                target.tree = items;
                publishSubtree(target);
            }, {onResync: () => void reloadTree()}),
            remote.events.jobsChanged.subscribe({sessionId: target.id}, (items) => {
                target.jobs = items;
                publishSubtree(target);
            }, {onResync: () => void reloadJobs()}),
        ]);
        for (const [name, subscription] of [["tree", treeSubscription], ["jobs", jobsSubscription]] as const) {
            if (!subscription.ok) deps.report("conversation-subtree-failed", `subscribing to ${name} of session ${target.id}: ${subscription.code}`);
        }
        await Promise.all([reloadTree(), reloadJobs()]);
        return () => {
            if (treeSubscription.ok) treeSubscription.value.release();
            if (jobsSubscription.ok) jobsSubscription.value.release();
        };
    }

    /** 每打开一次会话加一，借用时重新订阅同一个会话不算（`SessionHost.opened`）。 */
    const opened = shallowRef(0);
    /**
     * 打开会话的入口。编辑区页面的宿主（`owners.elsewhere`）先读会话头：有归属的交给消息视图，不在这里开；读会话头期间又打开了别的
     * （`routing` 变了），这次作废。其余宿主直接打开，档位在打开时按归属定（`openHere`）。
     */
    let routing = 0;
    async function open(id: string, options: {readonly keepDraft?: boolean} = {}): Promise<void> {
        const owners = deps.owners;
        if (owners?.elsewhere === undefined) return openHere(id, options);
        // 编辑区页面：有归属的会话交给消息视图。读会话头期间又打开了别的，这次作废。
        const asked = (routing += 1);
        const known = owners.known(id);
        const owner = known !== undefined ? known : await owners.ownerOf(id);
        if (asked !== routing || disposed) return;
        if (owner !== null && owner !== "unreadable" && owner !== "missing") {
            await owners.elsewhere(id);
            return;
        }
        await openHere(id, options);
    }

    /**
     * `reattach`：借用数归零放开订阅之后，再借用时重新订阅同一个会话（`borrow()`）。它不是一次打开：不加 `opened`、不写最近的会话。
     * 书房的面板随开关挂卸，若算一次打开，会作废用户刚点的联系人（`contact-opener.ts` 把不是自己引起的打开当成聊天区被别处换了）。
     */
    async function openHere(id: string, options: {readonly keepDraft?: boolean; readonly reattach?: boolean} = {}): Promise<void> {
        routing += 1;
        generation += 1;
        const token = generation;
        // 向导与停靠区的状态按会话记：切走时记下这一个的，再取要打开的那个的（同一个会话重新打开也是这样拿回来）。
        if (sessionId.value !== null) keepUiState(sessionId.value);
        const kept = keptUiStates.get(id);
        const switching = sessionId.value !== id;
        // 还没有会话时选的模式只属于接下来新建的那一个；打开别的会话就作废，否则会悄悄带到以后新建的会话。
        draftMode = "normal";
        flushDraft();
        closeCurrent();
        wizardState = kept?.wizard;
        dockState = kept?.dock;
        // A 会话没发的字不带到 B；还没有会话时写的字留着（第一次发送才建会话）。附件的地址带会话 id，只有为它们新建的会话（`keepDraft`）才能接着用。
        if (switching && !options.keepDraft) {
            if (sessionId.value !== null) setDraftSilently("");
            uploads = new Map();
        }
        // 作者按祖先算：祖先与路径一起取，路径上的话应用之前就到了（`authorOf` 读的是 `target.ancestors`）。
        const owners = deps.owners;
        const target: Current = {id, transcript: createKernelTranscript({toolName: displayToolName, authorOf: (by) => authorOf(target, by), pinned: () => target.owner !== null && target.owner !== undefined}), release: null, chain: Promise.resolve(), failed: null, loading: true, branchPoints: [], tree: [], jobs: [], ancestors: [], owner: owners === undefined ? null : owners.known(id), headerUnreadable: false};
        current = target;
        sessionId.value = id;
        shownSeq.value = 0;
        if (unreadMark?.sessionId !== id) unreadMark = {sessionId: id, baseline: null, from: undefined};
        painting.value = {sessionId: id, startedAt: deps.now(), reattach: options.reattach === true, loaded: null};
        captureUnread(target);
        if (options.reattach !== true) {
            opened.value += 1;
            deps.recent.write(id);
        }
        bump();
        // 归属与快照同时读；读到之前按最严的档。读不到记打开失败、走现有的重试，不当成没有归属。路径等它读到再应用：适配器在合成消息
        // 时按归属选说法（`pinned`），合成之后不改。
        let ownerRead: Promise<void> = Promise.resolve();
        if (owners !== undefined && target.owner === undefined) {
            ownerRead = owners.ownerOf(id).then((owner) => {
                if (current !== target) return;
                if (owner === "unreadable") {
                    target.headerUnreadable = true;
                    // 快照那边已有更具体的失败码时留着它；画面上照样是打开失败、可重试。
                    target.failed ??= {code: "header-unreadable"};
                } else target.owner = owner === "missing" ? null : owner;
                afterChange(target);
                captureUnread(target);
                bump();
            }).catch((error: unknown) => {
                // 归属插件的身份读出错（`afterChange` 重算档位时读）：与读不到会话头同样处理，不让打开卡在读取中。
                deps.report("conversation-owner-failed", `owner of session ${id}: ${error instanceof Error ? error.message : String(error)}`);
                if (current !== target) return;
                target.headerUnreadable = true;
                target.failed ??= {code: "header-unreadable"};
                bump();
            });
        }
        void deps.drafts.read(id).then((saved) => {
            // 读回来之前用户已经打了字：不盖掉。
            if (saved !== null && current === target && draftText === "") setDraftSilently(saved);
            bump();
        }).catch((error: unknown) => deps.report("conversation-draft-failed", String(error)));

        const early: RemoteFrame[] = [];
        /** 快照返回时 `early` 有多长：这之前的状态帧过时了，这之后的是快照之后的变化，不能丢（输出 5）。 */
        let staleUntil = 0;
        let live = false;
        const subscription = await remote.events.frames.subscribe({sessionId: id}, (frame) => {
            if (current !== target) return;
            if (live) take(target, frame);
            else early.push(frame);
        }, {
            // 重连期间丢的帧不补增量：按现在的快照与路径重建，正在生成的那条从下一个增量接着显示。
            onResync: () => queueWork(target, () => refresh(target)),
            onEnd: (reason) => {
                if (current !== target) return;
                // 服务端换了进程走应用的重新加载页，这里不用再说一遍。
                if (reason !== "server-restarted") target.failed = {code: String(reason)};
                bump();
            },
        });
        if (token !== generation) {
            if (subscription.ok) subscription.value.release();
            return;
        }
        if (!subscription.ok) {
            target.failed = {code: subscription.code};
            bump();
            return;
        }
        // 子树与快照、祖先互不依赖，一起取（子树自己先订阅再取）。
        const epoch = modelEpoch;
        const [releaseSubtree, snapshot, ancestors] = await Promise.all([followSubtree(target), remote.snapshot({sessionId: id}), remote.ancestors({sessionId: id})]);
        target.release = () => {
            subscription.value.release();
            releaseSubtree();
        };
        if (token !== generation) {
            target.release();
            return;
        }
        if (ancestors.ok) target.ancestors = ancestors.value;
        else deps.report("conversation-ancestors-failed", `ancestors of session ${id}: ${ancestors.code}`);
        if (!snapshot.ok) {
            target.failed = {code: snapshot.code};
            bump();
            return;
        }
        staleUntil = early.length;
        target.transcript.applySnapshot(snapshot.value);
        if (epoch !== modelEpoch) void refreshModel(target);
        await ownerRead;
        if (token !== generation) return;
        const loaded = await loadPath(target, snapshot.value.leaf);
        if (token !== generation) return;
        if (loaded) showUpTo(target, snapshot.value.head);
        if (!loaded) {
            target.failed = {code: "path-unavailable"};
            bump();
            return;
        }
        target.loading = false;
        live = true;
        syncSubagentTicker(activeCalls.length > 0);
        void loadBranchPoints(target);
        // 日志帧不大于 `head` 的由适配器丢掉。
        early.forEach((frame, index) => {
            if (frame.type !== "status" || index >= staleUntil) take(target, frame);
        });
        await target.chain;
        afterChange(target);
        if (current !== target) return;
        painting.value = {...painting.value!, loaded: {events: snapshot.value.head}};
        captureUnread(target);
    }

    async function createSession(profile: string): Promise<string | null> {
        // 新建是用户的动作：还在读会话头的恢复让给它（`routing`），不在建好之后把“最近的会话”盖上来。
        routing += 1;
        // 建好之前用户去了别的会话：不抢界面。建好的空会话留在列表里。
        const started = generation;
        const created = await remote.create({profile, ...(deps.project === null ? {} : {project: deps.project})});
        if (!created.ok) {
            notice = agentText("conversation.createFailed", {code: created.code});
            bump();
            return null;
        }
        if (generation !== started) return null;
        const mode = draftMode;
        await openHere(created.value.sessionId, {keepDraft: sessionId.value === null});
        // 要建的 Profile 有模式才提交草稿的模式。`open` 已经把草稿的模式清了，所以先取出来。
        if (mode !== "normal" && profileHasModes(profile)) await setMode(mode);
        return created.value.sessionId;
    }

    /**
     * 正在建的会话，不论是新建命令、第一次发送还是加附件发起的。隐式的新建（`createOnce`）遇到它就等它、用它建出的会话：用户点了新建
     * 紧接着加附件或发话时不再建第二个（后建好的那个作废，附件跟着丢）；几个附件一起加也只建一个。`create` 没有幂等键：失败或结果未知
     * 不重试，免得多建，附件标失败，用户再加。
     */
    let creating: Promise<string | null> | null = null;
    function create(profile = MAIN_PROFILE): Promise<string | null> {
        const started: Promise<string | null> = createSession(profile).finally(() => {
            if (creating === started) creating = null;
        });
        creating = started;
        return started;
    }
    function createOnce(): Promise<string | null> {
        return creating ?? create();
    }

    const failedToOpen = (id: string): boolean => current?.id === id && current.failed !== null;
    /** 经函数读：`await` 之后 TypeScript 仍按之前的判断把 `current` 收窄成 null。 */
    const headerUnreadable = (): boolean => current?.headerUnreadable === true;

    async function restore(): Promise<void> {
        // 恢复期间用户又打开了别的会话（`open` 记了号，还在读会话头）：让给它，不恢复。
        const asked = routing;
        const id = await deps.recent.read();
        if (id === null || current !== null || asked !== routing || disposed) return;
        // 有归属的会话照常恢复：它就在消息视图里（编辑区页面的宿主经 `open` 交给消息视图，自己不开）。
        if (deps.owners?.elsewhere !== undefined) await open(id);
        else await openHere(id);
        // 记录里的会话不在了：显示未选择，不留一个打不开的。读不到会话头不等于不在了（服务端刚重启），记录留着。
        if (failedToOpen(id) && !headerUnreadable()) {
            closeCurrent();
            sessionId.value = null;
            deps.recent.write(null);
            bump();
        }
    }

    const commandId = (): string => deps.newId();

    /** 排队区的一条（conversation.md 输出 48）：别人排的带作者、只能取消；留着的带原因。 */
    function queuedView(target: Current, item: KernelQueued) {
        return {
            id: item.id,
            text: item.text,
            delivery: item.mode,
            ...(item.by === undefined ? {} : {author: authorOf(target, item.by), editable: false}),
            ...(item.state === "held" ? {held: {reason: heldReason(item, (ref) => deps.text.t(ref))}} : {}),
        };
    }

    /** 发出时会一并以拒绝结算的事项数（有归属的会话）：这个会话自己的同步事项，不含异步提问与后代会话的（runtime.md 输出 111）。 */
    const settleCount = (target: Current | null): number => (target === null ? 0 : target.transcript.pending().filter((item) => item.async !== true).length);

    /**
     * 待发的提醒排在话的后面（conversation.md 输出 51）：标签“提醒 · 来源”，只能取消。门关着、又没有运行时按留着画，计进“已暂停 N 条”，
     * “继续”与空着回车把它们送出去；有运行时下一次请求就会带上它们，不算留着。
     */
    function noticeViews(target: Current) {
        const held = target.transcript.wakeGateOpen() || target.transcript.run().status !== "idle" ? {} : {held: {reason: deps.text.t(agentText("conversation.held.notice"))}};
        return target.transcript.notices().map((notice: KernelNotice) => ({
            id: notice.id,
            text: notice.summary,
            delivery: "steer" as const,
            author: {label: deps.text.t(agentText("conversation.author.notice", {name: authorOf(target, notice.by).label})), icon: "i-lucide-bell"},
            editable: false,
            ...(notice.senderOnly ? {removable: false} : {}),
            ...held,
        }));
    }

    /** 停止的第二个选项（输出 49）：在跑、缓冲区里有用户自己的话时给出，条数是全部条数（用户的停止清空全部）。 */
    function stopClearingOf(target: Current | null): {readonly count: number} | null {
        if (target === null || target.transcript.run().status === "idle") return null;
        const queue = target.transcript.queue();
        return queue.some((item) => item.by === undefined) ? {count: queue.length} : null;
    }

    /** 发送结果未知：消息标出来，可以重发或移除，重发带上原来的附件。明确被拒：撤掉，文字与附件放回输入框，说明原因。 */
    function settleSend(target: Current, optimisticId: string, sent: PendingSend, result: {ok: boolean; code?: string; value?: {readonly value?: {readonly placement?: string}}}): void {
        if (current !== target) return;
        if (result.ok) {
            // 受理了。交给运行的（`taken`）等它的 `input` 按 `commandId` 确认：实时帧与重连后按路径重建都会清（nb-agent-ui 的转录器），
            // 合并的那一条前面还有别人的话先跑时，它要留着显示“前面还有 N 条”。别的去向排队区会显示它，这里撤掉。
            if (result.value?.value?.placement !== "taken") target.transcript.removeOptimistic(optimisticId);
            bump();
            return;
        }
        if (UNKNOWN_OUTCOME.has(result.code ?? "")) {
            target.transcript.markOptimisticUnknown(optimisticId);
            unknownSends.set(optimisticId, sent);
        } else {
            target.transcript.removeOptimistic(optimisticId);
            const typed = sent.typed === undefined ? sent.input.text : sent.typed;
            if (typed !== null) setDraft(draftText === "" ? typed : `${draftText}\n${typed}`);
            sent.restore();
            const key = REJECT_KEYS[result.code as keyof typeof REJECT_KEYS];
            notice = key === undefined ? agentText("conversation.reject.other", {code: result.code ?? ""}) : agentText(key);
        }
        bump();
    }

    async function submit(text: string, delivery: "prompt" | "steer" | "followup"): Promise<void> {
        notice = null;
        setDraft("");
        bump();
        if (current === null && (await createOnce()) === null) {
            setDraft(text);
            bump();
            return;
        }
        const target = current!;
        const {attachments, restore} = takeAttachments(text);
        const input = attachments.length === 0 ? {text} : {text, attachments: [...attachments]};
        if (delivery === "prompt" && target.transcript.queue().some((item) => item.state === "held")) {
            await continueRun(target, {text, attachments, restore});
            return;
        }
        // 有归属的会话（bot 档）一律走 `send`：运行中带投递方式，有挂着的同步事项时一并以拒绝结算（`enqueue` 不收 `settlePending`）。
        const ownedSend = target.owner === null ? null : {
            ...(delivery === "prompt" ? {} : {mode: delivery}),
            ...(settleCount(target) > 0 ? {settlePending: "deny" as const} : {}),
        };
        if (delivery === "prompt" || ownedSend !== null) {
            const id = commandId();
            const optimisticId = `optimistic-${id}`;
            target.transcript.addOptimistic({id: optimisticId, commandId: id, text, timestamp: deps.now()});
            bump();
            const sent: PendingSend = {commandId: id, input, restore, ...ownedSend};
            settleSend(target, optimisticId, sent, await remote.send({sessionId: target.id, commandId: id, input, ...ownedSend}));
            return;
        }
        const queued = await remote.enqueue({sessionId: target.id, commandId: commandId(), input, mode: delivery});
        if (!queued.ok && !UNKNOWN_OUTCOME.has(queued.code) && current === target) {
            setDraft(text);
            restore();
            notice = agentText("conversation.reject.other", {code: queued.code});
            bump();
        }
    }

    /** 继续进行中（含两步之间）：头行的“继续”与发送键不可用（conversation.md 输出 50）。 */
    let continuing = false;

    /**
     * 有留着的话或中断的运行时的继续（conversation.md 输出 50 的表）。`typed` 是空闲时写了字回车的那句（连同它的附件），空着继续为 null。
     * 合并：用户留着的话（与写的字）合成一条走 `send{replaces}`；空着继续且用户留着的不到两条时走 `resume{keep}`；中断的运行先 `start`
     * 接着跑，再在这次运行里发。保留与按排队顺序：`resume{mode}`，写了字时 `send{release: mode}`。
     */
    async function continueRun(target: Current, typed: {readonly text: string; readonly attachments: readonly UploadedAttachment[]; restore(): void} | null): Promise<void> {
        if (continuing) {
            if (typed !== null) {
                setDraft(typed.text);
                typed.restore();
            }
            return;
        }
        continuing = true;
        bump();
        const fail = (code: string): void => {
            if (current !== target) return;
            if (typed !== null) {
                setDraft(draftText === "" ? typed.text : `${draftText}\n${typed.text}`);
                typed.restore();
            }
            notice = agentText("conversation.continue.failed", {code});
            bump();
        };
        try {
            const mode = deps.resumeMode();
            const idle = target.transcript.run().status === "idle";
            const input = typed === null ? null : typed.attachments.length === 0 ? {text: typed.text} : {text: typed.text, attachments: [...typed.attachments]};
            if (mode !== "merge" && input === null) {
                const done = await remote.resume({sessionId: target.id, commandId: commandId(), mode});
                if (!done.ok && done.code !== "nothing-to-resume") fail(done.code);
                return;
            }
            if (mode !== "merge" && input !== null) {
                // 写了字：与普通发送一样有乐观消息，结果未知时可以用同一个指令 id 重发（带上放行方式）。
                const id = commandId();
                const optimisticId = `optimistic-${id}`;
                target.transcript.addOptimistic({id: optimisticId, commandId: id, text: input.text, timestamp: deps.now()});
                bump();
                const sent: PendingSend = {commandId: id, input, release: mode, typed: typed!.text, restore: typed!.restore};
                settleSend(target, optimisticId, sent, await remote.send({sessionId: target.id, commandId: id, input, release: mode}));
                return;
            }
            // 合并：中断的运行先接着跑（空闲时）；第二步之前它已被停止或已收口就不再发。
            if (idle && target.transcript.interrupted()) {
                const started = await remote.start({sessionId: target.id, commandId: commandId()});
                if (!started.ok) {
                    fail(started.code);
                    return;
                }
                if (current !== target) return;
                // 按这次运行自己的结果判断，不看转录器的状态：`start` 的回应可能先于状态帧到达。
                const ended = await remote.runResult({sessionId: target.id, runId: started.value.value.runId});
                if (current !== target) return;
                if (!ended.ok || ended.value !== null || target.transcript.run().status === "stopping") {
                    if (typed !== null) {
                        setDraft(draftText === "" ? typed.text : `${draftText}\n${typed.text}`);
                        typed.restore();
                    }
                    notice = agentText("conversation.continue.stopped");
                    bump();
                    return;
                }
            }
            await sendMerged(target, typed, input);
        } finally {
            continuing = false;
            if (current === target) bump();
        }
    }

    /** 合并的一条：用户留着的话（与写的字）合成；空着继续、用户留着的不到两条时只放行。`input-stale` 时按新的快照重新合成、再发一次。 */
    async function sendMerged(target: Current, typed: {readonly text: string; readonly attachments: readonly UploadedAttachment[]; restore(): void} | null, input: {readonly text: string; readonly attachments?: readonly UploadedAttachment[]} | null): Promise<void> {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const userHeld = target.transcript.queue().filter((item) => item.state === "held" && item.by === undefined);
            if (typed === null && userHeld.length < 2) {
                const resumed = await remote.resume({sessionId: target.id, commandId: commandId(), mode: "keep"});
                if (!resumed.ok && resumed.code !== "nothing-to-resume" && current === target) {
                    notice = agentText("conversation.continue.failed", {code: resumed.code});
                    bump();
                }
                return;
            }
            const merged = mergeHeld(userHeld.map((item) => ({id: item.id, edits: item.edits, text: item.text, attachments: (item.attachments ?? []) as unknown as readonly UploadedAttachment[]})), input);
            const id = commandId();
            const optimisticId = `optimistic-${id}`;
            target.transcript.addOptimistic({id: optimisticId, commandId: id, text: merged.input.text, timestamp: deps.now()});
            bump();
            const sent: PendingSend = {commandId: id, input: merged.input, ...(merged.replaces.length === 0 ? {} : {replaces: merged.replaces}), typed: typed?.text ?? null, restore: typed?.restore ?? (() => undefined)};
            const result = await remote.send({sessionId: target.id, commandId: id, input: merged.input, ...(sent.replaces === undefined ? {} : {replaces: sent.replaces})});
            // 留着的话在读到之后被改过或取消了：撤掉这条，按新的快照再合成一次（不重做 `start`）。
            if (!result.ok && result.code === "input-stale" && attempt === 0) {
                target.transcript.removeOptimistic(optimisticId);
                // 缓冲区按快照重取：改动的帧未必先于这次回应到达。快照只换会话级的状态（缓冲区、标题、设置），不动路径。
                const snapshot = await remote.snapshot({sessionId: target.id});
                if (current !== target) return;
                if (snapshot.ok) target.transcript.applySnapshot(snapshot.value);
                continue;
            }
            settleSend(target, optimisticId, sent, result);
            return;
        }
    }

    const countCompactions = (target: Current): number => target.transcript.messages().filter((message) => message.kind === "system" && message.source === "compaction").length;

    async function newCommand(): Promise<void> {
        setDraft("");
        uploads = new Map();
        bump();
        await create();
    }

    /** 结果未知时再来一次用同一个指令 id：服务端其实建好了的话交回同一个新会话，不多建（runtime.md 输出 37）。 */
    let pendingFork: {readonly session: string; readonly commandId: string} | null = null;
    async function forkCommand(): Promise<void> {
        const target = current;
        const typed = draftText;
        setDraft("");
        bump();
        if (target === null) {
            notice = agentText("conversation.compact.noSession");
            bump();
            return;
        }
        const id = pendingFork?.session === target.id ? pendingFork.commandId : commandId();
        pendingFork = {session: target.id, commandId: id};
        const result = await remote.fork({sessionId: target.id, commandId: id});
        if (result.ok) {
            pendingFork = null;
            if (current === target) await open(result.value.value.sessionId);
            return;
        }
        if (current !== target) return;
        if (UNKNOWN_OUTCOME.has(result.code)) {
            notice = agentText("conversation.fork.unknown");
        } else {
            pendingFork = null;
            setDraft(typed);
            notice = agentText("conversation.history.failed", {code: result.code});
        }
        bump();
    }

    async function renameCommand(title: string): Promise<void> {
        const target = current;
        if (target === null || title.trim() === "") {
            notice = agentText("conversation.renameCommand.needTitle");
            bump();
            return;
        }
        const typed = draftText;
        setDraft("");
        bump();
        const result = await remote.setTitle({sessionId: target.id, commandId: commandId(), title: title.trim()});
        if (!result.ok && current === target) {
            setDraft(typed);
            notice = agentText("conversation.history.failed", {code: result.code});
            bump();
        }
    }

    /** 手动压缩（docs/specs/agent/conversation.md 输出 20）：不新建会话，不发送文字，被拒时文字放回输入框。 */
    async function compactCommand(argsText: string): Promise<void> {
        const typed = argsText === "" ? "/compact" : `/compact ${argsText}`;
        const target = current;
        notice = null;
        if (target === null) {
            notice = agentText("conversation.compact.noSession");
            bump();
            return;
        }
        setDraft("");
        bump();
        const result = await remote.compact({sessionId: target.id, commandId: commandId(), ...(argsText === "" ? {} : {requirement: argsText})});
        if (current !== target) return;
        if (result.ok) {
            // 运行中受理的在下一个边界做：给一句话，运行结束时收掉。
            // 回复到的时候运行可能已经结束：那就没有“下一步”可等，不挂说明。
            if (result.value.value.scheduled === "next-boundary" && target.transcript.run().status !== "idle") {
                notice = agentText("conversation.compact.queued");
                queuedCompactNotice = notice;
                queuedCompactDividers = countCompactions(target);
            }
        } else if (UNKNOWN_OUTCOME.has(result.code)) {
            notice = agentText("conversation.compact.unknown");
        } else {
            setDraft(typed);
            const key = COMPACT_REJECT_KEYS[result.code as keyof typeof COMPACT_REJECT_KEYS];
            notice = key === undefined ? agentText("conversation.reject.other", {code: result.code}) : agentText(key);
        }
        bump();
    }

    /** `sessionId`：事项所在的会话（停靠区里后代的事项）；缺省是当前会话。 */
    async function resolveInput(id: string, resolutions: {kind: "approval"; decision: "allow" | "allow-session" | "allow-always" | "deny"; note?: string} | {kind: "mode-switch"; answer: {approved: boolean; approvalMode?: string; note?: string}} | {kind: "question"; answer: {text: string; data: {answers: unknown}}}, sessionId?: string): Promise<void> {
        const target = current;
        if (target === null) return;
        const session = sessionId ?? target.id;
        if (resolutions.kind === "approval" && resolutions.decision === "allow-always") {
            const request = session === target.id
                ? target.transcript.pending().find((item) => item.id === id)?.request
                : target.tree.find((child) => child.id === session)?.pending?.find((item) => item.id === id)?.request;
            const rules = rulesToRemember((request ?? {}) as {tool?: string; remember?: unknown});
            // 存不下也批准：用户已经点了同意，这次与本会话不受影响，只是下次还会问（输出 23）。
            const saved = rules.length === 0 ? null : await deps.rememberRules(rules);
            await resolveInput(id, {kind: "approval", decision: "allow-session"}, sessionId);
            if (saved?.ok === false && current === target) {
                notice = agentText("conversation.reject.ruleNotSaved", {code: saved.code});
                bump();
            }
            return;
        }
        const answer = resolutions.kind === "mode-switch"
            // 内核要求回答有文字，写进日志；工具看的是 `data`。
            ? {text: resolutions.answer.note ?? deps.text.t(agentText(resolutions.answer.approved ? "conversation.modeSwitch.approved" : "conversation.modeSwitch.declined")), data: resolutions.answer}
            : resolutions.kind === "question" ? resolutions.answer : null;
        const result = answer === null && resolutions.kind === "approval"
            ? await remote.resolve({sessionId: session, commandId: commandId(), id, decision: resolutions.decision, ...(resolutions.note === undefined ? {} : {note: resolutions.note})})
            : await remote.resolve({sessionId: session, commandId: commandId(), id, decision: "answer", answer: answer as never});
        // 别的窗口先答了：向导跟着服务端的状态走，不报错（输出 14）。
        if (!result.ok && result.code !== "already-answered" && result.code !== "unknown-interaction" && current === target) {
            notice = agentText("conversation.reject.other", {code: result.code});
            bump();
        }
    }

    const modeLabel = (mode: string): string => deps.text.t(agentText(`conversation.mode.${mode as AgentMode}`));
    /** 还没有会话时选的模式：建好会话、第一次发送之前提交，这样能先开 `plan` 再发第一条（modes.md 输出 7）。 */
    let draftMode: AgentMode = "normal";
    const modeOfCurrent = (target: Current | null): AgentMode => (target === null ? draftMode : ((target.transcript.meta()?.extensionSettings[AGENT_MODES_EXTENSION]?.mode ?? "normal") as AgentMode));

    /** 这个 Profile 有没有 Agent 模式：按目录判。控件、`/plan`、`/mode`、新建时提交草稿模式都经这里。 */
    const profileHasModes = (key: string | undefined): boolean => hasModes(key === undefined ? undefined : deps.profiles().find((entry) => entry.key === key));
    /** 这个会话（没有会话时是隐式新建的主创）有没有 Agent 模式。 */
    const modesAvailable = (target: Current | null): boolean => profileHasModes(target === null ? MAIN_PROFILE : (target.transcript.meta()?.profile ?? undefined));

    /** 切模式；交回切成了没有。控件、`/plan`、`/mode` 都经这里：没有模式的会话不发请求，提示原因。 */
    async function setMode(mode: AgentMode): Promise<boolean> {
        const target = current;
        if (!modesAvailable(target)) {
            notice = agentText("conversation.mode.unavailable");
            bump();
            return false;
        }
        if (target === null) {
            draftMode = mode;
            bump();
            return true;
        }
        const result = await remote.changeSettings({sessionId: target.id, commandId: commandId(), patch: {[AGENT_MODES_EXTENSION]: {mode}}});
        if (!result.ok && current === target) {
            // 目录说有模式、会话的装配里却没有（用户级 Profile 改了引用，会话还没重新装配）。
            notice = result.code === "unknown-extension" ? agentText("conversation.mode.unavailable") : agentText("conversation.reject.other", {code: result.code});
            bump();
        }
        return result.ok;
    }

    /** `/plan [文字]`：切到 `plan`，已在 `plan` 不动；带文字时切完发出去。没切成就不发（那句话是要在计划模式下处理的），文字留在输入框。 */
    async function planCommand(argsText: string): Promise<void> {
        const target = current;
        const text = argsText.trim();
        if (modeOfCurrent(target) !== "plan" && !(await setMode("plan"))) return;
        // 切的这段时间用户去了别的会话：那句话是给原来那个会话的，不发到新会话里。
        if (text !== "" && current === target) await submit(text, "prompt");
    }

    /** `/mode [名字]`：只管 Agent 模式，接 key 与显示名；没写切下一种。 */
    async function modeCommand(argsText: string): Promise<void> {
        // 先看有没有模式：没有模式的会话里报“没有 Agent 模式”，不报名字不对（modes.md 输出 12）。
        if (!modesAvailable(current)) {
            await setMode(modeOfCurrent(current));
            return;
        }
        const name = argsText.trim();
        const index = MODE_OPTIONS.findIndex((option) => option.key === modeOfCurrent(current));
        const found = name === "" ? MODE_OPTIONS[(index + 1) % MODE_OPTIONS.length] : MODE_OPTIONS.find((option) => option.key === name || modeLabel(option.key) === name);
        if (found === undefined) {
            setDraft(`/mode ${name}`);
            notice = agentText("conversation.mode.unknown", {options: MODE_OPTIONS.map((option) => option.key).join("、")});
            bump();
            return;
        }
        await setMode(found.key);
    }

    async function changeSettings(patch: Readonly<Record<string, unknown>>): Promise<void> {
        const target = current;
        if (target === null) return;
        const result = await remote.changeSettings({sessionId: target.id, commandId: commandId(), patch: {core: patch as never}});
        if (!result.ok && current === target) {
            notice = agentText("conversation.reject.other", {code: result.code});
            bump();
        }
    }

    function messageText(id: string): string {
        const message = current?.transcript.messages().find((item) => item.id === id);
        if (message?.kind === "assistant") return message.text;
        if (message?.kind === "user") return message.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n");
        return "";
    }

    function toolText(id: string): string {
        for (const message of current?.transcript.messages() ?? []) {
            if (message.kind !== "assistant") continue;
            const call = message.toolCalls.find((item) => item.id === id);
            if (call !== undefined) return JSON.stringify({args: call.args, result: call.result?.text}, null, 2);
        }
        return "";
    }

    function profileKey(): string {
        // `current` 与 transcript 不是响应式的：先读 `revision`，渲染函数与 computed 读它时，快照到了（meta 填上 Profile）会跟着重算。
        void revision.value;
        return current?.transcript.meta()?.profile ?? MAIN_PROFILE;
    }

    function act(action: AgentViewAction): void {
        void run(action).catch((error: unknown) => {
            deps.report("conversation-action-failed", `${action.type}: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    async function run(action: AgentViewAction): Promise<void> {
        const target = current;
        // 本插件登记在注册表里的入口（`request-entries.ts`）：补上当前会话再交出去。
        if (action.type === OPEN_REQUESTS_ACTION || action.type === OPEN_REQUEST_ACTION) {
            const request = (action.payload as {request?: unknown} | null | undefined)?.request;
            if (target !== null) deps.openRequests({sessionId: target.id, ...(typeof request === "number" ? {request} : {})});
            return;
        }
        switch (action.type) {
            case "composer.draftChanged":
                draftText = action.text;
                noteDraft(action.text);
                return;
            // 第一屏的开场指令：换掉输入框里的文字，与在输入框里打的字一样存成草稿（conversation.md 输出 41）。
            case "composer.fill":
                setDraft(action.text);
                bump();
                return;
            case "composer.attachmentAdded":
                await startUpload(action.localId, action.file);
                return;
            case "composer.attachmentRetry": {
                const entry = uploads.get(action.localId);
                if (entry !== undefined) await startUpload(action.localId, entry.file);
                return;
            }
            case "composer.attachmentRemoved":
                uploads.delete(action.localId);
                bump();
                return;
            case "composer.commandHandled":
                setDraft("");
                bump();
                return;
            case "composer.submit":
                await submit(action.text, action.delivery);
                return;
            case "command.run":
                // 有归属的会话只做白名单里的命令（输入框也只列这几个；这里再挡一次，免得别处发来的 `/new`、`/fork` 改写它）。
                if (current !== null && current.owner !== null && !OWNED_COMMANDS.includes(action.name)) return;
                if (action.name === "compact") await compactCommand(action.argsText);
                else if (action.name === "new") await newCommand();
                else if (action.name === "fork") await forkCommand();
                else if (action.name === "rename") await renameCommand(action.argsText);
                else if (action.name === "plan") await planCommand(action.argsText);
                else if (action.name === "mode") await modeCommand(action.argsText);
                return;
            case "composer.stop":
            case "input.cancelRun":
                if (target === null) return;
                stopRequestedAt = deps.now();
                bump();
                // 排队的消息留着（开发者 2026-11-05 定）；“停止并清空排队”不留（conversation.md 输出 49）。
                await remote.abort({sessionId: target.id, commandId: commandId(), ...(action.type === "composer.stop" && action.clearQueue === true ? {} : {keepQueue: true})});
                return;
            case "run.continue":
                if (target === null) return;
                // 有留着的话或待发的提醒：按恢复方式继续（输出 50、51）；只有提醒时最后都落到 `resume`，内核接着跑中断的那一轮或开一次运行，
                // 提醒随第一次请求带上（harness/runtime.md 输出 114）。只有中断的运行：照旧接着跑（输出 9）。
                if (target.transcript.queue().some((item) => item.state === "held") || target.transcript.notices().length > 0) await continueRun(target, null);
                else await remote.start({sessionId: target.id, commandId: commandId()});
                return;
            case "input.submit":
                await resolveInput(action.batchKey, action.resolutions as never, action.sessionId);
                return;
            case "wizard.state":
                wizardState = action.state;
                return;
            case "dock.state":
                dockState = action.state;
                return;
            case "queued.remove":
                if (target === null) return;
                // 提醒与话在同一个排队区里，按 id 分开取消（conversation.md 输出 51）。
                if (target.transcript.notices().some((item) => item.id === action.id)) await remote.removeNotice({sessionId: target.id, commandId: commandId(), noticeId: action.id});
                else await remote.remove({sessionId: target.id, commandId: commandId(), inputId: action.id});
                return;
            case "queued.edit": {
                // 取出来就是取出来：从队列删掉、放进输入框，改了再发是一条新消息。输入框里已有的不丢，接在后面。
                const queued = target?.transcript.queue().find((item) => item.id === action.id);
                if (queued === undefined || target === null) return;
                const removed = await remote.remove({sessionId: target.id, commandId: commandId(), inputId: queued.id});
                if (!removed.ok) return;
                setDraft(draftText === "" ? queued.text : `${draftText}\n${queued.text}`);
                bump();
                return;
            }
            case "message.resend": {
                const sent = unknownSends.get(action.messageId);
                if (sent === undefined || target === null) return;
                unknownSends.delete(action.messageId);
                settleSend(target, action.messageId, sent, await remote.send({sessionId: target.id, commandId: sent.commandId, input: sent.input, ...(sent.replaces === undefined ? {} : {replaces: sent.replaces}), ...(sent.release === undefined ? {} : {release: sent.release}), ...(sent.mode === undefined ? {} : {mode: sent.mode}), ...(sent.settlePending === undefined ? {} : {settlePending: sent.settlePending})}));
                return;
            }
            case "message.dismiss":
                unknownSends.delete(action.messageId);
                target?.transcript.removeOptimistic(action.messageId);
                bump();
                return;
            case "mode.set":
                await setMode(action.mode as AgentMode);
                return;
            case "approval.set":
                await changeSettings({approvalMode: action.mode});
                return;
            case "model.set":
                await changeSettings({model: action.modelKey === "" ? null : action.modelKey});
                return;
            case "thinking.set":
                await changeSettings({effort: action.level});
                return;
            case "thinking.reset":
                await changeSettings({effort: null});
                return;
            case "message.editStart": {
                const message = current?.transcript.messages().find((item) => item.id === action.messageId);
                if (message?.kind !== "user") return;
                editing = {messageId: message.id, text: message.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join(""), loading: false};
                bump();
                return;
            }
            case "message.editCancel":
                editing = null;
                bump();
                return;
            case "message.editSubmit": {
                // 受理了才退出编辑态：被拒时用户改的字还在编辑器里，说明也写清楚了。
                if (await rewriteHistory(action.messageId, "edit", action.text)) {
                    editing = null;
                    bump();
                }
                return;
            }
            case "message.retry":
                await rewriteHistory(action.messageId, "retry");
                return;
            case "message.branchFrom":
                await rewriteHistory(action.messageId, "branch");
                return;
            case "branch.switch":
                await switchBranch(action.messageId, action.direction);
                return;
            case "tree.refresh":
                await loadTree();
                return;
            case "tree.closed":
                closeTree();
                bump();
                return;
            case "tree.activate":
                await activateTreeNode(action.entryId);
                return;
            case "tree.copyId":
                deps.copy(action.entryId);
                return;
            case "context.refresh":
                await refreshInspection();
                return;
            case "context.closed":
                closeInspection();
                bump();
                return;
            case "systemPrompt.load":
                if (inspectionSystem !== null) inspectionPrompt = {text: inspectionSystem};
                bump();
                return;
            case "model.manage":
                deps.openSettings();
                return;
            case "session.create":
                await create(action.profileKey);
                return;
            case "session.select":
                await open(action.sessionId);
                return;
            case "session.rename":
                await remote.setTitle({sessionId: action.sessionId, commandId: commandId(), title: action.title});
                return;
            case "session.archive":
                await remote.archive({sessionId: action.sessionId, commandId: commandId(), archived: true});
                return;
            case "session.restore":
                await remote.archive({sessionId: action.sessionId, commandId: commandId(), archived: false});
                return;
            case "message.copy":
                deps.copy(messageText(action.messageId));
                return;
            case "tool.copy":
                deps.copy(toolText(action.toolCallId));
                return;
            case "reference.open":
                deps.openAddress(action.target);
                return;
            case "menu.selected":
                if (action.trigger === "$") deps.skills.selected(action.id, profileKey());
                else if (action.trigger === ":") deps.stickerSelected?.(action.id);
                return;
            case "skill.open": {
                const address = deps.skills.address(action.name, profileKey());
                if (address !== null) deps.openAddress(address);
                else {
                    notice = agentText("skills.open.missing", {name: action.name});
                    bump();
                }
                return;
            }
            case "file.openDiff":
                deps.openAddress(action.path);
                return;
            case "link.open":
                deps.openLink(action.href);
                return;
            case "availability.act": {
                const modelCard = modelNotice(noticeInput());
                if (modelCard !== null && action.action === modelCard.action.id) deps.openSettings(modelCard.target);
                else if (action.action === "restore" && target !== null) await remote.archive({sessionId: target.id, commandId: commandId(), archived: false});
                else if (action.action === "retry" && target !== null) await open(target.id);
                return;
            }
            default:
                // 第二批的动作（编辑重发、分支、附件、命令）：视图的 `interaction` 已经关掉入口，这里不用处理。
                return;
        }
    }

    /** 规则的理由是用户写的，原样显示；别的几种是约定的码（输出 21）。 */
    function approvalReason(reason: string): string {
        if (reason === MODE_ASK_REASON) return deps.text.t(agentText("conversation.approval.reason.mode"));
        if (reason === AUTO_FAILED_REASON) return deps.text.t(agentText("conversation.approval.reason.autoFailed"));
        if (reason.startsWith(AUTO_ESCALATED_PREFIX)) return deps.text.t(agentText("conversation.approval.reason.autoEscalated", {reason: reason.slice(AUTO_ESCALATED_PREFIX.length)}));
        return reason;
    }

    /** 一个等用户的事项换成视图要的样子；`source` 是后代会话的（停靠区标来源），`async` 是异步提问。 */
    function pendingView(item: {readonly id: string; readonly callId: string; readonly kind: "approval" | "question"; readonly request: unknown; readonly within?: {readonly tool: string}}, extra: {readonly source?: {sessionId: string; name: string; icon: string}; readonly async?: true; readonly approvalMode?: string}): PendingInputView {
        const request = (item.request ?? {}) as {tool?: string; args?: unknown; reason?: string; remember?: {label: string} | false; data?: {questions?: PendingQuestionView[]} | ModeSwitchRequest};
        const withinTool = pendingWithin(item);
        const common = {...(extra.source === undefined ? {} : {source: extra.source}), ...(extra.async === true ? {async: true as const} : {}), ...(withinTool === undefined ? {} : {within: {tool: displayToolName(withinTool)}})};
        if (item.kind === "approval") {
            return {...common, kind: "approval", id: item.id, toolCallId: item.callId, tool: displayToolName(request.tool ?? ""), args: (request.args ?? {}) as never, ...(request.reason === undefined ? {} : {reason: approvalReason(request.reason)}), ...(request.remember === undefined ? {} : {remember: request.remember === false ? false : {label: request.remember.label}}), preview: previews.get(item.id) ?? {state: "loading"}};
        }
        const data = request.data;
        if (data !== undefined && "kind" in data && data.kind === MODE_SWITCH_KIND) {
            return {
                ...common,
                kind: "mode-switch",
                id: item.id,
                toolCallId: item.callId,
                fromLabel: modeLabel(data.from),
                toLabel: modeLabel(data.to),
                ...(data.plan === undefined ? {} : {plan: data.plan}),
                // 后代会话的模式宿主不知道（`tree` 项里没有）：不给，向导就不问。
                ...(extra.source === undefined ? {approval: {options: [...APPROVAL_OPTIONS], value: extra.approvalMode ?? "ask"}} : {}),
            };
        }
        return {...common, kind: "question", id: item.id, toolCallId: item.callId, questions: (data as {questions?: PendingQuestionView[]} | undefined)?.questions ?? []};
    }

    /** 这个会话自己的事项（同步的阻塞、异步的停靠），加上后代等用户的事项（停靠，标来源；conversation.md 输出 34）。 */
    function pendingViews(target: Current): PendingInputView[] {
        const settings = (target.transcript.meta()?.settings ?? {}) as {approvalMode?: string};
        const own = target.transcript.pending().map((item) => pendingView(item, {...(item.async === true ? {async: true as const} : {}), ...(settings.approvalMode === undefined ? {} : {approvalMode: settings.approvalMode})}));
        const descendants = target.tree.flatMap((child) => (child.pending ?? []).map((item) => pendingView(item, {source: {sessionId: child.id, name: child.name ?? deps.profiles().find((entry) => entry.key === child.profile)?.name ?? child.id, icon: child.profileIcon ?? "i-lucide-bot"}})));
        return [...own, ...descendants];
    }

    /** 提示卡的输入（model-notice.ts）：组上下文与处理按钮按同一份算。 */
    const noticeInput = (): ModelNoticeInput => {
        const meta = current?.transcript.meta();
        const model = (meta?.model ?? null) as ({readonly ok: boolean} & Partial<ModelFailure>) | null;
        const chosen = (meta?.settings as {readonly model?: string | null} | undefined)?.model ?? null;
        const roles = deps.roles() ?? [];
        return {
            session: current !== null && meta !== undefined,
            failure: model === null || model.ok ? null : {code: model.code ?? "no-model", ...(model.role === undefined ? {} : {role: model.role}), ...(model.provider === undefined ? {} : {provider: model.provider})},
            providers: deps.providers(),
            roleName: (role) => {
                const found = roles.find((item) => item.key === roleReference(role));
                return found === undefined ? null : deps.text.t(found.name);
            },
            profileName: deps.profiles().find((item) => item.key === meta?.profile)?.name ?? meta?.profile ?? "",
            modelName: chosen === null || roleOfReference(chosen) !== null ? null : deps.models()?.find((item) => item.key === chosen)?.label ?? chosen,
            text: deps.text,
        };
    };

    const ctx = computed<AgentConversationContext>(() => {
        void revision.value;
        const now = nowValue.value;
        const target = current;
        const meta = target?.transcript.meta();
        const profile = deps.profiles().find((item) => item.key === meta?.profile);
        // bot 档：当前会话有归属（还没读到时也按这一档，最严）。
        const owned = target !== null && target.owner !== null;
        const identity = target?.owner === null || target?.owner === undefined ? null : deps.owners?.identity(target.owner) ?? null;
        const model = (meta?.model ?? null) as {ok: true; id: string; contextWindow: number; efforts: readonly string[]; reasoning?: ModelReasoning; effectiveEffort?: string | null; effortSource?: EffortSource | null; role?: string; defaultEffort?: string} | ({ok: false} & ModelFailure) | null;
        const usage = target?.transcript.usage();
        const run = target?.transcript.run();
        const warnCost = deps.warnCost();
        const models = deps.models();
        const roles = (deps.roles() ?? []).map((role): ComposerRoleView => ({
            key: role.key,
            name: deps.text.t(role.name),
            axis: role.axis,
            modelLabel: role.modelLabel,
            ...(role.status === "ok" ? {} : {unavailable: deps.text.t(agentText(ROLE_STATUS_KEYS[role.status]))}),
            ...(role.icon === undefined ? {} : {icon: role.icon}),
            ...(role.modelIcon === undefined ? {} : {modelIcon: role.modelIcon}),
            effort: role.effort,
        }));
        const settings = (meta?.settings ?? {}) as {model?: string | null; effort?: string | null; approvalMode?: string};
        /**
         * 模型能力提示（conversation.md 输出 32）：`ready` 时的 `message` 不拦发送。模型列表是懒取的、只有可用的模型，查不到时不说：
         * 用不了的情况上面已经按 `profile-unavailable` 说了。
         */
        const modelGapMessage = (): string => {
            if (profile?.modelNeeds === undefined || model === null || !model.ok) return "";
            const found = models?.find((candidate) => candidate.key === model.id);
            if (found === undefined) return "";
            return modelNeedsText(profile.modelNeeds, {vision: found.supportsImages, reasoning: found.reasoning ?? false, contextWindow: found.contextWindow ?? null}, deps.text);
        };
        const modelCard = modelNotice(noticeInput());
        // 快照或归属还没到：加载中（归属没读到时档位按最严的一档，这时画不出可操作的东西）。
        const availability = target !== null && (target.loading || target.owner === undefined) && target.failed === null
            ? {status: "loading" as const, message: "", actions: []}
            : target?.failed !== null && target?.failed !== undefined
            ? {status: "load-error" as const, message: deps.text.t(agentText("conversation.openFailed", {code: target.failed.code})), actions: [{id: "retry", label: deps.text.t(agentText("conversation.retry"))}]}
            : meta?.archived === true
                ? {status: "archived" as const, message: deps.text.t(agentText("conversation.archived")), actions: [{id: "restore", label: deps.text.t(agentText("conversation.restore"))}]}
                : modelCard !== null
                    ? {status: "profile-unavailable" as const, title: modelCard.title, message: modelCard.message, icon: modelCard.icon, actions: [modelCard.action]}
                    : {status: "ready" as const, message: modelGapMessage(), actions: []};
        return createAgentContext({
            session: target === null || meta === undefined ? null : {
                id: target.id,
                title: target.loading ? deps.text.t(agentText("conversation.loading")) : identity?.name ?? meta.title ?? "",
                ...(identity?.avatar === undefined ? {} : {avatar: identity.avatar}),
                summary: meta.description ?? "",
                profileName: profile?.name ?? meta.profile ?? "",
                profileIcon: profile?.icon ?? "i-lucide-bot",
                archived: meta.archived,
                summaryState: "idle",
                // 祖先从父会话起交回，面包屑从根排起。
                // 根有归属（bot 的主对话）时写它的身份名，不写会话标题。
                ...(target.ancestors.length === 0 ? {} : {path: [...target.ancestors].reverse().map((item) => ({id: item.id, title: item.profile === null ? null : (item.owner === undefined ? null : deps.owners?.identity(item.owner)?.name) ?? item.title ?? "", ...(item.icon === undefined ? {} : {icon: item.icon})}))}),
            },
            availability,
            interaction: {canSend: true, continuing, stopClearing: stopClearingOf(target ?? null), canSteer: true, canQueue: true, canAnswer: true, canStop: true, canChangeRuntime: target !== null, canChangeMode: true, canArchive: !owned, canRestore: !owned, canManageModels: true, canRegisterAttachments: true, triggers: [...HOST_TRIGGERS, ...(deps.triggers ?? [])], canInspectContext: target !== null, canOpenTree: !owned && target !== null, canMutateHistory: !owned && target !== null && meta?.archived !== true && meta?.readOnly === null, commands: owned ? OWNED_COMMANDS : HOST_COMMANDS, placement: owned ? "dock" : "wizard", canCreate: !owned},
            run: run === undefined ? {} : {
                status: run.status,
                phase: run.phase === null ? "" : deps.text.t(agentText(PHASE_KEYS[run.phase])),
                startedAt: run.startedAt,
                retry: run.retry as never,
                ...(run.kind === null ? {} : {kind: run.kind}),
            },
            messages: target?.transcript.messages() ?? [],
            branches: target === null || target === undefined ? {} : branchesOf(target).views,
            editing,
            panels: {
                ...(inspection === null ? {} : {contextInspection: inspection}),
                ...(inspectionPrompt === null ? {} : {systemPrompt: inspectionPrompt}),
                ...(sessionTree === null ? {} : {sessionTree}),
            },
            pendingInputs: target === null || target === undefined ? [] : pendingViews(target),
            wizardState,
            dockState,
            activeCalls,
            ...(stopRequestedAt === null ? {} : {stopRequestedAt}),
            composer: {
                models: models === null ? [] : [{key: "", label: deps.text.t(agentText("conversation.followDefault")), supportsImages: false}, ...models, ...(settings.model !== null && settings.model !== undefined && !models.some((item) => item.key === settings.model) && !roles.some((item) => item.key === settings.model) ? [{key: settings.model, label: settings.model, supportsImages: false, unavailable: deps.text.t(agentText("conversation.model.unavailable"))}] : [])],
                roles,
                effectiveModel: model?.ok === true ? models?.find((item) => item.key === model.id)?.label ?? model.id : null,
                modelKey: settings.model ?? "",
                thinkingLevels: model?.ok === true ? [...model.efforts] : [],
                thinking: settings.effort ?? null,
                ...(model?.ok === true && model.reasoning !== undefined ? {effort: effortViewFor(model.reasoning, model.effectiveEffort ?? null, model.effortSource ?? null, followOf(model, roles))} : {}),
                groups: [...deps.groups()],
                approval: {options: [...APPROVAL_OPTIONS], value: settings.approvalMode ?? "ask"},
                // 按目录判 Profile 有没有模式；还没有会话时隐式新建的是主创。
                modes: !modesAvailable(target ?? null) ? [] : MODE_OPTIONS.map((option) => ({...option, label: modeLabel(option.key)})),
                mode: modeOfCurrent(target ?? null),
                resume: target?.transcript.interrupted() === true,
                queued: target === null || target === undefined ? [] : [...target.transcript.queue().map((item) => queuedView(target, item)), ...noticeViews(target)],
                draft,
                recall: target === null || target === undefined ? [] : recallOf(target.transcript.messages()),
                attachments: [...uploads].map(([localId, entry]) => (entry.state === "ready"
                    ? {localId, state: "ready" as const, target: entry.uploaded!.uri}
                    : entry.state === "failed" ? {localId, state: "failed" as const, error: entry.error ?? ""} : {localId, state: "uploading" as const})),
                ...(notice !== null ? {notice} : owned && settleCount(target ?? null) > 0 ? {notice: agentText("conversation.settleNotice", {count: settleCount(target ?? null)})} : {}),
            },
            usage: usage === undefined ? {} : {
                contextTokens: usage.context ?? 0,
                contextLimit: model?.ok === true && model.contextWindow > 0 ? model.contextWindow : null,
                totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
                input: usage.input,
                output: usage.output,
                cacheRead: usage.cacheRead,
                cacheWrite: usage.cacheWrite,
                // 没有读写缓存的数据时不算：有的服务商不报缓存，写成 0% 会误导。
                cacheHitRate: usage.cacheRead + usage.cacheWrite === 0 ? null : usage.cacheRead / (usage.input + usage.cacheRead + usage.cacheWrite),
                lastCacheHitRate: usage.lastCacheHitRate,
                cost: usage.cost === 0 && usage.unpriced > 0 ? null : usage.cost,
                costState: warnCost > 0 && usage.cost >= warnCost ? "warned" : usage.unpriced > 0 ? "unpriced" : "ok",
            },
            now,
            // 有归属的会话画按天与未读的线（agent/conversation.md 输出 55）；普通会话不给，画面不变。
            ...(target !== null && target.owner !== null && target.owner !== undefined ? {dividers: {day: true, unreadFrom: unreadMark?.sessionId === target.id ? unreadMark.from ?? null : null}} : {}),
        });
    });

    // 模型库的快照换了（绑定角色、设密钥、改模型）：当前会话解析到的模型可能跟着变。
    const stopWatchingModels = watch(() => deps.models(), () => {
        if (current !== null && !current.loading) void refreshModel(current);
        else modelEpoch += 1;
    }, {flush: "sync"});

    let borrowers = 0;
    let cancelRelease: (() => void) | null = null;

    const owner = computed(() => {
        void revision.value;
        return current === null ? null : current.owner;
    });

    // 联系人的“看到”晚到（开会话时联系人还没读到、未读还没数完）：读到的那一刻同步拍下基线，不等下一次重算 ctx（见 `unreadMark`）。
    const stopWatchingSeen = watch(() => {
        const value = owner.value;
        return value === null || value === undefined ? null : seenOf(value);
    }, () => {
        if (current !== null) captureUnread(current);
    }, {flush: "sync"});

    return {
        ctx,
        sessionId,
        shownSeq,
        opened,
        owner,
        subagents,
        restore,
        open,
        create,
        act,
        profileKey,
        borrow() {
            borrowers += 1;
            cancelRelease?.();
            cancelRelease = null;
            // 归零期间取消了订阅：回来时重新打开同一个会话（归属从插件级的表里取，档位不变）。
            if (current === null && sessionId.value !== null) void openHere(sessionId.value, {reattach: true});
            let returned = false;
            return () => {
                if (returned) return;
                returned = true;
                borrowers -= 1;
                if (borrowers > 0 || disposed) return;
                cancelRelease = deps.schedule(() => {
                    cancelRelease = null;
                    if (borrowers === 0) {
                        // 只放开订阅，当前会话的记号留着。未提交的答案跟着事项走：还在等的话，回来时事项还在、答案也在。
                        const keptState = wizardState;
                        const keptDock = dockState;
                        const keptDraft = draftText;
                        closeCurrent();
                        wizardState = keptState;
                        dockState = keptDock;
                        draftText = keptDraft;
                    }
                }, RELEASE_DELAY_MS);
            };
        },
        markOpened() {
            if (current === null || unreadMark?.sessionId !== current.id) return;
            unreadMark = {sessionId: current.id, baseline: null, from: undefined};
            captureUnread(current);
            bump();
        },
        painting,
        dispose() {
            flushDraft();
            disposed = true;
            stopWatchingModels();
            stopWatchingSeen();
            generation += 1;
            cancelRelease?.();
            closeCurrent();
        },
    };
}
