<script setup lang="ts">
import {computed} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";

import {useMarkdownText} from "../host/text";

import {PASTE_COLLAPSED_LINES} from "./prompt-text";

const props = withDefaults(defineProps<{
    number: number;
    content: string;
    expanded?: boolean;
    highlighted?: boolean;
    selected?: boolean;
    invalid?: boolean;
}>(), {
    expanded: false,
    highlighted: false,
    selected: false,
    invalid: false,
});

const emit = defineEmits<{
    (e: "update:expanded", expanded: boolean): void;
    (e: "hover", active: boolean): void;
}>();

const {t} = useMarkdownText();

defineSlots<{
    actions?: () => unknown;
    body?: () => unknown;
}>();


const lines = computed(() => props.content.split("\n"));
const collapsible = computed(() => lines.value.length > PASTE_COLLAPSED_LINES);
const clipped = computed(() => collapsible.value && !props.expanded);
const preview = computed(() => lines.value.slice(0, PASTE_COLLAPSED_LINES).join("\n"));
</script>

<template>
    <div
        class="prompt-paste"
        :class="{'is-highlighted': props.highlighted, 'is-in-selection': props.selected, 'is-invalid': props.invalid}"
        @mouseenter="emit('hover', true)"
        @mouseleave="emit('hover', false)"
    >
        <div class="prompt-paste__head">
            <span class="prompt-paste__icon i-lucide-clipboard-paste" aria-hidden="true" />
            <span class="prompt-paste__number">#{{ props.number }}</span>
            <span class="prompt-paste__title">{{ t("prompt.pasteTitle") }} · {{ t("prompt.lines", {count: lines.length}) }}</span>
            <span class="prompt-paste__actions">
                <IconButton
                    v-if="collapsible"
                    size="sm"
                    :icon-class="props.expanded ? 'i-lucide-chevrons-down-up' : 'i-lucide-chevrons-up-down'"
                    :title="props.expanded ? t('prompt.pasteCollapse') : t('prompt.pasteExpand')"
                    :aria-label="props.expanded ? t('prompt.pasteCollapse') : t('prompt.pasteExpand')"
                    :aria-expanded="props.expanded"
                    data-prompt-paste-action="expand"
                    @click="emit('update:expanded', !props.expanded)"
                />
                <slot name="actions" />
            </span>
        </div>
        <pre
            v-if="clipped"
            class="prompt-paste__body is-clipped"
            :title="t('prompt.pasteExpand')"
            @click="emit('update:expanded', true)"
        >{{ preview }}</pre>
        <slot v-else-if="$slots.body" name="body" />
        <pre v-else class="prompt-paste__body">{{ props.content }}</pre>
    </div>
</template>

<style scoped>
.prompt-paste {
    margin: 0.25rem 0;
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--text-main) 3%, var(--bg-panel));
    transition: border-color var(--motion-fast) var(--ease-layout), box-shadow var(--motion-fast) var(--ease-layout);
    user-select: none;
}

.prompt-paste.is-highlighted {
    border-color: color-mix(in srgb, var(--accent-main) 50%, var(--border-color));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 16%, transparent);
}

.prompt-paste:focus-within {
    border-color: color-mix(in srgb, var(--accent-main) 60%, var(--border-color));
}

.prompt-paste.is-invalid {
    border-color: var(--status-danger-border);
}

.prompt-paste.is-in-selection {
    border-color: color-mix(in srgb, var(--accent-main) 60%, var(--border-color));
    background: color-mix(in srgb, var(--accent-main) 16%, var(--bg-panel));
}

.prompt-paste__head {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0.25rem 0.15rem 0.5rem;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.prompt-paste__icon {
    flex: none;
    width: 0.85rem;
    height: 0.85rem;
}

.prompt-paste__number {
    flex: none;
    color: var(--text-main);
    font-weight: 600;
}

.prompt-paste__title {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.prompt-paste__actions {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.1rem;
}

/* 插槽里的编辑框也带这个类，与预览同样的字与间距，换成编辑框后看上去仍是同一块。 */
.prompt-paste__body,
:slotted(.prompt-paste__body) {
    position: relative;
    margin: 0;
    padding: 0.35rem 0.6rem 0.45rem;
    border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
    color: var(--text-main);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-xs);
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.prompt-paste__body.is-clipped {
    cursor: pointer;
}

.prompt-paste__body.is-clipped::after {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 1.2rem;
    border-radius: 0 0 0.5rem 0.5rem;
    background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--text-main) 3%, var(--bg-panel)));
    content: "";
    pointer-events: none;
}
</style>
