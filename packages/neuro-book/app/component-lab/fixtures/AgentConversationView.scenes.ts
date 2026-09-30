import type AgentConversationView from "../../components/agent/AgentConversationView.vue";
import type {LabFixtureDefinition} from "./index";
import {
    conversationContext,
    messageStateMessages,
    pagedConversationMessages,
    runningConversationMessages,
    runningConversationNow,
    streamingMessages,
    streamingNow,
} from "./agent-conversation-fixture-data";

type Scene = LabFixtureDefinition<typeof AgentConversationView>["scenes"][number];

export const agentConversationViewScenes: Scene[] = [
    {
        id: "long-conversation",
        label: "多轮长对话",
        input: {props: {ctx: conversationContext(), teleportTarget: false}, model: {viewMode: "turns"}},
    },
    {
        id: "running",
        label: "运行中",
        input: {
            props: {
                ctx: conversationContext({
                    messages: runningConversationMessages,
                    run: {status: "running", phase: "正在读取文件"},
                    now: runningConversationNow,
                }),
                teleportTarget: false,
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "streaming",
        label: "流式输出",
        input: {
            props: {
                ctx: conversationContext({
                    messages: streamingMessages,
                    run: {status: "running", phase: "正在输出"},
                    branches: {},
                    now: streamingNow,
                }),
                teleportTarget: false,
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "history-paged",
        label: "历史分页",
        input: {
            props: {
                ctx: conversationContext({messages: pagedConversationMessages, history: {hasMore: true, loading: false, error: null}}),
                teleportTarget: false,
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "history-error",
        label: "历史加载失败",
        input: {
            props: {
                ctx: conversationContext({
                    messages: pagedConversationMessages,
                    history: {hasMore: true, loading: false, error: "网络连接中断，更早的内容没有加载。"},
                }),
                teleportTarget: false,
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "message-states",
        label: "消息状态",
        input: {
            props: {ctx: conversationContext({messages: messageStateMessages, branches: {}, now: messageStateMessages.at(-1)!.timestamp}), teleportTarget: false},
            model: {viewMode: "turns"},
        },
    },
    {
        id: "raw",
        label: "原始视图",
        input: {props: {ctx: conversationContext(), teleportTarget: false}, model: {viewMode: "raw"}},
    },
    {
        id: "no-session",
        label: "未选择会话",
        input: {
            props: {
                ctx: conversationContext({
                    session: null,
                    messages: [],
                    availability: {status: "unselected", message: "选择或新建一个会话后开始对话。", actions: []},
                }),
                teleportTarget: false,
            },
            model: {viewMode: "turns"},
        },
    },
];
