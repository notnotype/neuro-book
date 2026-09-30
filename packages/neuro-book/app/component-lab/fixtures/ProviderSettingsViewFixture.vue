<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {DialogWindow} from "@notnotype/nb-ui/components";
import ProviderSettingsView from "../../components/novel-ide/settings/sections/providers/ProviderSettingsView.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ProviderSettingsView>(() => props.input, ["select-provider", "add-provider", "toggle-provider-enabled", "rename-provider-id", "clone-provider-connection", "request-delete-provider", "clear-provider-api-key", "discover-models", "check-model", "cancel-model-check", "check-all-models", "cancel-model-checks", "edit-model", "disable-model", "delete-model", "open-discovery", "open-library", "repair", "open-validation-issues", "update:discoveryManualField"]);
const sceneKey = computed(() => props.scene);

const windowOpen = ref(true);
watch(() => props.scene, () => { windowOpen.value = true; });


function selectProvider(key: string): void {
    subject.write("props", "activeProviderKey", key);
}

function updateManualField(field: string, value: string): void {
    subject.write("props", "discoveryManualDraft", {...subject.bindings.value.discoveryManualDraft, [field]: value});
}


/**
 * 视图绑定只有一份：下面的场景把一个 `<ProviderSettingsView>` 直接摆在画布上，
 * dialog-window 场景摆进 nb-ui `DialogWindow`（产品里它就是这样被承载的）。
 * 两处共用同一份 props / handlers，避免同一份绑定写两遍后走样。
 */
const enabledModelIds = new Set<string>();
const viewBindings = computed(() => ({
    ...subject.bindings.value,
    enabledModelIds,
    "onSelect-provider": selectProvider,
    "onUpdate:discoveryManualField": updateManualField,
    "onUpdate:selectedTemplate": (value: string) => subject.write("props", "selectedTemplate", value),
}));
</script>
<template>
    <div v-if="sceneKey === 'dialog-window'" class="flex h-full min-h-0 flex-col items-start gap-3 p-[var(--space-6)]">
        <button
            v-if="!windowOpen"
            type="button"
            class="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-[var(--divider)] px-3 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
            @click="windowOpen = true"
        >
            重新打开窗口
        </button>
        <DialogWindow v-model="windowOpen" size="lg" title="模型设置" resizable :min-width="720" :min-height="420" body-class="!p-0">
            <ProviderSettingsView v-bind="viewBindings" />
        </DialogWindow>
    </div>

    <div v-else class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <ProviderSettingsView v-bind="viewBindings" />
    </div>
</template>
