<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, toRaw, watch} from "vue";
import {Value} from "typebox/value";
import {useRouter} from "vue-router";
import {
    FormSelect as NbFormSelect,
    SegmentedControl as NbSegmentedControl,
    ToggleGroup as NbToggleGroup,
} from "@notnotype/nb-ui/components";
import type {FormSelectOption, ToggleGroupOption} from "@notnotype/nb-ui/components";
import type {Component} from "vue";
import LabNavPanel from "./LabNavPanel.vue";
import LabToolbar from "./LabToolbar.vue";
import LabInspectPanel from "./LabInspectPanel.vue";
import ViewportCanvas from "./components/ViewportCanvas.vue";
import {installLabDebugApi} from "./lab-debug";
import {LAB_VIEWPORT_PRESETS, lookFromQuery, parseLabUrl} from "./lab-url";
import HighlightBox from "./components/HighlightBox.vue";
import {labComponents, findLabComponent} from "./component-index";
import type {LabDisplayMode} from "./component-index";
import {findLabFixture, labFixtures} from "./fixtures";
import {LAB_CONTROLS_REGISTER, LAB_DATA_SINK, LAB_EVENT_SINK, LAB_INPUT_SINK} from "./lab-event-sink";
import {LabSceneInputSchema, type LabSceneInput} from "./lab-subject";
import type {LabEventEntry} from "./components/event-log.types";
import type {HighlightRect} from "./components/highlight-box.types";
import type {InspectedNode} from "./inspect";
import {describeNode, nodeLabel} from "./inspect";
import {inspectElement} from "./inspect-checks";
import type {LabInspection} from "./inspect-checks";
import {labTokenGroups} from "./lab-tokens";
import {useLabOverrides} from "./use-lab-overrides";
import {clearLabWallpaper, loadLabWallpaper, saveLabWallpaper} from "./lab-wallpaper-store";
import {useLabPreferences} from "./use-lab-preferences";
import {useLabLayout, LAB_PANEL_DEFAULT_WIDTH} from "./use-lab-layout";
import {useLabSession} from "./use-lab-session";
import {LAB_PANEL_WIDTH_LIMITS} from "./lab-preferences-store";
import type {LabStore} from "./lab-preferences-store";
import {
    LAB_DEFAULT_BACKDROP,
    LAB_DEFAULT_PAGE_BACKDROP,
    LAB_DEFAULT_ZOOM,
    labBackdrops,
    labPageBackdrops,
    labZooms,
} from "./stage-backdrops";
import {useElementRect} from "./use-element-rect";
import "./lab-shell.css";
import {
    LAB_DEFAULT_COLORWAY,
    LAB_DEFAULT_THEME,
    applyLabTheme,
    clearLabTheme,
    labColorwayMeta,
    labThemes,
} from "./lab-theme";

const props = defineProps<{
    /** Lab 的偏好 store，由插件在第一次打开 `/lab` 时建立（见 `plugin.ts`）。 */
    store: LabStore;
}>();

const EVENT_LIMIT = 200;

const layout = useLabLayout({onDragEnd: (side) => preferences.commitPanelWidth(side)});
const {leftCollapsed, rightCollapsed, leftWidth, rightWidth, startPanelDrag, handlePanelKey, setLeftCollapsed, setRightCollapsed} = layout;
const selectedName = ref<string>("");
const selectedScene = ref<string>("");
const rightTab = ref("doc");
const canvasWidth = ref(0);
const canvasHeight = ref(0);
const canvasZoom = ref(String(LAB_DEFAULT_ZOOM));
const router = useRouter();
const session = useLabSession(router, {
    component: selectedName,
    scene: selectedScene,
    canvasWidth,
    canvasHeight,
    zoom: canvasZoom,
    tab: rightTab,
}, {
    componentNames: labComponents.map((item) => item.name),
    zooms: labZooms,
    defaults: {component: labComponents.find((entry) => entry.mountable)?.name ?? "", zoom: LAB_DEFAULT_ZOOM, tab: "doc"},
}, {
    onAddressLook: (query) => void preferences.followAddress(lookFromQuery(query, labColorwayMeta)),
});
onBeforeUnmount(session.stop);
const canvasBackdrop = ref(LAB_DEFAULT_BACKDROP);
const pageBackdrop = ref(LAB_DEFAULT_PAGE_BACKDROP);
const fixtureComponent = shallowRef<Component | null>(null);
const fixtureLoading = ref(false);
const fixtureLoadError = ref("");
/** 当前场景的分层输入：场景登记的初值，之后由数据面板编辑、组件 `update:x` 与 fixture 回写。 */
const sceneInput = ref<LabSceneInput | undefined>(undefined);
/** fixture 上报的被测组件内部状态快照，只读展示。 */
const fixtureState = ref<unknown>(undefined);
/** 数据面板最近一次编辑不符合分层 schema 时的原因；合法编辑后清空。 */
const inputEditError = ref("");
const events = ref<LabEventEntry[]>([]);
let fixtureLoadToken = 0;
let eventCounter = 0;

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


const backdropOptions: FormSelectOption[] = labBackdrops.map((item) => ({value: item.id, label: item.label}));

// ——— 自定义桌面壁纸 ———
//
// 图片不进仓库（理由见 lab-wallpaper-store.ts），由使用者当场选一张存在本机浏览器里。
// 页面上拿到的是一个 object URL，它绑在本次会话的这个 document 上，换图或离开都要撤销，
// 不撤销的话每换一张就漏一份图片大小的内存。

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

async function saveWallpaper(file: File): Promise<void> {
    // 存不进 IndexedDB（隐私模式、配额）时这次照样显示，只是刷新后不保留（ui.component-lab 失败与恢复）。
    await saveLabWallpaper(file).catch((error: unknown) => {
        console.warn("[component-lab] 自定义壁纸没能存进浏览器，刷新后不会保留", error);
    });
    setWallpaper(file);
}

async function dropWallpaper(): Promise<void> {
    await clearLabWallpaper().catch((error: unknown) => {
        console.warn("[component-lab] 没能从浏览器里删除自定义壁纸", error);
    });
    setWallpaper(null);
    pageBackdrop.value = LAB_DEFAULT_PAGE_BACKDROP;
}

// IndexedDB 只在浏览器里有，读取必须等挂载之后。
onMounted(async () => {
    setWallpaper(await loadLabWallpaper().catch((error: unknown) => {
        console.warn("[component-lab] 读不到自定义壁纸，回到默认桌面", error);
        return null;
    }));
    session.start();
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
const presetSizes = LAB_VIEWPORT_PRESETS;
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

const requestedLook = typeof window === "undefined" ? {} : parseLabUrl(window.location.search, labColorwayMeta);
const preferences = useLabPreferences({
    store: props.store,
    catalog: {
        themeIds: labThemes.map((theme) => theme.manifest.id),
        colorwayIds: Object.keys(labColorwayMeta),
        canvasBackdropIds: labBackdrops.map((item) => item.id),
        pageBackdropIds: labPageBackdrops.map((item) => item.id),
    },
    defaults: {
        themeId: LAB_DEFAULT_THEME,
        colorwayId: LAB_DEFAULT_COLORWAY,
        pageBackdropId: LAB_DEFAULT_PAGE_BACKDROP,
        canvasBackdropId: LAB_DEFAULT_BACKDROP,
        leftPanelWidth: LAB_PANEL_DEFAULT_WIDTH.left,
        rightPanelWidth: LAB_PANEL_DEFAULT_WIDTH.right,
    },
    state: {
        themeId: labThemeId,
        colorwayId: labColorwayId,
        pageBackdropId: pageBackdrop,
        canvasBackdropId: canvasBackdrop,
        leftCollapsed,
        rightCollapsed,
        preferredLeftCollapsed: layout.preferredLeftCollapsed,
        preferredRightCollapsed: layout.preferredRightCollapsed,
        leftPanelWidth: leftWidth,
        rightPanelWidth: rightWidth,
    },
    hasCustomWallpaper: () => wallpaperUrl.value !== "",
    requested: {
        ...(requestedLook.themeId === undefined ? {} : {themeId: requestedLook.themeId}),
        ...(requestedLook.colorwayId === undefined ? {} : {colorwayId: requestedLook.colorwayId}),
    },
    dragging: () => layout.dragging.value,
    onLookAdopted: () => session.dropLook(),
    applyResponsiveLayout: () => layout.applyResponsiveLayout(),
});
const {hydrating: preferencesHydrating, problem: preferencesProblem} = preferences;

// 记录读到之后主题与配色才确定；与默认值相同时主题的 watch 不触发，这里补一次。
watch(preferencesHydrating, (hydrating) => {
    if (!hydrating) applyLabTheme(labThemeId.value, labColorwayId.value);
});

/** 偏好的问题提示（ui.component-lab “状态与转换”的表）：每种问题一句话与对应的操作。 */
type PreferencesAction = "retry" | "discard" | "reset";
const preferencesNotice = computed<{text: string; actions: readonly PreferencesAction[]} | null>(() => {
    const problem = preferencesProblem.value;
    if (problem === null) return null;
    if (problem.kind === "unread") return {text: `偏好没能读取（${problem.code}），正在使用默认值`, actions: ["retry"]};
    if (problem.kind === "protected") return {text: `偏好记录损坏或版本不认识（${problem.code}），不会覆盖`, actions: ["reset"]};
    return {text: `偏好没保存上（${problem.code}）`, actions: ["retry", "discard"]};
});

// ——— 复制场景链接 ———
const linkCopied = ref(false);
let linkCopiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copySceneLink(): Promise<void> {
    await navigator.clipboard.writeText(session.canonicalHref({themeId: labThemeId.value, colorwayId: labColorwayId.value}));
    linkCopied.value = true;
    if (linkCopiedTimer !== null) clearTimeout(linkCopiedTimer);
    linkCopiedTimer = setTimeout(() => {
        linkCopied.value = false;
    }, 1600);
}
onBeforeUnmount(() => {
    if (linkCopiedTimer !== null) clearTimeout(linkCopiedTimer);
});

/** 地址里的场景在这个组件里不存在、回落到了首个场景：提示一次，换场景或组件后消失。 */
const missingScene = ref<{requested: string; fallback: string} | null>(null);
watch([selectedName, selectedScene], ([, id]) => {
    if (missingScene.value !== null && id !== missingScene.value.fallback) missingScene.value = null;
});

async function resetPreferences(): Promise<void> {
    await preferences.reset();
}

const currentAppearance = computed(() => labColorwayMeta[labColorwayId.value]?.appearance ?? "dark");

// 换主题时跟到这套主题自带的配色。manifest 把它叫默认值而不是约束：跟过去之后
// 用户仍可以单独换配色，两条轴独立。
watch(labThemeId, (id) => {
    if (preferences.isApplying()) {
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

// ——— 调试接口：截图脚本与控制台读 window.__nbLab（见 lab-debug.ts） ———
let uninstallDebugApi: (() => void) | null = null;
onMounted(() => {
    uninstallDebugApi = installLabDebugApi({
        state: () => ({
            component: selectedName.value,
            scene: selectedScene.value,
            ready: !preferencesHydrating.value && !fixtureLoading.value && fixtureComponent.value !== null,
            loadError: fixtureLoadError.value,
            canvas: {width: canvasWidth.value, height: canvasHeight.value},
            themeId: labThemeId.value,
            colorwayId: labColorwayId.value,
        }),
        components: () => labComponents.filter((entry) => entry.mountable && labFixtures.some((item) => item.component === entry.name)).map((entry) => entry.name),
        scenes: (component) => (findLabFixture(component ?? selectedName.value)?.scenes ?? []).map(({id, label}) => ({id, label})),
    });
});
onBeforeUnmount(() => uninstallDebugApi?.());
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

const {rect: pickedRect, track: trackPicked, measure: measurePicked} = useElementRect();
/** 选中的元素本身：结构检查要读它的属性与计算样式；换场景后它就不在了（见 clearPicked 的调用方）。 */
let pickedElement: HTMLElement | null = null;
const inspection = ref<LabInspection | null>(null);

function refreshInspection(): void {
    inspection.value = pickedElement === null || !pickedElement.isConnected
        ? null
        : inspectElement(pickedElement, document.querySelector<HTMLElement>(".lab-main .nb-lab-stage-box"));
}

// ——— 变量页签：覆盖层与取值采样 ———
const tokenGroups = labTokenGroups();
const tokenNames = new Set(tokenGroups.flatMap((group) => group.tokens));
const overrideLayer = useLabOverrides(() => tokenNames);
const resolvedTokens = ref<Record<string, string>>({});

/** 读每个变量此刻在文档根上的计算值；只在变量页签打开时读，变量有上百个。 */
function sampleTokens(): void {
    if (rightTab.value !== "variables") return;
    const styles = getComputedStyle(document.documentElement);
    resolvedTokens.value = Object.fromEntries([...tokenNames].map((name) => [name, styles.getPropertyValue(name).trim()]));
}

// 换主题、换配色、改覆盖之后取值都会变；post：等主题写到文档根上再读。
watch([rightTab, labThemeId, labColorwayId, overrideLayer.overrides], () => {
    void nextTick(sampleTokens);
}, {deep: true, flush: "post"});

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
    pickedElement = element;
    refreshInspection();
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
    pickedElement = null;
    inspection.value = null;
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
});

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
    if (id === selectedName.value) {
        return;
    }
    // 换组件时画布回到随窗口，避免上一个组件拖出来的尺寸影响新组件的判读。地址带来的组件（链接、后退）连同它的
    // 画布一起恢复，不走这里。
    canvasWidth.value = 0;
    canvasHeight.value = 0;
    selectedName.value = id;
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


const hasFixtureControls = ref(false);
const bottomPanelCollapsed = ref(false);
const controlsTargetRef = ref<HTMLElement | null>(null);
const controlsTargetMinHeight = ref<string | undefined>(undefined);
let activeControlsCount = 0;

function syncFixtureControlsVisibility(): void {
    hasFixtureControls.value = activeControlsCount > 0;
    controlsTargetMinHeight.value = undefined;
}

provide(LAB_CONTROLS_REGISTER, (active: boolean) => {
    if (active) {
        activeControlsCount += 1;
        hasFixtureControls.value = true;
    } else {
        if (controlsTargetRef.value && controlsTargetRef.value.offsetHeight > 0) {
            controlsTargetMinHeight.value = `${controlsTargetRef.value.offsetHeight}px`;
        }
        activeControlsCount = Math.max(0, activeControlsCount - 1);
        void nextTick(syncFixtureControlsVisibility);
    }
});

function resetScene(): void {
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

    // 保留已选中的合法场景（例如地址里写的），否则换成首个场景。
    if (!selectedScene.value || !next.scenes.some((s) => s.id === selectedScene.value)) {
        const fallback = next.scenes[0]?.id ?? "";
        if (selectedScene.value !== "" && selectedScene.value === session.requestedScene && missingScene.value === null) {
            missingScene.value = {requested: selectedScene.value, fallback};
        }
        selectedScene.value = fallback;
    }

    // 场景与输入在这次渲染就换成新组件的（见下一个 watch），组件却要等 loader：
    // 留着旧组件，它会按新 key 带着别的组件的输入重新挂载，setup 抛错后整个舞台卸载失败。
    fixtureComponent.value = null;
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

watch([selectedScene, fixture], ([id, currentFixture], prev) => {
    if (currentFixture && !currentFixture.scenes.some((item) => item.id === id)) {
        selectedScene.value = currentFixture.scenes[0]?.id ?? "";
        return;
    }
    resetScene();
    if (!currentFixture || (prev && prev[1] && prev[1].component !== currentFixture.component)) {
        activeControlsCount = 0;
        controlsTargetMinHeight.value = undefined;
        hasFixtureControls.value = false;
    }
}, {immediate: true});

// 挂上新 fixture 或换场景后是另一批 DOM 节点，之前选中的那个已经不在了
watch([fixtureComponent, selectedScene], () => {
    clearPicked();
});
// 调试输入变更可能推动所选零件的位置或尺寸。
watch([sceneInput, canvasWidth, canvasHeight], () => {
    void nextTick(() => {
        measurePicked();
        refreshInspection();
    });
}, {deep: true});
</script>

<template>
    <!-- 主题轴管形状与节奏，配色轴管颜色。Lab 自己的界面必须真的消费主题 token，
         否则换主题只有 nb-ui 组件在动，看起来像切换没生效。 -->
    <!-- 偏好读到之前只显示占位：先用默认主题画一帧再换成保存的主题，会闪一下。 -->
    <div v-if="preferencesHydrating" class="lab-loading flex h-full items-center justify-center" data-lab-loading>
        <span class="lab-note">正在读取 Lab 偏好…</span>
    </div>
    <div
        v-else
        class="lab-root flex h-full min-h-0 flex-col"
        :class="[inspectOn ? 'lab-root--inspecting' : '', `lab-root--bg-${pageBackdrop}`]"
        :style="pageBackdropStyle"
        @mousemove="handleInspectMove"
        @click.capture="handleInspectCapture"
        @mousedown.capture="handleInspectCapture"
    >
        <LabToolbar
            v-model:theme-id="labThemeId"
            v-model:colorway-id="labColorwayId"
            v-model:page-backdrop="pageBackdrop"
            :component-count="labComponents.length"
            :has-wallpaper="wallpaperUrl !== ''"
            :link-copied="linkCopied"
            @wallpaper="saveWallpaper"
            @drop-wallpaper="dropWallpaper"
            @copy-link="copySceneLink"
            @reset="resetPreferences"
        />

        <div v-if="preferencesNotice !== null || missingScene !== null" class="lab-notice flex shrink-0 flex-wrap items-center" role="status" data-lab-notice>
            <template v-if="preferencesNotice !== null">
                <span class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true"></span>
                <span class="min-w-0" data-lab-preferences-problem>{{ preferencesNotice.text }}</span>
                <button v-if="preferencesNotice.actions.includes('retry')" type="button" class="lab-btn shrink-0" @click="preferences.retry()">重试</button>
                <button v-if="preferencesNotice.actions.includes('discard')" type="button" class="lab-btn shrink-0" @click="preferences.discard()">放弃修改</button>
                <button v-if="preferencesNotice.actions.includes('reset')" type="button" class="lab-btn shrink-0" @click="resetPreferences">恢复默认</button>
            </template>
            <span v-if="missingScene !== null" class="min-w-0" data-lab-missing-scene>
                地址里的场景「{{ missingScene.requested }}」不存在，打开了「{{ missingScene.fallback }}」
            </span>
        </div>

        <div class="lab-columns flex min-h-0 flex-1">
            <LabNavPanel
                :selected="selectedName"
                :loading="fixtureLoading"
                :collapsed="leftCollapsed"
                :width="leftWidth"
                @select="selectComponent"
                @update:collapsed="setLeftCollapsed"
            />

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

                <div class="relative min-h-0 flex-1 overflow-hidden">
                    <!-- 切换组件加载遮罩与动画 -->
                    <div
                        v-if="fixtureLoading"
                        class="lab-fixture-loading absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[var(--lab-surface)]/75 backdrop-blur-xs select-none transition-opacity [transition-duration:var(--motion-fast)]"
                    >
                        <div class="flex items-center gap-2.5 rounded-full border border-[var(--divider)] bg-[var(--bg-panel)] px-4 py-2 shadow-md">
                            <span class="i-lucide-loader-2 h-4 w-4 animate-spin motion-reduce:animate-none text-[var(--accent-main)]" aria-hidden="true" />
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
                        <!-- 换场景直接替换舞台，不做淡出淡入：退场期间舞台是空的，看起来像组件消失了（ui.component-lab：场景切换不插入空白退场阶段）。 -->
                        <div :key="`${selectedName}:${selectedScene}`" class="h-full w-full" data-lab-stage>
                            <component
                                :is="fixtureComponent"
                                v-if="fixtureComponent"
                                :scene="selectedScene"
                                :input="sceneInput"
                            />
                        </div>
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
                        ref="controlsTargetRef"
                        class="min-h-0 max-h-48 overflow-auto px-4 py-2 text-xs"
                        :style="controlsTargetMinHeight ? {minHeight: controlsTargetMinHeight} : undefined"
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

            <LabInspectPanel
                v-model:tab="rightTab"
                :collapsed="rightCollapsed"
                :width="rightWidth"
                :selected="selected"
                :picked="picked"
                :events="events"
                :event-limit="EVENT_LIMIT"
                :scene-input="sceneInput"
                :fixture-slots="fixtureSlots"
                :fixture-state="fixtureState"
                :input-edit-error="inputEditError"
                :no-input="fixture?.noInput"
                @update:collapsed="setRightCollapsed"
                @clear-picked="clearPicked"
                @clear-events="events = []"
                @reset-input="resetScene"
                @edit-input="editInputLayer"
                @set-slot="setSlotPreset"
                :inspection="inspection"
                :token-groups="tokenGroups"
                :resolved-tokens="resolvedTokens"
                :overrides="overrideLayer.overrides.value"
                :override-count="overrideLayer.count.value"
                :on-override-set="overrideLayer.set"
                :on-override-reset="overrideLayer.reset"
                :on-override-reset-all="overrideLayer.resetAll"
                :on-override-import="overrideLayer.importSnapshot"
                :on-override-export="overrideLayer.exportSnapshot"
            />
        </div>

        <!-- 悬停只在探针模式绘制虚线框；选中后只保留贴边标签。 -->
        <HighlightBox :rect="hoverRect" :label="hoverLabel" tone="probe" />
        <HighlightBox class="lab-picked-marker" :rect="pickedRect" :label="selectionLabel" :show-box="false" />
    </div>
</template>
