<script setup lang="ts">
/**
 * 条目页（docs/specs/canon/author-ui.md 输出 6 到 15、26、27）：按标签的状态（`context.state`，切走再回来还在）读世界，交给
 * `EntryPage` 与各分页的组件画。只读当前分页要的：文字分页读渲染，情节分页读变更，数据分页的界面经 `context` 自己读；展开一个
 * 值时才读它的来历。
 */
import {computed, defineComponent, h, nextTick, shallowRef, watch} from "vue";
import type {Component, PropType} from "vue";

import type {Entry, EntryOp, FieldDeclaration, FieldState, Placement, ReadPosition} from "@notnotype/nb-canon";
import {Dialog, Select} from "@notnotype/nb-ui/components";
import type {Text} from "@notnotype/nb-ui/text";
import {useText} from "@notnotype/nb-ui/text-port";

import {canonText} from "../../shared/text";
import type {CanonClient, CanonOutputs} from "../../shared/contracts";
import type {EntryTabDeclaration} from "../../shared/entry-tabs";
import type {ComponentViewContext, ComponentViewRegistry, EntryTabContext} from "../component-views";
import type {EntryHead, EntryPageState, PageLine} from "../entry-page";
import {useInPlaceEdit} from "../in-place-edit";
import {usePageNotice} from "../notices";
import type {CanonNotices} from "../notices";
import {useOriginPagesMap} from "../origin-pages";
import type {OriginsPage} from "../origin-pages";
import {chapterLine, changedMark, defaultPosition, placementLabel, positionExists, positionFromValue, positionLabel, positionOptions, positionValue} from "../positions";
import type {ChapterRef} from "../positions";
import {originRows, plotRows} from "../rows";
import {useCanonText} from "../text";
import {useWorldList, useWorldRead} from "../use-reads";
import type {RevertRequests} from "../revert";
import {readOnlyBanner, writeBlocked} from "../writable";
import {failureText} from "../failures";
import type {CanonWorld} from "../world";
import ConfirmBar from "./ConfirmBar.vue";
import EntryPage from "./EntryPage.vue";
import type {EntryPageStatus} from "./EntryPage.vue";
import EntryText from "./EntryText.vue";
import type {EntryTextBlock, TextAddress} from "./entry-text";
import {addressKey} from "./entry-text";
import FieldsDataView from "./FieldsDataView.vue";
import AgentNotice from "./AgentNotice.vue";
import NoticeBar from "./NoticeBar.vue";
import MoveDialog from "./MoveDialog.vue";
import type {MoveDraft} from "./move-dialog";
import {useEntryFind} from "./entry-picker";
import OriginList from "./OriginList.vue";
import PlotList from "./PlotList.vue";

const props = defineProps<{
    id: string;
    state: EntryPageState;
    world: CanonWorld;
    /** 一个地址的来历的一页；失败时 reject。 */
    fetchOrigins: (address: TextAddress, position: ReadPosition, mode: "actual" | "planned", cursor?: string) => Promise<OriginsPage>;
    /**
     * 世界客户端的读取（预览、读一个对象）。包在对象里传：直接写 `CanonClient["call"]` 时单文件组件的编译器把运行时类型
     * 推成了 Promise。
     */
    client: Pick<CanonClient, "call">;
    /** 窗口在看的线（输出 34）：空串是跟着章，读取位置不写线。 */
    windowLine: PageLine;
    views: ComponentViewRegistry;
    /** 附加分页（输出 36）。 */
    entryTabs: ComponentViewRegistry<EntryTabDeclaration>;
    /** 本窗口的保存后的提示。 */
    notices: CanonNotices;
    /** 本窗口的还原对话框（提示里的“撤销”）。 */
    revert: RevertRequests;
    /** 打开条目页、变更详情页。 */
    open: (ref: {readonly kind: "entry" | "change"; readonly id: string}) => void;
    /** 打开一次修订的回执页。 */
    receipt: (revision: string) => void;
    /** 读到页头时报给宿主：标签标题与面包屑用它。 */
    onHead: (head: EntryHead) => void;
}>();

const text = useCanonText();
const port = useText();
const state = props.state;
const world = props.world;
// 挂着就是在前台：保存后的提示显示在本页顶上（输出 18）。
const pageNotice = usePageNotice(props.notices, props.revert);

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

const windowLine = computed(() => props.windowLine.line.value);
// 窗口选了线时读取位置都带上它（输出 34）；换线不改这一页自己的位置。
const position = computed<ReadPosition>(() => {
    const base = (state.position === null ? null : positionFromValue(state.position)) ?? defaultPosition(chapters.value);
    return windowLine.value === "" ? base : {...base, line: windowLine.value};
});
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

// 标签标题与面包屑写缺省位置、实际模式下的名字（输出 6），不带窗口的线（输出 34）：跟着章时就是这一页正在读的那份，只有读的
// 正是那里时才报；窗口选了线时另读一份缺省位置的。
const headRead = useWorldRead(world, "entry", () => (windowLine.value !== "" && chaptersKnown.value ? {id: props.id, position: defaultPosition(chapters.value), mode: "actual" as const} : null));
const headSource = computed(() => {
    if (windowLine.value !== "") return headRead.value?.data;
    return state.position === null && !state.planned ? entry.value : undefined;
});
watch(headSource, (read) => {
    const shown = read?.view;
    if (shown === undefined || shown === null) return;
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
const EXTRA = "extra:";
/** 这个条目在所选位置上启用的附加分页（输出 36）：`requires` 的类型启用了才出，按 `order` 再按贡献 id。 */
const extraTabs = computed(() => {
    const enabled = new Set(Object.values(view.value?.namespaces ?? {}).map((namespace) => namespace.type));
    return props.entryTabs.entries()
        .filter((item) => enabled.has(item.declaration.requires))
        .sort((a, b) => (a.declaration.order ?? 0) - (b.declaration.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
});
const tabs = computed(() => {
    const items: {value: string; label: string; count?: number}[] = [];
    if ((view.value?.text.length ?? 0) > 0) items.push({value: "text", label: text("entry.tabs.text")});
    for (const namespace of namespaces.value) {
        const type = view.value!.namespaces[namespace]!.type;
        const slot = props.views.view(type);
        items.push({value: `${DATA}${namespace}`, label: slot.status === "none" ? typeLabel(type) : port.t(slot.title)});
    }
    // 声明经约定键补全过，`title` 总在。
    for (const item of extraTabs.value) items.push({value: `${EXTRA}${item.id}`, label: port.t(item.declaration.title!)});
    const total = plot.state.value?.data?.total;
    items.push({value: "plot", label: text("entry.tabs.plot"), ...(total === undefined ? {} : {count: total})});
    return items;
});
const tab = computed(() => (tabs.value.some((item) => item.value === state.tab) ? state.tab! : tabs.value[0]!.value));
const dataNamespace = computed(() => (tab.value.startsWith(DATA) ? tab.value.slice(DATA.length) : null));
const extraTab = computed(() => (tab.value.startsWith(EXTRA) ? tab.value.slice(EXTRA.length) : null));

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

/* ---------- 写入 ---------- */

// 写不了的原因（输出 27、28）；就地改另外只在实际模式下可用（输出 16）。
const blocked = computed(() => writeBlocked(world));
const readOnly = computed(() => readOnlyBanner(world));
const editBlocked = computed(() => (state.planned ? canonText("blocked.planned") : blocked.value));
/** 条目自己的名字与简介当作两个文字字段，确认条照字段的写法改它们（输出 16、页头的改名）。 */
const HEAD_FIELDS: Readonly<Record<string, {readonly key: "name" | "summary"; readonly label: string}>> = {"entry.name": {key: "name", label: "entry.nameLabel"}, "entry.summary": {key: "summary", label: "entry.summaryLabel"}};
const fieldAt = (path: string) => {
    const head = HEAD_FIELDS[path];
    if (head !== undefined) {
        const value = view.value?.[head.key];
        return {state: value === undefined ? undefined : ({value} as FieldState), declaration: {id: head.key, label: port.t(text(head.label as never)), kind: "text"} as FieldDeclaration};
    }
    const split = path.indexOf(".");
    const namespace = path.slice(0, split);
    const field = path.slice(split + 1);
    return {state: view.value?.namespaces[namespace]?.fields[field], declaration: entry.value?.declarations?.[namespace]?.find((item) => item.id === field)};
};
const edit = useInPlaceEdit({
    world,
    call: props.client.call,
    entry: props.id,
    draft: () => state.edit,
    setDraft: (draft) => {
        state.edit = draft;
    },
    position: () => position.value,
    version,
    field: fieldAt,
    place,
    blocked: () => editBlocked.value,
    text,
    resolve: (given) => port.t(given),
    saved: (published, title) => props.notices.show({revision: published.revision, title}),
    refocus: (path) => {
        // 确认条关掉以后再找：按钮在数据分页里，确认条关掉不会卸载它。
        void nextTick(() => document.querySelector<HTMLElement>(`[data-edit="${CSS.escape(path)}"]`)?.focus());
    },
    accumulated: (path) => {
        // 累出来的数：展开它的来历（字段表展开那一行，面板选中那张卡）。
        const namespace = path.slice(0, path.indexOf("."));
        const bag = state.views[namespace];
        if (bag !== undefined) {
            bag.open = path;
            bag.selected = path;
        }
    },
});
/**
 * 记一笔（输出 17）：落在所选位置；精确档走 `recordDelta`，语义档走 `recordNote`。初值、按计划、写不了时不发，直接给原因。
 * 读到的值随请求带上，服务据此判断这个值是不是刚被别处改过（`value-conflict`）。
 */
const record = async (path: string, input: {readonly text: string; readonly delta?: number}): Promise<{readonly ok: true} | {readonly ok: false; readonly reason: Text}> => {
    if (state.planned) return {ok: false, reason: canonText("blocked.planned")};
    if (position.value.kind === "initial") return {ok: false, reason: canonText("blocked.initial")};
    if (blocked.value !== null) return {ok: false, reason: blocked.value};
    const field = fieldAt(path);
    const common = {requestId: `record-${crypto.randomUUID()}`, by: {kind: "author" as const}, position: position.value, at: {entry: props.id, path}, read: {value: field.state?.value ?? null, version: version()}};
    const result = field.declaration?.precision === "semantic"
        ? await world.write("recordNote", {...common, text: input.text})
        : await world.write("recordDelta", {...common, delta: input.delta ?? 0, reason: input.text});
    if (!result.ok) return {ok: false, reason: failureText(result.failure).text};
    props.notices.show({revision: result.value.revision, title: text("record.saved", {text: input.text})});
    return {ok: true};
};

/**
 * 删除条目（输出 19）：一次改几处里的一项 `delete`（加墓碑，canon.revisions 输出 25）。对话框在结果回来前不关、按钮不可用；失败时原因
 * 写在对话框里。
 * 成功后标签留着，按输出 8 显示已删除。
 */
const deleteOpen = shallowRef(false);
const deleting = shallowRef(false);
const deleteError = shallowRef("");
const confirmDelete = async (): Promise<void> => {
    if (deleting.value) return;
    deleting.value = true;
    deleteError.value = "";
    const name = view.value?.name ?? "";
    const baseVersion = world.status.value.data?.version;
    if (baseVersion === undefined) {
        deleting.value = false;
        deleteError.value = port.t(failureText({code: "version-conflict"}).text);
        return;
    }
    const title = text("entry.deleteSaved", {name});
    const result = await world.write("editEntries", {input: {requestId: `delete-${crypto.randomUUID()}`, by: {kind: "author"}, what: "edit", title, baseVersion, ops: [{op: "delete", entry: props.id}]}});
    deleting.value = false;
    if (!result.ok) {
        deleteError.value = port.t(failureText(result.failure).text);
        return;
    }
    deleteOpen.value = false;
    props.notices.show({revision: result.value.revision, title});
};

const editHere = computed(() => {
    const draft = state.edit;
    if (draft === null) return false;
    // 名字、简介的确认条在哪个分页都显示；字段的只在它那个数据分页显示（切走再回来还在，输出 7）。
    if (HEAD_FIELDS[draft.path] !== undefined) return true;
    return dataNamespace.value !== null && draft.path.startsWith(`${dataNamespace.value}.`);
});

/* ---------- 页头的写入：别名、设定组的加去、移动、恢复（canon.revisions 输出 25 的一次改几处） ---------- */

const actionError = shallowRef("");
const acting = shallowRef(false);
/** 发一批操作；成功给保存后的提示，失败把原因写在页头下面。 */
const runEntries = async (ops: EntryOp[], title: string): Promise<boolean> => {
    if (acting.value) return false;
    acting.value = true;
    actionError.value = "";
    const result = await world.write("editEntries", {input: {requestId: `entry-${crypto.randomUUID()}`, by: {kind: "author"}, what: "edit", baseVersion: version(), title, position: position.value, ops}});
    acting.value = false;
    if (!result.ok) {
        actionError.value = port.t(failureText(result.failure).text);
        return false;
    }
    props.notices.show({revision: result.value.revision, title});
    return true;
};
const changeAliases = (change: {readonly add?: readonly string[]; readonly remove?: readonly string[]}): void => {
    const name = view.value?.name ?? "";
    const title = change.add !== undefined ? text("entry.aliasAdded", {name, alias: change.add.join("、")}) : text("entry.aliasRemoved", {name, alias: (change.remove ?? []).join("、")});
    void runEntries([{op: "aliases", entry: props.id, ...(change.add === undefined ? {} : {add: [...change.add]}), ...(change.remove === undefined ? {} : {remove: [...change.remove]})}], port.t(title));
};
const restore = (): void => void runEntries([{op: "restore", entry: props.id}], port.t(text("entry.restored", {name: view.value?.name ?? ""})));

// 加一组设定：登记了、有命名空间、这个条目上还没有的类型；去掉过的标“恢复”（读取的 `removedComponents`）。
const addOpen = shallowRef(false);
const addType = shallowRef("");
const addableTypes = computed(() => {
    const present = new Set(Object.values(view.value?.namespaces ?? {}).map((item) => item.type));
    const removed = new Set((view.value?.removedComponents ?? []).map((item) => item.type));
    return (componentsRead.value?.data?.items ?? []).filter((type) => !present.has(type.id)).map((type) => ({value: type.id, label: removed.has(type.id) ? port.t(text("entry.restoreGroup", {name: type.label})) : type.label}));
});
const confirmAdd = async (): Promise<void> => {
    const type = addType.value;
    if (type === "") return;
    if (await runEntries([{op: "component", entry: props.id, type, action: "add"}], port.t(text("entry.groupAdded", {name: typeLabel(type)})))) {
        addOpen.value = false;
        state.tab = `${DATA}${componentsRead.value?.data?.items.find((item) => item.id === type)?.namespace ?? ""}`;
    }
};
// 移动到……：打开时按 id 读一次原始条目（种类、上级、出场不在条目读取里），确认时只带改了的几项（`place`）。
/** 条目选择器的查找（`findEntries`）；`kinds` 是引用字段声明的 `targets`，空的不筛。 */
const finderFor = (kinds: readonly string[]) => (query: string) => props.client.call("findEntries", {query, position: position.value, limit: 20, ...(kinds.length === 0 ? {} : {kinds: [...kinds]})}).then((found) => (found.ok ? {ok: true as const, items: found.value.items.map((item) => ({id: item.id, name: item.name, kind: item.kind, ...(item.appeared ? {} : {note: port.t(text("entries.unappeared"))}), ...(item.matchedAlias === undefined ? {} : {note: port.t(text("entryPicker.alias", {alias: item.matchedAlias}))})}))} : {ok: false as const, reason: port.t(failureText(found.failure).text)}));
const finder = finderFor([]);
const parentFind = useEntryFind(() => finder);
const sameAsFind = useEntryFind(() => finder);
// 确认条里引用字段的选择器：按字段声明的 `targets` 筛；当前值的名字按 id 读一次条目。
const refFind = useEntryFind(() => finderFor(edit.bar.value?.targets ?? []));
const refId = computed(() => (edit.bar.value?.kind === "ref" && typeof edit.bar.value.value === "string" ? edit.bar.value.value : null));
const refRead = useWorldRead(world, "entry", () => (refId.value === null ? null : {id: refId.value, position: position.value, mode: "actual" as const}));
const refName = computed(() => refRead.value?.data?.view?.name);
const moveOpen = shallowRef(false);
const moveDraft = shallowRef<MoveDraft | null>(null);
let moveFrom: MoveDraft | null = null;
const openMove = async (): Promise<void> => {
    actionError.value = "";
    const stored = await props.client.call("object", {ref: {kind: "entry", id: props.id}});
    const raw = stored.ok ? (stored.value.object as Entry | null) : null;
    if (raw === null) {
        actionError.value = port.t(failureText(stored.ok ? {code: "version-conflict"} : stored.failure).text);
        return;
    }
    moveFrom = {parent: raw.parent, parentName: entry.value?.ancestors?.at(-1)?.name ?? "", folder: raw.folder, kind: raw.type, order: "keep", appears: raw.appears?.kind === "chapter" ? raw.appears.chapter : null, sameAs: raw.sameAs ?? null, sameAsName: entry.value?.sameAs?.name ?? ""};
    moveDraft.value = moveFrom;
    moveOpen.value = true;
};
const confirmMove = async (): Promise<void> => {
    const draft = moveDraft.value;
    const from = moveFrom;
    if (draft === null || from === null) return;
    const op: Extract<EntryOp, {op: "place"}> = {
        op: "place",
        entry: props.id,
        ...(draft.parent === from.parent ? {} : {parent: draft.parent}),
        ...(draft.folder === from.folder ? {} : {folder: draft.folder}),
        ...(draft.kind === from.kind ? {} : {kind: draft.kind}),
        ...(draft.order === "first" ? {after: null} : {}),
        ...(draft.appears === from.appears ? {} : {appears: draft.appears === null ? null : {kind: "chapter" as const, chapter: draft.appears, key: 0}}),
        ...(draft.sameAs === from.sameAs ? {} : {sameAs: draft.sameAs}),
    };
    if (Object.keys(op).length === 2) {
        moveOpen.value = false;
        return;
    }
    if (await runEntries([op], port.t(text("move.saved", {name: view.value?.name ?? ""})))) moveOpen.value = false;
};

// 去掉当前数据分页这组设定：先确认，数据留着。
const removeOpen = shallowRef(false);
const removableGroup = computed(() => (dataNamespace.value === null ? "" : typeLabel(view.value?.namespaces[dataNamespace.value]?.type ?? "")));
const confirmRemove = async (): Promise<void> => {
    const namespace = dataNamespace.value;
    const type = namespace === null ? undefined : view.value?.namespaces[namespace]?.type;
    if (type === undefined) return;
    if (await runEntries([{op: "component", entry: props.id, type, action: "remove"}], port.t(text("entry.groupRemoved", {name: typeLabel(type)})))) {
        removeOpen.value = false;
        // 去掉的分页没了：回到第一个分页。
        state.tab = null;
    }
};

/* ---------- 数据分页 ---------- */

// 每个命名空间一份 context，换位置、世界变了以后同一个对象给出新的值；分页的状态在标签上（`state.views`）。
const contexts = new Map<string, ComponentViewContext>();
watch(namespaces, (list) => {
    for (const namespace of list) state.views[namespace] ??= {};
}, {immediate: true});
/** 专门界面嵌的通用字段表（`context.FieldTable`），每个命名空间一个，绑在那一页的 context 上。 */
const fieldTables = new Map<string, Component<{readonly fields?: readonly string[]}>>();
const fieldTableOf = (namespace: string): Component<{readonly fields?: readonly string[]}> => {
    let found = fieldTables.get(namespace);
    if (found === undefined) {
        found = defineComponent({
            name: "CanonFieldTable",
            props: {fields: {type: Array as PropType<readonly string[]>, default: undefined}},
            setup: (inner) => () => h(FieldsDataView, {context: contextFor(namespace), only: inner.fields}),
        });
        fieldTables.set(namespace, found);
    }
    return found;
};
const contextFor = (namespace: string): ComponentViewContext => {
    let found = contexts.get(namespace);
    if (found === undefined) {
        found = {
            get FieldTable() { return fieldTableOf(namespace); },
            entry: props.id,
            namespace,
            get position() { return position.value; },
            get mode() { return mode.value; },
            get version() { return version(); },
            get fields() { return view.value?.namespaces[namespace]?.fields ?? {}; },
            get declarations() { return entry.value?.declarations?.[namespace] ?? []; },
            state: state.views[namespace] ?? {},
            get blocked() { return editBlocked.value; },
            place,
            origins: (path, cursor) => props.fetchOrigins({entry: props.id, path: `${namespace}.${path}`}, position.value, mode.value, cursor),
            edit: (path) => edit.open(`${namespace}.${path}`),
            record: (path, input) => record(`${namespace}.${path}`, input),
            open: props.open,
        };
        contexts.set(namespace, found);
    }
    return found;
};
// 附加分页（输出 36）：每个贡献一份 context，状态按贡献 id 存在标签上。
const tabContexts = new Map<string, EntryTabContext>();
const tabContextFor = (id: string): EntryTabContext => {
    let found = tabContexts.get(id);
    if (found === undefined) {
        state.extras ??= {};
        state.extras[id] ??= {};
        found = {
            entry: props.id,
            get position() { return position.value; },
            get mode() { return mode.value; },
            get version() { return version(); },
            state: state.extras[id],
            place,
            open: props.open,
        };
        tabContexts.set(id, found);
    }
    return found;
};
const extraView = computed<{readonly component: Component | null; readonly loading: boolean; readonly failed: string | null}>(() => {
    if (extraTab.value === null) return {component: null, loading: false, failed: null};
    const slot = props.entryTabs.view(extraTab.value);
    if (slot.status === "ready") return {component: slot.component, loading: false, failed: null};
    return {component: null, loading: slot.status === "loading", failed: slot.status === "failed" ? slot.reason : null};
});

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
    <div class="min-h-full">
        <NoticeBar v-if="props.notices.current.value !== null" :title="props.notices.current.value.title" @receipt="props.receipt(props.notices.current.value.revision)" @undo="pageNotice.undo(props.notices.current.value)" @close="pageNotice.close()" />
        <AgentNotice v-if="props.notices.agent.value !== null" :title="props.notices.agent.value.title" :earlier="props.notices.agent.value.earlier" @receipt="props.receipt(props.notices.agent.value.revision)" @undo="pageNotice.undo(props.notices.agent.value)" @revisions="props.notices.openRevisions()" @close="props.notices.dismissAgent()" />
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
            :read-only="readOnly === null ? '' : port.t(readOnly)"
            :tabs="tabs"
            :tab="tab"
            :deletable="blocked === null"
            :line-options="props.windowLine.options.value"
            :line="windowLine"
            :resolved-line="chapterLine(position, chapters)"
            editable
            :edit-reason="editBlocked === null ? '' : port.t(editBlocked)"
            :aliases="view?.aliases ?? []"
            :removable-group="removableGroup"
            :action-error="actionError"
            @edit-name="edit.open('entry.name')"
            @edit-summary="edit.open('entry.summary')"
            @aliases="changeAliases"
            @restore="restore()"
            @add-component="addType = addableTypes[0]?.value ?? ''; addOpen = true; actionError = ''"
            @remove-component="removeOpen = true; actionError = ''"
            @move="openMove()"
            @update:line="(value: string) => props.windowLine.set(value)"
            @update:position="setPosition"
            @update:planned="(value: boolean) => (state.planned = value)"
            @update:tab="(value: string) => (state.tab = value)"
            @open-entry="(id: string) => props.open({kind: 'entry', id})"
            @retry="world.retry()"
            @delete="deleteOpen = true; deleteError = ''"
        >
            <template #bar>
                <ConfirmBar
                    v-if="editHere && edit.bar.value !== null"
                    v-bind="edit.bar.value"
                    :ref-results="refFind.results.value"
                    :ref-name="refName"
                    @search-ref="refFind.search"
                    @update:value="edit.update"
                    @update:intent="edit.setIntent"
                    @save="edit.save()"
                    @recheck="edit.recheck()"
                    @cancel="edit.cancel()"
                />
            </template>
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
            <template v-else-if="extraTab !== null">
                <p v-if="extraView.failed !== null" role="alert" class="mb-3 text-[length:var(--text-sm)] text-[var(--status-warning)]">{{ text("fields.viewFailed", {reason: extraView.failed}) }}</p>
                <p v-else-if="extraView.loading" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("entries.loading") }}</p>
                <component :is="extraView.component" v-else-if="extraView.component !== null" :key="extraTab" :context="tabContextFor(extraTab)" />
            </template>
        </EntryPage>
        <Dialog
            :open="addOpen"
            size="sm"
            :title="text('entry.addComponentTitle')"
            show-cancel
            :confirm-label="text('entry.addComponentConfirm')"
            :busy="acting"
            :close-on-request="!acting"
            @update:open="(value: boolean) => (addOpen = value)"
            @confirm="confirmAdd()"
        >
            <p v-if="addableTypes.length === 0" class="text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.noMoreGroups") }}</p>
            <Select v-else :aria-label="text('entry.addComponentTitle')" :options="addableTypes" :model-value="addType" @update:model-value="(value: string) => (addType = value)" />
            <p v-if="actionError !== ''" role="alert" class="mt-2 text-[length:var(--text-sm)] text-[var(--status-danger)]">{{ actionError }}</p>
        </Dialog>
        <MoveDialog
            v-if="moveDraft !== null"
            :open="moveOpen"
            :entry="{id: props.id, name: view?.name ?? ''}"
            :draft="moveDraft"
            :parent-results="parentFind.results.value"
            :same-as-results="sameAsFind.results.value"
            :chapters="chapters"
            :saving="acting"
            :error="actionError"
            @update:open="(value: boolean) => (moveOpen = value)"
            @update:draft="(value: MoveDraft) => (moveDraft = value)"
            @search-parent="parentFind.search"
            @search-same-as="sameAsFind.search"
            @confirm="confirmMove()"
        />
        <Dialog
            :open="removeOpen"
            size="sm"
            :title="text('entry.removeComponent', {name: removableGroup})"
            show-cancel
            :confirm-label="text('entry.removeComponentConfirm')"
            :busy="acting"
            :close-on-request="!acting"
            @update:open="(value: boolean) => (removeOpen = value)"
            @confirm="confirmRemove()"
        >
            <p class="text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.removeComponentDescription") }}</p>
            <p v-if="actionError !== ''" role="alert" class="mt-2 text-[length:var(--text-sm)] text-[var(--status-danger)]">{{ actionError }}</p>
        </Dialog>
        <Dialog
            :open="deleteOpen"
            size="sm"
            :title="text('entry.deleteTitle', {name: view?.name ?? ''})"
            show-cancel
            :confirm-label="text('entry.deleteConfirm')"
            :busy="deleting"
            :close-on-request="!deleting"
            @update:open="(value: boolean) => (deleteOpen = value)"
            @confirm="confirmDelete()"
        >
            <p class="text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("entry.deleteDescription") }}</p>
            <p v-if="deleteError !== ''" role="alert" class="mt-2 text-[length:var(--text-sm)] text-[var(--status-danger)]">{{ deleteError }}</p>
        </Dialog>
    </div>
</template>
