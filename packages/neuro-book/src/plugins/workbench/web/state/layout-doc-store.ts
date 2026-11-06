/**
 * 一棵树的布局 store（docs/specs/ui/workbench-layout.md“状态与转换”）：文档只在内存里有一份（`local`），打开时从记录读一次，之后记录只管存。所以另一个窗口保存时本窗口的显示不被强改，
 * 保存冲突时重读 revision 再用本窗口的文档覆盖（整棵树后写胜出，不合并），未绑定项目的窗口存盘时去掉动态标签也不影响显示。
 *
 * 文档的改动都经 `apply`：先把呈现尺寸写回意图，再做领域操作。没有变化（放回原处）时不写。
 */

import {computed, effect, onScopeDispose, shallowRef} from "@vue/reactivity";

import {findTreeNode, presentationCollapse, projectLayoutDoc, rebaseIntents, sameTreeShape, setBarHidden, setPanelCollapsed, setPanelHidden, stripDynamicTabs, validateLayoutDoc} from "@notnotype/nb-layout";
import type {GridExtent, LayoutBar, LayoutDoc, LayoutResult} from "@notnotype/nb-layout";

import {defineStore} from "nbook/shared/store/store";

import type {ViewCatalog} from "../views/placement";
import {defaultLayoutDoc, reconcileViews} from "./default-tree";
import {COLLAPSE_ORDER, layoutProjectionOptions} from "./layout-constraints";
import {LAYOUT_DOC_RECORDS, LAYOUT_TEMPLATE_RECORD} from "./records";
import type {LayoutDocRecord} from "./records";

/** 打开、关闭、切标签合并着存，至多这么久一次。手势结束立刻存。 */
export const LAYOUT_SAVE_COALESCE_MS = 1000;

export type LayoutDocProblem =
    | {readonly kind: "unread"; readonly code: string}
    | {readonly kind: "unsaved"; readonly code: string};

export type LayoutPart = "sidebar" | "auxiliarybar" | "panel" | LayoutBar;

/** 存盘之前的关卡：编辑器先写 `editor.tabs`，它失败时布局不写，不留下引用不存在的标签。 */
export type LayoutSaveGate = () => Promise<boolean>;

function defineLayoutDocStore(bound: boolean) {
    return defineStore("workbench-layout-doc", ({persist}) => {
        const field = persist<LayoutDocRecord>(LAYOUT_DOC_RECORDS[bound ? "project" : "user"], {initial: {doc: null}});
        const template = persist<LayoutDocRecord>(LAYOUT_TEMPLATE_RECORD, {initial: {doc: null}});
        const catalog = shallowRef<ViewCatalog>(new Map());
        /** 这个窗口的文档。打开时读到记录才有；没有记录时是 null，默认树跟着视图目录（目录是陆续交进来的），第一次改动才定下来。 */
        const local = shallowRef<LayoutDoc | null>(null);
        const extent = shallowRef<GridExtent | null>(null);
        const presented = shallowRef<Readonly<Record<string, GridExtent>>>({});
        const maximized = shallowRef<string | null>(null);
        const currentPanel = shallowRef<string | null>(null);
        const saveBlocked = shallowRef(false);
        let saveGate: LayoutSaveGate | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        /** 记录里的文档通不过校验：和损坏一样，回落默认树，原件不覆盖。 */
        const recordProblem = computed<string | null>(() => {
            const base = field.base;
            if (base === null || base.status !== "ok") return null;
            const checked = validateLayoutDoc(base.value.doc);
            return checked.ok ? null : `${checked.code}: ${checked.detail}`;
        });
        const guarded = computed(() => recordProblem.value !== null || field.base?.status === "corrupt" || field.base?.status === "unsupported-version");

        function readStored(): LayoutDoc | null {
            const base = field.base;
            if (base?.status === "ok") {
                const checked = validateLayoutDoc(base.value.doc);
                return checked.ok ? checked.doc : null;
            }
            // 没有记录时取模板（新项目的初始布局）。
            if (base?.status === "missing") {
                const checked = validateLayoutDoc(template.display.doc);
                return checked.ok ? checked.doc : null;
            }
            return null;
        }
        const doc = computed<LayoutDoc>(() => reconcileViews(local.value ?? defaultLayoutDoc(catalog.value), catalog.value));

        // 只读一次：之后别的窗口保存不改本窗口的显示。
        let opened = false;
        effect(() => {
            if (opened || !field.ready || !template.ready) return;
            opened = true;
            local.value = readStored();
        });

        const ready = computed(() => field.ready && template.ready);
        const problems = computed<ReadonlyArray<LayoutDocProblem>>(() => {
            if (field.save.state === "failed" || field.save.state === "unknown") return [{kind: "unsaved", code: field.save.code}];
            if (saveBlocked.value) return [{kind: "unsaved", code: "save-gate"}];
            if (field.failure !== null) return [{kind: "unread", code: field.failure}];
            if (recordProblem.value !== null) return [{kind: "unread", code: recordProblem.value}];
            const status = field.base?.status;
            return status === "corrupt" || status === "unsupported-version" ? [{kind: "unread", code: status}] : [];
        });

        const collapse = computed(() => {
            const current = extent.value;
            if (current === null) return {removed: new Set<string>() as ReadonlySet<string>, squeezed: false};
            return presentationCollapse(doc.value, current, {...layoutProjectionOptions({catalog: catalog.value, viewportWidth: current.width}), order: COLLAPSE_ORDER, focused: currentPanel.value});
        });
        const projection = computed(() => projectLayoutDoc(doc.value, layoutProjectionOptions({catalog: catalog.value, viewportWidth: extent.value?.width ?? 0, removed: collapse.value.removed})));
        /** 放不下把最大化的面板收走了：退出最大化，不写文档。 */
        const effectiveMaximized = computed(() => (maximized.value !== null && !collapse.value.removed.has(maximized.value) ? maximized.value : null));

        async function save(): Promise<void> {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            if (guarded.value) return;
            const current = doc.value;
            if (saveGate !== null) {
                saveBlocked.value = !(await saveGate());
                if (saveBlocked.value) return;
            }
            // 未绑定项目的窗口：`editor.tabs` 不落盘，动态标签存下去刷新后就是坏标签。
            const persisted = bound ? current : stripDynamicTabs(current);
            void template.commit(() => ({doc: stripDynamicTabs(current)}));
            await field.commit(() => ({doc: persisted}));
        }

        function schedule(flush: boolean): void {
            if (flush) {
                void save();
                return;
            }
            timer ??= setTimeout(() => void save(), LAYOUT_SAVE_COALESCE_MS);
        }
        onScopeDispose(() => {
            if (timer !== null) clearTimeout(timer);
        });

        /** 结构操作之前把呈现尺寸写回意图（输出 8）。 */
        const rebased = (): LayoutDoc => rebaseIntents(doc.value, presented.value, projection.value.collapsedTo);

        function apply(operation: (current: LayoutDoc) => LayoutResult, options: {readonly flush?: boolean} = {}): LayoutResult {
            const base = rebased();
            const result = operation(base);
            if (!result.ok) return result;
            if (result.doc === base) return {ok: true, doc: doc.value};
            if (!sameTreeShape(base, result.doc)) maximized.value = null;
            local.value = result.doc;
            schedule(options.flush ?? false);
            return result;
        }

        return {
            state: {doc, ready, problems, field, catalog, extent, projection, collapse, maximized: effectiveMaximized, currentPanel},
            actions: {
                apply,
                acceptViewCatalog: (next: ViewCatalog): void => {
                    catalog.value = next;
                },
                acceptExtent: (next: GridExtent | null): void => {
                    extent.value = next;
                },
                /** 这一刻的呈现尺寸（布局发布时交进来）。 */
                acceptPresented: (next: Readonly<Record<string, GridExtent>>): void => {
                    presented.value = next;
                },
                acceptSaveGate: (gate: LayoutSaveGate | null): void => {
                    saveGate = gate;
                },
                focusPanel: (panel: string): void => {
                    currentPanel.value = panel;
                },
                /** 手势落账：意图从呈现尺寸写回，收起状态来自这次手势，立刻存。 */
                commitGesture: (sizes: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void => {
                    presented.value = sizes;
                    let next = rebased();
                    for (const [id, value] of Object.entries(collapsed)) {
                        const updated = setPanelCollapsed(next, id, value);
                        if (updated.ok) next = updated.doc;
                    }
                    local.value = next;
                    schedule(true);
                },
                /** 显隐（输出 11）。“显示”同时清掉隐藏与收起。 */
                setPartHidden: (part: LayoutPart, hidden: boolean): LayoutResult => apply((current) => {
                    if (part === "activitybar" || part === "statusbar") return setBarHidden(current, part, hidden);
                    return setPanelHidden(current, part, hidden);
                }),
                setCollapsed: (panel: string, collapsed: boolean): LayoutResult => apply((current) => setPanelCollapsed(current, panel, collapsed)),
                /** 最大化（输出 13）：只在内存；再点同一块退出。 */
                toggleMaximized: (panel: string): boolean => {
                    if (doc.value.panels[panel] === undefined) return false;
                    maximized.value = maximized.value === panel ? null : panel;
                    return true;
                },
                /** 具名面板或条此刻占不占地方：隐藏、拖到零、被盖住、放不下被收走都不算，收成标题行算（输出 36）。 */
                partVisible: (part: LayoutPart): boolean => {
                    const current = doc.value;
                    if (part === "activitybar" || part === "statusbar") return !current.hiddenBars.includes(part);
                    const panel = current.panels[part];
                    if (panel === undefined || panel.hidden === true || collapse.value.removed.has(part)) return false;
                    if (effectiveMaximized.value !== null && effectiveMaximized.value !== part) return false;
                    if (panel.collapsed !== true) return true;
                    return findTreeNode(current.tree.root, part)?.parent?.orientation === "vertical";
                },
                save,
                retry: async (): Promise<string> => {
                    if (field.failure !== null) await field.reopen();
                    return field.retry();
                },
                /** 放弃未保存的修改：显示回到已确认值。 */
                discard: (): string => {
                    local.value = readStored();
                    saveBlocked.value = false;
                    return field.discardAll();
                },
            },
        };
    });
}

const STORES = {user: defineLayoutDocStore(false), project: defineLayoutDocStore(true)};

export type LayoutDocStoreDefinition = (typeof STORES)["user"];
export type LayoutDocStore = ReturnType<LayoutDocStoreDefinition["create"]>;

/** 窗口绑定了项目时布局在 project 分区，否则在 user 分区。 */
export function layoutDocStoreFor(bound: boolean): LayoutDocStoreDefinition {
    return bound ? STORES.project : STORES.user;
}
