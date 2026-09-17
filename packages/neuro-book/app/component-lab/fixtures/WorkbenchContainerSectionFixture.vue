<script setup lang="ts">
/**
 * WorkbenchContainerSection 的 Lab 场景：五档结构（scroll / fill / 受控折叠 / 空态 / 不可折叠）。
 *
 * 夹具在这里扮**宿主**：区段是卡片内的平铺分区，宽度、留白与纵向滚动都归宿主
 * （真实宿主是 `WorkbenchContainerSurface` 的 `--sections` 区，它自带 `overflow-y: auto`）。
 * 少了这一层，`scroll` 档的区段没有高度上限，它自己那条 `overflow-y` 永远不会滚；
 * `fill` 档也吸不到剩余高度（`flex: 1 1 0px` 在没有高度的父级里不成立）。
 *
 * 折叠走**受控**路径：夹具持 `collapsed`，不把状态让给组件的内部 state。
 * 组件对同一次点击同时发 `update:collapsed` 与 `toggle`，两条接到同一个处理函数，
 * 只有真改变本地态的那一次记账——否则一次点击会在事件面板里留两条记录。
 *
 * `data` 是登记初值：`title` / `contextLabel` / `rows` / `emptyText` 直接算进绑定，右栏改字立刻可见；
 * `collapsed` 也在 data 变时按 data 重取，右栏按「还原」后场景必须回到登记态。
 */
import {computed, ref, watch} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";
import WorkbenchContainerSection from "nbook/app/components/workbench/WorkbenchContainerSection.vue";
import type {ViewLayoutMode} from "nbook/app/utils/workbench/descriptors";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();

type SceneKey = "scroll" | "collapsed" | "fill" | "empty-text" | "no-collapse";

type SceneSpec = {
    /** 场景的排版合同 */
    layout: ViewLayoutMode;
    /** 头部是否可折叠 */
    collapsible: boolean;
    /** 是否摆内容；空态场景不摆，让 emptyText 自己触发组件的空态判定 */
    hasBody: boolean;
    /** 上下文标签走具名插槽还是 prop：两条路径各要有用例 */
    contextSlot: boolean;
    /** 头部动作区是否出现 */
    actions: boolean;
    /** data 缺字段时的缺省文案与行数（右栏把 JSON 改坏时场景仍然成立） */
    fallback: {title: string; contextLabel: string; rows: number; collapsed: boolean};
};

/**
 * 五档结构表：场景管结构，右栏 data 管文案与行数。
 *
 * 不可折叠那档不摆动作：头部此时是 `disabled` 的 button，动作槽在它里面，按钮跟着点不动——
 * 摆上去只会让人以为动作是坏的；要验这条得先改组件头部的结构。
 */
const SCENES: Record<SceneKey, SceneSpec> = {
    scroll: {
        layout: "scroll",
        collapsible: true,
        hasBody: true,
        contextSlot: false,
        actions: true,
        fallback: {title: "工具", contextLabel: "40 条", rows: 40, collapsed: false},
    },
    collapsed: {
        layout: "scroll",
        collapsible: true,
        hasBody: true,
        contextSlot: false,
        actions: true,
        fallback: {title: "大纲", contextLabel: "7 章节", rows: 7, collapsed: true},
    },
    fill: {
        layout: "fill",
        collapsible: true,
        hasBody: true,
        contextSlot: true,
        actions: true,
        fallback: {title: "对话记录", contextLabel: "", rows: 40, collapsed: false},
    },
    "empty-text": {
        layout: "scroll",
        collapsible: true,
        hasBody: false,
        contextSlot: false,
        actions: true,
        fallback: {title: "关联引用", contextLabel: "0 项", rows: 0, collapsed: false},
    },
    "no-collapse": {
        layout: "scroll",
        collapsible: false,
        hasBody: true,
        contextSlot: false,
        actions: false,
        fallback: {title: "工作区信息", contextLabel: "只读", rows: 4, collapsed: false},
    },
};

const SCENE_KEYS = Object.keys(SCENES) as SceneKey[];

/** 未知 id 按第一档摆：Lab 传错场景名时不该白屏。 */
const sceneKey = computed<SceneKey>(() => {
    const scene = props.scene;
    return SCENE_KEYS.includes(scene as SceneKey) ? scene as SceneKey : "scroll";
});

const spec = computed(() => SCENES[sceneKey.value]);

/** 右栏的 JSON 可以被改成任何东西，读 data 一律带守卫。 */
function dataRecord(): Record<string, unknown> {
    const data = props.data;
    return typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
}

/** 空串按未填处理：清空标题会让头部退化成一个没有名字的按钮，那不是在检视这个零件。 */
function readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value !== "" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/** 行数上限：JSON 里填个十万行会把 Lab 卡死，夹具自己兜住。 */
const ROW_LIMIT = 200;

function readRows(value: unknown, fallback: number): number {
    const count = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
    return Math.min(ROW_LIMIT, Math.max(0, count));
}

const knobs = computed(() => {
    const data = dataRecord();
    return {
        title: readString(data.title, spec.value.fallback.title),
        contextLabel: readString(data.contextLabel, spec.value.fallback.contextLabel),
        emptyText: readString(data.emptyText, "暂无内容"),
        rows: readRows(data.rows, spec.value.fallback.rows),
    };
});

/** 中性演示行：只用来量几何与滚动归属，不承载业务含义。 */
const rows = computed(() => Array.from({length: knobs.value.rows}, (_, index) => index + 1));

const collapsed = ref(false);

// data 也要看：右栏改了字或按了「还原」都得重摆一次，场景才算确定性。
watch([() => props.scene, () => props.data], applyScene, {immediate: true});

function applyScene(): void {
    collapsed.value = readBoolean(dataRecord().collapsed, spec.value.fallback.collapsed);
}

/**
 * 组件的 `toggle` 与 `update:collapsed` 是同一次点击的两条通知：只认先到的那条。
 * 后到的一条进来时本地态已经等于新值，再记一次，事件面板会显示成点了两下。
 */
function onCollapsedChange(value: boolean): void {
    if (collapsed.value === value) {
        return;
    }
    collapsed.value = value;
    emitLabEvent("toggle", value);
}

/** 动作槽里的按钮。不补 `stopPropagation`：折叠与否由组件头部那层 `@click.stop` 保证。 */
function onAction(name: string): void {
    emitLabEvent("action", name);
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-[var(--panel-surface)]">
        <!--
            宿主的区段列表区：区段自己不写宽度、不写外边距，纵向滚动也归这里
            （口径同 WorkbenchContainerSurface 的 `--sections`：`overflow-y: auto`）。
        -->
        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <WorkbenchContainerSection
                data-lab-subject
                id="lab-section"
                :title="knobs.title"
                :context-label="knobs.contextLabel"
                :collapsible="spec.collapsible"
                :collapsed="collapsed"
                :layout="spec.layout"
                :empty-text="knobs.emptyText"
                @update:collapsed="onCollapsedChange"
                @toggle="onCollapsedChange"
            >
                <!-- 空态那档整块插槽都不给：组件的空态判定正是「没有内容槽 + 有 emptyText」。 -->
                <template v-if="spec.hasBody" #default>
                    <!--
                        fill 档：区段只裁切（body--fill 没有 padding 且 overflow: hidden），
                        留白与滚动都归内容——这里内容自己给一条滚动区，再加一行自己的头部。
                    -->
                    <div v-if="spec.layout === 'fill'" class="flex min-h-0 flex-1 flex-col">
                        <p class="flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--divider)] px-[var(--space-2)] py-[var(--space-2)] text-[var(--text-2xs)] text-[var(--text-muted)]">
                            内容自己的头部与留白
                            <span class="ml-auto whitespace-nowrap tabular-nums">{{ rows.length }} 条</span>
                        </p>
                        <ul class="flex min-h-0 flex-1 flex-col gap-[var(--space-1)] overflow-y-auto p-[var(--space-2)]">
                            <li
                                v-for="row in rows"
                                :key="row"
                                class="flex min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            >
                                <span class="i-lucide-message-square h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                                <span class="min-w-0 truncate">示例条目 {{ row }}</span>
                            </li>
                        </ul>
                    </div>

                    <!--
                        scroll 档：留白与滚动归区段自己（body--scroll 已带 padding 与 overflow-y），
                        内容只摆条目，不自带内边距。
                    -->
                    <ul v-else class="flex min-w-0 flex-col gap-[var(--space-1)]">
                        <li
                            v-for="row in rows"
                            :key="row"
                            class="flex min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                            <span class="i-lucide-file-text h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                            <span class="min-w-0 truncate">示例条目 {{ row }}</span>
                        </li>
                    </ul>
                </template>

                <!--
                    动作槽：点它**不该**折叠。组件在槽外层写了 `@click.stop`，夹具因此不加任何拦截——
                    组件哪天丢了那个 stop，这里点一下就会在事件面板里多出一条 toggle。
                -->
                <template v-if="spec.actions" #actions>
                    <IconButton size="sm" icon-class="i-lucide-refresh-cw" title="刷新（宿主动作）" @click="onAction('refresh')" />
                </template>

                <!-- fill 档的上下文走插槽：显示当前渲染出来的行数，右栏改 rows 这里跟着变。 -->
                <template v-if="spec.contextSlot" #context>
                    <span class="tabular-nums">{{ rows.length }} 条</span>
                </template>
            </WorkbenchContainerSection>
        </div>
    </div>
</template>
