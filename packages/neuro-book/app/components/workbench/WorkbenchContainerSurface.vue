<script setup lang="ts">
/**
 * 容器部件：承载视图的一块**卡片**（头部 + 内容区）——#192 阶段 1。
 *
 * 职责边界（提案「三种拖动，三个 owner」）：容器**不拥有拖拽、不写尺寸、不读 store、不做持久化**。
 * - 叶的几何（宽 / min / max / 受控 resize）归外壳与 nb-ui `Splitter`；
 * - 卡片四周的留白归**外壳**加在叶上（`--workbench-container-gutter`），与活动栏卡片同一套机制：
 *   卡片是叶的内接盒，组件不写宽度也不写 margin。
 *
 * 与 descriptor 的对应（三处，都不在组件里另立一份取值域）：
 * - `container` 是 `ContainerDescriptor`；`title` 是**已解析**的标题——注册表只存 `titleKey`，
 *   解析归宿主（提案开放问题 1 取值 b），组件不 import i18n。
 * - `container.location` 经 `resolveLocationPart` 求值成承载它的 Part，作为 `data-container-part`
 *   暴露：容器落在哪个叶由宿主槽位决定，这一项使「声明的位置与实际落位一致」可被核对。
 * - 内容区按 `layout` 的**组合合同**呈现（`resolveViewLayout`：要不要外壳给留白、滚动归谁），
 *   合同读 descriptor 的表，组件里不复制一份 mode → 行为的映射。有活动视图之后，`layout`
 *   由该视图的 descriptor 决定；本批还没有视图，用默认合同（`scroll`）。
 *
 * 单根、四个插槽：`head`（覆盖头部内容）/ `actions`（头部尾部动作区）/ `content`（内容区）/
 * 默认插槽（`content` 未给时用它，见模板）。头部缺省渲染图标 + 标题。
 */
import {computed} from "vue";
import {
    DEFAULT_VIEW_LAYOUT_CONTRACT,
    resolveLocationPart,
    resolveViewLayout,
    type ContainerDescriptor,
    type ViewLayoutMode,
} from "nbook/app/utils/workbench/descriptors";

const props = withDefaults(defineProps<{
    container: ContainerDescriptor;
    /** 已解析的标题：注册表只存 key，解析归宿主（提案开放问题 1 取值 b）。 */
    title: string;
    /** 内容区按哪一档呈现；缺省 `scroll`（外壳给留白、拥有滚动）。 */
    layout?: ViewLayoutMode;
}>(), {layout: "scroll"});

defineSlots<{
    /** 覆盖头部内容（缺省：图标 + 标题）。 */
    head(): unknown;
    /** 头部尾部的动作区（收起、更多一类的按钮由宿主放进来）。 */
    actions(): unknown;
    /** 内容区。 */
    content(): unknown;
    /** 内容区的默认写法：`content` 未提供时渲染它。 */
    default(): unknown;
}>();

/** 默认落位 → Part。`window` 是预留值，求值失败就不声称落在某个 Part 上（属性为空）。 */
const part = computed(() => {
    const resolved = resolveLocationPart(props.container.location);
    return resolved.ok ? resolved.value : "";
});

/**
 * 内容区合同。`layout` 是 descriptor 的取值域 union，越界只能来自强制转型——那种情况下
 * 不猜第二档语义、也不静默给一档观感，而是退回默认合同（与「没指定 layout」同一条路径）。
 */
const contract = computed(() => {
    const resolved = resolveViewLayout(props.layout);
    return resolved.ok ? resolved.value : DEFAULT_VIEW_LAYOUT_CONTRACT;
});
</script>

<template>
    <section
        class="workbench-container"
        :aria-label="title"
        :data-container="container.id"
        :data-container-location="container.location"
        :data-container-part="part"
        :data-container-layout="contract.mode"
    >
        <header class="workbench-container__head">
            <slot name="head">
                <span v-if="container.icon" :class="container.icon" class="workbench-container__icon" aria-hidden="true"></span>
                <span class="workbench-container__title">{{ title }}</span>
            </slot>
            <div v-if="$slots.actions" class="workbench-container__actions">
                <slot name="actions"></slot>
            </div>
        </header>

        <div
            class="workbench-container__content"
            :class="{
                'workbench-container__content--padded': contract.shellPadsContent,
                'workbench-container__content--scrolling': contract.shellOwnsScroll,
            }"
        >
            <slot name="content"><slot></slot></slot>
        </div>
    </section>
</template>

<style scoped>
/*
 * 容器是一块**浮在窗体底上的卡片**：面 / 描边 / 圆角 / 阴影全部取自 nb-ui 的主题角色变量，
 * 与活动栏卡片同一套语言——两处写死颜色，主题换掉后就会有两块没跟上。
 * 取值口径见 `NovelIdeActivityBar.vue` 的 `.workbench-activity-bar`：
 *   面   --panel-surface（角色层；两套产品主题都映射到 --bg-panel，比窗体底高一档）
 *   描边 var(--border-w) solid var(--panel-outline)
 *   圆角 --radius-panel（面板档：容器是大面，不是控件，所以不取 --radius-control）
 *   阴影 --elevation-raised
 * 卡片四周的留白归外壳（`WorkbenchShell` 给左右叶的内边距），内容区因此比叶窄 2 × 6px。
 *
 * 写成 CSS 而不是原子类：主题 token 要落在 border-width / border-color / border-radius 这类属性上，
 * 原子类的任意值语法在那里分辨不出尺寸与颜色，写错了静默不生效（判据见 LabShell 顶部那段）。
 *
 * `overflow: hidden` 是**圆角的承载者**：头部与内容区各自都是矩形，只有根裁切才能保证它们
 * 不盖住卡片圆角，内容区的滚动条也始终落在卡片内。视图里的浮层本来就出不去所在的叶
 * （`WorkbenchBranch` 的叶包装已带 overflow-hidden），这里不新增限制。
 */
.workbench-container {
    display: flex;
    height: 100%;
    width: 100%;
    min-height: 0;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
    background: var(--panel-surface);
    border: var(--border-w) solid var(--panel-outline);
    border-radius: var(--radius-panel);
    box-shadow: var(--elevation-raised);
}

/*
 * 头部：图标 + 标题 + 动作区。它是内容区上方的一条**窄条 chrome**，底缝就是与内容区的分界——
 * 不再叠第二层标题条（验收口径：不出现双重标签条）。左右内边距与内容区的留白同一份（--panel-p），
 * 标题因此与内容左边缘对齐。
 */
.workbench-container__head {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-2);
    height: var(--space-8);
    padding-inline: var(--panel-p);
    border-bottom: var(--border-w) solid var(--divider);
}

.workbench-container__icon {
    height: 14px;
    width: 14px;
    flex: 0 0 auto;
    color: var(--text-muted);
}

.workbench-container__title {
    min-width: 0;
    overflow: hidden;
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 动作区贴右：宿主的按钮（收起 / 更多）按 --space-2 排；没有动作时不渲染盒子。 */
.workbench-container__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
}

/*
 * 内容区：外壳给不给留白、滚动归谁，都由 `layout` 的合同决定（两个修饰类直接从
 * `resolveViewLayout` 的 contract 两个布尔来，不在这里判断 mode）。基础态只声明
 * 「占满剩余高度、能缩」，裁切与留白各自按合同加。
 */
.workbench-container__content {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
}

/* scroll：外壳给内边距并拥有滚动（--panel-p 是面板内边距角色）。 */
.workbench-container__content--padded {
    padding: var(--panel-p);
}

.workbench-container__content--scrolling {
    overflow-y: auto;
}
</style>
