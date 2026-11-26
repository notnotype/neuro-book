/**
 * 一棵树的布局 store（docs/specs/ui/workbench-layout.md“状态与转换”）：文档只在内存里有一份（`local`），打开时从记录读一次，之后记录只管存。所以另一个窗口保存时本窗口的显示不被强改，
 * 保存冲突时重读 revision 再用本窗口的文档覆盖（整棵树后写胜出，不合并），未绑定项目的窗口存盘时去掉动态标签也不影响显示。
 *
 * 文档的改动都经 `apply`：先把呈现尺寸写回意图，再做领域操作。没有变化（放回原处）时不写。
 */

import {computed, effect, onScopeDispose, shallowRef} from "@vue/reactivity";

import {activateTab, applyGestureCommit, applyLayoutDrop, carryDynamicTabs, findTab, floatTab, isContainerAnchor, isFloating, isPanelShown, isSectionCollapsed, LAYOUT_MAX_FLOATS, moveTabToEdge, moveTabToStrip, presentationCollapse, projectLayoutDoc, raiseFloat, rebaseForOperation, regionOf, roundFloatRect, removeTab, sameTreeShape, setActiveContainer, setBarHidden, setContainerRail, setFloatRect, setPanelCollapsed, setPanelHidden, stripDynamicTabs, tabKey, treeEditorAnchor, validateLayoutDoc} from "@notnotype/nb-workbench-layout";
import {createGrid} from "@notnotype/nb-layout";
import type {GridExtent, GridFloatInput} from "@notnotype/nb-layout";
import type {LayoutBar, LayoutDoc, LayoutDropAction, LayoutFloatRect, LayoutProjection, LayoutProjectionOptions, LayoutResult, PanelName} from "@notnotype/nb-workbench-layout";

import {defineStore} from "nbook/shared/store/store";

import type {EditorSaveGate} from "../../shared/contracts";
import {editorTabIdOf} from "../../shared/editor-panels";
import type {EditorTabDrag} from "../contracts";
import {applyEntryDrop, isEntryAction} from "../entry-drop";
import type {WorkbenchDragSource, WorkbenchDropAction} from "../entry-drop";
import type {ViewCatalog} from "../views/registry";
import {CUSTOM_CONTAINER_PREFIX, IMPLICIT_CONTAINER_PREFIX} from "../../shared/views";
import {containerHomeRegion, containerRegion, implicitContainerOf, moveContainerTo, NO_CONTAINERS, regionAnchor, regionSections, sectionLanding, settleContainers, viewHome, viewSection} from "./containers";
import type {ContainerCatalog} from "./containers";
import {defaultLayoutDoc, fitsSkeleton, predatesContainers, reconcileViews} from "./default-tree";
import {guardPlacement} from "./placement";
import {collapseOrder, createLayoutPolicy, defaultFloatRect, keepVisible, layoutProjectionOptions, panelConstraints, railBaseline, railBudget, railLimit} from "./layout-constraints";
import {SHELL_RAIL_WIDTH} from "../shell/sizes";
import type {ViewRailBounds} from "../../shared/contracts";
import {effectiveVisibleTabs, mergedSections, regionOccupied, viewKey} from "./layout-present";
import {LAYOUT_DOC_RECORDS, LAYOUT_TEMPLATE_RECORD} from "./records";
import type {LayoutDocRecord} from "./records";

/**
 * 打开、关闭、切标签合并着存，至多这么久一次，手势结束立刻存。只合并一连串的动作（方向键在资源管理器里走一路，每步都换 preview 标签）：等得再久，
 * 刚打开标签就刷新的话这个标签就丢了，页面离开时也来不及补写。
 */
export const LAYOUT_SAVE_COALESCE_MS = 150;

export type LayoutDocProblem =
    /** `detail` 只进诊断日志：状态栏按 `code` 显示本地化的原因。 */
    | {readonly kind: "unread"; readonly code: string; readonly detail?: string}
    | {readonly kind: "unsaved"; readonly code: string};

export type LayoutPart = "sidebar" | "auxiliarybar" | "panel" | LayoutBar;

/**
 * 右轨此刻生效的状态（docs/specs/ui/workbench-layout.md 输出 50）。`bounds` 为 null：当前容器没有视图段（几节、别的视图、没声明、出错或撤回），按收着呈现。
 * `requested` 是意图的宽（没写时是声明的缺省）夹进声明范围之后；`width` 是这一次生效的卡片宽；`tooNarrow` 是意图要展开、预算给不出。
 */
export interface RailState {
    readonly container: string;
    readonly viewId: string | null;
    readonly bounds: ViewRailBounds | null;
    readonly expanded: boolean;
    readonly tooNarrow: boolean;
    readonly width: number;
    readonly requested: number;
    readonly regionWidth?: number;
    /** 展开着时这一刻最多能展开到多宽（`railLimit`）：轨宽手柄按它触界即停。 */
    readonly limit?: number;
}

/** 展开请求的结果（views.md 输出 21 的 `request`，工作台这一侧）：`too-narrow` 时意图不改。 */
export type RailRequestResult = {readonly ok: true; readonly result: "done" | "too-narrow"} | Exclude<LayoutResult, {readonly ok: true}>;

/** “移动到”的目标（输出 23）：一个容器的 id，或在哪个区域里新建一个用户容器。 */
export type MoveViewTarget = {readonly container: string} | {readonly newContainerIn: PanelName};

/** 存盘之前的关卡（`EditorSaveGate`）：编辑器先写 `editor.tabs`，它失败时布局不写，不留下引用不存在的标签。 */
export type LayoutSaveGate = EditorSaveGate;

type LayoutFailure = Exclude<LayoutResult, {readonly ok: true}>;
const notFound = (id: string): LayoutFailure => ({ok: false, code: "not-found", message: `Not found: ${id}`});

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
        /** 视图声明的视图段（外壳交进来：注册表的 `railOf`，渲染出错、交付撤回的视图给 null，输出 50 的“展开”）。 */
        const railBounds = shallowRef<(viewId: string) => ViewRailBounds | null>(() => null);
        /** 轨宽手柄拖动中的宽（输出 50 的“轨宽手柄”）：只给呈现，不写文档；松手由 `commitRailWidth` 提交。 */
        const railPreview = shallowRef<number | null>(null);
        /**
         * 上一次请求展开被预算拒绝的容器（输出 50 的“预算”：被拒时悬停与读屏给“窗口太窄”）。被拒不写文档，没有这一项的话被拒之后按钮上什么都看不出来；
         * 只在内存，下一次请求（展开成功或收起）清掉。
         */
        const refusedRail = shallowRef<string | null>(null);
        const containers = shallowRef<ContainerCatalog>(NO_CONTAINERS);
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

        /** 记录里的文档通不过校验：和损坏一样，回落默认树，原件不覆盖；校验的码与英文 message 放进 `detail`。 */
        const recordProblem = computed<LayoutDocProblem | null>(() => {
            const base = field.base;
            if (base === null || base.status !== "ok") return null;
            const checked = validateLayoutDoc(base.value.doc);
            if (checked.ok) return null;
            return {kind: "unread", code: checked.code === "unsupported-version" ? "unsupported-version" : "corrupt", detail: `${checked.code}: ${checked.message}`};
        });
        const guarded = computed(() => recordProblem.value !== null || field.base?.status === "corrupt" || field.base?.status === "unsupported-version");

        function readStored(): LayoutDoc | null {
            const base = field.base;
            if (base?.status === "ok") return usableDoc(base.value.doc);
            // 没有记录时取模板（新项目的初始布局）。
            if (base?.status === "missing") return usableDoc(template.display.doc);
            return null;
        }
        /** 记录合法但不合骨架（片 7c 之前存的，或有容器之前存的）：用默认树、下次保存覆盖它，不算损坏，用户没有什么可做的。只在外壳根写一条诊断。 */
        const outsideSkeleton = computed(() => {
            const base = field.base;
            if (base?.status !== "ok") return false;
            const checked = validateLayoutDoc(base.value.doc);
            return checked.ok && !fitsSkeleton(checked.doc) && local.value === null;
        });
        /**
         * 采用的那份文档（记录，没有记录时是模板，同 `readStored`）合法、但有值在读入时被局部修掉（侧轨意图，docs/specs/ui/workbench-layout.md 输出 50）：
         * 文档照用，外壳根写一条诊断。下次保存写回的是归一后的文档，记录里就没有要修的了。
         */
        const recordRepairs = computed<ReadonlyArray<string>>(() => {
            const base = field.base;
            const source = base?.status === "ok" ? base.value.doc : base?.status === "missing" ? template.display.doc : undefined;
            if (source === undefined || source === null) return [];
            const checked = validateLayoutDoc(source);
            // 不合骨架的不采用（回落默认树，`outsideSkeleton` 另有诊断），修掉的值也就没有用上，不报。
            return checked.ok && fitsSkeleton(checked.doc) ? checked.repairs : [];
        });
        /**
         * 有容器之前存的记录（“状态与转换”）：回落默认布局时，它开着的编辑器标签带进默认布局的编辑组。只记下那份文档、每次现算，不在打开时就定成 `local`：
         * 视图目录可能在记录读完之后才交进来，那时定下来的默认布局里一个视图都没有，后来的视图会按“文档已有之后才出现”放进隐藏的区域。
         */
        const carried = shallowRef<LayoutDoc | null>(null);
        const fallback = (): LayoutDoc => {
            const base = defaultLayoutDoc(catalog.value, containers.value);
            return carried.value === null ? base : carryDynamicTabs(base, carried.value);
        };
        const doc = computed<LayoutDoc>(() => settleContainers(reconcileViews(local.value ?? fallback(), catalog.value, containers.value)));

        // 只读一次：之后别的窗口保存不改本窗口的显示。
        let opened = false;
        effect(() => {
            if (opened || !field.ready || !template.ready) return;
            opened = true;
            local.value = readStored();
            const base = field.base;
            const checked = local.value === null && base?.status === "ok" ? validateLayoutDoc(base.value.doc) : null;
            carried.value = checked?.ok === true && predatesContainers(checked.doc) ? checked.doc : null;
        });

        const ready = computed(() => field.ready && template.ready);
        const problems = computed<ReadonlyArray<LayoutDocProblem>>(() => {
            if (field.save.state === "failed" || field.save.state === "unknown") return [{kind: "unsaved", code: field.save.code}];
            if (saveBlocked.value) return [{kind: "unsaved", code: "save-gate"}];
            if (field.failure !== null) return [{kind: "unread", code: field.failure}];
            if (recordProblem.value !== null) return [recordProblem.value];
            const status = field.base?.status;
            return status === "corrupt" || status === "unsupported-version" ? [{kind: "unread", code: status}] : [];
        });

        const collapse = computed(() => {
            const current = extent.value;
            if (current === null) return {removed: new Set<string>() as ReadonlySet<string>, squeezed: false};
            return presentationCollapse(doc.value, current, {...layoutProjectionOptions({doc: doc.value, catalog: catalog.value, viewportWidth: current.width, cardGap: cardGap.value}), order: collapseOrder(doc.value), focused: currentPanel.value});
        });
        /**
         * 投影选项。约束按面板所在的区域取（输出 6），区域要从被投影的那份文档里问：预览的文档另算一份选项。`expanded` 为假时侧轨都按收着算：
         * 预算的基线按它求（输出 50 的“预算”）。
         */
        const optionsOf = (of: LayoutDoc, expanded: boolean): LayoutProjectionOptions => {
            const budget = expanded ? railBudgetOptions.value ?? {} : {};
            return layoutProjectionOptions({doc: of, catalog: catalog.value, viewportWidth: extent.value?.width ?? 0, removed: collapse.value.removed, squeezed: collapse.value.squeezed, cardGap: cardGap.value, ...budget});
        };
        /**
         * 投影从 `railState` 只读这两个数。`railState` 还跟着视图实例的状态（`railBounds` 读加载、出错）重算，每次是新对象；
         * 投影要是直接读它，视图在手势中加载（从零拉出时就会，输出 17）就让投影换一份、打断网格的手势。所以收着时是 null，数没变时交回上一份。
         */
        const railBudgetOptions = computed((previous?: {readonly railWidth: number; readonly regionWidth?: number} | null) => {
            const rail = railState.value;
            if (rail?.expanded !== true) return null;
            if (previous != null && previous.railWidth === rail.width && previous.regionWidth === rail.regionWidth) return previous;
            return {railWidth: rail.width, ...(rail.regionWidth === undefined ? {} : {regionWidth: rail.regionWidth})};
        });
        /**
         * 右轨此刻生效的状态（输出 50 的“展开”“预算”）：当前容器恰有一节、那个视图声明了视图段（`railBounds`，外壳从注册表与实例状态给）、意图是展开时，
         * 按收着求一次基线再算预算。基线只读收着的投影，所以结果不随这次展开本身的呈现变化来回翻。右栏没有当前容器时是 null。
         * 意图是收着、但刚才请求展开被拒（`refusedRail`）时也按预算判：给不出就标 `tooNarrow`，给得出（窗口变宽了）照旧收着，等用户再点。
         */
        const railState = computed((): RailState | null => {
            const current = doc.value;
            const anchor = regionAnchor(current, "auxiliarybar");
            const container = anchor === null ? null : current.panels[anchor]?.activeContainer ?? null;
            if (anchor === null || container === null) return null;
            const sections = regionSections(current, "auxiliarybar").filter((section) => section.container === container);
            const viewId = sections.length === 1 ? sections[0]?.viewId ?? null : null;
            const bounds = soleRailBounds(current, container);
            const intent = current.panels[anchor]?.rail?.[container];
            const requested = bounds === null ? SHELL_RAIL_WIDTH : Math.min(bounds.maximum, Math.max(bounds.minimum, railPreview.value ?? intent?.width ?? bounds.width));
            const collapsed: RailState = {container, viewId, bounds, expanded: false, tooNarrow: false, width: SHELL_RAIL_WIDTH, requested};
            const wanted = intent?.expanded === true;
            if (bounds === null || (!wanted && refusedRail.value !== container)) return collapsed;
            const budgeted = budgetFor(current, requested, bounds);
            if (budgeted === null || budgeted.budget.result === "too-narrow") return {...collapsed, tooNarrow: true};
            if (!wanted) return collapsed;
            const {budget, limit} = budgeted;
            return {...collapsed, expanded: true, width: budget.width, limit, ...(budget.regionWidth === undefined ? {} : {regionWidth: budget.regionWidth})};
        });
        /** 按收着的投影求一次布局，取基线、算预算；窗口尺寸还不知道、找不到编辑组时是 null（不能展开）。 */
        function budgetFor(of: LayoutDoc, request: number, bounds: ViewRailBounds) {
            const area = extent.value;
            if (area === null) return null;
            const collapsedProjection = projectLayoutDoc(of, optionsOf(of, false));
            const baseline = railBaseline(of, collapsedProjection, createGrid<string>(collapsedProjection.input, {sashSize: collapsedProjection.sashSize}).layout(area));
            return baseline === null ? null : {budget: railBudget({baseline, request, segment: bounds}), limit: railLimit(baseline, bounds)};
        }
        const optionsFor = (of: LayoutDoc): LayoutProjectionOptions => optionsOf(of, true);
        const projectionOptions = computed(() => optionsFor(doc.value));
        const projection = computed(() => projectLayoutDoc(doc.value, projectionOptions.value));
        /**
         * 实时布局的预览（docs/specs/ui/workbench-layout.md“实时布局”）：只给渲染用的一份文档。判定、提交、可见性、记录都还看已提交的 `doc` 与 `projection`：
         * 预览不改可见性（输出 17），也不能让预览才有的节点混进下一次提交的意图。
         */
        const livePreview = shallowRef<LayoutDoc | null>(null);
        const renderedDoc = computed(() => livePreview.value ?? doc.value);
        const renderedProjection = computed(() => (livePreview.value === null ? projection.value : projectLayoutDoc(livePreview.value, optionsFor(livePreview.value))));
        /** 放不下把最大化的面板收走了：退出最大化，不写文档。 */
        const effectiveMaximized = computed(() => {
            const panel = maximized.value === null ? undefined : doc.value.panels[maximized.value];
            // 这块面板不在了、隐藏了（包括标签被搬空）、收起了都退出（输出 13）：不管是哪条路径改的文档。
            return maximized.value === null || panel === undefined || !isPanelShown(doc.value, maximized.value) || isSectionCollapsed(doc.value, maximized.value) || collapse.value.removed.has(maximized.value) || isFloating(doc.value, maximized.value) ? null : maximized.value;
        });
        /**
         * 缩放中的浮动窗矩形：只有它在变，不换文档、不重算投影。整窗拖动只在开始时写一次带上标记，跟手的位置由外壳直接写元素。
         */
        const floatPreview = shallowRef<{readonly panel: string; readonly rect: LayoutFloatRect; readonly gesture: "move" | "resize"} | null>(null);
        /** 画出来的浮动窗（相对树区域）：夹取之后的矩形，夹取不写回。 */
        const renderedFloats = computed<ReadonlyArray<GridFloatInput>>(() => renderedDoc.value.floats.map(({panel, rect}) => {
            const preview = floatPreview.value?.panel === panel ? floatPreview.value : null;
            const wanted = preview?.rect ?? rect;
            return {id: panel, rect: keepVisible(wanted, extent.value), ...(preview === null ? {} : {gesture: preview.gesture})};
        }));
        /** 编辑器标签的拖动（区级组件交出来）：动它们要走编辑器区，先结算输入、合并同一文件。 */
        const editorDrag = shallowRef<EditorTabDrag | null>(null);
        /** 走编辑器区的动作：编辑器没有交出来、或它拒绝了（提示由它给），都是失败。 */
        async function viaEditor(target: string, run: (drag: EditorTabDrag) => Promise<boolean>): Promise<LayoutResult> {
            const drag = editorDrag.value;
            if (drag === null) return {ok: false, code: "not-found", message: `The editor area has not handed over its drag: ${target}`};
            return (await run(drag)) ? {ok: true, doc: doc.value} : {ok: false, code: "rejected", message: `Refused by the editor area: ${target}`};
        }

        /** 有效可见的标签键（输出 17）。 */
        const visibleTabs = computed(() => effectiveVisibleTabs(doc.value, {sizes: presented.value, preview: preview.value, removed: collapse.value.removed, maximized: effectiveMaximized.value, fillers: projection.value.fillers, merged: mergedSections(projection.value)}));

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

        /** 结构操作之前把呈现尺寸写回意图（输出 8、49）。 */
        const rebased = (): LayoutDoc => rebaseForOperation(doc.value, projection.value, presented.value);

        /**
         * 写入的出口要守的两道关，`apply` 与试算（`permits`）共用：合骨架（落点只给合骨架的目标，但服务 `EditorPanels.tabs.moveToEdge` 能传任意目标），
         * 不多出违反位置限制的视图（views.md 输出 22）。通过的结果归整过容器：库的结构操作只写分节的归属，入口顺序、当前容器空了换谁、区域空了隐藏在这里归整
         * （输出 41、43）。预览不过这里，预览里不切容器（输出 38）。
         */
        function admitted(base: LayoutDoc, result: LayoutResult): LayoutResult {
            if (!result.ok || result.doc === base) return result;
            if (!fitsSkeleton(result.doc)) return {ok: false, code: "rejected", message: "The result does not fit the skeleton"};
            const settled = settleContainers(result.doc);
            return guardPlacement(base, {ok: true, doc: settled}, catalog.value);
        }

        /** 这个操作此刻提交会不会被收下（“移动到”的目标表、入口菜单按它列项）：和 `apply` 同一道关，不写回尺寸意图、不写文档。 */
        const permits = (operation: (current: LayoutDoc) => LayoutResult): boolean => admitted(doc.value, operation(doc.value)).ok;

        /**
         * `rebase: false` 给不动树的操作（切换容器、让视图看得见）：切换不改任何尺寸意图（输出 42）。写回意图时有收起兄弟的分支按比例换算，
         * 呈现与意图一样也会差在浮点的末位，切换几次记录就变了。
         */
        function apply(operation: (current: LayoutDoc) => LayoutResult, options: {readonly flush?: boolean; readonly rebase?: boolean} = {}): LayoutResult {
            const base = options.rebase === false ? doc.value : rebased();
            const result = admitted(base, operation(base));
            if (!result.ok) {
                if (result.code === "limit-exceeded") structureFailure.value = result.message;
                return result;
            }
            if (result.doc === base) return {ok: true, doc: doc.value};
            if (!sameTreeShape(base, result.doc)) maximized.value = null;
            local.value = result.doc;
            schedule(options.flush ?? false);
            return result;
        }

        /** 区域显示（清掉隐藏与拖到零）并切到这个容器（输出 23、42）。容器要已经有成员：先归整，入口顺序里才有它。 */
        function showContainer(current: LayoutDoc, region: PanelName, container: string): LayoutResult {
            const settled = settleContainers(current);
            const anchor = regionAnchor(settled, region);
            if (anchor === null) return notFound(region);
            const shown = setPanelHidden(settled, anchor, false);
            return shown.ok ? setActiveContainer(shown.doc, anchor, container) : shown;
        }

        /** 把一个标签放成 `region` 里 `container` 的最后一个分节，区域显示并切到这个容器（输出 23 的“移进一个容器”）。 */
        function placeInContainer(current: LayoutDoc, key: string, region: PanelName, container: string): LayoutResult {
            const target = sectionLanding(current, region, container);
            if (target === null) return notFound(region);
            const moved = moveTabToEdge(current, {tab: key, target, container}, policy);
            return moved.ok ? showContainer(moved.doc, region, container) : moved;
        }

        /**
         * 让容器看得见，一次提交（store 的 `showContainer` 动作；`moveView` 放到它自己身后也是这件事）：不写回尺寸意图（输出 42），
         * 最大化着的面板不是这个容器的分节时退出，不然切过去了也被盖着。
         */
        function revealContainer(container: string): LayoutResult {
            if (maximized.value !== null && doc.value.panels[maximized.value]?.container !== container) maximized.value = null;
            return apply((current) => {
                const region = containerRegion(current, container);
                return region === null ? notFound(container) : showContainer(current, region, container);
            }, {rebase: false});
        }

        /** 没有成员的容器按声明该在哪个区域（`moveView`）：隐式容器 `view:<视图>` 只在那个视图没写别的容器时才有声明（输出 41）。 */
        function declaredRegion(container: string): PanelName | null {
            const owner = container.startsWith(IMPLICIT_CONTAINER_PREFIX) ? container.slice(IMPLICIT_CONTAINER_PREFIX.length) : null;
            if (owner !== null && viewHome(owner, catalog.value, containers.value)?.container !== container) return null;
            return containerHomeRegion(container, catalog.value, containers.value);
        }

        /**
         * 视图按此刻的声明该回哪（“重置位置”、浮动窗回到停靠）：它的容器此刻在哪个区域就去哪，容器没有成员时去声明的区域。声明不在的视图回侧栏，进自己的隐式容器。
         */
        function homeOf(current: LayoutDoc, viewId: string): {readonly region: PanelName; readonly container: string} {
            const home = viewHome(viewId, catalog.value, containers.value) ?? {container: implicitContainerOf(viewId), location: "sidebar" as const};
            return {region: containerRegion(current, home.container) ?? home.location, container: home.container};
        }

        /** 右栏里这个容器恰有一节、那个视图声明了视图段时的范围；别的都是 null。 */
        function soleRailBounds(of: LayoutDoc, container: string): ViewRailBounds | null {
            const sections = regionSections(of, "auxiliarybar").filter((section) => section.container === container);
            const viewId = sections.length === 1 ? sections[0]?.viewId ?? null : null;
            return viewId === null ? null : railBounds.value(viewId);
        }

        /**
         * `moveView` 的结构部分（输出 23）：移进一个容器，或在一个区域里新建一个只含它的用户容器。新容器的 id 只在这里生成；试算（`permitsMoveView`）也走这里，
         * 生成的 id 只在那份算完就丢的文档里。
         */
        const moveViewOperation = (viewId: string, target: MoveViewTarget) => (current: LayoutDoc): LayoutResult => {
            const key = viewKey(viewId);
            if (findTab(current, key) === null) return notFound(key);
            if ("newContainerIn" in target) return placeInContainer(current, key, target.newContainerIn, `${CUSTOM_CONTAINER_PREFIX}${crypto.randomUUID()}`);
            const {container} = target;
            const region = containerRegion(current, container) ?? declaredRegion(container);
            if (region === null) return notFound(container);
            const placed = placeInContainer(current, key, region, container);
            // 视图从别处回到它声明的容器（菜单与命令面板的“重置位置”就是这一步）：同一次提交清掉那个容器的侧轨意图（输出 50 的“展开”）。
            // 浮动窗归位（`dockFloat`）不走这里，意图照样带回去。
            const resetting = viewHome(viewId, catalog.value, containers.value)?.container === container && viewSection(current, viewId)?.container !== container;
            const anchor = placed.ok && resetting ? regionAnchor(placed.doc, region) : null;
            if (!placed.ok || anchor === null || placed.doc.panels[anchor]?.rail?.[container] === undefined) return placed;
            return setContainerRail(placed.doc, {anchor, container, intent: null});
        };

        return {
            state: {doc, ready, problems, field, catalog, containers, extent, projection, collapse, maximized: effectiveMaximized, currentPanel, focusedPanel, visibleTabs, presented, structureFailure, outsideSkeleton, recordRepairs, rail: railState, railPreview},
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
                /** 缩放中的浮动窗矩形，或整窗拖动开始时的标记；null 回到记录里的。 */
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
                    const {minimumSize, maximumSize} = panelConstraints(record, null, catalog.value, extent.value?.width ?? 0);
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
                commitDrop: (source: WorkbenchDragSource, action: WorkbenchDropAction, part: string | undefined, keyboard: boolean): void => {
                    // 活动栏上段的落点（输出 45、46）：容器层面的操作，编辑器的标签放不到这里。换序不动树，不写回尺寸意图。
                    if (isEntryAction(action)) {
                        apply((current) => applyEntryDrop(current, source, action, policy, {commit: true}), {flush: true, rebase: action.kind !== "move-entry"});
                        return;
                    }
                    // 含几个视图的入口只有入口之间这一种落点（输出 46），上面已经处理。
                    if (source.kind === "container") return;
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
                    if (doc.value.floats.length >= LAYOUT_MAX_FLOATS) return {ok: false, code: "limit-exceeded", message: "Too many floating windows"};
                    const rect = defaultFloatRect(extent.value, panelConstraints({role: record.role, tabs: [found.tab], active: key}, null, catalog.value, extent.value?.width ?? 0).minimumSize, doc.value.floats.length);
                    const editorTab = editorTabIdOf(key);
                    if (editorTab !== null) return viaEditor(key, (drag) => drag.drop(editorTab, {kind: "float", rect}, undefined, false));
                    return apply((current) => floatTab(current, {tab: key, rect}, policy), {flush: true});
                },
                /**
                 * 浮动窗回到停靠（`nbook.view.dock`）：工具视图各回声明的容器，一个标签一个分节（输出 39），声明没了的回侧栏；编辑器回树序最后一个编辑组。
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
                            const home = homeOf(next.doc, tab.viewId);
                            next = placeInContainer(next.doc, tabKey(tab), home.region, home.container);
                        }
                        // 逐个搬时每搬一个都切到它的容器：最后看得见的要是窗的活动标签所在的那个容器，和整窗拖进去一样。
                        const active = record.tabs.find((tab) => tabKey(tab) === record.active);
                        const landed = !next.ok || active?.kind !== "view" ? null : viewSection(next.doc, active.viewId);
                        return next.ok && landed !== null ? showContainer(next.doc, landed.region, landed.container) : next;
                    }, {flush: true});
                },
                /** 算出这棵呈现树用的选项：预览（落点）要和真实结果同一棵树。 */
                projectionOptions: (): LayoutProjectionOptions => projectionOptions.value,
                acceptViewCatalog: (next: ViewCatalog): void => {
                    catalog.value = next;
                },
                /** 容器声明目录（docs/specs/workbench/views.md 输出 15）。没有记录时默认布局跟着它重算，所以要在视图目录之前交进来。 */
                acceptViewContainers: (next: ContainerCatalog): void => {
                    containers.value = next;
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
                /**
                 * 手势落账（输出 49）：收起状态来自这次手势，意图从呈现尺寸写回，立刻存。`before` 是手势开始时呈现的布局（`onApplied` 交出），
                 * 不用 `presented`：实时预览期间 `presented` 不更新，可能和手势开始时的不同。
                 */
                commitGesture: (before: Readonly<Record<string, GridExtent>>, after: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void => {
                    // `rejected` 在这里不会有：投影只给文档收得起的节点配收起策略（`assignByParent`），区域的节点已经换成了锚，所以不另报。
                    local.value = applyGestureCommit(doc.value, projection.value, {before, after, collapsed}).doc;
                    presented.value = after;
                    schedule(true);
                },
                /** 显隐（输出 11）：隐藏的是整个区域，记在锚上。“显示”同时清掉隐藏与拖到零；区域空着时打开成一块空面板（ADR 0050）。隐藏最大化着的面板所在的区域时退出最大化（输出 13）。 */
                setPartHidden: (part: LayoutPart, hidden: boolean): LayoutResult => {
                    // 隐藏最大化着的面板所在的区域、或要显示被它盖住的区域，都退出最大化：不然按钮按了看不出变化。
                    const maximizedHere = maximized.value !== null && regionOf(doc.value, maximized.value) === part;
                    if (hidden ? maximizedHere : !maximizedHere) maximized.value = null;
                    return apply((current) => {
                        if (part === "activitybar" || part === "statusbar") return setBarHidden(current, part, hidden);
                        const anchor = regionAnchor(current, part);
                        return anchor === null ? notFound(part) : setPanelHidden(current, anchor, hidden);
                    });
                },
                setCollapsed: (panel: string, collapsed: boolean): LayoutResult => {
                    const result = apply((current) => setPanelCollapsed(current, panel, collapsed));
                    // 收不成标题行的分节会被拒绝（区域唯一显示的、底部面板的）：没收起就不退出最大化。
                    if (result.ok && collapsed && maximized.value === panel) maximized.value = null;
                    return result;
                },
                /** 激活标签（切标签合并着存）；面板收成标题行时一起展开（输出 11）。 */
                activate: (key: string): LayoutResult => apply((current) => {
                    const activated = activateTab(current, key);
                    const panel = findTab(current, key)?.panel;
                    return activated.ok && panel !== undefined && isSectionCollapsed(current, panel) ? setPanelCollapsed(activated.doc, panel, false) : activated;
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
                 * 让视图看得见（输出 22、35 的 `nbook.view.open`）：所在区域显示、切到它的容器，分节展开，激活它。盖着它的最大化退出；它就在最大化的面板里时不退出。
                 */
                revealView: (viewId: string): LayoutResult => {
                    const key = viewKey(viewId);
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
                        const region = regionOf(current, hit.panel);
                        const container = current.panels[hit.panel]?.container;
                        const shown = region === null || container === undefined ? {ok: true as const, doc: current} : showContainer(current, region, container);
                        const expanded = shown.ok ? setPanelCollapsed(shown.doc, hit.panel, false) : shown;
                        return expanded.ok ? activateTab(expanded.doc, key) : expanded;
                    }, {flush: true, rebase: false});
                },
                /**
                 * “移动到”与“重置位置”（输出 23，`nbook.view.move-view`）：移进一个容器，或在一个区域里新建一个只含它的用户容器。两种都是成为那个容器最后一个分节
                 * （`sectionLanding`：从前一个分节取一半，不跟 `dropSplit` 走），目标区域显示并切到这个容器；来源容器空了由 `apply` 里的 `settleContainers` 归整（输出 43）。
                 *
                 * 容器在哪个区域：有成员时是成员所在的区域；没有成员时是它声明的区域（声明的容器、隐式容器，这就是“重置位置”回到没有成员的容器的路）。
                 * 隐式容器只属于没写 `container` 的那个视图：它写了别的容器时，`view:<它>` 既没有成员也没有声明。两样都没有（含已经不存在的 `custom:`）
                 * 是 `not-found`：不凭空建出一个调用方点名的容器。新容器的 id 只在这里生成。
                 * 视图已经是目标容器最后一个分节时不搬：放到它自己后面不是一个落点，这就是点它的入口（`revealContainer`），已经看得见时零写入。
                 */
                moveView: (viewId: string, target: MoveViewTarget): LayoutResult => {
                    if (catalog.value.get(viewId)?.movable === false) return {ok: false, code: "rejected", message: `The view cannot be moved: ${viewId}`};
                    if ("container" in target) {
                        const region = containerRegion(doc.value, target.container);
                        const last = region === null ? undefined : regionSections(doc.value, region).filter((section) => section.container === target.container).at(-1);
                        if (last?.viewId === viewId) return revealContainer(target.container);
                    }
                    return apply(moveViewOperation(viewId, target), {flush: true});
                },
                /**
                 * “移动到”的这一项此刻会不会被收下（输出 23；位置限制，views.md 输出 22）：菜单与命令面板第二步只列会被收下的。放到自己身后（只是切过去）算收下。
                 */
                permitsMoveView: (viewId: string, target: MoveViewTarget): boolean => catalog.value.get(viewId)?.movable !== false && permits(moveViewOperation(viewId, target)),
                /**
                 * 让容器看得见（输出 22 的点入口、输出 42）：它所在的区域显示（清掉隐藏与拖到零）并切到它，一次提交；分节的先后、大小、收成标题行都不动。
                 * 已经是这样时零写入。
                 */
                showContainer: revealContainer,
                /**
                 * 把整个容器搬到另一个区域（输出 44 的“移到”“重置”），一次提交；带着什么、目标区域怎么变见 `moveContainerTo`。容器已经在那里时零写入。
                 */
                moveContainer: (container: string, region: PanelName): LayoutResult => apply((current) => moveContainerTo(current, container, region, policy), {flush: true}),
                /** 整个容器搬到这个区域此刻会不会被收下（入口菜单的“移到”“重置”按它列项）。 */
                permitsMoveContainer: (container: string, region: PanelName): boolean => permits((current) => moveContainerTo(current, container, region, policy)),
                /**
                 * 容器回到声明的区域（输出 44 的“重置”）：同 `moveContainer`，再清掉这个容器的侧轨意图（输出 50 的“展开”：重置位置清掉这一项）。
                 */
                resetContainer: (container: string, home: PanelName): LayoutResult => apply((current) => {
                    const moved = moveContainerTo(current, container, home, policy);
                    const anchor = moved.ok ? regionAnchor(moved.doc, home) : null;
                    if (!moved.ok || anchor === null || moved.doc.panels[anchor]?.rail?.[container] === undefined) return moved;
                    return setContainerRail(moved.doc, {anchor, container, intent: null});
                }, {flush: true}),
                /** 轨宽手柄拖动中的预览宽；null 撤回（输出 50 的“轨宽手柄”）。 */
                previewRailWidth: (width: number | null): void => {
                    railPreview.value = width;
                },
                /** 视图段的范围从哪里读（外壳交进来，见 `railBounds`）。 */
                acceptRailBounds: (next: (viewId: string) => ViewRailBounds | null): void => {
                    railBounds.value = next;
                },
                /**
                 * 右栏这个容器的侧轨展开或收起（输出 50 的“展开”）：只写这一项的 `expanded`，不写回尺寸意图。展开时先按此刻的布局算一次预算，
                 * 给不出（窗口太窄、没有视图段）就不写、回报 `too-narrow`，意图不改；能展开时退出别的面板的最大化。已经是这样时零写入。
                 */
                requestRailExpanded: (container: string, expanded: boolean): RailRequestResult => {
                    const current = doc.value;
                    const anchor = regionAnchor(current, "auxiliarybar");
                    const record = anchor === null ? undefined : current.panels[anchor];
                    if (anchor === null || record?.entries?.includes(container) !== true) return notFound(container);
                    const intent = record.rail?.[container] ?? {};
                    if (expanded) {
                        const bounds = soleRailBounds(current, container);
                        const budgeted = bounds === null ? null : budgetFor(current, Math.min(bounds.maximum, Math.max(bounds.minimum, intent.width ?? bounds.width)), bounds);
                        if (budgeted === null || budgeted.budget.result === "too-narrow") {
                            refusedRail.value = container;
                            return {ok: true, result: "too-narrow"};
                        }
                        maximized.value = null;
                    }
                    refusedRail.value = null;
                    const next = {...(expanded ? {expanded: true as const} : {}), ...(intent.width === undefined ? {} : {width: intent.width})};
                    const written = apply((doc) => setContainerRail(doc, {anchor, container, intent: next}), {flush: true, rebase: false});
                    return written.ok ? {ok: true, result: "done"} : written;
                },
                /**
                 * 轨宽手柄落账（输出 50 的“轨宽手柄”）：只写这一项的 `width`，取整、夹进视图段声明的范围；等于声明的缺省时不写（意图只记偏离缺省的部分）。
                 */
                commitRailWidth: (container: string, width: number): LayoutResult => apply((current) => {
                    const anchor = regionAnchor(current, "auxiliarybar");
                    const record = anchor === null ? undefined : current.panels[anchor];
                    if (anchor === null || record?.entries?.includes(container) !== true) return notFound(container);
                    const bounds = soleRailBounds(current, container);
                    const clamped = Math.round(bounds === null ? width : Math.min(bounds.maximum, Math.max(bounds.minimum, width)));
                    const expandedIntent = record.rail?.[container]?.expanded === true ? {expanded: true as const} : {};
                    return setContainerRail(current, {anchor, container, intent: {...expandedIntent, ...(bounds !== null && clamped === bounds.width ? {} : {width: clamped})}});
                }, {flush: true, rebase: false}),
                /** 最大化（输出 13）：只在内存；再点同一块退出。 */
                toggleMaximized: (panel: string): boolean => {
                    // 浮动窗不可最大化：它不在树里，盖不了别的面板。区域的锚也不行：区域里最大化的是一个分节（输出 13）。
                    const target = doc.value.panels[panel];
                    if (target === undefined || isContainerAnchor(target) || isFloating(doc.value, panel)) return false;
                    maximized.value = maximized.value === panel ? null : panel;
                    return true;
                },
                /** 区域或条此刻占不占地方（输出 36）；区域的判定见 `regionOccupied`。 */
                partVisible: (part: LayoutPart): boolean => {
                    const current = doc.value;
                    if (part === "activitybar" || part === "statusbar") return !current.hiddenBars.includes(part);
                    return regionOccupied(current, part, {removed: collapse.value.removed, maximized: effectiveMaximized.value});
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
                    local.value = stored === null && !hasOpenTabs ? null : carryDynamicTabs(stored ?? defaultLayoutDoc(catalog.value, containers.value), current);
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
