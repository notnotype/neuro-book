<script setup lang="ts">
import {computed} from "vue";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";
import {useLabEventSink} from "../lab-event-sink";

type FixtureMenuItem = Omit<ContextMenuItem, "action" | "children"> & {children?: FixtureMenuItem[]};

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ContextMenu>(() => props.input, ["close"]);
const emitLabEvent = useLabEventSink();

function mapItem(item: FixtureMenuItem): ContextMenuItem {
    return {
        ...item,
        action: () => emitLabEvent("item-action", {label: item.label}),
        children: item.children?.map(mapItem),
    };
}

const items = computed<ContextMenuItem[]>(() => {
    const source = props.input?.props?.items;
    return Array.isArray(source) ? (source as FixtureMenuItem[]).map(mapItem) : [];
});

function closeMenu(): void {
    subject.write("props", "visible", false);
}
</script>

<template>
    <div data-lab-subject class="relative h-full min-h-0 w-full bg-[var(--panel-surface)]">
        <ContextMenu :visible="subject.bindings.value.visible" :x="subject.bindings.value.x" :y="subject.bindings.value.y" :items="items" @close="closeMenu" />
    </div>
</template>
