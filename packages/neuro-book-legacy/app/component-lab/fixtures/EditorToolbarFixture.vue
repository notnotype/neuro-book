<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";
import EditorToolbar from "../../components/editor-workbench/EditorToolbar.vue";
import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

/** 最近一次 select 回传的叶项读数：只留验收要核对的那几个字段。 */
type SelectedItemReadout = {
    value: string;
    label: string;
    checked: boolean | null;
    type: string | null;
};

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EditorToolbar>(() => props.input, ["split", "action"]);
const emitLabEvent = useLabEventSink();
const menus = computed(() => (props.input?.props?.menus ?? []) as MenubarMenuData[]);
const checkableValues = computed(() => collectCheckableValues(menus.value));

const lastSelection = ref<SelectedItemReadout | null>(null);
watch(() => props.scene, () => { lastSelection.value = null; }, {immediate: true});
const checkedByValue = computed(() => Object.fromEntries(checkableValues.value.map((key) => [key, findChecked(menus.value, key)])));

function findChecked(source: MenubarMenuData[], key: string): boolean {
    const find = (items: MenubarItemData[]): boolean | undefined => {
        for (const item of items) {
            if (item.value === key) return item.checked === true;
            const nested = item.children ? find(item.children) : undefined;
            if (nested !== undefined) return nested;
        }
        return undefined;
    };
    for (const menu of source) {
        const checked = find(menu.items);
        if (checked !== undefined) return checked;
    }
    return false;
}

function toggleChecked(source: MenubarMenuData[], key: string): MenubarMenuData[] {
    const change = (items: MenubarItemData[]): MenubarItemData[] => items.map((item) => ({
        ...item,
        ...(item.value === key ? {checked: item.checked !== true} : {}),
        ...(item.children ? {children: change(item.children)} : {}),
    }));
    return source.map((menu) => ({...menu, items: change(menu.items)}));
}

const lastSelectionText = computed(() => (lastSelection.value === null
    ? "（还没有点过菜单项）"
    : JSON.stringify(lastSelection.value, null, 2)));

/** 回传值是本地的哪一档、点完翻转成什么，用一句话说清，省得对着两个菜单反复比。 */
const selectionNote = computed(() => {
    if (lastSelection.value === null) {
        return "点开一个菜单、选中一项，这里就会显示它回传的 value / label / checked / type。";
    }
    const value = lastSelection.value.value;
    const local = checkedByValue.value[value];
    if (local === undefined) {
        return "这条叶项不是可勾选项，本地没有它的勾选态。";
    }
    return `本地 checkedByValue = ${local}（点击时已翻转）；回传的 label 不带 "(已选中)" 后缀、checked 也仍是点击前的值，所以拿到的是原始叶项。`;
});

function onSelect(item: MenubarItemData): void {
    // 组件把 checked 项换成「label 加后缀 + check 图标」的显示副本，select 时又映射回原始叶项，
    // 所以这里读到的 checked 是点击前的快照，不是点击后的值。
    lastSelection.value = {
        value: item.value,
        label: item.label,
        checked: item.checked ?? null,
        type: item.type ?? null,
    };
    // 只翻转被点的叶项：单选互斥、勾选组联动属于宿主的业务状态机，fixture 不替它推演。
    if (item.value in checkedByValue.value) {
        subject.write("props", "menus", toggleChecked(menus.value, item.value));
    }
    emitLabEvent("select", item);
}

/** 与 EditorToolbar 的可勾选判定同口径：显式 type 是 checkbox / radio。 */
function collectCheckableValues(source: MenubarMenuData[]): string[] {
    const values: string[] = [];
    const walk = (items: MenubarItemData[]): void => {
        for (const item of items) {
            if (item.type === "checkbox" || item.type === "radio") {
                values.push(item.value);
            }
            if (item.children !== undefined && item.children.length > 0) {
                walk(item.children);
            }
        }
    };
    for (const menu of source) {
        walk(menu.items);
    }
    return values;
}

</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col gap-3 p-3">
        <EditorToolbar
            data-lab-subject
            v-bind="subject.bindings.value"
            @select="onSelect"
        />

        <p
            v-if="props.scene === 'empty'"
            class="shrink-0 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-3 py-2 text-xs leading-5 text-[var(--text-muted)]"
        >
            场景说明：menus 是空数组。上面那个窄窄的描边空盒子就是 nb-ui Menubar 的外壳——它照旧渲染，
            但里面一个菜单触发按钮都没有，也不该报错；这一条场景就是来看这个空壳的。
        </p>

        <section class="flex min-h-0 flex-1 flex-col gap-2 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p class="text-xs font-medium text-[var(--text-main)]">最近一次 select 回传的叶项</p>
                <p class="text-[11px] text-[var(--text-muted)]">点菜单按钮展开，弹出层渲染在 Portal 里</p>
            </div>
            <pre class="min-h-0 flex-1 overflow-auto rounded-[var(--radius-control)] border border-[var(--divider)] px-2 py-1.5 font-mono text-[11px] leading-5 text-[var(--text-main)]">{{ lastSelectionText }}</pre>
            <p class="shrink-0 text-[11px] leading-5 text-[var(--text-muted)]">{{ selectionNote }}</p>
        </section>
    </div>
</template>
