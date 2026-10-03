<script setup lang="ts">
import {computed} from "vue";
import {Switch} from "@notnotype/nb-ui/components";
import ModelPickerContent from "../../components/novel-ide/model-picker/ModelPickerContent.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ModelPickerContent>(() => props.input, ["select", "close"]);
const specialistEnabled = computed(() => Boolean(props.input?.props?.showSpecialistInPicker));
</script>

<template>
    <div class="flex h-full w-full items-center justify-center p-1">
        <div class="flex flex-col items-center shadow-xl w-full">
            <ModelPickerContent data-lab-subject v-bind="subject.bindings.value" />
        </div>
    </div>
    <LabFixtureControls>
        <div class="flex items-center gap-3 py-1 text-xs">
            <span class="text-[var(--text-secondary)]">专精轴角色:</span>
            <Switch
                :model-value="specialistEnabled"
                size="sm"
                aria-label="切换专精轴角色"
                @update:model-value="subject.write('props', 'showSpecialistInPicker', $event)"
            />
        </div>
    </LabFixtureControls>
</template>
