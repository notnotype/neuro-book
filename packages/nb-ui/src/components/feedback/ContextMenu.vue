<script setup lang="ts">
import {nextTick, onMounted, onUnmounted, ref, watch} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import {clampMenuPosition} from "./menu-cascade";
import type {ContextMenuItem} from "./context-menu.types";
import ContextMenuPanel from "./ContextMenuPanel.vue";

// 右键菜单：固定定位浮层。子菜单层级不限，每一级都由 ContextMenuPanel 按共享几何定位。
// 消费方持有 visible/x/y 状态（通常来自 @contextmenu.prevent 事件坐标），本组件只负责渲染与关闭时机。
const props = withDefaults(defineProps<{
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
    teleportTarget?: string;
}>(), {
    teleportTarget: "body",
});

const emit = defineEmits<{
    (e: "close"): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const adjustedX = ref(props.x);
const adjustedY = ref(props.y);
const isMounted = ref(false);

function close(): void {
    emit("close");
}

/** 点击/右键菜单外部时关闭 */
function closeOnOutside(event: MouseEvent): void {
    if (!props.visible || menuRef.value?.contains(event.target as Node)) {
        return;
    }
    emit("close");
}

function handleKeydown(event: KeyboardEvent): void {
    if (props.visible && event.key === "Escape") {
        emit("close");
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

watch(() => [props.visible, props.x, props.y] as const, async ([visible, x, y]) => {
    if (!visible) {
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
});

function setMenuRef(element: unknown): void {
    const node = element && typeof element === "object" && "$el" in element ? element.$el : element;
    menuRef.value = node && typeof node === "object" && "getBoundingClientRect" in node ? node as HTMLElement : null;
}
</script>

<template>
    <Teleport v-if="isMounted" :to="props.teleportTarget">
        <Transition name="nb-context-menu">
            <ContextMenuPanel
                v-if="visible"
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
