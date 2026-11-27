/**
 * “设定”视图的宿主（docs/specs/canon/author-ui.md 输出 1 到 3、5、27）：把读取层读到的条目树折成 `EntryTree` 的 props，把树的
 * 事件翻成读取与命令。展开了哪些、选中哪个、新建条目的对话框开着没有记在窗口里（`EntriesViewState`），视图卸载再挂上时还在。
 * 新建条目（输出 4）也在这里：命令 `nbook.canon.new-entry`、标题栏的“新建条目”与树项的右键菜单都只是打开对话框。
 *
 * 读取：根这一层与每个展开的条目各一个分页读取（`tree`，带缺省位置），展开时才读那一层；树跟着世界变由读取层保证（输出 3）。
 * 缺省位置跟着章表变：最新一章末尾，没有章时是初值（canon.model 输出 21）。用渲染函数写，同资源管理器的视图宿主。
 */

import {computed, defineComponent, h, onBeforeUnmount, shallowRef, watch} from "vue";
import type {Component, ShallowRef} from "vue";

import type {ComponentType} from "@notnotype/nb-canon";
import {useText} from "@notnotype/nb-ui/text-port";

import type {CanonClient} from "../shared/contracts";
import {checklistGroup} from "./components/component-checklist";
import type {ChecklistItem, ChecklistPreset} from "./components/component-checklist";
import type {EntryTreeItem, EntryTreeLayer} from "./components/entry-tree";
import {GROUP_ICON} from "./components/entry-tabs";
import {failureText} from "./failures";
import {emptyDraft, newEntryOp, withKind} from "./new-entry";
import type {NewEntryDraft} from "./new-entry";
import type {CanonNotices} from "./notices";
import {defaultPosition} from "./positions";
import {defaultComponents, ENTRY_KINDS, kindPresets} from "../shared/entry-kinds";
import type {EntryKind} from "../shared/entry-kinds";
import {useCanonText} from "./text";
import {writeBlocked} from "./writable";
import {useWorldRead} from "./use-reads";
import {unboundView, viewContextProp, viewVisible} from "./view-visible";
import type {CanonWorld, ListHandle} from "./world";

/** 每层一次读多少项。 */
const PAGE = 100;
const ROOT = "";

/** 随窗口的视图状态。 */
export interface EntriesViewState {
    readonly expanded: ShallowRef<readonly string[]>;
    /** 最后打开的条目；不在树里了就不显示选中。 */
    readonly selected: ShallowRef<string | undefined>;
    /** 开着的新建条目对话框里填的东西；关着时为 null。 */
    readonly creating: ShallowRef<NewEntryDraft | null>;
}

export function entriesViewState(): EntriesViewState {
    return {expanded: shallowRef([]), selected: shallowRef(undefined), creating: shallowRef(null)};
}

export interface EntriesViewHostOptions {
    /** 窗口没有绑定项目时为 null。 */
    readonly world: CanonWorld | null;
    readonly state: EntriesViewState;
    /** 打开条目页（命令 `nbook.canon.open-entry`）。 */
    readonly open: (id: string) => void;
    /** 新建条目：对话框组件、世界客户端的读取与本窗口的提示。不给时没有新建（只测树的场景）。 */
    readonly create?: {
        readonly dialog: Component;
        readonly call: CanonClient["call"];
        readonly notices: CanonNotices;
        /** 登记的条目种类（`canon.entry-kinds`，已并好、排好）；视图挂上时读一次。 */
        readonly kinds: () => readonly EntryKind[];
        /** 设定组类型的图标（同条目页的分页）；不给时都是 `GROUP_ICON`。 */
        readonly iconOf?: (type: string) => string;
        /** 登记这个设定组类型的插件 id：勾选列表按它分组；不给时都算“插件”。 */
        readonly componentPlugin?: (type: string) => string | null;
    };
}

/** 打开新建条目的对话框（命令与右键菜单用）。 */
export function startNewEntry(state: EntriesViewState, parent: string | null): void {
    state.creating.value = emptyDraft(parent);
}

/** 空状态的“新建人物”（author-ui.md 输出 37）：种类预填“人物”、分组跟着种类、勾上这个种类的默认设定组。 */
export function startNewPerson(state: EntriesViewState, defaults: Readonly<Record<string, readonly string[]>>): void {
    state.creating.value = withKind(emptyDraft(null), ENTRY_KINDS.person, defaults);
}

export function createEntriesViewHost(tree: Component, options: EntriesViewHostOptions): Component {
    return defineComponent({
        name: "EntriesViewHost",
        props: viewContextProp,
        setup(props) {
            const text = useCanonText();
            const port = useText();
            const {world, state} = options;
            if (world === null) return () => unboundView(text);

            // 视图停放、收起时不占着读取（输出 26）：读取层留着结果，回来时先显示旧的，同时重读。新建条目的对话框开着时要章表。
            const visible = viewVisible(props);
            const chapters = useWorldRead(world, "chapters", () => (visible.value || state.creating.value !== null ? {} : null));
            const position = computed(() => defaultPosition(chapters.value?.data?.items));
            const positionKey = computed(() => JSON.stringify(position.value));

            // 每层一个分页读取；位置变了全部换新的。展开列表里的条目 id 才读，收起的释放（读取层留着结果，再展开先显示旧的）。
            const handles = shallowRef(new Map<string, {readonly list: ListHandle<"tree">; readonly at: string}>());
            const sync = (): void => {
                const wanted = new Set(visible.value ? [ROOT, ...state.expanded.value.filter((id) => !id.startsWith("folder:"))] : []);
                const next = new Map<string, {readonly list: ListHandle<"tree">; readonly at: string}>();
                for (const [parent, held] of handles.value) {
                    if (wanted.has(parent) && held.at === positionKey.value) next.set(parent, held);
                    else held.list.release();
                }
                for (const parent of wanted) {
                    if (!next.has(parent)) next.set(parent, {list: world.list("tree", {parent: parent === ROOT ? null : parent, position: position.value}, PAGE), at: positionKey.value});
                }
                handles.value = next;
            };
            watch([() => state.expanded.value, positionKey, visible], sync, {immediate: true});
            onBeforeUnmount(() => {
                for (const held of handles.value.values()) held.list.release();
            });

            const layers = computed<Record<string, EntryTreeLayer>>(() => {
                const result: Record<string, EntryTreeLayer> = {};
                for (const [parent, held] of handles.value) {
                    const page = held.list.state.value;
                    result[parent] = {
                        loading: page.loading,
                        remaining: page.data?.remaining ?? 0,
                        items: page.items.map((item): EntryTreeItem => ({id: item.id, name: item.nameAt ?? item.name, folder: item.folder, hasChildren: item.hasChildren, appeared: item.appeared ?? true, deleted: item.deleted})),
                    };
                }
                return result;
            });
            const selected = computed(() => {
                const id = state.selected.value;
                return id !== undefined && Object.values(layers.value).some((layer) => layer.items.some((item) => item.id === id)) ? id : undefined;
            });

            /* ---------- 新建条目 ---------- */

            const create = options.create;
            // 对话框开着时才读登记的类型；关上就释放。
            let componentsRead: ReturnType<typeof world.read<"components">> | null = null;
            const components = shallowRef<readonly ComponentType[]>([]);
            watch(() => state.creating.value !== null, (open) => {
                if (open && create !== undefined && componentsRead === null) {
                    componentsRead = world.read("components", {});
                    watch(componentsRead.state, (read) => {
                        components.value = read.data?.items ?? [];
                    }, {immediate: true});
                } else if (!open && componentsRead !== null) {
                    componentsRead.release();
                    componentsRead = null;
                }
            }, {immediate: true});
            onBeforeUnmount(() => componentsRead?.release());
            // 种类的候选与默认设定组：登记的种类挂上时读一次（只在装插件时变）；默认组只留读到了的类型（输入一节：没登记、不可用的当作没写）。
            const registered = create?.kinds() ?? [];
            const kindDefaults = computed<Record<string, readonly string[]>>(() => {
                const available = new Set(components.value.map((type) => type.id));
                return Object.fromEntries(registered.map((kind) => [kind.kind, defaultComponents(registered, kind.kind, available)]));
            });
            // 登记的类型是对话框开了才读的：“新建人物”预填时可能还没读到，读到以后把还跟着默认的勾选补上（作者动过的不动）。
            watch(kindDefaults, (next, previous) => {
                const draft = state.creating.value;
                if (draft === null || draft.typesTouched) return;
                const kind = draft.kind.trim();
                if (draft.types.join("\u0000") !== (previous?.[kind] ?? []).join("\u0000")) return;
                const types = next[kind] ?? [];
                if (types.join("\u0000") !== draft.types.join("\u0000")) state.creating.value = {...draft, types: [...types]};
            });
            // 勾选列表的各行与每个登记的种类的预设（输出 4）：新建时没有“已添加”。
            const items = computed<ChecklistItem[]>(() => components.value.map((type) => ({
                value: type.id,
                label: type.label,
                iconClass: create?.iconOf?.(type.id) ?? GROUP_ICON,
                group: checklistGroup(create?.componentPlugin?.(type.id) ?? null),
                kinds: type.kinds ?? [],
                present: false,
                restore: false,
            })));
            const presets = computed<Record<string, readonly ChecklistPreset[]>>(() => {
                const available = new Set(components.value.map((type) => type.id));
                return Object.fromEntries(registered.map((kind) => [kind.kind, kindPresets(registered, kind.kind, available)]));
            });
            const saving = shallowRef(false);
            const error = shallowRef("");
            /** 已读到的条目：放在谁下面、另一个身份的候选，以及用过的种类。 */
            const known = computed(() => [...handles.value.values()].flatMap((held) => held.list.state.value.items).filter((item) => !item.deleted));
            const confirm = async (): Promise<void> => {
                const draft = state.creating.value;
                if (create === undefined || draft === null || saving.value) return;
                saving.value = true;
                error.value = "";
                const op = newEntryOp(draft);
                const title = text("newEntry.saved", {name: op.entry.name});
                // 全是新建的一批不用读到的版本（canon.revisions 输出 25）；顺序由内核排在同层最后。
                const result = await world.write("editEntries", {input: {requestId: `new-entry-${crypto.randomUUID()}`, by: {kind: "author"}, what: "edit", title, ops: [op]}});
                saving.value = false;
                if (!result.ok) {
                    error.value = port.t(failureText(result.failure).text);
                    return;
                }
                const id = result.value.ids[op.id] ?? op.id;
                state.creating.value = null;
                // 树里看得见它：展开它的上级（根下是它的分组）。
                const opened = op.entry.parent === null || op.entry.parent === undefined ? `folder:${op.entry.folder ?? op.entry.kind}` : op.entry.parent;
                if (!state.expanded.value.includes(opened)) state.expanded.value = [...state.expanded.value, opened];
                state.selected.value = id;
                // 条目页随后才挂上（命令、页面按需加载）：提示直接交给它，不按“现在有没有页面挂着”走工作台通知。
                create.notices.show({revision: result.value.revision, title}, {page: true});
                options.open(id);
            };

            return () => h("div", {class: "flex min-h-0 flex-col"}, [
                h(tree, {
                    layers: layers.value,
                    disconnected: world.connection.value === "ended",
                    onRetry: () => void world.retry(),
                    expanded: state.expanded.value,
                    ...(selected.value === undefined ? {} : {selected: selected.value}),
                    "onUpdate:expanded": (value: string[]) => {
                        state.expanded.value = value;
                    },
                    onMore: (parent: string | null) => void handles.value.get(parent ?? ROOT)?.list.more(),
                    onOpen: (id: string) => {
                        state.selected.value = id;
                        options.open(id);
                    },
                    ...(create === undefined ? {} : {
                        creatable: true,
                        blockedReason: (() => {
                            const blocked = writeBlocked(world);
                            return blocked === null ? "" : port.t(blocked);
                        })(),
                        onCreate: (parent: string | null) => startNewEntry(state, parent),
                        // 空状态的“新建人物”只在“人物”这个种类登记了时有（输出 37）。
                        createPerson: registered.some((kind) => kind.kind === ENTRY_KINDS.person),
                        onCreatePerson: () => startNewPerson(state, kindDefaults.value),
                    }),
                }),
                create === undefined || state.creating.value === null ? null : h(create.dialog, {
                    open: true,
                    draft: state.creating.value,
                    kinds: [...new Set([...registered.map((kind) => kind.kind), ...known.value.map((item) => item.type).filter((kind) => kind !== "")])],
                    kindDefaults: kindDefaults.value,
                    entries: known.value.map((item) => ({id: item.id, name: item.nameAt ?? item.name})),
                    items: items.value,
                    kindPresets: presets.value,
                    chapters: chapters.value?.data?.items ?? [],
                    saving: saving.value,
                    error: error.value,
                    "onUpdate:draft": (draft: NewEntryDraft) => {
                        state.creating.value = draft;
                    },
                    "onUpdate:open": (open: boolean) => {
                        if (!open && !saving.value) state.creating.value = null;
                    },
                    onConfirm: () => void confirm(),
                }),
            ]);
        },
    });
}
