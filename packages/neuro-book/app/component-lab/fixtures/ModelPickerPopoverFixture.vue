<script setup lang="ts">
import {computed} from "vue";
import {Switch} from "@notnotype/nb-ui/components";
import ModelPickerPopover from "../../components/novel-ide/model-picker/ModelPickerPopover.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ModelPickerPopover>(() => props.input, ["select"]);
const specialistEnabled = computed(() => Boolean(props.input?.props?.showSpecialistInPicker));
const popoverOpen = computed(() => Boolean(props.input?.model?.open));
</script>

<template>
    <div class="flex h-full w-full items-center justify-center p-1">
        <div class="flex flex-col items-center gap-4 min-h-[500px] w-full">
            <div class="text-xs text-[var(--text-secondary)]">
                当前选中: <code>{{ props.input?.model?.modelValue }}</code>
                <span class="mx-2">|</span>
                思考等级: <code>{{ props.input?.model?.thinkingLevel ?? "跟随设定 (null)" }}</code>
            </div>
            <ModelPickerPopover data-lab-subject v-bind="subject.bindings.value" />
        </div>
    </div>
    <LabFixtureControls>
        <div class="flex flex-wrap gap-4 py-1 text-xs">
            <label class="flex items-center gap-2">
                专精轴角色
                <Switch :model-value="specialistEnabled" size="sm" aria-label="切换专精轴角色"
                    @update:model-value="subject.write('props', 'showSpecialistInPicker', $event)" />
            </label>
            <label class="flex items-center gap-2">
                弹层开关
                <Switch :model-value="popoverOpen" size="sm" aria-label="切换弹层打开状态"
                    @update:model-value="subject.write('model', 'open', $event)" />
            </label>
        </div>
    </LabFixtureControls>
</template>
