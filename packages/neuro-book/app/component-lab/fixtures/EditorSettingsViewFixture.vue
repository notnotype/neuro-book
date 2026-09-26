<script setup lang="ts">
import EditorSettingsView from "../../components/novel-ide/settings/sections/editor/EditorSettingsView.vue";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES, DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EditorSettingsView>(() => props.input, ["reset"]);

function resetPreferences(target: "markdown" | "monaco"): void {
    subject.write("model", target, target === "markdown" ? {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES} : {...DEFAULT_MONACO_EDITOR_PREFERENCES});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <EditorSettingsView v-bind="subject.bindings.value" @reset="resetPreferences" />
        </div>
    </div>
</template>
