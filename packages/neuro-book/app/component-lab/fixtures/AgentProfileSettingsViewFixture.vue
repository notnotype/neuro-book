<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {DialogWindow} from "@notnotype/nb-ui/components";
import AgentProfileSettingsView from "../../components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const {t} = useI18n();
const subject = useLabSubject<typeof AgentProfileSettingsView>(() => props.input);
const viewBindings = computed(() => ({
    ...subject.bindings.value,
    // 产品会 structuredClone(runtime defaults)，Vue 的响应式 Proxy 不是结构化克隆值。
    context: JSON.parse(JSON.stringify(subject.bindings.value.context)),
}));


const SAVED_HINT = "改动已就地保存到本次预览；未写入真实配置。";
const dialogOpen = ref(false);
const dialogWidth = ref(1100);
const dialogHeight = ref<string | number>("calc(100dvh - 120px)");
const message = ref("");
const sceneKey = computed(() => props.scene);
const isDialogScene = computed(() => sceneKey.value === "dialog-window");
watch(sceneKey, () => {
    dialogOpen.value = isDialogScene.value;
    message.value = "";
}, {immediate: true});
const scopeLabel = computed(() => subject.bindings.value.context.scope === "project"
    ? t("settings.panels.profileModels.settingsView.scopeProject", {target: "示例项目"})
    : t("settings.panels.profileModels.settingsView.scopeGlobal"));

/**
 * 就地保存：视图每次修改都直接交给宿主，这里模拟宿主立即持久化。
 */
function onUpdate(): void {
    message.value = SAVED_HINT;
}

function onDialogClose(): void {
    dialogOpen.value = false;
}

function reopenDialog(): void {
    dialogOpen.value = true;
}
</script>

<template>
    <div class="flex h-full max-h-full min-h-0 w-full flex-col gap-2">
        <p v-if="message" class="shrink-0 rounded-[var(--radius-control)] border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-1.5 text-[11px] text-[var(--status-success)]">{{ message }}</p>
        <div v-if="isDialogScene && !dialogOpen" class="flex min-h-0 flex-1 items-center justify-center">
            <button type="button" class="rounded-[var(--radius-control)] bg-[var(--accent-bg)] px-3 py-2 text-sm text-[var(--accent-text)]" @click="reopenDialog">
                打开 Agent Profile 设置窗口
            </button>
        </div>
        <div v-else-if="isDialogScene" class="min-h-0 flex-1">
            <DialogWindow
                :model-value="dialogOpen"
                :width="dialogWidth"
                :height="dialogHeight"
                :min-width="720"
                :min-height="520"
                :resizable="true"
                :body-class="'min-h-0 flex-1 overflow-hidden p-0'"
                @update:model-value="dialogOpen = $event"
                @request-close="onDialogClose"
                @update:width="dialogWidth = $event"
                @update:height="dialogHeight = $event"
            >
                <template #header>
                    <span>Agent Profile 设置</span>
                    <span class="ml-2 text-[var(--text-muted)]">·</span>
                    <span class="ml-1.5 text-[var(--text-muted)]">{{ scopeLabel }}</span>
                </template>
                <AgentProfileSettingsView
                    :key="sceneKey"
                    class="h-full"
                    data-lab-subject
                    v-bind="viewBindings"
                    :show-nav-heading="false"
                    @update:model-value="onUpdate"
                />
            </DialogWindow>
        </div>
        <div v-else class="min-h-0 flex-1">
            <AgentProfileSettingsView
                :key="sceneKey"
                class="h-full"
                data-lab-subject
                v-bind="viewBindings"
                @update:model-value="onUpdate"
            />
        </div>
    </div>
</template>
