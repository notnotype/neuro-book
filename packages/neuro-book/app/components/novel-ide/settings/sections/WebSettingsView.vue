<script setup lang="ts">
import {computed, useId} from "vue";
import {Badge, Button, FormInput, FormSelect, IconButton, Switch} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";
import {
    SEARCH_PROVIDER_KEYS,
    canMoveProvider,
    moveProvider,
    normalizeProviderOrder,
    type SearchProviderKey,
    type WebBraveDraft,
    type WebSettingsDraft,
} from "./web/web-settings-draft";

const props = withDefaults(defineProps<{
    /** 受控草稿；视图只改草稿并通过 update:modelValue 交回宿主 */
    modelValue: WebSettingsDraft;
    disabled?: boolean;
    saving?: boolean;
    saveError?: string;
}>(), {
    disabled: false,
    saving: false,
    saveError: "",
});

const emit = defineEmits<{
    (event: "update:modelValue", value: WebSettingsDraft): void;
}>();

const {t} = useI18n();
const idPrefix = `web-settings-${useId()}`;

const providerLabels: Record<SearchProviderKey, string> = {tavily: "Tavily", brave: "Brave Search"};
const providerDescriptions: Record<SearchProviderKey, string> = {
    tavily: t("settings.panels.web.tavilyProviderDescription"),
    brave: t("settings.panels.web.braveProviderDescription"),
};
const providerIconClasses: Record<SearchProviderKey, string> = {
    tavily: "i-lucide-sparkles",
    brave: "i-lucide-search",
};

const order = computed(() => normalizeProviderOrder(props.modelValue.order));
const providerOptions = computed<FormSelectOption[]>(() => [
    {value: "tavily", label: "Tavily", description: t("settings.panels.web.tavilyDescription")},
    {value: "brave", label: "Brave Search", description: t("settings.panels.web.braveDescription")},
]);
const fallbackHint = computed(() => `Fallback: ${order.value.map((key) => providerLabels[key]).join(" -> ")}`);

function patch(patchValue: Partial<WebSettingsDraft>): void {
    emit("update:modelValue", {...props.modelValue, ...patchValue});
}

function patchProvider(providerKey: SearchProviderKey, patchValue: Partial<WebBraveDraft>): void {
    patch({[providerKey]: {...props.modelValue[providerKey], ...patchValue}} as Partial<WebSettingsDraft>);
}

/** 默认搜索服务即优先级第一位；选其它 provider 时把它提到最前。 */
function selectDefaultProvider(value: string): void {
    if (value !== "tavily" && value !== "brave") {
        return;
    }
    patch({order: [value, ...order.value.filter((key) => key !== value)]});
}

function shiftProvider(providerKey: SearchProviderKey, direction: -1 | 1): void {
    patch({order: moveProvider(props.modelValue.order, providerKey, direction)});
}

/** 清空 provider 密钥：三处状态一起改，宿主据此写出空串。 */
function clearProviderApiKey(providerKey: SearchProviderKey): void {
    patchProvider(providerKey, {apiKey: "", apiKeyConfigured: false, apiKeyMaskedValue: null, apiKeyCleared: true});
}

function providerApiKeyPlaceholder(providerKey: SearchProviderKey): string {
    const provider = props.modelValue[providerKey];
    if (provider.apiKeyConfigured) {
        return provider.apiKeyMaskedValue ?? t("settings.panels.web.apiKeyConfigured");
    }
    return t("settings.panels.web.notConfigured");
}
</script>

<template>
    <div class="web-view-root flex min-w-0 flex-col" data-lab-subject>
        <header class="shrink-0">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.web.title") }}</h2>
            <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.description") }}</p>
        </header>

        <p v-if="props.saveError" class="mt-[var(--space-3)] truncate text-[var(--text-xs)] text-[var(--status-danger)]">
            {{ t("settings.panels.web.saveFailed") + "：" + props.saveError }}
        </p>
        <p v-else-if="props.saving" class="mt-[var(--space-3)] flex items-center gap-[var(--space-1)] text-[var(--text-xs)] text-[var(--status-info)]">
            <span class="i-lucide-loader-2 h-3 w-3 animate-spin" aria-hidden="true"></span>
            {{ t("common.saving") }}
        </p>

        <!-- 搜索服务 -->
        <section class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.web.searchProvider") }}</h3>
            <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.searchProviderDescription") }}</p>

            <div class="mt-[var(--space-3)] max-w-[260px]">
                <label :for="`${idPrefix}-default-provider`" class="block text-[var(--text-2xs)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.defaultSearchProvider") }}</label>
                <FormSelect
                    :id="`${idPrefix}-default-provider`"
                    class="mt-[var(--space-1)]"
                    :model-value="order[0] ?? 'tavily'"
                    :options="providerOptions"
                    :disabled="props.disabled"
                    @update:model-value="selectDefaultProvider"
                />
                <p class="mt-[var(--space-1)] truncate text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ fallbackHint }}</p>
            </div>

            <div class="mt-[var(--space-3)] flex flex-col gap-[var(--space-3)]">
                <article
                    v-for="providerKey in SEARCH_PROVIDER_KEYS"
                    :key="providerKey"
                    class="border-t border-[var(--divider)] pt-[var(--space-3)]"
                >
                    <div class="flex items-start justify-between gap-[var(--space-3)]">
                        <div class="flex min-w-0 items-start gap-[var(--space-2)]">
                            <span class="mt-[var(--space-1)] h-4 w-4 shrink-0 text-[var(--text-secondary)]" :class="providerIconClasses[providerKey]" aria-hidden="true"></span>
                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-[var(--space-2)]">
                                    <h4 class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ providerLabels[providerKey] }}</h4>
                                    <Badge
                                        size="sm"
                                        variant="soft"
                                        :tone="props.modelValue[providerKey].apiKeyConfigured ? 'success' : 'neutral'"
                                    >{{ props.modelValue[providerKey].apiKeyConfigured ? t("settings.panels.web.keyConfigured") : t("settings.panels.web.noKey") }}</Badge>
                                </div>
                                <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ providerDescriptions[providerKey] }}</p>
                            </div>
                        </div>

                        <div class="flex shrink-0 items-center gap-[var(--space-1)]">
                            <IconButton
                                size="sm"
                                icon-class="i-lucide-arrow-up"
                                :title="t('settings.panels.web.moveUp')"
                                :aria-label="t('settings.panels.web.moveUp')"
                                :disabled="props.disabled || !canMoveProvider(props.modelValue.order, providerKey, -1)"
                                @click="shiftProvider(providerKey, -1)"
                            />
                            <IconButton
                                size="sm"
                                icon-class="i-lucide-arrow-down"
                                :title="t('settings.panels.web.moveDown')"
                                :aria-label="t('settings.panels.web.moveDown')"
                                :disabled="props.disabled || !canMoveProvider(props.modelValue.order, providerKey, 1)"
                                @click="shiftProvider(providerKey, 1)"
                            />
                            <Switch
                                :model-value="props.modelValue[providerKey].enabled"
                                :disabled="props.disabled"
                                :aria-label="providerLabels[providerKey]"
                                @update:model-value="patchProvider(providerKey, {enabled: $event})"
                            />
                        </div>
                    </div>

                    <div class="web-grid mt-[var(--space-3)] grid gap-[var(--space-3)]">
                        <label class="block min-w-0 web-span">
                            <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.apiKey") }}</span>
                            <span class="mt-[var(--space-2)] flex gap-[var(--space-2)]">
                                <FormInput
                                    class="min-w-0 flex-1"
                                    type="password"
                                    :model-value="props.modelValue[providerKey].apiKey"
                                    :placeholder="providerApiKeyPlaceholder(providerKey)"
                                    :disabled="props.disabled"
                                    @update:model-value="patchProvider(providerKey, {apiKey: $event, apiKeyCleared: false})"
                                />
                                <Button
                                    size="sm"
                                    variant="danger"
                                    class="shrink-0"
                                    :disabled="props.disabled"
                                    @click="clearProviderApiKey(providerKey)"
                                >
                                    <span class="i-lucide-trash-2 mr-1 h-3.5 w-3.5" aria-hidden="true"></span>
                                    {{ t("settings.panels.web.clear") }}
                                </Button>
                            </span>
                        </label>
                        <label class="block min-w-0">
                            <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.timeoutMs") }}</span>
                            <FormInput
                                class="mt-[var(--space-2)]"
                                type="number"
                                inputmode="numeric"
                                min="1000"
                                step="1000"
                                placeholder="15000"
                                :model-value="props.modelValue[providerKey].timeoutMs"
                                :disabled="props.disabled"
                                @update:model-value="patchProvider(providerKey, {timeoutMs: $event})"
                            />
                        </label>
                        <template v-if="providerKey === 'brave'">
                            <label class="block min-w-0">
                                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.country") }}</span>
                                <FormInput
                                    class="mt-[var(--space-2)]"
                                    placeholder="US"
                                    :model-value="props.modelValue.brave.country"
                                    :disabled="props.disabled"
                                    @update:model-value="patchProvider('brave', {country: $event})"
                                />
                            </label>
                            <label class="block min-w-0">
                                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.searchLang") }}</span>
                                <FormInput
                                    class="mt-[var(--space-2)]"
                                    placeholder="en"
                                    :model-value="props.modelValue.brave.searchLang"
                                    :disabled="props.disabled"
                                    @update:model-value="patchProvider('brave', {searchLang: $event})"
                                />
                            </label>
                        </template>
                    </div>
                </article>
            </div>
        </section>

        <!-- 本地抓取 -->
        <section class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="flex items-start justify-between gap-[var(--space-3)]">
                <div class="min-w-0">
                    <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.web.localFetch") }}</h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.localFirstDescription") }}</p>
                </div>
                <Switch
                    :model-value="props.modelValue.localFetch.enabled"
                    :disabled="props.disabled"
                    :aria-label="t('settings.panels.web.localFirst')"
                    class="mt-[var(--space-1)] shrink-0"
                    @update:model-value="patch({localFetch: {...props.modelValue.localFetch, enabled: $event}})"
                />
            </div>

            <div class="web-grid mt-[var(--space-3)] grid gap-[var(--space-3)]">
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.timeoutMs") }}</span>
                    <FormInput class="mt-[var(--space-2)]" type="number" inputmode="numeric" min="1000" step="1000" :model-value="props.modelValue.localFetch.timeoutMs" :disabled="props.disabled" @update:model-value="patch({localFetch: {...props.modelValue.localFetch, timeoutMs: $event}})" />
                </label>
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.maxRedirects") }}</span>
                    <FormInput class="mt-[var(--space-2)]" type="number" inputmode="numeric" min="0" step="1" :model-value="props.modelValue.localFetch.maxRedirects" :disabled="props.disabled" @update:model-value="patch({localFetch: {...props.modelValue.localFetch, maxRedirects: $event}})" />
                </label>
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.maxBytes") }}</span>
                    <FormInput class="mt-[var(--space-2)]" type="number" inputmode="numeric" min="1024" step="1024" :model-value="props.modelValue.localFetch.maxBytes" :disabled="props.disabled" @update:model-value="patch({localFetch: {...props.modelValue.localFetch, maxBytes: $event}})" />
                </label>
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.maxCharacters") }}</span>
                    <FormInput class="mt-[var(--space-2)]" type="number" inputmode="numeric" min="1000" step="1000" :model-value="props.modelValue.localFetch.maxCharacters" :disabled="props.disabled" @update:model-value="patch({localFetch: {...props.modelValue.localFetch, maxCharacters: $event}})" />
                </label>
                <label class="block min-w-0">
                    <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.fallbackThreshold") }}</span>
                    <FormInput class="mt-[var(--space-2)]" type="number" inputmode="numeric" min="0" step="100" :model-value="props.modelValue.localFetch.minCharactersForLocal" :disabled="props.disabled" @update:model-value="patch({localFetch: {...props.modelValue.localFetch, minCharactersForLocal: $event}})" />
                </label>
            </div>
        </section>

        <!-- Tavily 兜底 -->
        <section class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="flex items-start justify-between gap-[var(--space-3)]">
                <div class="min-w-0">
                    <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.web.tavilyFallback") }}</h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.tavilyFallbackDescription") }}</p>
                </div>
                <Switch
                    :model-value="props.modelValue.tavilyFallback.enabled"
                    :disabled="props.disabled"
                    :aria-label="t('settings.panels.web.tavilyFallback')"
                    class="mt-[var(--space-1)] shrink-0"
                    @update:model-value="patch({tavilyFallback: {...props.modelValue.tavilyFallback, enabled: $event}})"
                />
            </div>
            <label class="mt-[var(--space-3)] block max-w-[220px]">
                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.fallbackTimeoutMs") }}</span>
                <FormInput class="mt-[var(--space-2)]" type="number" inputmode="numeric" min="1000" step="1000" placeholder="20000" :model-value="props.modelValue.tavilyFallback.timeoutMs" :disabled="props.disabled" @update:model-value="patch({tavilyFallback: {...props.modelValue.tavilyFallback, timeoutMs: $event}})" />
            </label>
        </section>
    </div>
</template>

<style scoped>
.web-view-root {
    container-type: inline-size;
}

/* 短字段并排由视图自身容器宽度决定，不看窗口宽度。 */
@container (min-width: 620px) {
    .web-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .web-grid .web-span {
        grid-column: span 2;
    }
}
</style>
