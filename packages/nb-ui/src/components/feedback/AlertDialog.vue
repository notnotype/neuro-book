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
import {useSlots} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import Button from "../controls/Button.vue";
import {useCloseHandoff} from "./close-handoff";

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
    title: "确认操作",
    description: "",
    confirmText: "确定",
    cancelText: "取消",
    tone: "danger",
});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "confirm"): void;
    (e: "cancel"): void;
    (e: "closed"): void;
}>();

const slots = useSlots();
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
        @update:open="(val) => emit('update:open', val)"
    >
        <AlertDialogTrigger v-if="$slots.trigger" as-child>
            <slot name="trigger" />
        </AlertDialogTrigger>
        <AlertDialogPortal>
            <AlertDialogOverlay
                :style="{zIndex: NB_Z_INDEX.dialog - 1}"
                class="fixed inset-0 bg-[color-mix(in_srgb,var(--overlay-scrim)_80%,transparent)] backdrop-blur-[4px] transition-opacity [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            />
            <AlertDialogContent
                @close-auto-focus="onCloseAutoFocus"
                :style="{
                    zIndex: NB_Z_INDEX.dialog,
                }"
                class="nb-ui-popover-surface nb-ui-dialog-surface fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[420px] p-6 text-[var(--text-main)] outline-none select-none transition-[transform,opacity] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)]"
            >
                <div class="flex flex-col gap-2">
                    <AlertDialogTitle class="text-[var(--text-md)] font-semibold text-[var(--text-main)]">
                        <slot name="title">
                            {{ props.title }}
                        </slot>
                    </AlertDialogTitle>

                    <AlertDialogDescription v-if="props.description || $slots.description" class="text-[var(--text-sm)] text-[var(--text-secondary)] leading-relaxed">
                        <slot name="description">
                            {{ props.description }}
                        </slot>
                    </AlertDialogDescription>
                </div>

                <div class="mt-6 flex items-center justify-end gap-3">
                    <AlertDialogCancel as-child @click="emit('cancel')">
                        <Button variant="secondary">
                            {{ props.cancelText }}
                        </Button>
                    </AlertDialogCancel>

                    <AlertDialogAction as-child @click="emit('confirm')">
                        <Button :variant="props.tone === 'danger' ? 'danger' : 'primary'">
                            {{ props.confirmText }}
                        </Button>
                    </AlertDialogAction>
                </div>
            </AlertDialogContent>
        </AlertDialogPortal>
    </AlertDialogRoot>
</template>
