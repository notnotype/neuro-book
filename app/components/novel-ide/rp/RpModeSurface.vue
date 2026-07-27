<script setup lang="ts">
import {computed, ref} from "vue";
import AgentChatSurface from "nbook/app/components/novel-ide/agent/AgentChatSurface.vue";
import AgentModeSessionSidebar from "nbook/app/components/novel-ide/agent/AgentModeSessionSidebar.vue";
import RpSidebar from "nbook/app/components/novel-ide/rp/RpSidebar.vue";
import RpProsePanel from "nbook/app/components/novel-ide/rp/RpProsePanel.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

/**
 * RP 模式第三布局：嵌在 IDE 头部下方的内容区（非弹窗）。
 * 从左到右：会话列表（可收起）→ 世界/地图/角色面板 → rp.leader 沉浸对话流 → 正文阅读面板（可收起）。
 */
const props = defineProps<{
    /** 当前布局是否处于 RP 模式（透传给对话流做激活控制）。 */
    active: boolean;
    projectPath: string;
    novelId: string;
    /** 打开消息 Markdown 中的 workspace 引用（正文链接在本层拦截给正文面板，其余透传）。 */
    openReference?: (target: string) => void;
}>();

const emit = defineEmits<{
    /** 正文面板选区生图请求，透传给宿主（index.vue）打开生图面板。 */
    (e: "generate-illustration", payload: {tickDir: string; anchorText: string; occurrence: number; text: string}): void;
}>();

const notification = useNotification();
const sidebarRef = ref<InstanceType<typeof RpSidebar> | null>(null);
const chatRef = ref<InstanceType<typeof AgentChatSurface> | null>(null);
const prosePanelRef = ref<InstanceType<typeof RpProsePanel> | null>(null);
const sidebarVisible = ref(true);
const proseVisible = ref(true);
const proseWidth = ref(420);
const sessionPanelOpen = ref(false);
const sessionPanelWidth = ref(280);

// ---- RP 会话列表（仅 rp.leader 会话，独立于写作模式 Agent 页面）--------------------------
// 列表数据与操作全部复用 AgentChatSurface 暴露的会话 API，本层只做接线。

const rpSessions = computed<AgentSessionSummaryDto[]>(() => chatRef.value?.sessions ?? []);
const rpActiveSessionId = computed(() => chatRef.value?.activeSessionId ?? null);
const rpSessionLoading = computed(() => chatRef.value?.loadingSession ?? false);
const rpSessionRunning = computed(() => chatRef.value?.running ?? false);
const rpSessionActionId = computed(() => chatRef.value?.sessionActionId ?? null);

/** 刷新 rp.leader 会话列表。 */
async function refreshRpSessions(): Promise<void> {
    await chatRef.value?.refreshSessionsWithQuery({
        profileKey: "rp.leader",
        status: "active",
        relation: "all",
        limit: 50,
    });
}

/** agent 改动 workspace 时刷新侧栏与正文（本 Tick 的世界写回/正文落盘会触发）。 */
function handleWorkspaceSync(): void {
    void sidebarRef.value?.refresh();
    void prosePanelRef.value?.refresh();
}

/**
 * RP 内的引用打开：`rp/ticks/<dir>/prose.md` 链接直接在右侧正文面板内定位展示
 * （RP 布局下 IDE 编辑器不可见，跳编辑器等于"打不开"），其余引用透传给宿主。
 */
function openRpReference(target: string): void {
    const proseDir = /(?:^|\/)rp\/ticks\/([^/]+)\/prose\.md$/u.exec(target.trim())?.[1];
    if (proseDir) {
        proseVisible.value = true;
        void prosePanelRef.value?.reveal(proseDir);
        return;
    }
    props.openReference?.(target);
}

// ---- 掷骰（2d6）----------------------------------------------------------------
// 骰值由服务端 crypto RNG 生成并追加写入 rp/dice/rolls.jsonl（agent 的唯一真相源）；
// 点击后自动向 rp.leader 发送回执消息续流程。

type DiceRollDto = {seq: number; d1: number; d2: number; total: number; at: string};

const rolling = ref(false);
const lastRoll = ref<DiceRollDto | null>(null);

/** 刷新正文面板（插画写回 prose.md 后由宿主调用）。 */
async function refreshProse(): Promise<void> {
    await prosePanelRef.value?.refresh();
}

defineExpose({refreshProse});

async function rollDice(): Promise<void> {
    if (rolling.value || !props.projectPath) return;
    rolling.value = true;
    try {
        const roll = await $fetch<DiceRollDto>("/api/projects/rp/dice", {
            method: "POST",
            query: {projectPath: props.projectPath},
        });
        lastRoll.value = roll;
        const message = `🎲 掷骰 #${roll.seq}：${roll.d1} + ${roll.d2} = ${roll.total}（记录于 rp/dice/rolls.jsonl，以文件为准）`;
        const sent = await chatRef.value?.sendUserMessage(message);
        if (!sent) {
            notification.info(`已掷出 ${roll.d1} + ${roll.d2} = ${roll.total}（#${roll.seq}）。当前无法自动发送回执，请在对话中告知彩绘。`, {title: "掷骰完成"});
        }
    } catch (error) {
        notification.error(error instanceof Error ? error.message : String(error), {title: "掷骰失败"});
    } finally {
        rolling.value = false;
    }
}
</script>

<template>
    <!-- RP 模式内容区：会话列表 + 世界面板 + 对话流 + 正文面板 -->
    <div class="flex min-h-0 flex-1 overflow-hidden bg-[var(--bg-main)]">
        <!-- RP 会话列表（仅 rp.leader，样式复用 Agent Mode 会话侧栏） -->
        <AgentModeSessionSidebar
            :sessions="rpSessions"
            :active-session-id="rpActiveSessionId"
            :loading="rpSessionLoading"
            :running="rpSessionRunning"
            :action-id="rpSessionActionId"
            :workspace-key="`rp:${props.projectPath}`"
            :open="sessionPanelOpen"
            :width="sessionPanelWidth"
            @update:width="sessionPanelWidth = $event"
            @select="void chatRef?.selectSession($event)"
            @create="void chatRef?.createSession()"
            @archive="void chatRef?.archiveSessionFromDialog($event)"
            @rename="void chatRef?.renameSessionFromDialog($event)"
            @refresh="void refreshRpSessions()"
        />

        <aside v-if="sidebarVisible" class="ide-panel w-[360px] shrink-0 border-r border-[var(--border-color)]">
            <RpSidebar ref="sidebarRef" :project-path="props.projectPath" />
        </aside>

        <!-- 左侧功能轨道：会话列表开关 + 世界面板收起/展开 -->
        <div class="flex w-6 shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-panel)]">
            <button
                type="button"
                class="flex h-10 w-full items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :class="sessionPanelOpen ? 'text-[var(--accent-text)]' : ''"
                :title="sessionPanelOpen ? '收起会话列表' : '展开会话列表'"
                @click="sessionPanelOpen = !sessionPanelOpen"
            >
                <span class="i-lucide-messages-square h-4 w-4"></span>
            </button>
            <button
                type="button"
                class="flex w-full flex-1 items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :title="sidebarVisible ? '收起世界面板' : '展开世界面板'"
                @click="sidebarVisible = !sidebarVisible"
            >
                <span :class="sidebarVisible ? 'i-lucide-chevron-left' : 'i-lucide-chevron-right'" class="h-4 w-4"></span>
            </button>
        </div>

        <div class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <AgentChatSurface
                ref="chatRef"
                :active="props.active"
                layout="workbench"
                :novel-id="props.novelId"
                profile-key-override="rp.leader"
                :open-reference="openRpReference"
                class="min-h-0 flex-1"
                @sync-workspace="handleWorkspaceSync"
            />
            <!-- 掷骰按钮（2d6）：悬浮于对话流右下角,避开输入框 -->
            <div class="pointer-events-none absolute bottom-24 right-4 z-20 flex flex-col items-end gap-1.5">
                <div v-if="lastRoll" class="pointer-events-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] shadow-md" :title="lastRoll.at">
                    上次 #{{ lastRoll.seq }}：<span class="font-mono font-semibold text-[var(--text-main)]">{{ lastRoll.d1 }} + {{ lastRoll.d2 }} = {{ lastRoll.total }}</span>
                </div>
                <button
                    type="button"
                    data-testid="rp-dice-button"
                    class="pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--accent-main)_58%,var(--border-color))] bg-[var(--bg-panel)] text-[var(--accent-main)] shadow-lg transition-transform hover:scale-105 disabled:opacity-50"
                    :disabled="rolling"
                    title="掷骰（2d6）：结果由服务端随机生成并写入 rp/dice/rolls.jsonl"
                    @click="void rollDice()"
                >
                    <span :class="rolling ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-dices'" class="h-6 w-6"></span>
                </button>
            </div>
        </div>

        <!-- 右侧功能轨道：正文面板收起/展开 -->
        <div class="flex w-6 shrink-0 flex-col border-l border-[var(--border-color)] bg-[var(--bg-panel)]">
            <button
                type="button"
                class="flex w-full flex-1 items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :class="proseVisible ? 'text-[var(--accent-text)]' : ''"
                :title="proseVisible ? '收起正文面板' : '展开正文面板'"
                @click="proseVisible = !proseVisible"
            >
                <span class="i-lucide-book-open-text h-4 w-4"></span>
            </button>
        </div>

        <!-- 正文阅读面板：rp.writer 每 Tick 的最终正文按顺序接续展示 -->
        <RpProsePanel
            ref="prosePanelRef"
            :project-path="props.projectPath"
            :open="proseVisible"
            :width="proseWidth"
            @update:width="proseWidth = $event"
            @generate-illustration="emit('generate-illustration', $event)"
        />
    </div>
</template>
