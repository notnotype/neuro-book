<script setup lang="ts">
/**
 * Workbench / View Host 探针（Lab-only，不接产品）。
 *
 * 它要证伪/证实的假设（对应 Issue #192 的设计门）：
 * 1. descriptor（id / titleKey / icon / container / layout / when / factoryKey）能否驱动容器与 View；
 * 2. View 跨容器移动时，顺序、可见性、尺寸是否能保持在宿主手里；
 * 3. 布局快照（版本号 + clamp + 损坏回退）能否在重挂后恢复；
 * 4. 失败边界：空 registry、重复 id、context 不可用、factory 抛错、异步迟到结果 —— 是否都能**只坏一个 View**。
 *
 * 刻意的简化：View 内容是占位组件（证明布局合同，不证明真实 View）；持久化用模块级快照模拟存储；
 * factory 解析器只有第一方映射，但保留 `factoryKey → resolver` 间接层（将来接第三方时不改 descriptor）。
 */
import {computed, onMounted, ref} from "vue";
import {Button} from "@notnotype/nb-ui/components";

const props = defineProps<{scene: string; data?: unknown}>();

type LayoutMode = "scroll" | "fill";
type ViewId = string;

/** 结构化可见性谓词：宿主可校验、可解释、可列出原因；刻意不用字符串表达式。 */
type ViewWhen = {requires?: Array<"project" | "selection">};

type ViewDescriptor = {
    id: ViewId;
    titleKey: string;
    icon: string;
    container: string;
    layout: LayoutMode;
    when?: ViewWhen;
    factoryKey: string;
};

type ContainerDescriptor = {id: string; titleKey: string; side: "left" | "bottom"};

const t = (key: string): string => ({
    "spike.sidebar": "侧栏容器",
    "spike.panel": "底部面板",
    "spike.explorer": "文件",
    "spike.outline": "大纲",
    "spike.characters": "角色",
    "spike.plot": "情节",
    "spike.problems": "问题",
    "spike.trace": "请求轨迹",
    "spike.projectOnly": "只在打开项目后可用",
    "spike.needsSelection": "需要先选中一个条目",
}[key] ?? key);

/** 第一方 factory 映射；解析器返回组件或抛错（探针用同一占位组件演示布局，真实实现会各自绑组件）。 */
const factories: Record<string, unknown> = {
    "stub.scroll": {kind: "scroll"},
    "stub.fill": {kind: "fill"},
    "stub.broken": null,
};

function resolveFactory(factoryKey: string): unknown {
    const factory = factories[factoryKey];
    if (!factory) {
        throw new Error(`factoryKey 无法解析：${factoryKey}`);
    }
    return factory;
}

const containers: ContainerDescriptor[] = [
    {id: "sidebar", titleKey: "spike.sidebar", side: "left"},
    {id: "panel", titleKey: "spike.panel", side: "bottom"},
];

const allDescriptors: ViewDescriptor[] = [
    {id: "explorer", titleKey: "spike.explorer", icon: "i-lucide-files", container: "sidebar", layout: "scroll", factoryKey: "stub.scroll"},
    {id: "outline", titleKey: "spike.outline", icon: "i-lucide-list-tree", container: "sidebar", layout: "scroll", factoryKey: "stub.scroll"},
    {id: "characters", titleKey: "spike.characters", icon: "i-lucide-users", container: "sidebar", layout: "fill", when: {requires: ["project"]}, factoryKey: "stub.fill"},
    {id: "plot", titleKey: "spike.plot", icon: "i-lucide-git-branch", container: "panel", layout: "fill", when: {requires: ["project", "selection"]}, factoryKey: "stub.fill"},
    {id: "problems", titleKey: "spike.problems", icon: "i-lucide-alert-triangle", container: "panel", layout: "scroll", factoryKey: "stub.scroll"},
    {id: "trace", titleKey: "spike.trace", icon: "i-lucide-activity", container: "panel", layout: "scroll", factoryKey: "stub.broken"},
];

/** 场景：同一套描述符，换数据与开关，逐个观察失败边界。 */
type SceneKey = "normal" | "empty" | "duplicate" | "context-unavailable" | "factory-error" | "stale-async" | "corrupt-layout";
const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["normal", "empty", "duplicate", "context-unavailable", "factory-error", "stale-async", "corrupt-layout"];
    return known.find((key) => key === props.scene) ?? "normal";
});

const context = ref({project: true, selection: false});

/** 宿主上下文是否满足 descriptor 的 when；不满足时给出原因，View 不可选。 */
function unavailableReason(descriptor: ViewDescriptor): string | null {
    const requires = descriptor.when?.requires ?? [];
    if (requires.includes("project") && !context.value.project) {
        return t("spike.projectOnly");
    }
    if (requires.includes("selection") && !context.value.selection) {
        return t("spike.needsSelection");
    }
    return null;
}

/** 布局快照：宿主拥有顺序/可见性/尺寸；version 用于丢弃不兼容快照。 */
type LayoutSnapshot = {version: number; order: Record<string, ViewId[]>; hidden: ViewId[]; sizes: Record<string, number>};
const LAYOUT_VERSION = 1;
const SIZE_MIN = 160;

const descriptors = computed<ViewDescriptor[]>(() => {
    if (sceneKey.value === "empty") {
        return [];
    }
    if (sceneKey.value === "duplicate") {
        // 故意重复：宿主必须能观察并拒绝，而不是静默取后一个
        return [...allDescriptors, {...allDescriptors[0]!, container: "panel"}];
    }
    return allDescriptors;
});

const duplicateIds = computed<ViewId[]>(() => {
    const seen = new Set<ViewId>();
    const duplicated = new Set<ViewId>();
    for (const descriptor of descriptors.value) {
        if (seen.has(descriptor.id)) {
            duplicated.add(descriptor.id);
        }
        seen.add(descriptor.id);
    }
    return [...duplicated];
});

function defaultSnapshot(): LayoutSnapshot {
    const order: Record<string, ViewId[]> = {};
    for (const container of containers) {
        order[container.id] = descriptors.value.filter((item) => item.container === container.id).map((item) => item.id);
    }
    return {version: LAYOUT_VERSION, order, hidden: [], sizes: {}};
}

const layout = ref<LayoutSnapshot>(defaultSnapshot());
const layoutNotice = ref("");

/** 模拟「重挂后恢复」：从模块级快照读回，校验版本与引用，损坏则回默认并说明原因。 */
let persisted: LayoutSnapshot | null = null;

function persist() {
    persisted = JSON.parse(JSON.stringify(layout.value)) as LayoutSnapshot;
}

function restore() {
    if (!persisted) {
        layoutNotice.value = "没有已保存的布局，保持当前状态。";
        return;
    }
    const snapshot = JSON.parse(JSON.stringify(persisted)) as LayoutSnapshot;
    const knownIds = new Set(descriptors.value.map((item) => item.id));
    if (snapshot.version !== LAYOUT_VERSION) {
        layout.value = defaultSnapshot();
        layoutNotice.value = `布局快照版本 ${String(snapshot.version)} 不受支持，已回默认。`;
        return;
    }
    const dangling = Object.values(snapshot.order).flat().filter((id) => !knownIds.has(id));
    if (dangling.length > 0) {
        layout.value = defaultSnapshot();
        layoutNotice.value = `布局快照引用了不存在的 View（${dangling.join("、")}），已回默认。`;
        return;
    }
    const clamped: string[] = [];
    for (const [containerId, size] of Object.entries(snapshot.sizes)) {
        if (size < SIZE_MIN) {
            snapshot.sizes[containerId] = SIZE_MIN;
            clamped.push(containerId);
        }
    }
    layout.value = snapshot;
    layoutNotice.value = clamped.length > 0 ? `尺寸越过下限，已夹到 ${String(SIZE_MIN)}px。` : "已从快照恢复。";
}

function simulateCorruptLayout() {
    persisted = {version: 99, order: {sidebar: ["ghost-view"]}, hidden: [], sizes: {sidebar: 40}};
    restore();
}

const visibleDescriptors = computed(() => descriptors.value.filter((item) => !layout.value.hidden.includes(item.id)));

function viewsOf(containerId: string): ViewDescriptor[] {
    const order = layout.value.order[containerId] ?? [];
    return visibleDescriptors.value
        .filter((item) => item.container === containerId)
        .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

function toggleHidden(id: ViewId) {
    layout.value.hidden = layout.value.hidden.includes(id)
        ? layout.value.hidden.filter((item) => item !== id)
        : [...layout.value.hidden, id];
}

/** 跨容器移动：目标容器追加，源容器按剩余顺序压实；尺寸仍由宿主 clamp。 */
function moveTo(id: ViewId, containerId: string) {
    for (const list of Object.values(layout.value.order)) {
        const index = list.indexOf(id);
        if (index >= 0) {
            list.splice(index, 1);
        }
    }
    layout.value.order[containerId] = [...(layout.value.order[containerId] ?? []), id];
    const descriptor = descriptors.value.find((item) => item.id === id);
    if (descriptor) {
        descriptor.container = containerId;
    }
}

function moveWithin(id: ViewId, delta: number) {
    for (const list of Object.values(layout.value.order)) {
        const index = list.indexOf(id);
        const target = index + delta;
        if (index >= 0 && target >= 0 && target < list.length) {
            [list[index], list[target]] = [list[target]!, list[index]!];
        }
    }
}

function resize(containerId: string, delta: number) {
    const next = (layout.value.sizes[containerId] ?? 220) + delta;
    layout.value.sizes[containerId] = Math.max(SIZE_MIN, next);
}

// —— 异步迟到结果：切 View 后旧结果必须被丢弃（而不是写进当前 View） ——
const asyncToken = ref(0);
const asyncState = ref<{token: number; text: string; discarded: boolean} | null>(null);
const asyncTarget = ref<ViewId>("problems");

function startStaleAsync() {
    asyncToken.value += 1;
    const token = asyncToken.value;
    setTimeout(() => {
        asyncState.value = token === asyncToken.value
            ? {token, text: `结果属于 ${asyncTarget.value}`, discarded: false}
            : {token, text: `来自旧请求 #${String(token)}（当前 #${String(asyncToken.value)}）`, discarded: true};
    }, 700);
}

onMounted(() => {
    if (sceneKey.value === "corrupt-layout") {
        simulateCorruptLayout();
    }
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-[var(--space-4)]" data-lab-subject>
        <div class="flex flex-wrap items-center gap-[var(--space-3)] text-[var(--text-xs)] text-[var(--text-secondary)]">
            <span>场景：{{ sceneKey }}</span>
            <Button size="sm" variant="secondary" @click="context.project = !context.project">项目：{{ context.project ? "有" : "无" }}</Button>
            <Button size="sm" variant="secondary" @click="context.selection = !context.selection">选中项：{{ context.selection ? "有" : "无" }}</Button>
            <Button size="sm" variant="secondary" @click="persist(); layoutNotice = '已保存布局。'">保存布局</Button>
            <Button size="sm" variant="secondary" @click="restore()">恢复布局</Button>
            <Button v-if="sceneKey === 'corrupt-layout'" size="sm" variant="secondary" @click="simulateCorruptLayout">注入损坏快照</Button>
            <Button v-if="sceneKey === 'stale-async'" size="sm" variant="secondary" @click="asyncTarget = asyncTarget === 'problems' ? 'trace' : 'problems'; startStaleAsync()">发起迟到请求</Button>
        </div>

        <p v-if="layoutNotice" class="text-[var(--text-xs)] text-[var(--text-secondary)]">{{ layoutNotice }}</p>
        <p v-if="duplicateIds.length > 0" class="text-[var(--text-xs)] text-[var(--text-main)]">
            宿主拒绝渲染重复 id：{{ duplicateIds.join("、") }}（其余 View 正常）
        </p>
        <p v-if="sceneKey === 'empty'" class="text-[var(--text-xs)] text-[var(--text-secondary)]">空 registry：没有任何 View 注册，宿主显示空态而不是崩溃。</p>

        <div class="flex min-h-0 flex-1 gap-[var(--space-4)]">
            <div
                v-for="container in containers"
                :key="container.id"
                class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-control)] border border-[var(--divider)]"
            >
                <div class="flex shrink-0 items-center justify-between gap-[var(--space-2)] border-b border-[var(--divider)] px-[var(--space-4)] py-[var(--space-2)]">
                    <span class="text-[var(--text-xs)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">{{ t(container.titleKey) }}</span>
                    <span class="flex items-center gap-[var(--space-1)]">
                        <span class="text-[var(--text-2xs)] text-[var(--text-muted)]">{{ layout.sizes[container.id] ?? 220 }}px</span>
                        <Button size="sm" variant="secondary" @click="resize(container.id, -60)">−</Button>
                        <Button size="sm" variant="secondary" @click="resize(container.id, 60)">＋</Button>
                    </span>
                </div>

                <ul class="flex min-h-0 flex-1 flex-col gap-[var(--space-2)] overflow-y-auto p-[var(--space-3)]">
                    <li v-for="view in viewsOf(container.id)" :key="view.id" class="min-w-0">
                        <div
                            class="flex min-w-0 flex-col gap-[var(--space-2)] rounded-[var(--radius-control)] bg-[var(--bg-subtle)] p-[var(--space-3)]"
                            :class="view.layout === 'fill' ? 'h-32' : ''"
                        >
                            <div class="flex min-w-0 items-center justify-between gap-[var(--space-2)]">
                                <span class="flex min-w-0 items-center gap-[var(--space-2)]">
                                    <span :class="view.icon" class="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                                    <span class="truncate text-[var(--text-xs)] [font-weight:var(--weight-medium)] text-[var(--text-main)]">{{ t(view.titleKey) }}</span>
                                    <span class="shrink-0 text-[var(--text-2xs)] text-[var(--text-muted)]">{{ view.layout }}</span>
                                </span>
                                <span class="flex shrink-0 items-center gap-[var(--space-1)]">
                                    <Button size="sm" variant="secondary" @click="moveWithin(view.id, -1)">↑</Button>
                                    <Button size="sm" variant="secondary" @click="moveWithin(view.id, 1)">↓</Button>
                                    <Button
                                        v-for="target in containers.filter((item) => item.id !== container.id)"
                                        :key="target.id"
                                        size="sm"
                                        variant="secondary"
                                        @click="moveTo(view.id, target.id)"
                                    >
                                        移到{{ t(target.titleKey) }}
                                    </Button>
                                    <Button size="sm" variant="secondary" @click="toggleHidden(view.id)">隐藏</Button>
                                </span>
                            </div>

                            <p v-if="unavailableReason(view) && sceneKey !== 'factory-error'" class="text-[var(--text-2xs)] text-[var(--text-muted)]">
                                不可用：{{ unavailableReason(view) }}
                            </p>

                            <div
                                v-else-if="sceneKey === 'factory-error'"
                                class="rounded-[var(--radius-control)] border border-dashed border-[var(--divider)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-2xs)] text-[var(--text-secondary)]"
                            >
                                <template v-if="view.factoryKey === 'stub.broken'">factory 解析失败：只坏这一个 View，其他继续工作</template>
                                <template v-else>factory 正常</template>
                            </div>

                            <div
                                v-else
                                class="min-h-0 flex-1 rounded-[var(--radius-control)] border border-dashed border-[var(--divider)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-2xs)] text-[var(--text-secondary)]"
                            >
                                <template v-if="sceneKey === 'stale-async' && view.id === asyncTarget">
                                    当前目标；{{ asyncState ? asyncState.text : "尚未收到结果" }}
                                    <span v-if="asyncState?.discarded" class="text-[var(--text-main)]"> → 已丢弃（不写入当前 View）</span>
                                </template>
                                <template v-else>{{ view.layout === "fill" ? "fill：自己占满并管理内部滚动" : "scroll：外壳给内边距并拥有滚动" }}</template>
                            </div>
                        </div>
                    </li>
                    <li v-if="viewsOf(container.id).length === 0" class="px-[var(--space-3)] py-[var(--space-4)] text-[var(--text-2xs)] text-[var(--text-muted)]">
                        此容器没有可见 View
                    </li>
                </ul>

                <div v-if="layout.hidden.length > 0" class="shrink-0 border-t border-[var(--divider)] px-[var(--space-3)] py-[var(--space-2)]">
                    <span class="text-[var(--text-2xs)] text-[var(--text-muted)]">已隐藏：</span>
                    <Button v-for="id in layout.hidden" :key="id" size="sm" variant="secondary" @click="toggleHidden(id)">{{ id }}</Button>
                </div>
            </div>
        </div>
    </div>
</template>
