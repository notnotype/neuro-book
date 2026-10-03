<script setup lang="ts">
/**
 * 标题操作部件：标题条右侧的「几个按钮 + 一个更多菜单」。
 *
 * **纯受控**：它不认识命令、不执行命令、不读 store。每一项只带渲染需要的事实
 * （`label` / `icon` / `disabled` + `reason` / `busy` / `checked` / `type` / `group` / `children`），
 * 点击回传 `id`，对应哪个命令由宿主决定——View 动作与框架动作因此可以共用同一个部件。
 *
 * 两层结构：
 * - `primary` 直接渲染成 `IconButton`（`size="sm"`，与面板头、Section 行头同高）；
 * - `secondary` 收进「更多」下拉（`Dropdown`：一层子菜单、受控 radio / checkbox、键盘漫游与焦点
 *   归还都由 nb-ui 原语承担）。
 *
 * 溢出折叠：标题条放不下时**先折 primary**（从后往前），折掉的项进「更多」；「更多」触发器本身
 * 永远保留——它是那些项唯一的入口。折叠按**父容器的可用宽度**判断（自身宽度会跟着内容变，
 * 用它做判据会自激），并且只有拿到正数宽度才折叠：量不到（未挂载、被隐藏、jsdom）就不动。
 *
 * 禁用项**仍然渲染**（`disabled` + `aria-disabled` + 原因）：能用眼睛看到「这里有个动作但不能点、
 * 原因是这个」，比按钮凭空消失强。`moreFirst` 让「更多」排在固定按钮之前——框架操作的顺序是
 * 更多 → 最大化/还原 → 隐藏，活动 View 的顺序是 primary → 更多。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {Dropdown, IconButton, type DropdownItem} from "@notnotype/nb-ui/components";
import {foldTitleActionCount, type WorkbenchTitleActionItem} from "nbook/app/utils/workbench/view-title-actions";

const props = withDefaults(defineProps<{
    /** 直接渲染成按钮的项；放不下的自动折进「更多」。 */
    primary?: readonly WorkbenchTitleActionItem[];
    /** 「更多」菜单里的项（含一层子菜单）。 */
    secondary?: readonly WorkbenchTitleActionItem[];
    /** 上下文指纹：一变就关掉已经打开的菜单（切换活动 View / 实例代际时不让旧菜单继续指向旧状态）。 */
    contextKey?: string;
    /** 无障碍名称（i18n 归宿主）；它同时是「更多」按钮标题的前缀。 */
    label?: string;
    /** 这个实例的用途：框架操作用 `panel`、活动 View 操作用 `view`、容器标题操作用 `container`
     * （数据属性供冒烟与测试定位）。 */
    scope?: "view" | "container" | "panel";
    /** 「更多」触发器的位置：框架操作要求它排在固定按钮之前。 */
    moreFirst?: boolean;
    /** 收起细条：只占内容尺寸，不参与横向折叠宽度分配。 */
    compact?: boolean;
}>(), {
    primary: () => [],
    secondary: () => [],
    contextKey: "",
    label: "",
    scope: "view",
    moreFirst: false,
    compact: false,
});

const emit = defineEmits<{(e: "invoke", id: string): void}>();



/** 按钮与间距的兜底尺寸：`IconButton size="sm"` 是 26×26，间距取 `--space-1`（4px）。 */
const TITLE_ACTION_SIZE = 26;
const TITLE_ACTION_GAP = 4;

const root = ref<HTMLElement | null>(null);
const menuOpen = ref(false);
/** 放得下的 primary 个数；`null` = 还不知道（全部渲染，等测量结果）。 */
const visibleCount = ref<number | null>(null);
const availableWidth = ref(0);
/**
 * 是否已经量到**真实布局**。
 *
 * jsdom 里所有元素的尺寸都是 0，这时「父盒 0 宽」不代表没空间，只能算「量不到」；
 * 反过来在真实浏览器里父盒真的被挤成 0（或比一个按钮还窄）时，必须折叠，否则按钮会按
 * `justify-content: flex-end` 向左溢出、盖住旁边的拖动把手（真实浏览器实测过）。
 */
const measurable = ref(false);
const itemWidth = ref(0);
const moreWidth = ref(0);
let observer: ResizeObserver | null = null;

const visiblePrimary = computed(() => props.primary.slice(0, visibleCount.value ?? props.primary.length));
const altActive = ref(false);

function onAltChange(event: KeyboardEvent): void {
    altActive.value = event.altKey;
}

function resetAlt(): void {
    altActive.value = false;
}

function shownAction(item: WorkbenchTitleActionItem): WorkbenchTitleActionItem {
    return altActive.value && item.alternate !== undefined
        ? {...item, id: item.alternate.id, label: item.alternate.label, icon: item.alternate.icon}
        : item;
}
const moreItems = computed<readonly WorkbenchTitleActionItem[]>(() => [
    ...props.primary.slice(visibleCount.value ?? props.primary.length),
    ...props.secondary,
]);
const hasMore = computed(() => moreItems.value.length > 0);
const dropdownItems = computed<DropdownItem[]>(() => moreItems.value.map(toDropdownItem));
const moreLabel = computed(() => (props.label.trim() === "" ? "更多" : `${props.label}：更多`));

/**
 * 禁用的原因要看得见：按钮进 `title` / `aria-label`，菜单项接在标题后面（原语没有原因位）。
 */
function titleOf(item: WorkbenchTitleActionItem): string {
    return item.disabled === true && item.reason !== undefined ? `${item.label}（${item.reason}）` : item.label;
}

/** 展示项 → nb-ui 菜单项：`checked` / `type` / `group` / `children` 原样交给原语。 */
function toDropdownItem(item: WorkbenchTitleActionItem): DropdownItem {
    return {
        label: titleOf(item),
        value: item.id,
        disabled: item.disabled === true,
        ...(item.icon === undefined ? {} : {iconClass: item.icon}),
        ...(item.checked === undefined ? {} : {checked: item.checked}),
        ...(item.type === undefined ? {} : {type: item.type}),
        ...(item.group === undefined ? {} : {group: item.group}),
        ...(item.children === undefined ? {} : {children: item.children.map(toDropdownItem)}),
        ...(item.busy === true ? {rightIconClass: "i-lucide-loader-circle"} : {}),
    };
}

function onMoreSelect(id: string): void {
    emit("invoke", id);
}

/**
 * 折叠判定。
 *
 * 先按可用宽度算「放得下几个」；要**展开**时留一个按钮的余量（迟滞），
 * 否则「折一点 → 空间变大 → 再展开」会在临界宽度上来回抖。
 */
function recomputeFold(): void {
    if (!measurable.value) {
        // 量不到（jsdom / 还没挂载）：全部直接渲染，折叠等真实布局出来再说。
        visibleCount.value = null;
        return;
    }
    if (availableWidth.value <= 0) {
        // 真实布局里父盒连一格都没有：只留「更多」触发器（primary 全折），别让整排溢出。
        visibleCount.value = 0;
        return;
    }
    const size = itemWidth.value > 0 ? itemWidth.value : TITLE_ACTION_SIZE;
    const moreSize = moreWidth.value > 0 ? moreWidth.value : TITLE_ACTION_SIZE;
    const count = props.primary.length;
    const foldAt = foldTitleActionCount({
        count,
        itemWidth: size,
        moreWidth: moreSize,
        gap: TITLE_ACTION_GAP,
        availableWidth: availableWidth.value,
        hasSecondary: props.secondary.length > 0,
    });
    const current = visibleCount.value ?? count;
    if (foldAt < current) {
        visibleCount.value = foldAt;
        return;
    }
    /*
     * 展开方向留一个按钮的余量（迟滞），`foldAt === current` 时保持原样。
     *
     * **不能**在相等时再拿 `availableWidth - size` 算一次：盒子比一个按钮还窄时那个值是负数，
     * 折叠函数把"测不到宽度"当成"不要折"而返回全部项——于是按钮不折、整排按 `justify-content: flex-end`
     * 溢出到左边，**盖住拖动把手**（真实浏览器实测：320px 的竖直面板里，按把手点到的是"隐藏面板"）。
     */
    if (foldAt > current) {
        visibleCount.value = foldTitleActionCount({
            count,
            itemWidth: size,
            moreWidth: moreSize,
            gap: TITLE_ACTION_GAP,
            availableWidth: availableWidth.value - size,
            hasSecondary: props.secondary.length > 0,
        });
    }
}

/** 测量：可用宽度取**父容器**（宿主给这个部件的位置），按钮尺寸取实际渲染值并带兜底。 */
function measure(): void {
    const element = root.value;
    if (element === null) {
        return;
    }
    const container = element.parentElement ?? element;
    const containerWidth = container.clientWidth;
    const selfWidth = element.clientWidth;
    /*
     * 「能不能量」看文档级布局，不看自己的盒子：被挤成 0 宽时父盒与自身都是 0，
     * 那时是**真的没空间**（要折），而不是「量不到」；jsdom 里 `documentElement.clientWidth` 是 0。
     */
    measurable.value = document.documentElement.clientWidth > 0 || containerWidth > 0 || selfWidth > 0;
    availableWidth.value = containerWidth > 0 ? containerWidth : selfWidth;
    itemWidth.value = element.querySelector<HTMLElement>("[data-title-action]:not([data-title-action='more'])")?.offsetWidth ?? 0;
    moreWidth.value = element.querySelector<HTMLElement>("[data-title-action='more']")?.offsetWidth ?? 0;
    recomputeFold();
}

watch(() => props.contextKey, () => {
    menuOpen.value = false;
});

watch([() => props.primary, () => props.secondary], () => {
    // 项变了：先按「还没测过」渲染，等 DOM 更新后重新测量与折叠。
    visibleCount.value = null;
    void nextTick(measure);
});

onMounted(() => {
    window.addEventListener("keydown", onAltChange);
    window.addEventListener("keyup", onAltChange);
    window.addEventListener("blur", resetAlt);
    void nextTick(() => {
        measure();
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        observer = new ResizeObserver(() => measure());
        const container = root.value?.parentElement ?? root.value;
        if (container) {
            observer.observe(container);
        }
    });
});

onBeforeUnmount(() => {
    window.removeEventListener("keydown", onAltChange);
    window.removeEventListener("keyup", onAltChange);
    window.removeEventListener("blur", resetAlt);
    observer?.disconnect();
    observer = null;
});
</script>

<template>
    <div ref="root" class="workbench-title-actions" :class="{'workbench-title-actions--compact': compact}" :data-title-actions="scope">
        <Dropdown v-if="moreFirst && hasMore"
            :items="dropdownItems"
            align="end"
            :open="menuOpen"
            @update:open="menuOpen = $event"
            @select="onMoreSelect">
            <IconButton data-title-action="more" size="sm" icon-class="i-lucide-ellipsis" :title="moreLabel" :aria-label="moreLabel" />
        </Dropdown>

        <IconButton v-for="item in visiblePrimary"
            :key="item.id"
            size="sm"
            :icon-class="shownAction(item).icon"
            :data-title-action="shownAction(item).id"
            :data-title-action-disabled="item.disabled === true ? 'true' : undefined"
            :title="titleOf(shownAction(item))"
            :aria-label="titleOf(shownAction(item))"
            :aria-disabled="item.disabled === true ? 'true' : undefined"
            :disabled="item.disabled === true"
            @click="emit('invoke', shownAction(item).id)" />

        <Dropdown v-if="!moreFirst && hasMore"
            :items="dropdownItems"
            align="end"
            :open="menuOpen"
            @update:open="menuOpen = $event"
            @select="onMoreSelect">
            <IconButton data-title-action="more" size="sm" icon-class="i-lucide-ellipsis" :title="moreLabel" :aria-label="moreLabel" />
        </Dropdown>
    </div>
</template>

<style scoped>
/*
 * 标题条里的动作组：右侧对齐、不换行。
 *
 * **宽度必须是确定的**（`width: 100%` + `flex: 1 1 auto`）：折叠的判据就是这个盒子的可用宽度，
 * 若盒子随内容收缩，折叠结果会反过来改宽度 → ResizeObserver 自激（真实浏览器实测 130 次/秒）。
 * 宿主只需要给一个确定的盒子（见 `WorkbenchTitleActions.md` 的宿主合同），本部件自己吃满它。
 */
.workbench-title-actions {
    display: flex;
    flex: 1 1 auto;
    width: 100%;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    min-width: 0;
}
.workbench-title-actions--compact {
    flex: 0 0 auto;
    width: auto;
}
</style>
