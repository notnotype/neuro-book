<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch} from "vue";
import {
    FormInput as NbFormInput,
    FormSelect as NbFormSelect,
    SegmentedControl as NbSegmentedControl,
    Tabs as NbTabs,
    ToggleGroup as NbToggleGroup,
    Tree as NbTree,
} from "@notnotype/nb-ui/components";
import type {FormSelectOption, SegmentedControlOption, TabsItem, ToggleGroupOption} from "@notnotype/nb-ui/components";
import type {Component} from "vue";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import CollapsibleSidePanel from "./CollapsibleSidePanel.vue";
import ViewportCanvas from "./ViewportCanvas.vue";
import MarkdownView from "./MarkdownView.vue";
import EventLogPanel from "./EventLogPanel.vue";
import HighlightBox from "./HighlightBox.vue";
import {labComponents, findLabComponent} from "./component-index";
import {findLabFixture} from "./fixtures";
import {LAB_EVENT_SINK} from "./lab-event-sink";
import type {LabEventEntry} from "./event-log.types";
import type {HighlightRect} from "./highlight-box.types";
import type {InspectedNode} from "./inspect";
import {INSPECT_CLASS_LIMIT, describeNode, nodeLabel, nodeReport} from "./inspect";
import {clearLabWallpaper, loadLabWallpaper, saveLabWallpaper} from "./lab-wallpaper-store";
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

const ALL_GROUP_IDS = [...new Set(labComponents.map((entry) => `group:${entry.group}`))];

const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const selectedName = ref<string>(labComponents.find((entry) => entry.mountable)?.name ?? "");
const selectedScene = ref<string>("");
const rightTab = ref("doc");
const treeQuery = ref("");
const expandedGroups = ref<string[]>([...ALL_GROUP_IDS]);
const canvasWidth = ref(0);
const canvasHeight = ref(0);
const canvasZoom = ref(String(LAB_DEFAULT_ZOOM));
const canvasBackdrop = ref(LAB_DEFAULT_BACKDROP);
const pageBackdrop = ref(LAB_DEFAULT_PAGE_BACKDROP);
const fixtureComponent = shallowRef<Component | null>(null);
const sceneData = ref<unknown>(undefined);
const events = ref<LabEventEntry[]>([]);
let eventCounter = 0;

const matchedComponents = computed(() => {
    const query = treeQuery.value.trim().toLowerCase();
    if (query === "") {
        return labComponents;
    }
    // 只按组件名搜。搜文档正文会把「凡是提到 Tree 的组件」全捞出来，
    // 而这一栏是导航，导航要的是「我知道它叫什么，带我过去」。
    return labComponents.filter((entry) => entry.name.toLowerCase().includes(query));
});

const treeItems = computed(() => {
    const groups = new Map<string, typeof labComponents>();
    for (const entry of matchedComponents.value) {
        const bucket = groups.get(entry.group) ?? [];
        bucket.push(entry);
        groups.set(entry.group, bucket);
    }
    return [...groups.entries()].map(([group, entries]) => ({
        id: `group:${group}`,
        title: group,
        children: entries.map((entry) => ({
            id: entry.name,
            title: entry.name,
            // 挂不上的组件仍然在清单里，用锁图标标出来，点进去能看到原因
            iconClass: entry.mountable ? "i-lucide-box" : "i-lucide-lock",
        })),
    }));
});

// 搜索时把目录全摊开：搜出来的东西藏在一个收起的目录里，等于没搜到。
watch(treeQuery, (query) => {
    if (query.trim() !== "") {
        expandedGroups.value = [...ALL_GROUP_IDS];
    }
});

const selected = computed(() => (selectedName.value ? findLabComponent(selectedName.value) : null));
const fixture = computed(() => (selectedName.value ? findLabFixture(selectedName.value) : null));
const scene = computed(() => fixture.value?.scenes.find((item) => item.id === selectedScene.value) ?? null);
const sceneHasData = computed(() => scene.value?.data !== undefined);

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
const sceneOptions = computed<SegmentedControlOption[]>(() =>
    (fixture.value?.scenes ?? []).map((item) => ({value: item.id, label: item.label})));

const tabItems = computed<TabsItem[]>(() => [
    {value: "doc", label: "文档"},
    {value: "element", label: "元素"},
    {value: "events", label: "事件", count: events.value.length},
    {value: "data", label: "数据"},
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

// IndexedDB 只在浏览器里有，读取必须等挂载之后
onMounted(async () => {
    setWallpaper(await loadLabWallpaper());
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

const currentAppearance = computed(() => labColorwayMeta[labColorwayId.value]?.appearance ?? "dark");

// 换主题时跟到这套主题自带的配色。manifest 把它叫默认值而不是约束：跟过去之后
// 用户仍可以单独换配色，两条轴独立。
watch(labThemeId, (id) => {
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
onMounted(() => {
    applyLabTheme(labThemeId.value, labColorwayId.value);
});
// 主题写在 <html> 上（见 lab-theme.ts），离开 Lab 必须复原，否则产品界面跟着变
onBeforeUnmount(clearLabTheme);

// ——— 检查：一个开关，devtools 那种取色针 ———
//
// 原来是「描边」「探针」两个开关：前者常亮框住 fixture 标出的零件，后者跟着鼠标走但只
// 在框边显示一行字，看完即走、没法引用。合成一个之后语义是单一的「你点中的那个元素」。
//
// **不自动选中任何东西。** 进页面先给一个框，等于替使用者做了一次他没提的决定，
// 而那个框还压在预览上。要看零件本体，用取色针点它——data-lab-subject 会在面板里标出来。

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

function resetScene(): void {
    sceneData.value = structuredClone(scene.value?.data);
    events.value = [];
}

watch(fixture, async (next) => {
    selectedScene.value = next?.scenes[0]?.id ?? "";
    fixtureComponent.value = next ? await next.load() : null;
}, {immediate: true});

// 换场景等于重来一次：假数据回到登记的初值，事件日志清空，
// 否则「同一场景重复打开结果一致」这条验收就不成立。
watch([selectedScene, fixture], () => {
    resetScene();
}, {immediate: true});

// 挂上新 fixture 或换场景后是另一批 DOM 节点，之前选中的那个已经不在了
watch([fixtureComponent, selectedScene], () => {
    clearPicked();
});
// 改假数据不换节点，但选中的元素可能被推走或改大小，ResizeObserver 看不见位移
watch([sceneData, canvasWidth, canvasHeight], () => {
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
        <header class="lab-bar flex shrink-0 items-center">
            <span class="lab-title shrink-0">组件 Lab</span>
            <span class="lab-note shrink-0">{{ labComponents.length }} 个组件</span>
            <div class="flex-1"></div>
            <NbFormSelect
                v-model="labThemeId"
                :options="themeOptions"
                size="sm"
                class="w-[170px] shrink-0"
                aria-label="主题"
            />
            <NbFormSelect
                v-model="labColorwayId"
                :options="colorwayOptions"
                size="sm"
                class="w-[150px] shrink-0"
                aria-label="配色"
            />
            <!-- 桌面与画布底是两层不同的东西，别合成一个控件：这个改的是整页最底下那一层，
                 中栏工具条上的「画布底」改的是被测组件背后那一层。取值都在 stage-backdrops.ts。 -->
            <NbFormSelect
                v-model="pageBackdrop"
                :options="pageBackdropOptions"
                size="sm"
                class="w-[150px] shrink-0"
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
            <!-- ToggleGroup 自带边框与内衬底，外面不能再套 Toolbar：那是第二层容器，
                 而一个只装一件东西的工具栏也不是工具栏。 -->
            <NbToggleGroup
                size="sm"
                :options="presetOptions"
                :model-value="activePreset"
                aria-label="画布尺寸"
                class="shrink-0"
                @update:model-value="applyPreset"
            />
        </header>

        <div class="lab-columns flex min-h-0 flex-1">
            <CollapsibleSidePanel
                v-model:collapsed="leftCollapsed"
                title="组件"
                side="left"
                class="lab-panel"
                :class="leftCollapsed ? '' : 'w-[240px] shrink-0'"
            >
                <template #actions>
                    <span class="lab-note shrink-0 tabular-nums">
                        {{ matchedComponents.length }} / {{ labComponents.length }}
                    </span>
                </template>

                <div class="lab-search">
                    <NbFormInput
                        v-model="treeQuery"
                        size="sm"
                        type="search"
                        placeholder="搜组件名"
                        icon-class="i-lucide-search"
                        clearable
                        aria-label="搜组件名"
                    />
                </div>

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
                    没有名字含「{{ treeQuery }}」的组件
                </p>
            </CollapsibleSidePanel>

            <main class="lab-main flex min-w-0 flex-1 flex-col">
                <div class="lab-bar lab-bar--tight flex shrink-0 items-center">
                    <span class="lab-title shrink-0 truncate">{{ selected?.name ?? "未选择" }}</span>
                    <NbSegmentedControl
                        v-if="sceneOptions.length > 1"
                        :model-value="selectedScene"
                        :options="sceneOptions"
                        size="xs"
                        aria-label="场景"
                        class="min-w-0"
                        @update:model-value="selectedScene = String($event)"
                    />
                    <span v-else-if="scene" class="lab-note shrink-0 truncate">{{ scene.label }}</span>
                    <div class="flex-1"></div>
                    <label class="lab-field shrink-0">
                        <span class="lab-note">画布底</span>
                        <NbFormSelect
                            v-model="canvasBackdrop"
                            :options="backdropOptions"
                            size="sm"
                            dropdown-direction="down"
                            hide-checkmark
                            class="w-[104px]"
                            aria-label="画布底"
                        />
                    </label>
                    <label class="lab-field shrink-0">
                        <span class="lab-note">缩放</span>
                        <NbFormSelect
                            v-model="canvasZoom"
                            :options="zoomOptions"
                            size="sm"
                            dropdown-direction="down"
                            hide-checkmark
                            class="w-[76px]"
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

                <div class="min-h-0 flex-1">
                    <div v-if="!selected" class="lab-empty">左边选一个组件</div>
                    <div v-else-if="!selected.mountable" class="lab-empty lab-empty--stack">
                        <span class="i-lucide-lock h-6 w-6 text-[var(--text-muted)]"></span>
                        <p class="lab-title">{{ selected.name }} 不能在 Lab 里验证</p>
                        <p class="lab-note max-w-md">{{ selected.blockedReason }}</p>
                    </div>
                    <div v-else-if="!fixture" class="lab-empty lab-empty--stack">
                        <p class="lab-title">{{ selected.name }} 还没有场景</p>
                        <p class="lab-note">它可以挂载，但还没有人为它写 fixture。</p>
                    </div>
                    <ViewportCanvas
                        v-else
                        v-model:width="canvasWidth"
                        v-model:height="canvasHeight"
                        :zoom="zoomValue"
                        :backdrop="canvasBackdrop"
                    >
                        <component
                            :is="fixtureComponent"
                            v-if="fixtureComponent"
                            :key="`${selectedName}:${selectedScene}`"
                            :scene="selectedScene"
                            :data="sceneData"
                        />
                    </ViewportCanvas>
                </div>
            </main>

            <!-- 右栏装的是文档正文与数据，是内容层不是导航层：见 CollapsibleSidePanel 里
                 layer 那一段。它也是全屏唯一那块暖面，nbook 的冷暖对比靠它成立。 -->
            <CollapsibleSidePanel
                v-model:collapsed="rightCollapsed"
                title="检视"
                side="right"
                layer="content"
                class="lab-panel"
                :class="rightCollapsed ? '' : 'w-[340px] shrink-0'"
            >
                <div class="flex h-full min-h-0 flex-col">
                    <div class="lab-tabs shrink-0">
                        <NbTabs v-model="rightTab" :items="tabItems" size="sm" aria-label="检视面板" />
                    </div>

                    <div class="min-h-0 flex-1 overflow-y-auto">
                        <div v-if="rightTab === 'element'" class="lab-pad">
                            <template v-if="picked">
                                <dl class="lab-meta lab-meta--flush">
                                    <div v-if="picked.componentName" class="lab-meta-row">
                                        <dt class="lab-meta-key">组件</dt>
                                        <dd class="min-w-0 break-words">{{ picked.componentName }}</dd>
                                    </div>
                                    <div v-if="picked.componentFile" class="lab-meta-row">
                                        <dt class="lab-meta-key">源文件</dt>
                                        <dd class="min-w-0 break-all font-mono">{{ picked.componentFile }}</dd>
                                    </div>
                                    <div class="lab-meta-row">
                                        <dt class="lab-meta-key">选择器</dt>
                                        <dd class="min-w-0 break-all font-mono">{{ picked.selector }}</dd>
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

                        <div v-else-if="rightTab === 'doc'" class="lab-pad">
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
                                            {{ selected.mountable ? (selected.needsSnapshot ? "需预置状态快照" : "可以") : "只能在正式界面" }}
                                        </dd>
                                    </div>
                                </dl>
                                <MarkdownView :source="selected.doc" />
                            </template>
                        </div>

                        <div v-else-if="rightTab === 'events'" class="flex h-full flex-col">
                            <div class="lab-strip shrink-0">
                                <span class="lab-note">最多留最近 {{ EVENT_LIMIT }} 条</span>
                                <button type="button" class="lab-btn" @click="events = []">清空</button>
                            </div>
                            <EventLogPanel :entries="events" empty-text="操作一下组件，事件会记在这里" />
                        </div>

                        <div v-else class="lab-pad lab-data">
                            <template v-if="sceneHasData">
                                <div class="flex shrink-0 items-center justify-between">
                                    <span class="lab-note">改完立刻生效</span>
                                    <button type="button" class="lab-btn" @click="resetScene">还原</button>
                                </div>
                                <JsonViewer
                                    :value="sceneData"
                                    :read-only="false"
                                    :max-height="0"
                                    class="min-h-0 flex-1"
                                    @update:value="sceneData = $event"
                                />
                            </template>
                            <p v-else class="lab-note">这个场景没有登记可改的假数据。</p>
                        </div>
                    </div>
                </div>
            </CollapsibleSidePanel>
        </div>

        <!-- 两个框、两种语义：实线是你点中的那个（没点过就没有框），虚线只在取色时跟着鼠标走 -->
        <HighlightBox :rect="pickedRect" :label="selectionLabel" tone="subject" />
        <HighlightBox :rect="hoverRect" :label="hoverLabel" tone="probe" />
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
 *   导航层（顶栏、左栏）     = --toolbar-surface / --sidebar-surface + 玻璃 + 窗体底纹
 *   内容层（画布盒子、右栏） = 实心 --panel-surface
 *
 * 这两条不是装饰偏好，是**主题给的角色**。nbook / macos 这类玻璃主题把 chrome 的面色定成
 * 半透明（例如 --toolbar-surface = 30% 的侧栏色），它们只有在「背后有底纹 + 自己开模糊」时
 * 才成立；不接这两样就只剩一层洗淡的色，玻璃主题看起来会和无主题差不多。
 *
 * **右栏归内容层不归导航层**，与 nb-ui 的检查器一致。它装的是文档正文与数据，而且 nbook 把
 * 冷暖对比定成了身份：器械冷、内容面板暖，全屏只有两处暖面。两侧栏都做成玻璃的话这个页面
 * 一处暖面都没有，主题最核心的那组对比就没开。理由的正文在 CollapsibleSidePanel 的 layer 那一段。
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
    /* 顶栏比下面一层高一档，是全页唯一的「应用条」；下面三列的第一条横线才是同一层 */
    height: calc(var(--control-h-lg) + var(--space-4));
    padding: 0 var(--panel-p);
    border-bottom: var(--border-w) solid var(--divider);
    background: var(--toolbar-surface);
    /*
     * 这里直接引用了主题私有的 --glass-blur，而不是某个库角色——库里今天只有浮层那档
     * （--overlay-blur），chrome 层没有对应的角色。nb-ui playground 的 /lab 也是这么写的。
     * 没声明它的主题（aurora / editorial）落到 none，正好就是它们要的实心 chrome。
     * 主题契约补上 chrome 档之后，这里应该换过去。
     */
    backdrop-filter: var(--glass-blur, none);
    -webkit-backdrop-filter: var(--glass-blur, none);
}

/*
 * 第二行的高度必须与两侧栏的标题栏**同一个值**，否则三列的第一条横线彼此差几像素。
 * 之前这里是内容高度（26px 控件 + 2×6px 内边距 = 38px）而侧栏头写死 40px，差 2px——
 * 单独看谁都不像错的，并排就是没对齐。两边现在都取 --control-h-lg。
 */
.lab-bar--tight {
    height: var(--control-h-lg);
    /* 比顶栏挤一档：这一条上摆的是画布的四个旋钮，它们是一组，
       用顶栏那档间距会把它们读成四件互不相干的东西 */
    gap: var(--space-4);
    padding: 0 var(--panel-p);
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

.lab-data {
    display: flex;
    height: 100%;
    flex-direction: column;
    gap: var(--space-4);
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
</style>
