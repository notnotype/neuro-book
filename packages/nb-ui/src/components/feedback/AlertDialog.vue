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
}>();

const slots = useSlots();

function preventTriggerlessCloseFocus(event: Event): void {
    if (!slots.trigger) event.preventDefault();
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
                @close-auto-focus="preventTriggerlessCloseFocus"
                :style="{
                    zIndex: NB_Z_INDEX.dialog,
                    backgroundColor: 'color-mix(in srgb, var(--bg-panel) 85%, transparent)',
                    backdropFilter: 'blur(16px) saturate(130%) brightness(1.0)',
                    WebkitBackdropFilter: 'blur(16px) saturate(130%) brightness(1.0)',
                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--text-main) 10%, transparent), 0 12px 32px -4px color-mix(in srgb, var(--shadow-color) 30%, transparent)',
                }"
                class="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[420px] rounded-[var(--radius-panel)] p-6 text-[var(--text-main)] outline-none select-none transition-[transform,opacity] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)]"
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
