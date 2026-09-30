<script setup lang="ts">
/**
 * AgentConversationView 的 Lab 夹具。ctx 与 viewMode 来自场景输入，可在数据 tab 直接编辑；
 * services 与注册表是运行期能力，由夹具补齐。夹具扮演宿主：处理发送、重新发送与移除、加载更早的内容，
 * 并在“模拟宿主”里提供流式输出、追加步骤、运行结束与切换会话，让随时间变化的行为
 * （跟随底部、阅读位置不动、历史分页）能在 Lab 里手动或由 smoke 驱动验证。按钮带 `data-lab-action` 供 smoke 定位。
 */
import {computed, onBeforeUnmount, onMounted, ref, shallowRef} from "vue";
import AgentConversationView from "nbook/app/components/agent/AgentConversationView.vue";
import type {
    AgentConversationContext,
    AgentConversationServices,
    AgentViewAction,
    AssistantMessageView,
    MessageView,
} from "nbook/app/components/agent/agent-view.types";
import {createAgentViewRegistry} from "nbook/app/components/agent/agent-view-registry";
import {builtinMessageActionsContribution} from "nbook/app/components/agent/builtin-message-actions";
import {builtinRolesContribution} from "nbook/app/components/agent/builtin-roles";
import {builtinToolsContribution} from "nbook/app/components/agent/builtin-tools";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";
import {labAttachmentUrls, longConversationMessages} from "./agent-conversation-fixture-data";

const props = defineProps<LabFixtureProps>();

const subject = useLabSubject<typeof AgentConversationView>(() => props.input, ["action"]);

const registry = createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, builtinMessageActionsContribution]);

/** DOMPurify 依赖 window，挂载后才装上；装上之前回复按纯文本显示，正是 Spec 规定的缺省行为。 */
const sanitizeHtml = shallowRef<((html: string) => string) | undefined>(undefined);

onMounted(async () => {
    const {default: createDOMPurify} = await import("dompurify");
    const purifier = createDOMPurify(window);
    sanitizeHtml.value = (html) => purifier.sanitize(html);
});

const services = computed<AgentConversationServices>(() => ({
    sanitizeHtml: sanitizeHtml.value,
    resolveAttachmentUrl: (locator) => labAttachmentUrls[locator] ?? null,
    resolveTriggerMenu: () => [],
}));

const ctx = computed<AgentConversationContext>(() => subject.bindings.value.ctx);

function writeCtx(patch: Partial<AgentConversationContext>) {
    subject.write("props", "ctx", {...ctx.value, ...patch});
}

function mapMessages(update: (message: MessageView) => MessageView | null) {
    writeCtx({messages: ctx.value.messages.flatMap((message) => update(message) ?? [])});
}

/** 模拟网络延迟的定时器；夹具卸载时一并取消，免得写到下一个场景的数据上。 */
const timers = new Set<ReturnType<typeof setTimeout>>();

function later(ms: number, run: () => void) {
    const timer = setTimeout(() => {
        timers.delete(timer);
        run();
    }, ms);
    timers.add(timer);
}

onBeforeUnmount(() => {
    timers.forEach((timer) => clearTimeout(timer));
});

function onAction(action: AgentViewAction) {
    switch (action.type) {
        case "composer.submit": {
            const current = ctx.value;
            const message: MessageView = {
                kind: "user", id: `lab-user-${current.messages.length}`, timestamp: current.now,
                intent: action.delivery === "steer" ? "steer" : "normal",
                blocks: [{kind: "text", text: action.text}], contentOmitted: false,
            };
            writeCtx({
                messages: [...current.messages, message],
                composer: {...current.composer, draft: {text: "", version: current.composer.draft.version + 1}},
            });
            break;
        }
        case "history.loadPrevious":
            loadPrevious();
            break;
        case "message.resend":
            resend(action.messageId);
            break;
        case "message.dismiss":
            mapMessages((message) => message.id === action.messageId ? null : message);
            break;
    }
}

// ─── 历史分页 ───────────────────────────────────────────────────────────

/** 每页条数；故意不按轮次切，第一组会开头不完整，下一页加载后与它合并。 */
const PAGE_SIZE = 5;
const failNextLoad = ref(false);

/** 更早的内容从长对话里按页补；场景的第一条消息不在长对话里时没有更早的内容。 */
function loadPrevious() {
    if (ctx.value.history.loading) {
        return;
    }
    writeCtx({history: {...ctx.value.history, loading: true, error: null}});
    later(700, () => {
        if (failNextLoad.value) {
            failNextLoad.value = false;
            writeCtx({history: {hasMore: true, loading: false, error: "网络连接中断，更早的内容没有加载。"}});
            return;
        }
        const current = ctx.value;
        const start = longConversationMessages.findIndex((message) => message.id === current.messages[0]?.id);
        const from = Math.max(0, start - PAGE_SIZE);
        writeCtx({
            messages: start > 0 ? [...longConversationMessages.slice(from, start), ...current.messages] : current.messages,
            history: {hasMore: start > 0 && from > 0, loading: false, error: null},
        });
    });
}

// ─── 投递 ───────────────────────────────────────────────────────────────

function resend(messageId: string) {
    mapMessages((message) => message.id === messageId && message.kind === "user" ? {...message, delivery: "pending"} : message);
    later(800, () => mapMessages((message) => {
        if (message.id !== messageId || message.kind !== "user") {
            return message;
        }
        const {delivery: _delivered, ...confirmed} = message;
        return confirmed;
    }));
}

// ─── 运行中的模拟 ───────────────────────────────────────────────────────

const running = computed(() => ctx.value.run.status !== "idle");

const STREAM_CHUNKS = [
    "第六章开头准备改成深夜来客：门铃在凌晨三点响了，林默没有开灯。",
    "\n\n门外的人说，他带来一块从河里捞上来的表，表盘里全是水汽，指针停在三点整。",
    "\n\n这样读者的第一个疑问会提前到第一段：谁会在凌晨三点来修一块停在三点的表？",
    "\n\n接下来我会顺着这个疑问调整第二段，把原来的天气描写往后挪。",
];
let chunkIndex = 0;

function finishCalls(message: AssistantMessageView): AssistantMessageView {
    return {
        ...message,
        status: message.status === "streaming" ? "done" : message.status,
        toolCalls: message.toolCalls.map((call) => call.status === "running" || call.status === "streaming" ? {...call, status: "success"} : call),
    };
}

/** 最后一条是正在生成的回复就接着写，否则开一条新回复。 */
function streamText() {
    const current = ctx.value;
    const now = current.now + 1000;
    const chunk = STREAM_CHUNKS[chunkIndex % STREAM_CHUNKS.length]!;
    chunkIndex += 1;
    const last = current.messages.at(-1);
    const messages = last?.kind === "assistant" && last.status === "streaming"
        ? [...current.messages.slice(0, -1), {...last, text: last.text + chunk}]
        : [...current.messages.map((message) => message.kind === "assistant" ? finishCalls(message) : message), {
            kind: "assistant", id: `lab-stream-${current.messages.length}`, timestamp: now, status: "streaming",
            text: chunk.trimStart(), thinking: "", model: "deepseek-chat", toolCalls: [], contentOmitted: false,
        } satisfies AssistantMessageView];
    writeCtx({messages, now});
}

/** 收尾上一步，再追加一条正在读文件的消息。 */
function appendStep() {
    const current = ctx.value;
    const now = current.now + 2000;
    const index = current.messages.length;
    writeCtx({
        messages: [...current.messages.map((message) => message.kind === "assistant" ? finishCalls(message) : message), {
            kind: "assistant", id: `lab-step-${index}`, timestamp: now, status: "streaming", text: "",
            thinking: "再核对一处前文。", model: "deepseek-chat", contentOmitted: false,
            toolCalls: [{id: `lab-call-${index}`, name: "read", status: "running", args: {path: `chapters/0${index % 9}.md`}}],
        }],
        now,
    });
}

/**
 * 模拟运行正常结束：未完成的工具调用记为成功；最后一条已是正在生成的回复时它就是最终回复，否则追加一条。
 * 没有手动操作过的最新一轮随之自动折叠。
 */
function finishRun() {
    const current = ctx.value;
    const now = current.now + 5000;
    const last = current.messages.at(-1);
    const messages: MessageView[] = current.messages.map((message) => message.kind === "assistant" ? finishCalls(message) : message);
    if (!(last?.kind === "assistant" && last.status === "streaming" && last.text.trim() !== "" && last.toolCalls.length === 0)) {
        messages.push({
            kind: "assistant", id: `lab-final-${messages.length}`, timestamp: now, status: "done",
            text: "第六章开头已改写：先抛出修表铺深夜来客的悬念，再倒叙交代来意。", thinking: "", model: "deepseek-chat",
            toolCalls: [], contentOmitted: false, usage: {input: 9000, output: 260, cacheRead: 8000, cacheWrite: 0, cost: 0.0052},
        });
    }
    writeCtx({messages, run: {status: "idle", phase: ""}, now});
}

function advanceClock() {
    writeCtx({now: ctx.value.now + 10_000});
}

/** 换一个会话 id：视图应回到最新内容，各轮的展开状态清空。 */
function switchSession() {
    const session = ctx.value.session;
    if (session !== null) {
        const next = session.id === "session-1" ? "session-2" : "session-1";
        writeCtx({session: {...session, id: next, title: next === "session-1" ? "第三章节奏调整" : "另一个会话"}});
    }
}
</script>

<template>
    <AgentConversationView
        data-lab-subject
        class="h-full w-full"
        v-bind="subject.bindings.value"
        :services="services"
        :registry="registry"
        @action="onAction"
    />
    <LabFixtureControls>
        <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-[var(--text-secondary)]">模拟宿主</span>
            <template v-if="running">
                <button type="button" class="rounded border border-[var(--border-color)] px-2 py-0.5 hover:bg-[var(--bg-hover)]" data-lab-action="stream" @click="streamText">流式输出</button>
                <button type="button" class="rounded border border-[var(--border-color)] px-2 py-0.5 hover:bg-[var(--bg-hover)]" data-lab-action="step" @click="appendStep">追加一步</button>
                <button type="button" class="rounded border border-[var(--border-color)] px-2 py-0.5 hover:bg-[var(--bg-hover)]" data-lab-action="clock" @click="advanceClock">时间 +10 秒</button>
                <button type="button" class="rounded border border-[var(--border-color)] px-2 py-0.5 hover:bg-[var(--bg-hover)]" data-lab-action="finish" @click="finishRun">运行结束</button>
            </template>
            <button type="button" class="rounded border border-[var(--border-color)] px-2 py-0.5 hover:bg-[var(--bg-hover)]" data-lab-action="session" @click="switchSession">切换会话</button>
            <label v-if="ctx.history.hasMore" class="inline-flex items-center gap-1">
                <input v-model="failNextLoad" type="checkbox" data-lab-action="fail-next">下次加载失败
            </label>
        </div>
    </LabFixtureControls>
</template>
