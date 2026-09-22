<script setup lang="ts">
import {computed, nextTick, ref, toRef, watch} from "vue";
import {useEventListener, useResizeObserver} from "@vueuse/core";
import type {AgentTriggerMenuSection} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {useFloatingPanelLayout, type FloatingPanelDirection} from "nbook/app/composables/useFloatingPanelLayout";

type FloatingAnchorRect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

const props = withDefaults(defineProps<{
    title: string;
    prefix: string;
    sections: AgentTriggerMenuSection[];
    activeIndex: number;
    anchorElement?: HTMLElement | null;
    anchorRect?: FloatingAnchorRect | null;
    teleportTarget?: HTMLElement | string | boolean | null;
    direction?: FloatingPanelDirection;
    density?: "normal" | "compact";
    matchAnchorWidth?: boolean;
}>(), {
    anchorElement: null,
    anchorRect: null,
    teleportTarget: null,
    direction: "auto",
    density: "normal",
    matchAnchorWidth: false,
});

const emit = defineEmits<{
    (e: "select", itemId: string): void;
    (e: "hover", index: number): void;
}>();

const flatItems = computed(() => props.sections.flatMap((section) => section.items));
const panelRef = ref<HTMLDivElement | null>(null);
const {
    resolvedDirection,
    panelStyle,
} = useFloatingPanelLayout({
    open: computed(() => true),
    anchorRef: toRef(props, "anchorElement"),
    panelRef,
    direction: toRef(props, "direction"),
    maxHeight: 288,
    matchAnchorWidth: props.matchAnchorWidth,
});

const resolveItemIndex = (itemId: string): number => flatItems.value.findIndex((item) => item.id === itemId);
const viewportVersion = ref(0);

/**
 * 光标触发的菜单使用 Tiptap clientRect 做 fixed 定位，避免被编辑器容器撑到屏幕外。
 */
const virtualPanelLayout = computed(() => {
    void viewportVersion.value;
    const rect = props.anchorRect;
    if (!import.meta.client || !rect) {
        return {
            direction: resolvedDirection.value,
            style: panelStyle.value,
        };
    }

    const viewportGap = 12;
    const triggerGap = 8;
    const maxPanelHeight = props.density === "compact" ? 280 : 288;
    const preferredWidth = props.density === "compact" ? 264 : 360;
    const minWidth = props.density === "compact" ? 220 : 260;
    const anchorElRect = props.anchorElement ? props.anchorElement.getBoundingClientRect() : null;
    const anchorElWidth = props.matchAnchorWidth && anchorElRect ? anchorElRect.width : 0;
    const basePanelWidth = anchorElWidth || Math.min(preferredWidth, Math.max(window.innerWidth - viewportGap * 2, minWidth));
    const panelWidth = Math.max(basePanelWidth, rect.width);
    const wantedHeight = Math.min(panelRef.value?.scrollHeight || maxPanelHeight, maxPanelHeight);

    const targetLeft = (props.matchAnchorWidth && anchorElRect) ? anchorElRect.left : rect.left;
    const topAnchor = (props.matchAnchorWidth && anchorElRect) ? anchorElRect.top : rect.top;
    const bottomAnchor = (props.matchAnchorWidth && anchorElRect) ? anchorElRect.bottom : rect.bottom;

    const bottomSpace = Math.max(window.innerHeight - bottomAnchor - viewportGap - triggerGap, 0);
    const topSpace = Math.max(topAnchor - viewportGap - triggerGap, 0);
    const direction = props.direction === "down" || props.direction === "up"
        ? props.direction
        : bottomSpace >= wantedHeight || bottomSpace >= topSpace ? "down" : "up";
    const availableSpace = direction === "down" ? bottomSpace : topSpace;
    const maxHeight = Math.max(Math.min(availableSpace, maxPanelHeight), 96);
    const left = Math.min(Math.max(targetLeft, viewportGap), Math.max(window.innerWidth - panelWidth - viewportGap, viewportGap));
    const top = direction === "down"
        ? Math.min(bottomAnchor + triggerGap, window.innerHeight - maxHeight - viewportGap)
        : Math.max(topAnchor - Math.min(wantedHeight, maxHeight) - triggerGap, viewportGap);

    return {
        direction,
        style: {
            left: `${String(Math.round(left))}px`,
            top: `${String(Math.round(top))}px`,
            width: `${String(Math.round(panelWidth))}px`,
            maxHeight: `${String(Math.round(maxHeight))}px`,
        },
    };
});

const effectiveDirection = computed(() => props.anchorRect ? virtualPanelLayout.value.direction : resolvedDirection.value);
const effectivePanelStyle = computed(() => props.anchorRect ? virtualPanelLayout.value.style : panelStyle.value);

/* Teleport 目标只在字符串或真实元素时直传；true / false / null 一律落到 body（`:disabled` 另行处理）。 */
const teleportTargetResolved = computed(() => {
    const target = props.teleportTarget;
    return typeof target === "string" || target instanceof HTMLElement ? target : "body";
});

watch(() => props.anchorRect, async () => {
    await nextTick();
    viewportVersion.value += 1;
}, {deep: true});

useResizeObserver(panelRef, () => {
    viewportVersion.value += 1;
});

if (import.meta.client) {
    useEventListener(window, "resize", () => {
        viewportVersion.value += 1;
    });
    useEventListener(window, "scroll", () => {
        viewportVersion.value += 1;
    }, {capture: true, passive: true});
}
</script>

<template>
    <Teleport
        :disabled="!props.anchorRect || props.teleportTarget === false"
        :to="teleportTargetResolved"
    >
    <div
        ref="panelRef"
        class="z-[8500] flex flex-col overflow-hidden border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-main)] shadow-2xl"
        :class="[props.density === 'compact' ? 'rounded-xl' : 'rounded-2xl', props.anchorRect ? 'fixed' : [props.anchorElement ? 'absolute left-0' : 'absolute left-0 right-0', effectiveDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2']]"
        :style="effectivePanelStyle"
    >
        <div class="flex items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]" :class="props.density === 'compact' ? 'px-2.5 py-1.5' : 'px-3 py-2.5'">
            <span class="font-mono font-bold text-[var(--accent-text)]" :class="props.density === 'compact' ? 'text-[11px]' : 'text-xs'">{{ props.prefix }}</span>
            <span class="text-[var(--text-secondary)]" :class="props.density === 'compact' ? 'text-[11px]' : 'text-xs'">{{ props.title }}</span>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto custom-scrollbar" :class="props.density === 'compact' ? 'p-1.5' : 'p-2'">
            <template v-for="section in props.sections" :key="section.id">
                <div v-if="section.title" class="font-semibold text-[var(--text-muted)]" :class="props.density === 'compact' ? 'px-2 pb-1 pt-2 text-[10px]' : 'px-2 py-1 text-[10px] uppercase tracking-[0.18em]'">
                    {{ section.title }}
                </div>

                <button
                    v-for="item in section.items"
                    :key="item.id"
                    type="button"
                    class="mb-0.5 flex w-full items-start text-left transition-colors last:mb-0"
                    :class="[props.density === 'compact' ? 'gap-2 rounded-lg px-2 py-1.5' : 'gap-3 rounded-xl px-3 py-2', item.disabled ? 'cursor-not-allowed text-[var(--text-muted)] opacity-55' : resolveItemIndex(item.id) === props.activeIndex ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]']"
                    :disabled="item.disabled"
                    @mouseenter="!item.disabled && emit('hover', resolveItemIndex(item.id))"
                    @mousedown.prevent="!item.disabled && emit('select', item.id)"
                >
                    <span class="mt-0.5 shrink-0 text-[var(--text-muted)]" :class="[props.density === 'compact' ? 'h-3.5 w-3.5' : 'h-4 w-4', item.iconClass]"></span>
                    <span class="min-w-0 flex-1">
                        <span class="flex items-center gap-2">
                            <span class="truncate font-medium" :class="props.density === 'compact' ? 'text-xs' : 'text-sm'">{{ item.label }}</span>
                            <span v-if="item.hint" class="shrink-0 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                                {{ item.hint }}
                            </span>
                        </span>
                        <span class="mt-0.5 block text-[var(--text-muted)]" :class="props.density === 'compact' ? 'text-[10px] leading-4' : 'text-[11px] leading-5'">
                            {{ item.description }}
                        </span>
                    </span>
                </button>
            </template>
        </div>
    </div>
    </Teleport>
</template>
