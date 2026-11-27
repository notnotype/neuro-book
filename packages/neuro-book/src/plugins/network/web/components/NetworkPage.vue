<script setup lang="ts">
/**
 * 设置窗口的“网络”页（同名 .md；docs/specs/network/egress.md 的“网络页”）。三项设置经传入的配置服务读写；选路说明、测试与
 * 在线目录的状态在数据模块里，这里只读状态、调方法。
 *
 * 动效：自定义地址一行、测试一行与代理方式下面的说明随状态出现与消失，都经 `Collapsible`（高度与透明度，`--motion-move`）；
 * 说明换内容时淡入淡出（`--motion-fast`）；按钮换文字时宽度不变（两种文字叠在同一格里）。
 */
import {Button, Collapsible, Input, SegmentedControl, Switch} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, nextTick, onMounted, onUnmounted, ref, useId, watch} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";
import {fullTime} from "nbook/shared/short-time";
import SettingsActionRow from "nbook/ui/settings/SettingsActionRow.vue";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {isCustomProxyAddress} from "../../shared/contracts";
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
const port = useText();
const id = useId();
const {proxyMode, proxyUrl, catalogAutoUpdate} = networkSettings.settings;

onMounted(() => props.store.start());
// 离开页面不留一个在后台跑的测试。
onUnmounted(() => props.store.cancelTest());

const mode = computed(() => props.settings.get(proxyMode));
const url = computed(() => props.settings.get(proxyUrl));

/** 远程调用与写入的失败码写成说法；表里没有的写码本身。 */
const failureText = (code: string): string => {
    switch (code) {
        case "unavailable": return text("page.remote.unavailable");
        case "timeout": return text("page.remote.timeout");
        case "unknown-outcome": return text("page.remote.unknownOutcome");
        case "cancelled": return text("page.remote.cancelled");
        default: return text("page.remote.other", {code});
    }
};

/** 在途的写入：点“测试”时先等它（框里刚交出的地址要写完才测得到）。 */
let pending: Promise<unknown> = Promise.resolve();

/** 三项都只允许用户层，写用户层；失败交给窗口通知（主语是这一项的标题），交回是否写成。 */
async function write<T>(setting: SettingDefinition<T>, name: "proxyMode" | "proxyUrl" | "catalogAutoUpdate", value: T): Promise<boolean> {
    const run = props.settings.update(setting, value, {layer: "user"});
    pending = run;
    const result = await run;
    if (result.ok) return true;
    props.reportWriteFailure(text(`settings.${name}.title`), {reason: text("page.writeFailed", {reason: failureText(result.code)}), uncertain: result.code === "unknown-outcome"});
    return false;
}

// 代理设置变了：重取说明，旧的测试结果不再说明现在的路。
watch([mode, url], () => {
    props.store.resetTest();
    void props.store.describe();
});

const modeOptions = computed(() => (["system", "custom", "direct"] as const).map((value) => ({value, label: text(`settings.proxyMode.choices.${value}.title`)})));

/** 用指针选的“自定义”：写进去后焦点进地址框。键盘用方向键换方式时不抢焦点（会打断接着按方向键）。 */
let pointerChoice = false;
const markPointer = (): void => {
    pointerChoice = true;
};
const focusUrl = (): void => document.querySelector<HTMLElement>("[data-network-url] input, input[data-network-url]")?.focus();
async function changeMode(value: "system" | "custom" | "direct"): Promise<void> {
    const byPointer = pointerChoice;
    pointerChoice = false;
    if (!(await write(proxyMode, "proxyMode", value))) return;
    if (value === "custom" && byPointer) {
        await nextTick();
        focusUrl();
    }
}

// ---- 代理地址 ----
/**
 * 框里的草稿。`urlEdited`：用户在框里改过、还没交出去。没改过时，别处改了地址（另一个窗口、设置文件）直接换成新值；改过时不打断，
 * 失焦或回车时交出。交出一次就清掉，回车之后紧接着失焦不再写第二次；写失败退回实际值。
 */
const urlDraft = ref(url.value);
const urlEdited = ref(false);
watch(url, (value) => {
    if (!urlEdited.value) urlDraft.value = value;
});
const urlProblem = ref("");
function editUrl(value: string): void {
    urlDraft.value = value;
    urlEdited.value = true;
}
function commitUrl(): void {
    if (!urlEdited.value) return;
    const value = urlDraft.value.trim();
    if (value !== "" && !isCustomProxyAddress(value)) {
        urlProblem.value = text("page.url.invalid");
        return;
    }
    urlProblem.value = "";
    urlEdited.value = false;
    if (value === url.value) {
        urlDraft.value = value;
        return;
    }
    void write(proxyUrl, "proxyUrl", value).then((ok) => {
        if (!ok && !urlEdited.value) urlDraft.value = url.value;
    });
}

// ---- 现在用的代理 ----
const sourceText = (summary: EgressSummaryView): string => {
    const source = summary.source;
    switch (source.kind) {
        case "env": return text("page.summary.sources.env", {name: source.name});
        case "system": return text("page.summary.sources.system", {name: text(`page.summary.systems.${source.name}`)});
        case "setting": return text("page.summary.sources.setting");
        case "none":
        case "direct":
        case "local": return "";
    }
};
/**
 * 代理方式下面的说明：跟随系统时写现在用的代理与来源（系统没设写直连）；自定义时只在选路出错时写，地址还空着不算错（刚选了
 * 自定义、还没填）；读不到写一句；直连不写。旁路只在测试结果里说（“测试目标”是测试才有的概念）。
 */
const summaryLine = computed((): {tone: "info" | "muted" | "danger"; text: string} | null => {
    const state = props.store.summary.value;
    if (mode.value === "direct") return null;
    if (state.status === "loading") return mode.value === "system" ? {tone: "muted", text: text("page.summary.loading")} : null;
    if (state.status === "failed") return {tone: "muted", text: text("page.summary.failed")};
    const summary = state.summary;
    // 说明是旧设置下取的（改了方式、新的还没回来）：不拿它说现在。
    if (summary.mode !== mode.value) return null;
    if (summary.error !== null) {
        if (mode.value === "custom" && summary.error.code === "proxy-invalid" && url.value.trim() === "") return null;
        return {tone: "danger", text: text(`page.errors.${summary.error.code}`)};
    }
    if (mode.value === "custom" || summary.route === "bypassed") return null;
    if (summary.route === "direct") return {tone: "muted", text: text("page.summary.none")};
    return {tone: "info", text: text(summary.hasCredentials ? "page.summary.proxyCredentials" : "page.summary.proxy", {origin: summary.origin ?? "", source: sourceText(summary)})};
});
const SUMMARY_ICON = {info: "i-lucide-info", muted: "i-lucide-info", danger: "i-lucide-circle-alert"} as const;
/** 最近一句说明，收起的过程中照旧显示它（内容先不换，高度收完才没）。 */
const shownSummary = ref(summaryLine.value);
watch(summaryLine, (line) => {
    if (line !== null) shownSummary.value = line;
});

// ---- 测试代理 ----
const testing = computed(() => props.store.test.value.status === "running");
async function test(): Promise<void> {
    if (testing.value) {
        props.store.cancelTest();
        return;
    }
    commitUrl();
    if (urlProblem.value !== "") {
        focusUrl();
        return;
    }
    await pending;
    await props.store.runTest();
}
const testStatus = computed((): {tone: "info" | "success" | "danger" | "muted"; text: string} | null => {
    const state = props.store.test.value;
    if (state.status === "idle") return null;
    if (state.status === "running") return {tone: "muted", text: text("page.test.running")};
    if (state.status === "error") return {tone: "danger", text: text("page.test.notRun", {reason: failureText(state.code)})};
    const result = state.result;
    if (!result.ok) {
        if (result.reason === "proxy-unsupported" || result.reason === "proxy-invalid" || result.reason === "proxy-unreadable") return {tone: "danger", text: text(`page.errors.${result.reason}`)};
        return {tone: result.reason === "cancelled" ? "muted" : "danger", text: text(`page.test.failures.${result.reason}`, {message: result.message, status: String(result.status ?? "")})};
    }
    const values = {ip: result.ip ?? "?", ms: String(result.elapsedMs)};
    // 没走代理时不说“连接成功”：通的是直连，不是代理（docs/specs/network/egress.md）。
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
    return text("page.update.checked", {time: fullTime(state.checkedAt, port.locale.value), count: state.modelCount.toLocaleString(port.locale.value)});
});
const updateStatus = computed((): string | null => {
    if (updateFailure.value !== null) return updateFailure.value;
    const error = catalog.value?.refreshing === false ? catalog.value.error : null;
    return error === null || error === undefined ? null : text("page.update.failed", {reason: text(`page.update.reasons.${error.reason}`)});
});
const updating = computed(() => catalog.value?.refreshing === true);
const canUpdate = computed(() => catalog.value !== null && catalog.value.enabled);
/** 进行中不停用按钮（停用会让焦点掉到页面上），只是点了不理，读屏经 `aria-disabled` 知道。 */
async function update(): Promise<void> {
    if (updating.value || !canUpdate.value) return;
    updateFailure.value = null;
    const result = await props.store.refreshCatalog();
    if (!result.ok) updateFailure.value = text("page.update.notRun", {reason: failureText(result.code)});
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
                        @pointerdown.capture="markPointer"
                        @update:model-value="(value) => changeMode(value as 'system' | 'custom' | 'direct')"
                    />
                </template>
                <template #below>
                    <Collapsible :open="summaryLine !== null">
                        <Transition name="network-page-fade" mode="out-in">
                            <p
                                v-if="shownSummary !== null"
                                :key="shownSummary.text"
                                class="network-page__line"
                                :class="`network-page__line--${shownSummary.tone}`"
                                :data-tone="shownSummary.tone"
                                data-network-summary
                            >
                                <span :class="SUMMARY_ICON[shownSummary.tone]" class="network-page__icon" aria-hidden="true"></span>
                                <span>{{ shownSummary.text }}</span>
                            </p>
                        </Transition>
                    </Collapsible>
                    <!-- 读屏：换了方式以后的说明（看得见的那一行随内容进出，常常不播）。 -->
                    <span class="network-page__sr-only" role="status">{{ summaryLine?.text ?? "" }}</span>
                </template>
            </SettingsRow>
            <Collapsible :open="mode === 'custom'">
                <SettingsRow :settings="settings" :setting="proxyUrl" layer="user">
                    <template #default="row">
                        <Input
                            :id="row.id"
                            :model-value="urlDraft"
                            size="md"
                            class="network-page__url"
                            :placeholder="text('page.url.placeholder')"
                            :disabled="row.disabled || !writable"
                            :invalid="urlProblem !== ''"
                            :aria-describedby="[row.describedby, urlProblem === '' ? null : `${id}-url-problem`].filter(Boolean).join(' ') || undefined"
                            data-network-url
                            @update:model-value="editUrl"
                            @focusout="commitUrl"
                            @keydown.enter="commitUrl"
                        />
                    </template>
                    <template v-if="urlProblem !== ''" #below>
                        <p :id="`${id}-url-problem`" class="network-page__line network-page__line--danger" role="alert" data-network-url-problem>
                            <span class="i-lucide-circle-alert network-page__icon" aria-hidden="true"></span>
                            <span>{{ urlProblem }}</span>
                        </p>
                    </template>
                </SettingsRow>
            </Collapsible>
            <Collapsible :open="mode !== 'direct'">
                <SettingsActionRow
                    v-slot="action"
                    :title="text('page.test.title')"
                    :status="testStatus?.text ?? null"
                    :tone="testStatus?.tone ?? 'info'"
                >
                    <Button
                        size="md"
                        variant="secondary"
                        :icon-class="testing ? 'i-lucide-square' : 'i-lucide-activity'"
                        :aria-describedby="action.describedby"
                        data-network-test
                        :data-network-test-running="testing ? '' : undefined"
                        @click="test"
                    >
                        <span class="network-page__swap">
                            <span :class="{'network-page__swap-hidden': testing}">{{ text("page.test.action") }}</span>
                            <span :class="{'network-page__swap-hidden': !testing}">{{ text("page.test.cancel") }}</span>
                        </span>
                    </Button>
                </SettingsActionRow>
            </Collapsible>
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
                :status="updateStatus"
                tone="danger"
            >
                <Button
                    size="md"
                    variant="secondary"
                    :icon-class="updating ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'"
                    :aria-describedby="action.describedby"
                    :aria-disabled="updating || !canUpdate ? 'true' : undefined"
                    :aria-busy="updating ? 'true' : undefined"
                    :disabled="!canUpdate"
                    data-network-update
                    :data-network-updating="updating ? '' : undefined"
                    @click="update"
                >
                    <span class="network-page__swap">
                        <span :class="{'network-page__swap-hidden': updating}">{{ text("page.update.action") }}</span>
                        <span :class="{'network-page__swap-hidden': !updating}">{{ text("page.update.running") }}</span>
                    </span>
                </Button>
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
    /* 同设置窗口的小组标题：到第一行不大于行距（nb-ui 设计语言“分组与层次”第 1 条）。 */
    margin: 0 0 var(--space-1);
    padding-bottom: var(--space-3);
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

/* 行下信息自己留出与上面的间距（SettingsRow 的 `below`）：收起时连间距一起收掉。 */
.network-page__line {
    padding-top: var(--space-3);
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

/* 两种文字叠在同一格里，格宽取宽的那个：换文字时按钮不变宽。 */
.network-page__swap {
    display: inline-grid;
}

.network-page__swap > span {
    grid-area: 1 / 1;
}

.network-page__swap-hidden {
    visibility: hidden;
}

.network-page-fade-enter-active,
.network-page-fade-leave-active {
    transition-property: opacity;
    transition-duration: var(--motion-fast);
    transition-timing-function: var(--ease-layout);
}

.network-page-fade-enter-from,
.network-page-fade-leave-to {
    opacity: 0;
}

.network-page__sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
