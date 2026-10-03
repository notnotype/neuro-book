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
 * - 支持 VS Code 式侧栏 Section 结构：传入 `sections` 列表时以紧凑堆叠分区呈现，
 *   各分区通过 1px 细线分隔；头部自动提供「…」Section 可见性浮层菜单，
 *   支持根据 `canToggleVisibility` 切换显隐（对接 `ViewDescriptor.canToggleVisibility`）。
 *
 * 单根、向后兼容现有插槽与单视图模式。
 */
import {computed, ref, useSlots, watch} from "vue";
import {IconButton, Popover} from "@notnotype/nb-ui/components";
import {
    DEFAULT_VIEW_LAYOUT_CONTRACT,
    resolveLocationPart,
    resolveViewLayout,
    type ContainerDescriptor,
    type ViewLayoutMode,
} from "nbook/app/utils/workbench/descriptors";
import WorkbenchContainerSection from "./WorkbenchContainerSection.vue";

export type ContainerSectionItem = {
    id: string;
    title: string;
    contextLabel?: string;
    canToggleVisibility?: boolean;
    collapsible?: boolean;
    collapsed?: boolean;
    layout?: ViewLayoutMode;
    empty?: boolean;
    emptyText?: string;
};

const props = withDefaults(defineProps<{
    container: ContainerDescriptor;
    /** 已解析的标题：注册表只存 key，解析归宿主（提案开放问题 1 取值 b）。 */
    title: string;
    /** 内容区按哪一档呈现；缺省 `scroll`（外壳给留白、拥有滚动）。 */
    layout?: ViewLayoutMode;
    /** VS Code 式 section 列表声明（可对接 ViewDescriptor 集合） */
    sections?: readonly ContainerSectionItem[];
    /** 受控的可见 section id 集合；缺省由内部 state 维护全部可见 */
    visibleSections?: readonly string[];
    /** 是否在头部展示「…」Section 可见性菜单；缺省有 sections 时展示 */
    showVisibilityMenu?: boolean;
}>(), {
    layout: "scroll",
    sections: undefined,
    visibleSections: undefined,
    showVisibilityMenu: true,
});

const emit = defineEmits<{
    (e: "update:visibleSections", value: string[]): void;
    (e: "toggle-section-visibility", payload: {id: string; visible: boolean}): void;
    (e: "toggle-section-collapsed", payload: {id: string; collapsed: boolean}): void;
}>();

defineSlots<{
    /** 覆盖头部内容（缺省：图标 + 标题）。 */
    head(): unknown;
    /** 头部尾部的动作区（收起、更多一类的按钮由宿主放进来）。 */
    actions(): unknown;
    /** 自定义可见性菜单触发区或浮层内容。 */
    visibilityMenu?(): unknown;
    /** 自定义整个 sections 渲染。 */
    sections?(): unknown;
    /** 单个 section 的内容回退。 */
    section?(props: {section: ContainerSectionItem}): unknown;
    /** 内容区（单视图向后兼容模式）。 */
    content(): unknown;
    /** 内容区的默认写法：`content` 未提供时渲染它。 */
    default(): unknown;
    [key: string]: ((props: any) => unknown) | undefined;
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

const slots = useSlots();
const hasSections = computed(() => Boolean(props.sections && props.sections.length > 0));
const isSingleViewMode = computed(() => !hasSections.value && !slots.sections);

/** Section 内部折叠态（支持未受控时在组件内闭环） */
const sectionCollapsedState = ref<Record<string, boolean>>({});

function isSectionCollapsed(section: ContainerSectionItem): boolean {
    if (section.id in sectionCollapsedState.value) {
        return sectionCollapsedState.value[section.id]!;
    }
    return section.collapsed ?? false;
}

function handleSectionCollapsed(id: string, collapsed: boolean): void {
    sectionCollapsedState.value[id] = collapsed;
    emit("toggle-section-collapsed", {id, collapsed});
}

/** Section 可见性内部 state 与受控同步 */
function defaultVisibleIds(): string[] {
    return props.sections?.map((s) => s.id) ?? [];
}

const internalVisibleIds = ref<string[]>(props.visibleSections ? [...props.visibleSections] : defaultVisibleIds());

watch(() => props.visibleSections, (val) => {
    if (val !== undefined) {
        internalVisibleIds.value = [...val];
    }
});

watch(() => props.sections, () => {
    if (props.visibleSections === undefined) {
        internalVisibleIds.value = defaultVisibleIds();
    }
}, {deep: true});

const effectiveVisibleSet = computed(() => new Set(props.visibleSections ?? internalVisibleIds.value));

function isSectionVisible(id: string): boolean {
    return effectiveVisibleSet.value.has(id);
}

function toggleSectionVisibility(id: string): void {
    const current = new Set(effectiveVisibleSet.value);
    const nextVisible = !current.has(id);
    if (nextVisible) {
        current.add(id);
    } else {
        current.delete(id);
    }
    const nextList = props.sections ? props.sections.map((s) => s.id).filter((item) => current.has(item)) : Array.from(current);
    internalVisibleIds.value = nextList;
    emit("update:visibleSections", nextList);
    emit("toggle-section-visibility", {id, visible: nextVisible});
}

const renderedSections = computed(() => {
    if (!props.sections) return [];
    return props.sections.filter((s) => isSectionVisible(s.id));
});

const visibilityMenuOpen = ref(false);
const hasVisibilityMenu = computed(() => {
    return Boolean(props.showVisibilityMenu && hasSections.value);
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

            <div v-if="$slots.actions || hasVisibilityMenu" class="workbench-container__actions">
                <slot name="actions"></slot>

                <slot v-if="hasVisibilityMenu" name="visibilityMenu">
                    <Popover
                        v-model:open="visibilityMenuOpen"
                        align="end"
                        side="bottom"
                        :side-offset="4"
                        content-class="p-1 min-w-[170px]"
                    >
                        <template #trigger>
                            <IconButton
                                size="sm"
                                icon-class="i-lucide-ellipsis"
                                title="视图可见性"
                                aria-label="视图可见性"
                                class="workbench-container__menu-trigger"
                                data-testid="container-visibility-menu-trigger"
                            />
                        </template>

                        <div
                            class="workbench-container__visibility-menu"
                            role="menu"
                            aria-label="Section 可见性"
                            data-testid="container-visibility-menu"
                        >
                            <button
                                v-for="sec in props.sections"
                                :key="sec.id"
                                type="button"
                                role="menuitemcheckbox"
                                :aria-checked="isSectionVisible(sec.id)"
                                :aria-disabled="sec.canToggleVisibility === false"
                                :disabled="sec.canToggleVisibility === false"
                                :data-section-id="sec.id"
                                class="nb-ui-popover-item workbench-container__menu-item"
                                :class="{'opacity-50 cursor-not-allowed': sec.canToggleVisibility === false}"
                                @click="sec.canToggleVisibility !== false && toggleSectionVisibility(sec.id)"
                            >
                                <span
                                    class="workbench-container__menu-check"
                                    aria-hidden="true"
                                >
                                    <span v-if="isSectionVisible(sec.id)" class="i-lucide-check h-3.5 w-3.5"></span>
                                </span>
                                <span class="workbench-container__menu-label">{{ sec.title }}</span>
                            </button>
                        </div>
                    </Popover>
                </slot>
            </div>
        </header>

        <div
            class="workbench-container__content"
            :class="{
                'workbench-container__content--padded': isSingleViewMode && contract.shellPadsContent,
                'workbench-container__content--scrolling': isSingleViewMode && contract.shellOwnsScroll,
                'workbench-container__content--sections': !isSingleViewMode,
            }"
        >
            <slot v-if="isSingleViewMode" name="content"><slot></slot></slot>
            <slot v-else-if="$slots.sections" name="sections"></slot>
            <template v-else>
                <div v-if="renderedSections.length === 0" class="workbench-container__empty" data-testid="container-empty-state">
                    <slot name="empty">
                        <p class="workbench-container__empty-text">所有视图已被隐藏，可通过右上角 ··· 菜单重新显示</p>
                    </slot>
                </div>
                <template v-else>
                    <template v-for="(section, index) in renderedSections" :key="section.id">
                        <WorkbenchContainerSection
                            :id="section.id"
                            :title="section.title"
                            :context-label="section.contextLabel"
                            :collapsible="section.collapsible"
                            :collapsed="isSectionCollapsed(section)"
                            :layout="section.layout"
                            :empty="section.empty"
                            :empty-text="section.emptyText"
                            :class="{'workbench-container-section--divided': index > 0}"
                            @update:collapsed="handleSectionCollapsed(section.id, $event)"
                        >
                            <template #default>
                                <slot :name="`section-${section.id}`" :section="section">
                                    <slot name="section" :section="section">
                                        <span v-if="section.emptyText">{{ section.emptyText }}</span>
                                    </slot>
                                </slot>
                            </template>
                            <template #context>
                                <slot :name="`section-context-${section.id}`" :section="section" />
                            </template>
                            <template #actions>
                                <slot :name="`section-actions-${section.id}`" :section="section" />
                            </template>
                        </WorkbenchContainerSection>
                    </template>
                </template>
            </template>
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
 * （`GridRenderer` 的叶包装已带 overflow-hidden），这里不新增限制。
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
    /* 确定份额（basis 0）：和动作区按 4:1 分——动作区是标题操作的测量基准，必须与内容无关。 */
    flex: 4 1 0;
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
    /*
     * 必须拿到**确定的**宽度盒（`flex: 1 1 auto` + `min-width: 0`），否则标题操作部件量到的可用宽度
     * 等于自己的内容宽，折叠反过来改宽度 → ResizeObserver 自激。见 `WorkbenchTitleActions.md`。
     */
    flex: 1 1 0;
    min-width: 0;
    justify-content: flex-end;
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

/*
 * Section 列表模式：垂直堆叠各区段。
 * 容器内部 section 之间用 1px 分隔线（--border-w solid var(--divider)）。
 * 卡片语言（圆角与阴影）只属于容器最外层，内部绝不再加卡片圆角。
 */
.workbench-container__content--sections {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
}

:deep(.workbench-container-section--divided),
:deep(.workbench-container-section + .workbench-container-section) {
    border-top: var(--border-w) solid var(--divider);
}

/* Section 可见性浮层菜单 */
.workbench-container__visibility-menu {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.workbench-container__menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: var(--control-h-sm);
    padding-inline: var(--space-2);
    border: none;
    background: transparent;
    color: var(--text-main);
    font-size: var(--text-xs);
    cursor: pointer;
    text-align: left;
    outline: none;
    transition: background-color var(--motion-fast) var(--ease-standard);
}

.workbench-container__menu-item:hover:not(:disabled) {
    background-color: var(--bg-hover);
}

.workbench-container__menu-item:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.workbench-container__menu-check {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--accent-main);
}

.workbench-container__menu-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1 1 auto;
}

.workbench-container__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 auto;
    height: 100%;
    padding: var(--panel-p);
    text-align: center;
}

.workbench-container__empty-text {
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-relaxed);
}
</style>
