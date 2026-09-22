<script setup lang="ts">
import {computed} from "vue";
import {Badge, Button, FormInput, FormSelect, FormTextarea, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import SavedModelsList from "./SavedModelsList.vue";
import type {ModelSettingsModelDraft, ModelSettingsProviderDraft} from "../provider-settings-draft";
import type {ModelApiOption, SavedModelGroupView} from "../provider-view-types";

const props = withDefaults(defineProps<{
    /** 当前选中 Provider；null 渲染未选中空态 */
    provider: ModelSettingsProviderDraft | null;
    modelApiOptions: ModelApiOption[];
    savedModelGroups: SavedModelGroupView[];
    disabledModels: ModelSettingsModelDraft[];
    activeProviderCheckingModelCount: number;
    checkingAllModels: boolean;
    /** 当前 Provider 正在发现模型 */
    discovering: boolean;
    expandedGroups: Record<string, boolean>;
    maxRetriesPlaceholder: number;
    saving?: boolean;
}>(), {
    saving: false,
});

const emit = defineEmits<{
    (event: "update:provider", value: ModelSettingsProviderDraft): void;
    (event: "toggle-enabled"): void;
    (event: "rename-provider-id", nextId: string): void;
    (event: "clone-connection"): void;
    (event: "request-delete"): void;
    (event: "clear-api-key"): void;
    (event: "discover-models"): void;
    (event: "check-model", model: ModelSettingsModelDraft): void;
    (event: "cancel-model-check", model: ModelSettingsModelDraft): void;
    (event: "check-all-models"): void;
    (event: "cancel-model-checks"): void;
    (event: "edit-model", model: ModelSettingsModelDraft): void;
    (event: "disable-model", model: ModelSettingsModelDraft): void;
    (event: "delete-model", model: ModelSettingsModelDraft): void;
    (event: "open-discovery"): void;
    (event: "open-library"): void;
    (event: "toggle-group", group: string): void;
}>();

const {t} = useI18n();

/** 已保存 Provider 的身份字段（id / baseURL / proxy）在本页只读，改动只能来自配置文件。 */
const isSavedProvider = computed(() => props.provider?.sourceIndex !== undefined);
const enabledModelCount = computed(() => props.provider?.models.filter((model) => model.enabled).length ?? 0);
const apiKeyPlaceholder = computed(() => {
    const options = props.provider?.options;
    if (!options?.apiKeyConfigured) {
        return "sk-...";
    }
    return t("settings.panels.models.configuredApiKeyPlaceholder", {value: options.apiKeyMaskedValue ?? ""});
});

/** 字段改动一律生成新 Provider 草稿交回宿主，不就地改 props。 */
function patchProvider(patch: Partial<ModelSettingsProviderDraft>): void {
    if (!props.provider) {
        return;
    }
    emit("update:provider", {...props.provider, ...patch});
}

function patchOptions(patch: Partial<ModelSettingsProviderDraft["options"]>): void {
    if (!props.provider) {
        return;
    }
    emit("update:provider", {...props.provider, options: {...props.provider.options, ...patch}});
}
</script>

<template>
    <div class="model-provider-detail custom-scrollbar min-h-0 min-w-0 overflow-y-auto px-[var(--space-6)] pb-[var(--space-6)] pt-[var(--space-6)]">
    <section v-if="props.provider" class="flex min-w-0 flex-col">
        <!--
          身份行：左边是谁（名称 + 稳定 id + 启用状态），右边是这一页能做的动作。
          破坏性动作降级成图标按钮，主操作（查询可用模型）保留文字，避免一行四个同级按钮。
        -->
        <header class="flex min-w-0 flex-wrap items-center justify-between gap-[var(--space-3)] pb-[var(--space-1)]">
            <div class="flex min-w-0 items-center gap-[var(--space-2)]">
                <span class="truncate text-[var(--text-sm)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ props.provider.name || props.provider.id }}</span>
                <span class="shrink-0 font-mono text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ props.provider.id }}</span>
                <Badge v-if="!props.provider.enabled" class="shrink-0" variant="soft" tone="warning">{{ t("settings.panels.models.providerDisabledBadge") }}</Badge>
            </div>

            <div class="flex shrink-0 items-center gap-[var(--space-1)]">
                <Button size="sm" variant="secondary" :disabled="props.discovering || props.saving" @click="emit('discover-models')">
                    <span class="mr-1 h-3.5 w-3.5" :class="props.discovering ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-cloud-lightning'" aria-hidden="true"></span>
                    {{ props.discovering ? t("settings.panels.models.discovering") : t("settings.panels.models.discoverModels") }}
                </Button>

                <Tooltip :text="props.provider.enabled ? t('settings.panels.models.disableProvider') : t('settings.panels.models.enableProvider')">
                    <IconButton
                        size="sm"
                        :disabled="props.saving"
                        :title="props.provider.enabled ? t('settings.panels.models.disableProvider') : t('settings.panels.models.enableProvider')"
                        @click="emit('toggle-enabled')"
                    >
                        <span class="h-4 w-4" :class="props.provider.enabled ? 'i-lucide-power-off' : 'i-lucide-power'" aria-hidden="true"></span>
                    </IconButton>
                </Tooltip>

                <Tooltip v-if="isSavedProvider" :text="t('settings.panels.models.cloneProvider')">
                    <IconButton
                        size="sm"
                        :disabled="props.saving"
                        :title="t('settings.panels.models.cloneProvider')"
                        @click="emit('clone-connection')"
                    >
                        <span class="i-lucide-copy-plus h-4 w-4" aria-hidden="true"></span>
                    </IconButton>
                </Tooltip>

                <Tooltip :text="t('settings.panels.models.delete')">
                    <IconButton
                        size="sm"
                        variant="danger"
                        :disabled="props.saving"
                        :title="t('settings.panels.models.delete')"
                        @click="emit('request-delete')"
                    >
                        <span class="i-lucide-trash-2 h-4 w-4" aria-hidden="true"></span>
                    </IconButton>
                </Tooltip>
            </div>
        </header>

        <!-- 连接：身份与连接参数。已保存 Provider 的这三个字段只读，改动只能来自配置文件。 -->
        <section class="mt-[var(--space-6)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.models.connectionGroup") }}</h3>
            <p v-if="isSavedProvider" class="mt-[var(--space-1)] text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.panels.models.providerIdentityHint") }}</p>

            <div class="provider-form-grid mt-[var(--space-4)] grid gap-x-[var(--space-3)] gap-y-[var(--space-4)]">
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.models.providerId") }}</span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        size="sm"
                        :model-value="props.provider.id"
                        :readonly="isSavedProvider"
                        :placeholder="t('settings.panels.models.providerIdPlaceholder')"
                        :disabled="props.saving"
                        @update:model-value="emit('rename-provider-id', $event)"
                    />
                </label>

                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.models.providerName") }}</span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        size="sm"
                        :model-value="props.provider.name"
                        :placeholder="t('settings.panels.models.providerNamePlaceholder')"
                        :disabled="props.saving"
                        @update:model-value="patchProvider({name: $event})"
                    />
                </label>

                <label class="provider-field-span block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">API Base</span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        size="sm"
                        :model-value="props.provider.options.baseURL"
                        :readonly="isSavedProvider"
                        :placeholder="t('settings.panels.models.apiBasePlaceholder')"
                        :disabled="props.saving"
                        @update:model-value="patchOptions({baseURL: $event})"
                    />
                </label>

                <label class="provider-field-span block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.models.proxy") }}</span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        size="sm"
                        :model-value="props.provider.options.proxy"
                        :readonly="isSavedProvider"
                        placeholder="http://127.0.0.1:7890"
                        :disabled="props.saving"
                        @update:model-value="patchOptions({proxy: $event})"
                    />
                </label>
            </div>
        </section>

        <!-- 协议与鉴权：接口格式决定「怎么说话」，密钥决定「以谁的身份说」。 -->
        <section class="mt-[var(--space-6)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.models.protocolGroup") }}</h3>

            <div class="provider-form-grid mt-[var(--space-4)] grid gap-x-[var(--space-3)] gap-y-[var(--space-4)]">
                <label class="provider-field-span block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">
                        {{ t("settings.panels.models.providerModelApi") }}<span class="text-[var(--status-danger)]" aria-hidden="true"> *</span>
                    </span>
                    <FormSelect
                        class="mt-[var(--space-2)]"
                        size="sm"
                        required
                        :model-value="props.provider.modelApi"
                        :options="props.modelApiOptions"
                        :placeholder="t('settings.panels.models.apiFormat')"
                        :disabled="props.saving"
                        @update:model-value="patchProvider({modelApi: $event})"
                    />
                    <span class="mt-[var(--space-1)] block text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.panels.models.providerModelApiHint") }}</span>
                </label>

                <label class="provider-field-span block min-w-0">
                    <span class="flex items-center justify-between gap-[var(--space-3)]">
                        <span class="text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">API Key</span>
                        <button
                            v-if="props.provider.options.apiKeyConfigured"
                            type="button"
                            class="text-[var(--text-2xs)] text-[var(--status-danger)] transition-colors hover:opacity-80"
                            :disabled="props.saving"
                            @click.prevent="emit('clear-api-key')"
                        >
                            {{ t("settings.panels.models.clearApiKey") }}
                        </button>
                    </span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        size="sm"
                        type="password"
                        :model-value="props.provider.options.apiKey"
                        :placeholder="apiKeyPlaceholder"
                        :disabled="props.saving"
                        @update:model-value="patchOptions({apiKey: $event})"
                    />
                </label>
            </div>
        </section>

        <!-- 请求参数：只影响这一家服务的调用方式，与身份无关。 -->
        <section class="mt-[var(--space-6)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.models.requestGroup") }}</h3>

            <div class="provider-form-grid mt-[var(--space-4)] grid gap-x-[var(--space-3)] gap-y-[var(--space-4)]">
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.models.requestTimeout") }}</span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        size="sm"
                        type="number"
                        inputmode="numeric"
                        :model-value="props.provider.options.timeoutMs"
                        :placeholder="t('settings.panels.models.defaultTimeout')"
                        :disabled="props.saving"
                        @update:model-value="patchOptions({timeoutMs: $event})"
                    />
                </label>

                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.models.maxRetries") }}</span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        size="sm"
                        type="number"
                        inputmode="numeric"
                        min="0"
                        step="1"
                        :model-value="props.provider.options.maxRetries"
                        :placeholder="t('settings.panels.models.defaultMaxRetries', {value: props.maxRetriesPlaceholder})"
                        :disabled="props.saving"
                        @update:model-value="patchOptions({maxRetries: $event})"
                    />
                </label>

                <label class="provider-field-span block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.models.requestOptions") }}</span>
                    <FormTextarea
                        class="mt-[var(--space-2)] font-mono"
                        :rows="4"
                        placeholder="{&quot;temperature&quot;:0.7}"
                        :model-value="props.provider.options.requestOptions"
                        :disabled="props.saving"
                        @update:model-value="patchOptions({requestOptions: $event})"
                    />
                </label>
            </div>
        </section>

        <div class="mt-[var(--space-5)]">
            <SavedModelsList
                :provider="props.provider"
                :groups="props.savedModelGroups"
                :disabled-models="props.disabledModels"
                :enabled-count="enabledModelCount"
                :checking-count="props.activeProviderCheckingModelCount"
                :checking-all="props.checkingAllModels"
                :expanded-groups="props.expandedGroups"
                @toggle-group="emit('toggle-group', $event)"
                @check-all="emit('check-all-models')"
                @cancel-checks="emit('cancel-model-checks')"
                @check-model="emit('check-model', $event)"
                @cancel-model-check="emit('cancel-model-check', $event)"
                @edit-model="emit('edit-model', $event)"
                @disable-model="emit('disable-model', $event)"
                @delete-model="emit('delete-model', $event)"
                @open-discovery="emit('open-discovery')"
                @open-library="emit('open-library')"
            />
        </div>
    </section>

    <section v-else class="flex min-h-[240px] flex-col items-center justify-center gap-[var(--space-3)] text-center">
        <span class="i-lucide-server-off h-8 w-8 text-[var(--text-muted)] opacity-50" aria-hidden="true"></span>
        <div>
            <div class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.models.noProviderSelected") }}</div>
            <div class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.models.selectProviderHint") }}</div>
        </div>
    </section>
    </div>
</template>

<style scoped>
/* 短字段并排由视图自身容器宽度决定，不看窗口宽度。 */
@container (min-width: 620px) {
    .provider-form-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .provider-form-grid .provider-field-span {
        grid-column: span 2;
    }
}
</style>
