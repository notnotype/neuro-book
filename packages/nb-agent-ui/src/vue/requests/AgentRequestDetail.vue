<script setup lang="ts">
/**
 * 选中那次请求的详情（docs/specs/agent/request-trace.md 输出 18、19、22）：顶部常驻的概览，下面几页。全文不随详情来，展开一行时
 * 发 `request.load-content`，宿主按哈希取回后经 `contents` 交来；原始请求体在打开那一页时才要。换一条记录时停在原来那一页。
 */
import {computed, ref, watch} from "vue";
import {Badge, Button, DropdownMenu, EmptyState, IconButton, Spinner, Tabs} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData, TabsItem} from "@notnotype/nb-ui/components";

import {formatClock} from "../../format";
import {cacheHitRate, compareRequests, formatBytes, formatCost, formatDuration, formatTokens, promptTokens} from "../../request-trace";
import type {RequestTraceAction, RequestTraceCompareView, RequestTraceContentState, RequestTraceDetail, RequestTraceDetailState, RequestTraceMessage, RequestTracePayloadView, RequestTracePurpose, RequestTraceRow, RequestTraceStatus} from "../../request-trace";
import {useAgentText} from "../text";
import AgentRequestJson from "./AgentRequestJson.vue";

const props = defineProps<{
    detail: RequestTraceDetailState;
    contents: Readonly<Record<string, RequestTraceContentState>>;
    payload: RequestTracePayloadView;
    /** 比较页：拿来比的那次与它的详情。 */
    compare: RequestTraceCompareView;
    /** 比较页可以换着比的：同一会话里更早的几次（新的在前）。 */
    compareCandidates: readonly RequestTraceRow[];
    /** 列表里紧挨着的新一次、旧一次（没有时为 null）。 */
    newer: string | null;
    older: string | null;
    /** 窄时只显示详情：顶上多一个回到列表的按钮。 */
    narrow: boolean;
    now: number;
}>();

const emit = defineEmits<{action: [action: RequestTraceAction]; back: []}>();

const {t, locale} = useAgentText();

type Tab = "messages" | "system" | "tools" | "compare" | "payload" | "response";
const tab = ref<Tab>("messages");
/** 展开了全文的条目：按“页、序号”记，同一段内容在两处出现时各自展开。换一条记录时收起。 */
const expanded = ref<ReadonlySet<string>>(new Set());

const value = computed<RequestTraceDetail | null>(() => (props.detail.state === "ready" ? props.detail.value : null));
/** 与前一次相同的前缀收成一行（Spec 输出 19），点开逐条列出。 */
const prefixOpen = ref(false);
watch(() => value.value?.id, () => {
    expanded.value = new Set();
    prefixOpen.value = false;
});

/** 收起的相同前缀有几条：只有一条时不收（收起来不比原来短）。 */
const folded = computed(() => {
    const previous = value.value?.previous;
    return previous !== undefined && previous.sharedPrefix > 1 && !prefixOpen.value ? previous.sharedPrefix : 0;
});
const shownMessages = computed(() => (value.value?.messages ?? []).slice(folded.value).map((message, offset) => ({message, index: folded.value + offset})));
/** 这次新加的从哪条起（前面画一条分隔线）；没有前一次或全是新的时不画。 */
const newFrom = computed(() => {
    const previous = value.value?.previous;
    return previous === undefined || previous.sharedPrefix === 0 ? null : previous.sharedPrefix;
});

const PURPOSE_TONE: Readonly<Record<RequestTracePurpose, "neutral" | "accent" | "warning" | "success">> = {turn: "neutral", compaction: "accent", approval: "warning", background: "success"};
const STATUS_ICON: Readonly<Record<RequestTraceStatus, string>> = {running: "i-lucide-loader", ok: "i-lucide-circle-check", error: "i-lucide-circle-x", aborted: "i-lucide-circle-slash", interrupted: "i-lucide-circle-dashed"};

const tabs = computed<TabsItem[]>(() => {
    const detail = value.value;
    return [
        {value: "messages", label: t("requests.tabs.messages"), ...(detail === null ? {} : {count: detail.messages.length + (detail.reply === undefined ? 0 : 1)})},
        {value: "system", label: t("requests.tabs.system")},
        {value: "tools", label: t("requests.tabs.tools"), ...(detail === null ? {} : {count: detail.tools.length})},
        {value: "compare", label: t("requests.tabs.compare")},
        {value: "payload", label: t("requests.tabs.payload")},
        {value: "response", label: t("requests.tabs.response")},
    ];
});

// 比较页缺省和前一次比：打开那一页、还没定拿哪一次来比时要前一次的详情。
watch([tab, () => value.value?.id], () => {
    const previous = value.value?.previous;
    if (tab.value === "compare" && previous !== undefined && props.compare.base === null) emit("action", {type: "request.compare-base", id: previous.id});
}, {immediate: true});

const baseDetail = computed(() => (props.compare.detail.state === "ready" ? props.compare.detail.value : null));
const comparison = computed(() => (value.value === null || baseDetail.value === null ? null : compareRequests(value.value, baseDetail.value)));
const candidateItems = computed<DropdownMenuItemData[]>(() => props.compareCandidates.map((row) => ({id: row.id, label: `#${String(row.request)} · ${formatClock(row.startedAt, locale.value)}`, type: "radio", group: "base", checked: row.id === props.compare.base})));

const compareLines = computed(() => {
    const compared = comparison.value;
    if (compared === null) return [];
    const {system, tools, messages, params} = compared;
    const messageLine = messages.compacted !== null ? t("requests.compare.compacted", {removed: messages.compacted})
        : messages.added.length === 0 && messages.removed.length === 0 ? t("requests.compare.same")
        : messages.removed.length === 0 && messages.suffix === 0 ? t("requests.compare.appended", {prefix: messages.prefix, added: messages.added.length})
        : t("requests.compare.replaced", {prefix: messages.prefix, suffix: messages.suffix, removed: messages.removed.length, added: messages.added.length});
    return [
        {key: "system", label: t("requests.compare.system"), text: system.same ? t("requests.compare.same") : t("requests.compare.systemChanged", {added: system.added.length, removed: system.removed.length}), changed: !system.same},
        {key: "tools", label: t("requests.compare.tools"), text: tools.added.length + tools.removed.length + tools.changed.length === 0 ? t("requests.compare.same") : t("requests.compare.toolsChanged", {added: tools.added.length, removed: tools.removed.length, changed: tools.changed.length}), changed: tools.added.length + tools.removed.length + tools.changed.length > 0},
        {key: "messages", label: t("requests.compare.messages"), text: messageLine, changed: messages.added.length + messages.removed.length > 0},
        {key: "params", label: t("requests.compare.params"), text: params.length === 0 ? t("requests.compare.same") : t("requests.compare.paramsChanged", {list: params.join(", ")}), changed: params.length > 0},
    ];
});

const firstChangeText = computed(() => {
    const first = comparison.value?.firstChange;
    if (first === undefined) return "";
    if (first === null) return t("requests.compare.unchanged");
    const where = first.kind === "message" ? t("requests.compare.firstMessage", {index: first.index}) : t(`requests.compare.${first.kind}`);
    return t("requests.compare.first", {where});
});

// 原始请求体在打开那一页时才要（它可能有几 MB）。
watch([tab, () => value.value?.id], () => {
    const detail = value.value;
    if (tab.value === "payload" && detail !== null && detail.payload.state === "present" && props.payload.state === "idle") emit("action", {type: "request.load-payload", id: detail.id});
}, {immediate: true});

const percent = (rate: number | null): string => (rate === null ? "—" : `${String(Math.round(rate * 100))}%`);

const facts = computed(() => {
    const detail = value.value;
    if (detail === null) return [];
    const usage = detail.usage;
    const rate = cacheHitRate(usage);
    return [
        {key: "model", label: t("requests.facts.model"), value: detail.answeredBy ?? detail.model, wide: true, title: detail.effort === undefined ? undefined : t("requests.facts.effort", {effort: detail.effort})},
        {key: "input", label: t("requests.facts.input"), value: usage === undefined ? "—" : formatTokens(promptTokens(usage))},
        {key: "output", label: t("requests.facts.output"), value: usage === undefined ? "—" : formatTokens(usage.output)},
        {key: "cache", label: t("requests.facts.cache"), value: usage === undefined || usage.cacheRead === 0 ? percent(rate) : t("requests.facts.cacheRead", {rate: percent(rate), value: formatTokens(usage.cacheRead)})},
        {key: "first", label: t("requests.facts.firstContent"), value: detail.firstContentAt === undefined ? "—" : formatDuration(detail.firstContentAt - detail.startedAt)},
        {key: "duration", label: t("requests.facts.duration"), value: formatDuration((detail.endedAt ?? props.now) - detail.startedAt)},
        {key: "cost", label: t("requests.facts.cost"), value: formatCost(usage?.cost) ?? "—"},
        {key: "http", label: t("requests.facts.http"), value: [detail.http === undefined ? "—" : String(detail.http), detail.stopReason].filter(Boolean).join(" · ")},
    ];
});

const sessionLine = computed(() => {
    const detail = value.value;
    if (detail === null) return "";
    const turn = detail.background !== undefined ? t("requests.group.background") : detail.turn === undefined ? t("requests.group.outside") : t("requests.group.turn", {index: detail.turn.index});
    return [detail.title ?? t("requests.filter.untitled"), turn, detail.profile].filter(Boolean).join(" · ");
});

/** 扩展 id 与字段名都是代码里的英文标识符，用不随语言变的写法连起来。 */
const modifiedBy = computed(() => value.value?.modifiedBy.map((item) => `${item.extension}: ${item.fields.join(", ")}`).join("; ") ?? "");

function toggle(key: string, hash: string): void {
    const next = new Set(expanded.value);
    if (next.has(key)) next.delete(key);
    else {
        next.add(key);
        if (!Object.hasOwn(props.contents, hash)) emit("action", {type: "request.load-content", hash});
    }
    expanded.value = next;
}

type Piece = {readonly kind: "text" | "thinking" | "image" | "call" | "json"; readonly text: string};

/** 记录器存下的内容（一条消息、一段系统提示词、一个工具声明、一份回复）换成要显示的几段。 */
function piecesOf(text: string): Piece[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return [{kind: "text", text}];
    }
    const object = parsed as {content?: unknown; toolCalls?: unknown; kind?: unknown; text?: unknown; description?: unknown; parameters?: unknown};
    const pieces: Piece[] = [];
    const blocks = Array.isArray(object.content) ? object.content : typeof object.kind === "string" ? [object] : [];
    for (const block of blocks as {kind?: string; text?: string; mime?: string; bytes?: number; uri?: string}[]) {
        if (block.kind === "text" && typeof block.text === "string") pieces.push({kind: "text", text: block.text});
        else if (block.kind === "thinking" && typeof block.text === "string") pieces.push({kind: "thinking", text: block.text});
        else if (block.kind === "image") pieces.push({kind: "image", text: `${block.mime ?? "image"} · ${formatBytes(block.bytes ?? 0)}`});
        else if (block.kind === "imageRef") pieces.push({kind: "image", text: block.uri ?? ""});
    }
    if (Array.isArray(object.toolCalls)) for (const call of object.toolCalls as {tool?: string; args?: unknown}[]) pieces.push({kind: "call", text: `${call.tool ?? ""} ${JSON.stringify(call.args ?? {}, null, 2)}`});
    if (typeof object.description === "string") pieces.push({kind: "text", text: object.description});
    if (object.parameters !== undefined) pieces.push({kind: "json", text: JSON.stringify(object.parameters, null, 2)});
    return pieces;
}

const parsed = computed(() => {
    const result = new Map<string, Piece[]>();
    for (const [hash, content] of Object.entries(props.contents)) if (content.state === "ready") result.set(hash, piecesOf(content.text));
    return result;
});

function messageNote(message: RequestTraceMessage): string {
    const parts: string[] = [];
    for (const call of message.toolCalls ?? []) parts.push(t("requests.message.call", {tool: call.tool}));
    if (message.callId !== undefined) parts.push(t("requests.message.resultOf", {id: message.callId}));
    if (message.isError === true) parts.push(t("requests.message.failed"));
    if (message.images > 0) parts.push(t("requests.message.images", {count: message.images}));
    return parts.join(" · ");
}

const lastAttempt = computed(() => value.value?.attemptList.at(-1));
</script>

<template>
    <section class="ard" :aria-label="t('requests.detail.label')">
        <div v-if="narrow" class="ard__back">
            <Button variant="ghost" size="sm" icon-class="i-lucide-arrow-left" data-request-back @click="emit('back')">{{ t("requests.detail.back") }}</Button>
        </div>

        <div v-if="detail.state !== 'ready'" class="ard__state" :role="detail.state === 'loading' ? 'status' : detail.state === 'error' ? 'alert' : undefined" :aria-busy="detail.state === 'loading' || undefined">
            <EmptyState v-if="detail.state === 'loading'" :title="t('requests.detail.loading')">
                <template #icon><Spinner size="md" /></template>
            </EmptyState>
            <EmptyState v-else-if="detail.state === 'missing'" icon-class="i-lucide-file-question" :title="t('requests.detail.missing')" />
            <EmptyState v-else-if="detail.state === 'error'" icon-class="i-lucide-circle-alert" :title="t('requests.detail.error')">
                <template #action><Button size="sm" variant="secondary" @click="emit('action', {type: 'request.retry-detail'})">{{ t("requests.list.retry") }}</Button></template>
            </EmptyState>
        </div>

        <template v-else-if="value !== null">
            <div class="ard__overview">
                <div class="ard__head">
                    <span class="ard__status" :data-status="value.status" role="img" :aria-label="t(`requests.status.${value.status}`)"><span :class="STATUS_ICON[value.status]" aria-hidden="true"></span></span>
                    <span class="ard__title">{{ t("requests.detail.title", {number: value.request}) }}</span>
                    <Badge size="sm" variant="soft" :tone="PURPOSE_TONE[value.purpose]">{{ t(`requests.purpose.${value.purpose}`) }}</Badge>
                    <span class="ard__when">{{ t(`requests.status.${value.status}`) }} · {{ formatClock(value.startedAt, locale) }}</span>
                    <Badge v-if="value.resend !== undefined" size="sm" variant="outline">{{ t("requests.detail.resend", {count: value.resend}) }}</Badge>
                    <span class="ard__actions">
                        <IconButton size="xs" icon-class="i-lucide-chevron-up" :aria-label="t('requests.detail.newer')" :title="t('requests.detail.newer')" :disabled="newer === null" data-request-newer @click="newer !== null && emit('action', {type: 'request.select', id: newer})" />
                        <IconButton size="xs" icon-class="i-lucide-chevron-down" :aria-label="t('requests.detail.older')" :title="t('requests.detail.older')" :disabled="older === null" data-request-older @click="older !== null && emit('action', {type: 'request.select', id: older})" />
                        <IconButton size="xs" icon-class="i-lucide-messages-square" :aria-label="t('requests.detail.openSession')" :title="t('requests.detail.openSession')" @click="emit('action', {type: 'request.open-session', session: value.background?.owner ?? value.session})" />
                        <IconButton size="xs" icon-class="i-lucide-copy" :aria-label="t('requests.detail.copy')" :title="t('requests.detail.copy')" @click="emit('action', {type: 'request.copy', id: value.id, what: 'request'})" />
                    </span>
                </div>
                <div class="ard__session" :title="sessionLine">{{ sessionLine }}</div>
                <div v-if="value.errorMessage !== undefined" class="ard__error" role="alert"><span class="i-lucide-circle-x" aria-hidden="true"></span><span>{{ value.errorMessage }}</span></div>
                <dl class="ard__facts">
                    <div v-for="fact in facts" :key="fact.key" class="ard__fact" :data-wide="fact.wide || undefined" :title="fact.title">
                        <dt>{{ fact.label }}</dt>
                        <dd>{{ fact.value }}</dd>
                    </div>
                </dl>
                <div v-if="modifiedBy !== ''" class="ard__modified"><span class="i-lucide-puzzle" aria-hidden="true"></span>{{ t("requests.detail.modifiedBy", {list: modifiedBy}) }}</div>
            </div>

            <Tabs class="ard__tabs" size="sm" overflow="adapt" :model-value="tab" :items="tabs" :aria-label="t('requests.detail.label')" @update:model-value="tab = $event as Tab" />

            <div class="ard__body nb-ui-scrollbar-thin nb-ui-scrollbar-stable" data-request-body>
                <ol v-if="tab === 'messages'" class="ard__items">
                    <li v-if="value.messages.length === 0 && value.reply === undefined" class="ard__none">{{ t("requests.message.empty") }}</li>
                    <li v-if="folded > 0" class="ard__item">
                        <button type="button" class="ard__item-head ard__item-head--fold" :aria-expanded="false" data-request-prefix @click="prefixOpen = true">
                            <span class="ard__index"><span class="i-lucide-chevrons-up-down" aria-hidden="true"></span></span>
                            <span class="ard__preview ard__muted">{{ t("requests.message.samePrefix", {last: folded, request: value.previous!.request}) }}</span>
                        </button>
                    </li>
                    <template v-for="{message, index} in shownMessages" :key="`m${index}`">
                    <li v-if="newFrom !== null && index === newFrom" class="ard__divider" role="separator"><span>{{ t("requests.message.newHere") }}</span></li>
                    <li class="ard__item" :data-role="message.role">
                        <button type="button" class="ard__item-head" :aria-expanded="expanded.has(`m${index}`)" @click="toggle(`m${index}`, message.hash)">
                            <span class="ard__index">{{ index + 1 }}</span>
                            <span class="ard__role">{{ t(`requests.role.${message.role}`) }}</span>
                            <span class="ard__preview">{{ message.missing === true ? t("requests.message.missing") : message.preview }}</span>
                            <span class="ard__note">{{ messageNote(message) }}</span>
                            <span class="ard__tokens">{{ t("requests.message.tokens", {value: formatTokens(message.tokens)}) }}</span>
                        </button>
                        <div v-if="expanded.has(`m${index}`)" class="ard__full">
                            <template v-if="contents[message.hash]?.state === 'ready'">
                                <div v-for="(piece, pieceIndex) in parsed.get(message.hash)" :key="pieceIndex" class="ard__piece" :data-kind="piece.kind">{{ piece.text }}</div>
                            </template>
                            <span v-else-if="contents[message.hash]?.state === 'missing'" class="ard__muted">{{ t("requests.message.missing") }}</span>
                            <span v-else class="ard__muted">{{ t("requests.message.loading") }}</span>
                        </div>
                    </li>
                    </template>
                    <li v-if="value.reply !== undefined" class="ard__item ard__item--reply" data-role="reply">
                        <button type="button" class="ard__item-head" :aria-expanded="expanded.has('reply')" @click="toggle('reply', value.reply.hash)">
                            <span class="ard__index"><span class="i-lucide-corner-down-right" aria-hidden="true"></span></span>
                            <span class="ard__role">{{ t("requests.role.reply") }}</span>
                            <span class="ard__preview">{{ value.reply.preview }}</span>
                            <span class="ard__note">{{ messageNote(value.reply) }}</span>
                            <span class="ard__tokens">{{ t("requests.message.tokens", {value: formatTokens(value.usage?.output ?? value.reply.tokens)}) }}</span>
                        </button>
                        <div v-if="expanded.has('reply')" class="ard__full">
                            <template v-if="contents[value.reply.hash]?.state === 'ready'">
                                <div v-for="(piece, pieceIndex) in parsed.get(value.reply.hash)" :key="pieceIndex" class="ard__piece" :data-kind="piece.kind">{{ piece.text }}</div>
                            </template>
                            <span v-else class="ard__muted">{{ t("requests.message.loading") }}</span>
                        </div>
                    </li>
                </ol>

                <ol v-else-if="tab === 'system' || tab === 'tools'" class="ard__items">
                    <li v-for="(item, index) in tab === 'system' ? value.system : value.tools" :key="`${tab}${index}`" class="ard__item">
                        <button type="button" class="ard__item-head" :aria-expanded="expanded.has(`${tab}${index}`)" @click="toggle(`${tab}${index}`, item.hash)">
                            <span class="ard__index">{{ index + 1 }}</span>
                            <span v-if="'id' in item" class="ard__role ard__role--code">{{ item.id }}</span>
                            <span class="ard__preview">{{ item.missing === true ? t("requests.message.missing") : "id" in item ? item.description : item.preview }}</span>
                            <span v-if="'tokens' in item" class="ard__tokens">{{ t("requests.message.tokens", {value: formatTokens(item.tokens)}) }}</span>
                        </button>
                        <div v-if="expanded.has(`${tab}${index}`)" class="ard__full">
                            <template v-if="contents[item.hash]?.state === 'ready'">
                                <div v-for="(piece, pieceIndex) in parsed.get(item.hash)" :key="pieceIndex" class="ard__piece" :data-kind="piece.kind">{{ piece.text }}</div>
                            </template>
                            <span v-else-if="contents[item.hash]?.state === 'missing'" class="ard__muted">{{ t("requests.message.missing") }}</span>
                            <span v-else class="ard__muted">{{ t("requests.message.loading") }}</span>
                        </div>
                    </li>
                </ol>

                <div v-else-if="tab === 'compare'" class="ard__raw" data-request-compare>
                    <div v-if="value.previous === undefined && compare.base === null" class="ard__muted">{{ t("requests.compare.none") }}</div>
                    <template v-else>
                        <div class="ard__raw-head">
                            <span>{{ t("requests.compare.base", {request: baseDetail?.request ?? value.previous?.request ?? "—"}) }}</span>
                            <DropdownMenu v-if="candidateItems.length > 1" :items="candidateItems" align="end" @select="(id: string) => emit('action', {type: 'request.compare-base', id})">
                                <Button variant="ghost" size="sm" icon-class="i-lucide-chevrons-up-down">{{ t("requests.compare.pick") }}</Button>
                            </DropdownMenu>
                        </div>
                        <span v-if="compare.detail.state === 'loading' || compare.detail.state === 'idle'" class="ard__muted">{{ t("requests.compare.loading") }}</span>
                        <span v-else-if="compare.detail.state !== 'ready'" class="ard__muted">{{ t("requests.compare.error") }}</span>
                        <template v-else-if="comparison !== null && baseDetail !== null">
                            <dl class="ard__compare">
                                <div v-for="line in compareLines" :key="line.key" class="ard__compare-line" :data-changed="line.changed || undefined">
                                    <dt>{{ line.label }}</dt>
                                    <dd>{{ line.text }}</dd>
                                </div>
                            </dl>
                            <div class="ard__muted">{{ t("requests.compare.cache", {current: percent(cacheHitRate(value.usage)), base: percent(cacheHitRate(baseDetail.usage))}) }} · {{ firstChangeText }}</div>
                            <template v-if="comparison.messages.removed.length > 0">
                                <h4 class="ard__h">{{ t("requests.compare.removed") }}</h4>
                                <ol class="ard__items">
                                    <li v-for="(message, index) in comparison.messages.removed" :key="`r${index}`" class="ard__item ard__item--removed">
                                        <div class="ard__item-head"><span class="ard__index">−</span><span class="ard__role">{{ t(`requests.role.${message.role}`) }}</span><span class="ard__preview">{{ message.preview }}</span><span class="ard__tokens">{{ t("requests.message.tokens", {value: formatTokens(message.tokens)}) }}</span></div>
                                    </li>
                                </ol>
                            </template>
                            <template v-if="comparison.messages.added.length > 0">
                                <h4 class="ard__h">{{ t("requests.compare.added") }}</h4>
                                <ol class="ard__items">
                                    <li v-for="(message, index) in comparison.messages.added" :key="`a${index}`" class="ard__item ard__item--added">
                                        <div class="ard__item-head"><span class="ard__index">+</span><span class="ard__role">{{ t(`requests.role.${message.role}`) }}</span><span class="ard__preview">{{ message.preview }}</span><span class="ard__tokens">{{ t("requests.message.tokens", {value: formatTokens(message.tokens)}) }}</span></div>
                                    </li>
                                </ol>
                            </template>
                        </template>
                    </template>
                </div>

                <div v-else-if="tab === 'payload'" class="ard__raw">
                    <div v-if="value.payload.state !== 'present'" class="ard__muted" data-request-payload-reason>{{ t(`requests.payload.${value.payload.state}`) }}</div>
                    <template v-else>
                        <div class="ard__raw-head">
                            <span>{{ t("requests.payload.size", {size: formatBytes(value.payload.bytes)}) }}</span>
                            <IconButton size="xs" icon-class="i-lucide-copy" :aria-label="t('requests.payload.copy')" :title="t('requests.payload.copy')" :disabled="payload.state !== 'ready'" @click="emit('action', {type: 'request.copy', id: value.id, what: 'payload'})" />
                        </div>
                        <AgentRequestJson v-if="payload.state === 'ready'" :text="payload.text" />
                        <span v-else-if="payload.state === 'missing'" class="ard__muted">{{ t("requests.payload.pruned") }}</span>
                        <span v-else-if="payload.state === 'error'" class="ard__muted">{{ t("requests.payload.error") }}</span>
                        <span v-else class="ard__muted">{{ t("requests.payload.loading") }}</span>
                    </template>
                </div>

                <div v-else class="ard__raw">
                    <div v-if="value.attemptList.length === 0" class="ard__muted">{{ t("requests.response.none") }}</div>
                    <template v-else>
                        <h4 class="ard__h">{{ t("requests.response.attempts") }}</h4>
                        <ol class="ard__attempts">
                            <li v-for="(attempt, index) in value.attemptList" :key="index" class="ard__attempt" :data-failed="attempt.status === undefined || attempt.status >= 400 || undefined">
                                <span class="ard__attempt-status">{{ attempt.status ?? "—" }}</span>
                                <span class="ard__attempt-url" :title="attempt.url">{{ attempt.url }}</span>
                                <span class="ard__attempt-time">{{ formatDuration(attempt.endedAt - attempt.startedAt) }}</span>
                                <span v-if="attempt.error !== undefined" class="ard__attempt-error">{{ t("requests.response.networkError", {message: attempt.error}) }}</span>
                            </li>
                        </ol>
                        <template v-if="lastAttempt?.responseHeaders !== undefined">
                            <h4 class="ard__h">{{ t("requests.response.headers") }}</h4>
                            <AgentRequestJson :text="JSON.stringify(lastAttempt.responseHeaders)" />
                        </template>
                        <template v-if="lastAttempt?.requestHeaders !== undefined">
                            <h4 class="ard__h">{{ t("requests.response.requestHeaders") }}</h4>
                            <AgentRequestJson :text="JSON.stringify(lastAttempt.requestHeaders)" />
                        </template>
                    </template>
                </div>
            </div>
        </template>
    </section>
</template>

<style scoped>
.ard {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
}
.ard__back {
    flex: none;
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--divider);
}
.ard__state {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
}
.ard__overview {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-2) var(--space-3);
}
.ard__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
}
.ard__status {
    display: inline-flex;
    color: var(--status-success);
}
.ard__status[data-status="error"] { color: var(--status-danger); }
.ard__status[data-status="aborted"] { color: var(--status-warning); }
.ard__status[data-status="running"],
.ard__status[data-status="interrupted"] { color: var(--text-muted); }
.ard__title {
    flex: none;
    font-weight: var(--weight-medium);
}
.ard__when {
    overflow: hidden;
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ard__actions {
    display: inline-flex;
    flex: none;
    gap: 2px;
    margin-left: auto;
}
.ard__session {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ard__error {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    color: var(--status-danger);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
}
.ard__facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 4px var(--space-3);
    margin: 0;
}
.ard__fact[data-wide] {
    grid-column: span 2;
}
.ard__fact dt {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}
.ard__fact dd {
    overflow: hidden;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ard__modified {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.ard__tabs {
    flex: none;
    padding-inline: var(--space-3);
}
.ard__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-2) var(--space-3) var(--space-3);
}
.ard__items {
    margin: 0;
    padding: 0;
    list-style: none;
}
.ard__item + .ard__item {
    border-top: 1px solid var(--divider);
}
.ard__item-head {
    display: grid;
    grid-template-columns: 2.4em auto minmax(0, 1fr) auto auto;
    gap: var(--space-2);
    /* 几列字号不同：按基线对齐，小字的序号与 token 数才和正文在同一行上。 */
    align-items: baseline;
    width: 100%;
    min-height: 30px;
    padding: 4px 2px;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
}
.ard__item-head:hover {
    background: color-mix(in srgb, var(--text-main) 4%, transparent);
}
.ard__index {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-align: right;
}
.ard__role {
    flex: none;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
}
.ard__role--code {
    font-family: var(--font-mono);
}
.ard__preview {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ard__note {
    overflow: hidden;
    max-width: 12em;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ard__tokens {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    white-space: nowrap;
}
.ard__full {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 2px 2px var(--space-2) calc(2.4em + var(--space-2));
}
.ard__piece {
    font-size: var(--text-sm);
    line-height: 1.6;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
.ard__piece[data-kind="thinking"] {
    color: var(--text-secondary);
}
.ard__piece[data-kind="image"] {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.ard__piece[data-kind="call"],
.ard__piece[data-kind="json"] {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}
.ard__muted,
.ard__none {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.ard__raw {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}
.ard__raw-head {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.ard__h {
    margin: var(--space-2) 0 0;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
}
/* 窄时补充说明让给预览：展开这一行时全文里照样有。 */
@container (max-width: 559px) {
    .ard__note {
        display: none;
    }
}
.ard__divider {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: 6px 0 2px;
    color: var(--accent-text);
    font-size: var(--text-2xs);
}
.ard__divider::after {
    flex: 1 1 auto;
    height: 1px;
    background: var(--border-accent);
    content: "";
}
.ard__compare {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 4px var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
}
.ard__compare-line {
    display: contents;
}
.ard__compare-line dt {
    color: var(--text-muted);
}
.ard__compare-line dd {
    margin: 0;
    overflow-wrap: anywhere;
}
.ard__compare-line[data-changed] dd {
    color: var(--status-warning);
}
.ard__item--removed .ard__index {
    color: var(--status-danger);
}
.ard__item--added .ard__index {
    color: var(--status-success);
}
.ard__attempts {
    margin: 0;
    padding: 0;
    list-style: none;
}
.ard__attempt {
    display: grid;
    grid-template-columns: 3em minmax(0, 1fr) auto;
    gap: var(--space-2);
    padding: 2px 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}
.ard__attempt[data-failed] .ard__attempt-status {
    color: var(--status-danger);
}
.ard__attempt-url {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ard__attempt-time {
    color: var(--text-muted);
}
.ard__attempt-error {
    grid-column: 2 / -1;
    color: var(--status-danger);
    overflow-wrap: anywhere;
}
</style>
