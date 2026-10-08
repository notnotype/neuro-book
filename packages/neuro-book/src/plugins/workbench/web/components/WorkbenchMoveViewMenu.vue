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

const open = ref(false);
/**
 * 打开时记下的发起身份。选择只认它，不认选择那一刻的 props；关闭时不清：菜单原语先报关闭、再报选择。身份一变就清，
 * 之后到达的选择没有发起身份可用，被丢弃。
 */
const origin = ref<{readonly viewId: string; readonly sourceContainerId: string} | null>(null);

/**
 * 一层平铺：按 Part 分段、段间分隔线，每项右侧注明所在 Part。不用级联子菜单：子菜单浮层在菜单原语看来是“外部”，
 * 真实浏览器里指针点进去会先触发外部点击关闭整个菜单，选择到不了。
 */
const items = computed<DropdownItem[]>(() => {
    const result: DropdownItem[] = [];
    props.groups.forEach((group, index) => {
        if (index > 0) result.push({label: "", value: `separator:${String(index)}`, separator: true});
        for (const target of group.targets) result.push({label: target.label, value: `${MOVE_PREFIX}${target.id}`, iconClass: target.icon, shortcut: group.label});
    });
    if (props.resetLabel !== null) {
        if (result.length > 0) result.push({label: "", value: "separator:reset", separator: true});
        result.push({label: props.resetLabel, value: RESET, iconClass: "i-lucide-undo-2"});
    }
    return result;
});

const disabled = computed(() => props.groups.length === 0 && props.resetLabel === null);

function setOpen(next: boolean): void {
    open.value = next;
    if (next) origin.value = {viewId: props.viewId, sourceContainerId: props.sourceContainerId};
}

watch(() => props.identity, () => {
    open.value = false;
    origin.value = null;
});

function select(value: string): void {
    const from = origin.value;
    origin.value = null;
    open.value = false;
    if (from === null) return;
    if (value === RESET) emit("reset", from.viewId);
    else if (value.startsWith(MOVE_PREFIX)) emit("move", {viewId: from.viewId, sourceContainerId: from.sourceContainerId, targetContainerId: value.slice(MOVE_PREFIX.length)});
}
</script>

<template>
    <Dropdown :items="items" :open="open" align="end" compact :disabled="disabled" @update:open="setOpen" @select="select">
        <IconButton size="sm" icon-class="i-lucide-arrow-right-left" :aria-label="label" :title="label" :disabled="disabled" :data-move-view="viewId" />
    </Dropdown>
</template>
