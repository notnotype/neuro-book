<script setup lang="ts">
/**
 * WorkbenchContainerSurface 的 Lab 场景：左右两个容器 × `scroll` / `fill` 两档。
 *
 * 摆法照主页面：舞台是外壳那一层（`--bg-main`），左右**叶**的基准宽度与四周留白都取自
 * `layout.ts`（`SHELL_LEFT/RIGHT_PANEL_DEFAULT_WIDTH`、`SHELL_CONTAINER_GUTTER_PX`）——
 * 卡片是叶的内接盒，组件不写宽度也不写 margin，所以这里由 fixture 扮演外壳把 gutter 加上。
 * 中间那块代表编辑器叶：空的，只让两张卡片落在各自叶的位置上（舞台顶部那行说明是 fixture
 * 自己的话，不进卡片——卡片里不写解释文字）。
 *
 * 插槽四种写法各出一处：左容器用**缺省头部**（图标 + 标题）与**默认插槽**（= 内容区），
 * 右容器用 `#head` 覆盖头部（宿主要在自己的头部里加状态标签时走这条）与 `#content`。
 * 两边的 `#actions` 都摆了宿主按钮，点一下在右栏「事件」里留一条记录。
 *
 * 数据是确定性的内存值：标题、行数、两档 layout 都从 `data` 读，场景只换这一份初值。
 */
import {computed} from "vue";
import {Badge, IconButton} from "@notnotype/nb-ui/components";
import WorkbenchContainerSurface from "nbook/app/components/workbench/WorkbenchContainerSurface.vue";
import type {ViewLayoutMode} from "nbook/app/utils/workbench/descriptors";
import {SHELL_LEFT_CONTAINER, SHELL_RIGHT_CONTAINER} from "nbook/app/utils/workbench/containers";
import {
    SHELL_CONTAINER_GUTTER_PX,
    SHELL_LEFT_PANEL_DEFAULT_WIDTH,
    SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
} from "nbook/app/utils/workbench/layout";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();

/** 行数上限：`fill` 档里这张列表自己滚，行数太少就演示不出「谁拥有滚动」。 */
const ROW_LIMIT = 60;

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value !== "" ? value : fallback;
}

function readLayout(value: unknown, fallback: ViewLayoutMode): ViewLayoutMode {
    return value === "scroll" || value === "fill" ? value : fallback;
}

function readRows(value: unknown): number {
    const rows = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 30;
    return Math.min(ROW_LIMIT, Math.max(1, rows));
}

const knobs = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    return {
        leftTitle: readString(data.leftTitle, "工具"),
        rightTitle: readString(data.rightTitle, "Agent"),
        leftLayout: readLayout(data.leftLayout, "scroll"),
        rightLayout: readLayout(data.rightLayout, "fill"),
        rows: readRows(data.rows),
    };
});

/** 中性演示行：只用来量几何与滚动归属，不承载任何业务含义。 */
const rows = computed(() => Array.from({length: knobs.value.rows}, (_, index) => index + 1));

/** 叶：外壳加的那层内边距（卡片是它的内接盒），基准宽度给的是产品里的 340 / 400。 */
function leafStyle(basisPx: number): Record<string, string> {
    return {flex: `0 1 ${basisPx}px`, padding: `${SHELL_CONTAINER_GUTTER_PX}px`};
}

function onAction(name: string): void {
    emitLabEvent("container-action", name);
}
</script>

<template>
    <div class="workbench-container-stage flex h-[520px] min-h-0 w-full flex-col overflow-hidden bg-[var(--bg-main)]">
        <!-- 这段是 fixture 自己的话，不是容器的一部分：容器里不写说明文字，说明归 Lab。 -->
        <p class="shrink-0 px-[var(--space-6)] py-[var(--space-3)] text-[var(--text-xs)] text-[var(--text-muted)]">
            左右两叶各承载一个容器；中间是编辑器叶（本场景不摆内容）。
        </p>
        <div class="flex min-h-0 w-full flex-1 items-stretch">
            <!-- 左叶 -->
            <div class="flex min-h-0 min-w-0 flex-col" :style="leafStyle(SHELL_LEFT_PANEL_DEFAULT_WIDTH)" data-fixture-leaf="left">
                <WorkbenchContainerSurface
                    data-lab-subject
                    :container="SHELL_LEFT_CONTAINER"
                    :title="knobs.leftTitle"
                    :layout="knobs.leftLayout"
                >
                    <template #actions>
                        <IconButton size="sm" icon-class="i-lucide-plus" title="新建（宿主动作）" @click="onAction('left:new')" />
                        <IconButton size="sm" icon-class="i-lucide-ellipsis" title="更多（宿主动作）" @click="onAction('left:more')" />
                    </template>

                    <!-- 默认插槽 = 内容区。scroll 档的留白与滚动归卡片，所以这里只摆内容。 -->
                    <ul v-if="knobs.leftLayout === 'scroll'" class="flex min-w-0 flex-col gap-[var(--space-1)]">
                        <li
                            v-for="row in rows"
                            :key="row"
                            class="flex min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                            <span class="i-lucide-file-text h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                            <span class="min-w-0 truncate">示例条目 {{ row }}</span>
                        </li>
                    </ul>

                    <!-- fill 档：留白与滚动都归视图——内容自己接一条滚动区，卡片只负责裁切。 -->
                    <div v-else class="flex h-full min-h-0 flex-col">
                        <p class="flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--divider)] px-[var(--panel-p)] py-[var(--space-3)] text-[var(--text-xs)] text-[var(--text-secondary)]">
                            视图自己的头部与留白
                            <span class="ml-auto whitespace-nowrap text-[var(--text-2xs)] text-[var(--text-muted)] tabular-nums">{{ knobs.rows }} 条</span>
                        </p>
                        <ul class="flex min-h-0 flex-1 flex-col gap-[var(--space-1)] overflow-y-auto p-[var(--panel-p)]">
                            <li
                                v-for="row in rows"
                                :key="row"
                                class="flex min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            >
                                <span class="i-lucide-file-text h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                                <span class="min-w-0 truncate">示例条目 {{ row }}</span>
                            </li>
                        </ul>
                    </div>
                </WorkbenchContainerSurface>
            </div>

            <!-- 中间叶：产品里的编辑器。空的——它的存在只为了让两张卡片落在各自的叶位置上。 -->
            <div class="min-h-0 min-w-0 flex-1" data-fixture-leaf="editor"></div>

            <!-- 右叶 -->
            <div class="flex min-h-0 min-w-0 flex-col" :style="leafStyle(SHELL_RIGHT_PANEL_DEFAULT_WIDTH)" data-fixture-leaf="right">
                <WorkbenchContainerSurface
                    data-lab-subject
                    :container="SHELL_RIGHT_CONTAINER"
                    :title="knobs.rightTitle"
                    :layout="knobs.rightLayout"
                >
                    <!-- 头部覆盖：宿主自己画头部（这里保持同样的解剖：图标 + 标题，尾部加一枚档位标签）。 -->
                    <template #head>
                        <span :class="SHELL_RIGHT_CONTAINER.icon" class="h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--text-xs)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">{{ knobs.rightTitle }}</span>
                        <Badge size="sm" variant="soft" tone="accent">{{ knobs.rightLayout }}</Badge>
                    </template>

                    <template #actions>
                        <IconButton size="sm" icon-class="i-lucide-x" title="收起（宿主动作）" @click="onAction('right:collapse')" />
                    </template>

                    <template #content>
                        <div v-if="knobs.rightLayout === 'fill'" class="flex h-full min-h-0 flex-col">
                            <p class="flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--divider)] px-[var(--panel-p)] py-[var(--space-3)] text-[var(--text-xs)] text-[var(--text-secondary)]">
                                视图自己的头部与留白
                                <span class="ml-auto whitespace-nowrap text-[var(--text-2xs)] text-[var(--text-muted)] tabular-nums">{{ knobs.rows }} 条</span>
                            </p>
                            <ul class="flex min-h-0 flex-1 flex-col gap-[var(--space-1)] overflow-y-auto p-[var(--panel-p)]">
                                <li
                                    v-for="row in rows"
                                    :key="row"
                                    class="flex min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                >
                                    <span class="i-lucide-message-square h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                                    <span class="min-w-0 truncate">示例条目 {{ row }}</span>
                                </li>
                            </ul>
                        </div>

                        <ul v-else class="flex min-w-0 flex-col gap-[var(--space-1)]">
                            <li
                                v-for="row in rows"
                                :key="row"
                                class="flex min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            >
                                <span class="i-lucide-message-square h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                                <span class="min-w-0 truncate">示例条目 {{ row }}</span>
                            </li>
                        </ul>
                    </template>
                </WorkbenchContainerSurface>
            </div>
        </div>
    </div>
</template>
