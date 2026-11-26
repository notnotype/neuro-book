<script setup lang="ts">
/**
 * 条目页看哪个时间点（docs/specs/canon/author-ui.md 输出 7；同名 .md）：一个按钮写当前位置，点开是各位置的单选与“算上计划中的
 * 情节”的勾选；按钮左边一格放这一页此刻的标记（算上计划、还没出场、原来那一章不在了）。受控：选了什么发出什么。
 */
import {computed} from "vue";

import {Button, DropdownMenu} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData, SelectOption} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";

const props = withDefaults(defineProps<{
    /** 能选的位置，依次是最初与各章的开头、末尾。 */
    positions: readonly SelectOption[];
    position: string;
    planned?: boolean;
    /** 作品里有计划中的情节：才出“算上计划中的情节”。默认 false。 */
    canPlan?: boolean;
    /** 位置与“算上计划”现在不能换的原因（有没提交的主文字，输出 46）；默认空（能换）。 */
    locked?: string;
    /** 在所选位置上还没出场（输出 8）；默认 false。位置就写在旁边的按钮上，标记里不再重复。 */
    notAppeared?: boolean;
    /** 选过的那一章被删掉了，位置已经回到缺省（输出 7）。 */
    positionGone?: boolean;
}>(), {planned: false, canPlan: false, locked: "", notAppeared: false, positionGone: false});

const emit = defineEmits<{
    (event: "update:position", value: string): void;
    (event: "update:planned", value: boolean): void;
}>();

const text = useCanonText();
const PLANNED = "planned";
const label = computed(() => props.positions.find((option) => option.value === props.position)?.label ?? "");
const items = computed<DropdownMenuItemData[]>(() => [
    ...props.positions.map((option) => ({id: `position:${option.value}`, label: option.label, type: "radio" as const, group: "position", checked: option.value === props.position})),
    ...(props.canPlan ? [{id: "sep-plan", label: "", separator: true}, {id: PLANNED, label: text("entry.planned"), type: "checkbox" as const, checked: props.planned}] : []),
]);
const onSelect = (id: string): void => {
    if (id === PLANNED) emit("update:planned", !props.planned);
    else if (id.startsWith("position:")) emit("update:position", id.slice("position:".length));
};
/** 标记一格里此刻写什么：算上计划优先（它决定了能不能改），其次是没出场与那一章不在了。 */
const mark = computed<"planned" | "gone" | "absent" | null>(() => (props.planned ? "planned" : props.positionGone ? "gone" : props.notAppeared ? "absent" : null));
</script>

<template>
    <div class="flex min-w-0 items-center gap-1" data-position-picker :data-position-locked="props.locked !== '' ? '' : undefined">
        <Transition name="position-mark" mode="out-in">
            <button
                v-if="mark === 'planned'"
                key="planned"
                type="button"
                class="position-mark position-mark--planned"
                :disabled="props.locked !== ''"
                :title="props.locked !== '' ? props.locked : text('entry.leavePlans')"
                :aria-label="text('entry.leavePlans')"
                data-planned-mark
                @click="emit('update:planned', false)"
            >
                <span class="truncate">{{ text("entry.plannedMark") }}</span><span class="i-lucide-x size-3.5 shrink-0 opacity-70" aria-hidden="true" />
            </button>
            <span v-else-if="mark === 'gone'" key="gone" class="position-mark" role="status" :title="text('entry.positionGone')"><span class="truncate">{{ text("entry.positionGone") }}</span></span>
            <span v-else-if="mark === 'absent'" key="absent" class="position-mark" :title="text('entry.notAppeared')" data-not-appeared><span class="truncate">{{ text("entry.notAppeared") }}</span></span>
        </Transition>
        <DropdownMenu align="end" root-class="min-w-0" :items="items" :disabled="props.locked !== ''" @select="onSelect">
            <Button class="min-w-0 max-w-full" size="sm" variant="ghost" :disabled="props.locked !== ''" :title="props.locked !== '' ? props.locked : undefined" :aria-label="`${text('entry.position')}：${label}`" data-position-trigger>
                <span class="i-lucide-clock-3 size-4 shrink-0" aria-hidden="true" />
                <span class="truncate">{{ label }}</span>
                <span class="i-lucide-chevron-down size-3.5 shrink-0 opacity-60" aria-hidden="true" />
            </Button>
        </DropdownMenu>
    </div>
</template>

<style scoped>
/* 标记可以收窄、文字截断（整句在悬停提示里）：位置带章标题时整句很长，390 宽不能撑出横向滚动。 */
.position-mark {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
    height: 1.75rem;
    padding: 0 10px;
    border-radius: var(--radius-pill);
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    white-space: nowrap;
}
.position-mark--planned {
    padding-right: 6px;
    background: color-mix(in srgb, var(--status-info) 14%, transparent);
    color: var(--text-main);
    transition: background-color var(--motion-fast) var(--ease-layout);
}
.position-mark--planned:hover:not(:disabled) {
    background: color-mix(in srgb, var(--status-info) 22%, transparent);
}
.position-mark-enter-active,
.position-mark-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.position-mark-enter-from,
.position-mark-leave-to {
    opacity: 0;
}
</style>
