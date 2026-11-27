<script setup lang="ts">
import {computed, nextTick, ref, shallowRef, useId, watch} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import {hasNotificationDetail, useNotification, type NotificationItem, type NotificationQueue} from "../../composables/useNotification";
import type {Text} from "../../text";
import {useText, useUiText} from "../../text-port";
import DetailDialog from "./DetailDialog.vue";
import Notification from "./Notification.vue";
import type {NotificationTone} from "../../composables/useNotification";

export type NotificationPosition = "bottom-center" | "bottom-right" | "top-right";

const props = withDefaults(defineProps<{
    position?: NotificationPosition;
    closeLabel?: string;
    /** 显示哪份队列；不给就是模块级的缺省队列。挂载时取定，之后换 prop 不生效。 */
    queue?: NotificationQueue;
    /** 最多显示几条（最新的），其余折进列顶的小条。 */
    maxVisible?: number;
}>(), {
    position: "bottom-center",
    queue: undefined,
    maxVisible: 4,
});

// 队列在挂载时取定：一个视口只服务一份队列，换队列应换一个视口实例。
const queue = props.queue ?? useNotification();
const {notifications, remove, pause, resume} = queue;
// 队列里的文字是文字值，在渲染时翻：切换界面语言后，已显示的通知跟着换文字。
const text = useText();
const uiText = useUiText();
const root = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const listId = useId();

/** 上限的边界归一化：不是有限数取缺省 4，否则向下取整、至少 1。 */
const cap = computed(() => (Number.isFinite(props.maxVisible) ? Math.max(1, Math.floor(props.maxVisible)) : 4));
const expanded = ref(false);
const foldedCount = computed(() => Math.max(0, notifications.value.length - cap.value));
// 所有位置都是最早的在上，所以折起来的是列表开头那几条，小条也就在列顶。
const shown = computed(() => (expanded.value ? notifications.value : notifications.value.slice(foldedCount.value)));
const foldLabel = computed(() => (expanded.value ? uiText("notification.collapse") : uiText("notification.folded", {count: foldedCount.value})));

watch(foldedCount, (count) => {
    if (count === 0) expanded.value = false;
});

/** 展开时、展开状态下来了新通知时，滚到最新一条（列表底部）。 */
function scrollToNewest(): void {
    void nextTick(() => {
        const element = list.value;
        if (element !== null) element.scrollTop = element.scrollHeight;
    });
}
// 只在条数变多时滚：关掉一条较早的、限时的到时消失，都不该把正在看的位置拽到底。
watch(() => notifications.value.length, (count, previous) => {
    if (expanded.value && count > previous) scrollToNewest();
});

function toggleFold(): void {
    expanded.value = !expanded.value;
    if (expanded.value) scrollToNewest();
}

/**
 * 详情对话框：打开时把标题的文字值、原文与截断标志存成快照，通知随后被移除或更新都不影响对话框；
 * 标题渲染时再翻，所以打开后切换语言跟着换。opener 是点开它的那颗“详情”按钮，关闭后把焦点还给它。
 */
type DetailSnapshot = {readonly title: Text | undefined; readonly detail: string; readonly truncated: boolean};
const detailOpen = ref(false);
const snapshot = shallowRef<DetailSnapshot | null>(null);
let opener: HTMLButtonElement | null = null;

const detailTitle = computed(() => {
    const title = snapshot.value?.title;
    const resolved = title === undefined ? "" : text.t(title);
    return resolved === "" ? uiText("notification.detail") : uiText("notification.detailTitle", {title: resolved});
});

function openDetail(item: NotificationItem, trigger: HTMLButtonElement): void {
    if (item.detail === undefined || !hasNotificationDetail(item.detail)) return;
    snapshot.value = {title: item.title, detail: item.detail, truncated: item.detailTruncated === true};
    opener = trigger;
    detailOpen.value = true;
}

/**
 * 对话框关闭完成后（Dialog 已按自己的规则交还过焦点）再放焦点：按钮还在就给它（Safari 点按钮不聚焦，
 * Dialog 记到的“打开前的元素”可能是 body）；按钮已不在（通知被移除或折进了小条）就给视口根，不让焦点掉到 body。
 */
function onDetailClosed(): void {
    const target = opener?.isConnected === true ? opener : root.value;
    opener = null;
    target?.focus({preventScroll: true});
}

// 靠右的贴 right-0：容器是 w-full 加 px-4，再写 right-4 会让整列在窄屏上从左边溢出 16px（卡片离右边仍是 px-4 的 16px）。
const positionClass = computed(() => {
    if (props.position === "top-right") {
        return "right-0 top-4 items-end";
    }
    if (props.position === "bottom-right") {
        return "bottom-4 right-0 items-end";
    }
    return "bottom-4 left-1/2 -translate-x-1/2 items-center";
});

function toneClass(item: NotificationItem): NotificationTone {
    return item.tone;
}

function runAction(item: NotificationItem): void {
    // 动作抛错也移除这条通知（错误照常交给 Vue 的错误处理）：留着只会让人反复点一个坏掉的动作。
    try {
        item.action?.run();
    } finally {
        remove(item.id);
    }
}

function dismiss(item: NotificationItem): void {
    // 关闭的回告抛错也照常移除，同 runAction。
    try {
        item.onDismiss?.();
    } finally {
        remove(item.id);
    }
}
</script>

<template>
    <!-- 详情对话框打开期间：整块 inert（不能点、读屏读不到），层级降到模态之下，让遮罩盖住它。只 inert 不降层级的话，
         通知（9050）仍画在对话框（9000）上面，与“模态”矛盾（NotificationStack.md 的“交互”）。
         不另加 aria-hidden：inert 已经把它从无障碍树里拿掉，焦点还在里面时再加 aria-hidden 会被 Chrome 拦下并报错。 -->
    <div
        ref="root"
        class="pointer-events-none fixed flex w-full max-w-md flex-col gap-2 px-4 outline-none"
        :style="{zIndex: detailOpen ? NB_Z_INDEX.dialog - 1 : NB_Z_INDEX.notification}"
        :class="positionClass"
        role="region"
        :aria-label="uiText('notification.region')"
        tabindex="-1"
        :inert="detailOpen"
        data-notification-stack
    >
        <!-- 展开时这一层自己纵向滚动（外层是 pointer-events-none，所以它要接指针），四周留 4px 给阴影与焦点环。
             折叠小条也在这一层里、展开时贴顶：与卡片同在一个内容盒里，滚动条出现时两者一样宽。 -->
        <div
            ref="list"
            class="flex w-full flex-col gap-2"
            :class="expanded ? 'nb-notification-list--expanded nb-ui-scrollbar-thin nb-ui-scrollbar-stable pointer-events-auto' : ''"
        >
            <button
                v-if="foldedCount > 0"
                type="button"
                class="nb-notification-fold nb-ui-focus-ring pointer-events-auto shadow-lg"
                :class="expanded ? 'sticky top-0 z-[1]' : ''"
                :aria-expanded="expanded"
                :aria-controls="listId"
                data-notification-fold
                @click="toggleFold"
            >
                <span :class="expanded ? 'i-lucide-chevrons-down-up' : 'i-lucide-chevrons-up-down'" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                {{ foldLabel }}
            </button>
            <div :id="listId" class="flex w-full flex-col gap-2" :class="props.position === 'bottom-center' ? 'items-center' : 'items-end'">
                <TransitionGroup name="nb-notice">
                    <Notification
                        v-for="item in shown"
                        :key="item.id"
                        class="pointer-events-auto"
                        :tone="toneClass(item)"
                        :title="item.title === undefined ? undefined : text.t(item.title)"
                        :message="text.t(item.message)"
                        :dismissible="true"
                        :action-label="item.action === undefined ? undefined : text.t(item.action.label)"
                        :close-label="props.closeLabel"
                        :progress="item.progress"
                        :has-detail="hasNotificationDetail(item.detail)"
                        @mouseenter="pause(item.id)"
                        @mouseleave="resume(item.id)"
                        @action="runAction(item)"
                        @detail="openDetail(item, $event)"
                        @dismiss="dismiss(item)"
                    />
                </TransitionGroup>
            </div>
        </div>
        <DetailDialog
            :open="detailOpen"
            :title="detailTitle"
            :detail="snapshot?.detail ?? ''"
            :truncated="snapshot?.truncated ?? false"
            @update:open="detailOpen = $event"
            @closed="onDetailClosed"
        />
    </div>
</template>

<style scoped>
/* 折叠小条：一行次级文字，与通知卡同宽、同样的面与阴影（shadow-lg 与 Notification 一致）。 */
.nb-notification-fold {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: stretch;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    border: var(--border-w, 1px) solid color-mix(in srgb, var(--text-main) 12%, transparent);
    background: var(--bg-panel);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
}

.nb-notification-fold:hover {
    color: var(--text-main);
}

/* 展开：自己纵向滚动。四周留 4px 给阴影与焦点环，宽度同步加 8px，卡片与收起时一样宽（只差滚动条的槽）。 */
.nb-notification-list--expanded {
    width: calc(100% + 8px);
    max-height: calc(100svh - 6rem);
    overflow-y: auto;
    margin: -4px;
    padding: 4px;
}

/* 通知不贴触发器，从边缘滑入（translateY）合法，见 design-language.md 动效节。 */
.nb-notice-enter-active {
    transition:
        opacity var(--motion-enter) var(--ease-layout),
        transform var(--motion-enter) var(--ease-layout);
}

.nb-notice-leave-active {
    transition:
        opacity var(--motion-fast) var(--ease-dialog-leave),
        transform var(--motion-fast) var(--ease-dialog-leave);
}

.nb-notice-enter-from,
.nb-notice-leave-to {
    opacity: 0;
    transform: translateY(8px);
}

/* 减弱动效：不滑入滑出，只淡入淡出（nb-ui 设计语言“六、无障碍”）。 */
@media (prefers-reduced-motion: reduce) {
    .nb-notice-enter-from,
    .nb-notice-leave-to {
        transform: none;
    }
}
</style>
