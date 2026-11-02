<script setup lang="ts" generic="T extends {label?: string; title?: string; disabled?: boolean; separator?: boolean; iconClass?: string; shortcut?: string; tone?: 'neutral' | 'danger'; checked?: boolean; type?: string}">
import {computed, ref, type Component} from "vue";
import {elementOf} from "../../utils/element-of";
import MenuRow from "./MenuRow.vue";

/**
 * 一级菜单的条目，DropdownMenu、Menubar 与右键菜单共用。行里的几格由 `MenuRow` 画，行的外观是 `.nb-ui-menu-item` 一组类
 * （`styles.css`）；宿主的 `item`、`item-right` 插槽分别替换名称格与右侧那格。
 *
 * 在 reka 的菜单内容里，宿主传入对应的菜单项原语（`DropdownMenuItem`、`MenubarItem`）：条目成为 reka 集合里的项，
 * 上下键、Home、End、首字母跳转、高亮与跳过禁用项都由 reka 负责。手工级联面板与右键菜单不在 reka 的菜单内容里
 * （注入不到菜单上下文），不传原语，渲染为普通按钮，键盘由宿主自己处理；高亮照 reka `MenuItemImpl` 的做法在这里补上：
 * 指针移动时聚焦这一项，聚焦的那一项挂 `data-highlighted`。鼠标与键盘因此指向同一项，不会各亮一项。
 */
const props = defineProps<{
    items: readonly T[];
    active?: T | null;
    /** 宿主给条目追加的类；行的外观已由 `.nb-ui-menu-item` 给出。 */
    itemClass?: (item: T) => string | (string | Record<string, boolean>)[];
    /** reka 的菜单项原语；只在 reka 的菜单内容里传。 */
    itemComponent?: Component;
    /** 文字允许换行，高度随内容；缺省单行截断。 */
    wrap?: boolean;
}>();

const emit = defineEmits<{
    (e: "select", item: T): void;
    (e: "hover", item: T | null, trigger: HTMLElement, immediate: boolean): void;
}>();

/**
 * 左侧一列，勾与图标共用（Task 决定 8）：勾选的项画勾，其它项画自己的图标。这一级有可勾选项或有一项带图标时，
 * 每行都留出这一列，名称才对得齐。
 */
const leadColumn = computed(() => props.items.some((item) => isCheckable(item) || item.iconClass));

function isCheckable(item: T): boolean {
    return item.type === "radio" || item.type === "checkbox" || item.checked !== undefined;
}

/** 普通按钮项里当前聚焦的那一项（下标）；reka 的项自己挂高亮，不经这里。 */
const focusedIndex = ref<number | null>(null);

function hasChildren(item: T): boolean {
    return "children" in item && Array.isArray(item.children) && item.children.length > 0;
}
function role(item: T): string {
    if (item.type === "radio") return "menuitemradio";
    if (item.type === "checkbox") return "menuitemcheckbox";
    return "menuitem";
}
function onKeydown(item: T, event: KeyboardEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!hasChildren(item) || event.key !== "ArrowRight" || !target || !("getBoundingClientRect" in target)) return;
    event.preventDefault();
    // reka 的一级菜单（Menubar 的菜单内容）把冒泡上来的右方向键当成“切到下一组”，不看 defaultPrevented：展开了子菜单就不让它
    // 再冒泡。宿主预约焦点的 rootKeydown 挂在 capture 上，已经先处理过；普通按钮项要冒泡给宿主的级联键盘，不拦。
    if (props.itemComponent !== undefined) event.stopPropagation();
    target.setAttribute("aria-expanded", "true");
    emit("hover", item, target, true);
}
/**
 * reka 菜单项的元素，按下标。reka 的 `select` 事件只交给监听者、没有在元素上派发，`currentTarget` 永远是 null，
 * 展开子菜单要的父项元素只能从这里取。
 */
const rekaItems = new Map<number, HTMLElement>();
function setRekaItem(index: number, element: unknown): void {
    const node = elementOf(element);
    if (node === null) rekaItems.delete(index);
    else rekaItems.set(index, node);
}
/** reka 的选择（点击、Enter、空格）：级联父项阻止默认的关闭，改为展开下一级。 */
function onRekaSelect(item: T, index: number, event: Event): void {
    if (hasChildren(item)) {
        event.preventDefault();
        const trigger = rekaItems.get(index);
        if (trigger !== undefined) emit("hover", item, trigger, true);
        return;
    }
    emit("select", item);
}
function onButtonClick(item: T, event: MouseEvent): void {
    if (hasChildren(item)) emit("hover", item, event.currentTarget as HTMLElement, true);
    else emit("select", item);
}
/** 普通按钮项：指针真的移动时把焦点移到这一项（与 reka 相同，只认鼠标，跳过禁用项）。 */
function onButtonPointermove(item: T, event: PointerEvent): void {
    if (event.pointerType !== "mouse" || item.disabled) return;
    const target = event.currentTarget as HTMLElement;
    if (document.activeElement !== target) target.focus({preventScroll: true});
}
/**
 * 普通按钮项：指针离开时清掉高亮（与 reka 相同）。焦点交给所在的那一级面板（`role="menu"`，可以接收焦点），
 * 而不是失焦：键盘仍在这一级，宿主的方向键从首末项接着走。
 */
function onButtonPointerleave(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (event.pointerType !== "mouse" || document.activeElement !== target) return;
    target.closest<HTMLElement>("[role='menu']")?.focus({preventScroll: true});
}
/** 两种形态共用的属性：语义、勾选、级联、说明（禁用原因经 `title` 给出，也作读屏的描述）。 */
function common(item: T): Record<string, unknown> {
    return {
        "role": role(item),
        "aria-checked": item.type === "radio" || item.type === "checkbox" ? item.checked === true : undefined,
        "aria-haspopup": hasChildren(item) ? "menu" : undefined,
        "aria-expanded": hasChildren(item) ? props.active === item : undefined,
        "title": item.title,
        "aria-description": item.title,
        "class": [
            "nb-ui-menu-item",
            {"nb-ui-menu-item--multiline": props.wrap === true, "nb-ui-menu-item-danger": item.tone === "danger"},
            props.itemClass?.(item) ?? "",
        ],
    };
}
</script>

<template>
    <template v-for="(item, index) in items" :key="index">
        <div v-if="item.separator" role="separator" class="nb-ui-menu-separator"></div>
        <component
            :is="itemComponent"
            v-else-if="itemComponent"
            :ref="(element: unknown) => setRekaItem(index, element)"
            v-bind="common(item)"
            :disabled="item.disabled"
            :text-value="item.label"
            @select="onRekaSelect(item, index, $event)"
            @pointerenter="emit('hover', hasChildren(item) ? item : null, $event.currentTarget as HTMLElement, false)"
            @mouseenter="emit('hover', hasChildren(item) ? item : null, $event.currentTarget as HTMLElement, false)"
            @keydown="onKeydown(item, $event)"
        >
            <MenuRow :label="item.label" :lead-column="leadColumn" :checked="item.checked === true" :icon="item.iconClass" :hint="item.shortcut" :submenu="hasChildren(item)">
                <template #label><slot name="item" :item="item" /></template>
                <template #right><slot name="item-right" :item="item" /></template>
            </MenuRow>
        </component>
        <button
            v-else
            type="button"
            v-bind="common(item)"
            :disabled="item.disabled"
            :data-highlighted="focusedIndex === index ? '' : undefined"
            @pointerenter="emit('hover', hasChildren(item) ? item : null, $event.currentTarget as HTMLElement, false)"
            @mouseenter="emit('hover', hasChildren(item) ? item : null, $event.currentTarget as HTMLElement, false)"
            @pointermove="onButtonPointermove(item, $event)"
            @pointerleave="onButtonPointerleave"
            @focus="focusedIndex = index"
            @blur="focusedIndex === index && (focusedIndex = null)"
            @click="onButtonClick(item, $event)"
            @keydown="onKeydown(item, $event)"
        >
            <MenuRow :label="item.label" :lead-column="leadColumn" :checked="item.checked === true" :icon="item.iconClass" :hint="item.shortcut" :submenu="hasChildren(item)">
                <template #label><slot name="item" :item="item" /></template>
                <template #right><slot name="item-right" :item="item" /></template>
            </MenuRow>
        </button>
    </template>
</template>
