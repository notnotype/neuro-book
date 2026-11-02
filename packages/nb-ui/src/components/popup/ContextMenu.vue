<script setup lang="ts">
import {nextTick, onMounted, onUnmounted, ref, watch} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import {elementOf} from "../../utils/element-of";
import {clampMenuPosition} from "../../utils/popup-geometry";
import type {ContextMenuCloseReason, ContextMenuItem} from "./context-menu.types";
import ContextMenuPanel from "./ContextMenuPanel.vue";

// 右键菜单：固定定位浮层。子菜单层级不限，每一级都由 ContextMenuPanel 按共享几何定位。
// 消费方持有 open/x/y 状态（通常来自 @contextmenu.prevent 事件坐标），本组件只负责渲染与关闭时机：
// 先发 `request-close(reason)`（宿主据此决定焦点去向），再发 `update:open(false)`；菜单卸载后发 `closed`。
const props = withDefaults(defineProps<{
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
    teleportTarget?: string;
}>(), {
    teleportTarget: "body",
});

const emit = defineEmits<{
    (e: "request-close", reason: ContextMenuCloseReason): void;
    (e: "update:open", value: boolean): void;
    (e: "closed"): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const adjustedX = ref(props.x);
const adjustedY = ref(props.y);
const isMounted = ref(false);

function requestClose(reason: ContextMenuCloseReason): void {
    emit("request-close", reason);
    emit("update:open", false);
}

function close(): void {
    requestClose("select");
}

/** 点击/右键菜单外部时关闭 */
function closeOnOutside(event: MouseEvent): void {
    if (!props.open || menuRef.value?.contains(event.target as Node)) {
        return;
    }
    requestClose("outside");
}

function handleKeydown(event: KeyboardEvent): void {
    if (!props.open) return;
    if (event.key === "Escape") requestClose("escape");
    // Tab 不在菜单项之间移动（那是方向键的事），而是离开菜单：关闭，焦点去向交给宿主，不让它落进页面末尾的浮层之后。
    else if (event.key === "Tab" && menuRef.value?.contains(document.activeElement)) {
        event.preventDefault();
        requestClose("tab");
    }
}

onMounted(() => {
    isMounted.value = true;
    document.addEventListener("click", closeOnOutside, true);
    document.addEventListener("contextmenu", closeOnOutside, true);
    document.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
    document.removeEventListener("click", closeOnOutside, true);
    document.removeEventListener("contextmenu", closeOnOutside, true);
    document.removeEventListener("keydown", handleKeydown);
});

watch(() => [props.open, props.x, props.y] as const, async ([open, x, y]) => {
    if (!open) {
        return;
    }
    adjustedX.value = x;
    adjustedY.value = y;
    await nextTick();
    if (!menuRef.value) {
        return;
    }
    const rect = menuRef.value.getBoundingClientRect();
    const position = clampMenuPosition(x, y, {width: rect.width, height: rect.height}, {width: window.innerWidth, height: window.innerHeight});
    adjustedX.value = position.x;
    adjustedY.value = position.y;
    // 打开即把焦点放到第一个可用项，方向键从这里开始；焦点在关闭后回到哪里由宿主决定。
    if (!menuRef.value.contains(document.activeElement)) menuRef.value.querySelector<HTMLElement>("[role^='menuitem']:not([disabled])")?.focus({preventScroll: true});
});

function setMenuRef(element: unknown): void {
    menuRef.value = elementOf(element);
}
</script>

<template>
    <Teleport v-if="isMounted" :to="props.teleportTarget">
        <!-- `closed` 等离场过渡播完、菜单卸载之后才发。 -->
        <Transition name="nb-context-menu" @after-leave="emit('closed')">
            <ContextMenuPanel
                v-if="open"
                :ref="setMenuRef"
                :items="items"
                :depth="0"
                :style="{top: `${adjustedY}px`, left: `${adjustedX}px`, zIndex: NB_Z_INDEX.contextMenu}"
                @select="close"
            />
        </Transition>
    </Teleport>
</template>

<style scoped>
.nb-context-menu-enter-active {
    transition:
        opacity var(--motion-fast) var(--ease-standard),
        transform var(--motion-fast) var(--ease-standard);
    transform-origin: var(--reka-context-menu-content-transform-origin, top left);
}

.nb-context-menu-leave-active {
    transition:
        opacity var(--motion-fast) var(--ease-standard),
        transform var(--motion-fast) var(--ease-standard);
    transform-origin: var(--reka-context-menu-content-transform-origin, top left);
}

.nb-context-menu-enter-from,
.nb-context-menu-leave-to {
    opacity: 0;
    transform: scale(0.96);
}
</style>
