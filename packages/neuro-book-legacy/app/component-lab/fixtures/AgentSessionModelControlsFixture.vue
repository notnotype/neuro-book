<script setup lang="ts">
import AgentSessionModelControls from "../../components/novel-ide/agent/panels/header/AgentSessionModelControls.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentSessionModelControls>(() => props.input, ["update-session-model-selection","toggle-session-model-popover","apply-session-model-settings","reset-session-model-settings"]);
import LabFixtureControls from "../LabFixtureControls.vue";
import {Switch} from "@notnotype/nb-ui/components";
function updateSelection(value: string | null): void { subject.write("props", "sessionModelSelectionValue", value); }
function togglePopover(): void { subject.write("model", "sessionModelPopoverOpen", !subject.bindings.value.sessionModelPopoverOpen); }
</script>
<template>
    <div class="flex h-full w-full items-center justify-center p-4"><AgentSessionModelControls data-lab-subject v-bind="subject.bindings.value" @update-session-model-selection="updateSelection" @toggle-session-model-popover="togglePopover" /></div>
    <LabFixtureControls>
        <div class="flex items-center gap-3 py-1 text-xs select-none">
            <span class="font-medium text-[var(--text-secondary)]">专精角色:</span>
            <div class="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2.5 py-1 shadow-xs">
                <span class="text-[11px] text-[var(--text-main)]">{{ subject.bindings.value.showSpecialistInPicker ? "显示" : "隐藏" }}</span>
                <Switch
                    :model-value="subject.bindings.value.showSpecialistInPicker"
                    size="sm"
                    aria-label="切换专精角色显示"
                    @update:model-value="subject.write('props', 'showSpecialistInPicker', $event)"
                />
            </div>
        </div>
    </LabFixtureControls>
</template>
