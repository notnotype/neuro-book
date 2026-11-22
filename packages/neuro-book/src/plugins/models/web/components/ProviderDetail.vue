<script setup lang="ts">
import type {ModelRow as ModelRowData, SnapshotProvider, Template} from "@notnotype/nb-models/contract";
import {Button, Collapsible, InfoTip, Input, Select, Switch} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, nextTick, ref, useId, watch} from "vue";

import {fullTime} from "nbook/shared/short-time";

import type {CheckRun, CheckState} from "../models-store";
import {checkKey} from "../models-store";
import {useModelsText} from "../text";
import ApiDetectResults from "./ApiDetectResults.vue";
import type {ApiDetectState} from "./ApiDetectResults.vue";
import HeadersEditor from "./HeadersEditor.vue";
import ModelRow from "./ModelRow.vue";

/**
 * 一家服务商的详情（docs/specs/models/settings-pages.md 输出 4 到 8）：上面是连接（密钥、地址、接口格式、默认收起的高级），下面是按
 * 系列分组的模型列表。受控：改了什么就发对应的事件，写入由页面做；输入框在失焦或回车时才发（改了就写，没有保存按钮）。
 */
type ProviderPatch = {name?: string; region?: string | null; baseUrl?: string | null; api?: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai" | null; auth?: "default" | "bearer" | "none"; headers?: Record<string, string>; followSource?: boolean};

const props = withDefaults(defineProps<{
    provider: SnapshotProvider;
    /** 这家的模型行（`providerModels` 读完的）；还没读到时为空。 */
    rows?: readonly ModelRowData[];
    rowsLoading?: boolean;
    /** 读模型行失败的原因；没有为空。 */
    rowsFailure?: string;
    /** 这家的模板（地区与路由）；模板表还没读到时为 null。 */
    template?: Template | null;
    checks?: ReadonlyMap<string, CheckState>;
    /** 模型 id → 绑着它的角色名。 */
    roleUsage?: ReadonlyMap<string, readonly string[]>;
    disabled?: boolean;
    /** 变了就把输入框的草稿换回实际值（页面在写失败后加一）。 */
    resetToken?: number;
    /** 这家最近一次“没检成”的原因（服务停了、服务商不在了），写在模型列表头上；没有为空。 */
    checkError?: string;
    /** “重新拉取”没被受理的原因（没有可用的密钥、设置读不到），写在来源一行下面；没有为空。 */
    sourceError?: string;
    /** 这家的协议检测（页面持有，换服务商时回到 `idle`）。 */
    detect?: ApiDetectState;
    /** 进行中的“检测全部”的进度；没有为 null。 */
    checkRun?: CheckRun | null;
}>(), {rows: () => [], rowsLoading: false, rowsFailure: "", template: null, checks: () => new Map(), roleUsage: () => new Map(), disabled: false, resetToken: 0, checkError: "", sourceError: "", detect: () => ({status: "idle"}), checkRun: null});

const emit = defineEmits<{
    (e: "set-key", value: string): void;
    (e: "clear-key"): void;
    (e: "update", patch: ProviderPatch): void;
    (e: "toggle-model", id: string, enabled: boolean): void;
    (e: "check", id: string): void;
    (e: "check-all"): void;
    (e: "cancel-checks"): void;
    (e: "cancel-check", id: string): void;
    (e: "edit-model", id: string): void;
    (e: "add-model"): void;
    (e: "manage"): void;
    (e: "reload-rows"): void;
    /** 重新拉取这家的模型列表（结果经快照的 `source` 回来）。 */
    (e: "refresh-source"): void;
    /** 检测协议：地址框的草稿先交出去（发了 `update`），页面等写完再检测；`model` 是没有可用模型时用户填的。 */
    (e: "detect", model?: string): void;
    (e: "cancel-detect"): void;
    /** 改用检测通过的一种协议，带那一行的连接版本。 */
    (e: "adopt", api: NonNullable<ProviderPatch["api"]>, connection: string): void;
}>();

const text = useModelsText();
const id = useId();

// ---- 模型列表的来源（service.md“模型来源”）----
const source = computed(() => props.provider.source);
const keyReady = computed(() => props.provider.key.kind === "stored" || props.provider.key.kind === "keyless" || (props.provider.key.kind === "env" && props.provider.key.found));
const port = useText();
/** 时间按界面语言写（不跟浏览器的语言）。 */
const timeOf = (at: number): string => fullTime(at, port.locale.value);
/** 来源一行：在拉取、失败（有旧列表时写沿用哪次的）、改过要重拉、正常、还没有。 */
const sourceLine = computed((): {text: string; error: boolean} => {
    const state = source.value;
    if (state.refreshing) return {text: text("models.source.refreshing"), error: false};
    if (state.error !== null) {
        const reason = text(`models.source.reasons.${state.error.reason}`);
        return {text: state.checkedAt === null ? text("models.source.failed", {reason}) : text("models.source.failedKept", {reason, time: timeOf(state.checkedAt)}), error: true};
    }
    if (state.state === "changed") return {text: text("models.source.changed"), error: false};
    if (state.state === "ok" && state.checkedAt !== null) return {text: text("models.source.ok", {time: timeOf(state.checkedAt)}), error: false};
    return {text: blank.value ? text("models.source.none") : text("models.source.catalog"), error: false};
});

// ---- 密钥 ----
/** `env:` 引用不是密钥，照原样显示；存在库里的密钥不回到浏览器，框里是空的。 */
const keyCurrent = computed(() => (props.provider.key.kind === "env" ? `env:${props.provider.key.name}` : ""));
const keyDraft = ref(keyCurrent.value);

/**
 * 输入框的草稿与实际值（输出 16）：别处改了时，正在编辑的框不被打断，失焦后再换成实际值。`lastSent` 是最近一次交出去、还没在
 * 快照里回来的值，回车之后紧接着失焦不重复交。
 */
function draftField(current: () => string, draft: {value: string}) {
    let focused = false;
    let deferred = false;
    let lastSent: string | null = null;
    watch(current, (value) => {
        lastSent = null;
        if (focused) deferred = true;
        else draft.value = value;
    });
    return {
        focus: (): void => {
            focused = true;
        },
        blur: (): void => {
            focused = false;
            if (deferred) {
                deferred = false;
                draft.value = current();
            }
        },
        /** 这个值该不该交：与实际值相同或刚交过时不交。 */
        claim: (value: string): boolean => {
            if (value === current() || value === lastSent) return false;
            lastSent = value;
            return true;
        },
        reset: (): void => {
            lastSent = null;
            deferred = false;
            draft.value = current();
        },
    };
}
const keyField = draftField(() => keyCurrent.value, keyDraft);
const keyless = computed(() => props.provider.auth === "none");
const keyPlaceholder = computed(() => {
    switch (props.provider.key.kind) {
        case "stored": return text("connection.key.stored");
        case "keyless": return text("connection.key.keyless");
        default: return text("connection.key.empty");
    }
});
const keyProblem = computed(() => (props.provider.key.kind === "env" && !props.provider.key.found ? text("connection.key.envMissing", {name: props.provider.key.name}) : ""));
const keyNote = computed(() => (props.provider.key.kind === "env" && props.provider.key.found ? text("connection.key.envFound", {name: props.provider.key.name}) : ""));

function commitKey(): void {
    const value = keyDraft.value.trim();
    if (value === "" || !keyField.claim(value)) return;
    emit("set-key", value);
    // 原文密钥写完就不留在浏览器里（输出“边界”一节）。
    if (!value.startsWith("env:")) keyDraft.value = "";
}

// ---- 地址与接口 ----
const ENDPOINT: Record<string, string> = {"openai-completions": "/chat/completions", "openai-responses": "/responses", "anthropic-messages": "/v1/messages", "google-generative-ai": "/models/<模型>:streamGenerateContent"};
const effectiveUrl = computed(() => props.provider.baseUrl ?? props.provider.templateBaseUrl ?? "");
const blank = computed(() => props.provider.templateBaseUrl === null);
const urlDraft = ref(effectiveUrl.value);
const urlField = draftField(() => effectiveUrl.value, urlDraft);
/** 地址写不对时原位写原因、不写进设置（http 或 https，能解析）。 */
const urlProblem = ref("");

const validUrl = (value: string): boolean => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
};
const overridden = computed(() => !blank.value && props.provider.baseUrl !== null && props.provider.baseUrl !== props.provider.templateBaseUrl && props.provider.region === null);
const requestUrl = computed(() => `${effectiveUrl.value.replace(/\/$/u, "")}${ENDPOINT[props.provider.api ?? ""] ?? ""}`);

function commitUrl(): void {
    const value = urlDraft.value.trim();
    if (value === "") {
        urlProblem.value = "";
        urlDraft.value = effectiveUrl.value;
        return;
    }
    if (!validUrl(value)) {
        urlProblem.value = text("connection.url.invalid");
        return;
    }
    urlProblem.value = "";
    if (!urlField.claim(value)) return;
    emit("update", {baseUrl: !blank.value && value === props.provider.templateBaseUrl ? null : value});
}

const API_OPTIONS = [
    {value: "openai-completions", label: "OpenAI Chat Completions"},
    {value: "openai-responses", label: "OpenAI Responses"},
    {value: "anthropic-messages", label: "Anthropic Messages"},
    {value: "google-generative-ai", label: "Google Gemini"},
];
/** 协议与模板的不同：改了就按通用协议发送（写在旁边的说明里）。 */
const apiChanged = computed(() => !blank.value && props.provider.api !== props.provider.templateApi);
const regionOptions = computed(() => (props.template?.regions ?? []).map((region) => ({value: region.id, label: region.id === "global" || region.id === "cn" ? text(`add.region.${region.id}`) : region.id})));
function changeApi(value: string): void {
    const api = value as NonNullable<ProviderPatch["api"]>;
    // 非空白模板改回模板的协议就清掉覆盖，回到“跟随模板”。
    emit("update", {api: !blank.value && api === props.provider.templateApi ? null : api});
}
// ---- 协议检测 ----
const detecting = computed(() => props.detect.status === "running");
/** 只测已保存的配置：地址框里没交出去的草稿先交（页面等它写完）；草稿不合格时不检测，焦点回到地址框。 */
function startDetect(): void {
    commitUrl();
    if (urlProblem.value !== "") {
        document.getElementById(`${id}-url`)?.focus();
        return;
    }
    emit("detect");
}
/** 在结果块里填了模型 id 再检测：输入框随块换掉，焦点交给“检测协议”（这时是“取消协议检测”）。 */
async function detectWith(model: string): Promise<void> {
    emit("detect", model);
    await nextTick();
    document.getElementById(`${id}-detect`)?.focus();
}

const authOptions = computed(() => [
    {value: "default", label: text("connection.auth.default")},
    {value: "bearer", label: text("connection.auth.bearer")},
    {value: "none", label: text("connection.auth.none")},
]);

// 写失败：草稿回到实际值，请求头编辑器重建（没填完的行一起丢掉）。
watch(() => props.resetToken, () => {
    keyField.reset();
    urlField.reset();
    urlProblem.value = "";
});

// ---- 模型 ----
/** 搜索时最多画这么多行；几百个模型的服务商不能整份渲染。 */
const SEARCH_LIMIT = 200;
const search = ref("");
const needle = computed(() => search.value.trim().toLowerCase());
const matched = computed(() => (needle.value === "" ? props.rows : props.rows.filter((row) => row.name.toLowerCase().includes(needle.value) || row.id.toLowerCase().includes(needle.value))));
const groups = computed(() => {
    const byGroup = new Map<string, ModelRowData[]>();
    for (const row of matched.value) byGroup.set(row.group, [...(byGroup.get(row.group) ?? []), row]);
    return [...byGroup].map(([group, models]) => ({group, models}));
});
/** 搜索时展开命中的组并限 200 行；不搜索时系列默认收起，收起的不渲染。 */
const shown = computed(() => {
    if (needle.value === "") return groups.value.map((group) => ({...group, open: isOpen(group.group), rows: isOpen(group.group) ? group.models : []}));
    let budget = SEARCH_LIMIT;
    return groups.value.map((group) => {
        const rows = group.models.slice(0, Math.max(0, budget));
        budget -= rows.length;
        return {...group, open: true, rows};
    }).filter((group) => group.rows.length > 0);
});
const hiddenCount = computed(() => (needle.value === "" ? 0 : Math.max(0, matched.value.length - SEARCH_LIMIT)));
const enabledCount = computed(() => props.provider.enabledCount);
/** 模型不多（30 个以内）时系列默认展开；更多的默认收起、收起的不渲染。用户点过的组按相反的来。 */
const AUTO_OPEN_LIMIT = 30;
/** 用户点过的组记下展开与否（不是“与默认相反”）：模型数跨过阈值时，点过的组不跟着翻。 */
const chosen = ref(new Map<string, boolean>());
const isOpen = (group: string): boolean => chosen.value.get(group) ?? props.rows.length <= AUTO_OPEN_LIMIT;
function fold(group: string): void {
    chosen.value = new Map([...chosen.value, [group, !isOpen(group)]]);
}
/** 检测全部的播报：只在开始与结束时各一句（进度每检完一个就变，放进播报区会一直插播）。 */
const checkAnnouncement = ref("");
watch(() => props.checkRun?.total ?? null, (total, before) => {
    if (total !== null && before === null) checkAnnouncement.value = text("models.checkStarted", {total: String(total)});
    else if (total === null && before !== null) checkAnnouncement.value = text("models.checkFinished");
});
const checking = computed(() => props.checkRun !== null || props.rows.some((model) => props.checks.get(checkKey(props.provider.id, model.id))?.status === "running"));
</script>

<template>
    <div class="provider-detail" :data-provider-detail="provider.id">
        <section class="provider-detail__group">
            <h3 class="provider-detail__title">{{ text("connection.title") }}</h3>
            <div class="provider-detail__form">
                <div v-if="!keyless" class="provider-detail__field">
                    <div class="provider-detail__field-head">
                        <span class="provider-detail__label"><label :for="`${id}-key`">{{ text("connection.key.label") }}</label><InfoTip :text="text('connection.key.hint')" /></span>
                        <button v-if="provider.key.kind === 'stored' || provider.key.kind === 'env'" type="button" class="provider-detail__link provider-detail__link--danger nb-ui-focus-ring" :disabled="disabled" data-key-clear @click="emit('clear-key')">{{ text("connection.key.clear") }}</button>
                    </div>
                    <Input
                        :id="`${id}-key`"
                        v-model="keyDraft"
                        :type="keyDraft.startsWith('env:') ? 'text' : 'password'"
                        size="sm"
                        :placeholder="keyPlaceholder"
                        :invalid="keyProblem !== ''"
                        :disabled="disabled"
                        autocomplete="off"
                        :aria-describedby="keyProblem !== '' ? `${id}-key-problem` : undefined"
                        data-key-input
                        @focusin="keyField.focus"
                        @focusout="commitKey(); keyField.blur()"
                        @keydown.enter="commitKey"
                    />
                    <p v-if="keyProblem !== ''" :id="`${id}-key-problem`" class="provider-detail__hint provider-detail__hint--error" role="alert" data-key-problem>{{ keyProblem }}</p>
                    <p v-else-if="keyNote !== ''" class="provider-detail__hint">{{ keyNote }}</p>
                </div>
                <div class="provider-detail__field">
                    <div class="provider-detail__field-head">
                        <span class="provider-detail__label"><label :for="`${id}-url`">{{ text("connection.url.label") }}</label><InfoTip :text="text('connection.url.hint', {url: requestUrl})" /></span>
                        <button v-if="overridden" type="button" class="provider-detail__link nb-ui-focus-ring" :disabled="disabled" data-url-restore @click="emit('update', {baseUrl: null})">{{ text("connection.url.restore") }}</button>
                    </div>
                    <Input
                        :id="`${id}-url`"
                        v-model="urlDraft"
                        size="sm"
                        :disabled="disabled"
                        :invalid="urlProblem !== ''"
                        :aria-describedby="urlProblem !== '' ? `${id}-url-problem` : undefined"
                        data-url-input
                        @focusin="urlField.focus"
                        @focusout="commitUrl(); urlField.blur()"
                        @keydown.enter="commitUrl"
                    />
                    <p v-if="urlProblem !== ''" :id="`${id}-url-problem`" class="provider-detail__hint provider-detail__hint--error" role="alert" data-url-problem>{{ urlProblem }}</p>
                    <p v-if="overridden" class="provider-detail__hint">{{ text("connection.url.overridden", {url: provider.templateBaseUrl ?? ""}) }} {{ text("connection.protocol.note") }}</p>
                </div>
                <div v-if="regionOptions.length > 0" class="provider-detail__field">
                    <div class="provider-detail__field-head"><span class="provider-detail__label">{{ text("connection.region.label") }}</span></div>
                    <Select :model-value="provider.region ?? regionOptions[0]!.value" :options="regionOptions" size="sm" :disabled="disabled" :aria-label="text('connection.region.label')" data-region-select @update:model-value="(value: string) => emit('update', {region: value})" />
                </div>
                <div class="provider-detail__field">
                    <div class="provider-detail__field-head"><span class="provider-detail__label">{{ text("connection.api.label") }}</span></div>
                    <div class="provider-detail__inline">
                        <Select class="provider-detail__grow" :model-value="provider.api ?? 'openai-completions'" :options="API_OPTIONS" size="sm" :disabled="disabled" :aria-label="text('connection.api.label')" data-api-select @update:model-value="changeApi" />
                        <!--
                            检测进行中换成“取消协议检测”：同一个按钮只换文字与动作（换成另一个元素焦点会掉），不停用。没有可用的密钥时停用，
                            原因写成看得见的字。
                        -->
                        <Button
                            :id="`${id}-detect`"
                            size="sm"
                            variant="secondary"
                            :icon-class="detecting ? 'i-lucide-square' : 'i-lucide-radar'"
                            :disabled="!detecting && (disabled || !keyReady)"
                            :data-api-detect-cancel="detecting ? '' : undefined"
                            :data-api-detect-start="detecting ? undefined : ''"
                            @click="detecting ? emit('cancel-detect') : startDetect()"
                        >{{ detecting ? text("connection.detect.cancel") : text("connection.detect.button") }}</Button>
                    </div>
                    <p v-if="!keyReady && !detecting" class="provider-detail__hint" data-api-detect-needs-key>{{ text("connection.detect.needsKey") }}</p>
                    <p v-if="apiChanged" class="provider-detail__hint" data-api-note>{{ text("connection.protocol.changed", {value: provider.templateApi ?? ""}) }} {{ text("connection.protocol.note") }}</p>
                    <ApiDetectResults :state="detect" :connection="provider.connection" :disabled="disabled" @adopt="(api, connection) => emit('adopt', api, connection)" @detect="detectWith" />
                </div>
                <Collapsible>
                    <template #trigger>
                        <button type="button" class="provider-detail__advanced nb-ui-focus-ring" data-provider-advanced>
                            <span class="i-lucide-chevron-right provider-detail__advanced-icon" aria-hidden="true" />
                            {{ text("connection.advanced") }}<span class="provider-detail__muted">{{ text("connection.advancedHint") }}</span>
                        </button>
                    </template>
                    <div class="provider-detail__advanced-body">
                        <div class="provider-detail__field">
                            <div class="provider-detail__field-head"><span class="provider-detail__label">{{ text("connection.auth.label") }}<InfoTip :text="text('connection.auth.hint')" /></span></div>
                            <Select :model-value="provider.auth" :options="authOptions" size="sm" :disabled="disabled" :aria-label="text('connection.auth.label')" @update:model-value="(value: string) => emit('update', {auth: value as ProviderPatch['auth']})" />
                        </div>
                        <div class="provider-detail__field">
                            <div class="provider-detail__field-head"><span class="provider-detail__label">{{ text("connection.headers.label") }}<InfoTip :text="text('connection.headers.hint')" /></span></div>
                            <HeadersEditor :key="resetToken" :headers="provider.headers" :disabled="disabled" @commit="(headers) => emit('update', {headers})" />
                        </div>
                    </div>
                </Collapsible>
            </div>
        </section>

        <section class="provider-detail__group">
            <div class="provider-detail__title provider-detail__title--actions">
                <h3>{{ text("models.title") }}</h3>
                <span class="provider-detail__muted">{{ text("models.enabled", {count: enabledCount}) }}</span>
                <span class="provider-detail__spacer" />
                <Button size="sm" variant="ghost" icon-class="i-lucide-list-checks" :disabled="disabled" data-models-manage @click="emit('manage')">{{ text("models.manage") }}</Button>
                <Button size="sm" variant="ghost" icon-class="i-lucide-plus" :disabled="disabled" data-models-add @click="emit('add-model')">{{ text("models.add") }}</Button>
                <span class="sr-only" role="status" data-models-check-announce>{{ checkAnnouncement }}</span>
                <span v-if="checkRun !== null" class="provider-detail__muted" data-models-check-progress>{{ text("models.checkProgress", {done: String(checkRun.done), total: String(checkRun.total)}) }}</span>
                <Button v-if="checking" size="sm" variant="ghost" icon-class="i-lucide-square" data-models-cancel @click="emit('cancel-checks')">{{ text("models.cancelChecks") }}</Button>
                <Button v-else size="sm" variant="ghost" icon-class="i-lucide-activity" :disabled="disabled || enabledCount === 0" data-models-check-all @click="emit('check-all')">{{ text("models.checkAll") }}</Button>
            </div>
            <div class="provider-detail__source" data-source-status>
                <p class="provider-detail__hint" :class="{'provider-detail__hint--error': sourceLine.error}" aria-live="polite">{{ sourceLine.text }}</p>
                <!-- 拉取进行中不停用：再点会与在途的那次合并，停用会让焦点掉到页面上。没有可用的密钥时停用，原因写成看得见的字。 -->
                <Button
                    size="sm"
                    variant="ghost"
                    icon-class="i-lucide-refresh-cw"
                    :disabled="disabled || !keyReady"
                    data-source-refresh
                    @click="emit('refresh-source')"
                >{{ text("models.source.refresh") }}</Button>
                <span v-if="!keyReady" class="provider-detail__hint" data-source-needs-key>{{ text("models.source.needsKey") }}</span>
            </div>
            <p v-if="sourceError !== ''" class="provider-detail__hint provider-detail__hint--error" role="alert" data-source-error>{{ sourceError }}</p>
            <label class="provider-detail__follow">
                <Switch :model-value="provider.followSource" size="sm" :disabled="disabled" :aria-label="text('models.follow.label')" data-follow-source @update:model-value="(value: boolean) => emit('update', {followSource: value})" />
                <span>{{ text("models.follow.label") }}<InfoTip :text="text('models.follow.hint')" /></span>
            </label>
            <p v-if="checkError !== ''" class="provider-detail__hint provider-detail__hint--error" role="alert" data-check-error>{{ checkError }}</p>
            <p v-if="rowsFailure !== ''" class="provider-detail__hint provider-detail__hint--error" role="alert" data-rows-failure>{{ text("models.loadFailed", {reason: rowsFailure}) }} <button type="button" class="provider-detail__link nb-ui-focus-ring" @click="emit('reload-rows')">{{ text("models.retry") }}</button></p>
            <Input v-if="rows.length > 8" v-model="search" size="sm" icon-class="i-lucide-search" :placeholder="text('models.search')" :aria-label="text('models.search')" data-models-search />
            <p v-if="rowsLoading && rows.length === 0" class="provider-detail__empty">{{ text("models.loading") }}</p>
            <p v-else-if="rows.length === 0 && rowsFailure === ''" class="provider-detail__empty">{{ text("models.empty") }}</p>
            <p v-else-if="needle !== '' && matched.length === 0" class="provider-detail__empty">{{ text("models.noMatch") }}</p>
            <section v-for="group in shown" :key="group.group" class="provider-detail__series">
                <button type="button" class="provider-detail__series-title nb-ui-focus-ring" :aria-expanded="group.open" :disabled="needle !== ''" @click="fold(group.group)">
                    <span :class="group.open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" aria-hidden="true" />
                    {{ group.group }}<span class="provider-detail__series-count">{{ group.models.length }}</span>
                </button>
                <ul v-if="group.open" class="provider-detail__models">
                    <ModelRow
                        v-for="model in group.rows"
                        :key="model.id"
                        :model="model"
                        :check="checks.get(checkKey(provider.id, model.id))"
                        :roles="roleUsage.get(model.id) ?? []"
                        :disabled="disabled"
                        @toggle="(enabled) => emit('toggle-model', model.id, enabled)"
                        @check="emit('check', model.id)"
                        @cancel="emit('cancel-check', model.id)"
                        @edit="emit('edit-model', model.id)"
                    />
                </ul>
            </section>
            <p v-if="hiddenCount > 0" class="provider-detail__hint" data-models-more>{{ text("models.more", {count: hiddenCount}) }}</p>
        </section>
    </div>
</template>

<style scoped>
.provider-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
}

.provider-detail__title {
    margin: 0 0 var(--space-2);
    padding-bottom: var(--space-4);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

/* 按钮放不下时（窄窗口、英文）换到下一行，不撑出页面。 */
.provider-detail__title--actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
}

.provider-detail__title--actions h3 {
    margin: 0;
    font: inherit;
    white-space: nowrap;
}

.provider-detail__title--actions > .provider-detail__muted {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.provider-detail__title--actions > :deep(button) {
    flex-shrink: 0;
}

.provider-detail__source {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-2);
}

.provider-detail__follow {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
}

.provider-detail__spacer {
    flex: 1;
}

/* 标签在上的表单（同旧应用的连接一节），宽度封顶，地址这类长值也放得下。 */
.provider-detail__form {
    display: flex;
    max-width: 560px;
    flex-direction: column;
    gap: var(--space-4);
    padding-top: var(--space-2);
}

.provider-detail__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.provider-detail__field-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
}

.provider-detail__label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}

.provider-detail__link {
    padding: 0;
    border: 0;
    background: none;
    font-size: var(--text-xs);
    color: var(--accent-text);
    cursor: pointer;
}

.provider-detail__link:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.provider-detail__link--danger {
    color: var(--status-danger);
}

.provider-detail__inline {
    display: flex;
    gap: 8px;
    align-items: center;
}

.provider-detail__grow {
    flex: 1 1 auto;
    min-width: 0;
}

.provider-detail__hint {
    margin: 0;
    /* 提示与检查失败的原文要能复制（nb-ui 规范的“文字能否选中”）。 */
    user-select: text;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.provider-detail__hint--error {
    color: var(--status-danger);
}

.provider-detail__advanced {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border: 0;
    background: none;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
    cursor: pointer;
}

.provider-detail__advanced-icon {
    transition: transform var(--motion-move) var(--ease-layout);
}

.provider-detail__advanced[data-state="open"] .provider-detail__advanced-icon {
    transform: rotate(90deg);
}

.provider-detail__advanced-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-3) 0 0 var(--space-5);
}

.provider-detail__muted {
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.provider-detail__empty {
    margin: var(--space-4) 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.provider-detail__series {
    margin-top: var(--space-2);
}

.provider-detail__series-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border: 0;
    background: none;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--text-secondary);
    cursor: pointer;
}

.provider-detail__series-count {
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.provider-detail__models {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}
</style>
