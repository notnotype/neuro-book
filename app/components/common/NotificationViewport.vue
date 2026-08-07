<script setup lang="ts">
import {useNotification, type NotificationItem, type NotificationPosition} from "nbook/app/composables/useNotification";

const props = withDefaults(defineProps<{desktop?: boolean}>(), {
    desktop: false,
});

type NotificationGroup = {
    key: string;
    position: NotificationPosition;
    offsetX: number;
    offsetY: number;
    items: NotificationItem[];
};

const {notifications, remove} = useNotification();

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

function cardToneClass(item: NotificationItem): string {
    if (item.tone === "success") {
        return "border-emerald-500/25 bg-emerald-500/10 text-emerald-100";
    }
    if (item.tone === "warning") {
        return "border-amber-500/25 bg-amber-500/12 text-amber-50";
    }
    if (item.tone === "error") {
        return "border-rose-500/25 bg-rose-500/12 text-rose-50";
    }

    return "border-sky-500/25 bg-sky-500/12 text-sky-50";
}

function badgeToneClass(item: NotificationItem): string {
    if (item.tone === "success") {
        return "bg-emerald-500";
    }
    if (item.tone === "warning") {
        return "bg-amber-500";
    }
    if (item.tone === "error") {
        return "bg-rose-500";
    }

    return "bg-sky-500";
}
</script>

<template>
    <ClientOnly>
        <div class="pointer-events-none fixed inset-0 z-[9800]" :class="{'notification-viewport--desktop': props.desktop}">
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
                        class="pointer-events-auto overflow-hidden rounded-2xl border shadow-[0_14px_40px_rgba(0,0,0,0.22)] backdrop-blur-sm"
                        :class="cardToneClass(item)"
                    >
                        <div class="flex items-start gap-3 px-4 py-3">
                            <span class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" :class="badgeToneClass(item)"></span>
                            <div class="min-w-0 flex-1">
                                <div v-if="item.title" class="text-sm font-semibold leading-5 text-white">
                                    {{ item.title }}
                                </div>
                                <div
                                    v-if="item.html"
                                    class="mt-0.5 text-xs leading-5 text-white/90 [&_a]:underline [&_code]:rounded [&_code]:bg-black/20 [&_code]:px-1 [&_strong]:font-semibold"
                                    v-html="item.html"
                                ></div>
                                <div v-else-if="item.message" class="mt-0.5 text-xs leading-5 text-white/90">
                                    {{ item.message }}
                                </div>
                            </div>
                            <button
                                type="button"
                                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                                @click="remove(item.id)"
                            >
                                <span class="i-lucide-x h-4 w-4"></span>
                            </button>
                        </div>
                    </div>
                </TransitionGroup>
            </div>
        </div>
    </ClientOnly>
</template>

<style scoped>
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
.notification-viewport--desktop {
    top: 36px;
}
</style>
