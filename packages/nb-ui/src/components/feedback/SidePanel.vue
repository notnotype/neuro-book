<script setup lang="ts">
/**
 * 贴窗口右边、全高的非模态面板（同名 .md）：不压暗页面，点外面不关，没有拖动手势。建在 Reka 的非模态 Dialog 上，不用
 * `Drawer`：Reka 的抽屉在内容上任何按下都开始滑动关闭、关不掉，面板里放对话时拖选文字、在输入框里拖动都会把它拖走。
 */
import {DialogContent, DialogPortal, DialogRoot, DialogTitle, DialogTrigger} from "reka-ui";
import {computed, provide, ref} from "vue";

import {useTeleportTarget} from "../../composables/useTeleportTarget";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";
import {useCloseHandoff} from "./close-handoff";

defineOptions({name: "SidePanel"});

const props = withDefaults(defineProps<{
    open: boolean;
    /** 读屏名（对话框角色的名字）；不画可见标题。 */
    label: string;
    /** 宽度（CSS 长度），不超过传送目标宽度的 90%。 */
    width?: string;
}>(), {
    width: "420px",
});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    /** 关闭完成：内容已卸载、焦点栈已释放。 */
    (e: "closed"): void;
}>();

const teleportTo = useTeleportTarget(() => undefined);
// 面板不进模态序列，层级低于页面里的下拉；面板里的下拉、菜单取页面浮层档，压在面板上，不靠传送的先后。
provide(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);

const panel = ref<HTMLElement | null>(null);
const panelStyle = computed(() => ({zIndex: NB_Z_INDEX.sidePanel, width: `min(${props.width}, 90cqw)`}));

const handoff = useCloseHandoff(() => props.open);
function onCloseAutoFocus(): void {
    handoff.schedule(() => emit("closed"));
}

/** 点外面、焦点移出都不关：边看页面边用面板。点触发器不算外面（Reka 判定），它切换开关。 */
function keepOpen(event: Event): void {
    event.preventDefault();
}

/**
 * Esc：只有焦点在面板里或触发器上时才关，焦点在页面别处时 Esc 是那里的事。内层控件已经处理过的（`.prevent`）、输入法
 * 正在组字时按的都不算，同 `dialog-close.ts`。Reka 在 window 上冒泡阶段监听，只有最上层收得到，面板里再开的浮层先拿到。
 */
function onEscapeKeyDown(event: KeyboardEvent): void {
    const handled = event.defaultPrevented || event.isComposing || event.keyCode === 229;
    event.preventDefault();
    if (handled || panel.value === null) return;
    const target = event.target instanceof Element ? event.target : null;
    const onTrigger = target?.closest("[aria-controls]")?.getAttribute("aria-controls") === panel.value.id;
    if (target !== null && (panel.value.contains(target) || onTrigger)) emit("update:open", false);
}
</script>

<template>
    <DialogRoot :open="props.open" :modal="false" @update:open="(value: boolean) => emit('update:open', value)">
        <DialogTrigger as-child>
            <slot name="trigger" />
        </DialogTrigger>
        <DialogPortal :to="teleportTo()">
            <DialogContent
                as-child
                :aria-describedby="undefined"
                @close-auto-focus="onCloseAutoFocus"
                @escape-key-down="onEscapeKeyDown"
                @pointer-down-outside="keepOpen"
                @focus-outside="keepOpen"
                @interact-outside="keepOpen"
            >
                <section
                    ref="panel"
                    class="nb-ui-side-panel nb-ui-popover-surface nb-ui-dialog-surface nb-ui-drawer-surface fixed right-0 flex flex-col text-[var(--text-main)] outline-none"
                    :style="panelStyle"
                    data-side-panel
                >
                    <DialogTitle class="sr-only">{{ props.label }}</DialogTitle>
                    <slot />
                </section>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
