<script setup lang="ts">
/** “移动到”菜单（同名 .md）：打开时记下视图与来源，`identity` 一变就关闭；选择只发事件，命令由宿主执行。 */
import {computed, ref, watch} from "vue";

import {Dropdown, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownItem} from "@notnotype/nb-ui/components";

export interface MoveTarget {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
}

export interface MoveTargetGroup {
    readonly label: string;
    readonly targets: ReadonlyArray<MoveTarget>;
}

defineOptions({name: "WorkbenchMoveViewMenu"});

const props = defineProps<{
    label: string;
    viewId: string;
    sourceContainerId: string;
    groups: ReadonlyArray<MoveTargetGroup>;
    resetLabel: string | null;
    identity: string;
}>();

const emit = defineEmits<{
    (event: "move", payload: {viewId: string; sourceContainerId: string; targetContainerId: string}): void;
    (event: "reset", viewId: string): void;
}>();

const RESET = "reset";
const MOVE_PREFIX = "move:";

/** 打开时记下的发起身份；关闭即清空。选择只认它，不认选择那一刻的 props。 */
const opened = ref<{readonly viewId: string; readonly sourceContainerId: string} | null>(null);

const items = computed<DropdownItem[]>(() => [
    ...props.groups.map((group, index) => ({
        label: group.label,
        value: `group:${String(index)}`,
        children: group.targets.map((target) => ({label: target.label, value: `${MOVE_PREFIX}${target.id}`, iconClass: target.icon})),
    })),
    ...(props.resetLabel === null || props.groups.length === 0 ? [] : [{label: "", value: "separator", separator: true}]),
    ...(props.resetLabel === null ? [] : [{label: props.resetLabel, value: RESET, iconClass: "i-lucide-undo-2"}]),
]);

const disabled = computed(() => props.groups.length === 0 && props.resetLabel === null);

function setOpen(open: boolean): void {
    opened.value = open ? {viewId: props.viewId, sourceContainerId: props.sourceContainerId} : null;
}

watch(() => props.identity, () => {
    opened.value = null;
});

function select(value: string): void {
    const origin = opened.value;
    opened.value = null;
    if (origin === null) return;
    if (value === RESET) emit("reset", origin.viewId);
    else if (value.startsWith(MOVE_PREFIX)) emit("move", {viewId: origin.viewId, sourceContainerId: origin.sourceContainerId, targetContainerId: value.slice(MOVE_PREFIX.length)});
}
</script>

<template>
    <Dropdown :items="items" :open="opened !== null" align="end" compact :disabled="disabled" @update:open="setOpen" @select="select">
        <IconButton size="sm" icon-class="i-lucide-arrow-right-left" :aria-label="label" :title="label" :disabled="disabled" :data-move-view="viewId" />
    </Dropdown>
</template>
