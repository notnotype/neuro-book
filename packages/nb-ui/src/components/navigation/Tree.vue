<script setup lang="ts">
import {computed} from "vue";
import {
    TreeItem,
    TreeRoot,
} from "reka-ui";

export interface GenericTreeNode {
    id: string;
    title: string;
    /** i-lucide-* 之类的图标类。不给就没有图标——树不替调用方决定节点「是什么」。 */
    iconClass?: string;
    disabled?: boolean;
    /** 标题用次级色：这一项此刻不是正常状态（例如还没出场），但仍可选择。 */
    muted?: boolean;
    children?: GenericTreeNode[];
}

/**
 * 根节点的形状。
 *
 * 树本身是一份列表，「它是不是一张卡片」是摆放它的人才知道的事：摆进侧栏就该是裸列表，
 * 摆进空白区才需要一张卡片把它收住。默认仍是 card，因为已有调用方都依赖这个外观。
 */
export type TreeSurface = "card" | "plain";

/**
 * 点行时切不切换展开。`row`（缺省）：点行既选中、又切换有子节点的行的展开。`arrow`：点行只选中，展开收起只认点箭头与键盘的
 * 左右键；给“节点本身能打开、下面又有子节点”的树用（例如设定树里的人物条目，点它是打开它，不该顺带收起它的子条目）。
 */
export type TreeToggleOn = "row" | "arrow";

/** reka `TreeItem` 的 `select`、`toggle` 事件：`detail.originalEvent` 是触发它的点击或按键，`preventDefault` 取消这一次。 */
type TreeItemEvent = CustomEvent<{readonly originalEvent?: Event}>;

const props = withDefaults(defineProps<{
    items?: GenericTreeNode[];
    modelValue?: string | string[];
    expanded?: string[];
    multiple?: boolean;
    disabled?: boolean;
    surface?: TreeSurface;
    toggleOn?: TreeToggleOn;
}>(), {
    items: () => [],
    modelValue: undefined,
    expanded: () => [],
    multiple: false,
    disabled: false,
    surface: "card",
    toggleOn: "row",
});

defineSlots<{
    /** 标题后面的一小段说明（例如“未出场”）；行太窄时标题先截断，说明保留。 */
    suffix?(props: {node: GenericTreeNode}): unknown;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string | string[] | undefined): void;
    (e: "update:expanded", value: string[]): void;
    (e: "select", node: GenericTreeNode): void;
}>();

const nodeById = computed(() => {
    const nodes = new Map<string, GenericTreeNode>();
    const visit = (items: GenericTreeNode[]): void => {
        for (const item of items) {
            nodes.set(item.id, item);
            if (item.children) visit(item.children);
        }
    };
    visit(props.items);
    return nodes;
});

const selectedNodes = computed<GenericTreeNode | GenericTreeNode[] | undefined>(() => {
    if (props.multiple) {
        const ids = Array.isArray(props.modelValue)
            ? props.modelValue
            : props.modelValue === undefined ? [] : [props.modelValue];
        return ids.flatMap((id) => {
            const node = nodeById.value.get(id);
            return node === undefined ? [] : [node];
        });
    }
    const id = Array.isArray(props.modelValue) ? props.modelValue[0] : props.modelValue;
    return id === undefined ? undefined : nodeById.value.get(id);
});

function emitModelValue(value: GenericTreeNode | GenericTreeNode[] | undefined): void {
    if (Array.isArray(value)) {
        emit("update:modelValue", value.map((node) => node.id));
        return;
    }
    emit("update:modelValue", value?.id);
}

/** 这一下点在箭头上（`arrow` 时箭头那一格带 `data-tree-toggle`）。 */
const isArrowClick = (event: TreeItemEvent): boolean => {
    const target = event.detail?.originalEvent?.target;
    return target instanceof Element && target.closest("[data-tree-toggle]") !== null;
};

/** `arrow` 时点箭头只切换展开：取消 reka 跟着这次点击做的选中，也不往外发 `select`。 */
function onItemSelect(event: TreeItemEvent, node: GenericTreeNode): void {
    if (props.toggleOn === "arrow" && isArrowClick(event)) {
        event.preventDefault();
        return;
    }
    emit("select", node);
}

/** `arrow` 时点行（不在箭头上）不切换展开；键盘的左右键照常（原始事件不是鼠标事件）。 */
function onItemToggle(event: TreeItemEvent): void {
    if (props.toggleOn === "arrow" && event.detail?.originalEvent instanceof MouseEvent && !isArrowClick(event)) event.preventDefault();
}

const surfaceClass = computed(() => props.surface === "card"
    ? "rounded-[var(--radius-panel)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[var(--panel-surface)] p-2 shadow-sm"
    : "p-2");

/**
 * 每一层的缩进走间距刻度，不用字面像素。
 *
 * 起始那一档要留出箭头本身的宽度，否则第一层的文字会顶着行的左边缘，
 * 而有子节点和没子节点的两种行左边对不齐。
 */
function indentFor(level: number): string {
    return `calc(var(--space-5) * ${level} + var(--space-2))`;
}
</script>

<template>
    <!--
        树 = 一份带层级的列表，不是文件浏览器。

        这里刻意**不给任何默认图标**。上一版给有子节点的行画文件夹、给叶子画文件，
        那是把文件系统的语汇强加给一个泛型组件：章节树里的「第一卷」不是文件夹，
        组件目录里的 JsonViewer 也不是文件。文件与目录的树不在本库；
        这里只渲染调用方自己给的 iconClass。

        （这段注释刻意不写出那两个图标的类名：模板注释会原样进 DOM，也会被 Tailwind 的
        类名扫描当成候选，两边都会把「已经删掉的东西」重新变出来。）

        层级只靠缩进和展开箭头表达；选中是行状态，不承担层级结构。
    -->
    <TreeRoot
        v-slot="{ flattenItems }"
        :items="props.items"
        :get-key="(item) => item.id"
        :get-children="(item) => item.children"
        :model-value="(selectedNodes as any)"
        :expanded="props.expanded"
        :multiple="props.multiple"
        :disabled="props.disabled"
        class="w-full select-none list-none space-y-[var(--space-1)]"
        :class="surfaceClass"
        @update:model-value="emitModelValue"
        @update:expanded="(val) => emit('update:expanded', val as string[])"
    >
        <!--
            行的字号与最小高度绑在主题刻度上（--text-sm / --control-h-sm），不用 Tailwind 的
            text-xs。后者是 12px 的固定值，与主题的字号档无关：主题换密度时整棵树不跟着变，
            摆在同一条侧栏里就比旁边的控件松一档。

            选中态使用整行淡强调底、强调文字与中等字重。它不增加边框或指示条，避免深层节点
            同时出现缩进和孤立竖线；`data-selected` 与焦点环仍分别承载选择和键盘焦点语义。
        -->
        <TreeItem
            v-for="item in flattenItems"
            :key="item._id"
            v-slot="{ isExpanded }"
            :style="{ paddingInlineStart: indentFor(item.level) }"
            :value="item.value"
            :level="item.level"
            :data-tree-id="item.value.id"
            class="nb-ui-focus-ring group flex min-h-[var(--control-h-sm)] cursor-pointer items-center gap-[var(--space-3)] rounded-[calc(var(--radius-control)*0.75)] py-0.5 pe-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text-secondary)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-layout)] hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] hover:text-[var(--text-main)] data-[selected]:bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] data-[selected]:[font-weight:var(--weight-medium)] data-[selected]:text-[var(--accent-main)] disabled:cursor-not-allowed disabled:opacity-40"
            @select="(event: TreeItemEvent) => onItemSelect(event, item.value)"
            @toggle="onItemToggle"
        >
            <!-- 箭头只在有子节点时出现；没有子节点时留一个同宽的空位，两种行的文字才对齐。
                 展开/收起换图标（chevron-right / chevron-down）而不是把同一个图标转 90°：
                 旋转的雪佛龙在 12px 上会被人眼读成偏了一点，而换图标没有这个问题。 -->
            <!-- `arrow` 时箭头是单独的点击目标：放大到 20 像素见方、悬停有底色，负外边距让它在行里仍只占 12 像素，两种行照旧对齐。 -->
            <span
                v-if="item.hasChildren && props.toggleOn === 'arrow'"
                class="-m-1 flex size-5 shrink-0 items-center justify-center rounded-[calc(var(--radius-control)*0.6)] text-[var(--text-muted)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:text-[var(--text-main)]"
                aria-hidden="true"
                data-tree-toggle
            >
                <span class="h-3 w-3" :class="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
            </span>
            <span
                v-else-if="item.hasChildren"
                class="h-3 w-3 shrink-0 text-[var(--text-muted)]"
                :class="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                aria-hidden="true"
            />
            <span v-else class="h-3 w-3 shrink-0" aria-hidden="true" />

            <span
                v-if="item.value.iconClass"
                :class="item.value.iconClass"
                class="h-3.5 w-3.5 shrink-0 opacity-70"
                aria-hidden="true"
            />

            <span class="truncate" :class="item.value.muted ? 'text-[var(--text-muted)]' : ''">{{ item.value.title }}</span>
            <span v-if="$slots.suffix" class="shrink-0 text-[length:var(--text-xs)] text-[var(--text-muted)]"><slot name="suffix" :node="item.value" /></span>
        </TreeItem>
    </TreeRoot>
</template>
