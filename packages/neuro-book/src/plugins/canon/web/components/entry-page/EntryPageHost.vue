<script setup lang="ts">
/**
 * 条目页（docs/specs/canon/author-ui.md 输出 6 到 15、26、27）：按标签的状态（`context.state`，切走再回来还在）读世界，交给
 * `EntryPage` 与各分页的组件画。只读当前分页要的：文字分页读渲染，情节分页读变更，数据分页的界面经 `context` 自己读；展开一个
 * 值时才读它的来历。
 */
import {computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, provide, shallowReactive, shallowRef, watch} from "vue";
import type {Component, PropType} from "vue";

import type {Entry, EntryOp, FieldDeclaration, FieldDraft, FieldState, Placement, ReadPosition} from "@notnotype/nb-canon";
import {displayText} from "@notnotype/nb-canon/schema";
import {Dialog, Popover, SegmentedControl} from "@notnotype/nb-ui/components";
import type {PopoverReference} from "@notnotype/nb-ui/components";
import type {Text} from "@notnotype/nb-ui/text";
import {useText} from "@notnotype/nb-ui/text-port";

import {fieldsText} from "../../../shared/agent-fields";
import {LOOK_COMPONENT} from "../../../shared/components";
import {canonText} from "../../../shared/text";
import {RENDER_SOURCE_MAX} from "../../../shared/contracts";
import type {CanonClient, CanonFailure, CanonOutputs, FoundEntry} from "../../../shared/contracts";
import {kindPresets} from "../../../shared/entry-kinds";
import type {EntryKind} from "../../../shared/entry-kinds";
import type {EntryTabDeclaration} from "../../../shared/entry-tabs";
import type {ComponentPeer, ComponentViewContext, ComponentViewRegistry, EntryTabContext, FieldEditorProps, OtherComponent, ViewWriteResult} from "../../component-views";
import type {EntryHead, EntryPageState, PageLine} from "../../entry-page";
import {draftText, kindOf, parsed, useInPlaceEdit} from "../../in-place-edit";
import type {EditOpenOptions} from "../../in-place-edit";
import {createImagePicking, provideCanonImageUrl, provideImagePicking} from "../../images";
import type {CanonImages} from "../../images";
import {usePageNotice} from "../../notices";
import type {CanonNotices} from "../../notices";
import {useOriginPagesMap} from "../../origin-pages";
import type {OriginsPage} from "../../origin-pages";
import {chapterLabel, chapterLine, changedMark, defaultPosition, placementLabel, positionChapters, positionExists, positionFromValue, positionLabel, positionValue} from "../../positions";
import type {ChapterRef} from "../../positions";
import {originRows, plotRows, valueText} from "../../rows";
import {useCanonText} from "../../text";
import type {TextDraftSession} from "../../text-drafts";
import {ENTRY_LANGUAGE} from "../../entry-language";
import {useTextValues} from "../../text-values";
import type {TextValueTable} from "../../text-values";
import {baselineOf} from "../../entry-check";
import type {EntryField} from "../../entry-chip";
import {useTextTab} from "../../text-tab";
import {useWorldList, useWorldRead} from "../../use-reads";
import type {RevertRequests} from "../../revert";
import {readOnlyBanner, writeBlocked} from "../../writable";
import {failureText} from "../../failures";
import type {CanonWorld} from "../../world";
import ConfirmBar from "../editing/ConfirmBar.vue";
import EntryPage from "./EntryPage.vue";
import type {EntryPageStatus} from "./EntryPage.vue";
import EntryText from "../text/EntryText.vue";
import EntryTextEditor from "../text/EntryTextEditor.vue";
import TextConflictDialog from "../text/TextConflictDialog.vue";
import type {EntryTextBlock, TextAddress} from "../text/entry-text";
import type {InsertItem, RichContext} from "../text/entry-text-editor";
import {addressKey, placeAddress} from "../text/entry-text";
import FieldDetailView from "../groups/FieldDetail.vue";
import ComponentAgentView from "../groups/ComponentAgentView.vue";
import ComponentRawView from "../groups/ComponentRawView.vue";
import FieldsDataView from "../groups/FieldsDataView.vue";
import PageNotices from "./PageNotices.vue";
import {LOOK_PICK_KEY} from "../../look-handoff";
import AddComponentDialog from "./AddComponentDialog.vue";
import {checklistGroup} from "./component-checklist";
import type {ChecklistItem, ChecklistPreset} from "./component-checklist";
import {componentIcon, EXTRA_ICON, PLOT_ICON, TEXT_ICON} from "./entry-tabs";
import type {EntryTab} from "./entry-tabs";
import MoveDialog from "./MoveDialog.vue";
import ElementDialog from "../editing/ElementDialog.vue";
import type {ElementField} from "../editing/element-dialog";
import type {EditIntent} from "../editing/confirm-bar";
import type {MoveDraft} from "./move-dialog";
import {useEntryFind} from "../entries/entry-picker";
import OriginList from "../groups/OriginList.vue";
import PlotList from "../groups/PlotList.vue";

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
    /** 窗口在看的线（输出 34）：空串是按章节自动，读取位置不写线。 */
    windowLine: PageLine;
    views: ComponentViewRegistry;
    /** 附加分页（输出 36）。 */
    entryTabs: ComponentViewRegistry<EntryTabDeclaration>;
    /** 本窗口的保存后的提示。 */
    notices: CanonNotices;
    /** 本窗口的还原对话框（提示里的“还原”）。 */
    revert: RevertRequests;
    /** 打开条目页、变更详情页。 */
    open: (ref: {readonly kind: "entry" | "change"; readonly id: string}) => void;
    /** 打开一次修订的回执页。 */
    receipt: (revision: string) => void;
    /** 读到页头时报给宿主：标签标题与面包屑用它。 */
    onHead: (head: EntryHead) => void;
    /** 这个条目的主文字稿（输出 44 到 46）；会话在窗口的登记里，不随这一页卸载。 */
    draft: TextDraftSession;
    /** 源文字的输入框（编辑器插件的代码输入框）；窗口里没有时为 null，编辑视图用普通文本框。 */
    sourceInput: Component | null;
    /** 这一页挂着的时候把“提交主文字”交给宿主（标签的保存命令调它，输出 46）；卸载时交 null。 */
    onCommitReady: (commit: (() => Promise<void>) | null) => void;
    /** 登记的条目种类（`canon.entry-kinds`）：这个条目种类的默认设定组的分页排在“文字”前面（输出 9）。 */
    entryKinds?: readonly EntryKind[];
    /** 设定里的图片（取图地址、候选、上传，输出 53）；没有时图片只能手填路径、显示成“图片找不到”。 */
    images?: CanonImages | null;
    /** 登记这个设定组类型的插件 id：“添加一组设定”按它分组（输出 38）；不给时都算“插件”。 */
    componentPlugin?: (type: string) => string | null;
}>();

const text = useCanonText();
const port = useText();
const state = props.state;
const world = props.world;
// 图片（输出 53）：取图地址注入给这一页里的 `CanonImage`；选图片的地方（确认条、元素对话框、就地改）共用一份候选与上传，同一时间
// 只有一处在填。
provideCanonImageUrl((path) => props.images?.url(path) ?? null);
const imagePicking = props.images === undefined || props.images === null ? null : createImagePicking(props.images, (given) => port.t(given));
if (imagePicking !== null) provideImagePicking(imagePicking);
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
const ownPosition = computed<ReadPosition>(() => {
    const base = (state.position === null ? null : positionFromValue(state.position)) ?? defaultPosition(chapters.value);
    return windowLine.value === "" ? base : {...base, line: windowLine.value};
});
// 有主文字的稿时这一页停在稿开始的位置（内核解析后的、写明线的），按实际读（输出 46）；稿没了回到自己的位置。稿开始的那一章、
// 那条线已经不在了的时候也回到自己的位置：否则这一页的读取都落在读不出来的位置上，刷新以后整页是“读取失败”，稿列不出来。
const lockedAt = computed(() => {
    const draft = props.draft.state;
    return draft.draft === null || draft.blocker === "chapter-not-found" || draft.blocker === "line-not-found" ? null : draft.draft.at;
});
const position = computed<ReadPosition>(() => lockedAt.value ?? ownPosition.value);
const mode = computed(() => (lockedAt.value === null && state.planned ? "planned" as const : "actual" as const));
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

// 标签标题与面包屑写缺省位置、实际模式下的名字（输出 6），不带窗口的线（输出 34）：按章节自动时就是这一页正在读的那份，只有读的
// 正是那里时才报；窗口选了线时另读一份缺省位置的。
const headElsewhere = computed(() => windowLine.value !== "" || lockedAt.value !== null);
const headRead = useWorldRead(world, "entry", () => (headElsewhere.value && chaptersKnown.value ? {id: props.id, position: defaultPosition(chapters.value), mode: "actual" as const} : null));
const headSource = computed(() => {
    if (headElsewhere.value) return headRead.value?.data;
    return state.position === null && !state.planned ? entry.value : undefined;
});
watch(headSource, (read) => {
    const shown = read?.view;
    if (shown === undefined || shown === null) return;
    props.onHead({name: shown.name, folder: read!.folder ?? "", ancestors: read!.ancestors ?? [], kind: read!.kind ?? ""});
}, {immediate: true});

const namespaces = computed(() => Object.keys(view.value?.namespaces ?? {}));
const componentsRead = useWorldRead(world, "components", () => ({}));
/** 作品里有没有计划中的情节：没有时时间点里不出“算上计划中的情节”（输出 7）。只要总数，读一条。 */
const plans = useWorldList(world, "changes", () => ({filter: {kind: "plan" as const}}), 1);
/** 作品里有没有剧情变更：没有时“情节”与声明了 `needsChanges` 的附加分页不出（输出 9）。 */
const anyChanges = useWorldList(world, "changes", () => ({}), 1);
const storyStarted = computed(() => (anyChanges.state.value?.data?.total ?? 0) > 0);
const canPlan = computed(() => (plans.state.value?.data?.total ?? 0) > 0 || state.planned);
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
/** 这个条目种类登记的默认设定组（类型 id）：它们的分页排在“文字”前面（输出 9），人物打开时先看人物。 */
const leadingTypes = computed(() => {
    const kind = entry.value?.kind?.trim();
    return new Set((props.entryKinds ?? []).find((item) => item.kind === kind)?.components ?? []);
});
const iconOf = (type: string): string => componentIcon(props.views, type);
/**
 * 分页（输出 9）：设定组与文字一段（默认的设定组在文字前面），不对应设定组的看法一段（附加分页与“情节”）；每页有图标。条数为 0
 * 时不写；作品里还没有剧情变更时，“情节”与声明了 `needsChanges` 的附加分页不出（空着没用）。
 */
const tabs = computed<EntryTab[]>(() => {
    const items: EntryTab[] = [];
    const data = namespaces.value.map((namespace) => {
        const type = view.value!.namespaces[namespace]!.type;
        const slot = props.views.view(type);
        return {leading: leadingTypes.value.has(type), item: {value: `${DATA}${namespace}`, label: slot.status === "none" ? typeLabel(type) : port.t(slot.title), iconClass: iconOf(type), segment: "own" as const, removable: true, looks: true}};
    });
    for (const tab of data) if (tab.leading) items.push(tab.item);
    // 能写的条目总有文字分页，空时写“还没有主文字”与“加一段”（输出 9）。
    if (view.value !== null && (view.value.text.length > 0 || !view.value.deleted)) items.push({value: "text", label: text("entry.tabs.text"), iconClass: TEXT_ICON, segment: "own"});
    for (const tab of data) if (!tab.leading) items.push(tab.item);
    // 声明经约定键补全过，`title` 总在。
    for (const item of extraTabs.value) {
        if (item.declaration.needsChanges === true && !storyStarted.value) continue;
        items.push({value: `${EXTRA}${item.id}`, label: port.t(item.declaration.title!), iconClass: item.declaration.icon ?? EXTRA_ICON, segment: "view"});
    }
    const total = plot.state.value?.data?.total;
    if (storyStarted.value || (total ?? 0) > 0) items.push({value: "plot", label: text("entry.tabs.plot"), iconClass: PLOT_ICON, segment: "view", ...(total === undefined || total === 0 ? {} : {count: total})});
    return items;
});
// 没选过分页时：有主文字先看文字，没有主文字先看第一组设定（空的文字分页不当缺省）。
// 条目还没读到、作品里也没有剧情时分页是空的（“情节”不出），这时先按文字。
const firstTab = computed(() => ((view.value?.text.length ?? 0) === 0 ? tabs.value.find((item) => item.value.startsWith(DATA)) ?? tabs.value[0] : tabs.value[0])?.value ?? "text");
// 有没提交的主文字稿时先看文字（直接进编辑，输出 45），排在它前面的人物分页这时不当缺省（输出 9）。稿是读完存储才知道的：读到时
// 作者还没自己点过分页，就把分页定在文字上（记进标签状态），提交、放弃以后不跳回人物分页。
watch(() => props.draft.state.draft !== null, (editing) => {
    if (editing && state.tab === null) state.tab = "text";
}, {immediate: true});
const tab = computed(() => (tabs.value.some((item) => item.value === state.tab) ? state.tab! : firstTab.value));
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
/** 开着的那一处的地址（来历按地址读）。 */
const originAddress = computed(() => (state.origin === null ? null : addressKey(placeAddress(state.origin))));
const originKeys = computed(() => (tab.value === "text" && originAddress.value !== null ? [originAddress.value] : []));
const origins = useOriginPagesMap(() => originKeys.value, (key) => {
    const split = key.indexOf("|");
    const address = {entry: key.slice(0, split), path: key.slice(split + 1)};
    return (cursor) => props.fetchOrigins(address, position.value, mode.value, cursor);
}, originStamp);
const openOrigin = computed(() => (originAddress.value === null ? undefined : origins.value.get(originAddress.value)?.state.value));
/** 浮层里画的来历：关上（清掉记下的那一处）以后留着最后一份，随浮层一起淡出；按钮在这期间不起作用（`originAddress` 已空）。 */
const shownOrigin = shallowRef<typeof openOrigin.value>(undefined);
watch(openOrigin, (now) => {
    if (now !== undefined) shownOrigin.value = now;
}, {immediate: true, flush: "sync"});
const declarationOf = (address: TextAddress): FieldDeclaration | undefined => {
    if (address.entry !== props.id) return undefined;
    const split = address.path.indexOf(".");
    return entry.value?.declarations?.[address.path.slice(0, split)]?.find((item) => item.id === address.path.slice(split + 1));
};
const labelOfAddress = (address: TextAddress): string => declarationOf(address)?.label ?? address.path;
const toggleValue = (place: string): void => {
    state.origin = state.origin === place ? null : place;
};

/** 来历里点“改这一笔”：浮层关上，再打开变更详情页（输出 11）。 */
const openChangeFromOrigin = (id: string): void => {
    state.origin = null;
    props.open({kind: "change", id});
};

/* ---------- 写入 ---------- */

// 写不了的原因（输出 27、28）；就地改另外只在实际模式下可用（输出 16）。
const blocked = computed(() => writeBlocked(world));
const readOnly = computed(() => readOnlyBanner(world));
// 有稿时这一页按实际读（见 `mode`），“按计划”的开关不作数。
const editBlocked = computed(() => (mode.value === "planned" ? canonText("blocked.planned") : blocked.value));
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
    chapter: (id) => chapterLabel(id, chapters.value, text),
    blocked: () => editBlocked.value,
    text,
    resolve: (given) => port.t(given),
    saved: (published, title, where) => props.notices.show({revision: published.revision, title, ...(where === undefined ? {} : {where})}),
    refocus: (path) => {
        // 确认条关掉以后再找：按钮在数据分页里，确认条关掉不会卸载它。
        void nextTick(() => document.querySelector<HTMLElement>(`[data-edit="${CSS.escape(path)}"]`)?.focus());
    },
    accumulated: (path) => {
        // 累出来的数：展开它的来历（字段表展开那一行，面板选中那张卡，专门界面看它的细节）。
        const namespace = path.slice(0, path.indexOf("."));
        const bag = state.views[namespace];
        if (bag !== undefined) {
            bag.open = path;
            bag.selected = path;
            bag.detail = path.slice(namespace.length + 1);
        }
    },
});
/**
 * 记一笔（输出 17）：落在所选位置；精确档走 `recordDelta`，语义档走 `recordNote`。初值、按计划、写不了时不发，直接给原因。
 * 读到的值随请求带上，服务据此判断这个值是不是刚被别处改过（`value-conflict`）。
 */
const record = async (path: string, input: {readonly text: string; readonly delta?: number}): Promise<{readonly ok: true} | {readonly ok: false; readonly reason: Text}> => {
    // 写回的位置在发请求时定下：请求在途时作者换了位置，提示仍写这一笔落在哪。
    const at = position.value;
    if (mode.value === "planned") return {ok: false, reason: canonText("blocked.planned")};
    if (at.kind === "initial") return {ok: false, reason: canonText("blocked.initial")};
    if (blocked.value !== null) return {ok: false, reason: blocked.value};
    const field = fieldAt(path);
    const common = {requestId: `record-${crypto.randomUUID()}`, by: {kind: "author" as const}, position: at, at: {entry: props.id, path}, read: {value: field.state?.value ?? null, version: version()}};
    const result = field.declaration?.precision === "semantic"
        ? await world.write("recordNote", {...common, text: input.text})
        : await world.write("recordDelta", {...common, delta: input.delta ?? 0, reason: input.text});
    if (!result.ok) return {ok: false, reason: failureText(result.failure).text};
    // 记一笔落在所选位置的那一章（最初时上面已经拦下）。
    props.notices.show({revision: result.value.revision, title: text("record.saved", {text: input.text}), where: chapterLabel(at.chapter, chapters.value, text)});
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

/**
 * 专门界面里挂着的就地改编辑器（`context.FieldEditor`，输出 51），按路径计数：同一条路径挂两份时卸一份不影响另一份，换分页时新的
 * 先挂、旧的后卸也不出错。草稿标了就地、并且此刻有编辑器挂着这条路径时由它画，不出确认条。
 */
const inlineEditors = shallowRef<ReadonlyMap<string, number>>(new Map());
const holdInline = (path: string): (() => void) => {
    const add = (step: number): void => {
        const next = new Map(inlineEditors.value);
        const count = (next.get(path) ?? 0) + step;
        if (count > 0) next.set(path, count);
        else next.delete(path);
        inlineEditors.value = next;
    };
    add(1);
    let held = true;
    return () => {
        if (!held) return;
        held = false;
        add(-1);
    };
};
const inlineHere = computed(() => state.edit?.inline === true && (inlineEditors.value.get(state.edit.path) ?? 0) > 0);
const editHere = computed(() => {
    const draft = state.edit;
    if (draft === null || inlineHere.value) return false;
    // 名字、简介的确认条在哪个分页都显示；字段的只在它那个数据分页显示（切走再回来还在，输出 7）。
    if (HEAD_FIELDS[draft.path] !== undefined) return true;
    return dataNamespace.value !== null && draft.path.startsWith(`${dataNamespace.value}.`);
});

/* ---------- 页头的写入：别名、设定组的加去、移动、恢复（canon.revisions 输出 25 的一次改几处） ---------- */

/** 页头的写入（别名、恢复）与打开对话框前的读取失败的原因，写在页头下面；切到别的分页时清掉。 */
const actionError = shallowRef("");
const acting = shallowRef(false);
/** 对话框里的写入失败的原因，写在对话框里。同一时刻只开一个对话框，打开时清掉。 */
const dialogError = shallowRef("");
watch(tab, () => {
    actionError.value = "";
});
/**
 * 对话框打开时条目的版本：保存时带它，对话框开着的时候别处改了这个条目就得到冲突，不把别人的改动无声盖掉（canon.revisions
 * 验收 1）。冲突以后清成 null：再保存一次带那时的版本，以对话框里填的为准。
 */
let dialogBase: number | null = null;
const openDialog = (): void => {
    dialogError.value = "";
    dialogBase = version();
};
/**
 * “＋”与右键菜单里的“添加一组设定”打开时条目的版本（输出 43，同对话框）：点一项加上时带它；菜单开着的时候别处改了这个条目就
 * 得到冲突。用过一次就清掉。
 */
let menuBase: number | null = null;
const openAddMenu = (): void => {
    menuBase = version();
};
/**
 * 发一批操作；成功给保存后的提示。对话框里的写入带打开时的版本，失败写在对话框里；页头的写入（`head`）与菜单里的写入（`menu`，
 * 带菜单打开时的版本）失败写进浮动提示的失败那一行。
 */
const runEntries = async (ops: EntryOp[], title: string, intent: EditIntent = "creative", from: "dialog" | "head" | "menu" = "dialog", explain?: (failure: CanonFailure) => Text | null): Promise<boolean> => {
    if (acting.value) return false;
    acting.value = true;
    const error = from === "dialog" ? dialogError : actionError;
    error.value = "";
    const base = from === "dialog" ? dialogBase : from === "menu" ? menuBase : null;
    if (from === "menu") menuBase = null;
    const baseVersion = base ?? version();
    const result = await world.write("editEntries", {input: {requestId: `entry-${crypto.randomUUID()}`, by: {kind: "author"}, what: "edit", baseVersion, title, intent, position: position.value, ops}});
    acting.value = false;
    if (!result.ok) {
        const changed = from !== "head" && result.failure.code === "version-conflict";
        if (changed && from === "dialog") dialogBase = null;
        error.value = port.t(changed ? text(from === "menu" ? "entry.menuChangedElsewhere" : "edit.changedElsewhere") : explain?.(result.failure) ?? failureText(result.failure).text);
        return false;
    }
    props.notices.show({revision: result.value.revision, title});
    return true;
};
const changeAliases = (change: {readonly add?: readonly string[]; readonly remove?: readonly string[]}): void => {
    const name = view.value?.name ?? "";
    const title = change.add !== undefined ? text("entry.aliasAdded", {name, alias: change.add.join("、")}) : text("entry.aliasRemoved", {name, alias: (change.remove ?? []).join("、")});
    void runEntries([{op: "aliases", entry: props.id, ...(change.add === undefined ? {} : {add: [...change.add]}), ...(change.remove === undefined ? {} : {remove: [...change.remove]})}], port.t(title), "creative", "head");
};
const restore = (): void => void runEntries([{op: "restore", entry: props.id}], port.t(text("entry.restored", {name: view.value?.name ?? ""})), "creative", "head");

// 加一组设定（输出 38）：登记了、有命名空间、这个条目上还没有的类型；去掉过的标“恢复”（读取的 `removedComponents`）。适用于这个
// 条目种类的（类型的 `kinds` 含它）排在前面，其余照登记的顺序接在后面。分页条末尾的“＋”与右键菜单里点一项就加上。
const addableTypes = computed(() => {
    const present = new Set(Object.values(view.value?.namespaces ?? {}).map((item) => item.type));
    const removed = new Set((view.value?.removedComponents ?? []).map((item) => item.type));
    const kind = entry.value?.kind?.trim() ?? "";
    const addable = (componentsRead.value?.data?.items ?? []).filter((type) => !present.has(type.id));
    const fits = (type: (typeof addable)[number]): boolean => kind !== "" && (type.kinds ?? []).includes(kind);
    return [...addable.filter(fits), ...addable.filter((type) => !fits(type))].map((type) => ({value: type.id, label: removed.has(type.id) ? port.t(text("entry.restoreGroup", {name: type.label})) : type.label}));
});
/**
 * “添加设定组”对话框（输出 38，`AddComponentDialog`）的各行：登记了的全部类型，标出条目上已经有的（勾着、点了切过去）与去掉过的，
 * 按登记它的插件分组；“适用于”由列表按 `kinds` 与条目的种类自己分。
 */
const checklistItems = computed<ChecklistItem[]>(() => {
    const present = new Set(Object.values(view.value?.namespaces ?? {}).map((item) => item.type));
    const removed = new Set((view.value?.removedComponents ?? []).map((item) => item.type));
    return (componentsRead.value?.data?.items ?? []).map((type) => ({
        value: type.id,
        label: type.label,
        iconClass: iconOf(type.id),
        group: checklistGroup(props.componentPlugin?.(type.id) ?? null),
        kinds: type.kinds ?? [],
        present: present.has(type.id),
        restore: removed.has(type.id),
    }));
});
const entryKind = computed(() => entry.value?.kind?.trim() ?? "");
/** 这个种类的预设（`canon.entry-kinds`）；里面没登记的类型已去掉，一个也没有的预设不出。 */
const presets = computed<readonly ChecklistPreset[]>(() => kindPresets(props.entryKinds ?? [], entryKind.value, new Set((componentsRead.value?.data?.items ?? []).map((type) => type.id))));
const addDialogOpen = shallowRef(false);
// 开着的时候写不了了（断开、换到计划中的位置、条目被删）：入口跟着没了，对话框也关上，不留一个点了必被拒收的“添加”。
watch(() => editBlocked.value !== null || view.value?.deleted === true, (blockedNow) => {
    if (blockedNow) addDialogOpen.value = false;
});
/** 开对话框：记下这时条目的版本，加的时候带它（输出 43）。 */
const openAddDialog = (): void => {
    openDialog();
    addDialogOpen.value = true;
};
const hostRoot = shallowRef<HTMLElement | null>(null);
/**
 * 对话框关上以后（`closed`，焦点已经还给打开前的元素）：加完了最后几组，“＋”跟着没了，焦点落到页面外；这时交给选中的分页，键盘用户
 * 接着从分页条往下走。
 */
const afterAddDialog = (): void => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    hostRoot.value?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")?.focus();
};
/** 在对话框里点了已经有的那一组，或分页里要切到某一组：切到它的分页。 */
const showComponent = (type: string): void => {
    const namespace = Object.entries(view.value?.namespaces ?? {}).find(([, item]) => item.type === type)?.[0];
    if (namespace !== undefined) state.tab = `${DATA}${namespace}`;
};
/** 刚加上、等它出现在读取结果里再切过去的那一组的命名空间：写入的结果先于条目的重读回来，马上切会切到一个还不存在的分页。 */
const pendingTab = shallowRef<string | null>(null);
watch([pendingTab, namespaces], ([pending, present]) => {
    if (pending !== null && present.includes(pending)) {
        state.tab = `${DATA}${pending}`;
        pendingTab.value = null;
    }
});
// 人物分页的“添加立绘”交给形象分页的一次性标记（输出 49，`look-handoff.ts`）。
const lookPick = shallowRef(false);
provide(LOOK_PICK_KEY, lookPick);
// 作者自己换了分页：等着切过去的那一组不再切（它也许一直不出现，不能等到以后别处加上时突然跳过去）；换到的不是形象分页时，
// 交接标记也放倒，否则以后作者自己点形象分页会莫名打开选图。
watch(() => state.tab, (tab) => {
    pendingTab.value = null;
    const namespace = tab?.startsWith(DATA) === true ? tab.slice(DATA.length) : null;
    if (namespace === null || view.value?.namespaces[namespace]?.type !== LOOK_COMPONENT) lookPick.value = false;
});
/**
 * 加几组设定（输出 38）：一次写入、一条修订；对话框里勾的几组与右键菜单里点的一组都走这里。成功后切到第一个有命名空间的新加的
 * 一组（等它出现在读取结果里）。
 */
const addComponents = async (types: readonly string[], from: "dialog" | "menu"): Promise<boolean> => {
    if (types.length === 0) return false;
    const quoted = types.map((type) => `“${typeLabel(type)}”`);
    const title = types.length === 1 ? text("entry.groupAdded", {name: typeLabel(types[0]!)}) : text("entry.groupsAdded", {names: new Intl.ListFormat(port.locale.value, {type: "conjunction"}).format(quoted)});
    // 打开以后别处已经加上了其中一组：内核按那一项（`ops[i]`）报 `id-taken` 拒收整批，写成作者看得懂、指名是哪一组的一句。
    const alreadyAdded = (failure: CanonFailure): Text | null => {
        if (failure.code !== "validation-failed" || !Array.isArray(failure.problems)) return null;
        const first = failure.problems[0] as {code?: unknown; path?: unknown} | undefined;
        if (first?.code !== "id-taken") return null;
        const at = typeof first.path === "string" ? /^ops\[(\d+)\]/u.exec(first.path)?.[1] : undefined;
        const type = at === undefined ? undefined : types[Number(at)];
        return type === undefined ? text("entry.groupAlreadyAdded") : text("entry.groupAlreadyAddedNamed", {name: typeLabel(type)});
    };
    const ops = types.map((type): EntryOp => ({op: "component", entry: props.id, type, action: "add"}));
    if (!(await runEntries(ops, port.t(title), "creative", from, alreadyAdded))) return false;
    const items = componentsRead.value?.data?.items ?? [];
    pendingTab.value = types.map((type) => items.find((item) => item.id === type)?.namespace ?? null).find((namespace) => namespace !== null) ?? null;
    if (from === "dialog") addDialogOpen.value = false;
    return true;
};
// 移动到……：打开时按 id 读一次原始条目（种类、上级、出场不在条目读取里），确认时只带改了的几项（`place`）。
/** 条目选择器的查找（`findEntries`）；`kinds` 是引用字段声明的 `targets`，空的不筛。 */
/** 查到的一项换成选择器的候选：按别名命中的、还没出场的各有一句说明，两句都在时并排写。 */
const candidateOf = (item: FoundEntry) => {
    const notes = [...(item.matchedAlias === undefined ? [] : [port.t(text("entryPicker.alias", {alias: item.matchedAlias}))]), ...(item.appeared ? [] : [port.t(text("entries.unappeared"))])];
    return {id: item.id, name: item.name, kind: item.kind, ...(notes.length === 0 ? {} : {note: notes.join(" · ")})};
};
const finderFor = (kinds: readonly string[]) => (query: string) => props.client.call("findEntries", {query, position: position.value, limit: 20, ...(kinds.length === 0 ? {} : {kinds: [...kinds]})}).then((found) => (found.ok ? {ok: true as const, items: found.value.items.map(candidateOf)} : {ok: false as const, reason: port.t(failureText(found.failure).text)}));
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
    openDialog();
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

/* ---------- 列表的元素（canon.revisions 输出 25 的 listAdd、listRemove 与元素子字段的 set） ---------- */

interface ElementDraft {
    readonly mode: "add" | "edit";
    readonly namespace: string;
    readonly field: string;
    readonly element?: string;
    readonly keyed: boolean;
    readonly key: string | null;
    readonly keyName: string;
    readonly label: string;
    readonly values: Readonly<Record<string, unknown>>;
    readonly original: Readonly<Record<string, unknown>>;
    /** 作者动过的子字段。加一项时没动过的写未知：布尔的输入画不出“未知”，缺省画成“否”，不能当成填了“否”。 */
    readonly touched: readonly string[];
    readonly originalLabel: string;
    readonly intent: EditIntent;
}
const elementDraft = shallowRef<ElementDraft | null>(null);
/** 改一项时引用子字段当前值的名字（子字段 id 到名字），打开时按 id 读。 */
const elementRefNames = shallowRef<Readonly<Record<string, string>>>({});
let elementOpens = 0;
const elementOpen = shallowRef(false);
const listDeclaration = (namespace: string, field: string): FieldDeclaration | undefined => entry.value?.declarations?.[namespace]?.find((item) => item.id === field);
const intentsHere = (): EditIntent[] => (position.value.kind === "initial" ? ["creative"] : ["creative", "story"]);
const elementFields = computed<ElementField[]>(() => {
    const draft = elementDraft.value;
    const declaration = draft === null ? undefined : listDeclaration(draft.namespace, draft.field);
    return (declaration?.item ?? []).map((sub) => {
        const kind = kindOf(sub);
        // 有建议值的文字：候选是它的建议值（输入框里照样能写别的）。
        const options = kind === "suggest" ? sub.suggestions : sub.options;
        return {id: sub.id, label: sub.label, kind, ...(options === undefined ? {} : {options}), ...(sub.unit === undefined ? {} : {unit: sub.unit}), ...(sub.precision === "semantic" ? {semantic: true} : {})};
    });
});
// 以条目为键的列表选“指向的条目”、引用子字段选条目：各按自己的 `targets` 查。
const keyFind = useEntryFind(() => finderFor(elementDraft.value === null ? [] : listDeclaration(elementDraft.value.namespace, elementDraft.value.field)?.targets ?? []));
const elementRefField = shallowRef<string | null>(null);
const elementRefFind = useEntryFind(() => {
    const draft = elementDraft.value;
    const sub = draft === null ? undefined : listDeclaration(draft.namespace, draft.field)?.item?.find((item) => item.id === elementRefField.value);
    return finderFor(sub?.targets ?? []);
});
const openElement = (namespace: string, field: string, element?: string): void => {
    const declaration = listDeclaration(namespace, field);
    if (declaration?.kind !== "list") return;
    const items = (view.value?.namespaces[namespace]?.fields[field]?.value ?? []) as Array<Record<string, unknown>>;
    const item = element === undefined ? undefined : items.find((candidate) => String(candidate.id) === element);
    const values = Object.fromEntries((declaration.item ?? []).map((sub) => [sub.id, draftText(item === undefined ? undefined : {value: item[sub.id] ?? null}, kindOf(sub))]));
    const label = typeof item?.label === "string" ? item.label : "";
    openDialog();
    // 以条目为键的一项没有 label，选择器里显示与列表行同样的文字。
    elementDraft.value = {mode: element === undefined ? "add" : "edit", namespace, field, ...(element === undefined ? {} : {element}), keyed: declaration.keyedBy === "ref", key: element ?? null, keyName: item === undefined ? "" : displayText([item]), label, values, original: values, touched: [], originalLabel: label, intent: intentsHere()[0]!};
    elementOpen.value = true;
    // 引用子字段的当前值只有 id：按 id 各读一次条目取名字，输入框里显示名字。读回来时对话框已经换了一次打开的，丢掉。
    const opened = ++elementOpens;
    elementRefNames.value = {};
    const refs = (declaration.item ?? []).flatMap((sub) => (kindOf(sub) === "ref" && typeof values[sub.id] === "string" && values[sub.id] !== "" ? [[sub.id, values[sub.id] as string] as const] : []));
    void Promise.all(refs.map(async ([sub, id]) => {
        const read = await props.client.call("entry", {id, position: position.value, mode: "actual"});
        return [sub, read.ok ? read.value.view?.name : undefined] as const;
    })).then((names) => {
        if (opened === elementOpens) elementRefNames.value = Object.fromEntries(names.filter((pair): pair is readonly [string, string] => pair[1] !== undefined));
    });
};
/** 填的值换成字段的值：空的是未知（null）；数填得不成形时为 undefined。 */
const elementValue = (value: unknown, kind: ElementField["kind"]): unknown => (value === "" || value === null ? null : parsed(value, kind));
const confirmElement = async (): Promise<void> => {
    const draft = elementDraft.value;
    if (draft === null) return;
    const list = `${draft.namespace}.${draft.field}`;
    const fieldLabel = listDeclaration(draft.namespace, draft.field)?.label ?? draft.field;
    const name = view.value?.name ?? "";
    let ops: EntryOp[];
    if (draft.mode === "add") {
        const element: Record<string, unknown> = {};
        for (const field of elementFields.value) {
            const value = draft.touched.includes(field.id) ? elementValue(draft.values[field.id], field.kind) : null;
            if (value === undefined) {
                dialogError.value = port.t(text("list.badValue", {field: field.label}));
                return;
            }
            element[field.id] = value;
        }
        if (draft.keyed) {
            if (draft.key === null) {
                dialogError.value = port.t(text("list.needKey"));
                return;
            }
            element.id = draft.key;
        } else {
            if (draft.label.trim() === "") {
                dialogError.value = port.t(text("list.needLabel"));
                return;
            }
            element.label = draft.label.trim();
        }
        ops = [{op: "listAdd", at: {entry: props.id, path: list}, element}];
    } else {
        ops = [];
        for (const field of elementFields.value) {
            if (field.semantic || JSON.stringify(draft.values[field.id]) === JSON.stringify(draft.original[field.id])) continue;
            const value = elementValue(draft.values[field.id], field.kind);
            if (value === undefined) {
                dialogError.value = port.t(text("list.badValue", {field: field.label}));
                return;
            }
            ops.push({op: "set", at: {entry: props.id, path: `${list}[${draft.element!}].${field.id}`}, value});
        }
        if (!draft.keyed && draft.label.trim() !== draft.originalLabel) ops.push({op: "set", at: {entry: props.id, path: `${list}[${draft.element!}].label`}, value: draft.label.trim()});
        if (ops.length === 0) {
            elementOpen.value = false;
            return;
        }
    }
    const title = port.t(text(draft.mode === "add" ? "list.added" : "list.edited", {name, field: fieldLabel}));
    if (await runEntries(ops, title, draft.intent)) elementOpen.value = false;
};
// 去掉一项：先确认，可选意图。来自某章变更的一项按“改设定”去不掉（element-from-change），原因写在对话框里，改选“剧情里变了”再去。
const removeElementDraft = shallowRef<{readonly namespace: string; readonly field: string; readonly element: string; readonly item: string; readonly intent: EditIntent} | null>(null);
const openRemoveElement = (namespace: string, field: string, element: string): void => {
    const items = (view.value?.namespaces[namespace]?.fields[field]?.value ?? []) as Array<Record<string, unknown>>;
    const item = items.find((candidate) => String(candidate.id) === element);
    openDialog();
    removeElementDraft.value = {namespace, field, element, item: item === undefined ? element : displayText([item]), intent: intentsHere()[0]!};
};
const confirmRemoveElement = async (): Promise<void> => {
    const draft = removeElementDraft.value;
    if (draft === null) return;
    const title = port.t(text("list.removed", {name: view.value?.name ?? "", field: listDeclaration(draft.namespace, draft.field)?.label ?? draft.field, item: draft.item}));
    if (await runEntries([{op: "listRemove", at: {entry: props.id, path: `${draft.namespace}.${draft.field}[${draft.element}]`}}], title, draft.intent)) removeElementDraft.value = null;
};

/* ---------- 主文字（输出 39、44 到 46）：整篇的编辑在 `text-tab.ts`，这里只接线 ---------- */

const textTab = useTextTab({
    entry: props.id,
    session: props.draft,
    world,
    call: props.client.call,
    name: () => view.value?.name ?? "",
    position: () => position.value,
    // 条目已删除时稿还在（能看、能放弃），提交不可用：恢复以后才能发。
    blocked: () => (view.value?.deleted === true ? text("textEdit.blockedDeleted") : editBlocked.value === null ? "" : port.t(editBlocked.value)),
    notices: props.notices,
    text,
    translate: (value) => port.t(value),
});
// 稿在别处的标签里就有了（刷新以后）：这一页挂上时去读。
void props.draft.load();
/* ---------- 富文本里小块的值（输出 48） ---------- */

/** 在富文本里编辑：要小块的值。已删除的条目只列稿；读不出块时（`frozen`）没有可算的。 */
const valuesWanted = computed(() => state.textMode === "rich" && tab.value === "text" && textTab.editing.value && view.value?.deleted !== true && !textTab.editor.value.frozen);
const textValues = useTextValues({
    call: props.client.call,
    input: () => (valuesWanted.value ? {entry: props.id, source: textTab.editor.value.text, position: position.value, mode: mode.value} : null),
    // 世界变了（别处改了字段的值、条目的名字）或重新连上：重读。
    stamp: () => `${String(world.status.value.data?.version ?? "")}|${world.connection.value}`,
});
/** 存下的那一版主文字（阅读视图读到的各块，用一个空行连起来，同开始编辑时的整篇）。 */
const savedText = computed(() => blocks.value.map((block) => ("source" in block ? block.source : block.text)).join("\n\n"));
/** 存下的那一版里没登记的标签：写入前的检查与源文字的检查放行它们。 */
const richBaseline = computed(() => baselineOf(savedText.value));
/** 本条目的字段与这一页位置上的值：刚插进来的取值马上显示。引用要稳定（富文本按它整篇重对值），单独一个 computed。 */
const richFields = computed((): EntryField[] => namespaces.value.flatMap((namespace) => {
    const group = typeLabel(view.value?.namespaces[namespace]?.type ?? "");
    return (entry.value?.declarations?.[namespace] ?? []).map((declaration) => {
        const value = view.value?.namespaces[namespace]?.fields[declaration.id]?.value;
        return {path: `${namespace}.${declaration.id}`, label: declaration.label, group, display: value === null || value === undefined ? null : valueText(value, declaration, text)};
    });
}));
/**
 * 值表：算回来的那一份；还没回来时，刚点“编辑”、稿与阅读视图读到的那一块相同，就用阅读视图手里的值当初值，不先画“计算中”。
 */
const richValues = computed((): TextValueTable | null => {
    if (textValues.table.value !== null) return textValues.table.value;
    const only = blocks.value.length === 1 ? blocks.value[0] : undefined;
    return only !== undefined && "values" in only && only.source === textTab.editor.value.text ? {source: only.source, values: only.values} : null;
});
const richContext = computed((): RichContext => ({
    self: props.id,
    fields: richFields.value,
    marks: marks.value,
    values: richValues.value,
    // 不请求值（冻结稿、已删除的条目）时没有值在路上：没有值的小块画“没有算”，不画“计算中”。
    computing: valuesWanted.value && textValues.failure.value === null && textTab.editor.value.text.length <= RENDER_SOURCE_MAX,
    find: finder,
    baseline: richBaseline.value,
}));

const editorRef = shallowRef<{focus(): void} | null>(null);
/** 点“编辑”进去以后焦点进输入框：阅读视图先退场、编辑视图才挂上，等进场结束再给。只管这一次点击：没进去就不留着。 */
let focusFirst = false;
const startEditing = async (): Promise<void> => {
    actionError.value = "";
    const failed = await textTab.start();
    focusFirst = failed === "";
    // 没进去（读不出块、这个条目不能整篇改）：人还在阅读视图，原因写在那里。
    actionError.value = failed;
};
/** 编辑视图的事件：文字分页里与“已删除”下面是同一个编辑视图，接法只写一处。 */
const editorOn = {
    update: textTab.update,
    blur: () => textTab.flush(),
    submit: () => void textTab.submit(),
    discard: () => void textTab.leave(),
    cancel: () => void textTab.leave(),
    takeOver: () => void textTab.takeOver(),
    adopt: () => void textTab.adopt(),
    retry: () => void textTab.retry(),
    "update:mode": (value: "rich" | "source") => (state.textMode = value),
    "update:showBranches": (value: boolean) => (state.showBranches = value),
};
const focusEditor = (): void => {
    if (focusFirst) editorRef.value?.focus();
    focusFirst = false;
};
/** “插入”里列的写法：本条目各设定组的字段，写成“设定组 · 字段”。 */
const inserts = computed((): InsertItem[] => namespaces.value.flatMap((namespace) => {
    const group = typeLabel(view.value?.namespaces[namespace]?.type ?? "");
    return (entry.value?.declarations?.[namespace] ?? []).map((field) => ({label: `${group} · ${field.label}`, snippet: `<V of="${namespace}.${field.id}" />`}));
}));
// 页面转入后台（切标签、最小化、关窗之前）：把还没写下去的稿写进暂存。
const onHidden = (): void => {
    if (document.visibilityState === "hidden") textTab.flush();
};
onMounted(() => {
    document.addEventListener("visibilitychange", onHidden);
    props.onCommitReady(() => textTab.submit());
});
onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onHidden);
    textTab.flush();
    props.onCommitReady(null);
});
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
/**
 * 专门界面的写入（`context.fieldAdd` 这些、`addComponent`）：原因交回界面自己写，不写到页头或对话框里。草稿所在的字段被去掉或
 * 改名时清掉草稿（输出 51）。
 */
const viewWrite = async (ops: EntryOp[], title: Text): Promise<ViewWriteResult> => {
    if (editBlocked.value !== null) return {ok: false, reason: editBlocked.value};
    const titleText = port.t(title);
    const result = await world.write("editEntries", {input: {requestId: `view-${crypto.randomUUID()}`, by: {kind: "author"}, what: "edit", baseVersion: version(), title: titleText, intent: "creative", position: position.value, ops}});
    if (!result.ok) return {ok: false, reason: failureText(result.failure).text};
    props.notices.show({revision: result.value.revision, title: titleText});
    return {ok: true};
};
const fieldLabel = (namespace: string, field: string): string => entry.value?.declarations?.[namespace]?.find((item) => item.id === field)?.label ?? entry.value?.removedFields?.[namespace]?.find((item) => item.id === field)?.label ?? field;
const dropDraftOn = (namespace: string, field: string): void => {
    if (state.edit?.path === `${namespace}.${field}`) state.edit = null;
};
/** 同一条目上别的组的只读视图（`context.other` 的 `present`），每个命名空间一个。 */
const peers = new Map<string, ComponentPeer>();
const peerFor = (namespace: string): ComponentPeer => {
    let found = peers.get(namespace);
    if (found === undefined) {
        found = {
            namespace,
            get fields() { return view.value?.namespaces[namespace]?.fields ?? {}; },
            get declarations() { return entry.value?.declarations?.[namespace] ?? []; },
        };
        peers.set(namespace, found);
    }
    return found;
};
/** `context.other`：只认这个界面的声明里 `uses` 列了的类型（输入一节）。 */
const otherFor = (namespace: string, type: string): OtherComponent => {
    const own = view.value?.namespaces[namespace]?.type;
    const uses = props.views.entries().find((item) => item.id === own)?.declaration.uses ?? [];
    if (!uses.includes(type)) return {status: "absent"};
    const present = Object.entries(view.value?.namespaces ?? {}).find(([, data]) => data.type === type)?.[0];
    if (present !== undefined) return {status: "present", peer: peerFor(present)};
    const registered = componentsRead.value?.data?.items.find((item) => item.id === type);
    const later = registered === undefined ? undefined : view.value?.upcoming.find((item) => item.namespace === registered.namespace);
    if (later !== undefined) return {status: "later", from: place(later.from)};
    if ((view.value?.removedComponents ?? []).some((item) => item.type === type)) return {status: "removed"};
    if (componentsRead.value?.data !== undefined && registered === undefined) return {status: "unavailable"};
    return {status: "absent"};
};
/**
 * 打开一项的就地改。同一项已经开着时只把焦点放回它的输入框，不重开：重开会换掉写了一半的草稿，成段的文字开着时原文还在、
 * 点得到（输出 51）。带着值打开的（“换上”某一套）照旧重开。
 */
/**
 * 这一页挂着的就地改编辑器（按路径）：编辑器传送到 body 里，从页面里找不到；同一个条目开在两页、都在改同一项时，要找自己这页的。
 */
const inlineEditorElements = new Map<string, HTMLElement>();
/** 成段文字的编辑浮层至少要这么高才好用（几行输入、意图一行与按钮）。 */
const PASSAGE_ROOM = 240;
/**
 * 成段文字的编辑浮层贴着什么定位（输出 51）：原文下方或上方腾得出 `PASSAGE_ROOM` 时贴整段原文；原文太长、上下都腾不出时，改贴原文
 * 露在窗口里的第一行，浮层盖住后面几行（原文这时本来就看不全）。浮层跟着滚动重算，每次按当时露出来的那一段算。露出来的那一段是
 * 条目页所在滚动区去掉吸顶页头（`--entry-page-sticky-top`）以后的部分；滚动区在挂上时找一次。
 */
const passageReference = (anchor: HTMLElement): PopoverReference => {
    const page = anchor.closest<HTMLElement>("[data-entry-page]");
    let scroller: HTMLElement | null = null;
    for (let element = page?.parentElement ?? null; element !== null && scroller === null; element = element.parentElement) {
        const overflow = getComputedStyle(element).overflowY;
        if (overflow === "auto" || overflow === "scroll") scroller = element;
    }
    return {
        contextElement: anchor,
        getBoundingClientRect: () => {
            const rect = anchor.getBoundingClientRect();
            const box = scroller?.getBoundingClientRect() ?? {top: 0, bottom: window.innerHeight};
            const top = box.top + (page === null ? 0 : Number.parseFloat(getComputedStyle(page).getPropertyValue("--entry-page-sticky-top")) || 0);
            if (box.bottom - rect.bottom >= PASSAGE_ROOM || rect.top - top >= PASSAGE_ROOM) return rect;
            const line = Number.parseFloat(getComputedStyle(anchor).lineHeight) || 30;
            return new DOMRect(rect.left, Math.min(Math.max(rect.top, top), Math.max(rect.top, rect.bottom - line)), rect.width, line);
        },
    };
};
const openInline = (path: string, options?: EditOpenOptions): void => {
    if (options?.inline === true && options.value === undefined && state.edit?.inline === true && state.edit.path === path) {
        inlineEditorElements.get(path)?.querySelector<HTMLElement>("textarea, input")?.focus();
        return;
    }
    edit.open(path, options);
};
/** 就地改的编辑器（`context.FieldEditor`）与值的细节（`context.FieldDetail`），每个命名空间各一个组件定义。 */
const fieldEditors = new Map<string, Component<FieldEditorProps>>();
const fieldEditorOf = (namespace: string): Component<FieldEditorProps> => {
    let found = fieldEditors.get(namespace);
    if (found === undefined) {
        found = defineComponent({
            name: "CanonFieldEditor",
            props: {
                path: {type: String, required: true},
                layout: {type: String as PropType<"popover" | "block">, default: "popover"},
                suggestions: {type: Array as PropType<readonly string[]>, default: undefined},
                anchor: {type: Object as PropType<object | null>, default: null},
            },
            setup(inner) {
                const full = (): string => `${namespace}.${inner.path}`;
                let release = holdInline(full());
                watch(() => inner.path, () => {
                    release();
                    release = holdInline(full());
                });
                onBeforeUnmount(() => release());
                // 输入法组字中、保存或上传在途时，点外面、Escape 与“取消”都不算放弃（输出 51）：三条路都经 `dismiss`。
                const composing = shallowRef(false);
                const active = computed(() => state.edit?.inline === true && state.edit.path === full() && edit.bar.value !== null);
                const dismiss = (): void => {
                    if (composing.value || edit.bar.value?.saving === true || imagePicking?.uploading === true) return;
                    edit.cancel();
                };
                // 浮层关上以后还要淡出一会（Popover 的退场动画）：这期间照最后那一份画，不让它先塌成一块空的表面。
                const shown = shallowRef<NonNullable<typeof edit.bar.value> | null>(null);
                watch([active, edit.bar], ([on, bar]) => {
                    if (on && bar !== null) shown.value = bar;
                }, {immediate: true});
                /**
                 * 浮层的宽（内容区，不含浮层的内边距），打开时量一次。左缘对齐值的起点，放得下就不往左让、不盖住左边的标签列（输出 51）：
                 * 短项从值的左缘量到条目页的右缘，夹在 16rem 与 22rem 之间；成段的文字与原文同宽，不窄于 22rem、不越过条目页的右缘。
                 * 连下限都放不下时才由避让往左挪。
                 */
                const popoverWidth = shallowRef<number | null>(null);
                const reference = computed(() => (inner.layout === "block" && inner.anchor instanceof HTMLElement ? passageReference(inner.anchor) : null));
                /** 浮层表面两侧的内边距（各 12）与边框（各 1）。 */
                const POPOVER_PADDING = 26;
                watch([active, () => inner.anchor], ([on, anchor]) => {
                    if (!on || !(anchor instanceof HTMLElement)) return;
                    const page = anchor.closest("[data-entry-page]");
                    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
                    const box = anchor.getBoundingClientRect();
                    const room = page === null ? Number.POSITIVE_INFINITY : page.getBoundingClientRect().right - box.left - POPOVER_PADDING;
                    popoverWidth.value = inner.layout === "block" ? Math.max(Math.min(Math.max(box.width, 22 * rem), room), 16 * rem) : Math.min(22 * rem, Math.max(16 * rem, room));
                    // 浮层跟着锚走：锚在滚动区外面时浮层也在窗口外。点开时锚就在眼前，这里不动；切走再回来（输出 7：编辑与填的字还在）
                    // 页面从顶上重新挂上，把锚滚进来，写了一半的编辑跟着回到眼前。
                    anchor.scrollIntoView?.({block: "nearest"});
                }, {immediate: true});
                const content = () => {
                    // 这一处另给了建议值（现在穿的：衣柜里各套的名字）：文字字段用输入框加候选。
                    const given = shown.value!;
                    const suggested = inner.suggestions !== undefined && inner.suggestions.length > 0 && (given.kind === "text" || given.kind === "suggest");
                    const bar = suggested ? {...given, kind: "suggest" as const, options: inner.suggestions!} : given;
                    // 浮层里的短项是单行输入（回车保存）；成段的文字从原文的行数起步。
                    const rows = inner.layout === "popover" ? 1 : bar.kind === "text" ? Math.max(2, String(bar.value ?? "").split("\n").length + 1) : 2;
                    return h("div", {
                        "data-field-editor": full(),
                        ref: (element: unknown) => {
                            if (element instanceof HTMLElement) inlineEditorElements.set(full(), element);
                            else inlineEditorElements.delete(full());
                        },
                        ...(popoverWidth.value !== null ? {style: {width: `${String(popoverWidth.value)}px`}} : {}),
                        onCompositionstart: () => (composing.value = true),
                        onCompositionend: () => (composing.value = false),
                    }, [h(ConfirmBar, {
                        ...bar,
                        variant: "inline",
                        rows,
                        refResults: refFind.results.value,
                        refName: refName.value,
                        onSearchRef: refFind.search,
                        "onUpdate:value": edit.update,
                        "onUpdate:intent": edit.setIntent,
                        "onUpdate:note": edit.setNote,
                        onSave: () => edit.save(),
                        onRecheck: () => edit.recheck(),
                        onCancel: dismiss,
                    })]);
                };
                return () => {
                    // 图片那一档的浮层高（候选的方格加输入），锚多半是竖长的立绘：放在锚的右边，不上下翻出窗口。别的都在值的下方，
                    // 放不下时由避让翻到上方，不与值重叠。避让以条目页为界：浮层不越出编辑区、盖到旁边的侧栏上（右边一栏的值，浮层自己往左让）。
                    // 成段的文字（输出 51）：原文不动，浮层盖在后面的内容上；内容高度封顶在避让算出的可用高度，保存总在窗口里。点外面不收起
                    // （`update:open(false)` 整个忽略）；Escape 由确认条自己接：组字中不接，接了会 preventDefault，Reka 就不再发关闭。
                    const anchor = inner.anchor as HTMLElement | null;
                    const passage = inner.layout === "block";
                    return h(Popover, {
                        open: active.value && anchor !== null,
                        anchor,
                        reference: reference.value,
                        side: shown.value?.kind === "image" ? "right" : "bottom",
                        align: "start",
                        collisionBoundary: anchor?.closest("[data-entry-page]") ?? null,
                        contentClass: passage ? "max-w-[calc(100vw-32px)] max-h-[var(--reka-popper-available-height)] overflow-y-auto select-text" : "max-w-[calc(100vw-32px)] select-text",
                        "onUpdate:open": (open: boolean) => {
                            if (!open && !passage) dismiss();
                        },
                    }, {default: () => (shown.value !== null ? content() : null)});
                };
            },
        });
        fieldEditors.set(namespace, found);
    }
    return found;
};
/**
 * 名字、简介的就地改（输出 38）：页头的按钮交来锚点，编辑器是命名空间 `entry` 那一个（路径 `entry.name`、`entry.summary`，见
 * `HEAD_FIELDS`），与人物分页的短项同一套浮层。两个编辑器一直挂着，就地改的草稿才认得它们（`inlineHere`），不出页顶的确认条。
 */
const headEditor = fieldEditorOf("entry");
const headAnchors = shallowReactive<{name: HTMLElement | null; summary: HTMLElement | null}>({name: null, summary: null});
const openHead = (field: "name" | "summary", anchor: HTMLElement): void => {
    headAnchors[field] = anchor;
    openInline(`entry.${field}`, {inline: true});
};
const fieldDetails = new Map<string, Component<{readonly path: string}>>();
const fieldDetailOf = (namespace: string): Component<{readonly path: string}> => {
    let found = fieldDetails.get(namespace);
    if (found === undefined) {
        found = defineComponent({
            name: "CanonFieldDetail",
            props: {path: {type: String, required: true}},
            setup: (inner) => () => h(FieldDetailView, {context: contextFor(namespace), path: inner.path}),
        });
        fieldDetails.set(namespace, found);
    }
    return found;
};
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
            edit: (path, options) => openInline(`${namespace}.${path}`, options),
            record: (path, input) => record(`${namespace}.${path}`, input),
            listAdd: (path) => openElement(namespace, path),
            listEdit: (path, element) => openElement(namespace, path, element),
            listRemove: (path, element) => openRemoveElement(namespace, path, element),
            open: props.open,
            other: (type) => otherFor(namespace, type),
            addComponent: (type) => viewWrite([{op: "component", entry: props.id, type, action: "add"}], text("entry.groupAdded", {name: typeLabel(type)})),
            // 刚加上的那一组可能还没出现在读取结果里（写入的结果先回来）：记下它的命名空间，出现了再切过去（同“＋”）。
            showTab: (type) => {
                const target = Object.entries(view.value?.namespaces ?? {}).find(([, data]) => data.type === type)?.[0];
                if (target !== undefined) state.tab = `${DATA}${target}`;
                else pendingTab.value = componentsRead.value?.data?.items.find((item) => item.id === type)?.namespace ?? null;
            },
            fieldAdd: (field: FieldDraft) => viewWrite([{op: "fieldAdd", entry: props.id, namespace, field}], text("entry.fieldAdded", {name: view.value?.name ?? "", label: field.label})),
            fieldRename: async (path, label) => {
                const from = fieldLabel(namespace, path);
                const result = await viewWrite([{op: "fieldRename", at: {entry: props.id, path: `${namespace}.${path}`}, label}], text("entry.fieldRenamed", {name: view.value?.name ?? "", from, label}));
                if (result.ok) dropDraftOn(namespace, path);
                return result;
            },
            fieldRemove: async (path) => {
                const result = await viewWrite([{op: "fieldRemove", at: {entry: props.id, path: `${namespace}.${path}`}}], text("entry.fieldRemoved", {name: view.value?.name ?? "", label: fieldLabel(namespace, path)}));
                if (result.ok) dropDraftOn(namespace, path);
                return result;
            },
            fieldRestore: (path) => viewWrite([{op: "fieldRestore", at: {entry: props.id, path: `${namespace}.${path}`}}], text("entry.fieldRestored", {name: view.value?.name ?? "", label: fieldLabel(namespace, path)})),
            get removedFields() { return entry.value?.removedFields?.[namespace] ?? []; },
            get presets() {
                const type = view.value?.namespaces[namespace]?.type;
                return componentsRead.value?.data?.items.find((item) => item.id === type)?.presets ?? [];
            },
            get FieldEditor() { return fieldEditorOf(namespace); },
            get FieldDetail() { return fieldDetailOf(namespace); },
            get editing() {
                const draft = state.edit;
                return draft?.inline === true && draft.path.startsWith(`${namespace}.`) ? draft.path.slice(namespace.length + 1) : null;
            },
            get detail() {
                const value = state.views[namespace]?.detail;
                return typeof value === "string" ? value : null;
            },
            showDetail: (path) => {
                const bag = (state.views[namespace] ??= {});
                bag.detail = path;
            },
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

/* ---------- 设定组的三种看法（输出 54） ---------- */

type DataLook = "card" | "agent" | "raw";
/**
 * 设定组分页看哪一种（用户视图、AI视图、原始视图）；换分页回到用户视图（不记进标签状态：重开页面也是它）。切换的入口在选中的
 * 分页上（`EntryPage` 的看法菜单，输出 9）。
 */
const dataLook = shallowRef<DataLook>("card");
watch(tab, () => {
    dataLook.value = "card";
});
const dataLooks = computed(() => (["card", "agent", "raw"] as const).map((value) => ({value, label: port.t(text(`entry.views.${value}`))})));
/**
 * “AI视图”：后端 `canon_read` 用的同一个函数写这一组的那一节；条目视图是按“在看”的位置与模式读到的那份。节头的显示名与
 * “可以加字段”来自设定组类型列表：还没读到或读失败时写读取中、失败，不拿空列表写出一段与模型所见不同的字。
 */
const agentView = computed(() => {
    const namespace = dataNamespace.value;
    const types = componentsRead.value?.data?.items;
    if (dataLook.value !== "agent" || namespace === null || view.value === null) return {text: "", loading: false, failed: null};
    if (types === undefined) {
        const failure = componentsRead.value?.error ?? null;
        return {text: "", loading: failure === null, failed: failure === null ? null : port.t(failureText(failure).text)};
    }
    return {text: fieldsText(view.value, entry.value?.declarations ?? {}, types, {namespace}), loading: false, failed: null};
});
/** “原始视图”：存下来的条目（取初值）与按这一组筛的剧情变更；不跟“在看”走，只在看它时读。 */
const rawEntry = useWorldRead(world, "object", () => (dataLook.value === "raw" ? {ref: {kind: "entry" as const, id: props.id}} : null));
const rawChanges = useWorldList(world, "changes", () => (dataLook.value === "raw" && dataNamespace.value !== null ? {filter: {entry: props.id, namespace: dataNamespace.value}} : null), 20);
const rawView = computed(() => {
    const namespace = dataNamespace.value ?? "";
    const stored = rawEntry.value?.data?.object as Entry | null | undefined;
    const list = rawChanges.state.value;
    const failure = rawEntry.value?.error ?? list?.error ?? null;
    const total = list?.data?.total ?? 0;
    return {
        initial: stored?.init.data[namespace],
        // 每条只留落在这个条目这一组下的改动：同一条变更里别的条目、别的组的改动与这一页无关。
        changes: (list?.items ?? []).map(({change}) => ({...change, patches: change.patches.filter((patch) => patch.at.entry === props.id && patch.at.path.startsWith(`${namespace}.`))})),
        total,
        remaining: Math.max(0, total - (list?.items.length ?? 0)),
        initialLoading: rawEntry.value?.loading ?? true,
        changesLoading: list?.loading ?? true,
        failed: failure === null ? null : port.t(failureText(failure).text),
    };
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

const rows = computed(() => positionChapters(chapters.value));
const notAppeared = computed(() => view.value !== null && !view.value.appeared);
const setPosition = (value: string): void => {
    state.position = positionFromValue(value) === null ? null : value;
};
</script>

<template>
    <div ref="hostRoot" class="min-h-full">
        <EntryPage
            :status="status"
            :name="view?.name ?? ''"
            :summary="view?.summary ?? ''"
            :same-as="entry?.sameAs ?? null"
            :chapters="rows"
            :position="positionValue(position)"
            :planned="mode === 'planned'"
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
            :position-locked="textTab.editing.value ? text('textEdit.locked') : ''"
            :can-plan="canPlan"
            :busy="acting"
            @edit-name="(anchor: HTMLElement) => openHead('name', anchor)"
            @edit-summary="(anchor: HTMLElement) => openHead('summary', anchor)"
            @aliases="changeAliases"
            @restore="restore()"
            :looks="dataLooks"
            :look="dataLook"
            @update:look="(value: string) => (dataLook = value as DataLook)"
            :addable="addableTypes"
            @add-open="openAddMenu()"
            @add-dialog="openAddDialog()"
            @add-component="(type: string) => addComponents([type], 'menu')"
            @remove-component="openDialog(); removeOpen = true"
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
                    @update:note="edit.setNote"
                    @save="edit.save()"
                    @recheck="edit.recheck()"
                    @cancel="edit.cancel()"
                />
            </template>
            <!-- 条目已删除、稿还在：页头换成“已删除”，稿列在它下面，能看、能放弃。 -->
            <template #deleted>
                <EntryTextEditor v-if="textTab.editing.value" class="mt-6" v-bind="textTab.editor.value" :inserts="inserts" :input="props.sourceInput ?? undefined" :language="ENTRY_LANGUAGE" :rich="richContext" :mode="state.textMode" :show-branches="state.showBranches" v-on="editorOn" />
            </template>
            <Transition v-if="tab === 'text'" name="nb-ui-switch" mode="out-in" @after-enter="focusEditor">
                <EntryTextEditor
                    v-if="textTab.editing.value"
                    ref="editorRef"
                    key="edit"
                    v-bind="textTab.editor.value"
                    :inserts="inserts"
                    :input="props.sourceInput ?? undefined"
                    :language="ENTRY_LANGUAGE"
                    :rich="richContext"
                    :mode="state.textMode"
                    :show-branches="state.showBranches"
                    v-on="editorOn"
                />
            <EntryText
                v-else
                key="read"
                :blocks="blocks"
                :self="props.id"
                :marks="marks"
                :open="state.origin ?? undefined"
                :editable="view !== null && !view.deleted"
                :edit-reason="editBlocked === null ? '' : port.t(editBlocked)"
                @value="toggleValue"
                @close="state.origin = null"
                @entry="(id: string) => props.open({kind: 'entry', id})"
                @edit="startEditing()"
            >
                <template #origin="{address}">
                    <OriginList
                        v-if="shownOrigin !== undefined"
                        :caption="text('origin.caption', {label: labelOfAddress(address)})"
                        :rows="originRows(shownOrigin, declarationOf(address), place, text)"
                        :remaining="shownOrigin.remaining"
                        :loading="shownOrigin.loading"
                        :failed="shownOrigin.failed"
                        :reason="shownOrigin.reason"
                        @more="originAddress !== null && origins.get(originAddress)?.more()"
                        @retry="originAddress !== null && origins.get(originAddress)?.retry()"
                        @change="(id: string) => openChangeFromOrigin(id)"
                    />
                </template>
            </EntryText>
            </Transition>
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
                <Transition name="nb-ui-switch" mode="out-in">
                    <ComponentAgentView v-if="dataLook === 'agent'" v-bind="agentView" :position="positionLabel(position, chapters, text)" @retry="world.retry()" />
                    <ComponentRawView v-else-if="dataLook === 'raw'" v-bind="rawView" @more="rawChanges.more()" @retry="world.retry()" />
                    <div v-else>
                        <p v-if="dataView.failed !== null" role="alert" class="mb-3 text-[length:var(--text-sm)] text-[var(--status-warning)]">{{ text("fields.viewFailed", {reason: dataView.failed}) }}</p>
                        <p v-if="dataView.loading" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("entries.loading") }}</p>
                        <component :is="dataView.component" v-else-if="dataView.component !== null" :key="dataNamespace" :context="contextFor(dataNamespace)" />
                        <FieldsDataView v-else :key="dataNamespace" :context="contextFor(dataNamespace)" />
                    </div>
                </Transition>
            </template>
            <template v-else-if="extraTab !== null">
                <p v-if="extraView.failed !== null" role="alert" class="mb-3 text-[length:var(--text-sm)] text-[var(--status-warning)]">{{ text("fields.viewFailed", {reason: extraView.failed}) }}</p>
                <p v-else-if="extraView.loading" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("entries.loading") }}</p>
                <component :is="extraView.component" v-else-if="extraView.component !== null" :key="extraTab" :context="tabContextFor(extraTab)" />
            </template>
        </EntryPage>
        <ElementDialog
            v-if="elementDraft !== null"
            :open="elementOpen"
            :title="text(elementDraft.mode === 'add' ? 'list.addTitle' : 'list.editTitle', {field: listDeclaration(elementDraft.namespace, elementDraft.field)?.label ?? elementDraft.field})"
            :keyed="elementDraft.keyed"
            :editing="elementDraft.mode === 'edit'"
            :key-value="elementDraft.key"
            :key-name="elementDraft.keyName"
            :key-results="keyFind.results.value"
            :label="elementDraft.label"
            :fields="elementFields"
            :values="elementDraft.values"
            :ref-results="elementRefFind.results.value"
            :ref-names="elementRefNames"
            :intents="intentsHere()"
            :intent="elementDraft.intent"
            :saving="acting"
            :error="dialogError"
            @update:open="(value: boolean) => (elementOpen = value)"
            @update:key-value="(value: string | null) => (elementDraft = {...elementDraft!, key: value, keyName: ''})"
            @search-key="keyFind.search"
            @update:label="(value: string) => (elementDraft = {...elementDraft!, label: value})"
            @update:value="(field: string, value: unknown) => (elementDraft = {...elementDraft!, values: {...elementDraft!.values, [field]: value}, touched: [...elementDraft!.touched, field]})"
            @search-ref="(field: string, query: string) => { elementRefField = field; elementRefFind.search(query); }"
            @update:intent="(value: EditIntent) => (elementDraft = {...elementDraft!, intent: value})"
            @confirm="confirmElement()"
        />
        <Dialog
            :open="removeElementDraft !== null"
            size="sm"
            :title="text('list.removeTitle', {item: removeElementDraft?.item ?? ''})"
            show-cancel
            :confirm-label="text('list.removeConfirm')"
            :busy="acting"
            :close-on-request="!acting"
            @update:open="(value: boolean) => { if (!value) removeElementDraft = null; }"
            @confirm="confirmRemoveElement()"
        >
            <div v-if="intentsHere().length > 1" class="flex items-center gap-2 text-[length:var(--text-sm)]">
                <span class="text-[var(--text-secondary)]">{{ text("edit.intent") }}</span>
                <SegmentedControl size="sm" :aria-label="text('edit.intent')" :model-value="removeElementDraft?.intent ?? 'creative'" :options="intentsHere().map((intent) => ({value: intent, label: text(intent === 'creative' ? 'edit.creative' : 'edit.story')}))" @update:model-value="(value) => (removeElementDraft = removeElementDraft === null ? null : {...removeElementDraft, intent: value as EditIntent})" />
            </div>
            <p v-if="dialogError !== ''" role="alert" class="mt-2 text-[length:var(--text-sm)] text-[var(--status-danger)]">{{ dialogError }}</p>
        </Dialog>
        <TextConflictDialog
            :open="textTab.asking.value"
            :items="textTab.conflicts.value"
            :busy="props.draft.state.phase === 'submitting'"
            @choose="textTab.choose"
            @confirm="textTab.confirmConflicts()"
            @update:open="(value: boolean) => (textTab.asking.value = value)"
        />
        <MoveDialog
            v-if="moveDraft !== null"
            :open="moveOpen"
            :entry="{id: props.id, name: view?.name ?? ''}"
            :draft="moveDraft"
            :parent-results="parentFind.results.value"
            :same-as-results="sameAsFind.results.value"
            :chapters="chapters"
            :saving="acting"
            :error="dialogError"
            @update:open="(value: boolean) => (moveOpen = value)"
            @update:draft="(value: MoveDraft) => (moveDraft = value)"
            @search-parent="parentFind.search"
            @search-same-as="sameAsFind.search"
            @confirm="confirmMove()"
        />
        <AddComponentDialog
            v-model:open="addDialogOpen"
            :items="checklistItems"
            :kind="entryKind"
            :presets="presets"
            :busy="acting"
            :error="dialogError"
            @add="(types: readonly string[]) => addComponents(types, 'dialog')"
            @show="showComponent"
            @closed="afterAddDialog()"
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
            <p v-if="dialogError !== ''" role="alert" class="mt-2 text-[length:var(--text-sm)] text-[var(--status-danger)]">{{ dialogError }}</p>
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
        <!-- 名字、简介的就地改：锚在页头的按钮上，同人物分页的短项（输出 38、51）。 -->
        <component :is="headEditor" path="name" :anchor="headAnchors.name" />
        <component :is="headEditor" path="summary" :anchor="headAnchors.summary" />
        <PageNotices
            :notice="props.notices.current.value"
            :agent="props.notices.agent.value"
            :error="actionError"
            :hold="pageNotice.hold"
            @receipt="props.receipt"
            @undo="pageNotice.undo"
            @revisions="props.notices.openRevisions()"
            @close="pageNotice.close()"
            @close-agent="props.notices.dismissAgent()"
            @close-error="actionError = ''"
        />
    </div>
</template>
