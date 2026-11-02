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
import {computed, ref, useSlots, watch} from "vue";
import {useUiText} from "../../text-port";
import {useOverlayLayer} from "../../composables/useOverlayLayer";
import {useTeleportTarget} from "../../composables/useTeleportTarget";
import Button from "../controls/Button.vue";
import {useCloseHandoff} from "./close-handoff";
import type {Tone} from "../shared-types";

/** `danger`：确认按钮用危险样式；`neutral`：用主按钮样式。 */
export type AlertDialogTone = Extract<Tone, "danger" | "neutral">;

const props = withDefaults(defineProps<{
    open?: boolean;
    defaultOpen?: boolean;
    title?: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: AlertDialogTone;
}>(), {
    open: undefined,
    defaultOpen: false,
    description: "",
    tone: "danger",
});
const text = useUiText();
const titleText = computed(() => props.title ?? text("alertDialog.title"));
const confirmText = computed(() => props.confirmLabel ?? text("alertDialog.confirm"));
const cancelText = computed(() => props.cancelLabel ?? text("alertDialog.cancel"));
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
// 与 Dialog 同一个模态序列，叠在别的对话框里打开时画二级的面（useOverlayLayer）。
const {zIndex, nested} = useOverlayLayer({kind: "modal", open: () => opened.value});

function onOpenChange(value: boolean): void {
    opened.value = value;
    emit("update:open", value);
}
// 跟内部打开态而不是 props.open：非受控用法（带触发器）重开时也要作废上一次没结算的 closed。
const handoff = useCloseHandoff(() => opened.value);

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
                class="nb-ui-overlay fixed inset-0 bg-[var(--overlay-bg)] backdrop-blur-[4px]"
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
                            {{ cancelText }}
                        </Button>
                    </AlertDialogCancel>

                    <AlertDialogAction as-child v-bind="{onClick: () => emit('confirm')}">
                        <Button :variant="props.tone === 'danger' ? 'danger' : 'primary'">
                            {{ confirmText }}
                        </Button>
                    </AlertDialogAction>
                </div>
            </AlertDialogContent>
        </AlertDialogPortal>
    </AlertDialogRoot>
</template>
