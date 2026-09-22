<script setup lang="ts">
import {computed, ref, watch} from "vue";
import AgentChatFlow from "../../components/novel-ide/agent/flow/AgentChatFlow.vue";
import type {AgentMessage} from "../../components/novel-ide/agent/agent-message";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";
import {Button} from "@notnotype/nb-ui/components";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

const flowRef = ref<InstanceType<typeof AgentChatFlow> | null>(null);

function createMockMessages(scene: string): AgentMessage[] {
    switch (scene) {
        case "conversation":
            return [
                {
                    id: "msg-1",
                    type: "user",
                    content: "请帮我分析一下第二章中主角的心理动机转变，是否有铺垫不足的问题？",
                    timestamp: "10:00:00",
                },
                {
                    id: "msg-2",
                    type: "ai",
                    thinking: "分析第二章的核心事件：主角在得知真相后立刻选择背叛组织。\n从前文来看，第一章只展示了主角对组织的忠诚，未明确交代其对家庭秘密的执念，因而这里的态度转变略显突兀。\n建议增加一处旧物线索或眼神犹豫的细节作为心理伏笔。",
                    content: "梳理第二章的文本后，确实发现主角在得知家族旧事后的**心理转变速度过快**。\n\n具体表现为：\n1. **缺乏缓冲**：从坚决执行命令到倒戈仅隔了半页对话；\n2. **建议补充铺垫**：可以在第一章末尾任务交接时，让他触碰父亲留下的怀表或闪回一段童年回忆，使背叛变得合情合理。",
                    status: "done",
                    timestamp: "10:00:05",
                },
                {
                    id: "msg-3",
                    type: "user",
                    content: "好的，那如果我在这里加入一段怀表的特写，具体要怎么写比较自然？",
                    timestamp: "10:01:00",
                },
            ];
        case "with-tools":
            return [
                {
                    id: "msg-tool-1",
                    type: "user",
                    content: "查一下项目中是否有关于‘暗夜之誓’的历史设定条目？",
                    timestamp: "10:10:00",
                },
                {
                    id: "msg-tool-2",
                    type: "ai",
                    thinking: "需要搜索工作区中的世界观设定与历史词条。",
                    content: "正在为您检索‘暗夜之誓’的相关文档与历史记载...",
                    status: "done",
                    toolCalls: [
                        {
                            id: "tool-call-1",
                            index: 0,
                            name: "search_workspace",
                            argsText: JSON.stringify({query: "暗夜之誓", scope: "world-engine"}),
                            status: "success",
                            result: "在设定集《旧历残篇·第三卷》中找到 2 处匹配：公元前 320 年由夜影骑士团签署，旨在誓死守卫灵脉封印。",
                        },
                        {
                            id: "tool-call-2",
                            index: 1,
                            name: "read_file",
                            argsText: JSON.stringify({path: "lore/night-vow.md"}),
                            status: "success",
                            result: "### 暗夜之誓\n签署者：艾尔德林等十二先知。\n誓约代价：一旦违背，灵魄将被幽火灼蚀。",
                        },
                    ],
                    timestamp: "10:10:08",
                },
                {
                    id: "msg-tool-3",
                    type: "ai",
                    content: "查询完毕！在《旧历残篇·第三卷》与 `lore/night-vow.md` 中均记录了**暗夜之誓**：\n\n- **签署背景**：公元前 320 年夜影骑士团为守卫灵脉封印而立；\n- **代价规则**：违誓者将被幽火灼蚀灵魄，具有极高的强制契约效力。",
                    status: "done",
                    timestamp: "10:10:12",
                },
            ];
        case "history-loading":
            return [
                {
                    id: "msg-hist-1",
                    type: "user",
                    content: "这是当前页的第一条可见消息。",
                    timestamp: "09:30:00",
                },
                {
                    id: "msg-hist-2",
                    type: "ai",
                    content: "这是当前页的回复内容。顶部可以看到历史翻页状态提示。",
                    status: "done",
                    timestamp: "09:30:04",
                },
            ];
        case "streaming-simulation":
            return [
                {
                    id: "msg-sim-1",
                    type: "user",
                    content: "请写一段关于雨夜荒原的描写。",
                    timestamp: "11:00:00",
                },
                {
                    id: "msg-sim-2",
                    type: "ai",
                    content: "暴雨如注，无边无际的荒原在电闪雷鸣中忽明忽暗...",
                    status: "streaming",
                    timestamp: "11:00:02",
                },
            ];
        case "empty-main":
        case "empty-unselected":
        case "empty-compact":
        default:
            return [];
    }
}

const localMessages = ref<AgentMessage[]>(createMockMessages(props.scene));

watch(() => props.scene, (newScene) => {
    localMessages.value = createMockMessages(newScene);
}, {immediate: true});

const mode = computed<"main" | "compact">(() => {
    return props.scene === "empty-compact" ? "compact" : "main";
});

const unselected = computed(() => {
    return props.scene === "empty-unselected";
});

const historyHasPrevious = computed(() => {
    return props.scene === "history-loading";
});

const historyLoading = computed(() => {
    return props.scene === "history-loading";
});

function handleAppendStreamingChunk(): void {
    const last = localMessages.value.at(-1);
    if (last && last.type === "ai") {
        last.content += "\n冷风夹杂着泥土的气息，马蹄深陷在泥泞中，前方的路已彻底辨认不清。";
    } else {
        localMessages.value.push({
            id: `msg-stream-${Date.now()}`,
            type: "ai",
            content: "新流式输出段落...",
            status: "streaming",
            timestamp: "11:01:00",
        });
    }
}

function handleScrollToBottom(): void {
    flowRef.value?.scrollToBottom();
}

function handleEvent(name: string, payload?: unknown): void {
    emitLabEvent(name, payload);
}

watch(localMessages, (msgs) => {
    syncLabData({
        scene: props.scene,
        messageCount: msgs.length,
        mode: mode.value,
        unselected: unselected.value,
    });
}, {deep: true, immediate: true});
</script>

<template>
    <AgentChatFlow
        ref="flowRef"
        class="h-full w-full"
        data-lab-subject
        :messages="localMessages"
        :mode="mode"
        :unselected="unselected"
        :history-has-previous="historyHasPrevious"
        :history-loading="historyLoading"
        @load-previous="handleEvent('load-previous')"
        @copy="handleEvent('copy', $event)"
        @copy-tool="handleEvent('copy-tool', $event)"
        @start-edit="handleEvent('start-edit', $event)"
        @retry="handleEvent('retry', $event)"
        @branch-from-here="handleEvent('branch-from-here', $event)"
    />

    <!-- 流式仿真控制器：下放至 Lab 底部抽屉栏 -->
    <LabFixtureControls v-if="props.scene === 'streaming-simulation'">
        <div class="flex items-center justify-between gap-2 text-xs select-none">
            <span class="font-medium text-[var(--text-secondary)]">流式仿真控制器</span>
            <div class="flex items-center gap-2">
                <Button size="sm" variant="secondary" @click="handleAppendStreamingChunk">
                    追加流式文本
                </Button>
                <Button size="sm" variant="ghost" @click="handleScrollToBottom">
                    强制滚底
                </Button>
            </div>
        </div>
    </LabFixtureControls>
</template>
