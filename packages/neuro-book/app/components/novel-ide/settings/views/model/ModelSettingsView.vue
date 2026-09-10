<script setup lang="ts">
import {computed, ref} from "vue";
import {Button, FormSelect} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";
import AgentVisibleModelsEditor from "./AgentVisibleModelsEditor.vue";
import NovelIdeModelSelect from "./NovelIdeModelSelect.vue";
import ModelProviderDetail from "./ModelProviderDetail.vue";
import ModelProviderRail from "./ModelProviderRail.vue";
import type {ModelSettingsDraft, ModelSettingsProviderDraft} from "./model-settings-draft";
import type {ModelSettingsViewEmits, ModelSettingsViewProps} from "./ModelSettingsView.types";

const props = withDefaults(defineProps<ModelSettingsViewProps>(), {
    saving: false,
    saveError: "",
});

const emit = defineEmits<ModelSettingsViewEmits>();

const {t} = useI18n();

/** 视图内唯一自持状态：已保存模型清单的分组折叠；不写草稿、不上报。 */
const expandedGroups = ref<Record<string, boolean>>({});

const activeProvider = computed<ModelSettingsProviderDraft | null>(() => props.draft.providers.find((provider) => provider.localKey === props.activeProviderKey) ?? null);
const templateOptions = computed<FormSelectOption[]>(() => props.providerTemplates.map((item) => ({
    value: item.id,
    label: item.name,
    description: item.description,
})));

function patchDraft(patch: Partial<ModelSettingsDraft>): void {
    emit("update:draft", {...props.draft, ...patch});
}

/** 详情里的字段改动以整份 Provider 草稿回来：按 localKey 换掉对应项，其它 Provider 不动。 */
function replaceProvider(provider: ModelSettingsProviderDraft): void {
    patchDraft({providers: props.draft.providers.map((item) => item.localKey === provider.localKey ? provider : item)});
}

function toggleGroup(group: string): void {
    expandedGroups.value[group] = !expandedGroups.value[group];
}
</script>

<template>
    <div class="model-view-root flex min-w-0 flex-col" data-lab-subject>
        <header class="shrink-0">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                {{ props.isProjectScope ? t("settings.panels.models.projectTitle") : t("settings.panels.models.globalTitle") }}
            </h2>
            <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">
                {{ props.isProjectScope
                    ? t("settings.panels.models.projectDescription", {target: props.targetLabel || t("settings.panels.models.currentProject")})
                    : t("settings.panels.models.globalDescription") }}
            </p>
        </header>

        <p v-if="props.saveError" class="mt-[var(--space-3)] truncate text-[var(--text-xs)] text-[var(--status-danger)]">
            {{ t("settings.panels.models.saveFailed") + "：" + props.saveError }}
        </p>
        <p v-else-if="props.saving" class="mt-[var(--space-3)] flex items-center gap-[var(--space-1)] text-[var(--text-xs)] text-[var(--status-info)]">
            <span class="i-lucide-loader-2 h-3 w-3 animate-spin" aria-hidden="true"></span>
            {{ t("common.saving") }}
        </p>

        <!-- 草稿问题：紧凑一行，完整列表交给宿主的对话框；修复只改草稿，不自动保存。 -->
        <div
            v-if="props.validationIssues.length > 0"
            class="mt-[var(--space-4)] flex min-w-0 flex-wrap items-center gap-[var(--space-2)] border-t border-[var(--divider)] pt-[var(--space-3)]"
            :title="props.validationIssueDetails"
        >
            <span class="i-lucide-triangle-alert h-4 w-4 shrink-0 text-[var(--status-warning)]" aria-hidden="true"></span>
            <span class="shrink-0 text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.models.validationIssuesTitle") }}</span>
            <span class="shrink-0 rounded-[var(--radius-control)] bg-[var(--bg-input)] px-[var(--space-2)] text-[var(--text-2xs)] text-[var(--text-secondary)]">{{ props.validationIssues.length }}</span>
            <span class="min-w-0 flex-1 truncate text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ props.validationIssues[0]?.message }}</span>
            <Button size="sm" variant="ghost" class="shrink-0" @click="emit('open-validation-issues')">{{ t("settings.panels.models.viewAllIssues") }}</Button>
            <Button size="sm" variant="secondary" class="shrink-0" :disabled="props.repairingModels" @click="emit('repair')">
                <span class="mr-1 h-3.5 w-3.5" :class="props.repairingModels ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-wand-sparkles'" aria-hidden="true"></span>
                {{ t("settings.panels.models.oneClickRepair") }}
            </Button>
        </div>

        <!-- 默认模型与新增 Provider -->
        <div class="model-top-grid mt-[var(--space-4)] grid gap-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="min-w-0">
                <div class="flex items-center gap-[var(--space-2)]">
                    <span class="i-lucide-cpu h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                    <span class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                        {{ props.isProjectScope ? t("settings.panels.models.projectDefaultTitle") : t("settings.panels.models.globalDefaultTitle") }}
                    </span>
                </div>
                <p class="mt-[var(--space-1)] text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">
                    {{ props.isProjectScope ? t("settings.panels.models.projectDefaultDescription") : t("settings.panels.models.globalDefaultDescription") }}
                </p>
                <div class="mt-[var(--space-2)]">
                    <NovelIdeModelSelect
                        :model-value="props.draft.defaultModelKey"
                        :models="props.defaultModelOptions"
                        :allow-default="props.isProjectScope"
                        :default-label="t('settings.panels.models.followGlobalDefault')"
                        :placeholder="t('settings.panels.models.noEnabledModels')"
                        :disabled="props.saving"
                        @update:model-value="patchDraft({defaultModelKey: $event})"
                    />
                </div>
            </div>

            <div v-if="!props.isProjectScope" class="min-w-0">
                <div class="flex items-center gap-[var(--space-2)]">
                    <span class="i-lucide-network h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                    <span class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.models.addProvider") }}</span>
                </div>
                <div class="mt-[var(--space-2)] flex items-start gap-[var(--space-2)]">
                    <div class="min-w-0 flex-1">
                        <FormSelect
                            size="sm"
                            :model-value="props.selectedTemplate"
                            :options="templateOptions"
                            :disabled="props.saving"
                            @update:model-value="emit('update:selectedTemplate', $event)"
                        />
                    </div>
                    <Button size="sm" variant="secondary" class="shrink-0" :disabled="props.saving" @click="emit('add-provider')">
                        <span class="i-lucide-plus mr-1 h-3 w-3" aria-hidden="true"></span>
                        {{ t("settings.panels.models.add") }}
                    </Button>
                </div>
            </div>
        </div>

        <div v-if="!props.isProjectScope" class="mt-[var(--space-5)]">
            <AgentVisibleModelsEditor
                :model-value="props.draft.agentVisibleModels"
                :models="props.defaultModelOptions"
                :default-model-key="props.draft.defaultModelKey"
                @update:model-value="patchDraft({agentVisibleModels: $event})"
            />
        </div>

        <div v-if="props.loading" class="mt-[var(--space-5)] flex min-h-[200px] flex-col items-center justify-center gap-[var(--space-3)]">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]" aria-hidden="true"></span>
            <span class="text-[var(--text-sm)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.models.loading") }}</span>
        </div>

        <!-- Provider 双栏：窄容器退化为导轨在上、详情在下 -->
        <div v-else-if="!props.isProjectScope" class="model-provider-layout mt-[var(--space-5)] grid gap-[var(--space-5)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <ModelProviderRail
                :providers="props.draft.providers"
                :active-key="props.activeProviderKey"
                @select="emit('select-provider', $event)"
            />
            <ModelProviderDetail
                :provider="activeProvider"
                :model-api-options="props.modelApiOptions"
                :saved-model-groups="props.savedModelGroups"
                :disabled-models="props.disabledModels"
                :active-provider-checking-model-count="props.activeProviderCheckingModelCount"
                :checking-all-models="props.checkingAllModels"
                :discovering="props.discoveringProviderId !== '' && props.discoveringProviderId === activeProvider?.id"
                :expanded-groups="expandedGroups"
                :max-retries-placeholder="props.maxRetriesPlaceholder"
                :saving="props.saving"
                @update:provider="replaceProvider"
                @toggle-enabled="emit('toggle-provider-enabled')"
                @rename-provider-id="emit('rename-provider-id', $event)"
                @clone-connection="emit('clone-provider-connection')"
                @request-delete="emit('request-delete-provider')"
                @clear-api-key="emit('clear-provider-api-key')"
                @discover-models="emit('discover-models')"
                @check-model="emit('check-model', $event)"
                @cancel-model-check="emit('cancel-model-check', $event)"
                @check-all-models="emit('check-all-models')"
                @cancel-model-checks="emit('cancel-model-checks')"
                @edit-model="emit('edit-model', $event)"
                @disable-model="emit('disable-model', $event)"
                @delete-model="emit('delete-model', $event)"
                @open-discovery="emit('open-discovery')"
                @open-library="emit('open-library')"
                @toggle-group="toggleGroup"
            />
        </div>
    </div>
</template>

<style scoped>
.model-view-root {
    container-type: inline-size;
}

/* 顶栏两块并排、Provider 双栏：都由视图自身容器宽度决定，不看窗口宽度。 */
@container (min-width: 620px) {
    .model-top-grid {
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    }
}

@container (min-width: 700px) {
    .model-provider-layout {
        grid-template-columns: 260px minmax(0, 1fr);
    }
}
</style>
