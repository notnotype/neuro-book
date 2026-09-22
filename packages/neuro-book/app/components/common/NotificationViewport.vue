<script setup lang="ts">
import {computed} from "vue";
import {useNotification, type NotificationItem, type NotificationPosition, type NotificationTone} from "nbook/app/composables/useNotification";
import {SHELL_TITLEBAR_HEIGHT} from "nbook/app/utils/workbench/layout";

const props = withDefaults(defineProps<{
    /** 标题栏是否真的在场（切片 5 起浏览器也有）：在场就让出它那 36px，不按 bridge 判。 */
    titlebar?: boolean;
}>(), {
    titlebar: false,
});

/**
 * 让位量取标题栏高度的同一来源（`SHELL_TITLEBAR_HEIGHT`），并且只在标题栏真在场时让。
 * 写死在 CSS 类里的 36 在浏览器档会失效（toast 会从 y=16 起画并压住标题栏右侧控件）。
 */
const viewportOffset = computed<Record<string, string> | undefined>(() =>
    props.titlebar ? {top: `${String(SHELL_TITLEBAR_HEIGHT)}px`} : undefined);

type NotificationGroup = {
    key: string;
    position: NotificationPosition;
    offsetX: number;
    offsetY: number;
    items: NotificationItem[];
};

const {notifications, remove} = useNotification();

/**
 * 通知视口挂在页面根节点之外（`app.vue`），但配色变量写在 `<html>` 上，
 * 所以卡片直接消费 nb-ui 的配色变量即可跟随当前主题，不需要 JS 侧混色。
 */
function toneClass(tone: NotificationTone): string {
    return `notification-tone--${tone}`;
}

const groupedNotifications = computed<NotificationGroup[]>(() => {
    const groupMap = new Map<string, NotificationGroup>();

    for (const item of notifications.value) {
        const key = `${item.position}:${String(item.offsetX)}:${String(item.offsetY)}`;
        const existing = groupMap.get(key);
        if (existing) {
            existing.items.push(item);
            continue;
        }

        groupMap.set(key, {
            key,
            position: item.position,
            offsetX: item.offsetX,
            offsetY: item.offsetY,
            items: [item],
        });
    }

    return [...groupMap.values()];
});

function positionClass(position: NotificationPosition): string {
    if (position === "top-left") {
        return "top-0 left-0 items-start";
    }
    if (position === "top-center") {
        return "top-0 left-1/2 -translate-x-1/2 items-center";
    }
    if (position === "bottom-left") {
        return "bottom-0 left-0 items-start";
    }
    if (position === "bottom-center") {
        return "bottom-0 left-1/2 -translate-x-1/2 items-center";
    }
    if (position === "bottom-right") {
        return "bottom-0 right-0 items-end";
    }

    return "top-0 right-0 items-end";
}

function groupStyle(group: NotificationGroup): Record<string, string> {
    const style: Record<string, string> = {};

    if (group.position.startsWith("top")) {
        style.marginTop = `${String(group.offsetY)}px`;
    } else {
        style.marginBottom = `${String(group.offsetY)}px`;
    }

    if (group.position.endsWith("left")) {
        style.marginLeft = `${String(group.offsetX)}px`;
    } else if (group.position.endsWith("right")) {
        style.marginRight = `${String(group.offsetX)}px`;
    }

    return style;
}
</script>

<template>
    <ClientOnly>
        <div class="pointer-events-none fixed inset-0 z-[9800]" :style="viewportOffset">
            <div
                v-for="group in groupedNotifications"
                :key="group.key"
                class="pointer-events-none absolute flex w-full max-w-[420px] flex-col gap-2 px-4"
                :class="positionClass(group.position)"
                :style="groupStyle(group)"
            >
                <TransitionGroup name="nb-notification">
                    <div
                        v-for="item in group.items"
                        :key="item.id"
                        class="notification-card pointer-events-auto overflow-hidden rounded-2xl border backdrop-blur-sm"
                        :class="toneClass(item.tone)"
                    >
                        <div class="flex items-center gap-3 px-4 py-3">
                            <span class="notification-tone-badge h-2.5 w-2.5 shrink-0 rounded-full"></span>
                            <div class="min-w-0 flex-1">
                                <div v-if="item.title" class="text-sm font-semibold leading-5">
                                    {{ item.title }}
                                </div>
                                <div
                                    v-if="item.html"
                                    :class="item.title ? 'mt-0.5' : ''"
                                    class="text-xs leading-5 [&_a]:underline [&_code]:rounded [&_code]:bg-[var(--bg-hover)] [&_code]:px-1 [&_strong]:font-semibold"
                                    v-html="item.html"
                                ></div>
                                <div
                                    v-else-if="item.message"
                                    :class="item.title ? 'mt-0.5' : ''"
                                    class="text-xs leading-5"
                                >
                                    {{ item.message }}
                                </div>
                            </div>
                            <button
                                type="button"
                                aria-label="关闭通知"
                                title="关闭通知"
                                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                @click="remove(item.id)"
                            >
                                <span class="i-lucide-x h-3.5 w-3.5"></span>
                            </button>
                        </div>
                    </div>
                </TransitionGroup>
            </div>
        </div>
    </ClientOnly>
</template>

<style scoped>
/*
 * 卡片配色 = nb-ui `Notification.vue` 的同一套配方：状态主色 10% 混面板底、描边 28% 状态主色。
 * 不写具体颜色：`--notification-tone-*` 由 tone class 指到配色的状态三件套，切主题自动跟随。
 */
.notification-card {
    background: color-mix(in srgb, var(--notification-tone) 10%, var(--bg-panel));
    border-color: color-mix(in srgb, var(--notification-tone) 28%, transparent);
    color: var(--text-main);
    box-shadow: var(--elevation-popover, 0 14px 40px rgba(0, 0, 0, 0.22));
}

.notification-tone-badge {
    background: var(--notification-tone);
}

.notification-tone--info {
    --notification-tone: var(--status-info);
}

.notification-tone--success {
    --notification-tone: var(--status-success);
}

.notification-tone--warning {
    --notification-tone: var(--status-warning);
}

.notification-tone--error {
    --notification-tone: var(--status-danger);
}

.nb-notification-enter-active,
.nb-notification-leave-active {
    transition: all 0.22s ease;
}

.nb-notification-enter-from,
.nb-notification-leave-to {
    opacity: 0;
    transform: translateY(-8px) scale(0.98);
}

.nb-notification-move {
    transition: transform 0.22s ease;
}
</style>

<style>
/* 让位量由脚本按「标题栏真在场 + SHELL_TITLEBAR_HEIGHT」写在容器行内样式上，这里不再留一份数字。 */
</style>
