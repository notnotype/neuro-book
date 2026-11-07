/**
 * 一棵树的布局 store（docs/specs/ui/workbench-layout.md“状态与转换”）：文档只在内存里有一份（`local`），打开时从记录读一次，之后记录只管存。所以另一个窗口保存时本窗口的显示不被强改，
 * 保存冲突时重读 revision 再用本窗口的文档覆盖（整棵树后写胜出，不合并），未绑定项目的窗口存盘时去掉动态标签也不影响显示。
 *
 * 文档的改动都经 `apply`：先把呈现尺寸写回意图，再做领域操作。没有变化（放回原处）时不写。
 */

import {computed, effect, onScopeDispose, shallowRef} from "@vue/reactivity";

import {activateTab, applyLayoutDrop, carryDynamicTabs, clampFloatRect, findTab, findTreeNode, fixedNodesOf, floatTab, isFloating, LAYOUT_MAX_FLOATS, moveTabToEdge, moveTabToStrip, presentationCollapse, projectLayoutDoc, raiseFloat, rebaseIntents, roundFloatRect, removeTab, sameTreeShape, setBarHidden, setFloatRect, setPanelCollapsed, setPanelHidden, stripDynamicTabs, tabKey, treeEditorAnchor, validateLayoutDoc} from "@notnotype/nb-layout";
import type {GridExtent, GridFloatInput, LayoutBar, LayoutDoc, LayoutDropAction, LayoutFloatRect, LayoutProjection, LayoutProjectionOptions, LayoutResult, LayoutSource, PanelRecord} from "@notnotype/nb-layout";

import {defineStore} from "nbook/shared/store/store";

import type {EditorSaveGate} from "../../shared/contracts";
import {editorTabIdOf} from "../../shared/editor-panels";
import type {EditorTabDrag} from "../contracts";
import type {ViewCatalog} from "../views/registry";
import {defaultLayoutDoc, fitsSkeleton, reconcileViews} from "./default-tree";
import {COLLAPSE_ORDER, createLayoutPolicy, defaultFloatRect, FLOAT_KEEP_WIDTH, layoutProjectionOptions, newPanelEdgeTarget, PANEL_HEAD_HEIGHT, panelConstraints} from "./layout-constraints";
import {effectiveVisibleTabs} from "./layout-present";
import {LAYOUT_DOC_RECORDS, LAYOUT_TEMPLATE_RECORD} from "./records";
import type {LayoutDocRecord} from "./records";

/**
 * 打开、关闭、切标签合并着存，至多这么久一次，手势结束立刻存。只合并一连串的动作（方向键在资源管理器里走一路，每步都换 preview 标签）：等得再久，
 * 刚打开标签就刷新的话这个标签就丢了，页面离开时也来不及补写。
 */
export const LAYOUT_SAVE_COALESCE_MS = 150;

export type LayoutDocProblem =
    | {readonly kind: "unread"; readonly code: string}
    | {readonly kind: "unsaved"; readonly code: string};

export type LayoutPart = "sidebar" | "auxiliarybar" | "panel" | LayoutBar;

/** 存盘之前的关卡（`EditorSaveGate`）：编辑器先写 `editor.tabs`，它失败时布局不写，不留下引用不存在的标签。 */
export type LayoutSaveGate = EditorSaveGate;

const notFound = (detail: string): LayoutResult => ({ok: false, code: "not-found", detail});

/** 记录与模板里的文档能不能用：过校验，还要合骨架（输出 1）。 */
function usableDoc(value: unknown): LayoutDoc | null {
    const checked = validateLayoutDoc(value);
    return checked.ok && fitsSkeleton(checked.doc) ? checked.doc : null;
}

function defineLayoutDocStore(bound: boolean) {
    return defineStore("workbench-layout-doc", ({persist}) => {
        const field = persist<LayoutDocRecord>(LAYOUT_DOC_RECORDS[bound ? "project" : "user"], {initial: {doc: null}});
        const template = persist<LayoutDocRecord>(LAYOUT_TEMPLATE_RECORD, {initial: {doc: null}});
        const catalog = shallowRef<ViewCatalog>(new Map());
        /** 这个窗口的文档。打开时读到记录才有；没有记录时是 null，默认树跟着视图目录（目录是陆续交进来的），第一次改动才定下来。 */
        const local = shallowRef<LayoutDoc | null>(null);
        const extent = shallowRef<GridExtent | null>(null);
        /** 主题的缝宽（`--shell-gap`）：活动栏的叶宽要算上它。 */
        const cardGap = shallowRef(0);
        const presented = shallowRef<Readonly<Record<string, GridExtent>>>({});
        /** 手势进行中的预览尺寸：只影响“从零拉回时内容出现”（输出 12）。 */
        const preview = shallowRef<Readonly<Record<string, GridExtent>> | null>(null);
        /** 焦点此刻在哪块面板；不在任何面板里是 null。`currentPanel` 是最近的那块，焦点走开也不变。 */
        const focusedPanel = shallowRef<string | null>(null);
        const policy = createLayoutPolicy();
        const maximized = shallowRef<string | null>(null);
        const currentPanel = shallowRef<string | null>(null);
        const saveBlocked = shallowRef(false);
        /** 最近一次超过节点或层数上限的结构操作（“失败与恢复”）：外壳的入口记诊断。 */
        const structureFailure = shallowRef<string | null>(null);
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
            if (base?.status === "ok") return usableDoc(base.value.doc);
            // 没有记录时取模板（新项目的初始布局）。
            if (base?.status === "missing") return usableDoc(template.display.doc);
            return null;
        }
        /** 记录合法但不合骨架（片 7c 之前存的）：用默认树、下次保存覆盖它，不算损坏，用户没有什么可做的。只在外壳根写一条诊断。 */
        const outsideSkeleton = computed(() => {
            const base = field.base;
            if (base?.status !== "ok") return false;
            const checked = validateLayoutDoc(base.value.doc);
            return checked.ok && !fitsSkeleton(checked.doc) && local.value === null;
        });
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
            return presentationCollapse(doc.value, current, {...layoutProjectionOptions({catalog: catalog.value, viewportWidth: current.width, cardGap: cardGap.value}), order: COLLAPSE_ORDER, focused: currentPanel.value});
        });
        const projectionOptions = computed(() => layoutProjectionOptions({catalog: catalog.value, viewportWidth: extent.value?.width ?? 0, removed: collapse.value.removed, squeezed: collapse.value.squeezed, cardGap: cardGap.value}));
        const projection = computed(() => projectLayoutDoc(doc.value, projectionOptions.value));
        /**
         * 实时布局的预览（docs/specs/ui/workbench-layout.md“实时布局”）：只给渲染用的一份文档。判定、提交、可见性、记录都还看已提交的 `doc` 与 `projection`：
         * 预览不改可见性（输出 17），也不能让预览才有的节点混进下一次提交的意图。
         */
        const livePreview = shallowRef<LayoutDoc | null>(null);
        const renderedDoc = computed(() => livePreview.value ?? doc.value);
        const renderedProjection = computed(() => (livePreview.value === null ? projection.value : projectLayoutDoc(livePreview.value, projectionOptions.value)));
        /** 放不下把最大化的面板收走了：退出最大化，不写文档。 */
        const effectiveMaximized = computed(() => {
            const panel = maximized.value === null ? undefined : doc.value.panels[maximized.value];
            // 这块面板不在了、隐藏了（包括标签被搬空）、收起了都退出（输出 13）：不管是哪条路径改的文档。
            return maximized.value === null || panel === undefined || panel.hidden === true || panel.collapsed === true || collapse.value.removed.has(maximized.value) || isFloating(doc.value, maximized.value) ? null : maximized.value;
        });
        /**
         * 拖动或缩放中的浮动窗矩形：只有它在变，不换文档、不重算投影。
         */
        const floatPreview = shallowRef<{readonly panel: string; readonly rect: LayoutFloatRect; readonly gesture: "move" | "resize"} | null>(null);
        /** 画出来的浮动窗（相对树区域）：夹取之后的矩形，夹取不写回。 */
        const renderedFloats = computed<ReadonlyArray<GridFloatInput>>(() => renderedDoc.value.floats.map(({panel, rect}) => {
            const preview = floatPreview.value?.panel === panel ? floatPreview.value : null;
            const wanted = preview?.rect ?? rect;
            return {id: panel, rect: extent.value === null ? wanted : clampFloatRect(wanted, extent.value, {width: FLOAT_KEEP_WIDTH, height: PANEL_HEAD_HEIGHT}), ...(preview === null ? {} : {gesture: preview.gesture})};
        }));
        /** 编辑器标签的拖动（区级组件交出来）：动它们要走编辑器区，先结算输入、合并同一文件。 */
        const editorDrag = shallowRef<EditorTabDrag | null>(null);
        /** 走编辑器区的动作：编辑器没有交出来、或它拒绝了（提示由它给），都是失败。 */
        async function viaEditor(detail: string, run: (drag: EditorTabDrag) => Promise<boolean>): Promise<LayoutResult> {
            const drag = editorDrag.value;
            if (drag === null) return {ok: false, code: "not-found", detail};
            return (await run(drag)) ? {ok: true, doc: doc.value} : {ok: false, code: "rejected", detail};
        }

        /** 有效可见的标签键（输出 17）。 */
        const visibleTabs = computed(() => effectiveVisibleTabs(doc.value, {sizes: presented.value, preview: preview.value, removed: collapse.value.removed, maximized: effectiveMaximized.value}));

        async function save(): Promise<void> {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            if (guarded.value) return;
            // 记录读不了时不走关卡：文档是回落的默认树，关卡会把读到的标签当成没主的删掉。这次提交本身会暂停，等重新打开。
            if (saveGate !== null && field.failure === null) {
                saveBlocked.value = !(await saveGate.pass());
                if (saveBlocked.value) return;
            }
            // 关卡之后才取：等关卡期间可能又改了，两次保存交错时不能让旧的文档后写。
            const current = doc.value;
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

        /** 结构操作之前把呈现尺寸写回意图（输出 8）。保留像素的节点不写：它们的呈现尺寸只可能是被压缩了，窗口变大要回到原样。 */
        const rebased = (): LayoutDoc => rebaseIntents(doc.value, presented.value, projection.value.collapsedTo, fixedNodesOf(projection.value.input));

        /** 这次手势没动的保留像素的节点：呈现尺寸还是压缩的结果。 */
        function untouchedFixed(sizes: Readonly<Record<string, GridExtent>>): ReadonlySet<string> {
            const same = (left: GridExtent | undefined, right: GridExtent | undefined): boolean => left !== undefined && right !== undefined && Math.abs(left.width - right.width) < 0.5 && Math.abs(left.height - right.height) < 0.5;
            return new Set([...fixedNodesOf(projection.value.input)].filter((id) => same(presented.value[id], sizes[id])));
        }

        function apply(operation: (current: LayoutDoc) => LayoutResult, options: {readonly flush?: boolean} = {}): LayoutResult {
            const base = rebased();
            const result = operation(base);
            if (!result.ok) {
                if (result.code === "limit-exceeded") structureFailure.value = result.detail;
                return result;
            }
            if (result.doc === base) return {ok: true, doc: doc.value};
            // 落点只给合骨架的目标，但服务（`EditorPanels.tabs.moveToEdge`）能传任意目标：写入的出口再守一次。
            if (!fitsSkeleton(result.doc)) return {ok: false, code: "rejected", detail: "不合骨架"};
            if (!sameTreeShape(base, result.doc)) maximized.value = null;
            local.value = result.doc;
            schedule(options.flush ?? false);
            return result;
        }

        return {
            state: {doc, ready, problems, field, catalog, extent, projection, collapse, maximized: effectiveMaximized, currentPanel, focusedPanel, visibleTabs, presented, structureFailure, outsideSkeleton, renderedFloats},
            actions: {
                apply,
                /** 文档与呈现树本身：读 `state` 拿到的是深只读代理，领域操作要原对象（`structuredClone` 不接受代理）。在响应式作用域里读同样会被跟踪。 */
                document: (): LayoutDoc => doc.value,
                presentation: (): LayoutProjection => projection.value,
                /** 画出来的文档与呈现树：拖动中可能是预览。只给渲染用。 */
                rendered: (): LayoutDoc => renderedDoc.value,
                renderedPresentation: (): LayoutProjection => renderedProjection.value,
                /** 摆预览；null 回到已提交的布局。不合骨架的不摆：领域操作的结果都过 `apply` 的这道关，预览同样。 */
                setLivePreview: (next: LayoutDoc | null): void => {
                    livePreview.value = next !== null && fitsSkeleton(next) ? next : null;
                },
                /** 拖动或缩放中的浮动窗矩形；null 回到记录里的。 */
                previewFloat: (panel: string | null, rect: LayoutFloatRect | null = null, gesture: "move" | "resize" = "resize"): void => {
                    // 和写入时一样取整：放下那一下不跳。
                    floatPreview.value = panel === null || rect === null ? null : {panel, rect: roundFloatRect(rect), gesture};
                },
                /** 画出来的浮动窗：读 `state` 拿到的是只读代理，矩形要交给组件。 */
                floats: (): ReadonlyArray<GridFloatInput> => renderedFloats.value,
                /** 浮动窗缩放的上下限：取角色与视图声明的约束。 */
                floatBounds: (panel: string): {readonly min: GridExtent; readonly max: GridExtent} => {
                    const record = doc.value.panels[panel];
                    const fallback = {width: 0, height: 0};
                    if (record === undefined) return {min: fallback, max: {width: extent.value?.width ?? 0, height: extent.value?.height ?? 0}};
                    const {minimumSize, maximumSize} = panelConstraints(record, catalog.value, extent.value?.width ?? 0);
                    return {min: minimumSize, max: {width: Math.min(maximumSize.width, extent.value?.width ?? maximumSize.width), height: Math.min(maximumSize.height, extent.value?.height ?? maximumSize.height)}};
                },
                setFloatRect: (panel: string, rect: LayoutFloatRect): LayoutResult => apply((current) => setFloatRect(current, {panel, rect}), {flush: true}),
                /** 只改位置（键盘移动）：大小取记录里的，呈现的可能是夹过的。 */
                moveFloat: (panel: string, position: {readonly x: number; readonly y: number}): LayoutResult => apply((current) => {
                    const rect = current.floats.find((float) => float.panel === panel)?.rect;
                    return rect === undefined ? notFound(panel) : setFloatRect(current, {panel, rect: {...rect, ...position}});
                }, {flush: true}),
                /** 提到最前（点击、聚焦）；已在最前不写。 */
                raiseFloat: (panel: string): void => {
                    if (doc.value.floats.at(-1)?.panel === panel || !isFloating(doc.value, panel)) return;
                    apply((current) => raiseFloat(current, panel));
                },
                acceptEditorDrag: (drag: EditorTabDrag | null): void => {
                    editorDrag.value = drag;
                },
                /**
                 * 提交一个落点：编辑器的标签要走编辑器区（`EditorTabDrag`），工具视图与只改矩形直接改布局。外壳的拖动和命令都经这里。
                 */
                commitDrop: (source: LayoutSource, action: LayoutDropAction, part: string | undefined, keyboard: boolean): void => {
                    if (source.kind === "tab") {
                        const editorTab = editorTabIdOf(source.tab);
                        if (editorTab !== null) {
                            void editorDrag.value?.drop(editorTab, action, part, keyboard);
                            return;
                        }
                    } else if (doc.value.panels[source.panel]?.role === "editor" && action.kind !== "float") {
                        void editorDrag.value?.dropPanel(source.panel, action, part, keyboard);
                        return;
                    }
                    apply((current) => applyLayoutDrop(current, source, action, policy), {flush: true});
                },
                /** 在落点打开文件（资源树拖来的）：标签的属性归编辑器。 */
                commitFiles: (addresses: ReadonlyArray<string>, action: LayoutDropAction, part: string | undefined): void => {
                    void editorDrag.value?.openFiles(addresses, action, part);
                },
                /** 把这个标签浮出来（`nbook.view.float`）：矩形按树区域居中，按窗数错开。 */
                floatTab: (key: string): LayoutResult | Promise<LayoutResult> => {
                    const found = findTab(doc.value, key);
                    const record = found === null ? undefined : doc.value.panels[found.panel];
                    if (found === null || record === undefined) return notFound(key);
                    if (doc.value.floats.length >= LAYOUT_MAX_FLOATS) return {ok: false, code: "limit-exceeded", detail: "浮动窗太多"};
                    const rect = defaultFloatRect(extent.value, panelConstraints({role: record.role, tabs: [found.tab], active: key}, catalog.value, extent.value?.width ?? 0).minimumSize, doc.value.floats.length);
                    const editorTab = editorTabIdOf(key);
                    if (editorTab !== null) return viaEditor(key, (drag) => drag.drop(editorTab, {kind: "float", rect}, undefined, false));
                    return apply((current) => floatTab(current, {tab: key, rect}, policy), {flush: true});
                },
                /**
                 * 浮动窗回到停靠（`nbook.view.dock`）：工具视图各回声明的具名面板，声明没了的回侧栏；编辑器回树序最后一个编辑组。
                 */
                dockFloat: (panel: string): LayoutResult | Promise<LayoutResult> => {
                    const record = doc.value.panels[panel];
                    if (record === undefined || !isFloating(doc.value, panel)) return notFound(panel);
                    if (record.role === "editor") {
                        const anchor = treeEditorAnchor(doc.value);
                        if (anchor === null) return notFound(panel);
                        return viaEditor(panel, (drag) => drag.dropPanel(panel, {kind: "center", panel: anchor}, undefined, false));
                    }
                    return apply((current) => {
                        let next: LayoutResult = {ok: true, doc: current};
                        for (const tab of record.tabs) {
                            if (!next.ok || tab.kind !== "view") continue;
                            const location = catalog.value.get(tab.viewId)?.location ?? "sidebar";
                            const target: readonly [string, PanelRecord] | undefined = Object.entries(next.doc.panels).find(([, candidate]) => candidate.name === location);
                            if (target === undefined) return notFound(location);
                            const moved = moveTabToStrip(next.doc, {tab: tabKey(tab), panel: target[0], index: target[1].tabs.length}, policy);
                            next = moved.ok ? setPanelHidden(moved.doc, target[0], false) : moved;
                        }
                        // 逐个搬时最后一个成了活动标签：窗的活动标签还是活动的，和整窗拖进去一样。
                        return next.ok && record.active !== null ? activateTab(next.doc, record.active) : next;
                    }, {flush: true});
                },
                /** 算出这棵呈现树用的选项：预览（落点、预备区）要和真实结果同一棵树。 */
                projectionOptions: (): LayoutProjectionOptions => projectionOptions.value,
                acceptViewCatalog: (next: ViewCatalog): void => {
                    catalog.value = next;
                },
                acceptExtent: (next: GridExtent | null): void => {
                    extent.value = next;
                },
                acceptCardGap: (next: number): void => {
                    cardGap.value = next;
                },
                /** 这一刻的呈现尺寸（布局发布时交进来）。 */
                acceptPresented: (next: Readonly<Record<string, GridExtent>>): void => {
                    // 预览的尺寸里有预览才有的节点。撤下之后表面会按已提交的再发布一次。
                    if (livePreview.value !== null) return;
                    presented.value = next;
                },
                acceptSaveGate: (gate: LayoutSaveGate | null): void => {
                    saveGate = gate;
                },
                /** 焦点换了面板；离开所有面板时 `currentPanel` 不变（输出 36）。 */
                focusPanel: (panel: string | null): void => {
                    focusedPanel.value = panel;
                    if (panel !== null) currentPanel.value = panel;
                },
                acceptPreview: (next: Readonly<Record<string, GridExtent>> | null): void => {
                    preview.value = next;
                },
                /** 手势落账：意图从呈现尺寸写回，收起状态来自这次手势，立刻存。 */
                commitGesture: (sizes: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void => {
                    const frozen = untouchedFixed(sizes);
                    presented.value = sizes;
                    // 先改收起状态再写回意图：这次手势收起的面板，呈现尺寸是标题行或零，不是意图（`rebaseIntents` 跳过收起的面板）。
                    let next = doc.value;
                    for (const [id, value] of Object.entries(collapsed)) {
                        const updated = setPanelCollapsed(next, id, value);
                        if (updated.ok) next = updated.doc;
                    }
                    local.value = rebaseIntents(next, sizes, projection.value.collapsedTo, frozen);
                    schedule(true);
                },
                /** 显隐（输出 11）。“显示”同时清掉隐藏与收起；隐藏最大化着的面板时退出最大化（输出 13）。 */
                setPartHidden: (part: LayoutPart, hidden: boolean): LayoutResult => {
                    // 隐藏最大化着的面板、或要显示被它盖住的面板，都退出最大化：不然按钮按了看不出变化。
                    if (hidden ? maximized.value === part : maximized.value !== part) maximized.value = null;
                    return apply((current) => {
                        if (part === "activitybar" || part === "statusbar") return setBarHidden(current, part, hidden);
                        return setPanelHidden(current, part, hidden);
                    });
                },
                setCollapsed: (panel: string, collapsed: boolean): LayoutResult => {
                    if (collapsed && maximized.value === panel) maximized.value = null;
                    return apply((current) => setPanelCollapsed(current, panel, collapsed));
                },
                /** 激活标签（切标签合并着存）；面板收成标题行时一起展开（输出 11）。 */
                activate: (key: string): LayoutResult => apply((current) => {
                    const activated = activateTab(current, key);
                    const panel = findTab(current, key)?.panel;
                    return activated.ok && panel !== undefined && current.panels[panel]?.collapsed === true ? setPanelCollapsed(activated.doc, panel, false) : activated;
                }),
                /** 在标签条里换一位（Alt 加方向键，输出 20）：活动标签不变，到头了不动。 */
                reorderTab: (key: string, delta: -1 | 1): LayoutResult => apply((current) => {
                    const found = findTab(current, key);
                    if (found === null) return notFound(key);
                    const length = current.panels[found.panel]?.tabs.length ?? 0;
                    const next = found.index + delta;
                    if (next < 0 || next >= length) return {ok: true, doc: current};
                    // `index` 是摘掉来源之前的插入位：往后挪要跨过下一个标签。
                    return moveTabToStrip(current, {tab: key, panel: found.panel, index: delta === 1 ? found.index + 2 : next, activate: false}, policy);
                }, {flush: true}),
                /** 关掉标签：声明消失的视图的占位用（输出 4）。 */
                closeTab: (key: string): LayoutResult => apply((current) => removeTab(current, key)),
                /**
                 * 让视图看得见（输出 22、35 的 `nbook.view.open`）：所在面板显示并展开，激活它。盖着它的最大化退出；它就在最大化的面板里时不退出。
                 */
                revealView: (viewId: string): LayoutResult => {
                    const key = tabKey({kind: "view", viewId});
                    const found = findTab(doc.value, key);
                    // 浮动窗在最大化的面板上面，不用退出；它可能被别的窗盖着，提到最前。
                    const floating = found !== null && isFloating(doc.value, found.panel);
                    if (found !== null && !floating && maximized.value !== found.panel) maximized.value = null;
                    return apply((current) => {
                        const hit = findTab(current, key);
                        if (hit === null) return notFound(key);
                        if (isFloating(current, hit.panel)) {
                            const activated = activateTab(current, key);
                            return activated.ok ? raiseFloat(activated.doc, hit.panel) : activated;
                        }
                        const panel = current.panels[hit.panel];
                        const shown = panel?.name === undefined ? setPanelCollapsed(current, hit.panel, false) : setPanelHidden(current, hit.panel, false);
                        return shown.ok ? activateTab(shown.doc, key) : shown;
                    }, {flush: true});
                },
                /**
                 * “移动到”（输出 23）：放到一块面板的标签末尾，或挨着一块工具面板开新面板：这一列放下面，这一排放右边。
                 */
                moveView: (viewId: string, target: string | {readonly newPanelNextTo: string}): LayoutResult => apply((current) => {
                    if (catalog.value.get(viewId)?.movable === false) return {ok: false, code: "rejected", detail: viewId};
                    const key = tabKey({kind: "view", viewId});
                    if (typeof target === "string") {
                        const panel = current.panels[target];
                        if (panel === undefined) return notFound(target);
                        const moved = moveTabToStrip(current, {tab: key, panel: target, index: panel.tabs.length}, policy);
                        // 隐藏的具名面板也能是目标：放进去之后它要看得见。
                        return moved.ok && panel.hidden === true ? setPanelHidden(moved.doc, target, false) : moved;
                    }
                    const beside = target.newPanelNextTo;
                    if (current.panels[beside] === undefined) return notFound(beside);
                    if (current.panels[beside]?.role !== "tool") return {ok: false, code: "rejected", detail: beside};
                    const edge = newPanelEdgeTarget(current, beside);
                    return edge === null ? notFound(beside) : moveTabToEdge(current, {tab: key, target: edge}, policy);
                }, {flush: true}),
                /** “重置位置”（输出 23）：回到声明的具名面板的标签末尾。 */
                resetView: (viewId: string): LayoutResult => apply((current) => {
                    if (catalog.value.get(viewId)?.movable === false) return {ok: false, code: "rejected", detail: viewId};
                    const location = catalog.value.get(viewId)?.location;
                    const panel = Object.entries(current.panels).find(([, record]) => record.name === location);
                    if (panel === undefined) return notFound(viewId);
                    const moved = moveTabToStrip(current, {tab: tabKey({kind: "view", viewId}), panel: panel[0], index: panel[1].tabs.length}, policy);
                    return moved.ok ? setPanelHidden(moved.doc, panel[0], false) : moved;
                }, {flush: true}),
                /** 最大化（输出 13）：只在内存；再点同一块退出。 */
                toggleMaximized: (panel: string): boolean => {
                    // 浮动窗不可最大化：它不在树里，盖不了别的面板。
                    if (doc.value.panels[panel] === undefined || isFloating(doc.value, panel)) return false;
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
                    // 卡在关卡上（`editor.tabs` 写不下去）时布局自己没有待重试的：先让关卡恢复，通了再存。
                    const gate = saveBlocked.value ? saveGate : null;
                    if (gate !== null) saveBlocked.value = !(await gate.recover());
                    const result = await field.retry();
                    if (gate !== null && !saveBlocked.value) await save();
                    return result;
                },
                /** 放弃未保存的修改：显示回到已确认值。开着的编辑器标签不算在内（`carryDynamicTabs`）：它们背后是文档，回滚布局不能把它们弄丢。 */
                discard: (): string => {
                    const stored = readStored();
                    const current = doc.value;
                    const hasOpenTabs = Object.values(current.panels).some((panel) => panel.tabs.some((tab) => tab.kind === "tab"));
                    local.value = stored === null && !hasOpenTabs ? null : carryDynamicTabs(stored ?? defaultLayoutDoc(catalog.value), current);
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
