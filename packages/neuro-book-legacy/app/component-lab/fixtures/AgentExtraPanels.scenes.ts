import type AgentSystemPromptPanel from "../../components/novel-ide/agent/panels/system-prompt/AgentSystemPromptPanel.vue";
import type AgentLinkedAgentPanel from "../../components/novel-ide/agent/panels/linked-agents/AgentLinkedAgentPanel.vue";
import type AgentWorkspaceChanges from "../../components/novel-ide/agent/panels/workspace-changes/AgentWorkspaceChanges.vue";
import type AgentSessionDialog from "../../components/novel-ide/agent/dialogs/session-list/AgentSessionDialog.vue";
import type AgentSessionTreeDialog from "../../components/novel-ide/agent/dialogs/session-tree/AgentSessionTreeDialog.vue";
import type AgentSessionAttachmentPanel from "../../components/novel-ide/agent/panels/attachments/AgentSessionAttachmentPanel.vue";
import type AgentModeSessionSidebar from "../../components/novel-ide/agent/AgentModeSessionSidebar.vue";
import type WorkbenchCommandPalette from "../../components/workbench/WorkbenchCommandPalette.vue";
import type WorkbenchViewInstances from "../../components/workbench/WorkbenchViewInstances.vue";
import type {AgentLinkedSessionDto, AgentSessionAttachmentItemDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import type {WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";
import type {WorkspaceHistoryDiffState} from "../../components/novel-ide/agent/composables/useAgentWorkspaceChanges";
import type {SessionTreeNode} from "nbook/server/agent/session/types";
import type {LabFixtureDefinition} from "./index";

export const sampleSystemPrompt = `## 角色定义

你是一位专业的小说写作助手，擅长长篇小说创作。你将帮助用户进行：

- **情节构思**：根据用户设定的世界观和角色，推进故事发展
- **文风校准**：保持与用户既有章节一致的叙述风格
- **角色刻画**：确保角色行为与性格设定一致

## 约束

1. 不主动改变已确认的角色设定
2. 每次输出控制在 2000 字以内
3. 涉及敏感话题时主动提醒用户

## 引用

- \`workspace://characters/林渊.md\`
- \`workspace://world/青云宗.md\``;

export const agentSystemPromptPanelScenes = [
    {id: "expanded", label: "展开状态（Markdown 渲染）", input: {props: {value: sampleSystemPrompt, loading: false}, model: {modelValue: true}}},
    {id: "loading", label: "加载中", input: {props: {value: null, loading: true}, model: {modelValue: true}}},
    {id: "error", label: "加载失败", input: {props: {value: null, loading: false, error: "加载 System Prompt 失败：网络请求超时，请检查后端服务连接"}, model: {modelValue: true}}},
    {id: "empty", label: "Prompt 为空", input: {props: {value: "", loading: false}, model: {modelValue: true}}},
] satisfies LabFixtureDefinition<typeof AgentSystemPromptPanel>["scenes"];

export const ownedLinkedAgents = [
    {sessionId: 201, sessionIdentity: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", title: "第一章初稿撰写", profileKey: "writer", status: "running", updatedAt: 1750000000000, archived: false},
    {sessionId: 202, sessionIdentity: "b2c3d4e5-f6a7-8901-bcde-f12345678901", title: "角色资料检索", profileKey: "retrieval", status: "idle", updatedAt: 1749999760000, archived: false},
    {sessionId: 203, sessionIdentity: "c3d4e5f6-a7b8-9012-cdef-123456789012", title: "世界观素材整理", profileKey: "leader.assets", status: "waiting", updatedAt: 1749999880000, archived: false, profileAvailability: "unloadable", profileIssueMessage: "assets profile 需要更新配置文件"},
] satisfies AgentLinkedSessionDto[];

export const linkedByAgents = [
    {sessionId: 100, sessionIdentity: "d4e5f6a7-b8c9-0123-defa-234567890123", title: "主线调度 Session", profileKey: "leader.default", status: "idle", updatedAt: 1749999580000, archived: false},
] satisfies AgentLinkedSessionDto[];

export const agentLinkedAgentPanelScenes = [
    {id: "populated", label: "有关联 Agent", input: {props: {sessionId: 101, ownedAgents: ownedLinkedAgents, linkedByAgents, loading: false}}},
    {id: "empty", label: "无关联 Agent", input: {props: {sessionId: 101, ownedAgents: [], linkedByAgents: [], loading: false}}},
    {id: "loading", label: "加载中", input: {props: {sessionId: 101, ownedAgents: ownedLinkedAgents, linkedByAgents, loading: true}}},
] satisfies LabFixtureDefinition<typeof AgentLinkedAgentPanel>["scenes"];

export const sampleWorkspaceGroups = [
    {
        path: "chapters/chapter-01.md",
        revision: 3,
        baseHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        endHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        entries: [
            {id: 101, occurredAt: "2026-09-18T14:12:00Z", actorKind: "agent", actorDetail: "writer", operationType: "edit_file"},
            {id: 102, occurredAt: "2026-09-18T14:15:30Z", actorKind: "agent", actorDetail: "writer", operationType: "edit_file"},
        ],
    },
    {
        path: "settings/characters/lin-yuan.md",
        revision: 1,
        baseHash: null,
        endHash: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        entries: [
            {id: 103, occurredAt: "2026-09-18T14:18:00Z", actorKind: "agent", actorDetail: "leader.assets", operationType: "write_file"},
        ],
    },
    {
        path: "settings/world-chronicle.md",
        revision: 5,
        baseHash: "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
        endHash: "ffffeeeeddddccccbbbbaaaa0000999988887777666655554444333322221111",
        entries: [
            {id: 104, occurredAt: "2026-09-18T14:20:00Z", actorKind: "agent", actorDetail: "leader.default", operationType: "apply_patch"},
        ],
    },
    {
        path: "drafts/obsolete-prologue.md",
        revision: 2,
        baseHash: "9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff",
        endHash: null,
        entries: [
            {id: 105, occurredAt: "2026-09-18T14:22:00Z", actorKind: "agent", actorDetail: "leader.default", operationType: "delete_file"},
        ],
    },
] satisfies WorkspaceHistoryInboxGroupDto[];

export const sampleWorkspaceDiffByPath: Record<string, WorkspaceHistoryDiffState> = {
    "chapters/chapter-01.md": {
        loading: false,
        error: null,
        result: {
            status: "available",
            original: "暴雨如注的子夜，钟楼齿轮发出沉闷的响声。\n林渊站在窗前，看着怀表指针停在十二点。\n",
            modified: "暴雨如注的子夜，青铜齿轮咬合的闷响穿透水雾。\n林渊在指针阴影里蹲下，怀表停在三年前的十二点一刻。\n他听见台阶下方传来靴底踩碎积水的声响。\n",
            byteSize: 286,
            changedLineCount: 5,
            changes: [
                {value: "暴雨如注的子夜，钟楼齿轮发出沉闷的响声。\n", removed: true},
                {value: "暴雨如注的子夜，青铜齿轮咬合的闷响穿透水雾。\n", added: true},
                {value: "林渊站在窗前，看着怀表指针停在十二点。\n", removed: true},
                {value: "林渊在指针阴影里蹲下，怀表停在三年前的十二点一刻。\n他听见台阶下方传来靴底踩碎积水的声响。\n", added: true},
            ],
        },
    },
    "settings/characters/lin-yuan.md": {
        loading: false,
        error: null,
        result: {
            status: "available",
            original: "",
            modified: "# 林渊\n\n- 身份：前雾港守钟人学徒\n- 随身信物：停在十二点一刻的银壳怀表\n",
            byteSize: 112,
            changedLineCount: 4,
            changes: [
                {value: "# 林渊\n\n- 身份：前雾港守钟人学徒\n- 随身信物：停在十二点一刻的银壳怀表\n", added: true},
            ],
        },
    },
    "settings/world-chronicle.md": {
        loading: false,
        error: null,
        result: {
            status: "too_large",
            reason: "inline_limit",
            byteSize: 52400,
            changedLineCount: 640,
        },
    },
    "drafts/obsolete-prologue.md": {
        loading: false,
        error: null,
        result: {
            status: "unavailable",
            reason: "before-missing",
        },
    },
};

export const agentWorkspaceChangesScenes = [
    {
        id: "expanded-diff",
        label: "展开并预览文件 Diff",
        input: {
            props: {
                projectRoot: "workspace/projects/mist-harbor",
                groups: sampleWorkspaceGroups,
                loading: false,
                error: null,
                selectedPath: "chapters/chapter-01.md",
                busyPath: null,
                acceptingAll: false,
            },
            model: {expanded: true},
        },
    },
    {
        id: "collapsed",
        label: "折叠摘要条",
        input: {
            props: {
                projectRoot: "workspace/projects/mist-harbor",
                groups: sampleWorkspaceGroups.slice(0, 3),
                loading: false,
                error: null,
                selectedPath: null,
                busyPath: null,
                acceptingAll: false,
            },
            model: {expanded: false},
        },
    },
    {
        id: "accepting",
        label: "正在接受单文件变更",
        input: {
            props: {
                projectRoot: "workspace/projects/mist-harbor",
                groups: sampleWorkspaceGroups,
                loading: false,
                error: null,
                selectedPath: "chapters/chapter-01.md",
                busyPath: "chapters/chapter-01.md",
                acceptingAll: false,
            },
            model: {expanded: true},
        },
    },
    {
        id: "loading",
        label: "检查工作区变更中",
        input: {
            props: {
                projectRoot: "workspace/projects/mist-harbor",
                groups: [],
                loading: true,
                error: null,
                selectedPath: null,
                busyPath: null,
                acceptingAll: false,
            },
            model: {expanded: false},
        },
    },
    {
        id: "error",
        label: "读取变更失败",
        input: {
            props: {
                projectRoot: "workspace/projects/mist-harbor",
                groups: sampleWorkspaceGroups.slice(0, 2),
                loading: false,
                error: "读取工作区变更差异失败：历史快照索引校验超时",
                selectedPath: null,
                busyPath: null,
                acceptingAll: false,
            },
            model: {expanded: true},
        },
    },
] satisfies LabFixtureDefinition<typeof AgentWorkspaceChanges>["scenes"];

export const sampleCreateProfileOptions = [
    {profileKey: "leader.default", label: "主控调度 Agent", iconClass: "i-lucide-crown"},
    {profileKey: "leader.assets", label: "设定与素材主控", iconClass: "i-lucide-Library"},
    {profileKey: "rp.leader", label: "角色扮演导演", iconClass: "i-lucide-drama"},
    {profileKey: "writer", label: "章节执笔助手", iconClass: "i-lucide-feather"},
];

export const sampleSessionList = [
    {
        sessionId: 101,
        sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000101",
        profileKey: "leader.default",
        title: "第三幕雨夜钟楼决战细纲推演",
        summary: "已完成雨夜钟楼的场景调度与三方势力冲突节点梳理，待确认终局伏笔回收方式。",
        status: "idle",
        updatedAt: 1750000000000 - 1000 * 60 * 8,
        archived: false,
        interaction: {
            canInvoke: true,
            canResolveUserInput: true,
            canRegisterAttachment: true,
            canInsertAttachment: true,
            canMutateHistory: true,
            canChangeRuntime: true,
            canArchive: true,
            canRestore: false,
            canAbort: false,
        },
    },
    {
        sessionId: 102,
        sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000102",
        profileKey: "writer",
        parentSessionId: 101,
        title: "第一章第3节正文初稿生成",
        lastMessagePreview: "铁锈剥落的声音在空旷的门廊里回荡，带着刺耳的酸涩感...",
        status: "running",
        updatedAt: 1750000000000 - 1000 * 60 * 2,
        archived: false,
        interaction: {
            canInvoke: false,
            canResolveUserInput: true,
            canRegisterAttachment: true,
            canInsertAttachment: true,
            canMutateHistory: false,
            canChangeRuntime: false,
            canArchive: false,
            canRestore: false,
            canAbort: true,
        },
    },
    {
        sessionId: 103,
        sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000103",
        profileKey: "leader.assets",
        title: "雾港蒸汽机械帝国设定与编年史整理",
        summary: "汇总了雾港四大工坊、黑曜石印章与守钟人传承体系的设定卡片。",
        status: "waiting",
        updatedAt: 1750000000000 - 1000 * 60 * 45,
        archived: false,
        interaction: {
            canInvoke: true,
            canResolveUserInput: true,
            canRegisterAttachment: true,
            canInsertAttachment: true,
            canMutateHistory: true,
            canChangeRuntime: true,
            canArchive: true,
            canRestore: false,
            canAbort: false,
        },
    },
    {
        sessionId: 104,
        sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000104",
        profileKey: "custom.worldbuilder",
        title: "旧版世界观草案推演",
        lastMessagePreview: "尝试生成第二纪元星象历法对照表，执行中断。",
        status: "interrupted",
        profileAvailability: "missing",
        profileIssueMessage: "未找到自定义 Profile: custom.worldbuilder",
        updatedAt: 1750000000000 - 1000 * 60 * 60 * 5,
        archived: false,
        interaction: {
            canInvoke: false,
            canResolveUserInput: false,
            canRegisterAttachment: false,
            canInsertAttachment: false,
            canMutateHistory: false,
            canChangeRuntime: true,
            canArchive: true,
            canRestore: false,
            canAbort: false,
        },
    },
    {
        sessionId: 98,
        sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000098",
        profileKey: "rp.leader",
        title: "林渊与老守钟人茶馆对手戏试写（已归档）",
        summary: "早期角色语感测试，核心台词已并入正式大纲。",
        status: "archived",
        updatedAt: 1750000000000 - 1000 * 60 * 60 * 28,
        archived: true,
        interaction: {
            canInvoke: false,
            canResolveUserInput: false,
            canRegisterAttachment: false,
            canInsertAttachment: false,
            canMutateHistory: false,
            canChangeRuntime: false,
            canArchive: false,
            canRestore: true,
            canAbort: false,
        },
    },
] satisfies AgentSessionSummaryDto[];

export const agentSessionDialogScenes = [
    {
        id: "populated",
        label: "多状态会话列表（含子 Agent 与分页）",
        input: {
            props: {
                sessions: sampleSessionList,
                total: 12,
                hasMore: true,
                nextOffset: 5,
                activeSessionId: 101,
                loading: false,
                running: true,
                actionId: null,
                createProfileOptions: sampleCreateProfileOptions,
                canChooseCreateProfile: true,
                teleportTarget: false,
            },
            model: {modelValue: true},
        },
    },
    {
        id: "action-busy",
        label: "会话操作进行中（归档/恢复忙碌态）",
        input: {
            props: {
                sessions: sampleSessionList,
                total: 5,
                hasMore: false,
                nextOffset: null,
                activeSessionId: 101,
                loading: false,
                running: false,
                actionId: 98,
                createProfileOptions: sampleCreateProfileOptions,
                canChooseCreateProfile: false,
                teleportTarget: false,
            },
            model: {modelValue: true},
        },
    },
    {
        id: "empty",
        label: "无匹配会话空态",
        input: {
            props: {
                sessions: [],
                total: 0,
                hasMore: false,
                nextOffset: null,
                activeSessionId: null,
                loading: false,
                running: false,
                actionId: null,
                createProfileOptions: sampleCreateProfileOptions,
                canChooseCreateProfile: true,
                teleportTarget: false,
            },
            model: {modelValue: true},
        },
    },
    {
        id: "loading",
        label: "加载更多会话中",
        input: {
            props: {
                sessions: sampleSessionList.slice(0, 3),
                total: 12,
                hasMore: true,
                nextOffset: 3,
                activeSessionId: 101,
                loading: true,
                running: false,
                actionId: null,
                createProfileOptions: sampleCreateProfileOptions,
                canChooseCreateProfile: true,
                teleportTarget: false,
            },
            model: {modelValue: true},
        },
    },
] satisfies LabFixtureDefinition<typeof AgentSessionDialog>["scenes"];

export const sampleSessionTree = [
    {
        id: "entry-root-0001",
        parentId: null,
        type: "message",
        timestamp: 1750000000000 - 1000 * 60 * 16,
        role: "user",
        preview: "我们来梳理一下第一章开头主角林渊在钟楼顶层的登场场景。",
        active: true,
        childCount: 1,
        terminal: false,
    },
    {
        id: "entry-asst-0002",
        parentId: "entry-root-0001",
        type: "message",
        timestamp: 1750000000000 - 1000 * 60 * 15,
        role: "assistant",
        preview: "[tool:subject_rag_search] [tool:read_file]",
        active: true,
        childCount: 1,
        terminal: false,
    },
    {
        id: "entry-tool-0003",
        parentId: "entry-asst-0002",
        type: "message",
        timestamp: 1750000000000 - 1000 * 60 * 14,
        role: "toolResult",
        toolName: "subject_rag_search",
        preview: "命中 3 条设定：雾港大钟楼、停摆银怀表、前任守钟人失踪案。",
        active: true,
        childCount: 1,
        terminal: false,
    },
    {
        id: "entry-user-0004",
        parentId: "entry-tool-0003",
        type: "message",
        timestamp: 1750000000000 - 1000 * 60 * 12,
        role: "user",
        label: "branch-point",
        preview: "请给出两种不同的冲突引爆方式：一种偏悬疑推理，一种偏动作突袭。",
        active: true,
        childCount: 2,
        terminal: false,
    },
    {
        id: "entry-asst-0005a",
        parentId: "entry-user-0004",
        type: "message",
        timestamp: 1750000000000 - 1000 * 60 * 10,
        role: "assistant",
        preview: "方案 A（动作突袭）：钟声未落，三名披着油布雨衣的巡夜人破门而入，蒸汽弩箭擦过青铜齿轮...",
        active: false,
        childCount: 0,
        terminal: true,
    },
    {
        id: "entry-asst-0005b",
        parentId: "entry-user-0004",
        type: "message",
        timestamp: 1750000000000 - 1000 * 60 * 8,
        role: "assistant",
        preview: "方案 B（悬疑推理）：林渊撬开停摆怀表的底盖，发现内侧刻着一行刚刚渗出机油的新鲜暗码...",
        active: true,
        childCount: 1,
        terminal: false,
    },
    {
        id: "entry-user-0006b",
        parentId: "entry-asst-0005b",
        type: "message",
        timestamp: 1750000000000 - 1000 * 60 * 5,
        role: "user",
        label: "milestone-opening",
        preview: "采用方案 B！顺着怀表暗码的线索继续展开第一节细纲。",
        active: true,
        childCount: 0,
        terminal: true,
    },
] satisfies SessionTreeNode[];

export const agentSessionTreeDialogScenes = [
    {
        id: "branching",
        label: "多分支会话历史树（可折叠与激活分支）",
        input: {
            props: {
                tree: sampleSessionTree,
                activeLeafId: "entry-user-0006b",
                running: false,
                canActivate: true,
                teleportTarget: false,
            },
            model: {modelValue: true},
        },
    },
    {
        id: "running-readonly",
        label: "会话运行中（禁止切换分支）",
        input: {
            props: {
                tree: sampleSessionTree,
                activeLeafId: "entry-user-0006b",
                running: true,
                canActivate: false,
                teleportTarget: false,
            },
            model: {modelValue: true},
        },
    },
    {
        id: "empty",
        label: "空分支树",
        input: {
            props: {
                tree: [],
                activeLeafId: null,
                running: false,
                canActivate: false,
                teleportTarget: false,
            },
            model: {modelValue: true},
        },
    },
] satisfies LabFixtureDefinition<typeof AgentSessionTreeDialog>["scenes"];

export const sampleAttachmentSvgByEntryId: Record<string, string> = {
    "entry-att-1": `data:image/svg+xml;utf8,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#182232"/><circle cx="160" cy="90" r="56" fill="none" stroke="#60a5fa" stroke-width="4"/><line x1="160" y1="90" x2="160" y2="48" stroke="#f8fafc" stroke-width="4" stroke-linecap="round"/><line x1="160" y1="90" x2="188" y2="90" stroke="#93c5fd" stroke-width="3" stroke-linecap="round"/><text x="160" y="166" fill="#94a3b8" font-size="12" font-family="monospace" text-anchor="middle">clock_tower_sketch.png</text></svg>',
    )}`,
    "entry-att-2": `data:image/svg+xml;utf8,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#1f1d2e"/><circle cx="160" cy="72" r="28" fill="#a78bfa" opacity="0.85"/><path d="M112 146 C112 114 208 114 208 146" fill="#c4b5fd" opacity="0.75"/><text x="160" y="168" fill="#cbd5e1" font-size="12" font-family="monospace" text-anchor="middle">lin_yuan_portrait.webp</text></svg>',
    )}`,
};

export const sampleSessionAttachments = [
    {
        attachment: {
            attachmentId: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            name: "clock_tower_sketch.png",
            mimeType: "image/png",
            bytes: 1024 * 420,
            dataOmitted: true,
        },
        locator: {
            entryId: "entry-att-1",
            contentIndex: 0,
        },
        target: "attachment://sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        firstSeenAt: 1750000000000 - 1000 * 60 * 30,
        lastSeenAt: 1750000000000 - 1000 * 60 * 10,
        referenceCount: 2,
    },
    {
        attachment: {
            attachmentId: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
            name: "lin_yuan_portrait.webp",
            mimeType: "image/webp",
            bytes: 1024 * 186,
            dataOmitted: true,
        },
        locator: {
            entryId: "entry-att-2",
            contentIndex: 1,
        },
        target: "attachment://sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        firstSeenAt: 1750000000000 - 1000 * 60 * 25,
        lastSeenAt: 1750000000000 - 1000 * 60 * 5,
        referenceCount: 1,
    },
    {
        attachment: {
            attachmentId: "sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
            name: "mist_harbor_chronicle.pdf",
            mimeType: "application/pdf",
            bytes: 1024 * 1024 * 2.4,
            dataOmitted: true,
        },
        locator: {
            entryId: "entry-att-3",
            contentIndex: 0,
        },
        target: "attachment://sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        firstSeenAt: 1750000000000 - 1000 * 60 * 20,
        lastSeenAt: 1750000000000 - 1000 * 60 * 20,
        referenceCount: 1,
    },
] satisfies AgentSessionAttachmentItemDto[];

export const agentSessionAttachmentPanelScenes = [
    {
        id: "mixed",
        label: "图文与文档混合附件网格",
        input: {
            props: {
                sessionId: 101,
                items: sampleSessionAttachments,
                total: 5,
                hasMore: true,
                loading: false,
                insertDisabled: false,
                teleportTarget: false,
            },
            model: {search: ""},
        },
    },
    {
        id: "insert-disabled",
        label: "只读禁插状态（Composer 不可编辑）",
        input: {
            props: {
                sessionId: 101,
                items: sampleSessionAttachments,
                total: 3,
                hasMore: false,
                loading: false,
                insertDisabled: true,
                teleportTarget: false,
            },
            model: {search: ""},
        },
    },
    {
        id: "empty-search",
        label: "搜索无匹配结果",
        input: {
            props: {
                sessionId: 101,
                items: [],
                total: 0,
                hasMore: false,
                loading: false,
                insertDisabled: false,
                teleportTarget: false,
            },
            model: {search: "不存在的设定草图"},
        },
    },
    {
        id: "loading",
        label: "加载更多附件中",
        input: {
            props: {
                sessionId: 101,
                items: sampleSessionAttachments.slice(0, 2),
                total: 5,
                hasMore: true,
                loading: true,
                insertDisabled: false,
                teleportTarget: false,
            },
            model: {search: ""},
        },
    },
] satisfies LabFixtureDefinition<typeof AgentSessionAttachmentPanel>["scenes"];

export const agentModeSessionSidebarScenes = [
    {
        id: "expanded",
        label: "展开态（含置顶与多状态会话）",
        input: {
            props: {
                sessions: sampleSessionList,
                activeSessionId: 101,
                loading: false,
                actionId: null,
                open: true,
            },
            model: {pinnedSessionIds: [103]},
        },
    },
    {
        id: "running",
        label: "运行与归档操作中",
        input: {
            props: {
                sessions: sampleSessionList,
                activeSessionId: 102,
                loading: false,
                actionId: 104,
                open: true,
            },
            model: {pinnedSessionIds: [101, 103]},
        },
    },
    {
        id: "empty",
        label: "空会话列表",
        input: {
            props: {
                sessions: [],
                activeSessionId: null,
                loading: false,
                actionId: null,
                open: true,
            },
            model: {pinnedSessionIds: []},
        },
    },
    {
        id: "collapsed",
        label: "收起侧栏态",
        input: {
            props: {
                sessions: sampleSessionList,
                activeSessionId: 101,
                loading: false,
                actionId: null,
                open: false,
            },
            model: {pinnedSessionIds: [103]},
        },
    },
] satisfies LabFixtureDefinition<typeof AgentModeSessionSidebar>["scenes"];

export const workbenchCommandPaletteScenes = [
    {id: "command-navigation", label: "命令与行号导航"},
    {id: "readonly", label: "只读文档"},
    {id: "commands-unavailable", label: "无活动编辑器"},
] satisfies LabFixtureDefinition<typeof WorkbenchCommandPalette>["scenes"];

const view = {
    id: "lab.instances.demo", titleKey: "lab.instances.demo", icon: "i-lucide-square",
    container: "lab.container.left", layout: "fill", order: 10, weight: 1,
    canToggleVisibility: false, canMoveView: false, factoryKey: "lab.view.instances", stateScope: "user",
} as const;

const instanceEntry = {
    view, title: "实例演示视图", containerId: "lab.container.left", order: 10,
    source: "default", visible: true, visibilityReasons: [], actionable: true, authorityReasons: [],
} as const;

export const workbenchViewInstancesScenes = [
    {id: "default", label: "实例落在左栏（可搬容器、可设不可见）", input: {props: {views: [instanceEntry]}}},
    {id: "moved", label: "搬到面板：同一实例不重挂", input: {props: {views: [instanceEntry]}}},
    {id: "hidden", label: "不可见的视图不渲染实例", input: {props: {views: [{...instanceEntry, visible: false, visibilityReasons: ["Lab 场景把这条视图设为不可见：实例被释放，落点不留空盒"]}]}}},
] satisfies LabFixtureDefinition<typeof WorkbenchViewInstances>["scenes"];

