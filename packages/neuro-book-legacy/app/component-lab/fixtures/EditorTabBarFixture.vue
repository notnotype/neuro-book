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
import {computed, ref} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";
import EditorDragProvider from "nbook/app/components/editor-workbench/EditorDragProvider.vue";
import EditorTabBar from "nbook/app/components/editor-workbench/EditorTabBar.vue";
import EditorToolbar from "nbook/app/components/editor-workbench/EditorToolbar.vue";
import type {EditorTabDropPosition, EditorTabPresentation} from "nbook/app/components/editor-workbench/editor-view.types";
import {reorderTab, type EditorSessionState, type EditorSessionTab} from "nbook/app/utils/editor-workbench/editor-session";
import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EditorTabBar>(() => props.input);
const emitLabEvent = useLabEventSink();
const tabs = computed(() => (props.input?.props?.tabs ?? []) as EditorTabPresentation[]);
const activePath = computed(() => (props.input?.props?.activePath ?? "") as string);
const wrapTabs = computed(() => props.input?.props?.wrap !== false);
const lastEvent = ref("—");

function updateTabs(next: EditorTabPresentation[]): void {
    subject.write("props", "tabs", next);
}

function toggleWrap(): void {
    subject.write("props", "wrap", !wrapTabs.value);
}

function handleSelectTab(path: string): void {
    subject.write("props", "activePath", path);
    lastEvent.value = `select-tab ${path}`;
    emitLabEvent("select-tab", path);
}

function handleCloseTab(path: string): void {
    const index = tabs.value.findIndex((tab) => tab.path === path);
    if (index === -1) {
        return;
    }
    const wasActive = path === activePath.value;
    updateTabs(tabs.value.filter((tab) => tab.path !== path));
    // 关掉当前标签就把焦点交给接替的邻居，与真实宿主的相邻接管一致；
    // 一个都不剩时 activePath 清空，标签栏会随之发出 empty-focus。
    // 脏文件的关闭确认属于宿主策略，这个夹具不做，要观察的是标签栏有没有把意图说出来。
    if (wasActive) {
        subject.write("props", "activePath", tabs.value[Math.min(index, tabs.value.length - 1)]?.path ?? "");
    }
    lastEvent.value = `close-tab ${path}`;
    emitLabEvent("close-tab", path);
}

function handleKeepTab(path: string): void {
    // preview 是只读字段，只能换掉整个条目而不是就地赋值。
    updateTabs(tabs.value.map((tab) => tab.path === path ? {...tab, preview: false} : tab));
    lastEvent.value = `keep-tab ${path}`;
    emitLabEvent("keep-tab", path);
}

function handleSetPin(path: string, pinned: boolean): void {
    if (!tabs.value.some((tab) => tab.path === path)) {
        return;
    }
    // 固定是标签实例自己的字段：就地应用后固定区与普通区会各自重新分区，取消固定能直接看出来。
    updateTabs(tabs.value.map((tab) => tab.path === path ? {...tab, pinned} : tab));
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
    updateTabs(next);

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
                v-bind="subject.bindings.value"
                @select-tab="handleSelectTab"
                @close-tab="handleCloseTab"
                @set-pin="handleSetPin"
                @keep-tab="handleKeepTab"
                @move-tab="handleMoveTab"
                @empty-focus="handleEmptyFocus"
            >
                <template v-if="subject.slots.value.trailing" #trailing>
                    <!-- 可见的多行开关：与「标签布局」菜单里的同一项共享本地状态，窄屏点一下就能切换 -->
                    <IconButton
                        icon-class="i-lucide-wrap-text"
                        size="sm"
                        :variant="wrapTabs ? 'accent' : 'default'"
                        title="多行标签"
                        aria-label="多行标签"
                        :aria-pressed="wrapTabs"
                        class="editor-tab-bar-fixture-wrap-tabs cursor-pointer"
                        @click="toggleWrap"
                    />
                    <EditorToolbar
                        :menus="[{id: 'layout', label: '标签布局', items: [{value: 'wrap', label: '多行标签', type: 'checkbox', checked: wrapTabs}]}]"
                        @select="toggleWrap"
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
