/**
 * “设定”视图的宿主（docs/specs/canon/author-ui.md 输出 1 到 3、5、27）：把读取层读到的条目树折成 `EntryTree` 的 props，把树的
 * 事件翻成读取与命令。展开了哪些、选中哪个记在窗口里（`EntriesViewState`），视图卸载再挂上时还在。
 *
 * 读取：根这一层与每个展开的条目各一个分页读取（`tree`，带缺省位置），展开时才读那一层；树跟着世界变由读取层保证（输出 3）。
 * 缺省位置跟着章表变：最新一章末尾，没有章时是初值（canon.model 输出 21）。用渲染函数写，同资源管理器的视图宿主。
 */

import {computed, defineComponent, h, onBeforeUnmount, shallowRef, watch} from "vue";
import type {Component, ShallowRef} from "vue";

import type {EntryTreeItem, EntryTreeLayer} from "./components/entry-tree";
import {defaultPosition} from "./positions";
import {useCanonText} from "./text";
import type {CanonWorld, ListHandle} from "./world";

/** 每层一次读多少项。 */
const PAGE = 100;
const ROOT = "";

/** 随窗口的视图状态。 */
export interface EntriesViewState {
    readonly expanded: ShallowRef<readonly string[]>;
    /** 最后打开的条目；不在树里了就不显示选中。 */
    readonly selected: ShallowRef<string | undefined>;
}

export function entriesViewState(): EntriesViewState {
    return {expanded: shallowRef([]), selected: shallowRef(undefined)};
}

export interface EntriesViewHostOptions {
    /** 窗口没有绑定项目时为 null。 */
    readonly world: CanonWorld | null;
    readonly state: EntriesViewState;
    /** 打开条目页（命令 `nbook.canon.open-entry`）。 */
    readonly open: (id: string) => void;
}

export function createEntriesViewHost(tree: Component, options: EntriesViewHostOptions): Component {
    return defineComponent({
        name: "EntriesViewHost",
        setup() {
            const text = useCanonText();
            const {world, state} = options;
            if (world === null) return () => h("p", {class: "px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-muted)]"}, text("world.unbound"));

            const chapters = world.read("chapters", {});
            const position = computed(() => defaultPosition(chapters.state.value.data?.items));
            const positionKey = computed(() => JSON.stringify(position.value));

            // 每层一个分页读取；位置变了全部换新的。展开列表里的条目 id 才读，收起的释放（读取层留着结果，再展开先显示旧的）。
            const handles = shallowRef(new Map<string, {readonly list: ListHandle<"tree">; readonly at: string}>());
            const sync = (): void => {
                const wanted = new Set([ROOT, ...state.expanded.value.filter((id) => !id.startsWith("folder:"))]);
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
            watch([() => state.expanded.value, positionKey], sync, {immediate: true});
            onBeforeUnmount(() => {
                for (const held of handles.value.values()) held.list.release();
                chapters.release();
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
                }),
            ]);
        },
    });
}
