<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import {Button, Dropdown, IconButton, Spinner} from "@notnotype/nb-ui/components";
import type {DropdownItem} from "@notnotype/nb-ui/components";
import type {
    AgentConversationContext,
    AgentConversationServices,
    AgentViewAction,
    AgentViewMode,
    SubmitDelivery,
} from "./agent-view.types";
import type {AgentViewRegistry} from "./agent-view-registry";
import {assignTurnKeys, splitIntoTurnGroups} from "./conversation-turns";
import {useStreamScroll} from "./use-stream-scroll";
import AgentConversationTurn from "./AgentConversationTurn.vue";
import AgentRawView from "./AgentRawView.vue";

const props = withDefaults(defineProps<{
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
    viewMode?: AgentViewMode;
    teleportTarget?: string | false;
}>(), {
    viewMode: undefined,
    teleportTarget: false,
});

const emit = defineEmits<{
    (e: "action", action: AgentViewAction): void;
    (e: "update:viewMode", mode: AgentViewMode): void;
}>();

const {t} = useI18n();

// ─── 视图模式 ───────────────────────────────────────────────────────────

const localViewMode = ref<AgentViewMode>("turns");
const currentViewMode = computed(() => props.viewMode ?? localViewMode.value);

function setViewMode(mode: AgentViewMode) {
    localViewMode.value = mode;
    emit("update:viewMode", mode);
}

const overflowItems = computed<DropdownItem[]>(() => [{
    value: "toggle-view-mode",
    label: currentViewMode.value === "raw" ? t("agentView.header.turnsView") : t("agentView.header.rawView"),
    iconClass: currentViewMode.value === "raw" ? "i-lucide-list-collapse" : "i-lucide-list",
}]);

function onOverflowSelect(value: string) {
    if (value === "toggle-view-mode") {
        setViewMode(currentViewMode.value === "raw" ? "turns" : "raw");
    }
}

// ─── 轮次 ───────────────────────────────────────────────────────────────

/** 按轮次边界切好的消息；每一轮的整理、折叠与操作由 AgentConversationTurn 负责。 */
const turnGroups = computed(() => splitIntoTurnGroups(props.ctx.messages));

/** 上一次分配的 key 只用来让下一次沿用，不参与渲染依赖。 */
let previousTurnKeys = new Map<string, string>();
const turnKeys = computed(() => {
    previousTurnKeys = assignTurnKeys(turnGroups.value, previousTurnKeys);
    return previousTurnKeys;
});

// ─── 滚动与历史 ─────────────────────────────────────────────────────────

const streamRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);

const {following, scrollToLatest, recheckNearTop} = useStreamScroll({
    scroller: streamRef,
    content: contentRef,
    onNearTop: () => requestHistory(false),
});

// 切换会话后定位到最新内容；各轮的界面状态随组件的 key（含会话 id）一起重建。
watch(() => props.ctx.session?.id, () => {
    void nextTick(scrollToLatest);
});

const historyRow = computed(() => {
    const {hasMore, loading, error} = props.ctx.history;
    if (error !== null) {
        return "error";
    }
    if (loading) {
        return "loading";
    }
    return hasMore ? "more" : null;
});

/** 滚动触发的请求已经发出、宿主还没反映到 history 上；避免一次滚动连发。 */
let historyRequested = false;
watch(() => [props.ctx.history.loading, props.ctx.history.error, props.ctx.messages[0]?.id], () => {
    historyRequested = false;
});

// 一页加载完时高度可能不变（补上的内容都收在已收起的轮次里），不会触发滚动或尺寸校正，这里再看一次是否仍在顶部。
watch(() => props.ctx.history.loading, (loading, wasLoading) => {
    if (wasLoading && !loading) {
        recheckNearTop();
    }
});

/** 接近顶部时自动请求（失败后不自动重试）；用户点“更早的内容”或“重试”时是 explicit。 */
function requestHistory(explicit: boolean) {
    const {hasMore, loading, error} = props.ctx.history;
    if (!hasMore || loading || (!explicit && (historyRequested || error !== null))) {
        return;
    }
    historyRequested = true;
    emit("action", {type: "history.loadPrevious"});
}

// ─── 输入框（S1 占位：只有文字、发送与停止） ────────────────────────────

const composerRef = ref<HTMLTextAreaElement | null>(null);
const composerText = ref(props.ctx.composer.draft.text);

watch(() => props.ctx.composer.draft.version, () => {
    composerText.value = props.ctx.composer.draft.text;
});

const composerReadonly = computed(() => props.ctx.availability.status !== "ready" || !props.ctx.interaction.canSend);
const running = computed(() => props.ctx.run.status !== "idle");
const showStop = computed(() => running.value && composerText.value.trim() === "" && props.ctx.interaction.canStop);

function onComposerInput() {
    emit("action", {type: "composer.draftChanged", text: composerText.value});
}

function submit(delivery: SubmitDelivery) {
    const value = composerText.value.trim();
    if (value === "" || composerReadonly.value) {
        return;
    }
    emit("action", {type: "composer.submit", text: value, images: [], delivery});
}

function onComposerKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
    }
    event.preventDefault();
    if (!running.value) {
        submit("prompt");
    } else {
        submit(event.ctrlKey || event.metaKey ? "followup" : "steer");
    }
}

function onPrimaryButton() {
    if (showStop.value) {
        emit("action", {type: "composer.stop"});
    } else {
        submit(running.value ? "steer" : "prompt");
    }
}

function focusComposer() {
    composerRef.value?.focus();
}

defineExpose({focusComposer, scrollToLatest});
</script>

<template>
    <section class="agent-conversation-view flex h-full min-w-0 flex-col text-[13px] text-[var(--text-main)]">
        <header class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-3">
            <span
                v-if="props.ctx.session"
                :class="[props.ctx.session.profileIcon, 'size-4 shrink-0 text-[var(--text-muted)]']"
                aria-hidden="true"
            />
            <div class="min-w-[160px] flex-1 truncate" :title="props.ctx.session?.summary || undefined">
                <span class="font-medium">{{ props.ctx.session ? (props.ctx.session.title || t("agentView.header.untitled")) : t("agentView.header.noSession") }}</span>
                <span v-if="props.ctx.session" class="ml-2 text-[11px] text-[var(--text-muted)]">{{ props.ctx.session.profileName }}</span>
            </div>
            <Dropdown :items="overflowItems" root-class="relative inline-block" compact align="end" @select="onOverflowSelect">
                <IconButton icon-class="i-lucide-ellipsis" size="sm" :title="t('agentView.header.more')" :aria-label="t('agentView.header.more')" />
            </Dropdown>
        </header>

        <div class="relative flex min-h-0 flex-1 flex-col">
            <div ref="streamRef" class="acv-stream min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-5" data-agent-stream>
                <div ref="contentRef" class="acv-stream__content">
                    <p v-if="props.ctx.messages.length === 0" class="py-10 text-center text-[var(--text-muted)]">
                        {{ t("agentView.stream.empty") }}
                    </p>

                    <template v-else>
                        <!-- 更早的内容：也是开头不完整的第一轮的开头标记 -->
                        <div v-if="historyRow" class="acv-history" :data-history="historyRow">
                            <p v-if="historyRow === 'error'" class="acv-history__error" role="alert">
                                <span class="i-lucide-circle-alert acv-history__icon" aria-hidden="true" />
                                <span>{{ props.ctx.history.error }}</span>
                                <Button size="sm" variant="subtle" icon-class="i-lucide-rotate-cw" @click="requestHistory(true)">
                                    {{ t("agentView.history.retry") }}
                                </Button>
                            </p>
                            <p v-else-if="historyRow === 'loading'" class="acv-history__loading" role="status">
                                <Spinner size="sm" :label="t('agentView.history.loading')" />{{ t("agentView.history.loading") }}
                            </p>
                            <button v-else type="button" class="acv-history__more" @click="requestHistory(true)">
                                {{ t("agentView.history.more") }}
                            </button>
                        </div>

                        <!-- 分轮视图 -->
                        <template v-if="currentViewMode === 'turns'">
                            <AgentConversationTurn
                                v-for="(group, index) in turnGroups"
                                :key="`${props.ctx.session?.id ?? ''}:${turnKeys.get(group[0]!.id)}`"
                                :messages="group"
                                :ctx="props.ctx"
                                :services="props.services"
                                :registry="props.registry"
                                :latest="index === turnGroups.length - 1"
                                :first="index === 0"
                                @action="emit('action', $event)"
                            />
                        </template>

                        <!-- 原始视图：一条消息一个块，系统条目全部可见 -->
                        <AgentRawView
                            v-else
                            :messages="props.ctx.messages"
                            :ctx="props.ctx"
                            :services="props.services"
                            :registry="props.registry"
                            @action="emit('action', $event)"
                        />
                    </template>
                </div>
            </div>

            <Transition name="acv-fade">
                <Button
                    v-if="!following && props.ctx.messages.length > 0"
                    class="acv-jump"
                    size="sm"
                    variant="secondary"
                    icon-class="i-lucide-arrow-down"
                    data-jump-latest
                    @click="scrollToLatest"
                >
                    {{ t("agentView.stream.jumpToLatest") }}
                </Button>
            </Transition>
        </div>

        <footer class="shrink-0 border-t border-[var(--border-color)] p-2">
            <p v-if="props.ctx.availability.status !== 'ready'" class="mb-1.5 text-[12px] text-[var(--text-muted)]">
                {{ props.ctx.availability.message }}
            </p>
            <div class="flex items-end gap-2">
                <textarea
                    ref="composerRef"
                    v-model="composerText"
                    rows="2"
                    class="min-h-[40px] min-w-0 flex-1 resize-none rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 outline-none focus:border-[var(--accent-main)]"
                    :placeholder="running ? t('agentView.composer.placeholderRunning') : t('agentView.composer.placeholder')"
                    :readonly="composerReadonly"
                    :aria-label="t('agentView.composer.label')"
                    @input="onComposerInput"
                    @keydown="onComposerKeydown"
                />
                <IconButton
                    :icon-class="showStop ? 'i-lucide-square' : 'i-lucide-arrow-up'"
                    :variant="showStop ? 'danger' : 'accent'"
                    :disabled="composerReadonly && !showStop"
                    :title="showStop ? t('agentView.composer.stop') : t('agentView.composer.send')"
                    :aria-label="showStop ? t('agentView.composer.stop') : t('agentView.composer.send')"
                    @click="onPrimaryButton"
                />
            </div>
        </footer>
    </section>
</template>

<style scoped>
/*
 * 流式追加内容时滚动条出现与否不应挤动内容。
 * 关掉浏览器自带的滚动锚定，阅读位置统一由 useStreamScroll 校正，两者不会各修一次。
 */
.acv-stream {
    scrollbar-gutter: stable;
    overflow-anchor: none;
}

/* 面板拉宽时正文行过长难读，每轮限宽居中。 */
.acv-stream__content > * {
    max-width: 800px;
    margin-inline: auto;
}

/*
 * 历史行三种状态高度一致，切换时下面的内容不动。
 * 更早的内容插在它后面、它自己不动，所以不能当阅读锚点，否则插入后下面的内容会被推走。
 */
.acv-history {
    overflow-anchor: none;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    margin-bottom: 16px;
    color: var(--text-muted);
    font-size: 11px;
}

.acv-history__more {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    border-radius: var(--radius-control);
    color: inherit;
    transition: color var(--motion-fast) var(--ease-standard);
}

.acv-history__more::before,
.acv-history__more::after {
    content: "";
    flex: 1;
    border-top: var(--border-w, 1px) solid var(--divider);
}

.acv-history__more:hover {
    color: var(--text-secondary);
}

.acv-history__more:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
}

/* 读得快时什么都不出现：加载指示延后约 200ms 才淡入。 */
.acv-history__loading {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    animation: acv-appear var(--motion-fast) var(--ease-standard) 200ms both;
}

.acv-history__error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 4px 8px;
    margin: 0;
    color: var(--status-danger);
    font-size: 12px;
}

.acv-history__icon {
    width: 14px;
    height: 14px;
}

@keyframes acv-appear {
    from {
        opacity: 0;
    }
}

/* 浮在消息流底部正中；左右为 0 加自动外边距居中，不占用按钮自己的按压缩放 transform。 */
.acv-jump {
    position: absolute;
    right: 0;
    bottom: 12px;
    left: 0;
    width: fit-content;
    margin-inline: auto;
    box-shadow: var(--elevation-raised);
}

.acv-fade-enter-active,
.acv-fade-leave-active {
    transition: opacity var(--motion-fast) var(--ease-standard);
}

.acv-fade-enter-from,
.acv-fade-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .acv-history__loading {
        animation-duration: 0s;
    }

    .acv-fade-enter-active,
    .acv-fade-leave-active {
        transition: none;
    }
}
</style>
