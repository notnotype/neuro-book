<script setup lang="ts">
import {computed, ref} from "vue";
import {Button, Dialog, DialogWindow, Tooltip} from "@notnotype/nb-ui/components";
import ModelDiscoveryDialog from "./components/ModelDiscoveryDialog.vue";
import ModelLibraryDialog from "./components/ModelLibraryDialog.vue";
import ModelProviderDetail from "./components/ModelProviderDetail.vue";
import ModelProviderRail from "./components/ModelProviderRail.vue";
import NovelIdeModelEditDialog from "./components/NovelIdeModelEditDialog.vue";
import {parseDraftInteger, parseModelInput, parseModelReasoning} from "./provider-settings-draft";
import type {ModelSettingsDraft, ModelSettingsModelDraft, ModelSettingsProviderDraft} from "./provider-settings-draft";
import type {ProviderSettingsViewEmits, ProviderSettingsViewProps} from "./ProviderSettingsView.types";

const props = withDefaults(defineProps<ProviderSettingsViewProps>(), {
    saving: false,
    saveError: "",
});

const emit = defineEmits<ProviderSettingsViewEmits>();

const {t} = useI18n();

/** 视图内唯一自持状态：已保存模型清单的分组折叠；不写草稿、不上报。 */
const expandedGroups = ref<Record<string, boolean>>({});

const activeProvider = computed<ModelSettingsProviderDraft | null>(() => props.draft.providers.find((provider) => provider.localKey === props.activeProviderKey) ?? null);
const discoveringActiveProvider = computed(() => props.discoveringProviderId !== "" && props.discoveringProviderId === activeProvider.value?.id);
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
        <header class="flex min-w-0 shrink-0 items-center gap-[var(--space-2)]">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                {{ props.isProjectScope ? t("settings.panels.models.projectTitle") : t("settings.panels.models.globalTitle") }}
            </h2>
            <!-- 说明「这一页是什么、会写到哪里」属于元信息：按规范走 tooltip，不单独占一行 -->
            <Tooltip :text="props.isProjectScope
                ? t('settings.panels.models.projectDescription', {target: props.targetLabel || t('settings.panels.models.currentProject')})
                : t('settings.panels.models.globalDescription')">
                <button type="button" class="lab-info-button flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]" aria-label="这一页说明">
                    <span class="i-lucide-info h-3.5 w-3.5" aria-hidden="true"></span>
                </button>
            </Tooltip>
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

        <div v-if="props.loading" class="mt-[var(--space-5)] flex min-h-[200px] flex-col items-center justify-center gap-[var(--space-3)]">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]" aria-hidden="true"></span>
            <span class="text-[var(--text-sm)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.models.loading") }}</span>
        </div>

        <!-- Provider 双栏：窄容器退化为导轨在上、详情在下 -->
        <div v-else-if="!props.isProjectScope" class="model-provider-layout mt-[var(--space-5)] grid border-t border-[var(--divider)] pt-[var(--space-4)]">
            <ModelProviderRail
                class="pr-[var(--space-5)]"
                :providers="props.draft.providers"
                :active-key="props.activeProviderKey"
                :templates="props.providerTemplates"
                :selected-template="props.selectedTemplate"
                :disabled="props.saving"
                @select="emit('select-provider', $event)"
                @update:selected-template="emit('update:selectedTemplate', $event)"
                @add="emit('add-provider')"
            />
            <ModelProviderDetail
                class="pl-[var(--space-5)]"
                :provider="activeProvider"
                :model-api-options="props.modelApiOptions"
                :saved-model-groups="props.savedModelGroups"
                :disabled-models="props.disabledModels"
                :active-provider-checking-model-count="props.activeProviderCheckingModelCount"
                :checking-all-models="props.checkingAllModels"
                :discovering="discoveringActiveProvider"
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

        <!-- 草稿问题的完整列表；开关与会话状态由宿主持有。 -->
        <DialogWindow
            :model-value="props.validationDialogOpen"
            :title="t('settings.panels.models.validationIssuesTitle')"
            :width="680"
            height="70%"
            body-class="!overflow-hidden !p-0"
            @update:model-value="emit('update:validationDialogOpen', $event)"
        >
            <div class="h-full space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                <div v-for="(issue, index) in props.validationIssues" :key="`${issue.code}-${issue.path.join('.')}-${String(index)}`" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2.5">
                    <div class="flex flex-wrap items-center gap-2 text-xs">
                        <span class="rounded bg-[var(--status-warning-bg)] px-1.5 py-0.5 font-medium text-[var(--status-warning)]">{{ issue.code }}</span>
                        <span v-if="issue.modelKey" class="font-mono text-[var(--text-main)]">{{ issue.modelKey }}</span>
                    </div>
                    <p class="mt-1.5 text-sm text-[var(--text-main)]">{{ issue.message }}</p>
                    <p class="mt-1 break-all font-mono text-[11px] text-[var(--text-muted)]">{{ issue.path.join(".") }}</p>
                </div>
            </div>
        </DialogWindow>

        <!-- 删除 Provider 是不可逆确认：这里留在有遮罩的模态 Dialog，不做成浮动窗口。 -->
        <Dialog
            :model-value="props.deleteProviderDialogOpen"
            :title="t('settings.panels.models.deleteProviderTitle')"
            :show-cancel="true"
            :confirm-label="t('settings.panels.models.delete')"
            @update:model-value="emit('update:deleteProviderDialogOpen', $event)"
            @confirm="emit('confirm-delete-provider')"
        >
            <div v-if="activeProvider" class="space-y-3">
                <p class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.deleteProviderMessage", {name: activeProvider.name}) }}</p>
                <p class="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">{{ t("settings.panels.models.deleteProviderWarning") }}</p>
            </div>
        </Dialog>

        <ModelDiscoveryDialog
            v-if="activeProvider"
            :model-value="props.discoveryDialogOpen"
            :provider-name="activeProvider.name"
            :groups="props.discoveryGroups"
            :search-query="props.discoverySearchQuery"
            :discovering="discoveringActiveProvider"
            :expanded-groups="props.discoveryExpandedGroups"
            :diagnostics="props.discoveryDiagnostics"
            :manual-draft="props.discoveryManualDraft"
            :model-api-options="props.modelApiOptions"
            @update:model-value="emit('update:discoveryDialogOpen', $event)"
            @update:search-query="emit('update:discoverySearchQuery', $event)"
            @update-manual-field="(field, value) => emit('update:discoveryManualField', field, value)"
            @discover="emit('discover')"
            @toggle-group="emit('toggle-discovery-group', $event)"
            @toggle-model="emit('toggle-discovered-model', $event)"
            @add-manual="emit('add-manual-model')"
        />

        <ModelLibraryDialog
            v-if="activeProvider"
            :model-value="props.modelLibraryDialogOpen"
            :groups="props.modelLibraryGroups"
            :search-query="props.modelLibrarySearchQuery"
            :expanded-groups="props.modelLibraryExpandedGroups"
            :enabled-model-ids="props.enabledModelIds"
            @update:model-value="emit('update:modelLibraryDialogOpen', $event)"
            @update:search-query="emit('update:modelLibrarySearchQuery', $event)"
            @toggle-group="emit('toggle-model-library-group', $event)"
            @toggle-model="emit('toggle-library-model', $event)"
        />

        <NovelIdeModelEditDialog
            :model-value="props.modelEditDialogOpen"
            :editing-model="props.editingModel"
            :active-provider="activeProvider"
            :library-model="props.editingLibraryModel"
            :confirm-mode="props.editingTransientCandidate"
            :missing-fields="props.editingModelMissingFields"
            :model-api-options="props.modelApiOptions"
            @update:model-value="emit('update:modelEditDialogOpen', $event)"
            @model-id-change="emit('model-id-change')"
            @toggle-model-input="(model, inputKind) => emit('toggle-model-input', model, inputKind)"
            @reset-model-input="emit('reset-model-input', $event)"
            @reset-model-cost="emit('reset-model-cost', $event)"
            @enable-model-cost="emit('enable-model-cost', $event)"
            @reapply-library="emit('reapply-library', $event)"
            @confirm="emit('confirm-model-edit')"
        />
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

/* 两列之间的竖线：与外壳、Agent Profile 同款——1px --divider，两端留边距，
   落在两列各自留白的正中间。窄容器退化为单列时去掉（那里没有分栏）。 */
.model-provider-layout :deep(.model-provider-rail) {
    position: relative;
}

.model-provider-layout :deep(.model-provider-rail)::after {
    content: "";
    position: absolute;
    top: var(--space-4);
    right: 0;
    bottom: var(--space-4);
    width: var(--border-w);
    background: var(--divider);
}

@container (max-width: 699px) {
    .model-provider-layout :deep(.model-provider-rail)::after {
        display: none;
    }
}
</style>
