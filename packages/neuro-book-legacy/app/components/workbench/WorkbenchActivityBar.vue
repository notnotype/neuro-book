<script lang="ts">
import type {ToolPartId, ToolPartLocation} from "nbook/app/utils/workbench/view-placements";

/**
 * 主入口组里的**容器条目**要的额外事实：主侧栏的容器切换发生在这条活动栏上，
 * 所以这些条目既要能拖、也要能接收（落点与几何都按 `…:activity` 作用域登记）。
 */
export type WorkbenchActivityContainerInfo = Readonly<{
    containerId: string;
    location: ToolPartLocation;
    partId: ToolPartId;
    /** 全部已登记生效成员的有序快照（整组并入按它搬）。 */
    viewIds: readonly string[];
    /** 明确 false 的容器不提供拖动源。 */
    canMoveContainer: boolean;
}>;
</script>

<script setup lang="ts">
import {ContextMenu, Dropdown, IconButton, Tooltip, type ContextMenuItem, type DropdownItem} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import WorkbenchActivityContainerEntry from "nbook/app/components/workbench/WorkbenchActivityContainerEntry.vue";
import WorkbenchActivitySwitcherBand from "nbook/app/components/workbench/WorkbenchActivitySwitcherBand.vue";
import {resolveActivityBarSecondaryItems} from "nbook/app/utils/workbench-chrome";
import type {WorkbenchTitleActionItem, WorkbenchTitleActionItems} from "nbook/app/utils/workbench/view-title-actions";

/**
 * 通用活动栏：主入口在上、次要入口居中（放不下从尾部进 More）、底部入口贴底。
 *
 * 它只认识「图标 + 文案 + 状态」，不认识任何产品概念：执行归宿主（emit `invoke`），
 * 文案与翻译归宿主（`label` 由调用方给），账号这类带自有浮层的入口用 `item` 插槽整项替换。
 * 宽度 / 留白 / 卡片材质沿用产品活动栏的既有口径：每项 40px、步距 44px，
 * 外壳给叶留白，这里只画卡片。
 *
 * 溢出分配：主入口组与底部组的高度按自然高度计入固定开销，中段只放得下几项就摆几项，
 * 其余进 More 菜单。极短高度下主入口组与底部组各自滚动，不会盖住 More，也不会越过 Part 边界。
 */

export type ActivityItem = Readonly<{
    id: string;
    label: string;
    icon: string;
    active?: boolean;
    disabled?: boolean;
    /** 禁用原因：进 tooltip 与 aria-label，溢出菜单里作为右侧提示 */
    reason?: string;
    badge?: string | number;
}>;

/** 渲染用项：把「禁用原因」拼进可读标题，模板与插槽都不必再判一次。 */
export type RenderedActivityItem = ActivityItem & Readonly<{title: string}>;

const props = defineProps<{
    primary: readonly ActivityItem[];
    secondary: readonly ActivityItem[];
    footer: readonly ActivityItem[];
    /** 整条活动栏的无障碍名称 */
    label: string;
    /** 溢出菜单的触发器名称与菜单标题 */
    moreLabel: string;
    /** 主入口里哪些是容器条目（缺省没有：普通活动栏不接拖放）。 */
    containers?: readonly WorkbenchActivityContainerInfo[];
    /** 容器条目是否可作为拖动源（拖动整个容器）。 */
    allowContainerMove?: boolean;
    /** 容器条目是否可作为落点（容器重排 / 追加 View）。 */
    allowViewMove?: boolean;
    /** 会话上下文代际：容器拖动载荷冻结它。 */
    contextKey?: string;
    /** 容器右键菜单项；缺省不打开菜单。 */
    containerActions?: WorkbenchTitleActionItems;
}>();

const emit = defineEmits<{
    (event: "invoke", id: string): void;
    (event: "container-action", containerId: string, actionId: string): void;
}>();

/** 每项 40px 高、步距 44px（40 + 4 的下边距），测量与容量计算共用这一档。 */
const ITEM_STRIDE = 44;

/** 某个主入口 id 对应的容器事实；不是容器条目（或没给清单）时 `undefined`。 */
const containerInfoOf = (id: string): WorkbenchActivityContainerInfo | undefined =>
    props.containers?.find((entry) => entry.containerId === id);

/** 是否把这个主入口组当切换器用：显式开启拖放才渲染条目/落点子组件（无提供者时不碰 dnd-kit）。 */
const dragEntriesEnabled = computed(() => props.containers !== undefined
    && (props.allowContainerMove === true || props.allowViewMove === true));

const activityBarRef = ref<HTMLElement | null>(null);
const primaryGroupRef = ref<HTMLElement | null>(null);
const footerGroupRef = ref<HTMLElement | null>(null);
const visibleSecondaryCount = ref(props.secondary.length);
let resizeObserver: ResizeObserver | null = null;

function withTitle(items: readonly ActivityItem[]): RenderedActivityItem[] {
    return items.map((item) => ({
        ...item,
        title: item.disabled === true && item.reason !== undefined ? `${item.label} · ${item.reason}` : item.label,
    }));
}

const primaryItems = computed(() => withTitle(props.primary));

const secondarySource = computed(() => withTitle(props.secondary));
const footerItems = computed(() => withTitle(props.footer));

const secondaryItems = computed(() => {
    const resolved = resolveActivityBarSecondaryItems(secondarySource.value, {
        availableHeight: activityBarRef.value?.clientHeight ?? Number.POSITIVE_INFINITY,
        fixedHeight: resolveFixedHeight(),
        itemHeight: ITEM_STRIDE,
        moreButtonHeight: ITEM_STRIDE,
    });
    return {
        // 上限取最近一次实测的可见数：容器变大后等 ResizeObserver 报回来再补，避免来回抖
        visible: resolved.visible.slice(0, visibleSecondaryCount.value),
        overflow: resolved.overflow,
    };
});

const moreItems = computed<DropdownItem[]>(() => secondaryItems.value.overflow.map((item) => ({
    label: item.label,
    value: item.id,
    iconClass: item.icon,
    active: item.active === true,
    disabled: item.disabled === true,
    shortcut: item.disabled === true ? item.reason : undefined,
})));

/**
 * 固定开销：容器纵向内边距 + 主入口组 + 底部组的自然高度。
 * 两组都放在自己的滚动容器里，量的是内层自然高度——被压扁时读数不变，容量计算才不会自激。
 */
function resolveFixedHeight(): number {
    const activityBar = activityBarRef.value;
    if (activityBar === null) return 0;
    const style = getComputedStyle(activityBar);
    const paddingBlock = Number.parseFloat(style.paddingTop || "0") + Number.parseFloat(style.paddingBottom || "0");
    return paddingBlock + (primaryGroupRef.value?.offsetHeight ?? 0) + (footerGroupRef.value?.offsetHeight ?? 0);
}

function measureSecondaryItems(): void {
    const activityBar = activityBarRef.value;
    if (activityBar === null) return;
    const resolved = resolveActivityBarSecondaryItems(secondarySource.value, {
        availableHeight: activityBar.clientHeight,
        fixedHeight: resolveFixedHeight(),
        itemHeight: ITEM_STRIDE,
        moreButtonHeight: ITEM_STRIDE,
    });
    visibleSecondaryCount.value = resolved.visible.length;
}

function observeGroups(): void {
    resizeObserver?.disconnect();
    for (const target of [activityBarRef.value, primaryGroupRef.value, footerGroupRef.value]) {
        if (target !== null) resizeObserver?.observe(target);
    }
}

function invoke(item: ActivityItem): void {
    if (item.disabled === true) return;
    emit("invoke", item.id);
}

const containerMenu = ref<Readonly<{containerId: string; x: number; y: number}> | null>(null);

function openContainerMenu(item: ActivityItem, event: MouseEvent): void {
    if (containerInfoOf(item.id) === undefined || containerContextItems(item.id).length === 0) {
        return;
    }
    event.preventDefault();
    containerMenu.value = {containerId: item.id, x: event.clientX, y: event.clientY};
}

function contextItemsOf(items: readonly WorkbenchTitleActionItem[]): ContextMenuItem[] {
    return items.map((item) => ({
        label: item.disabled === true && item.reason !== undefined ? `${item.label}（${item.reason}）` : item.label,
        iconClass: item.icon,
        disabled: item.disabled === true,
        ...(item.children === undefined ? {action: () => emit("container-action", containerMenu.value?.containerId ?? "", item.id)} : {children: contextItemsOf(item.children)}),
    }));
}

function containerContextItems(containerId: string): ContextMenuItem[] {
    const actions = props.containerActions;
    return actions === undefined ? [] : contextItemsOf([...actions.primary, ...actions.secondary]);
}

/** active 与禁用都不丢：底色 / 文字 / 左侧标记条与产品活动栏的既有观感同一口径。 */
function itemClass(item: ActivityItem): string {
    if (item.active === true) {
        return "bg-[var(--bg-hover)] text-[var(--accent-text)]";
    }
    return "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]";
}

onMounted(() => {

    resizeObserver = new ResizeObserver(() => measureSecondaryItems());
    observeGroups();
    measureSecondaryItems();
});

watch(
    () => [props.primary, props.secondary, props.footer],
    () => nextTick(() => {
        // 组的 DOM 变了要重新挂观察目标，否则量到的还是上一份高度
        observeGroups();
        measureSecondaryItems();
    }),
);

onBeforeUnmount(() => {

    resizeObserver?.disconnect();
    resizeObserver = null;
});
</script>

<template>
    <aside
        ref="activityBarRef"
        class="workbench-activity-bar flex h-full w-full flex-col items-center overflow-hidden py-2"
        :aria-label="props.label"
    >
        <!-- 主入口组：极短高度时自己滚，让中段 More 与底部入口都还在 -->
        <div class="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto">
            <WorkbenchActivitySwitcherBand
                v-if="dragEntriesEnabled"
                :element="primaryGroupRef"
                :containers="containers ?? []"
                :allow-container-move="allowContainerMove === true"
                :allow-view-move="allowViewMove === true"
            />
            <div ref="primaryGroupRef" data-activity-group="primary" class="flex min-h-0 w-full flex-1 flex-col items-center">
                <template v-for="item in primaryItems" :key="item.id">
                    <slot :name="`item-${item.id}`" :item="item">
                        <!-- 容器条目：主侧栏的容器切换发生在这里，所以它既要能拖也要能接收。 -->
                        <WorkbenchActivityContainerEntry
                            v-if="dragEntriesEnabled && containerInfoOf(item.id) !== undefined"
                            :container-id="item.id"
                            :title="item.title"
                            :icon="item.icon"
                            :item-class="itemClass(item)"
                            :active="item.active === true"
                            :disabled="item.disabled === true"
                            :badge="item.badge === undefined ? '' : String(item.badge)"
                            :location="containerInfoOf(item.id)!.location"
                            :part-id="containerInfoOf(item.id)!.partId"
                            :view-ids="containerInfoOf(item.id)!.viewIds"
                            :context-key="contextKey ?? ''"
                            :allow-container-move="allowContainerMove === true && containerInfoOf(item.id)!.canMoveContainer"
                            :allow-view-move="allowViewMove === true"
                            @contextmenu="openContainerMenu(item, $event)"
                            @invoke="() => invoke(item)"
                        />
                        <Tooltip v-else :text="item.title" placement="right">
                            <IconButton
                                :icon-class="item.icon"
                                :aria-label="item.title"
                                :aria-pressed="item.active === true"
                                :disabled="item.disabled === true"
                                :data-activity-id="item.id"
                                class="workbench-activity-bar__item relative mb-1 !h-10 !w-10 !rounded-[var(--radius-control)]"
                                :class="itemClass(item)"
                                @click="invoke(item)"
                            >

                                <span v-if="item.badge !== undefined && item.badge !== ''" class="workbench-activity-bar__badge">{{ item.badge }}</span>
                            </IconButton>
                        </Tooltip>
                    </slot>
                </template>

                <div v-if="primaryItems.length > 0" class="workbench-activity-bar__separator my-1"></div>
            </div>
        </div>

        <!-- 中段：次要入口 + 溢出菜单触发器 -->
        <template v-for="item in secondaryItems.visible" :key="item.id">
            <slot :name="`item-${item.id}`" :item="item">
                <Tooltip :text="item.title" placement="right">
                    <IconButton
                        :icon-class="item.icon"
                        :aria-label="item.title"
                        :aria-pressed="item.active === true"
                        :disabled="item.disabled === true"
                        :data-activity-id="item.id"
                        class="workbench-activity-bar__item relative mb-1 !h-10 !w-10 !rounded-[var(--radius-control)]"
                        :class="itemClass(item)"
                        @click="invoke(item)"
                    >

                        <span v-if="item.badge !== undefined && item.badge !== ''" class="workbench-activity-bar__badge">{{ item.badge }}</span>
                    </IconButton>
                </Tooltip>
            </slot>
        </template>

        <div v-if="secondaryItems.overflow.length > 0" class="workbench-activity-bar__more relative mb-1 h-10 w-10 shrink-0">
            <Dropdown
                :items="moreItems"
                side="right"
                align="start"
                :side-offset="4"
                menu-class="min-w-[180px]"
                @select="emit('invoke', $event)"
            >
                <IconButton
                    icon-class="i-lucide-ellipsis"
                    :title="props.moreLabel"
                    data-activity-id="more"
                    class="workbench-activity-bar__item !h-10 !w-10 !rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                />
            </Dropdown>
        </div>

        <!-- 底部入口组：与主入口组同一套滚动保护 -->
        <div class="mt-auto flex min-h-0 w-full shrink flex-col items-center overflow-y-auto">
            <div ref="footerGroupRef" data-activity-group="footer" class="flex w-full shrink-0 flex-col items-center">
                <template v-for="item in footerItems" :key="item.id">
                    <slot :name="`item-${item.id}`" :item="item">
                        <Tooltip :text="item.title" placement="right">
                            <IconButton
                                :icon-class="item.icon"
                                :aria-label="item.title"
                                :aria-pressed="item.active === true"
                                :disabled="item.disabled === true"
                                :data-activity-id="item.id"
                                class="workbench-activity-bar__item relative mb-1 !h-10 !w-10 !rounded-[var(--radius-control)]"
                                :class="itemClass(item)"
                                @click="invoke(item)"
                            >

                                <span v-if="item.badge !== undefined && item.badge !== ''" class="workbench-activity-bar__badge">{{ item.badge }}</span>
                            </IconButton>
                        </Tooltip>
                    </slot>
                </template>
            </div>
        </div>
        <ContextMenu
            v-if="containerMenu"
            :visible="true"
            :x="containerMenu.x"
            :y="containerMenu.y"
            :items="containerContextItems(containerMenu.containerId)"
            @close="containerMenu = null" />
    </aside>
</template>

<style scoped>
/*
 * 图标条是叶里的一张卡片：面 / 描边 / 圆角 / 阴影全部取自 nb-ui 的主题角色变量。
 * 卡片四周的留白（与窗体边界、与相邻叶之间）归外壳——外壳给 activity 叶加内边距，
 * 卡片就是叶的内接盒；这里不写宽度也不写 margin（宽度只有 layout.ts 那一处）。
 * 写成 CSS 而不是原子类：主题 token 要落在 border-width / border-color 这类属性上，
 * 原子类的任意值语法在那里分辨不出尺寸与颜色，写错了静默不生效（判据见 LabShell 顶部）。

 */
.workbench-activity-bar {
    background: var(--panel-surface);
    border: var(--border-w) solid var(--panel-outline);
    border-radius: var(--radius-control);
    box-shadow: var(--elevation-raised);
}

/* 按钮自己的禁用观感（IconButton 的 disabled 档）与产品活动栏的既有口径对齐：
   选择器多一层外层类，避免与原子类的 disabled:opacity-40 打成靠注入顺序决胜的平手。 */
.workbench-activity-bar .workbench-activity-bar__item:disabled {
    cursor: not-allowed;
    opacity: 0.34;
}

.workbench-activity-bar__separator {
    width: 28px;
    height: var(--border-w);
    background: var(--divider);
}

/* 角标贴在图标右下角，不参与按钮的 40px 盒模型。 */
.workbench-activity-bar__badge {
    position: absolute;
    right: 2px;
    bottom: 2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: var(--radius-pill);
    background: var(--accent-main);
    color: var(--text-inverse);
    font-size: 9px;
    line-height: 14px;
    text-align: center;
}
</style>
