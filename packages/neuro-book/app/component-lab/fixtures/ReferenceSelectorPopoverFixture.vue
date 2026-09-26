<script setup lang="ts">
import {computed, ref} from "vue";
import ReferenceSelectorPopover from "../../components/common/form/ReferenceSelectorPopover.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ReferenceSelectorPopover>(() => props.input);
const anchorElement = ref<HTMLElement | null>(null);

function handleHover(index: number): void {
    subject.write("props", "activeIndex", index);
}

const popoverBindings = computed(() => ({
    ...subject.bindings.value,
    anchorElement: anchorElement.value,
}));
</script>

<template>
    <div class="relative min-h-48 w-full" data-lab-subject>
        <div
            ref="anchorElement"
            class="h-7 w-fit rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-xs leading-7 text-[var(--text-secondary)]"
        >
            光标锚点
        </div>
        <ReferenceSelectorPopover
            v-bind="popoverBindings"
            @hover="handleHover"
        />
    </div>
</template>
