<script setup lang="ts">
import DesktopSettingsView from "../../components/novel-ide/settings/sections/desktop/DesktopSettingsView.vue";
import type {DesktopSettingsPatch} from "@notnotype/neuro-book-contracts/desktop";
import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof DesktopSettingsView>(() => props.input);
const recordEvent = useLabEventSink();

function updateSettings(patch: DesktopSettingsPatch): void {
    recordEvent("update:settings", patch);
    subject.write("model", "settings", {...subject.bindings.value.settings, ...patch});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <DesktopSettingsView
                v-bind="{...subject.bindings.value, 'onUpdate:settings': updateSettings}"
            />
        </div>
    </div>
</template>
