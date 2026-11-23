<script setup lang="ts">
/**
 * 设置窗口的“网络”页（同名 .md；docs/specs/network/egress.md 的“网络页”）。三项设置经传入的配置服务读写；选路说明、测试与
 * 在线目录的状态在数据模块里，这里只读状态、调方法。
 */
import {Button, Input, SegmentedControl, Switch} from "@notnotype/nb-ui/components";
import {computed, onMounted, onUnmounted, ref, useId, watch} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";
import SettingsActionRow from "nbook/ui/settings/SettingsActionRow.vue";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import type {EgressSummaryView} from "../../shared/contracts";
import {networkSettings} from "../../shared/settings";
import type {NetworkStore} from "../network-store";
import {useNetworkText} from "../text";

defineOptions({name: "NetworkPage"});

const props = defineProps<{
    store: NetworkStore;
    settings: SettingsService;
    writable: boolean;
    reportWriteFailure: SettingsPageContext["reportWriteFailure"];
}>();

const text = useNetworkText();
const id = useId();
const {proxyMode, proxyUrl, catalogAutoUpdate} = networkSettings.settings;

onMounted(() => props.store.start());
// 离开页面不留一个在后台跑的测试。
onUnmounted(() => props.store.cancelTest());

const mode = computed(() => props.settings.get(proxyMode));
const url = computed(() => props.settings.get(proxyUrl));

/** 在途的写入：点“测试”时先等它（框里刚交出的地址要写完才测得到）。 */
let pending: Promise<unknown> = Promise.resolve();

/** 三项都只允许用户层，写用户层；失败交给窗口通知，主语是这一项的标题。 */
async function write<T>(setting: SettingDefinition<T>, name: "proxyMode" | "proxyUrl" | "catalogAutoUpdate", value: T): Promise<void> {
    const run = props.settings.update(setting, value, {layer: "user"});
    pending = run;
    const result = await run;
    if (result.ok) return;
    props.reportWriteFailure(text(`settings.${name}.title`), {reason: text("page.writeFailed", {reason: `${result.code}：${result.detail}`}), uncertain: result.code === "unknown-outcome"});
}

// 代理设置变了：重取说明，旧的测试结果不再说明现在的路。
watch([mode, url], () => {
    props.store.resetTest();
    void props.store.describe();
});

const modeOptions = computed(() => (["system", "custom", "direct"] as const).map((value) => ({value, label: text(`settings.proxyMode.choices.${value}.title`)})));

// ---- 代理地址 ----
const urlDraft = ref(url.value);
let urlFocused = false;
watch(url, (value) => {
    // 别处改了地址：正在编辑的框不被打断，失焦后再换成实际值。
    if (!urlFocused) urlDraft.value = value;
});
const urlProblem = ref("");
/** 自定义代理的地址：http 或 https，不带用户名密码（服务端同一条规则，docs/specs/network/egress.md）。 */
function validProxyUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname !== "" && parsed.username === "" && parsed.password === "";
    } catch {
        return false;
    }
}
function commitUrl(): void {
    const value = urlDraft.value.trim();
    if (value !== "" && !validProxyUrl(value)) {
        urlProblem.value = text("page.url.invalid");
        return;
    }
    urlProblem.value = "";
    if (value !== url.value) void write(proxyUrl, "proxyUrl", value);
}
function urlFocus(): void {
    urlFocused = true;
}
function urlBlur(): void {
    commitUrl();
    urlFocused = false;
}

// ---- 现在用的代理 ----
const sourceText = (summary: EgressSummaryView): string => {
    const source = summary.source;
    if (source.kind === "env") return text("page.summary.sources.env", {name: source.name});
    if (source.kind === "system") return text("page.summary.sources.system", {name: text(`page.summary.systems.${source.name}`)});
    return text("page.summary.sources.setting");
};
/** 行下信息：跟随系统时总写；自定义时只在出错或旁路时写（地址就在上面的框里）。 */
const summaryLine = computed((): {tone: "info" | "muted" | "danger"; text: string} | null => {
    const state = props.store.summary.value;
    if (mode.value === "direct") return null;
    if (state.status === "loading") return mode.value === "system" ? {tone: "muted", text: text("page.summary.loading")} : null;
    if (state.status === "failed") return {tone: "muted", text: text("page.summary.failed")};
    const summary = state.summary;
    // 说明是旧设置下取的（改了方式、新的还没回来）：不拿它说现在。
    if (summary.mode !== mode.value) return null;
    if (summary.error !== null) return {tone: "danger", text: text(`page.errors.${summary.error.code}`)};
    if (summary.route === "bypassed") return {tone: "info", text: text("page.summary.bypassed", {source: sourceText(summary)})};
    if (mode.value === "custom") return null;
    if (summary.route === "direct") return {tone: "muted", text: text("page.summary.none")};
    return {tone: "info", text: text(summary.hasCredentials ? "page.summary.proxyCredentials" : "page.summary.proxy", {origin: summary.origin ?? "", source: sourceText(summary)})};
});
const SUMMARY_ICON = {info: "i-lucide-info", muted: "i-lucide-info", danger: "i-lucide-circle-alert"} as const;

// ---- 测试代理 ----
const testing = computed(() => props.store.test.value.status === "running");
async function test(): Promise<void> {
    if (testing.value) {
        props.store.cancelTest();
        return;
    }
    commitUrl();
    if (urlProblem.value !== "") {
        document.getElementById(`${id}-url`)?.focus();
        return;
    }
    await pending;
    await props.store.runTest();
}
const testStatus = computed((): {tone: "info" | "success" | "danger" | "muted"; text: string} | null => {
    const state = props.store.test.value;
    if (state.status === "idle") return null;
    if (state.status === "running") return {tone: "muted", text: text("page.test.running")};
    if (state.status === "error") return {tone: "danger", text: text("page.test.notRun", {code: state.code})};
    const result = state.result;
    if (!result.ok) {
        if (result.reason === "proxy-unsupported" || result.reason === "proxy-invalid" || result.reason === "proxy-unreadable") return {tone: "danger", text: text(`page.errors.${result.reason}`)};
        return {tone: result.reason === "cancelled" ? "muted" : "danger", text: text(`page.test.failures.${result.reason}`, {message: result.message, status: String(result.status ?? "")})};
    }
    const values = {ip: result.ip ?? "?", ms: String(result.elapsedMs)};
    // 没走代理时不说“通了”：通的是直连，不是代理（docs/specs/network/egress.md）。
    if (result.summary.route === "bypassed") return {tone: "info", text: text("page.test.bypassed", values)};
    if (result.summary.route === "direct") return {tone: "info", text: text("page.test.direct", values)};
    return {tone: "success", text: result.ip === null ? text("page.test.okNoIp", values) : text("page.test.ok", values)};
});

// ---- 模型目录 ----
const catalog = computed(() => props.store.catalog.value);
const updateFailure = ref<string | null>(null);
const catalogDescription = computed(() => {
    const state = catalog.value;
    if (state === null) return text("page.update.unavailable");
    if (!state.enabled) return text("page.update.disabled");
    if (state.checkedAt === null || state.modelCount === null) return text("page.update.never");
    return text("page.update.checked", {time: new Date(state.checkedAt).toLocaleString(), count: state.modelCount.toLocaleString()});
});
const updateStatus = computed((): {tone: "danger"; text: string} | null => {
    if (updateFailure.value !== null) return {tone: "danger", text: updateFailure.value};
    const error = catalog.value?.refreshing === false ? catalog.value.error : null;
    return error === null || error === undefined ? null : {tone: "danger", text: text("page.update.failed", {reason: text(`page.update.reasons.${error.reason}`)})};
});
const updating = computed(() => catalog.value?.refreshing === true);
async function update(): Promise<void> {
    updateFailure.value = null;
    const result = await props.store.refreshCatalog();
    if (!result.ok) updateFailure.value = text("page.update.notRun", {code: result.code});
}
</script>

<template>
    <div class="network-page" data-network-page>
        <section class="network-page__group" :aria-labelledby="`${id}-proxy`">
            <h3 :id="`${id}-proxy`" class="network-page__title">{{ text("page.proxy.title") }}</h3>
            <SettingsRow :settings="settings" :setting="proxyMode" layer="user">
                <template #default="row">
                    <SegmentedControl
                        :model-value="row.value as string"
                        :options="modeOptions"
                        size="sm"
                        :aria-label="row.label"
                        :disabled="row.disabled || !writable"
                        data-network-mode
                        @update:model-value="(value) => write(proxyMode, 'proxyMode', value as 'system' | 'custom' | 'direct')"
                    />
                </template>
                <template v-if="summaryLine !== null" #below>
                    <p class="network-page__line" :class="`network-page__line--${summaryLine.tone}`" :data-tone="summaryLine.tone" data-network-summary>
                        <span :class="SUMMARY_ICON[summaryLine.tone]" class="network-page__icon" aria-hidden="true"></span>
                        <span>{{ summaryLine.text }}</span>
                    </p>
                </template>
            </SettingsRow>
            <SettingsRow
                v-if="mode === 'custom'"
                v-slot="row"
                :settings="settings"
                :setting="proxyUrl"
                layer="user"
                :reasons="urlProblem === '' ? [] : [{tone: 'error', text: urlProblem}]"
            >
                <Input
                    :id="`${id}-url`"
                    v-model="urlDraft"
                    size="md"
                    class="network-page__url"
                    :placeholder="text('page.url.placeholder')"
                    :disabled="row.disabled || !writable"
                    :invalid="urlProblem !== ''"
                    :aria-describedby="row.describedby"
                    :aria-label="row.label"
                    data-network-url
                    @focusin="urlFocus"
                    @focusout="urlBlur"
                    @keydown.enter="commitUrl"
                />
            </SettingsRow>
            <SettingsActionRow
                v-if="mode !== 'direct'"
                v-slot="action"
                :title="text('page.test.title')"
                :status="testStatus?.text ?? null"
                :tone="testStatus?.tone ?? 'info'"
            >
                <Button
                    size="md"
                    variant="secondary"
                    :icon-class="testing ? 'i-lucide-square' : undefined"
                    :aria-describedby="action.describedby"
                    :disabled="!testing && !writable"
                    data-network-test
                    :data-network-test-running="testing ? '' : undefined"
                    @click="test"
                >{{ testing ? text("page.test.cancel") : text("page.test.action") }}</Button>
            </SettingsActionRow>
        </section>

        <section class="network-page__group" :aria-labelledby="`${id}-catalog`">
            <h3 :id="`${id}-catalog`" class="network-page__title">{{ text("page.catalog.title") }}</h3>
            <SettingsRow v-slot="row" :settings="settings" :setting="catalogAutoUpdate" layer="user">
                <Switch
                    :id="row.id"
                    :model-value="row.value === true"
                    :disabled="row.disabled || !writable"
                    :aria-describedby="row.describedby"
                    data-network-auto-update
                    @update:model-value="(value: boolean) => write(catalogAutoUpdate, 'catalogAutoUpdate', value)"
                />
            </SettingsRow>
            <SettingsActionRow
                v-slot="action"
                :title="text('page.update.title')"
                :description="catalogDescription"
                :status="updateStatus?.text ?? null"
                tone="danger"
            >
                <Button
                    size="md"
                    variant="secondary"
                    icon-class="i-lucide-refresh-cw"
                    :aria-describedby="action.describedby"
                    :disabled="catalog === null || !catalog.enabled || updating"
                    data-network-update
                    @click="update"
                >{{ updating ? text("page.update.running") : text("page.update.action") }}</Button>
            </SettingsActionRow>
        </section>
    </div>
</template>

<style scoped>
.network-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
}

.network-page__group {
    display: flex;
    flex-direction: column;
}

/* 小组标题同“搜索与网页”页：带分隔线的小号粗体。 */
.network-page__title {
    margin: 0 0 var(--space-2);
    padding-bottom: var(--space-4);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

/* 单行输入随行宽收窄（同设置窗口通用列表的单行输入）。 */
.network-page__url {
    width: min(280px, 100%);
}

.network-page__line {
    user-select: text;
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin: 0;
}

.network-page__line--info {
    color: var(--status-info);
}

.network-page__line--muted {
    color: var(--text-muted);
}

.network-page__line--danger {
    color: var(--status-danger);
}

.network-page__icon {
    width: var(--text-sm);
    height: var(--text-sm);
    flex-shrink: 0;
    margin-top: 2px;
}
</style>
