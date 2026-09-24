<script setup lang="ts">
import {computed} from "vue";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";
import {useLabEventSink} from "../lab-event-sink";

type FixtureMenuItem = Omit<ContextMenuItem, "action" | "children"> & {children?: FixtureMenuItem[]};

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(ContextMenu, () => props.input);
const emitLabEvent = useLabEventSink();

function mapItem(item: FixtureMenuItem): ContextMenuItem {
    return {
        ...item,
        action: () => emitLabEvent("item-action", {label: item.label}),
        children: item.children?.map(mapItem),
    };
}

const bindings = computed(() => {
    const source = subject.bindings.value.items;
    const items = Array.isArray(source) ? (source as FixtureMenuItem[]).map(mapItem) : [];
    return {...subject.bindings.value, items};
});

function closeMenu(): void {
    subject.write("props", "visible", false);
}
</script>

<template>
    <div class="relative h-full min-h-0 w-full bg-[var(--panel-surface)]">
        <ContextMenu data-lab-subject v-bind="bindings" @close="closeMenu" />
    </div>
</template>
