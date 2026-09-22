<script setup lang="ts">
/**
 * EditorTabBar 的 Lab 场景。
 *
 * 演示重点：
 * 1. 分区几何：单行固定区与普通区以底色/分隔区分，固定区不接收拖入；多行两区独立换行；
 *    唯一外层滚动宿主，不在起拖时新增空固定落区或改变布局；
 * 2. 标签状态：固定、未保存脏点、预览斜体、图标与超长标题单行截断；
 * 3. 宿主视角：标签栏只表达意图，夹具扮演宿主把与本地列表直接相关的意图（选中 / 关闭 / 保留预览 /
 *    固定 / 组内换位）就地应用——换位复用会话模块的纯排序函数，夹具不另写一套排序规则；
 *    需要产品策略的部分（脏文件关闭确认、落库、跨组搬运）仍然只透传给 Lab 事件面板；
 * 4. 拖动会话：`EditorDragProvider` 是真实宿主（它登记落点、解析命中共画公共反馈并把 move/transfer/split
 *    意图发出来），标签栏自己不认识落点；夹具把 Provider 与标签栏发出的意图都转给同一个 handleMoveTab；
 * 5. 边界摆法：只有固定标签、只有预览加脏标签，用来确认分组与选中态在极端组合下仍然成立；
 * 6. 多行开关：默认多行，标签栏尾部的可见按钮（aria-pressed）与「标签布局」菜单共用同一个本地状态，
 *    窄屏下不必先展开菜单就能验证换行。
 */
import {ref, watch} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";
import EditorDragProvider from "nbook/app/components/editor-workbench/EditorDragProvider.vue";
import EditorTabBar from "nbook/app/components/editor-workbench/EditorTabBar.vue";
import EditorToolbar from "nbook/app/components/editor-workbench/EditorToolbar.vue";
import type {EditorTabDropPosition, EditorTabPresentation} from "nbook/app/components/editor-workbench/editor-view.types";
import {reorderTab, type EditorSessionState, type EditorSessionTab} from "nbook/app/utils/editor-workbench/editor-session";
import {useLabEventSink} from "../lab-event-sink";

/** Lab 宿主会传场景数据；这四个场景不登记 data，夹具不消费它。 */
const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();

type SceneKey = "mixed" | "overflow" | "pinned-only" | "single-preview";

type SceneSeed = Readonly<{tabs: EditorTabPresentation[]; activePath: string}>;

const SCENE_KEYS: SceneKey[] = ["mixed", "overflow", "pinned-only", "single-preview"];

/** 假项目沿用 EditorWorkbenchFixture 的同一套路径，两个夹具在 Lab 里看起来是同一个工作区。 */
const MIXED_TABS: EditorTabPresentation[] = [
    {path: "docs/architecture.md", title: "architecture.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "src/config/app.json", title: "app.json", pinned: true, preview: false, dirty: true, iconClass: "i-lucide-file-code-2"},
    {path: "src/story/chapter-01.md", title: "chapter-01.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "src/story/chapter-02.md", title: "chapter-02.md", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-text"},
    {path: "src/notes/quick-draft.txt", title: "quick-draft.txt", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file"},
];

// 标题用相对路径而不是文件名：标签最大宽度 200px，长路径必然截断，横向滚动才有东西可滚。
const OVERFLOW_TABS: EditorTabPresentation[] = [
    {path: "docs/specifications/2026-09-16-editor-workbench-architecture-and-view-host-contract-specification.md", title: "docs/specifications/2026-09-16-editor-workbench-architecture-and-view-host-contract-specification.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "packages/neuro-book/app/components/editor-workbench/EditorTabBar.vue", title: "packages/neuro-book/app/components/editor-workbench/EditorTabBar.vue", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/components/editor-workbench/EditorToolbar.vue", title: "packages/neuro-book/app/components/editor-workbench/EditorToolbar.vue", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/components/editor-workbench/EditorWorkbench.vue", title: "packages/neuro-book/app/components/editor-workbench/EditorWorkbench.vue", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/components/editor-workbench/editor-view.types.ts", title: "packages/neuro-book/app/components/editor-workbench/editor-view.types.ts", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/shared/theme/theme-axes.ts", title: "packages/neuro-book/shared/theme/theme-axes.ts", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/utils/theme/theme-session.ts", title: "packages/neuro-book/app/utils/theme/theme-session.ts", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/component-lab/fixtures/EditorWorkbenchFixture.vue", title: "packages/neuro-book/app/component-lab/fixtures/EditorWorkbenchFixture.vue", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "packages/neuro-book/app/components/novel-ide/settings/sections/providers/components/ProviderSettingsViewFixtureLongPathComponentName.vue", title: "packages/neuro-book/app/components/novel-ide/settings/sections/providers/components/ProviderSettingsViewFixtureLongPathComponentName.vue", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "assets/workspace/deeply/nested/directory/structure/with-multiple-submodules/long-configuration-matrix-sample.json", title: "assets/workspace/deeply/nested/directory/structure/with-multiple-submodules/long-configuration-matrix-sample.json", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
    {path: "src/story/volumes/volume-03/chapters/chapter-017-the-clockmakers-secret-room-draft.md", title: "src/story/volumes/volume-03/chapters/chapter-017-the-clockmakers-secret-room-draft.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "src/notes/2026-09-17-editor-tab-bar-scroll-and-truncation-manual-verification-checklist.txt", title: "src/notes/2026-09-17-editor-tab-bar-scroll-and-truncation-manual-verification-checklist.txt", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file"},
];

const PINNED_ONLY_TABS: EditorTabPresentation[] = [
    {path: "docs/architecture.md", title: "architecture.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "src/config/app.json", title: "app.json", pinned: true, preview: false, dirty: true, iconClass: "i-lucide-file-code-2"},
    {path: "src/story/chapter-01.md", title: "chapter-01.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "packages/neuro-book/app/components/editor-workbench/EditorTabBar.vue", title: "EditorTabBar.vue", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
];

const SINGLE_PREVIEW_TABS: EditorTabPresentation[] = [
    {path: "docs/outline.md", title: "outline.md", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "src/story/chapter-03.md", title: "chapter-03.md", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-text"},
];

/** 场景初值只登记在这里一处：`fixtures/index.ts` 不给这些场景登记 data，Lab 数据面板对它们不可编辑。 */
const SCENE_SEEDS: Record<SceneKey, SceneSeed> = {
    "mixed": {tabs: MIXED_TABS, activePath: "src/story/chapter-02.md"},
    "overflow": {tabs: OVERFLOW_TABS, activePath: "src/notes/2026-09-17-editor-tab-bar-scroll-and-truncation-manual-verification-checklist.txt"},
    "pinned-only": {tabs: PINNED_ONLY_TABS, activePath: "src/config/app.json"},
    "single-preview": {tabs: SINGLE_PREVIEW_TABS, activePath: "docs/outline.md"},
};

function resolveScene(scene: string): SceneKey {
    return SCENE_KEYS.find((key) => key === scene) ?? "mixed";
}


const tabs = ref<EditorTabPresentation[]>([]);
const activePath = ref("");
const lastEvent = ref("—");
/** 与 EditorGroup 一致：默认多行，场景重置时回到多行而不是沿用上一次的手动切换。 */
const wrapTabs = ref(true);

function applyScene(): void {
    const seed = SCENE_SEEDS[resolveScene(props.scene)];
    // 拷贝一份：双击保留预览要改标签对象，登记初值不能被就地污染。
    tabs.value = seed.tabs.map((tab) => ({...tab}));

    // 活动路径必须真的在列表里：否则每一行的 aria-selected 都是 false，
    // 看起来像「没有选中项」，而不是「指向了不存在的标签」。
    activePath.value = tabs.value.some((tab) => tab.path === seed.activePath)
        ? seed.activePath
        : (tabs.value[0]?.path ?? "");
    lastEvent.value = "—";
    // 换场景就是换一份初值：多行开关也回到默认，免得沿用上一次的比较结果。
    wrapTabs.value = true;
}

watch(() => props.scene, applyScene, {immediate: true});

function handleSelectTab(path: string): void {
    activePath.value = path;
    lastEvent.value = `select-tab ${path}`;
    emitLabEvent("select-tab", path);
}

function handleCloseTab(path: string): void {
    const index = tabs.value.findIndex((tab) => tab.path === path);
    if (index === -1) {
        return;
    }
    const wasActive = path === activePath.value;
    tabs.value = tabs.value.filter((tab) => tab.path !== path);
    // 关掉当前标签就把焦点交给接替的邻居，与真实宿主的相邻接管一致；
    // 一个都不剩时 activePath 清空，标签栏会随之发出 empty-focus。
    // 脏文件的关闭确认属于宿主策略，这个夹具不做，要观察的是标签栏有没有把意图说出来。
    if (wasActive) {
        activePath.value = tabs.value[Math.min(index, tabs.value.length - 1)]?.path ?? "";
    }
    lastEvent.value = `close-tab ${path}`;
    emitLabEvent("close-tab", path);
}

function handleKeepTab(path: string): void {
    // preview 是只读字段，只能换掉整个条目而不是就地赋值。
    tabs.value = tabs.value.map((tab) => tab.path === path ? {...tab, preview: false} : tab);
    lastEvent.value = `keep-tab ${path}`;
    emitLabEvent("keep-tab", path);
}

function handleSetPin(path: string, pinned: boolean): void {
    if (!tabs.value.some((tab) => tab.path === path)) {
        return;
    }
    // 固定是标签实例自己的字段：就地应用后固定区与普通区会各自重新分区，取消固定能直接看出来。
    tabs.value = tabs.value.map((tab) => tab.path === path ? {...tab, pinned} : tab);
    lastEvent.value = `set-pin ${path} → ${pinned ? "固定" : "取消固定"}`;
    emitLabEvent("set-pin", {path, pinned});
}

/**
 * 组内换位复用会话模块的纯排序函数：把要验证的那一步（顺序 + pin 分区归属）真跑一遍，
 * 夹具不另写一套排序规则，也不接 Store。只在本组内重排——跨组搬运属于宿主策略，这里不做。
 */
function handleMoveTab(path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void {
    const sessionTabs: EditorSessionTab[] = tabs.value.map((tab) => ({
        path: tab.path,
        title: tab.title,
        editorId: null,
        pinned: tab.pinned,
        preview: tab.preview,
    }));
    const session: EditorSessionState = {
        groups: [{id: "primary", activePath: activePath.value, tabs: sessionTabs}],
        activeGroupId: "primary",
    };

    const moved = reorderTab(session, "primary", path, targetPath, targetPinned, position);
    if (!moved.ok) {
        lastEvent.value = `move-tab 被拒绝：${moved.reason}`;
        emitLabEvent("move-tab", {path, targetPath, targetPinned, position, rejected: moved.reason});
        return;
    }

    // 呈现字段（图标 / 脏点 / 状态字）跟着路径走：排序只决定顺序，不重造标签。
    const order = moved.state.groups[0]?.tabs;
    if (!order || order.length === 0) {
        return;
    }
    const next: EditorTabPresentation[] = [];
    for (const tab of order) {
        const presentation = tabs.value.find((item) => item.path === tab.path);
        if (presentation) next.push({...presentation, pinned: tab.pinned, preview: tab.preview});
    }
    tabs.value = next;

    lastEvent.value = `move-tab ${path} → ${targetPath ?? "分区尾部"} (${position})`;
    emitLabEvent("move-tab", {path, targetPath, targetPinned, position});
}

function handleEmptyFocus(): void {
    lastEvent.value = "empty-focus（标签清空）";
    emitLabEvent("empty-focus");
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-[var(--panel-surface)] text-[var(--text-main)]">
        <!-- 真实标签栏支持单行滚动与多行换行（默认多行）；拖动由 Provider 求值，夹具把落点交给会话纯函数真排一次。 -->
        <EditorDragProvider
            :groups="[{id: 'primary', tabs}]"
            :allow-split="false"
            @move-tab="(_groupId, path, targetPath, targetPinned, position) => handleMoveTab(path, targetPath, targetPinned, position)"
        >
            <EditorTabBar
                data-lab-subject
                :tabs="tabs"
                :active-path="activePath"
                group-id="primary"
                :wrap="wrapTabs"
                @select-tab="handleSelectTab"
                @close-tab="handleCloseTab"
                @set-pin="handleSetPin"
                @keep-tab="handleKeepTab"
                @move-tab="handleMoveTab"
                @empty-focus="handleEmptyFocus"
            >
                <template #trailing>
                    <!-- 可见的多行开关：与「标签布局」菜单里的同一项共享本地状态，窄屏点一下就能切换 -->
                    <IconButton
                        icon-class="i-lucide-wrap-text"
                        size="sm"
                        :variant="wrapTabs ? 'accent' : 'default'"
                        title="多行标签"
                        aria-label="多行标签"
                        :aria-pressed="wrapTabs"
                        class="editor-tab-bar-fixture-wrap-tabs cursor-pointer"
                        @click="wrapTabs = !wrapTabs"
                    />
                    <EditorToolbar
                        :menus="[{id: 'layout', label: '标签布局', items: [{value: 'wrap', label: '多行标签', type: 'checkbox', checked: wrapTabs}]}]"
                        @select="wrapTabs = !wrapTabs"
                    />
                </template>
            </EditorTabBar>
        </EditorDragProvider>

        <!-- 标签栏以下的区域在产品里属于宿主正文，这里只留白，免得把中立区域误当成标签栏的一部分 -->
        <div class="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1.5 p-4 text-center">
            <p class="text-xs text-[var(--text-muted)]">宿主正文区占位：这个夹具只摆标签栏，不渲染编辑器内容。</p>
            <p class="text-[11px] text-[var(--text-muted)]">
                双击标签＝保留预览（preview 转普通） · 右键菜单＝固定 / 移动 / 关闭 · 拖动换位复用会话纯函数就地重排（不落库）
            </p>
        </div>

        <!-- 最近一次事件与当前 activePath：不开事件面板也能看出标签栏发出的意图有没有被宿主接受 -->
        <p class="shrink-0 border-t border-[var(--divider)] bg-[var(--bg-panel)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-secondary)]">
            最近事件：{{ lastEvent }} · activePath：{{ activePath || "（无）" }} · 标签数：{{ tabs.length }}
        </p>
    </div>
</template>
