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
import {NB_Z_INDEX} from "../../theme/z-index";

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

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
}>();
</script>

<template>
    <DrawerRoot
        :open="props.open"
        :default-open="props.defaultOpen"
        :swipe-direction="props.direction === 'bottom' ? 'down' : (props.direction === 'top' ? 'up' : props.direction)"
        :modal="props.modal"
        @update:open="(val) => emit('update:open', val)"
    >
        <DrawerTrigger as-child>
            <slot name="trigger" />
        </DrawerTrigger>

        <DrawerPortal>
            <DrawerOverlay
                :style="{zIndex: NB_Z_INDEX.dialog - 1}"
                class="fixed inset-0 bg-[color-mix(in_srgb,var(--overlay-scrim)_80%,transparent)] backdrop-blur-[4px] transition-opacity [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            />

            <DrawerContent
                :style="{
                    zIndex: NB_Z_INDEX.dialog,
                }"
                class="nb-ui-popover-surface nb-ui-dialog-surface fixed flex flex-col text-[var(--text-main)] shadow-[var(--elevation-dialog)] transition-transform [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] outline-none border-[color-mix(in_srgb,var(--text-main)_10%,transparent)]"
                :class="[
                    props.direction === 'right' ? 'inset-y-0 right-0 h-full w-[380px] max-w-[90vw] border-l' : '',
                    props.direction === 'left' ? 'inset-y-0 left-0 h-full w-[380px] max-w-[90vw] border-r' : '',
                    props.direction === 'bottom' ? 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-[var(--radius-panel)] border-t' : '',
                    props.direction === 'top' ? 'inset-x-0 top-0 max-h-[85vh] rounded-b-[var(--radius-panel)] border-b' : '',
                    props.contentClass,
                ]"
            >
                <DrawerHandle
                    v-if="props.handle"
                    class="mx-auto my-3 h-1.5 w-12 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--text-main)_20%,transparent)] cursor-grab active:cursor-grabbing"
                />

                <div v-if="props.title || $slots.header" class="flex items-center justify-between px-5 py-4 border-b border-[var(--divider)]">
                    <slot name="header">
                        <div>
                            <DrawerTitle v-if="props.title" class="text-[var(--text-md)] font-semibold text-[var(--text-main)]">
                                {{ props.title }}
                            </DrawerTitle>
                            <DrawerDescription v-if="props.description" class="text-[var(--text-xs)] text-[var(--text-muted)] mt-0.5">
                                {{ props.description }}
                            </DrawerDescription>
                        </div>
                    </slot>

                    <DrawerClose class="nb-ui-focus-ring -mr-1.5 flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] transition-[background-color,color,transform] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:text-[var(--text-main)] not-disabled:active:scale-[0.92] cursor-pointer">
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
