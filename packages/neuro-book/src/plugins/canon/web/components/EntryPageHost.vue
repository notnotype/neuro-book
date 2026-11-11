<script setup lang="ts">
/**
 * 条目页（docs/specs/canon/author-ui.md 输出 6 到 15、26、27）：按标签的状态（`context.state`，切走再回来还在）读世界，交给
 * `EntryPage` 与各分页的组件画。只读当前分页要的：文字分页读渲染，情节分页读变更，数据分页的界面经 `context` 自己读；展开一个
 * 值时才读它的来历。
 */
import {computed, watch} from "vue";
import type {Component} from "vue";

import type {FieldDeclaration, Placement, ReadPosition} from "@notnotype/nb-canon";
import {useText} from "@notnotype/nb-ui/text-port";

import {canonText} from "../../shared/text";
import type {CanonOutputs} from "../../shared/contracts";
import type {ComponentViewContext, ComponentViewRegistry} from "../component-views";
import type {EntryHead, EntryPageState} from "../entry-page";
import {useOriginPagesMap} from "../origin-pages";
import type {OriginsPage} from "../origin-pages";
import {changedMark, defaultPosition, placementLabel, positionExists, positionFromValue, positionLabel, positionOptions, positionValue} from "../positions";
import type {ChapterRef} from "../positions";
import {originRows, plotRows} from "../rows";
import {useCanonText} from "../text";
import {useWorldList, useWorldRead} from "../use-reads";
import type {CanonWorld} from "../world";
import EntryPage from "./EntryPage.vue";
import type {EntryPageStatus} from "./EntryPage.vue";
import EntryText from "./EntryText.vue";
import type {EntryTextBlock, TextAddress} from "./entry-text";
import {addressKey} from "./entry-text";
import FieldsDataView from "./FieldsDataView.vue";
import OriginList from "./OriginList.vue";
import PlotList from "./PlotList.vue";

const props = defineProps<{
    id: string;
    state: EntryPageState;
    world: CanonWorld;
    /** 一个地址的来历的一页；失败时 reject。 */
    fetchOrigins: (address: TextAddress, position: ReadPosition, mode: "actual" | "planned", cursor?: string) => Promise<OriginsPage>;
    views: ComponentViewRegistry;
    /** 打开条目页、变更详情页。 */
    open: (ref: {readonly kind: "entry" | "change"; readonly id: string}) => void;
    /** 读到页头时报给宿主：标签标题与面包屑用它。 */
    onHead: (head: EntryHead) => void;
}>();

const text = useCanonText();
const port = useText();
const state = props.state;
const world = props.world;

/* ---------- 章表与位置 ---------- */

const chaptersRead = useWorldRead(world, "chapters", () => ({}));
const chapters = computed<readonly ChapterRef[]>(() => chaptersRead.value?.data?.items ?? []);
const chaptersKnown = computed(() => chaptersRead.value?.data !== undefined);

// 选着的那一章被删掉：回到缺省位置并写一句（输出 7）。章表还没读到时不判断。
watch([() => state.position, chapters], () => {
    const chosen = state.position === null ? null : positionFromValue(state.position);
    if (chosen !== null && chaptersKnown.value && !positionExists(chosen, chapters.value)) {
        state.position = null;
        state.positionGone = true;
    }
}, {immediate: true});

// 那句说明留到作者再选一个位置为止。
watch(() => state.position, (now) => {
    if (now !== null) state.positionGone = false;
});

const position = computed<ReadPosition>(() => (state.position === null ? null : positionFromValue(state.position)) ?? defaultPosition(chapters.value));
const mode = computed(() => (state.planned ? "planned" as const : "actual" as const));
const place = (at: Placement): string => placementLabel(at, chapters.value, text);

/* ---------- 条目 ---------- */

const entryRead = useWorldRead(world, "entry", () => (chaptersKnown.value ? {id: props.id, position: position.value, mode: mode.value, withChangedAt: true} : null));
const entry = computed<CanonOutputs["entry"] | undefined>(() => entryRead.value?.data);
const view = computed(() => entry.value?.view ?? null);

const status = computed<EntryPageStatus>(() => {
    // 条目不存在是读成功、`view` 为 null；读取本身失败（还没读到过）是另一回事。读到过以后的失败留着旧内容（输出 26）。
    if (entry.value === undefined) return (entryRead.value?.error ?? null) !== null || (chaptersRead.value?.error ?? null) !== null ? "failed" : "loading";
    if (view.value === null) return "missing";
    return view.value.deleted ? "deleted" : "normal";
});

// 标签标题与面包屑写缺省位置、实际模式下的名字（输出 6），所以只有读的正是那里时才报；换到别的位置或按计划时不报。
watch(entry, (read) => {
    const shown = read?.view;
    if (shown === undefined || shown === null || state.position !== null || state.planned) return;
    props.onHead({name: shown.name, folder: read!.folder ?? "", ancestors: read!.ancestors ?? []});
}, {immediate: true});

const namespaces = computed(() => Object.keys(view.value?.namespaces ?? {}));
const componentsRead = useWorldRead(world, "components", () => ({}));
const typeLabel = (type: string): string => componentsRead.value?.data?.items.find((item) => item.id === type)?.label ?? type;

/* ---------- 情节分页 ---------- */

// 不论在哪个分页都读第一页：分页名后要写总条数（输出 15）。放在分页的计算之前，它们要读它。

const plot = useWorldList(world, "changes", () => (chaptersKnown.value && view.value !== null ? {filter: {entry: props.id, before: {position: position.value, mode: mode.value}, order: "desc" as const}} : null), 50);
const labelOfPath = (path: string): string => {
    const split = path.indexOf(".");
    return entry.value?.declarations?.[path.slice(0, split)]?.find((item) => item.id === path.slice(split + 1))?.label ?? path;
};
const plotState = computed(() => plot.state.value);

/* ---------- 分页 ---------- */

const DATA = "data:";
const tabs = computed(() => {
    const items: {value: string; label: string; count?: number}[] = [];
    if ((view.value?.text.length ?? 0) > 0) items.push({value: "text", label: text("entry.tabs.text")});
    for (const namespace of namespaces.value) {
        const type = view.value!.namespaces[namespace]!.type;
        const slot = props.views.view(type);
        items.push({value: `${DATA}${namespace}`, label: slot.status === "none" ? typeLabel(type) : port.t(slot.title)});
    }
    const total = plot.state.value?.data?.total;
    items.push({value: "plot", label: text("entry.tabs.plot"), ...(total === undefined ? {} : {count: total})});
    return items;
});
const tab = computed(() => (tabs.value.some((item) => item.value === state.tab) ? state.tab! : tabs.value[0]!.value));
const dataNamespace = computed(() => (tab.value.startsWith(DATA) ? tab.value.slice(DATA.length) : null));

/* ---------- 文字分页 ---------- */

const renderRead = useWorldRead(world, "render", () => (tab.value === "text" && chaptersKnown.value ? {entry: props.id, position: position.value, mode: mode.value, audience: "author" as const} : null));
const blocks = computed(() => (renderRead.value?.data?.blocks ?? []) as readonly EntryTextBlock[]);
const marks = computed(() => {
    const result: Record<string, string> = {};
    for (const [namespace, data] of Object.entries(view.value?.namespaces ?? {})) {
        for (const [field, fieldState] of Object.entries(data.fields)) {
            const mark = changedMark(fieldState.changedAt, place, text);
            if (mark !== null) result[`${namespace}.${field}`] = mark;
        }
    }
    return result;
});
const version = (): number => entry.value?.version ?? 0;
// 来历按位置算：版本、位置、模式任一变了都重读。
const originStamp = (): string => `${String(version())}|${JSON.stringify(position.value)}|${mode.value}`;
const originKeys = computed(() => (tab.value === "text" && state.origin !== null ? [state.origin] : []));
const origins = useOriginPagesMap(() => originKeys.value, (key) => {
    const split = key.indexOf("|");
    const address = {entry: key.slice(0, split), path: key.slice(split + 1)};
    return (cursor) => props.fetchOrigins(address, position.value, mode.value, cursor);
}, originStamp);
const openOrigin = computed(() => (state.origin === null ? undefined : origins.value.get(state.origin)?.state.value));
const declarationOf = (address: TextAddress): FieldDeclaration | undefined => {
    if (address.entry !== props.id) return undefined;
    const split = address.path.indexOf(".");
    return entry.value?.declarations?.[address.path.slice(0, split)]?.find((item) => item.id === address.path.slice(split + 1));
};
const labelOfAddress = (address: TextAddress): string => declarationOf(address)?.label ?? address.path;
const toggleValue = (address: TextAddress): void => {
    const key = addressKey(address);
    state.origin = state.origin === key ? null : key;
};

/* ---------- 数据分页 ---------- */

// 每个命名空间一份 context，换位置、世界变了以后同一个对象给出新的值；分页的状态在标签上（`state.views`）。
const contexts = new Map<string, ComponentViewContext>();
watch(namespaces, (list) => {
    for (const namespace of list) state.views[namespace] ??= {};
}, {immediate: true});
const contextFor = (namespace: string): ComponentViewContext => {
    let found = contexts.get(namespace);
    if (found === undefined) {
        found = {
            entry: props.id,
            namespace,
            get position() { return position.value; },
            get mode() { return mode.value; },
            get version() { return version(); },
            get fields() { return view.value?.namespaces[namespace]?.fields ?? {}; },
            get declarations() { return entry.value?.declarations?.[namespace] ?? []; },
            state: state.views[namespace] ?? {},
            // S5 接上写入以前，写入入口一律不可用（与只读、独占同一条路径）。
            blocked: canonText("entry.writeUnavailable"),
            place,
            origins: (path, cursor) => props.fetchOrigins({entry: props.id, path: `${namespace}.${path}`}, position.value, mode.value, cursor),
            edit: () => undefined,
            record: () => Promise.resolve({ok: false, reason: canonText("entry.writeUnavailable")}),
            open: props.open,
        };
        contexts.set(namespace, found);
    }
    return found;
};
/** 数据分页用哪个界面：交付了的专门界面；还在加载时先写“读取中”，不先画通用字段表再整块换掉；没有或失败时用通用字段表。 */
const dataView = computed<{readonly component: Component | null; readonly loading: boolean; readonly failed: string | null}>(() => {
    const namespace = dataNamespace.value;
    if (namespace === null) return {component: null, loading: false, failed: null};
    const slot = props.views.view(view.value!.namespaces[namespace]!.type);
    if (slot.status === "ready") return {component: slot.component, loading: false, failed: null};
    return {component: null, loading: slot.status === "loading", failed: slot.status === "failed" ? slot.reason : null};
});

/* ---------- 页头 ---------- */

const options = computed(() => positionOptions(chapters.value, text));
const notAppeared = computed(() => (view.value !== null && !view.value.appeared ? positionLabel(position.value, chapters.value, text) : ""));
const setPosition = (value: string): void => {
    state.position = positionFromValue(value) === null ? null : value;
};
</script>

<template>
    <EntryPage
        :status="status"
        :name="view?.name ?? ''"
        :summary="view?.summary ?? ''"
        :same-as="entry?.sameAs ?? null"
        :positions="options"
        :position="positionValue(position)"
        :planned="state.planned"
        :not-appeared="notAppeared"
        :position-gone="state.positionGone"
        :disconnected="world.connection.value === 'ended'"
        :tabs="tabs"
        :tab="tab"
        @update:position="setPosition"
        @update:planned="(value: boolean) => (state.planned = value)"
        @update:tab="(value: string) => (state.tab = value)"
        @open-entry="(id: string) => props.open({kind: 'entry', id})"
        @retry="world.retry()"
    >
        <EntryText
            v-if="tab === 'text'"
            :blocks="blocks"
            :self="props.id"
            :marks="marks"
            :open="state.origin ?? undefined"
            @value="toggleValue"
            @entry="(id: string) => props.open({kind: 'entry', id})"
        >
            <template #origin="{address}">
                <OriginList
                    v-if="openOrigin !== undefined"
                    :caption="text('origin.caption', {label: labelOfAddress(address)})"
                    :rows="originRows(openOrigin, declarationOf(address), place, text)"
                    :remaining="openOrigin.remaining"
                    :loading="openOrigin.loading"
                    :failed="openOrigin.failed"
                    :reason="openOrigin.reason"
                    @more="origins.get(state.origin!)?.more()"
                    @retry="origins.get(state.origin!)?.retry()"
                    @change="(id: string) => props.open({kind: 'change', id})"
                />
            </template>
        </EntryText>
        <PlotList
            v-else-if="tab === 'plot'"
            :rows="plotRows(plotState?.items ?? [], props.id, labelOfPath, place, text)"
            :remaining="Math.max(0, (plotState?.data?.total ?? 0) - (plotState?.items.length ?? 0))"
            :loading="plotState?.loading ?? true"
            :failed="(plotState?.error ?? null) !== null"
            @open="(id: string) => props.open({kind: 'change', id})"
            @more="plot.more()"
        />
        <template v-else-if="dataNamespace !== null">
            <p v-if="dataView.failed !== null" role="alert" class="mb-3 text-[length:var(--text-sm)] text-[var(--status-warning)]">{{ text("fields.viewFailed", {reason: dataView.failed}) }}</p>
            <p v-if="dataView.loading" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("entries.loading") }}</p>
            <component :is="dataView.component" v-else-if="dataView.component !== null" :key="dataNamespace" :context="contextFor(dataNamespace)" />
            <FieldsDataView v-else :key="dataNamespace" :context="contextFor(dataNamespace)" />
        </template>
    </EntryPage>
</template>
