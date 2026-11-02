<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Button, Checkbox, Dialog, Input, Select} from "@notnotype/nb-ui/components";
import {hitCounts, orderCatalog, orderProviders, providerSelectable, searchCatalog, type CatalogHit, type CatalogModelView, type CatalogProviderView} from "../../model-catalog";
import type {AgentLocale} from "../../types";
import {provideAgentText} from "../text";

const props = defineProps<{
    open: boolean;
    providers: readonly CatalogProviderView[];
    chosen: readonly string[];
    /** 没有宿主注入翻译端口时的界面语言，缺省 zh-CN；有注入时以端口为准（见 `../text.ts`）。 */
    locale?: AgentLocale;
}>();

const emit = defineEmits<{
    (e: "update:open", open: boolean): void;
    (e: "pick", refs: string[]): void;
    (e: "add-provider"): void;
}>();

defineOptions({inheritAttrs: false});

const {t} = provideAgentText(() => props.locale);

/** 一次最多画这么多行：OpenRouter 一家就有五百多个模型，全画出来表格会卡。 */
const ROW_LIMIT = 200;
/** “全部”在左栏与窄屏下拉里的值：nb-ui 的 Select 不收空串；服务商 id 里没有 `*`。 */
const ALL = "*";

const query = ref("");
const active = ref(ALL);
const picked = ref<string[]>([]);

// 每次打开都从空的开始：上一次的勾选与查询属于上一次。
watch(() => props.open, (open) => {
    if (open) {
        query.value = "";
        active.value = ALL;
        picked.value = [];
    }
});

const ordered = computed(() => orderProviders(props.providers));
// 服务商换了（例如从这里去加了自定义服务商再回来）而选中的那家已不在时，回到“全部”。
watch(() => props.providers, (providers) => {
    if (active.value !== ALL && !providers.some((provider) => provider.id === active.value)) active.value = ALL;
});
const activeProvider = computed(() => props.providers.find((provider) => provider.id === active.value) ?? null);
const chosenSet = computed(() => new Set(props.chosen));
const searching = computed(() => query.value.trim() !== "");
// 排序只随服务商数据重算，每次按键只做匹配。
const sorted = computed(() => orderCatalog(props.providers));
const hits = computed(() => searchCatalog(sorted.value, query.value));
const counts = computed(() => hitCounts(hits.value));
const shown = computed<CatalogHit[]>(() => (activeProvider.value === null ? hits.value : hits.value.filter((hit) => hit.provider.id === activeProvider.value!.id)));
const visible = computed(() => shown.value.slice(0, ROW_LIMIT));
/** 说明页：选中的服务商用不了且没在搜索时。 */
const lockedPage = computed(() => (activeProvider.value !== null && !providerSelectable(activeProvider.value) && !searching.value ? activeProvider.value : null));
const showProviderColumn = computed(() => activeProvider.value === null);

function envList(provider: CatalogProviderView): string {
    return provider.keyEnvs.join(t("catalog.envJoin"));
}

function keyText(provider: CatalogProviderView): string {
    if (provider.access === "unsupported") return t("catalog.locked.unsupported");
    if (provider.access === "login" && !provider.keySet) return provider.keyEnvs.length > 0 ? t("catalog.locked.loginEnv", {envs: envList(provider)}) : t("catalog.locked.login");
    if (provider.keyEnvs.length === 0) return t("catalog.key.none");
    return provider.keySet ? t("catalog.key.set", {envs: envList(provider)}) : t("catalog.key.missing", {envs: envList(provider)});
}

function dotOf(provider: CatalogProviderView): "ok" | "warn" | "off" {
    if (!providerSelectable(provider)) return "off";
    return provider.keySet || provider.access === "keyless" ? "ok" : "warn";
}

function countOf(provider: CatalogProviderView): number {
    return searching.value ? counts.value.get(provider.id) ?? 0 : provider.models.length;
}

/** 这一行能不能勾：已添加的、用不了的服务商的都不能。 */
function blockedReason(hit: CatalogHit): string | null {
    if (chosenSet.value.has(hit.ref)) return t("catalog.added");
    return providerSelectable(hit.provider) ? null : keyText(hit.provider);
}

function toggle(hit: CatalogHit): void {
    if (blockedReason(hit) !== null) return;
    picked.value = picked.value.includes(hit.ref) ? picked.value.filter((ref) => ref !== hit.ref) : [...picked.value, hit.ref];
}

function tokens(value: number | null): string {
    if (value === null) return "—";
    if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
    if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
    return String(value);
}

function priceText(model: CatalogModelView): string {
    return model.price === null ? t("catalog.priceUnknown") : `${model.price.input} / ${model.price.output} ${model.price.currency}`;
}

const providerOptions = computed(() => [
    {value: ALL, label: t("catalog.all")},
    ...[...ordered.value.usable, ...ordered.value.locked].map((provider) => ({value: provider.id, label: provider.name, ...(providerSelectable(provider) ? {} : {description: keyText(provider)})})),
]);

function confirm(): void {
    if (picked.value.length === 0) return;
    emit("pick", [...picked.value]);
    emit("update:open", false);
}
</script>

<template>
    <Dialog
        :open="props.open"
        :title="t('catalog.title')"
        size="xl"
        :height="620"
        closable
        body-class="acv-catalog__body"
        initial-focus="[data-catalog-search] input"
        @update:open="emit('update:open', $event)"
    >
        <div class="acv-catalog" data-model-catalog>
            <aside class="acv-catalog__rail">
                <ul class="acv-catalog__providers">
                    <li>
                        <button type="button" class="acv-catalog__provider" :class="{'is-active': active === ALL}" data-catalog-provider="*" @click="active = ALL">
                            <span class="i-lucide-layers acv-catalog__rail-icon" aria-hidden="true" />
                            <span class="acv-catalog__provider-name">{{ t("catalog.all") }}</span>
                            <span class="acv-catalog__count">{{ searching ? hits.length : props.providers.reduce((sum, provider) => sum + provider.models.length, 0) }}</span>
                        </button>
                    </li>
                    <li v-for="provider in ordered.usable" :key="provider.id">
                        <button
                            type="button"
                            class="acv-catalog__provider"
                            :class="{'is-active': active === provider.id, 'is-empty': searching && countOf(provider) === 0}"
                            :title="keyText(provider)"
                            :data-catalog-provider="provider.id"
                            @click="active = provider.id"
                        >
                            <span class="acv-catalog__dot" :class="`is-${dotOf(provider)}`" aria-hidden="true" />
                            <span class="acv-catalog__provider-name">{{ provider.name }}</span>
                            <span v-if="provider.source === 'custom'" class="acv-catalog__tag">{{ t("catalog.custom") }}</span>
                            <span class="acv-catalog__count">{{ countOf(provider) }}</span>
                        </button>
                    </li>
                    <li v-if="ordered.locked.length > 0" class="acv-catalog__divider" role="separator" />
                    <li v-for="provider in ordered.locked" :key="provider.id">
                        <button
                            type="button"
                            class="acv-catalog__provider is-locked"
                            :class="{'is-active': active === provider.id}"
                            :title="keyText(provider)"
                            :data-catalog-provider="provider.id"
                            @click="active = provider.id"
                        >
                            <span class="acv-catalog__dot is-off" aria-hidden="true" />
                            <span class="acv-catalog__provider-name">{{ provider.name }}</span>
                            <span class="acv-catalog__count">{{ countOf(provider) }}</span>
                        </button>
                    </li>
                </ul>
                <Button size="sm" variant="ghost" icon-class="i-lucide-plus" data-catalog-add-provider @click="emit('add-provider')">{{ t("catalog.addProvider") }}</Button>
            </aside>

            <section class="acv-catalog__main">
                <div class="acv-catalog__bar">
                    <div class="acv-catalog__picker">
                        <Select v-model="active" size="sm" :options="providerOptions" :aria-label="t('catalog.provider')" />
                    </div>
                    <Input v-model="query" class="acv-catalog__search" size="sm" icon-class="i-lucide-search" :placeholder="t('catalog.search')" clearable data-catalog-search />
                </div>

                <div v-if="lockedPage !== null" class="acv-catalog__locked" data-catalog-locked>
                    <span class="i-lucide-lock acv-catalog__locked-icon" aria-hidden="true" />
                    <p class="acv-catalog__locked-title">{{ lockedPage.name }}</p>
                    <p class="acv-catalog__locked-text">{{ keyText(lockedPage) }}</p>
                    <p class="acv-catalog__muted">{{ t("catalog.locked.count", {count: lockedPage.models.length}) }}</p>
                </div>

                <template v-else>
                    <header v-if="activeProvider !== null" class="acv-catalog__head">
                        <span class="acv-catalog__head-name">{{ activeProvider.name }}</span>
                        <span class="acv-catalog__muted">{{ keyText(activeProvider) }} · {{ t("catalog.models", {count: activeProvider.models.length}) }}</span>
                    </header>
                    <div class="acv-catalog__table-wrap">
                        <table v-if="visible.length > 0" class="acv-catalog__table">
                            <thead>
                                <tr>
                                    <th class="acv-catalog__check-col" />
                                    <th>{{ t("catalog.col.model") }}</th>
                                    <th class="acv-catalog__api">{{ t("catalog.col.api") }}</th>
                                    <th class="acv-catalog__num">{{ t("catalog.col.context") }}</th>
                                    <th class="acv-catalog__flag">{{ t("catalog.col.reasoning") }}</th>
                                    <th class="acv-catalog__flag">{{ t("catalog.col.images") }}</th>
                                    <th class="acv-catalog__num">{{ t("catalog.col.price") }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="hit in visible"
                                    :key="hit.ref"
                                    class="acv-catalog__row"
                                    :class="{'is-picked': picked.includes(hit.ref), 'is-blocked': blockedReason(hit) !== null}"
                                    :title="blockedReason(hit) ?? undefined"
                                    :data-catalog-model="hit.ref"
                                    @click="toggle(hit)"
                                >
                                    <td class="acv-catalog__check-col" @click.stop>
                                        <span v-if="chosenSet.has(hit.ref)" class="acv-catalog__added">{{ t("catalog.added") }}</span>
                                        <!-- Checkbox 总会画出文字：给它一段只给读屏的名称，模型名已经在旁边一列。 -->
                                        <Checkbox v-else :model-value="picked.includes(hit.ref)" :disabled="blockedReason(hit) !== null" @update:model-value="toggle(hit)">
                                            <span class="acv-catalog__sr">{{ hit.ref }}</span>
                                        </Checkbox>
                                    </td>
                                    <td>
                                        <div class="acv-catalog__model-name">{{ hit.model.name }}</div>
                                        <div class="acv-catalog__model-id">{{ showProviderColumn ? hit.ref : hit.model.id }}</div>
                                    </td>
                                    <td class="acv-catalog__api acv-catalog__muted">{{ hit.model.api }}</td>
                                    <td class="acv-catalog__num">{{ tokens(hit.model.contextWindow) }}</td>
                                    <td class="acv-catalog__flag"><span v-if="hit.model.reasoning" class="i-lucide-brain acv-catalog__yes" :aria-label="t('catalog.col.reasoning')" /></td>
                                    <td class="acv-catalog__flag"><span v-if="hit.model.images" class="i-lucide-image acv-catalog__yes" :aria-label="t('catalog.col.images')" /></td>
                                    <td class="acv-catalog__num acv-catalog__muted">{{ priceText(hit.model) }}</td>
                                </tr>
                            </tbody>
                        </table>
                        <p v-if="visible.length === 0" class="acv-catalog__empty">{{ t("catalog.empty") }}</p>
                        <p v-else-if="shown.length > visible.length" class="acv-catalog__more">{{ t("catalog.more", {count: shown.length - visible.length}) }}</p>
                    </div>
                </template>
            </section>
        </div>

        <template #footer>
            <div class="acv-catalog__foot">
                <span class="acv-catalog__muted" data-catalog-selected>{{ t("catalog.selected", {count: picked.length}) }}</span>
                <span class="acv-catalog__spacer" />
                <Button variant="secondary" @click="emit('update:open', false)">{{ t("catalog.cancel") }}</Button>
                <Button :disabled="picked.length === 0" data-catalog-confirm @click="confirm">{{ t("catalog.confirm", {count: picked.length}) }}</Button>
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
:global(.acv-catalog__body) {
    container-type: inline-size;
}

.acv-catalog {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-columns: 230px minmax(0, 1fr);
}

.acv-catalog__rail {
    display: flex;
    min-height: 0;
    flex-direction: column;
    gap: 8px;
    padding-right: 10px;
    border-right: var(--border-w) solid var(--divider);
}

.acv-catalog__providers {
    display: flex;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
}

.acv-catalog__provider {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: var(--radius-control);
    color: var(--text-main);
    font-size: var(--text-sm);
    text-align: left;
}

.acv-catalog__provider:hover {
    background: var(--bg-hover);
}

.acv-catalog__provider:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: -2px;
}

.acv-catalog__provider.is-active {
    background: var(--accent-bg);
    color: var(--accent-text);
}

.acv-catalog__provider.is-locked,
.acv-catalog__provider.is-empty {
    color: var(--text-muted);
}

.acv-catalog__rail-icon {
    flex: none;
    width: 14px;
    height: 14px;
}

.acv-catalog__provider-name {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-catalog__tag,
.acv-catalog__count {
    flex: none;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
}

.acv-catalog__dot {
    flex: none;
    width: 7px;
    height: 7px;
    margin: 0 3.5px;
    border-radius: 999px;
}

.acv-catalog__dot.is-ok {
    background: var(--status-success);
}

.acv-catalog__dot.is-warn {
    background: var(--status-warning);
}

.acv-catalog__dot.is-off {
    background: var(--border-color);
}

.acv-catalog__divider {
    margin: 6px 8px;
    border-top: var(--border-w) solid var(--divider);
}

.acv-catalog__main {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    gap: 8px;
    padding-left: 12px;
}

.acv-catalog__bar {
    display: flex;
    align-items: center;
    gap: 8px;
}

.acv-catalog__picker {
    display: none;
    width: 160px;
    flex: none;
}

.acv-catalog__search {
    min-width: 0;
    flex: 1 1 auto;
}

.acv-catalog__head {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
}

.acv-catalog__head-name {
    font-weight: var(--weight-strong);
}

.acv-catalog__muted {
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.acv-catalog__table-wrap {
    min-height: 0;
    flex: 1 1 auto;
    overflow: auto;
}

.acv-catalog__table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
}

.acv-catalog__table th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 4px 8px;
    border-bottom: var(--border-w) solid var(--divider);
    background: var(--panel-surface);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: normal;
    text-align: left;
    white-space: nowrap;
}

.acv-catalog__table td {
    padding: 5px 8px;
    border-bottom: var(--border-w) solid var(--divider);
    vertical-align: middle;
}

.acv-catalog__row {
    cursor: pointer;
}

.acv-catalog__row:hover {
    background: var(--bg-hover);
}

.acv-catalog__row.is-picked {
    background: var(--accent-bg);
}

.acv-catalog__row.is-blocked {
    color: var(--text-muted);
    cursor: default;
}

.acv-catalog__check-col {
    width: 1%;
    white-space: nowrap;
}

.acv-catalog__sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.acv-catalog__added {
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.acv-catalog__model-name {
    color: inherit;
}

.acv-catalog__model-id {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    word-break: break-all;
}

.acv-catalog__num {
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
}

.acv-catalog__flag {
    width: 1%;
    text-align: center;
}

.acv-catalog__yes {
    display: inline-block;
    width: 14px;
    height: 14px;
    color: var(--text-secondary);
}

.acv-catalog__empty,
.acv-catalog__more {
    margin: 12px 8px;
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.acv-catalog__locked {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 24px 8px;
}

.acv-catalog__locked-icon {
    width: 20px;
    height: 20px;
    color: var(--text-muted);
}

.acv-catalog__locked-title {
    margin: 0;
    font-weight: var(--weight-strong);
}

.acv-catalog__locked-text {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

.acv-catalog__foot {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
}

.acv-catalog__spacer {
    flex: 1 1 auto;
}

/* 窄了先丢接口列，再丢推理与图片列；再窄左栏收成顶上的下拉。 */
@container (max-width: 720px) {
    .acv-catalog__api {
        display: none;
    }
}

@container (max-width: 640px) {
    .acv-catalog {
        grid-template-columns: minmax(0, 1fr);
    }

    .acv-catalog__rail {
        display: none;
    }

    .acv-catalog__main {
        padding-left: 0;
    }

    .acv-catalog__bar {
        flex-wrap: wrap;
    }

    .acv-catalog__picker {
        display: block;
        width: 100%;
    }
}

@container (max-width: 560px) {
    .acv-catalog__flag {
        display: none;
    }
}
</style>
