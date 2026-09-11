<script setup lang="ts">
import {computed, useId} from "vue";
import {Button, FormInput, FormSelect, FormTextarea, Switch} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";
import {
    DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS,
    DEFAULT_GLOBAL_EMBEDDING_MODEL,
    DEFAULT_GLOBAL_EMBEDDING_TIMEOUT_MS,
    createGlobalEmbeddingDraft,
    createProjectEmbeddingDraft,
    type EmbeddingSettingsDraft,
} from "./embedding-settings-draft";

const props = withDefaults(defineProps<{
    /** 受控草稿；global 与 project 两段都放在这里，视图按 scope 渲染其中一段 */
    modelValue: EmbeddingSettingsDraft;
    scope?: "global" | "project";
    /** 项目作用域下的配置目标标签 */
    targetLabel?: string;
    disabled?: boolean;
}>(), {
    scope: "global",
    targetLabel: "",
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:modelValue", value: EmbeddingSettingsDraft): void;
}>();

const {t} = useI18n();
const enabledId = `embedding-enabled-${useId()}`;

const isProjectScope = computed(() => props.scope === "project");
const displayTargetLabel = computed(() => props.targetLabel || t("settings.panels.embedding.currentProject"));

const providerOptions: FormSelectOption[] = [
    {value: "openai-compatible", label: "OpenAI Compatible", description: "POST /embeddings"},
];

function patchGlobal(patch: Partial<EmbeddingSettingsDraft["global"]>): void {
    emit("update:modelValue", {...props.modelValue, global: {...props.modelValue.global, ...patch}});
}

function patchProject(patch: Partial<EmbeddingSettingsDraft["project"]>): void {
    emit("update:modelValue", {...props.modelValue, project: {...props.modelValue.project, ...patch}});
}

/** 清空密钥：三处状态一起改，宿主据此写出空串。 */
function clearApiKey(): void {
    patchGlobal({apiKey: "", apiKeyConfigured: false, apiKeyMaskedValue: null, apiKeyCleared: true});
}

const apiKeyPlaceholder = computed(() => {
    if (props.modelValue.global.apiKeyConfigured) {
        return props.modelValue.global.apiKeyMaskedValue ?? t("settings.panels.embedding.apiKeyConfigured");
    }
    return "sk-...";
});
</script>

<template>
    <div class="embedding-view-root flex min-w-0 flex-col" data-lab-subject>
        <header class="shrink-0">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                {{ isProjectScope ? t("settings.panels.embedding.projectTitle") : t("settings.panels.embedding.globalTitle") }}
            </h2>
            <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">
                {{ isProjectScope ? t("settings.panels.embedding.projectDescription", {target: displayTargetLabel}) : t("settings.panels.embedding.globalDescription") }}
            </p>
        </header>


        <!-- 项目作用域：只覆盖模型与维度，服务参数继承全局 -->
        <template v-if="isProjectScope">
            <div class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
                <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.embedding.projectOverride") }}</h3>
                <div class="embedding-grid mt-[var(--space-3)] grid gap-[var(--space-3)]">
                    <label class="block min-w-0">
                        <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.embedding.model") }}</span>
                        <FormInput
                            class="mt-[var(--space-2)]"
                            :model-value="props.modelValue.project.model"
                            :placeholder="t('settings.panels.embedding.inheritGlobal')"
                            :disabled="props.disabled"
                            @update:model-value="patchProject({model: $event})"
                        />
                    </label>
                    <label class="block min-w-0">
                        <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.embedding.dimensions") }}</span>
                        <FormInput
                            class="mt-[var(--space-2)]"
                            type="number"
                            inputmode="numeric"
                            min="1"
                            step="1"
                            :model-value="props.modelValue.project.dimensions"
                            :placeholder="t('settings.panels.embedding.inheritGlobal')"
                            :disabled="props.disabled"
                            @update:model-value="patchProject({dimensions: $event})"
                        />
                    </label>
                </div>
                <p class="mt-[var(--space-3)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.panels.embedding.projectServiceNote") }}</p>
            </div>
        </template>

        <!-- 全局作用域：整段服务配置 -->
        <template v-else>
            <div class="mt-[var(--space-4)] flex items-start justify-between gap-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
                <div class="min-w-0">
                    <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.embedding.serviceConfig") }}</h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">
                        {{ props.modelValue.global.enabled ? t("settings.panels.embedding.enabled") : t("settings.panels.embedding.disabled") }}
                    </p>
                </div>
                <Switch
                    :id="enabledId"
                    :model-value="props.modelValue.global.enabled"
                    :disabled="props.disabled"
                    :aria-label="t('settings.panels.embedding.serviceConfig')"
                    class="mt-[var(--space-1)] shrink-0"
                    @update:model-value="patchGlobal({enabled: $event})"
                />
            </div>

            <div class="embedding-grid mt-[var(--space-3)] grid gap-[var(--space-3)]">
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">Provider</span>
                    <FormSelect
                        class="mt-[var(--space-2)]"
                        :model-value="props.modelValue.global.provider"
                        :options="providerOptions"
                        :disabled="props.disabled"
                        @update:model-value="patchGlobal({provider: 'openai-compatible'})"
                    />
                </label>
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.embedding.model") }}</span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        :model-value="props.modelValue.global.model"
                        :placeholder="DEFAULT_GLOBAL_EMBEDDING_MODEL"
                        :disabled="props.disabled"
                        @update:model-value="patchGlobal({model: $event})"
                    />
                </label>
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.embedding.dimensions") }}</span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        type="number"
                        inputmode="numeric"
                        min="1"
                        step="1"
                        :model-value="props.modelValue.global.dimensions"
                        :placeholder="String(DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS)"
                        :disabled="props.disabled"
                        @update:model-value="patchGlobal({dimensions: $event})"
                    />
                </label>
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">Timeout ms</span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        type="number"
                        inputmode="numeric"
                        min="1000"
                        step="1000"
                        :model-value="props.modelValue.global.timeoutMs"
                        :placeholder="String(DEFAULT_GLOBAL_EMBEDDING_TIMEOUT_MS)"
                        :disabled="props.disabled"
                        @update:model-value="patchGlobal({timeoutMs: $event})"
                    />
                </label>
                <label class="block min-w-0 embedding-span">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.embedding.baseUrl") }}</span>
                    <FormInput
                        class="mt-[var(--space-2)]"
                        :model-value="props.modelValue.global.baseURL"
                        placeholder="https://api.openai.com/v1"
                        :disabled="props.disabled"
                        @update:model-value="patchGlobal({baseURL: $event})"
                    />
                </label>
                <label class="block min-w-0 embedding-span">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.embedding.apiKey") }}</span>
                    <span class="mt-[var(--space-2)] flex gap-[var(--space-2)]">
                        <FormInput
                            class="min-w-0 flex-1"
                            type="password"
                            :model-value="props.modelValue.global.apiKey"
                            :placeholder="apiKeyPlaceholder"
                            :disabled="props.disabled"
                            @update:model-value="patchGlobal({apiKey: $event, apiKeyCleared: false})"
                        />
                        <Button
                            size="sm"
                            variant="danger"
                            class="shrink-0"
                            :disabled="props.disabled"
                            @click="clearApiKey"
                        >
                            <span class="i-lucide-trash-2 mr-1 h-3.5 w-3.5" aria-hidden="true"></span>
                            {{ t("settings.panels.embedding.clear") }}
                        </Button>
                    </span>
                </label>
                <label class="block min-w-0 embedding-span">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.embedding.requestOptionsJson") }}</span>
                    <FormTextarea
                        class="mt-[var(--space-2)] font-mono"
                        :rows="5"
                        placeholder="{&quot;encoding_format&quot;:&quot;float&quot;}"
                        :model-value="props.modelValue.global.requestOptions"
                        :disabled="props.disabled"
                        @update:model-value="patchGlobal({requestOptions: $event})"
                    />
                </label>
            </div>
        </template>
    </div>
</template>

<style scoped>
.embedding-view-root {
    container-type: inline-size;
}

/* 短字段并排：按自身容器宽度决定，而不是窗口宽度。 */
@container (min-width: 620px) {
    .embedding-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .embedding-grid .embedding-span {
        grid-column: span 2;
    }
}
</style>
