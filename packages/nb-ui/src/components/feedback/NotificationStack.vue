<script setup lang="ts">
import {computed} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import {useNotification, type NotificationItem, type NotificationQueue} from "../../composables/useNotification";
import {useText} from "../../text-port";
import Notification from "./Notification.vue";
import type {NotificationTone} from "../../composables/useNotification";

export type NotificationPosition = "bottom-center" | "bottom-right" | "top-right";

const props = withDefaults(defineProps<{
    position?: NotificationPosition;
    closeLabel?: string;
    /** 显示哪份队列；不给就是模块级的缺省队列。挂载时取定，之后换 prop 不生效。 */
    queue?: NotificationQueue;
}>(), {
    position: "bottom-center",
    queue: undefined,
});

// 队列在挂载时取定：一个视口只服务一份队列，换队列应换一个视口实例。
const queue = props.queue ?? useNotification();
const {notifications, remove, pause, resume} = queue;
// 队列里的文字是文字值，在渲染时翻：切换界面语言后，已显示的通知跟着换文字。
const text = useText();

const positionClass = computed(() => {
    if (props.position === "top-right") {
        return "right-4 top-4 items-end";
    }
    if (props.position === "bottom-right") {
        return "bottom-4 right-4 items-end";
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
</script>

<template>
    <div class="pointer-events-none fixed flex w-full max-w-md flex-col gap-2 px-4" :style="{zIndex: NB_Z_INDEX.notification}" :class="positionClass" data-notification-stack>
        <TransitionGroup name="nb-notice">
            <Notification
                v-for="item in notifications"
                :key="item.id"
                class="pointer-events-auto"
                :tone="toneClass(item)"
                :title="item.title === undefined ? undefined : text.t(item.title)"
                :message="text.t(item.message)"
                :dismissible="true"
                :action-label="item.action === undefined ? undefined : text.t(item.action.label)"
                :close-label="props.closeLabel"
                :progress="item.progress"
                @mouseenter="pause(item.id)"
                @mouseleave="resume(item.id)"
                @action="runAction(item)"
                @dismiss="remove(item.id)"
            />
        </TransitionGroup>
    </div>
</template>

<style scoped>
/* 通知不贴触发器，从边缘滑入（translateY）合法，见 design-language.md 动效节。 */
.nb-notice-enter-active {
    transition:
        opacity var(--motion-enter) var(--ease-standard),
        transform var(--motion-enter) var(--ease-standard);
}

.nb-notice-leave-active {
    transition:
        opacity var(--motion-fast) var(--ease-standard),
        transform var(--motion-fast) var(--ease-standard);
}

.nb-notice-enter-from,
.nb-notice-leave-to {
    opacity: 0;
    transform: translateY(8px);
}
</style>
