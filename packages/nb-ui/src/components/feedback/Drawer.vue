<script setup lang="ts">
import {
    DrawerClose,
    DrawerContent,
    DrawerDescription,
    DrawerHandle,
    DrawerOverlay,
    DrawerPortal,
    DrawerRoot,
    DrawerTitle,
    DrawerTrigger,
} from "reka-ui";
import {computed, provide, ref, watch} from "vue";
import {NB_MODAL_POPOVER_Z_INDEX, NB_POPOVER_Z_INDEX} from "../../theme/z-index";
import {useModalLayer} from "../../composables/useModalLayer";
import {useTeleportTarget} from "../../composables/useTeleportTarget";
import {useUiText} from "../../text-port";

export type DrawerDirection = "top" | "bottom" | "left" | "right";

const props = withDefaults(defineProps<{
    open?: boolean;
    defaultOpen?: boolean;
    direction?: DrawerDirection;
    title?: string;
    description?: string;
    modal?: boolean;
    handle?: boolean;
    contentClass?: string;
    /** 关闭按钮的读屏名称；缺省经翻译端口取。 */
    closeLabel?: string;
}>(), {
    open: undefined,
    defaultOpen: false,
    direction: "right",
    title: "",
    description: "",
    modal: true,
    handle: false,
    contentClass: "",
});
// 居中类浮层：宿主可以把它收进更近的目标（例如 Lab 的画布），见 useTeleportTarget。
const teleportTo = useTeleportTarget(() => undefined);
const text = useUiText();
const closeText = computed(() => props.closeLabel ?? text("drawer.close"));

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
}>();

/*
 * 层级与 Dialog、AlertDialog 同一个模态序列：从抽屉里打开的确认框压在抽屉上面，反过来也一样。打开状态受控时跟 open，
 * 非受控时跟 reka 发出的变化。抽屉内容传送到页面根上，里面的下拉、提示若取普通页面的浮层层级会落在抽屉后面，
 * 所以向内容树提供模态的局部浮层层级（理由见 NB_MODAL_POPOVER_Z_INDEX）。
 */
const opened = ref(props.open ?? props.defaultOpen);
watch(() => props.open, (value) => {
    if (value !== undefined) opened.value = value;
});
const {zIndex} = useModalLayer(() => opened.value);
provide(NB_POPOVER_Z_INDEX, NB_MODAL_POPOVER_Z_INDEX);

function onOpenChange(value: boolean): void {
    opened.value = value;
    emit("update:open", value);
}
</script>

<template>
    <DrawerRoot
        :open="props.open"
        :default-open="props.defaultOpen"
        :swipe-direction="props.direction === 'bottom' ? 'down' : (props.direction === 'top' ? 'up' : props.direction)"
        :modal="props.modal"
        @update:open="onOpenChange"
    >
        <DrawerTrigger as-child>
            <slot name="trigger" />
        </DrawerTrigger>

        <DrawerPortal :to="teleportTo()">
            <DrawerOverlay
                :style="{zIndex}"
                class="fixed inset-0 bg-[var(--overlay-bg)] backdrop-blur-[4px] transition-opacity [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            />

            <DrawerContent
                :style="{zIndex}"
                class="nb-ui-popover-surface nb-ui-dialog-surface nb-ui-drawer-surface fixed flex flex-col text-[var(--text-main)] transition-transform [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] outline-none"
                :class="[
                    props.direction === 'right' ? 'inset-y-0 right-0 h-full w-[380px] max-w-[90cqw]' : '',
                    props.direction === 'left' ? 'inset-y-0 left-0 h-full w-[380px] max-w-[90cqw]' : '',
                    props.direction === 'bottom' ? 'inset-x-0 bottom-0 max-h-[85cqh]' : '',
                    props.direction === 'top' ? 'inset-x-0 top-0 max-h-[85cqh]' : '',
                    props.contentClass,
                ]"
            >
                <DrawerHandle
                    v-if="props.handle"
                    class="mx-auto my-3 h-1.5 w-12 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--text-main)_20%,transparent)] cursor-grab active:cursor-grabbing"
                />

                <!-- 没有标题时仍给对话框角色一个读屏名称（与 Dialog、QuickPick 一致）。 -->
                <DrawerTitle v-if="!props.title" class="sr-only">{{ text("drawer.untitled") }}</DrawerTitle>

                <div v-if="props.title || $slots.header" class="flex items-center justify-between px-5 py-4 border-b border-[var(--divider)]">
                    <slot name="header">
                        <div>
                            <DrawerTitle v-if="props.title" class="text-[length:var(--text-md)] font-semibold text-[var(--text-main)]">
                                {{ props.title }}
                            </DrawerTitle>
                            <DrawerDescription v-if="props.description" class="text-[length:var(--text-xs)] text-[var(--text-muted)] mt-0.5">
                                {{ props.description }}
                            </DrawerDescription>
                        </div>
                    </slot>

                    <DrawerClose class="nb-ui-focus-ring -mr-1.5 flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] transition-[background-color,color,transform] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:text-[var(--text-main)] not-disabled:active:scale-[0.92] cursor-pointer" :aria-label="closeText">
                        <span class="i-lucide-x h-4 w-4" aria-hidden="true"></span>
                    </DrawerClose>
                </div>

                <div class="flex-1 overflow-y-auto px-5 py-4">
                    <slot />
                </div>

                <div v-if="$slots.footer" class="flex items-center justify-end gap-3 px-5 py-3 border-t border-[var(--divider)] bg-[color-mix(in_srgb,var(--text-main)_3%,transparent)]">
                    <slot name="footer" />
                </div>
            </DrawerContent>
        </DrawerPortal>
    </DrawerRoot>
</template>
