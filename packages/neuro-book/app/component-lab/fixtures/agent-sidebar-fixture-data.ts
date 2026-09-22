import type {AgentMessage} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentSessionSummaryDto, AgentLinkedSessionDto, AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import type {WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";
import type {SessionTreeNode} from "nbook/server/agent/session/types";
import type {AgentContextInspectionDto} from "nbook/shared/dto/agent-context-inspection.dto";

export interface AgentSidebarFixtureSceneData {
    activeSessionId: number | null;
    activeSessionTitle: string;
    activeDrawerTitle: string;
    activeSessionSummaryText: string;
    messages: AgentMessage[];
    availabilityStatus: "ready" | "restoring" | "unselected" | "empty" | "archived" | "profile-unavailable" | "waiting-blocked" | "load-error" | "blocked";
    availabilityMessage?: string;
    running?: boolean;
    canAbort?: boolean;
    inputText?: string;
    queuedMessages?: any[];
    pendingSessions?: any[];
    workflowPendingRuns?: any[];
    workspaceGroups?: WorkspaceHistoryInboxGroupDto[];
    sessions?: AgentSessionSummaryDto[];
    sessionTree?: SessionTreeNode[];
    linkedAgents?: AgentLinkedSessionDto[];
    attachments?: AgentSessionAttachmentItemDto[];
    contextInspection?: AgentContextInspectionDto | null;
    systemPrompt?: string | null;
    attachmentPanelOpen?: boolean;
    linkedAgentPanelOpen?: boolean;
    systemPromptPanelOpen?: boolean;
    sessionDialogOpen?: boolean;
    sessionTreeDialogOpen?: boolean;
    contextInspectorOpen?: boolean;
}

export const SIDEBAR_FIXTURE_SCENARIOS: Record<string, AgentSidebarFixtureSceneData> = {
    empty: {
        activeSessionId: null,
        activeSessionTitle: "新创作对话",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "选择推荐提示词或从最近对话继续",
        messages: [],
        availabilityStatus: "ready",
        availabilityMessage: "选择上方推荐技能或直接输入提示词开始创作。",
        running: false,
        inputText: "",
        sessions: [
            {
                sessionId: 101,
                sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000101",
                profileKey: "writer",
                title: "第三幕雨夜钟楼决战细纲推演",
                status: "idle",
                updatedAt: Date.now() - 1000 * 60 * 12,
                archived: false,
            },
            {
                sessionId: 102,
                sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000102",
                profileKey: "plot.planner",
                title: "蒸汽机械帝国世界观与法则梳理",
                status: "idle",
                updatedAt: Date.now() - 1000 * 60 * 60 * 3,
                archived: false,
            },
            {
                sessionId: 103,
                sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000103",
                profileKey: "leader.default",
                title: "第一章环境冷峻氛围描写润色",
                status: "idle",
                updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
                archived: false,
            },
        ],
    },
    conversation: {
        activeSessionId: 101,
        activeSessionTitle: "第一章大纲推演与世界观设定",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "已完成第一章细纲推演，正在补充世界观设定",
        availabilityStatus: "ready",
        running: false,
        inputText: "",
        messages: [
            {
                id: "m-1",
                type: "user",
                content: "我们来梳理一下第一章开头主角在钟楼顶层的登场场景。",
                timestamp: "14:20:00",
            },
            {
                id: "m-2",
                type: "ai",
                thinking: "钟楼登场需要突出：\n1. 城市蒸汽朋克与雨夜的压抑感；\n2. 主角孤独且警惕的性格特征；\n3. 怀表停走的时间锚点。",
                content: "建议以**雨夜钟声**作为全书的听觉开篇：\n\n> 暴雨如注的子夜，齿轮咬合的闷响穿透水雾。他在青铜指针的阴影里蹲下，怀表停在三年前的十二点一刻。\n\n这样可以在头两百字内迅速建立悬念与氛围。",
                status: "done",
                timestamp: "14:20:05",
            },
            {
                id: "m-3",
                type: "user",
                content: "这个开篇很好，请检查一下当前工作区中是否有冲突的设定条目。",
                timestamp: "14:21:00",
            },
            {
                id: "m-4",
                type: "ai",
                thinking: "调用文件检索工具查询设定条目。",
                content: "正在为您检索设定条目...",
                status: "done",
                timestamp: "14:21:04",
                toolCalls: [
                    {
                        id: "tc-1",
                        index: 0,
                        name: "edit",
                        status: "success",
                        argsText: JSON.stringify({path: "settings/world.md", instruction: "检索雨夜钟楼设定"}),
                        argsJson: JSON.stringify({path: "settings/world.md", instruction: "检索雨夜钟楼设定"}),
                        result: JSON.stringify({status: "ok", found: true}),
                    },
                ],
            },
        ],
    },
    streaming: {
        activeSessionId: 102,
        activeSessionTitle: "剧情推进实时生成中",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "Agent 正在思考并持续输出文本",
        availabilityStatus: "ready",
        running: true,
        canAbort: true,
        inputText: "",
        messages: [
            {
                id: "m-stream-1",
                type: "user",
                content: "请详细描写主角推开生锈铁门后的视觉细节。",
                timestamp: "14:30:00",
            },
            {
                id: "m-stream-2",
                type: "ai",
                thinking: "正在构思锈蚀铁门的金属摩擦声与室内光影反差...",
                content: "铁锈剥落的声音在空旷的门廊里回荡，带着刺耳的酸涩感。微光透过破碎的彩色玻璃窗，将地面斑驳的积水染成暗紫...",
                status: "streaming",
                timestamp: "14:30:02",
            },
        ],
    },
    history: {
        activeSessionId: 103,
        activeSessionTitle: "历史长对话追溯",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "包含多页历史、编辑状态与分支切换",
        availabilityStatus: "ready",
        running: false,
        inputText: "",
        messages: [
            {
                id: "m-hist-1",
                type: "user",
                content: "前文提到的神秘信件是谁寄出的？",
                timestamp: "11:00:00",
            },
            {
                id: "m-hist-2",
                type: "ai",
                content: "根据设定，信件来自前任守钟人，信封上盖着已经废弃的黑曜石印章。",
                status: "done",
                timestamp: "11:00:03",
            },
            {
                id: "m-hist-3",
                type: "user",
                content: "把信件改为主角已故母亲留下的遗物会不会戏剧冲突更强？",
                timestamp: "11:05:00",
            },
            {
                id: "m-hist-4",
                type: "ai",
                content: "这样改动会大幅强化主角的情感动机！从单纯的职责调查转变为探寻身世秘密的个人复仇。",
                status: "done",
                timestamp: "11:05:06",
            },
        ],
    },
    "delivery-unknown": {
        activeSessionId: 104,
        activeSessionTitle: "网络波动未决投递",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "消息投递状态未知，展示重试与忽略操作",
        availabilityStatus: "ready",
        running: false,
        inputText: "",
        messages: [
            {
                id: "m-unk-1",
                type: "user",
                content: "请重新校对第三节段落。",
                timestamp: "14:40:00",
                deliveryState: "unknown",
            },
        ],
    },
    images: {
        activeSessionId: 105,
        activeSessionTitle: "图文混合多模态创作",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "包含文档图片、附件栏与多模态参考",
        availabilityStatus: "ready",
        running: false,
        inputText: "参考这张钟楼的概念图，为场景增加建筑风格细节描述。",
        attachments: [
            {
                attachment: {
                    attachmentId: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                    name: "clock_tower_sketch.png",
                    mimeType: "image/png",
                    bytes: 1024 * 512,
                    dataOmitted: true,
                },
                locator: {
                    entryId: "entry-att-1",
                    contentIndex: 0,
                },
                target: "attachment://sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                firstSeenAt: 1726660000000,
                lastSeenAt: 1726660000000,
                referenceCount: 1,
            },
        ],
        messages: [
            {
                id: "m-img-1",
                type: "user",
                content: "上传了钟楼设计草图：\n\n![clock_tower_sketch](attachment://att-1)",
                timestamp: "14:45:00",
            },
        ],
    },
    "pending-input": {
        activeSessionId: 106,
        activeSessionTitle: "人机协作待决审批",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "等待用户确认模式切换或表单审批",
        availabilityStatus: "ready",
        running: false,
        inputText: "",
        pendingSessions: [
            {
                sessionId: 106,
                assistantMessageId: "m-pend-1",
                formToolCallId: "tc-pend-1",
                questions: [
                    {
                        toolNodeId: "tc-pend-1",
                        toolCallId: "tc-pend-1",
                        kind: "tool_approval",
                        prompt: "是否确认修改大纲文件？此操作将覆盖既有草稿。",
                    },
                ],
            },
        ],
        messages: [
            {
                id: "m-pend-1",
                type: "ai",
                content: "已准备好大纲变更方案，需要您的确认授权以写入文件。",
                status: "done",
                timestamp: "14:50:00",
                toolCalls: [
                    {
                        id: "tc-pend-1",
                        index: 0,
                        name: "write",
                        status: "running",
                        argsText: JSON.stringify({path: "outline/chapter-1.md"}),
                        argsJson: JSON.stringify({path: "outline/chapter-1.md"}),
                    },
                ],
            },
        ],
    },
    workflow: {
        activeSessionId: 107,
        activeSessionTitle: "多 Agent 工作流执行",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "编排多个专职 Agent 协同校对与推演",
        availabilityStatus: "ready",
        running: false,
        inputText: "",
        messages: [
            {
                id: "m-wf-1",
                type: "ai",
                content: "正在启动全文章节校对 workflow...",
                status: "done",
                timestamp: "14:55:00",
                toolCalls: [
                    {
                        id: "tc-wf-1",
                        index: 0,
                        name: "run_workflow",
                        status: "running",
                        argsJson: JSON.stringify({workflowKey: "novel-proofread"}),
                        argsText: JSON.stringify({workflowKey: "novel-proofread"}),
                        resultData: {status: "started", runId: "run-novel-1", jobId: "job-novel-1"},
                    },
                ],
            },
        ],
    },
    "workspace-changes": {
        activeSessionId: 108,
        activeSessionTitle: "工作区历史变更审查",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "存在 2 处待审文件写入变更",
        availabilityStatus: "ready",
        running: false,
        inputText: "",
        workspaceGroups: [
            {
                path: "chapters/chapter-01.md",
                revision: 3,
                baseHash: null,
                endHash: "abc1234",
                entries: [
                    {id: 1, occurredAt: "2026-09-18T14:00:00Z", actorKind: "agent", actorDetail: null, operationType: "write_file"},
                ],
            },
            {
                path: "settings/characters.md",
                revision: 1,
                baseHash: null,
                endHash: "def5678",
                entries: [
                    {id: 2, occurredAt: "2026-09-18T14:10:00Z", actorKind: "agent", actorDetail: null, operationType: "write_file"},
                ],
            },
        ],
        messages: [],
    },
    sessions: {
        activeSessionId: 109,
        activeSessionTitle: "多会话管理与分支树视图",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "查看历史会话列表与对话衍生树",
        availabilityStatus: "ready",
        running: false,
        inputText: "",
        sessionDialogOpen: true,
        sessions: [
            {
                sessionId: 109,
                sessionIdentity: "uuid-session-109" as any,
                profileKey: "leader.default",
                title: "多会话管理与分支树视图",
                status: "idle",
                updatedAt: Date.now() - 60000,
                archived: false,
            },
            {
                sessionId: 101,
                sessionIdentity: "uuid-session-101" as any,
                profileKey: "leader.default",
                title: "第一章大纲推演与世界观设定",
                status: "idle",
                updatedAt: Date.now() - 3600000,
                archived: false,
            },
            {
                sessionId: 99,
                sessionIdentity: "uuid-session-99" as any,
                profileKey: "leader.default",
                title: "早期灵感草稿（已归档）",
                status: "idle",
                updatedAt: Date.now() - 86400000,
                archived: true,
            },
        ],
        messages: [],
    },
    "context-inspector": {
        activeSessionId: 110,
        activeSessionTitle: "Prompt 上下文检查",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "检视 Token 消耗、缓存命中与 Prompt 组成",
        availabilityStatus: "ready",
        running: false,
        inputText: "",
        contextInspectorOpen: true,
        contextInspection: {
            state: "ok",
            requests: [
                {id: "req-1", ts: "2026-09-18T14:00:00Z", promptTokens: 1240},
                {id: "req-0", ts: "2026-09-18T13:55:00Z", promptTokens: 1100},
            ],
            selected: {
                traceId: "req-1",
                ts: "2026-09-18T14:00:00Z",
                provider: "deepseek",
                model: "deepseek-chat",
                segments: [],
                labelBreakdown: [
                    {kind: "system", label: "系统提示词", estimatedTokens: 400},
                    {kind: "conversation", label: "历史对话", estimatedTokens: 840},
                ],
                usage: {
                    input: 1240,
                    output: 350,
                    cacheRead: 800,
                    cacheWrite: 0,
                },
            },
            facts: {
                contextWindowTokens: 128000,
                compactionTriggerTokens: 100000,
                cacheRetention: null,
            },
            timeline: [],
            diagnostics: [],
        },
        messages: [],
    },
    unavailable: {
        activeSessionId: 111,
        activeSessionTitle: "不可用状态提示",
        activeDrawerTitle: "Novel Agent",
        activeSessionSummaryText: "Profile 缺失或模型受阻状态演示",
        availabilityStatus: "profile-unavailable",
        availabilityMessage: "当前选定的 Agent Profile 未加载或已被删除，无法继续发送消息。",
        running: false,
        inputText: "",
        messages: [],
    },
};
