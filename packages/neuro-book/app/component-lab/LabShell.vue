<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, toRaw, watch} from "vue";
import {Type, type TSchema} from "typebox";
import {Value} from "typebox/value";
import {
    AlertDialog as NbAlertDialog,
    FormInput as NbFormInput,
    FormSelect as NbFormSelect,
    SegmentedControl as NbSegmentedControl,
    Switch as NbSwitch,
    Tabs as NbTabs,
    ToggleGroup as NbToggleGroup,
    Tree as NbTree,
} from "@notnotype/nb-ui/components";
import type {FormSelectOption, TabsItem, ToggleGroupOption} from "@notnotype/nb-ui/components";
import type {Component} from "vue";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import CollapsibleSidePanel from "./CollapsibleSidePanel.vue";
import ViewportCanvas from "./ViewportCanvas.vue";
import MarkdownView from "./MarkdownView.vue";
import EventLogPanel from "./EventLogPanel.vue";
import HighlightBox from "./HighlightBox.vue";
import {labComponents, findLabComponent, labComponentLabel, loadLabSubject, matchesLabQuery} from "./component-index";
import type {LabComponentKind, LabDisplayMode} from "./component-index";
import {findLabFixture} from "./fixtures";
import {LAB_CONTROLS_REGISTER, LAB_DATA_SINK, LAB_EVENT_SINK, LAB_INPUT_SINK} from "./lab-event-sink";
import {LabSceneInputSchema, checkLabInput, readLabSignature, type LabSceneInput, type LabSignature} from "./lab-subject";
import type {LabEventEntry} from "./event-log.types";
import type {HighlightRect} from "./highlight-box.types";
import type {InspectedNode} from "./inspect";
import {INSPECT_CLASS_LIMIT, describeNode, nodeLabel, nodeReport} from "./inspect";
import {clearLabWallpaper, loadLabWallpaper, saveLabWallpaper} from "./lab-wallpaper-store";
import {useLabPreferences} from "./use-lab-preferences";
import {provideWorkbenchCommands} from "nbook/app/composables/useWorkbenchCommands";
import WorkbenchCommandPalette from "nbook/app/components/workbench/WorkbenchCommandPalette.vue";
import {
    effectiveAgentExposure,
    type CommandConfirmationRequest,
    type CommandDescriptor,
    type CommandInvocation,
    type CommandMetadata,
    type CommandResult,
    type Release,
} from "nbook/app/utils/workbench/commands";
import {evaluateContextWhen} from "nbook/app/utils/workbench/context-keys";
import {createKeymapDispatcher} from "nbook/app/utils/workbench/keymap";
import {LAB_PANEL_WIDTH_LIMITS} from "./lab-preferences-store";
import type {LabPanelSide} from "./lab-preferences-store";
import {
    LAB_DEFAULT_BACKDROP,
    LAB_DEFAULT_PAGE_BACKDROP,
    LAB_DEFAULT_ZOOM,
    labBackdrops,
    labPageBackdrops,
    labZooms,
} from "./stage-backdrops";
import {useElementRect} from "./use-element-rect";
import {
    LAB_DEFAULT_COLORWAY,
    LAB_DEFAULT_THEME,
    applyLabTheme,
    clearLabTheme,
    labColorwayMeta,
    labThemes,
} from "./lab-theme";

const EVENT_LIMIT = 200;

// 每一级目录都是可折叠的分组：novel-ide / novel-ide/settings / … / model/components
const ALL_GROUP_IDS = [...new Set(labComponents.flatMap((entry) =>
    entry.groupPath.map((_, index) => `group:${entry.groupPath.slice(0, index + 1).join("/")}`)))];

const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const preferredLeftCollapsed = ref(false);
const preferredRightCollapsed = ref(false);
/**
 * 侧栏默认宽度：左栏要放得下多级目录路径（最深五级），右栏要读得下文档正文。
 * 拖动后的值随偏好一起存，恢复默认配置时回到这里。
 */
const LAB_PANEL_DEFAULT_WIDTH = {left: 300, right: 380} as const;
/** 拖到再窄也得给画布留出可用宽度，否则两侧栏会把中间的组件挤没。 */
const LAB_CANVAS_MIN_WIDTH = 560;
/** 与 CollapsibleSidePanel 的 collapsedWidth 缺省一致：收起后它只占一条导轨。 */
const LAB_PANEL_RAIL_WIDTH = 40;
const leftWidth = ref<number>(LAB_PANEL_DEFAULT_WIDTH.left);
const rightWidth = ref<number>(LAB_PANEL_DEFAULT_WIDTH.right);
function getInitialLabSelection(): {name: string; scene: string} {
    if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const comp = params.get("c") ?? params.get("component") ?? undefined;
        const scene = params.get("s") ?? params.get("scene") ?? undefined;
        if (comp && labComponents.some((entry) => entry.name === comp)) {
            return {
                name: comp,
                scene: (scene && /^[a-zA-Z0-9_.-]+$/.test(scene)) ? scene : "",
            };
        }
    }
    const defaultMountable = labComponents.find((entry) => entry.mountable)?.name ?? "";
    return {name: defaultMountable, scene: ""};
}

const initialSelection = getInitialLabSelection();
const selectedName = ref<string>(initialSelection.name);
const selectedScene = ref<string>(initialSelection.scene);
const rightTab = ref("doc");
const treeQuery = ref("");
const expandedGroups = ref<string[]>([...ALL_GROUP_IDS]);
const canvasWidth = ref(0);
const canvasHeight = ref(0);
const canvasZoom = ref(String(LAB_DEFAULT_ZOOM));
const LAB_MOBILE_BREAKPOINT = 700;
const canvasBackdrop = ref(LAB_DEFAULT_BACKDROP);
const pageBackdrop = ref(LAB_DEFAULT_PAGE_BACKDROP);
const fixtureComponent = shallowRef<Component | null>(null);
const fixtureLoading = ref(false);
const fixtureLoadError = ref("");
/** 当前场景的分层输入：场景登记的初值，之后由数据面板编辑、组件 `update:x` 与 fixture 回写。 */
const sceneInput = ref<LabSceneInput | undefined>(undefined);
/** 复合宿主 fixture 使用的可编辑场景初值，与被检组件的 input 签名分开保存。 */
const sceneData = ref<unknown>(undefined);
/** fixture 上报的被测组件内部状态快照，只读展示。 */
const fixtureState = ref<unknown>(undefined);
/** 数据面板最近一次编辑不符合分层 schema 时的原因；合法编辑后清空。 */
const inputEditError = ref("");
/** 被测组件（不是 fixture）的运行时签名，数据面板据此对照输入。 */
const subjectSignature = shallowRef<LabSignature | null>(null);
const events = ref<LabEventEntry[]>([]);
let fixtureLoadToken = 0;
let eventCounter = 0;

function ensureSelectedComponentExpanded(name: string): void {
    if (!name) return;
    const comp = findLabComponent(name);
    if (!comp || !comp.groupPath.length) return;
    const neededGroups: string[] = [];
    for (let i = 0; i < comp.groupPath.length; i++) {
        neededGroups.push(`group:${comp.groupPath.slice(0, i + 1).join("/")}`);
    }
    const set = new Set([...expandedGroups.value, ...neededGroups]);
    expandedGroups.value = Array.from(set);
}

const matchedComponents = computed(() => {
    const query = treeQuery.value.trim();
    if (query === "") {
        return labComponents;
    }
    // 搜组件名、文档显示名与部件别名：导航要的是「我知道它长什么样，带我过去」，
    // 所以搜正文仍然不做（那会把「凡是提到 Tree 的组件」全捞出来）。
    return labComponents.filter((entry) => matchesLabQuery(entry, query));
});

type LabTreeNode = {id: string; title: string; iconClass?: string; children?: LabTreeNode[]};

/**
 * 图形按组件分类给，不按「能不能挂载」给：分类回答「这是什么」，锁只回答「这里能不能跑」——
 * 后者仍然覆盖前者，因为它是一条约束，不是类型。
 *
 * 颜色跟图形一起给：一百多行里靠文字找组件时，色相是唯一不用读字就能扫出来的线索。
 *
 * 这里只认四根**能用的色相轴**（青 `--status-info`、绿 `--status-success`、
 * 橙 `--status-warning`、红 `--status-danger`）加主题强调蓝，其余四档用 `color-mix` 在它们之间
 * 取中间色相。之所以不直接拿 `--accent-text` 当第三档：它和 `--accent-main`、`--status-info`
 * 都是蓝的（#0060df / #007aff / #0a7ea4，色相 214° / 211° / 195°），三档只差十几度，
 * 在 14px 图标上等于一个颜色。下表括号里是两套配色下的实际色相，相邻档至少差 45°。
 *
 * 全部由主题 token 派生，不写死 hex；换配色时跟着走。
 */
const KIND_ICONS: Record<LabComponentKind, string> = {
    view: "i-lucide-layout-panel-top text-[var(--status-info)]",
    // 蓝 + 红（1:3）= 玫红，与「面板」的紫分开约 70°
    dialog: "i-lucide-app-window text-[color-mix(in_srgb,var(--accent-main)_25%,var(--status-danger))]",
    // 绿 + 橙 = 黄绿，落在「字段」的橙与「列表」的绿之间
    section: "i-lucide-list-tree text-[color-mix(in_srgb,var(--status-success)_55%,var(--status-warning))]",
    field: "i-lucide-sliders-horizontal text-[var(--status-warning)]",
    list: "i-lucide-list text-[var(--status-success)]",
    // 蓝 + 红（约 1:1）= 紫
    panel: "i-lucide-panel-left text-[color-mix(in_srgb,var(--accent-main)_45%,var(--status-danger))]",
    // 青 → 绿 = 青绿（约 168°），落在 info 的 195° 与 success 的 130° 之间
    agent: "i-lucide-message-square text-[color-mix(in_srgb,var(--status-info)_45%,var(--status-success))]",
    // 蓝 → 红（偏蓝）= 蓝紫（约 236°），正好落在「视图青 195°」与「面板紫 264°」中间的空档
    editor: "i-lucide-file-code text-[color-mix(in_srgb,var(--accent-main)_55%,var(--status-danger))]",
    // 色相环剩下的空档都在 25° 以内，挤不下第四族；这一族靠形状（面板轮廓）分，颜色与零件同档
    workbench: "i-lucide-panels-top-left text-[var(--text-secondary)]",
    part: "i-lucide-box text-[var(--text-secondary)]",
};

/**
 * 集成入口（被别的条目写成「验证入口」的那个组件）单独一个图形，取主题强调蓝。
 *
 * 它的特殊之处不在名字里：`WorkbenchShellLayout` 自己标签为空、耦合度为 0，按命名规则
 * 会兜底成 `part`，于是和一百个普通零件长成同一个方盒子。它真正的身份在关系里——
 * 容器宿主链上那几个零件都写着「验证入口: WorkbenchShellLayout」。所以这里用的是索引
 * 派生出来的 `integrationEntry`，不是一张手写名单；将来第二条宿主链出现时自动生效。
 *
 * `lab-tree-entry-icon` 由本文件样式区接管（树组件给每个图标压了七成透明，工具类压不过它的静态类）：
 * 它是全树唯一「从这里进整链」的入口，色相又和 `view` 的青色只差十几度，靠实心与更粗的描边拉开。
 */
const INTEGRATION_ICON = "i-lucide-layers lab-tree-entry-icon text-[var(--accent-main)]";

/**
 * 按目录路径建多级树：每一级目录是一个分组节点，叶子是组件本身。
 * 搜索直接在入口列表上过滤，因此没有命中的分支根本不会出现——不需要事后剪枝。
 */
function buildComponentTree(entries: typeof labComponents): LabTreeNode[] {
    const roots: LabTreeNode[] = [];
    const nodesByPath = new Map<string, LabTreeNode>();
    for (const entry of entries) {
        let level = roots;
        let path = "";
        for (const segment of entry.groupPath) {
            path = path === "" ? segment : `${path}/${segment}`;
            const id = `group:${path}`;
            let node = nodesByPath.get(id);
            if (!node) {
                // 目录行也给图标：不给的话，组名会从叶子的图标列起排，两级标题对不齐
                node = {id, title: segment, iconClass: "i-lucide-folder text-[var(--text-muted)]", children: []};
                nodesByPath.set(id, node);
                level.push(node);
            }
            level = node.children!;
        }
        level.push({
            id: entry.name,
            // canonical 名在前、显示名在后（两者相同不重复）：导航 id 与偏好键仍是 canonical 名。
            title: labComponentLabel(entry),
            // 正在加载中的组件实时反馈旋转动画；集成入口用它自己的图形；挂不上的标锁；其余按分类
            iconClass: (fixtureLoading.value && selectedName.value === entry.name)
                ? "i-lucide-loader-2 animate-spin text-[var(--accent-text)]"
                : !entry.mountable
                    ? "i-lucide-lock text-[var(--text-muted)]"
                    : (entry.integrationEntry ? INTEGRATION_ICON : KIND_ICONS[entry.kind]),
        });
    }
    const sortLevel = (nodes: LabTreeNode[]): void => {
        // 目录在前、组件在后，各自按名字排；同层混排会让「第几级」读不出来
        nodes.sort((a, b) => Number(Boolean(b.children)) - Number(Boolean(a.children)) || a.title.localeCompare(b.title));
        for (const node of nodes) {
            if (node.children) {
                sortLevel(node.children);
            }
        }
    };
    sortLevel(roots);
    return roots;
}

const treeItems = computed(() => buildComponentTree(matchedComponents.value));

// 搜索时把目录全摊开：搜出来的东西藏在一个收起的目录里，等于没搜到。
watch(treeQuery, (query) => {
    if (query.trim() !== "") {
        expandedGroups.value = [...ALL_GROUP_IDS];
    }
});

const selected = computed(() => (selectedName.value ? findLabComponent(selectedName.value) : null));
const selectedDisplayMode = computed<LabDisplayMode>(() => selected.value?.displayMode ?? "tight");

/**
 * 顶栏的补充说明：显示名与别名。
 *
 * 树的行只有一个文字位，且会被截断；「别名」这类只在检索时用得上的信息放在顶栏，
 * 搜到之后能一眼确认「就是这个部件」，又不挤占导航。
 */
const selectedDetail = computed(() => {
    const entry = selected.value;
    if (!entry) {
        return "";
    }
    const parts: string[] = [];
    if (entry.displayName !== entry.name) {
        parts.push(entry.displayName);
    }
    if (entry.aliases.length > 0) {
        parts.push(`别名：${entry.aliases.join(" / ")}`);
    }
    return parts.join("　");
});
const fixture = computed(() => (selectedName.value ? findLabFixture(selectedName.value) : null));
const scene = computed(() => fixture.value?.scenes.find((item) => item.id === selectedScene.value) ?? null);

const fixtureSlots = computed(() => fixture.value?.slots ?? []);
const inputIssues = computed(() => (subjectSignature.value === null || sceneInput.value === undefined
    ? []
    : checkLabInput(subjectSignature.value, sceneInput.value, fixtureSlots.value)));

/*
 * 场景摆在中栏工具条上，用 SegmentedControl；右栏的分区导航用 Tabs。两者不是同一件事：
 *
 *   Tabs 换的是「看哪一份内容」——下面接着一整块面板，选中项用底部指示线钉在那块面板上，
 *        条目数会变、可以带计数、放不下就横向滚。
 *   SegmentedControl 换的是「同一份内容的哪个状态」——一个自带底座的紧凑控件，
 *        选项固定等分、指示块滑动，放在工具条上和旁边的按钮同一档高度。
 *
 * 场景正是后者：画布还是那块画布，只是换一组假数据。原来它是右栏的一个 tab，
 * 于是「换场景」这个动作离它作用的画布隔着半个屏幕。
 */
// 分段控件与下拉控件共用这一份：值一律是字符串 id，因此两种控件都能直接吃。
const sceneOptions = computed<Array<{value: string; label: string}>>(() =>
    (fixture.value?.scenes ?? []).map((item) => ({value: item.id, label: item.label})));

const tabItems = computed<TabsItem[]>(() => [
    {value: "doc", label: "文档"},
    {value: "element", label: "元素"},
    {value: "events", label: "事件", count: events.value.length},
    {value: "data", label: "数据", count: inputIssues.value.length},
    {value: "commands", label: "命令"},
]);

const backdropOptions: FormSelectOption[] = labBackdrops.map((item) => ({value: item.id, label: item.label}));
const pageBackdropOptions: FormSelectOption[] = labPageBackdrops.map((item) => ({value: item.id, label: item.label}));

// ——— 自定义桌面壁纸 ———
//
// 图片不进仓库（理由见 lab-wallpaper-store.ts），由使用者当场选一张存在本机浏览器里。
// 页面上拿到的是一个 object URL，它绑在本次会话的这个 document 上，换图或离开都要撤销，
// 不撤销的话每换一张就漏一份图片大小的内存。

const wallpaperInput = ref<HTMLInputElement | null>(null);
const wallpaperUrl = ref("");

function setWallpaper(blob: Blob | null): void {
    if (wallpaperUrl.value !== "") {
        URL.revokeObjectURL(wallpaperUrl.value);
    }
    wallpaperUrl.value = blob === null ? "" : URL.createObjectURL(blob);
}

const pageBackdropStyle = computed(() => {
    if (pageBackdrop.value !== "custom" || wallpaperUrl.value === "") {
        return {};
    }
    return {
        backgroundImage: `url("${wallpaperUrl.value}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
    };
});

async function pickWallpaper(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // 选同一个文件两次也要生效，所以每次都清空 input，否则第二次不发 change
    input.value = "";
    if (!file) {
        return;
    }
    await saveLabWallpaper(file);
    setWallpaper(file);
}

async function dropWallpaper(): Promise<void> {
    await clearLabWallpaper();
    setWallpaper(null);
    pageBackdrop.value = LAB_DEFAULT_PAGE_BACKDROP;
}

// 选了「自定义图片」却一张都没有，等于选了个空档。这时直接把选择框打开，
// 而不是让人先看见一片空白再自己去找按钮。
watch(pageBackdrop, (id) => {
    if (id === "custom" && wallpaperUrl.value === "") {
        wallpaperInput.value?.click();
    }
});

// IndexedDB 与 localStorage 只在浏览器里有，读取必须等挂载之后。
let mobileQuery: MediaQueryList | null = null;

function collapseForMobile(event: MediaQueryList | MediaQueryListEvent): void {
    if (event.matches) {
        leftCollapsed.value = true;
        rightCollapsed.value = true;
    }
}

onMounted(async () => {
    setWallpaper(await loadLabWallpaper().catch(() => null));
    await restorePreferences();
    ensureSelectedComponentExpanded(selectedName.value);
    applyLabTheme(labThemeId.value, labColorwayId.value);
    syncUrlQuery(selectedName.value, selectedScene.value);
    window.addEventListener("popstate", onPopState);
    mobileQuery = window.matchMedia(`(max-width: ${LAB_MOBILE_BREAKPOINT}px)`);
    collapseForMobile(mobileQuery);
    mobileQuery.addEventListener("change", collapseForMobile);
});
onBeforeUnmount(() => {
    window.removeEventListener("popstate", onPopState);
    mobileQuery?.removeEventListener("change", collapseForMobile);
    mobileQuery = null;
});
onBeforeUnmount(() => setWallpaper(null));
const zoomOptions: FormSelectOption[] = labZooms.map((value) => ({
    value: String(value),
    label: `${Math.round(value * 100)}%`,
}));
const zoomValue = computed(() => Number(canvasZoom.value) || 1);

const presetOptions: ToggleGroupOption[] = [
    {value: "free", label: "随窗口"},
    {value: "tablet", label: "平板"},
    {value: "phone", label: "手机"},
];
const presetSizes: Record<string, [number, number]> = {
    free: [0, 0],
    tablet: [768, 1024],
    phone: [390, 844],
};
const activePreset = computed(() => {
    for (const [id, [w, h]] of Object.entries(presetSizes)) {
        if (w === canvasWidth.value && h === canvasHeight.value) {
            return id;
        }
    }
    return "";
});

// ——— 主题：nb-ui 的配色 + 主题包两条轴 ———

const labThemeId = ref<string>(LAB_DEFAULT_THEME);
const labColorwayId = ref<string>(LAB_DEFAULT_COLORWAY);

const themeOptions: FormSelectOption[] = labThemes.map((theme) => ({
    value: theme.manifest.id,
    label: theme.manifest.name,
    description: theme.manifest.tagline,
}));
const colorwayOptions = computed<FormSelectOption[]>(() =>
    Object.entries(labColorwayMeta).map(([id, meta]) => ({
        value: id,
        label: meta.label,
        description: meta.appearance === "dark" ? "深色" : "浅色",
    })));

const {
    hydrating: preferencesHydrating,
    reset: resetStoredPreferences,
    restore: restorePreferences,
    setLeftCollapsed,
    setRightCollapsed,
} = useLabPreferences({
    storage: () => window.localStorage,
    sessionStorage: () => window.sessionStorage,
    getUrlParams: () => {
        if (typeof window === "undefined") {
            return {};
        }
        const params = new URLSearchParams(window.location.search);
        return {
            component: params.get("c") ?? params.get("component") ?? undefined,
            scene: params.get("s") ?? params.get("scene") ?? undefined,
        };
    },
    catalog: {
        themeIds: labThemes.map((theme) => theme.manifest.id),
        colorwayIds: Object.keys(labColorwayMeta),
        canvasBackdropIds: labBackdrops.map((item) => item.id),
        pageBackdropIds: labPageBackdrops.map((item) => item.id),
        zooms: labZooms,
        componentNames: labComponents.map((item) => item.name),
    },
    defaults: {
        themeId: LAB_DEFAULT_THEME,
        colorwayId: LAB_DEFAULT_COLORWAY,
        pageBackdropId: LAB_DEFAULT_PAGE_BACKDROP,
        canvasBackdropId: LAB_DEFAULT_BACKDROP,
        canvasZoom: LAB_DEFAULT_ZOOM,
        leftPanelWidth: LAB_PANEL_DEFAULT_WIDTH.left,
        rightPanelWidth: LAB_PANEL_DEFAULT_WIDTH.right,
        selectedComponentName: labComponents.find((entry) => entry.mountable)?.name ?? "",
        selectedSceneId: "",
        activeInspectTab: "doc",
    },
    state: {
        themeId: labThemeId,
        colorwayId: labColorwayId,
        pageBackdropId: pageBackdrop,
        canvasBackdropId: canvasBackdrop,
        canvasZoom,
        canvasWidth,
        canvasHeight,
        leftCollapsed,
        rightCollapsed,
        preferredLeftCollapsed,
        preferredRightCollapsed,
        leftPanelWidth: leftWidth,
        rightPanelWidth: rightWidth,
        selectedComponentName: selectedName,
        selectedSceneId: selectedScene,
        activeInspectTab: rightTab,
    },
    hasCustomWallpaper: () => wallpaperUrl.value !== "",
});

function syncUrlQuery(componentName: string, sceneId: string): void {
    if (typeof window === "undefined") {
        return;
    }
    const url = new URL(window.location.href);
    if (componentName) {
        url.searchParams.set("c", componentName);
    } else {
        url.searchParams.delete("c");
    }
    url.searchParams.delete("component");

    if (sceneId) {
        url.searchParams.set("s", sceneId);
    } else {
        url.searchParams.delete("s");
    }
    url.searchParams.delete("scene");

    if (url.search !== window.location.search) {
        window.history.replaceState(window.history.state, "", url.toString());
    }
}

function onPopState(): void {
    if (typeof window === "undefined") {
        return;
    }
    const params = new URLSearchParams(window.location.search);
    const compParam = params.get("c") ?? params.get("component");
    const sceneParam = params.get("s") ?? params.get("scene");
    if (compParam && compParam !== selectedName.value && labComponents.some((c) => c.name === compParam)) {
        selectedName.value = compParam;
        ensureSelectedComponentExpanded(compParam);
    }
    if (sceneParam && sceneParam !== selectedScene.value) {
        selectedScene.value = sceneParam;
    }
}

watch([selectedName, selectedScene], ([comp, sc]) => {
    if (!preferencesHydrating.value) {
        syncUrlQuery(comp, sc);
    }
});

async function resetPreferences(): Promise<void> {
    await resetStoredPreferences(() => {
        collapseForMobile(mobileQuery ?? window.matchMedia(`(max-width: ${LAB_MOBILE_BREAKPOINT}px)`));
    });
}

/** 夹到「这一栏自己的上下限」与「画布还站得住」两者的交集里。 */
function clampPanelWidth(side: LabPanelSide, value: number): number {
    const limits = LAB_PANEL_WIDTH_LIMITS[side];
    const otherWidth = side === "left"
        ? (rightCollapsed.value ? LAB_PANEL_RAIL_WIDTH : rightWidth.value)
        : (leftCollapsed.value ? LAB_PANEL_RAIL_WIDTH : leftWidth.value);
    const viewport = typeof window === "undefined" ? 1440 : window.innerWidth;
    const max = Math.min(limits.max, Math.max(limits.min, viewport - otherWidth - LAB_CANVAS_MIN_WIDTH));
    return Math.round(Math.min(Math.max(value, limits.min), max));
}

function setPanelWidth(side: LabPanelSide, value: number): void {
    if (side === "left") {
        leftWidth.value = clampPanelWidth("left", value);
    } else {
        rightWidth.value = clampPanelWidth("right", value);
    }
}

let panelDragCleanup: (() => void) | null = null;

/**
 * 拖这条边改这一栏的宽度。指针事件挂在 window 上而不是手柄自己：
 * 快速拖动时指针会跑出手柄，靠 pointercapture 之外还要能收到 move 才跟得住。
 */
function startPanelDrag(side: LabPanelSide, event: PointerEvent): void {
    if (event.button !== 0) {
        return;
    }
    event.preventDefault();
    panelDragCleanup?.();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth.value : rightWidth.value;
    // 左栏的边向右拖是变宽，右栏的边向右拖是变窄
    const direction = side === "left" ? 1 : -1;
    const handle = event.currentTarget as HTMLElement;
    handle.dataset.dragging = "true";

    const onMove = (moveEvent: PointerEvent): void => {
        setPanelWidth(side, startWidth + (moveEvent.clientX - startX) * direction);
    };
    const onUp = (): void => {
        delete handle.dataset.dragging;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        panelDragCleanup = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    panelDragCleanup = onUp;
}

/** 方向键把这条边往按键方向推（Shift 步进 1px），与 DialogWindow 的缩放手柄同一套语义。 */
function handlePanelKey(side: LabPanelSide, event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
    }
    event.preventDefault();
    const step = (event.shiftKey ? 1 : 10) * (event.key === "ArrowRight" ? 1 : -1);
    const current = side === "left" ? leftWidth.value : rightWidth.value;
    setPanelWidth(side, current + step * (side === "left" ? 1 : -1));
}

onBeforeUnmount(() => {
    panelDragCleanup?.();
});

const currentAppearance = computed(() => labColorwayMeta[labColorwayId.value]?.appearance ?? "dark");

// 换主题时跟到这套主题自带的配色。manifest 把它叫默认值而不是约束：跟过去之后
// 用户仍可以单独换配色，两条轴独立。
watch(labThemeId, (id) => {
    if (preferencesHydrating.value) {
        return;
    }
    const preferred = labThemes.find((theme) => theme.manifest.id === id)?.manifest.defaultColorway;
    const next = preferred?.[currentAppearance.value];
    // 配色列表被裁到两套之后，主题自带的默认配色多半不在列表里，这时保持当前配色不动。
    if (next !== undefined && next !== labColorwayId.value && next in labColorwayMeta) {
        labColorwayId.value = next;
    }
});

watch([labThemeId, labColorwayId], ([theme, colorway]) => {
    applyLabTheme(theme, colorway);
});
// 主题写在 <html> 上（见 lab-theme.ts），离开 Lab 必须复原，否则产品界面跟着变
onBeforeUnmount(clearLabTheme);
// ——— 检查：一个开关，devtools 那种取色针 ———
//
// 原来是「描边」「探针」两个开关。现在只保留单一检查模式：悬停用虚线框定位，点击后
// 固定元素信息标签，但不常驻覆盖整块元素。
//
// **不自动选中任何东西。**进入页面时不替使用者决定检查目标；需要时用探针点击元素，
// `data-lab-subject` 会让面板中的主要零件成为优先定位目标。

const inspectOn = ref(false);
const picked = ref<InspectedNode | null>(null);
const hoverRect = ref<HighlightRect | null>(null);
const hoverLabel = ref("");
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const {rect: pickedRect, track: trackPicked, measure: measurePicked} = useElementRect();

const selectionLabel = computed(() => (picked.value === null ? "" : nodeLabel(picked.value)));

function handleInspectMove(event: MouseEvent): void {
    if (!inspectOn.value) {
        return;
    }
    // 覆盖层 pointer-events: none，因此 target 一定是界面里真实的元素
    const element = event.target;
    if (!(element instanceof HTMLElement)) {
        return;
    }
    const box = element.getBoundingClientRect();
    hoverRect.value = {top: box.top, left: box.left, width: box.width, height: box.height};
    hoverLabel.value = nodeLabel(describeNode(element));
}

/**
 * 取色针要在**捕获阶段**吃掉这一次点击，否则点在按钮上会顺手把按钮按了。
 * mousedown 也得挡：不少控件在 mousedown 就响应，只挡 click 拦不住。
 *
 * 「检查」按钮本身豁免。取色范围是整个 Lab（要能指着顶栏说「这条」），按钮也在范围内，
 * 不豁免的话取色期间点它等于选中了这个按钮，反而退不出来——Esc 能退，但没人会想到。
 */
function handleInspectCapture(event: MouseEvent): void {
    if (!inspectOn.value) {
        return;
    }
    const element = event.target;
    if (!(element instanceof HTMLElement)) {
        return;
    }
    if (element.closest("[data-lab-inspect-exempt]") !== null) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "click") {
        return;
    }
    picked.value = describeNode(element);
    trackPicked(element);
    rightTab.value = "element";
    // 与 devtools 一致：选中一个就退出取色，不然移开鼠标又变成别的元素
    stopInspect();
}

function stopInspect(): void {
    inspectOn.value = false;
    hoverRect.value = null;
    hoverLabel.value = "";
}

function clearPicked(): void {
    picked.value = null;
    trackPicked(null);
}

function handleInspectKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && inspectOn.value) {
        event.preventDefault();
        stopInspect();
    }
}

watch(inspectOn, (on) => {
    if (on) {
        window.addEventListener("keydown", handleInspectKeydown);
    } else {
        window.removeEventListener("keydown", handleInspectKeydown);
        hoverRect.value = null;
        hoverLabel.value = "";
    }
});
onBeforeUnmount(() => {
    window.removeEventListener("keydown", handleInspectKeydown);
    if (copiedTimer !== null) {
        clearTimeout(copiedTimer);
    }
});

async function copyPicked(): Promise<void> {
    if (picked.value === null) {
        return;
    }
    await navigator.clipboard.writeText(nodeReport(picked.value));
    copied.value = true;
    if (copiedTimer !== null) {
        clearTimeout(copiedTimer);
    }
    copiedTimer = setTimeout(() => {
        copied.value = false;
    }, 1600);
}

// ——— 场景 ———

// reka 的单选组再次点击当前项会把值清空，画布必须始终有一个尺寸档，因此挡住空值。
// nb-ui 声明的类型是 string | string[]，但运行时确实会给 undefined，两处都要挡。
function applyPreset(value: string | string[]): void {
    const size = typeof value === "string" ? presetSizes[value] : undefined;
    if (!size) {
        return;
    }
    [canvasWidth.value, canvasHeight.value] = size;
}

function selectComponent(id: string): void {
    if (id.startsWith("group:")) {
        return;
    }
    selectedName.value = id;
    ensureSelectedComponentExpanded(id);
}

function recordEvent(name: string, payload?: unknown): void {
    eventCounter += 1;
    // 裁剪在写入这一侧做：EventLogPanel 不替使用方丢数据。
    events.value = [
        {id: `ev-${eventCounter}`, name, at: new Date(), payload},
        ...events.value,
    ].slice(0, EVENT_LIMIT);
}

provide(LAB_EVENT_SINK, recordEvent);
/**
 * 面板只存能 JSON 化的快照：组件发出的值可能是响应式代理，或挂着函数。
 * 克隆失败时退回字符串，面板照样能显示，也不把活对象的引用留在 Lab 手里。
 */
function snapshot(value: unknown): unknown {
    try {
        return structuredClone(toRaw(value));
    } catch {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return String(value);
        }
    }
}

provide(LAB_DATA_SINK, (value: unknown) => {
    fixtureState.value = snapshot(value);
});
// 整份替换而不是就地改：fixture 通过 props 拿到输入，换引用它的 computed 才会重算
provide(LAB_INPUT_SINK, (layer, key, value) => {
    sceneInput.value = {...sceneInput.value, [layer]: {...sceneInput.value?.[layer], [key]: snapshot(value)}};
});

/** 数据面板改某一层：整份输入过 schema 才生效，不合法时保持原值并说明原因。 */
function editInputLayer(layer: "props" | "model", value: unknown): void {
    const next = {...sceneInput.value, [layer]: value};
    if (!Value.Check(LabSceneInputSchema, next)) {
        inputEditError.value = `${layer} 层必须是 JSON 对象，这次编辑没有生效`;
        return;
    }
    inputEditError.value = "";
    sceneInput.value = next;
}

function setSlotPreset(name: string, on: boolean): void {
    sceneInput.value = {...sceneInput.value, slots: {...sceneInput.value?.slots, [name]: on}};
}

let signatureToken = 0;
// 签名读自被测组件本身。加载失败不在这里报：fixture import 的是同一个模块，中栏会给出加载错误
watch(selectedName, async (name) => {
    const token = ++signatureToken;
    subjectSignature.value = null;
    const component = name === "" ? null : await loadLabSubject(name).catch(() => null);
    if (token === signatureToken) {
        subjectSignature.value = component === null ? null : readLabSignature(component);
    }
}, {immediate: true});

const hasFixtureControls = ref(false);
const bottomPanelCollapsed = ref(false);

provide(LAB_CONTROLS_REGISTER, (active: boolean) => {
    hasFixtureControls.value = active;
});

// ——— 命令宿主 ———
//
// Lab 是全局 S4 面板、键位与确认闸门的唯一挂载点：这里建立注册表、上下文键与键位分发，
// 业务命令由各域（编辑器样板、面板入口）自己注册。执行记录只留内存，不写 Lab 偏好；
// 失败在下面唯一的 role=alert 区域显示一次，宿主本身不弹 Toast。
const {t} = useI18n();

const workbenchCommands = provideWorkbenchCommands({
    development: import.meta.dev,
    report: (error) => recordEvent("command-error", error.message),
    confirm: requestConfirmation,
});

/** 面板与命令 tab 共用的 i18n 解析；带 params 以支持「跳转到第 N 行」这类参数化文案。 */
function titleOf(key: string, params?: Record<string, unknown>): string {
    return params === undefined ? t(key) : t(key, params);
}

const COMMAND_LOG_LIMIT = EVENT_LIMIT;

type CommandLogEntry = Readonly<{
    seq: number;
    requestedId: string;
    id: string;
    invocation: CommandInvocation;
    args: unknown;
    result: CommandResult<unknown>;
    durationMs: number;
}>;

const commandLog = ref<CommandLogEntry[]>([]);
const commandError = ref("");
let commandLogSeq = 0;

const releaseCommandAudit = workbenchCommands.registry.onDidExecuteCommand((event) => {
    commandLogSeq += 1;
    commandLog.value = [{seq: commandLogSeq, ...event}, ...commandLog.value].slice(0, COMMAND_LOG_LIMIT);
    if (!event.result.ok) {
        commandError.value = `${event.id}：${event.result.reason}`;
    }
});

/**
 * 两条面板入口命令：open-commands 是 S4 的键盘/按钮入口（human=false 不在候选里），
 * open-line 只在有行导航能力时可用。注册失败不留半截注册表。
 */
function registerPaletteCommands(): Release | null {
    const noArguments = Type.Object({}, {additionalProperties: false});
    const descriptors: CommandDescriptor<TSchema, null>[] = [
        {
            id: "nbook.quick-open.open-commands",
            titleKey: "workbenchCommands.openCommands",
            description: "Open the command palette.",
            argsSchema: noArguments,
            effect: "read",
            defaultKeybinding: "Mod+Shift+P",
            expose: {human: false, agent: "never"},
            run: () => {
                workbenchCommands.openPalette("commands");
                return {ok: true, value: null};
            },
        },
        {
            id: "nbook.quick-open.open-line",
            titleKey: "workbenchCommands.openLine",
            description: "Switch the open command palette to line navigation.",
            argsSchema: noArguments,
            effect: "read",
            when: {requires: ["editor-line-navigation"]},
            expose: {human: true, agent: "never"},
            run: () => {
                workbenchCommands.openPalette("line");
                return {ok: true, value: null};
            },
        },
    ];

    const registered: Release[] = [];
    for (const descriptor of descriptors) {
        const result = workbenchCommands.registry.registerCommand(descriptor);
        if (!result.ok) {
            commandError.value = `面板命令注册失败：${descriptor.id}：${result.reason}`;
            for (const release of registered) {
                release();
            }
            return null;
        }
        registered.push(result.value);
    }
    return () => {
        for (const release of registered.splice(0)) {
            release();
        }
    };
}

const releasePaletteCommands = registerPaletteCommands();

/** 面板打开时到达的确认请求要等它真正关闭再显示；这个队列在面板关闭或宿主卸载时清空。 */
const paletteCloseWaiters: (() => void)[] = [];
watch(workbenchCommands.palette.open, (open) => {
    if (open) {
        return;
    }
    for (const notify of paletteCloseWaiters.splice(0)) {
        notify();
    }
}, {flush: "sync"});

type PendingConfirmation = {
    request: CommandConfirmationRequest;
    decision: "pending" | "approved" | "denied";
    resolve: (approved: boolean) => void;
};

const confirmationVisible = ref(false);
const pendingConfirmation = shallowRef<PendingConfirmation | null>(null);

function waitForPaletteClosed(): Promise<void> {
    if (!workbenchCommands.palette.open.value) {
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => paletteCloseWaiters.push(resolve));
}

/** 确认闸门：从收到请求到 AlertDialog 的 closed 结算前一直非 null。 */
function requestConfirmation(request: CommandConfirmationRequest): Promise<boolean> {
    if (pendingConfirmation.value !== null) {
        return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
        const pending: PendingConfirmation = {request, decision: "pending", resolve};
        pendingConfirmation.value = pending;
        void (async () => {
            await waitForPaletteClosed();
            if (pendingConfirmation.value === pending) {
                confirmationVisible.value = true;
            }
        })();
    });
}

function settleConfirmation(approved: boolean): void {
    const pending = pendingConfirmation.value;
    if (pending === null || pending.decision !== "pending") {
        return;
    }
    pending.decision = approved ? "approved" : "denied";
    confirmationVisible.value = false;
}

/**
 * Reka 的 Action 会先触发我们的 confirm 再发 update:open(false)。把「关闭即拒绝」推迟一个
 * 微任务，显式批准才不会被同一次点击的关闭事件覆盖成拒绝。
 */
function onConfirmationOpenChange(open: boolean): void {
    if (open) {
        return;
    }
    queueMicrotask(() => settleConfirmation(false));
}

function onConfirmationClosed(): void {
    const pending = pendingConfirmation.value;
    if (pending === null) {
        return;
    }
    pendingConfirmation.value = null;
    pending.resolve(pending.decision === "approved");
}

const confirmationTitle = computed(() => pendingConfirmation.value === null
    ? ""
    : titleOf(pendingConfirmation.value.request.command.titleKey));
const confirmationArgs = computed(() => pendingConfirmation.value === null
    ? ""
    : JSON.stringify(pendingConfirmation.value.request.args));
const confirmationDestructive = computed(() =>
    pendingConfirmation.value?.request.command.expose?.hints?.destructive === true);

let keymapDispatcher: {handle: (event: KeyboardEvent) => void; dispose: () => void} | null = null;

function handleWorkbenchKeydown(event: KeyboardEvent): void {
    // 确认界面开着时不派发面板键：既不打开新面板，也不制造失败审计
    if (pendingConfirmation.value !== null) {
        return;
    }
    keymapDispatcher?.handle(event);
}

/** 快捷键的平台口径：macOS 上 Mod 是 Meta，其它平台是 Ctrl。 */
function isMacPlatform(): boolean {
    if (typeof navigator === "undefined") {
        return false;
    }
    return /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent);
}

onMounted(() => {
    keymapDispatcher = createKeymapDispatcher(
        workbenchCommands.registry,
        isMacPlatform() ? "mac" : "other",
        (error) => recordEvent("command-error", error.message),
    );
    window.addEventListener("keydown", handleWorkbenchKeydown, true);
});
onBeforeUnmount(() => {
    window.removeEventListener("keydown", handleWorkbenchKeydown, true);
    keymapDispatcher?.dispose();
    keymapDispatcher = null;
    releaseCommandAudit();
    releasePaletteCommands?.();
    for (const notify of paletteCloseWaiters.splice(0)) {
        notify();
    }
    const pending = pendingConfirmation.value;
    pendingConfirmation.value = null;
    // 卸载同时结算未决确认：registry 里等待的调用不能永远挂着
    pending?.resolve(false);
});

// 换组件/换场景先收起面板、清掉活动编辑器：旧 identity 的命令注册由 fixture 自己释放，
// 面板里未执行的选择也会因目标不再匹配而作废。
watch([selectedName, selectedScene], () => {
    workbenchCommands.closePalette();
    workbenchCommands.activeEditor.value = null;
});

watch(selectedName, () => {
    // 切换组件时将视口重置回自适应（free），避免上一组件的自定义拖拽尺寸残留影响新组件判读
    canvasWidth.value = 0;
    canvasHeight.value = 0;
});

type CommandRow = Readonly<{
    command: CommandMetadata;
    title: string;
    whenText: string;
    exposeText: string;
}>;

/** 命令 tab 只读展示：metadata + 共享 when 求值 + 有效 expose。这里不执行命令、不改 context。 */
const commandRows = computed<readonly CommandRow[]>(() => {
    void workbenchCommands.revision.value;
    return workbenchCommands.registry.getAllCommands().map((command) => {
        const requires = command.when?.requires ?? [];
        const evaluation = evaluateContextWhen(command.when, workbenchCommands.context.value);
        const verdict = evaluation.ok
            ? (evaluation.value.matches ? "满足" : `缺少：${evaluation.value.reasons.join("；")}`)
            : `求值失败：${evaluation.reason}`;
        return {
            command,
            title: titleOf(command.titleKey),
            whenText: requires.length === 0 ? "无 requires" : `${requires.join("、")} → ${verdict}`,
            exposeText: exposeTextOf(command),
        };
    });
});

/** 按 id 的 domain 段分组；分组顺序＝首次出现的注册顺序。 */
const commandGroups = computed(() => {
    const groups = new Map<string, CommandRow[]>();
    for (const row of commandRows.value) {
        const domain = row.command.id.split(".")[1] ?? row.command.id;
        const bucket = groups.get(domain);
        if (bucket) {
            bucket.push(row);
        } else {
            groups.set(domain, [row]);
        }
    }
    return [...groups].map(([domain, rows]) => ({domain, rows}));
});

function exposeTextOf(command: CommandMetadata): string {
    const hints = command.expose?.hints;
    const flags = hints === undefined
        ? []
        : [
            hints.readOnly === true ? "readOnly" : "",
            hints.destructive === true ? "destructive" : "",
            hints.idempotent === true ? "idempotent" : "",
        ].filter((flag) => flag !== "");
    return [
        `human=${command.expose?.human === false ? "false" : "true"}`,
        `agent=${effectiveAgentExposure(command.expose)}`,
        ...flags,
    ].join(" · ");
}

function resetScene(): void {
    sceneData.value = structuredClone(scene.value?.data);
    sceneInput.value = structuredClone(scene.value?.input);
    fixtureState.value = undefined;
    inputEditError.value = "";
    events.value = [];
}

watch(fixture, async (next) => {
    const token = ++fixtureLoadToken;
    fixtureLoadError.value = "";
    if (!next) {
        fixtureComponent.value = null;
        fixtureLoading.value = false;
        selectedScene.value = "";
        return;
    }

    // 保留已选中的合法场景（例如从 storage 恢复或组件自有的有效场景），否则重置为该场景组首项
    if (!selectedScene.value || !next.scenes.some((s) => s.id === selectedScene.value)) {
        selectedScene.value = next.scenes[0]?.id ?? "";
    }

    fixtureLoading.value = true;
    try {
        const component = await next.load();
        // 组件切得快时先发的 loader 可能后到：只有仍是当前这次选择才允许写入。
        if (token !== fixtureLoadToken) {
            return;
        }
        fixtureComponent.value = component;
    } catch (error) {
        if (token !== fixtureLoadToken) {
            return;
        }
        fixtureLoadError.value = error instanceof Error ? error.message : String(error);
    } finally {
        if (token === fixtureLoadToken) {
            fixtureLoading.value = false;
        }
    }
}, {immediate: true});

watch([selectedScene, fixture], ([id, currentFixture]) => {
    if (currentFixture && !currentFixture.scenes.some((item) => item.id === id)) {
        selectedScene.value = currentFixture.scenes[0]?.id ?? "";
        return;
    }
    resetScene();
    hasFixtureControls.value = false;
}, {immediate: true});

// 挂上新 fixture 或换场景后是另一批 DOM 节点，之前选中的那个已经不在了
watch([fixtureComponent, selectedScene], () => {
    clearPicked();
});
// 改假数据不换节点，但选中的元素可能被推走或改大小，ResizeObserver 看不见位移
watch([sceneData, sceneInput, canvasWidth, canvasHeight], () => {
    void nextTick(measurePicked);
}, {deep: true});
</script>

<template>
    <!-- 主题轴管形状与节奏，配色轴管颜色。Lab 自己的界面必须真的消费主题 token，
         否则换主题只有 nb-ui 组件在动，看起来像切换没生效。 -->
    <div
        class="lab-root flex h-full min-h-0 flex-col"
        :class="[inspectOn ? 'lab-root--inspecting' : '', `lab-root--bg-${pageBackdrop}`]"
        :style="pageBackdropStyle"
        @mousemove="handleInspectMove"
        @click.capture="handleInspectCapture"
        @mousedown.capture="handleInspectCapture"
    >
        <!-- 顶栏每一项都写 shrink-0：这是一条全宽 flex 行，只要有一项不肯收缩，
             其余项就会被压到 min-content，而中文可以逐字换行，会直接压成竖排。 -->
        <header class="lab-bar flex shrink-0 flex-wrap items-center">
            <div class="lab-bar__lead flex min-w-0 flex-1 items-center gap-[var(--space-5)]">
                <span class="lab-title min-w-0 truncate">组件 Lab</span>
                <span class="lab-bar__count lab-note shrink-0">{{ labComponents.length }} 个组件</span>
            </div>
            <!--
                整页的四个旋钮：主题、配色、桌面、恢复默认。它们与下面的画布旋钮一样不可替代，
                所以同样 shrink-0；空间不够时先藏左边的计数、再收窄这三个下拉（见样式里的容器查询）。
            -->
            <div class="lab-bar__controls flex min-w-0 flex-wrap items-center gap-[var(--space-5)]">
                <NbFormSelect
                    v-model="labThemeId"
                    :options="themeOptions"
                    size="sm"
                    class="lab-bar__theme shrink-0"
                    aria-label="主题"
                />
                <NbFormSelect
                    v-model="labColorwayId"
                    :options="colorwayOptions"
                    size="sm"
                    class="lab-bar__colorway shrink-0"
                    aria-label="配色"
                />
                <!-- 桌面与画布底是两层不同的东西，别合成一个控件：这个改的是整页最底下那一层，
                     中栏工具条上的「画布底」改的是被测组件背后那一层。取值都在 stage-backdrops.ts。 -->
                <NbFormSelect
                    v-model="pageBackdrop"
                    :options="pageBackdropOptions"
                    size="sm"
                    class="lab-bar__backdrop shrink-0"
                    aria-label="桌面"
                />
                <!-- 壁纸只在选了「自定义图片」时才有得换。文件选择框自己不显示，
                     由旁边的按钮或上面那个 watch 触发。 -->
                <input
                    ref="wallpaperInput"
                    type="file"
                    accept="image/*"
                    class="hidden"
                    @change="pickWallpaper"
                />
                <template v-if="pageBackdrop === 'custom'">
                    <button type="button" class="lab-btn shrink-0" @click="wallpaperInput?.click()">
                        {{ wallpaperUrl ? "换图片" : "选图片" }}
                    </button>
                    <button v-if="wallpaperUrl" type="button" class="lab-btn shrink-0" @click="dropWallpaper">
                        清除
                    </button>
                </template>
                <button
                    type="button"
                    class="lab-btn lab-btn--icon shrink-0"
                    aria-label="恢复 Lab 默认配置"
                    title="恢复 Lab 默认配置"
                    @click="resetPreferences"
                >
                    <span class="i-lucide-rotate-ccw h-3.5 w-3.5" aria-hidden="true"></span>
                </button>
            </div>
        </header>

        <div class="lab-columns flex min-h-0 flex-1">
            <CollapsibleSidePanel
                :collapsed="leftCollapsed"
                title="组件"
                side="left"
                class="lab-panel shrink-0"
                :style="leftCollapsed ? undefined : {width: `${leftWidth}px`, flex: `0 0 ${leftWidth}px`}"
                @update:collapsed="setLeftCollapsed"
            >
                <template #search>
                    <NbFormInput
                        v-model="treeQuery"
                        size="sm"
                        type="search"
                        placeholder="搜组件名或部件名称"
                        icon-class="i-lucide-search"
                        clearable
                        aria-label="搜组件名或部件名称"
                        class="w-full"
                    />
                </template>

                <template #actions>
                    <span class="lab-note shrink-0 tabular-nums">
                        {{ matchedComponents.length }} / {{ labComponents.length }}
                    </span>
                </template>

                <!-- 侧栏本身就是那块面，树在里面是裸列表。用默认的 card 会得到
                     「一张卡片浮在侧栏里」：卡片自带的面色、描边与阴影和侧栏的重复一遍。 -->
                <NbTree
                    v-model:expanded="expandedGroups"
                    :items="treeItems"
                    :model-value="selectedName"
                    surface="plain"
                    @select="selectComponent($event.id)"
                />
                <p v-if="matchedComponents.length === 0" class="lab-search-empty lab-note">
                    没有名字含「{{ treeQuery }}」的组件：可以按组件名、中文部件名或别名搜
                </p>
            </CollapsibleSidePanel>

            <!-- 拖这条边改左栏宽度；方向键把边往按键方向推（Shift 1px）。 -->
            <div
                class="lab-split-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="调整组件栏宽度"
                :aria-valuenow="leftWidth"
                :aria-valuemin="LAB_PANEL_WIDTH_LIMITS.left.min"
                :aria-valuemax="LAB_PANEL_WIDTH_LIMITS.left.max"
                :tabindex="leftCollapsed ? -1 : 0"
                @pointerdown="startPanelDrag('left', $event)"
                @keydown="handlePanelKey('left', $event)"
            ></div>

            <main class="lab-main flex min-w-0 flex-1 flex-col">
                <div class="lab-bar lab-bar--tight flex shrink-0 flex-wrap items-center">
                    <!-- 左半边都是「当前在哪儿」：窄的时候先让它们截断，右边的旋钮一个都不许消失。 -->
                    <div class="lab-bar__lead flex min-w-0 flex-1 items-center gap-[var(--space-4)]">
                        <span class="lab-title min-w-0 truncate" :title="selected?.name">{{ selected?.name ?? "未选择" }}</span>
                        <span v-if="selectedDetail" class="lab-bar__detail lab-note min-w-0 truncate" :title="selectedDetail">{{ selectedDetail }}</span>
                        <label v-if="sceneOptions.length > 4" class="lab-field shrink-0">
                            <span class="lab-bar__label lab-note">场景</span>
                            <NbFormSelect
                                v-model="selectedScene"
                                :options="sceneOptions"
                                size="sm"
                                dropdown-direction="down"
                                hide-checkmark
                                class="lab-bar__scene"
                                aria-label="场景"
                            />
                        </label>
                        <NbSegmentedControl
                            v-else-if="sceneOptions.length > 1"
                            v-model="selectedScene"
                            :options="sceneOptions"
                            size="xs"
                            aria-label="场景"
                            class="shrink-0"
                        />
                        <span v-else-if="scene" class="lab-note shrink-0 truncate">{{ scene.label }}</span>
                    </div>
                    <!--
                        两条栏的分工：顶栏放改**整页**的（主题、配色、桌面），这一条放只改
                        **画布里**的（宽度、画布底、缩放）。视口预设原来在顶栏，可它只改画布，
                        于是看组件的四个旋钮分居两条栏，找一个要跳两个地方。

                        ToggleGroup 自带边框与内衬底，外面不能再套 Toolbar：那是第二层容器，
                        而一个只装一件东西的工具栏也不是工具栏。

                        这几个是这条栏上唯一不可替代的东西，所以它们 shrink-0；空间不够时先牺牲
                        左边的名字与别名、再收窄场景下拉（见样式里的容器查询），它们不参与让位。
                    -->
                    <div class="lab-bar__controls flex min-w-0 flex-wrap items-center gap-2">
                        <NbToggleGroup
                            size="sm"
                            :options="presetOptions"
                            :model-value="activePreset"
                            aria-label="画布宽度"
                            class="shrink-0"
                            @update:model-value="applyPreset"
                        />
                        <label class="lab-field shrink-0">
                            <span class="lab-bar__label lab-note">画布底</span>
                            <NbFormSelect
                                v-model="canvasBackdrop"
                                :options="backdropOptions"
                                size="sm"
                                dropdown-direction="down"
                                hide-checkmark
                                class="w-[96px]"
                                aria-label="画布底"
                            />
                        </label>
                        <label class="lab-field shrink-0">
                            <span class="lab-bar__label lab-note">缩放</span>
                            <NbFormSelect
                                v-model="canvasZoom"
                                :options="zoomOptions"
                                size="sm"
                                dropdown-direction="down"
                                hide-checkmark
                                class="w-[72px]"
                                aria-label="画布缩放"
                            />
                        </label>
                        <button
                            type="button"
                            class="lab-btn lab-btn--icon shrink-0"
                            :class="inspectOn ? 'lab-btn--on' : ''"
                            :aria-pressed="inspectOn"
                            data-lab-inspect-exempt
                            title="检查元素：点一下页面上任意位置，信息落到右边的「元素」（Esc 取消）"
                            @click="inspectOn = !inspectOn"
                        >
                            <span class="i-lucide-mouse-pointer-square-dashed h-3.5 w-3.5" aria-hidden="true"></span>
                            检查
                        </button>
                    </div>
                </div>

                <!-- 命令失败只有这一处可见出口：reason 原样显示，并可手动清掉 -->
                <div v-if="commandError !== ''" role="alert" class="lab-strip shrink-0 text-[11px]">
                    <span class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0 text-[var(--status-danger)]" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1 truncate" :title="commandError">{{ commandError }}</span>
                    <button type="button" class="lab-btn shrink-0" @click="commandError = ''">关闭</button>
                </div>

                <div class="relative min-h-0 flex-1 overflow-hidden">
                    <!-- 切换组件加载遮罩与动画 -->
                    <div
                        v-if="fixtureLoading"
                        class="lab-fixture-loading absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[var(--lab-surface)]/75 backdrop-blur-xs select-none transition-opacity duration-150"
                    >
                        <div class="flex items-center gap-2.5 rounded-full border border-[var(--divider)] bg-[var(--bg-panel)] px-4 py-2 shadow-md">
                            <span class="i-lucide-loader-2 h-4 w-4 animate-spin text-[var(--accent-main)]" aria-hidden="true" />
                            <span class="text-xs font-medium text-[var(--text-main)]">
                                正在载入 {{ selected?.name }} 场景...
                            </span>
                        </div>
                    </div>

                    <div v-if="!selected" class="lab-empty">左边选一个组件</div>
                    <div v-else-if="!selected.mountable" class="lab-empty lab-empty--stack">
                        <span class="i-lucide-lock h-6 w-6 text-[var(--text-muted)]"></span>
                        <p class="lab-title">{{ selected.name }} 不能在 Lab 里验证</p>
                        <p class="lab-note max-w-md">{{ selected.blockedReason }}</p>
                        <!-- 零件自己没有可挂载的状态，但它在宿主链上真的渲染着：给一条直达宿主的路径。 -->
                        <button
                            v-if="selected.verifyEntry"
                            type="button"
                            class="lab-btn"
                            @click="selectComponent(selected.verifyEntry)"
                        >
                            打开入口：{{ selected.verifyEntry }}
                        </button>
                    </div>
                    <div v-else-if="!fixture" class="lab-empty lab-empty--stack">
                        <p class="lab-title">{{ selected.name }} 还没有场景</p>
                        <p class="lab-note">它可以挂载，但还没有人为它写 fixture。</p>
                    </div>
                    <div v-else-if="fixtureLoadError" class="lab-empty lab-empty--stack">
                        <span class="i-lucide-triangle-alert h-6 w-6 text-[var(--status-danger)]" aria-hidden="true"></span>
                        <p class="lab-title">{{ selected.name }} 的场景加载失败</p>
                        <p class="lab-note max-w-md">{{ fixtureLoadError }}</p>
                    </div>
                    <ViewportCanvas
                        v-else
                        v-model:width="canvasWidth"
                        v-model:height="canvasHeight"
                        :zoom="zoomValue"
                        :backdrop="canvasBackdrop"
                        :display-mode="selectedDisplayMode"
                    >
                        <Transition name="lab-stage-fade" mode="out-in">
                            <div :key="`${selectedName}:${selectedScene}`" :class="(selectedDisplayMode === 'tight' && canvasHeight <= 0) ? 'w-full' : 'h-full w-full'">
                                <component
                                    :is="fixtureComponent"
                                    v-if="fixtureComponent"
                                    :scene="selectedScene"
                                    :data="sceneData"
                                    :input="sceneInput"
                                />
                            </div>
                        </Transition>
                    </ViewportCanvas>
                </div>

                <!-- 底部场景调试交互面板（仅在 Fixture 声明控制实体时可见） -->
                <div
                    v-show="hasFixtureControls"
                    class="lab-bottom-panel flex shrink-0 flex-col border-t border-[var(--divider)] bg-[var(--lab-surface)] backdrop-blur-[var(--lab-surface-blur)] select-none"
                >
                    <!-- 交互控制面板顶栏：支持点击整行折叠/展开，高亮当前场景名与状态 -->
                    <div
                        class="flex h-9 shrink-0 items-center justify-between px-3 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)]/60 cursor-pointer select-none"
                        :class="bottomPanelCollapsed ? '' : 'border-b border-[var(--divider)]'"
                        role="button"
                        :aria-expanded="!bottomPanelCollapsed"
                        tabindex="0"
                        :title="bottomPanelCollapsed ? '展开场景交互控制面板' : '收起场景交互控制面板'"
                        @click="bottomPanelCollapsed = !bottomPanelCollapsed"
                        @keydown.enter.self="bottomPanelCollapsed = !bottomPanelCollapsed"
                        @keydown.space.prevent.self="bottomPanelCollapsed = !bottomPanelCollapsed"
                    >
                        <div class="flex items-center gap-2 min-w-0">
                            <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--accent-bg)]/50 text-[var(--accent-text)] border border-[var(--accent-border)]/30">
                                <span class="i-lucide-sliders-horizontal h-3 w-3" aria-hidden="true" />
                            </span>
                            <span class="font-medium text-[var(--text-main)] shrink-0">场景交互控制</span>
                            <span
                                v-if="scene?.label"
                                class="truncate text-[11px] font-normal text-[var(--text-secondary)] hidden sm:inline"
                            >
                                · {{ scene.label }}
                            </span>
                            <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] border border-[var(--border-color)] shrink-0">
                                {{ selectedScene }}
                            </span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="text-[10px] text-[var(--text-muted)] hidden md:inline">
                                {{ bottomPanelCollapsed ? '已折叠' : '调试控件' }}
                            </span>
                            <button
                                type="button"
                                class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-main)] px-2 text-[11px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] cursor-pointer"
                                :title="bottomPanelCollapsed ? '展开控制面板' : '收起控制面板'"
                                @click.stop="bottomPanelCollapsed = !bottomPanelCollapsed"
                            >
                                <span
                                    class="h-3.5 w-3.5 transition-transform duration-200"
                                    :class="bottomPanelCollapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                                    aria-hidden="true"
                                />
                                <span>{{ bottomPanelCollapsed ? '展开' : '收起' }}</span>
                            </button>
                        </div>
                    </div>

                    <div
                        v-show="!bottomPanelCollapsed"
                        id="lab-fixture-controls-target"
                        class="min-h-0 max-h-48 overflow-auto px-4 py-2 text-xs"
                    >
                        <!-- Fixture 的 LabFixtureControls 将 Teleport 到此处 -->
                    </div>
                </div>
            </main>

            <!-- 右栏装的是文档正文与数据，是内容层不是导航层：见 CollapsibleSidePanel 里
                 layer 那一段。它也是全屏唯一那块暖面，nbook 的冷暖对比靠它成立。

                 比左栏宽：它和左栏是同一个零件、同样的圆角和头，光靠材质不同区分不开，
                 读起来会是「两个一样的盒子，其中一个忘了透光」。分工要由形状一起说——
                 宽度加一档、正文换宋体阅读刻度（见 MarkdownView），才读得出一边是索引、
                 一边是要坐下来读的东西。 -->
            <!-- 画布与右栏之间同样有一条边：两栏都能拖，只有一侧能拖会让人以为另一侧坏了。 -->
            <div
                class="lab-split-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="调整检视栏宽度"
                :aria-valuenow="rightWidth"
                :aria-valuemin="LAB_PANEL_WIDTH_LIMITS.right.min"
                :aria-valuemax="LAB_PANEL_WIDTH_LIMITS.right.max"
                :tabindex="rightCollapsed ? -1 : 0"
                @pointerdown="startPanelDrag('right', $event)"
                @keydown="handlePanelKey('right', $event)"
            ></div>

            <CollapsibleSidePanel
                :collapsed="rightCollapsed"
                title="检视"
                side="right"
                layer="content"
                class="lab-panel shrink-0"
                :style="rightCollapsed ? undefined : {width: `${rightWidth}px`, flex: `0 0 ${rightWidth}px`}"
                @update:collapsed="setRightCollapsed"
            >
                <div class="flex h-full min-h-0 flex-col">
                    <div class="lab-tabs shrink-0">
                        <NbTabs v-model="rightTab" :items="tabItems" size="sm" aria-label="检视面板" />
                    </div>

                    <div class="min-h-0 flex-1 overflow-y-auto">
                        <div v-if="rightTab === 'element'" class="lab-pad" data-lab-panel="element">
                            <template v-if="picked">
                                <dl class="lab-meta lab-meta--flush">
                                    <div v-if="picked.componentName" class="lab-meta-row">
                                        <dt class="lab-meta-key">组件</dt>
                                        <dd class="min-w-0 break-words">{{ picked.componentName }}</dd>
                                    </div>
                                    <div v-if="picked.hostComponentName && picked.hostComponentName !== picked.componentName" class="lab-meta-row">
                                        <dt class="lab-meta-key">所属宿主</dt>
                                        <dd class="min-w-0 break-words">{{ picked.hostComponentName }}</dd>
                                    </div>
                                    <div v-if="picked.hostComponentFile && picked.hostComponentFile !== picked.componentFile" class="lab-meta-row">
                                        <dt class="lab-meta-key">宿主文件</dt>
                                        <dd class="min-w-0 break-all font-mono">{{ picked.hostComponentFile }}</dd>
                                    </div>
                                    <div v-if="picked.componentFile" class="lab-meta-row">
                                        <dt class="lab-meta-key">源文件</dt>
                                        <dd class="min-w-0 break-all font-mono">{{ picked.componentFile }}</dd>
                                    </div>
                                    <div class="lab-meta-row">
                                        <dt class="lab-meta-key">选择器</dt>
                                        <dd class="min-w-0 break-all font-mono">{{ picked.selector }}</dd>
                                    </div>
                                    <div v-if="picked.text" class="lab-meta-row">
                                        <dt class="lab-meta-key">文本</dt>
                                        <dd class="min-w-0 break-words font-mono text-[11px]">{{ picked.text }}</dd>
                                    </div>
                                    <div v-if="picked.snippet" class="lab-meta-row">
                                        <dt class="lab-meta-key">标签</dt>
                                        <dd class="min-w-0 break-all font-mono text-[11px] text-[var(--accent-text)]">{{ picked.snippet }}</dd>
                                    </div>
                                    <div class="lab-meta-row">
                                        <dt class="lab-meta-key">尺寸</dt>
                                        <dd class="tabular-nums">{{ picked.width }} × {{ picked.height }}</dd>
                                    </div>
                                    <div v-if="picked.isSubject" class="lab-meta-row">
                                        <dt class="lab-meta-key">标记</dt>
                                        <dd>fixture 标出的零件本体</dd>
                                    </div>
                                </dl>

                                <p class="lab-panel-label">类名 {{ picked.classes.length }}</p>
                                <div class="lab-tags">
                                    <span v-if="picked.classes.length === 0" class="lab-note">无</span>
                                    <code
                                        v-for="name in picked.classes.slice(0, INSPECT_CLASS_LIMIT)"
                                        :key="name"
                                        class="lab-chip"
                                    >{{ name }}</code>
                                    <span v-if="picked.classes.length > INSPECT_CLASS_LIMIT" class="lab-note">
                                        还有 {{ picked.classes.length - INSPECT_CLASS_LIMIT }} 个（复制里是全的）
                                    </span>
                                </div>

                                <div class="lab-row">
                                    <button type="button" class="lab-btn lab-btn--icon" @click="copyPicked">
                                        <span
                                            class="h-3.5 w-3.5"
                                            :class="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                                            aria-hidden="true"
                                        ></span>
                                        {{ copied ? "已复制" : "复制" }}
                                    </button>
                                    <button type="button" class="lab-btn" @click="clearPicked">取消选中</button>
                                </div>
                            </template>
                            <p v-else class="lab-note">
                                点上面的「检查」，再点界面上任意位置——组件、源文件与选择器会落在这里，可以复制。
                            </p>
                        </div>

                        <div v-else-if="rightTab === 'doc'" class="lab-pad" data-lab-panel="doc">
                            <template v-if="selected">
                                <!-- 能力标签与能不能挂都是文档 frontmatter 派生的，
                                     放在文档正文上方而不是单开一个 tab。 -->
                                <dl class="lab-meta">
                                    <div class="lab-meta-row">
                                        <dt class="lab-meta-key">目录</dt>
                                        <dd>{{ selected.group }}</dd>
                                    </div>
                                    <div class="lab-meta-row">
                                        <dt class="lab-meta-key">能力标签</dt>
                                        <dd class="lab-tags">
                                            <span v-if="selected.tags.length === 0">无</span>
                                            <code v-for="tag in selected.tags" :key="tag" class="lab-chip">{{ tag }}</code>
                                        </dd>
                                    </div>
                                    <div class="lab-meta-row">
                                        <dt class="lab-meta-key">确定性验证</dt>
                                        <dd>
                                            {{ selected.mountable
                                                ? (selected.needsSnapshot ? "需预置状态快照" : "可以")
                                                : (selected.verifyEntry ? `在 ${selected.verifyEntry} 的集成场景里` : "只能在正式界面") }}
                                        </dd>
                                    </div>
                                </dl>
                                <MarkdownView :source="selected.doc" />
                            </template>
                        </div>

                        <div v-else-if="rightTab === 'events'" class="flex h-full flex-col" data-lab-panel="events">
                            <div class="lab-strip shrink-0">
                                <span class="lab-note">最多留最近 {{ EVENT_LIMIT }} 条</span>
                                <button type="button" class="lab-btn" @click="events = []">清空</button>
                            </div>
                            <EventLogPanel :entries="events" empty-text="操作一下组件，事件会记在这里" />
                        </div>

                        <div v-else-if="rightTab === 'commands'" class="lab-pad" data-lab-panel="commands">
                            <!-- 只读检查器：看的是注册表与共享求值，不在这里执行命令、也不改 context -->
                            <p class="lab-panel-label">当前 context</p>
                            <JsonViewer :value="workbenchCommands.context.value" :read-only="true" :max-height="140" />

                            <p class="lab-panel-label">命令 {{ commandRows.length }} 条</p>
                            <p v-if="commandRows.length === 0" class="lab-note">当前场景没有注册命令。</p>
                            <section v-for="group in commandGroups" :key="group.domain" class="mt-3">
                                <p class="lab-panel-label">{{ group.domain }}</p>
                                <div
                                    v-for="row in group.rows"
                                    :key="row.command.id"
                                    class="mt-2 rounded-[var(--radius-control)] border border-[var(--divider)] p-2"
                                >
                                    <div class="flex items-baseline justify-between gap-2">
                                        <code class="min-w-0 break-all font-mono text-[11px] text-[var(--text-main)]">{{ row.command.id }}</code>
                                        <span class="shrink-0 text-[11px] text-[var(--text-secondary)]">{{ row.title }}</span>
                                    </div>
                                    <dl class="lab-meta lab-meta--flush">
                                        <div class="lab-meta-row">
                                            <dt class="lab-meta-key">effect</dt>
                                            <dd>{{ row.command.effect }}</dd>
                                        </div>
                                        <div class="lab-meta-row">
                                            <dt class="lab-meta-key">when</dt>
                                            <dd class="min-w-0 break-words">{{ row.whenText }}</dd>
                                        </div>
                                        <div class="lab-meta-row">
                                            <dt class="lab-meta-key">expose</dt>
                                            <dd>{{ row.exposeText }}</dd>
                                        </div>
                                        <div class="lab-meta-row">
                                            <dt class="lab-meta-key">键位</dt>
                                            <dd class="font-mono">{{ row.command.defaultKeybinding ?? "—" }}</dd>
                                        </div>
                                    </dl>
                                    <JsonViewer :value="row.command.argsSchema" :read-only="true" :max-height="200" />
                                </div>
                            </section>

                            <p class="lab-panel-label">最近执行 {{ commandLog.length }} / {{ COMMAND_LOG_LIMIT }}</p>
                            <p v-if="commandLog.length === 0" class="lab-note">这个场景里还没有命令执行记录。</p>
                            <JsonViewer v-else :value="commandLog" :read-only="true" :max-height="320" />
                        </div>

                        <div v-else-if="rightTab === 'data'" class="lab-pad lab-data" data-lab-panel="data">
                            <div v-if="sceneData !== undefined || sceneInput !== undefined" class="flex shrink-0 items-center justify-between">
                                <span class="lab-note">改完立刻生效</span>
                                <button type="button" class="lab-btn" @click="resetScene">还原</button>
                            </div>
                            <section v-if="sceneData !== undefined">
                                <p class="lab-panel-label">fixture · 宿主场景数据</p>
                                <JsonViewer
                                    :value="sceneData"
                                    :read-only="false"
                                    :max-height="320"
                                    @update:value="sceneData = $event"
                                />
                            </section>
                            <template v-if="sceneInput !== undefined">
                                <!-- 按被检组件签名分层：model/props 可编辑，slots 切换 fixture 预设。 -->
                                <section v-if="inputIssues.length > 0" role="status" class="lab-issues">
                                    <p class="lab-panel-label">与组件签名不一致 {{ inputIssues.length }} 处</p>
                                    <ul class="flex flex-col gap-2">
                                        <li v-for="issue in inputIssues" :key="`${issue.layer}:${issue.key}:${issue.message}`" class="flex gap-2">
                                            <code class="lab-chip shrink-0">{{ issue.key === "" ? issue.layer : `${issue.layer}.${issue.key}` }}</code>
                                            <span class="min-w-0">{{ issue.message }}</span>
                                        </li>
                                    </ul>
                                </section>
                                <p v-if="inputEditError !== ''" role="alert" class="lab-note text-[var(--status-danger)]">{{ inputEditError }}</p>
                                <section>
                                    <p class="lab-panel-label">
                                        model · 受控值，组件发 update 时回写（{{ subjectSignature?.models.join("、") || "组件没有受控值" }}）
                                    </p>
                                    <JsonViewer
                                        :value="sceneInput.model ?? {}"
                                        :read-only="false"
                                        :max-height="260"
                                        @update:value="editInputLayer('model', $event)"
                                    />
                                </section>
                                <section>
                                    <p class="lab-panel-label">props · 非受控输入，没写的走组件默认值</p>
                                    <JsonViewer
                                        :value="sceneInput.props ?? {}"
                                        :read-only="false"
                                        :max-height="260"
                                        @update:value="editInputLayer('props', $event)"
                                    />
                                </section>
                                <section v-if="fixtureSlots.length > 0">
                                    <p class="lab-panel-label">slots · 开启后填入 fixture 备好的插槽预设</p>
                                    <div v-for="name in fixtureSlots" :key="name" class="lab-meta-row items-center">
                                        <code class="lab-chip">#{{ name }}</code>
                                        <NbSwitch
                                            :model-value="sceneInput.slots?.[name] === true"
                                            size="sm"
                                            :aria-label="`插槽 ${name} 使用预设内容`"
                                            @update:model-value="setSlotPreset(name, $event)"
                                        />
                                    </div>
                                </section>
                            </template>
                            <p v-if="sceneData === undefined && sceneInput === undefined" class="lab-note">这个场景没有登记输入。</p>
                            <section v-if="fixtureState !== undefined">
                                <p class="lab-panel-label">内部状态 · 只读，由 fixture 上报</p>
                                <JsonViewer :value="fixtureState" :read-only="true" :max-height="260" />
                            </section>
                        </div>
                    </div>
                </div>
            </CollapsibleSidePanel>
        </div>

        <!-- S4：全局面板挂在画布外并 portal 到 body，缩放画布不缩放也不裁切它。
             检视 WorkbenchCommandPalette 时把打开中的面板标成受检零件（属性只在打开时存在）。 -->
        <WorkbenchCommandPalette
            :host="workbenchCommands"
            :title-of="titleOf"
            :data-lab-subject="selectedName === 'WorkbenchCommandPalette' ? '' : undefined"
        />

        <!-- 确认闸门：agent 调用的受控 AlertDialog。等面板 closed 后才显示，关闭并完成焦点释放后才结算 Promise -->
        <NbAlertDialog
            :open="confirmationVisible"
            :title="confirmationTitle"
            :tone="confirmationDestructive ? 'danger' : 'warning'"
            confirm-text="批准执行"
            cancel-text="取消"
            @update:open="onConfirmationOpenChange"
            @confirm="settleConfirmation(true)"
            @cancel="settleConfirmation(false)"
            @closed="onConfirmationClosed"
        >
            <template #description>
                <template v-if="pendingConfirmation">
                    <span class="block">{{ pendingConfirmation.request.callerId }} 请求执行「{{ confirmationTitle }}」。</span>
                    <span class="mt-1 block break-all font-mono text-[11px]">{{ confirmationArgs }}</span>
                    <span class="mt-1 block">仅操作当前 Lab 内存文档。</span>
                </template>
            </template>
        </NbAlertDialog>

        <!-- 悬停只在探针模式绘制虚线框；选中后只保留贴边标签。 -->
        <HighlightBox :rect="hoverRect" :label="hoverLabel" tone="probe" />
        <HighlightBox class="lab-picked-marker" :rect="pickedRect" :label="selectionLabel" :show-box="false" />
    </div>
</template>

<style scoped>
/*
 * 这些类是 Lab 消费主题 token 的唯一出口。写成 CSS 而不是原子类，是因为主题 token 要落在
 * font-family、letter-spacing、border-width 这些属性上，原子类的任意值语法在这些位置分辨
 * 不出「这是尺寸还是颜色」，写错了会静默不生效——而静默不生效正是「换主题看不出变化」。
 *
 * 材料语言与 nb-ui playground 的 /lab 同源（见其 assets/css/lab.css 开头那段）：
 *
 *   有面（顶栏、中栏工具条、两条侧栏、画布盒子） = --lab-surface，92% 的玻璃
 *   不给面（中栏舞台）                           = 什么都不铺，直接看到桌面
 *
 * 这不是装饰偏好，是**主题给的角色**。nbook / macos 这类玻璃主题把 chrome 的面色定成
 * 半透明（例如 --toolbar-surface = 30% 的侧栏色），它们只有在「背后有底纹 + 自己开模糊」时
 * 才成立；不接这两样就只剩一层洗淡的色，玻璃主题看起来会和无主题差不多。
 *
 * **整页只有一档面**：这一页上每一块面都直接压在桌面上，没有一块叠在另一块上面，
 * 所以它们全属于「材质层」，而材质层整页本来就只该有一层——理由在下面 .lab-root 那段注释里。
 *
 * 这一档的面**不取库里的角色**，取本文件 .lab-root 里的 --lab-surface。
 * 库里三档 chrome（30% / 26% / 14%）全部低于实测出来的可读性下限，
 * 而内容那一档是完全不透光的、与整页的玻璃语言脱节。等库里的表面类落地后
 * 换回库里的类，见 docs/proposals/nb-ui-surface-model.md。
 *
 * 分层手段是**面色 + 材料 + 抬起**，不是分割线——见下面 .lab-columns。这一条与 nb-ui 的 /lab
 * 不同：那边是贴边三栏加竖直分割线，这边是浮起三栏。是有意偏离，理由写在那一段里。
 */

.lab-root {
    /*
     * 底纹压掉多少。**这是一个观感取值，需要调就改这一个数。**
     *
     * 主题的 --window-backdrop 是按「文档页」调的：那种页面上内容是一列不透明卡片，
     * 底纹只从边上露出来，读起来是环境光。Lab 是满屏三栏仪器，底纹会**整片透过功能面板**——
     * 一条侧栏下半截泛蓝，那不是环境光，那是脏了。所以这里盖一层 --bg-main 把振幅压下去，
     * 色相走向还在，玻璃仍有东西可糊。
     *
     * 想知道压多了还是压少了，把顶栏的「桌面」切到「主题底纹·原强度」看不盖面纱是什么样。
     */
    --lab-backdrop-veil: 58%;

    /*
     * ——— 面 ———
     *
     * **整页只有一档面**，铺在顶栏、中栏工具条、两条侧栏和画布盒子上。剩下的两种情况不是
     * 第二档：舞台是「不给面」，浮层由库里的 .nb-ui-popover-surface 管。
     *
     * 一档是对的，不是将就：这一页上每一块面都**直接压在桌面上**，没有一块叠在另一块上面。
     * 按 docs/proposals/nb-ui-surface-model.md 的两条轴，它们全属于「材质层」，而材质层
     * 整页本来就只该有一层——这一条微软写成了明文禁令，CSS 规范也用性能理由劝阻。真正需要
     * 第二档的是「面上再放一个面」（面板里的表单、卡片、操作条），那属于另一条轴（层级色阶，
     * 不透明、不开模糊），这一页上没有。
     *
     * 92% 是走查调出来的，前面两版都不对：65% 在巴掌大的色块上读得清，铺满一整栏压在照片上
     * 仍然要盯着看；而做成完全不透光时又像一块贴上去的白板，与整页的玻璃语言脱节。
     * **留那 8% 不是为了透视，是为了让这块面和背后的桌面还有关系。**
     *
     * 分界线只在不透明度上：实测证明模糊配方换来换去都不影响能不能读，所以模糊沿用主题
     * 自己那套——它是主题的观感身份。
     *
     * 底取 --bg-panel 而不是 --bg-sidebar：暖而亮的底比冷底更托得住文字。
     *
     * 这两行是 Lab 本地的，等库里的表面类落地后删掉换成那个类。现在不能直接用库里的角色：
     * --toolbar-surface（30%）、--sidebar-surface（26%）、--overlay-surface（14%）
     * 全都远低于实测出来的下限。
     */
    --lab-surface: color-mix(in srgb, var(--bg-panel) 92%, transparent);
    --lab-surface-blur: var(--glass-blur, none);

    /* CollapsibleSidePanel 的两档入口都指向同一个值——两条侧栏不分档，理由同上。 */
    --lab-nav-surface: var(--lab-surface);
    --lab-nav-blur: var(--lab-surface-blur);
    --lab-content-surface: var(--lab-surface);
    --lab-content-blur: var(--lab-surface-blur);



    /* fixed 让桌面不随任何一栏的内部滚动跑，三栏共用同一张背景 */
    background-attachment: fixed;
    background-color: var(--bg-main);
    color: var(--text-main);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    letter-spacing: var(--tracking-ui);
    line-height: var(--leading-ui);
}

/*
 * ——— 桌面（页面最底下那一层）———
 *
 * 这一套的用处与画布底不同：画布底是给被测组件当背景，桌面是用来看**Lab 自己**哪些面是透的。
 * 左栏是 26% 的玻璃、中栏根本没给面，压在纯色上完全看不出来；换成棋盘格或斜纹，
 * 透到什么程度、模糊糊掉多少，一眼就有了。层的划分见 stage-backdrops.ts 开头。
 */

/* 窗体底纹＝主题自带的「桌面壁纸」，玻璃糊的是它；没有它，模糊作用在一片纯色上等于零效果。
   非玻璃主题不声明它，取 none，于是这一档退化成纯 --bg-main。 */
.lab-root--bg-theme {
    background-image:
        linear-gradient(
            color-mix(in srgb, var(--bg-main) var(--lab-backdrop-veil), transparent),
            color-mix(in srgb, var(--bg-main) var(--lab-backdrop-veil), transparent)
        ),
        var(--window-backdrop, none);
}

.lab-root--bg-theme-raw {
    background-image: var(--window-backdrop, none);
}

.lab-root--bg-page {
    background-image: none;
}

/* 棋盘格验的是透明度：半透明的面压上去，能一眼看出透出来多少。
   16px 的格子比画布底那套更大一档——它要透过 8px 模糊还认得出，太细会被糊成一片灰。 */
.lab-root--bg-checker {
    background-image:
        linear-gradient(45deg, color-mix(in srgb, var(--text-main) 12%, transparent) 25%, transparent 25%),
        linear-gradient(-45deg, color-mix(in srgb, var(--text-main) 12%, transparent) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--text-main) 12%, transparent) 75%),
        linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--text-main) 12%, transparent) 75%);
    background-size: 24px 24px;
    background-position: 0 0, 0 12px, 12px -12px, -12px 0;
}

/* 斜纹验的是模糊半径：细线被糊成灰的那一档，就是这块面实际的模糊强度。
   棋盘格答「透不透」，斜纹答「糊多厉害」，两个问题不同所以两档都留。 */
.lab-root--bg-stripes {
    background-image: repeating-linear-gradient(
        45deg,
        color-mix(in srgb, var(--text-main) 14%, transparent) 0 3px,
        transparent 3px 9px
    );
}

/* 极光是给玻璃用的：大面积、低频、高饱和，模糊之后仍有色相流动可看 */
.lab-root--bg-mesh {
    background-image:
        radial-gradient(at 10% 20%, color-mix(in srgb, var(--accent-main) 32%, transparent) 0, transparent 50%),
        radial-gradient(at 85% 15%, color-mix(in srgb, var(--status-info) 35%, transparent) 0, transparent 50%),
        radial-gradient(at 50% 85%, color-mix(in srgb, var(--status-warning) 28%, transparent) 0, transparent 50%),
        radial-gradient(at 90% 85%, color-mix(in srgb, var(--accent-main) 30%, transparent) 0, transparent 50%);
}

/* 自定义图片由内联 style 给（object URL 是运行期才有的），这里只负责在还没选图时
   退回一片干净的 --bg-main，而不是把上一档的图案留在下面。 */
.lab-root--bg-custom {
    background-image: none;
}

/* 纯黑纯白是对比度的两个极端，故意不走配色变量：它要跳出当前配色才有意义 */
.lab-root--bg-light {
    background-color: #ffffff;
    background-image: none;
}

.lab-root--bg-dark {
    background-color: #000000;
    background-image: none;
}

/* 取色期间整页换十字光标，并且不让文字被顺手选中——点击本身已在捕获阶段被吃掉。
   必须写 :deep()：scoped 样式会给选择器补上本组件的 data-v 属性，`* ` 只命中本模板里的
   元素，侧栏、画布、fixture 都是别的组件，不 deep 的话它们那片区域光标不变。 */
.lab-root--inspecting,
.lab-root--inspecting :deep(*) {
    cursor: crosshair !important;
    user-select: none;
}

/*
 * 横向留白只有一档：--panel-p。
 *
 * 之前顶栏 12px、侧栏头 12px、标签栏 8px、场景列表 8px、文档 16px，五处四个值。
 * 单看每一处都不难看，摆在一起就是三列的内容各自从不同的位置起排，读起来像没对过。
 */
.lab-bar {
    gap: var(--space-5);
    row-gap: var(--space-2);
    /* 顶栏比下面一层高一档，是全页唯一的「应用条」；下面三列的第一条横线才是同一层。
       用 min-height：空间不足时宁可这一条长高、换行，也不让控件滑出可视区（同 --tight）。 */
    min-height: calc(var(--control-h-lg) + var(--space-4));
    height: auto;
    /* 换行时多行整体居中；单行时由 align-items 决定，不受影响。 */
    align-content: center;
    padding: 0 var(--panel-p);
    border-bottom: var(--border-w) solid var(--divider);
    background: var(--lab-surface);
    /* 与中栏那条一样：不横向滚动，控件不滑出可视区；空间不足由内容收缩与换行承担。 */
    overflow: hidden;
    /* 容器查询的锚点：窄到什么程度藏哪些东西，由这一条自己的宽度决定。 */
    container-type: inline-size;
}

/*
 * 第二行的高度必须与两侧栏的标题栏**同一个值**，否则三列的第一条横线彼此差几像素。
 * 之前这里是内容高度（26px 控件 + 2×6px 内边距 = 38px）而侧栏头写死 40px，差 2px——
 * 单独看谁都不像错的，并排就是没对齐。两边现在都取 --control-h-lg。
 */
.lab-bar--tight {
    /*
     * 用 min-height 而不是 height：空间真的不够时（中栏被两侧栏挤到几百像素）宁可这一条长高、
     * 换行，也不让控件滑到视口外面去。宽松时高度仍恒等于标题栏。
     */
    min-height: var(--control-h-lg);
    height: auto;
    /* 比顶栏挤一档：这一条上摆的是画布的四个旋钮，它们是一组，
       用顶栏那档间距会把它们读成四件互不相干的东西 */
    gap: var(--space-4);
    row-gap: var(--space-2);
    padding: 0 var(--panel-p);
    /*
     * 不横向滚动：这条栏上的四个旋钮是看组件时要一直摸的，滑出去就等于没有。
     * 空间不足由内容自己收缩承担——先截断名字与别名、再收窄场景下拉（见下面的容器查询）。
     */
    overflow: hidden;
    /* 容器查询的锚点：窄到什么程度藏哪些文字，由这一条自己的宽度决定，不由窗口决定。 */
    container-type: inline-size;
}

/*
 * ——— 收缩顺序 ———
 *
 * 两条栏共用同一套机制，断点各自生效：`@container` 查的是最近的容器祖先，而两条栏都设了
 * `container-type: inline-size`，所以「1180px」对顶栏（全宽）与中栏工具条（半宽）是两把不同的尺子。
 * 名字与说明文字先让位，然后才轮到下拉收窄；两栏的旋钮永远在场，实在放不下就换行。
 *
 * 三个下拉的宽度必须走 `:deep`：`NbFormSelect` 的根节点是它自己 `$attrs` 绑定出来的，
 * 不带父组件的 scope id，普通 scoped 选择器落不到它身上；而组件自带的 `w-full` 会把宽度撑满容器。
 */
.lab-bar__lead :deep(.lab-bar__scene) {
    width: 240px;
}

.lab-bar__controls :deep(.lab-bar__theme) {
    width: 170px;
}

.lab-bar__controls :deep(.lab-bar__colorway),
.lab-bar__controls :deep(.lab-bar__backdrop) {
    width: 150px;
}

/* 顶栏：先藏「106 个组件」这类计数，再收窄三个整页下拉。 */
@container (max-width: 1180px) {
    .lab-bar__count {
        display: none;
    }
}

@container (max-width: 1020px) {
    .lab-bar__controls :deep(.lab-bar__theme) {
        width: 140px;
    }

    .lab-bar__controls :deep(.lab-bar__colorway),
    .lab-bar__controls :deep(.lab-bar__backdrop) {
        width: 124px;
    }
}

@container (max-width: 880px) {
    .lab-bar__controls :deep(.lab-bar__theme) {
        width: 120px;
    }

    .lab-bar__controls :deep(.lab-bar__colorway),
    .lab-bar__controls :deep(.lab-bar__backdrop) {
        width: 108px;
    }
}

/* 中栏工具条：先藏别名，再收窄场景下拉并藏掉「画布底 / 缩放」的文字标签。 */
@container (max-width: 1160px) {
    .lab-bar__detail {
        display: none;
    }
}

/*
 * 导航树的集成入口图标：树组件给每个图标压了 `opacity-70`（整列不喧宾夺主），
 * 工具类与它是同级声明、压不过它，所以在样式区按类提回实心；描边加粗一档，
 * 让它在成列的青色 view 图标里也跳得出来。
 */
.lab-root :deep(.lab-tree-entry-icon) {
    opacity: 1;
    stroke-width: 2.5;
}

@container (max-width: 1000px) {
    .lab-bar__lead :deep(.lab-bar__scene) {
        width: 190px;
    }

    .lab-bar__label {
        display: none;
    }
}

@container (max-width: 820px) {
    .lab-bar__lead :deep(.lab-bar__scene) {
        width: 150px;
    }
}


/*
 * ——— 浮起式三栏 ———
 *
 * 三栏不贴边，栏与栏之间留一条缝，缝里就是窗体底纹本身。这样桌面是**贯穿全页**的一整块，
 * 而不是「中栏那块灰」；两条竖直分割线随之取消，分层改由面色、材料与抬起承担。
 *
 * 三栏是同一种东西：一个圆角浮板，顶上一行 --control-h-lg 的头，头下一条线，下面是内容。
 * 中栏的头是画布工具条，它的内容区**不给面**——底纹直接透上来，于是中栏是一扇开向桌面的窗，
 * 画布盒子浮在窗里（盒子自己带面、边和抬起，见 ViewportCanvas）。给中栏上面色就成了
 * 「面板里浮一块面板」。这一档是规范里正式登记过的情形，不是漏给面：
 * nb-ui/docs/ui-development-spec.md 第 2 节第 1 条。
 *
 * 顶栏不浮：它是窗体 chrome，全宽加一条底边线正是 chrome 与桌面的分界，浮起来反而少了这层
 * 意思。缝取 --space-5（12px）：再窄读不出是缝，再宽就开始吃三栏本来就不宽的横向空间。
 *
 * 与 nb-ui 的 /lab 不同（那边贴边 + 竖直分割线）。这是有意偏离：那是纯仪器页，而这一页要同时
 * 当作 nbook 主题自己的展台，玻璃与抬起得有地方可看。换回贴边只需删掉这两段。
 */
.lab-columns {
    gap: var(--space-5);
    padding: var(--space-5);
    overflow-x: auto;
    /* 三栏在窄屏仍保持可访问，不把横向溢出传给页面根节点。 */
}

/* --panel-outline 只有玻璃主题声明，其余主题落到 --divider。
   overflow 必须裁：三栏的头都贴着上缘，不裁的话方角会戳出圆角外面。
   形状归布局不归零件，侧栏那一侧的理由见 CollapsibleSidePanel 样式里那段注释。

   两侧栏那一条写成 :deep 的后代选择器而不是直接写 .lab-panel：.lab-panel 落在子组件的
   根节点上，scoped 样式对子组件根节点确实生效，但那是 Vue 的作用域继承规则，一旦哪天
   CollapsibleSidePanel 的根节点变成多根或被包一层就静默失效——而失效的样子是「两侧栏
   连边框带圆角一起没了」，很难联想到是这里。 */
.lab-main,
.lab-columns :deep(.lab-panel) {
    overflow: hidden;
    border: var(--border-w) solid var(--panel-outline, var(--divider));
    border-radius: var(--radius-panel);
    box-shadow: var(--elevation-raised, none);
}

@media (max-width: 700px) {
    .lab-main {
        min-width: 0;
    }
}

/*
 * 侧栏之间的拖拽条。
 *
 * 三栏之间的缝是 --space-5（见 .lab-columns：这一页刻意不用分割线，靠面色与抬起分层）。
 * 所以这条手柄**不占宽度**：0 宽 + 负外边距把自己那一份缝吃掉，视觉上缝还是 12px，
 * 命中区由伪元素撑到 12px 宽、正好落在缝里。拖动与悬停时才画一条 2px 的强调线——
 * 那是「这里可以拖」的提示，不是又加了一条分割线。
 */
.lab-split-handle {
    position: relative;
    flex: 0 0 0;
    width: 0;
    /* 两侧各吃掉半份缝：三栏之间仍是原来的 12px，手柄落在缝的正中间 */
    margin: 0 calc(var(--space-5) / -2);
    cursor: col-resize;
    touch-action: none;
}

.lab-split-handle::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: -8px;
    right: -8px;
}

.lab-split-handle::before {
    content: "";
    position: absolute;
    top: var(--space-5);
    bottom: var(--space-5);
    left: -1px;
    width: 2px;
    border-radius: 1px;
    background: transparent;
}

.lab-split-handle:hover::before,
.lab-split-handle:focus-visible::before,
.lab-split-handle[data-dragging]::before {
    background: var(--accent-main);
}

.lab-split-handle:focus-visible {
    outline: none;
}

/* 「标签 + 控件」的一对。标签是控件的名字而不是独立的一行字，所以贴着它。 */
.lab-field {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

/* 面板内部的窄条（事件页的「清空」那行）。主题给这类 chrome 的角色是 --strip-surface，
   不是顶栏那档：它在面板**里面**，跟着顶栏走会得到一条玻璃带子横在实心面板中间。 */
.lab-strip {
    display: flex;
    height: var(--control-h-lg);
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: 0 var(--panel-p);
    border-bottom: var(--border-w) solid var(--divider);
    background: var(--strip-surface);
}

.lab-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
}

.lab-note {
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.lab-btn {
    padding: var(--space-2) var(--control-px);
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    transition:
        background-color var(--motion-fast) var(--ease-standard),
        color var(--motion-fast) var(--ease-standard);
}

.lab-btn:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.lab-btn--icon {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
}

.lab-btn:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 2px;
}

.lab-btn--on,
.lab-btn--on:hover {
    background: var(--accent-bg);
    color: var(--accent-text);
}

.lab-empty {
    display: flex;
    height: 100%;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.lab-empty--stack {
    flex-direction: column;
    gap: var(--space-4);
    padding: 0 var(--space-8);
    text-align: center;
}

/* 只给留白，不画线：NbTabs 自己的标签栏就带一条 border-bottom，
   这里再画一条会与它贴在一起变成 2px，右栏那条横线因此比全页别处都粗一倍。 */
.lab-tabs {
    padding: var(--space-4) var(--panel-p) 0;
}

/* 搜索框与树之间只留一档：它们是同一件事的两半，隔太开会读成两个区块 */
.lab-search {
    padding: var(--space-4) var(--panel-p) var(--space-2);
}

.lab-search-empty {
    padding: var(--space-2) var(--panel-p) var(--space-4);
}

.lab-pad {
    padding: var(--panel-p);
}

/* 分层之后是几段依次排下来，由外层滚动；不再让一个编辑器撑满整栏 */
.lab-data {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

.lab-issues {
    padding: var(--space-4);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--status-warning) 12%, transparent);
    font-size: var(--text-xs);
}

.lab-meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
    padding-bottom: var(--space-5);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-xs);
}

.lab-meta-row {
    display: flex;
    gap: var(--space-4);
}

/* 元素面板里这张表下面还接着类名与按钮，分隔线交给下一段自己的留白 */
.lab-meta--flush {
    margin-bottom: var(--space-4);
    padding-bottom: 0;
    border-bottom: none;
}

.lab-panel-label {
    margin-bottom: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.lab-row {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-5);
}

.lab-meta-key {
    width: 4rem;
    flex-shrink: 0;
    color: var(--text-muted);
}

@media (prefers-reduced-motion: reduce) {
    .nb-lab-panel {
        transition: none;
    }
}

.lab-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.lab-chip {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    font-family: var(--font-mono);
}

.lab-stage-fade-enter-active,
.lab-stage-fade-leave-active {
    transition: opacity 0.16s cubic-bezier(0.2, 0, 0, 1), transform 0.16s cubic-bezier(0.2, 0, 0, 1);
}

.lab-stage-fade-enter-from {
    opacity: 0;
    transform: scale(0.99);
}

.lab-stage-fade-leave-to {
    opacity: 0;
    transform: scale(0.99);
}
</style>
