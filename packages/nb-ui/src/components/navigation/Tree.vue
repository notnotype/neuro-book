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
    children?: GenericTreeNode[];
}

/**
 * 根节点的形状。
 *
 * 树本身是一份列表，「它是不是一张卡片」是摆放它的人才知道的事：摆进侧栏就该是裸列表，
 * 摆进空白区才需要一张卡片把它收住。默认仍是 card，因为已有调用方都依赖这个外观。
 */
export type TreeSurface = "card" | "plain";

const props = withDefaults(defineProps<{
    items?: GenericTreeNode[];
    modelValue?: string | string[];
    expanded?: string[];
    multiple?: boolean;
    disabled?: boolean;
    surface?: TreeSurface;
}>(), {
    items: () => [],
    modelValue: undefined,
    expanded: () => [],
    multiple: false,
    disabled: false,
    surface: "card",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: any): void;
    (e: "update:expanded", value: string[]): void;
    (e: "select", node: GenericTreeNode): void;
}>();

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
        组件目录里的 JsonViewer 也不是文件。要文件语义的调用方用 FileTree，
        那个组件本来就是为此存在的；这里只渲染调用方自己给的 iconClass。

        （这段注释刻意不写出那两个图标的类名：模板注释会原样进 DOM，也会被 Tailwind 的
        类名扫描当成候选，两边都会把「已经删掉的东西」重新变出来。）

        层级靠三样表达，都不占额外的行：缩进、箭头、以及选中项左侧那条强调色竖线。
    -->
    <TreeRoot
        v-slot="{ flattenItems }"
        :items="props.items"
        :get-key="(item) => item.id"
        :get-children="(item) => item.children"
        :model-value="(props.modelValue as any)"
        :expanded="props.expanded"
        :multiple="props.multiple"
        :disabled="props.disabled"
        class="w-full select-none list-none space-y-[var(--space-1)]"
        :class="surfaceClass"
        @update:model-value="(val) => emit('update:modelValue', val)"
        @update:expanded="(val) => emit('update:expanded', val as string[])"
    >
        <!--
            行的字号与最小高度绑在主题刻度上（--text-sm / --control-h-sm），不用 Tailwind 的
            text-xs。后者是 12px 的固定值，与主题的字号档无关：主题换密度时整棵树不跟着变，
            摆在同一条侧栏里就比旁边的控件松一档。

            选中态用「左侧竖线 + 淡强调底」而不是只换底色：竖线在缩进之外，扫一眼就能看出
            选中的是哪一层；只有底色的话，深层节点的高亮块会被缩进推得离左边很远，读起来像浮着。
        -->
        <TreeItem
            v-for="item in flattenItems"
            :key="item._id"
            v-slot="{ isExpanded }"
            :style="{ paddingInlineStart: indentFor(item.level) }"
            :value="item.value"
            :level="item.level"
            class="nb-ui-focus-ring group flex min-h-[var(--control-h-sm)] cursor-pointer items-center gap-[var(--space-3)] rounded-[calc(var(--radius-control)*0.75)] border-l-2 border-transparent py-0.5 pe-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text-secondary)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] hover:text-[var(--text-main)] data-[selected]:border-l-[var(--accent-main)] data-[selected]:bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] data-[selected]:font-[var(--weight-medium)] data-[selected]:text-[var(--accent-main)] disabled:cursor-not-allowed disabled:opacity-40"
            @select="emit('select', item.value)"
        >
            <!-- 箭头只在有子节点时出现；没有子节点时留一个同宽的空位，两种行的文字才对齐 -->
            <span
                v-if="item.hasChildren"
                class="i-lucide-chevron-right h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]"
                :class="isExpanded ? 'rotate-90' : ''"
                aria-hidden="true"
            />
            <span v-else class="h-3 w-3 shrink-0" aria-hidden="true" />

            <span
                v-if="item.value.iconClass"
                :class="item.value.iconClass"
                class="h-3.5 w-3.5 shrink-0 opacity-70"
                aria-hidden="true"
            />

            <span class="truncate">{{ item.value.title }}</span>
        </TreeItem>
    </TreeRoot>
</template>
