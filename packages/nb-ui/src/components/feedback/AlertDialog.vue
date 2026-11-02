<script setup lang="ts">
import {
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogOverlay,
    AlertDialogPortal,
    AlertDialogRoot,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "reka-ui";
import {computed, inject, provide, ref, useSlots, watch} from "vue";
import {useUiText} from "../../text-port";
import {useModalLayer} from "../../composables/useModalLayer";
import {useTeleportTarget} from "../../composables/useTeleportTarget";
import Button from "../controls/Button.vue";
import {useCloseHandoff} from "./close-handoff";
import {NB_DIALOG_LAYER} from "../../theme/z-index";

export type AlertDialogTone = "danger" | "warning" | "accent";

const props = withDefaults(defineProps<{
    open?: boolean;
    defaultOpen?: boolean;
    title?: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    tone?: AlertDialogTone;
}>(), {
    open: undefined,
    defaultOpen: false,
    description: "",
    tone: "danger",
});
// 叠在别的对话框里打开时画二级的面（NB_DIALOG_LAYER）。
const parentLayer = inject(NB_DIALOG_LAYER, 0);
provide(NB_DIALOG_LAYER, parentLayer + 1);
const nested = parentLayer >= 1;
const text = useUiText();
const titleText = computed(() => props.title ?? text("alertDialog.title"));
const confirmLabel = computed(() => props.confirmText ?? text("alertDialog.confirm"));
const cancelLabel = computed(() => props.cancelText ?? text("alertDialog.cancel"));
// 居中类浮层：宿主可以把它收进更近的目标（例如 Lab 的画布），见 useTeleportTarget。
const teleportTo = useTeleportTarget(() => undefined);

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "confirm"): void;
    (e: "cancel"): void;
    (e: "closed"): void;
}>();

const slots = useSlots();
// 打开状态：受控时跟 open，带触发器的非受控用法跟 reka 发出的变化。层级按打开顺序与 Dialog 同一个序列。
const opened = ref(props.open ?? props.defaultOpen);
watch(() => props.open, (value) => {
    if (value !== undefined) opened.value = value;
});
const {zIndex} = useModalLayer(() => opened.value);

function onOpenChange(value: boolean): void {
    opened.value = value;
    emit("update:open", value);
}
const handoff = useCloseHandoff(() => props.open === true);

function preventTriggerlessCloseFocus(event: Event): void {
    if (!slots.trigger) event.preventDefault();
}

/**
 * `closed` 是「关闭真的做完了」：内容已卸载、Reka 的焦点栈与指针锁已释放，
 * 有触发器时焦点也已归还。宿主用它在关闭后再激活下一个交互层，不要改用固定毫秒数。
 */
function onCloseAutoFocus(event: Event): void {
    preventTriggerlessCloseFocus(event);
    handoff.schedule(() => emit("closed"));
}
</script>

<template>
    <AlertDialogRoot
        :open="props.open"
        :default-open="props.defaultOpen"
        @update:open="onOpenChange"
    >
        <AlertDialogTrigger v-if="$slots.trigger" as-child>
            <slot name="trigger" />
        </AlertDialogTrigger>
        <AlertDialogPortal :to="teleportTo()">
            <AlertDialogOverlay
                :style="{zIndex}"
                class="fixed inset-0 bg-[var(--overlay-bg)] backdrop-blur-[4px] transition-opacity [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            />
            <AlertDialogContent
                @close-auto-focus="onCloseAutoFocus"
                :style="{zIndex}"
                :class="{'nb-ui-dialog-surface--nested': nested}"
                class="nb-ui-popover-surface nb-ui-dialog-surface nb-ui-dialog-surface--compact fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[420px] p-6 text-[var(--text-main)] outline-none select-none transition-[transform,opacity] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)]"
            >
                <div class="flex flex-col gap-2">
                    <AlertDialogTitle class="nb-ui-dialog-title">
                        <slot name="title">
                            {{ titleText }}
                        </slot>
                    </AlertDialogTitle>

                    <AlertDialogDescription v-if="props.description || $slots.description" class="text-[length:var(--text-sm)] text-[var(--text-secondary)] leading-relaxed">
                        <slot name="description">
                            {{ props.description }}
                        </slot>
                    </AlertDialogDescription>
                </div>

                <div class="nb-ui-dialog-footer mt-6 justify-end">
                    <AlertDialogCancel as-child v-bind="{onClick: () => emit('cancel')}">
                        <Button variant="secondary">
                            {{ cancelLabel }}
                        </Button>
                    </AlertDialogCancel>

                    <AlertDialogAction as-child v-bind="{onClick: () => emit('confirm')}">
                        <Button :variant="props.tone === 'danger' ? 'danger' : 'primary'">
                            {{ confirmLabel }}
                        </Button>
                    </AlertDialogAction>
                </div>
            </AlertDialogContent>
        </AlertDialogPortal>
    </AlertDialogRoot>
</template>
