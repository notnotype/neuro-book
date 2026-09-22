<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";
import EditorToolbar from "../../components/editor-workbench/EditorToolbar.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

type SceneKey = "default" | "checked" | "submenu" | "empty";

/** 最近一次 select 回传的叶项读数：只留验收要核对的那几个字段。 */
type SelectedItemReadout = {
    value: string;
    label: string;
    checked: boolean | null;
    type: string | null;
};

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

const SCENE_KEYS: SceneKey[] = ["default", "checked", "submenu", "empty"];

/**
 * 被检视组件要看的菜单结构。结构里不写 `checked`：勾选态只有 data 一个来源，
 * 两处都写会分不清哪个说了算。可勾选项一律显式声明 type，checked 由这里注入。
 * value 在场景内唯一——EditorToolbar 靠它把显示副本映射回原始叶项。
 */
const SCENE_MENUS: Record<SceneKey, MenubarMenuData[]> = {
    default: [
        {
            id: "file",
            label: "文件",
            items: [
                {label: "保存", value: "file.save", shortcut: "Ctrl+S"},
                {label: "全部保存", value: "file.save-all", shortcut: "Ctrl+Shift+S", disabled: true},
                {label: "", value: "file.sep-1", separator: true},
                {label: "重新加载打开方式", value: "file.reload"},
                {label: "关闭全部标签", value: "file.close-all", shortcut: "Ctrl+Shift+W"},
                {label: "", value: "file.sep-2", separator: true},
                {label: "删除当前章节", value: "file.delete-chapter", iconClass: "i-lucide-trash-2", tone: "danger"},
            ],
        },
        {
            id: "edit",
            label: "编辑",
            items: [
                {label: "撤销", value: "edit.undo", shortcut: "Ctrl+Z", disabled: true},
                {label: "重做", value: "edit.redo", shortcut: "Ctrl+Y", disabled: true},
                {label: "", value: "edit.sep-1", separator: true},
                {label: "剪切", value: "edit.cut", shortcut: "Ctrl+X"},
                {label: "复制", value: "edit.copy", shortcut: "Ctrl+C"},
                {label: "粘贴", value: "edit.paste", shortcut: "Ctrl+V"},
                {label: "全选", value: "edit.select-all", shortcut: "Ctrl+A"},
            ],
        },
        {
            id: "view",
            label: "视图",
            items: [
                {label: "放大", value: "view.zoom-in", shortcut: "Ctrl+="},
                {label: "缩小", value: "view.zoom-out", shortcut: "Ctrl+-"},
                {label: "重置缩放", value: "view.zoom-reset", shortcut: "Ctrl+0"},
            ],
        },
        {
            id: "help",
            label: "帮助",
            items: [
                {label: "快捷键指南", value: "help.shortcuts", shortcut: "Ctrl+/"},
                {label: "关于 NeuroBook", value: "help.about", iconClass: "i-lucide-info"},
            ],
        },
    ],
    checked: [
        {
            id: "view",
            label: "视图",
            items: [
                {label: "侧边栏", value: "view.sidebar", type: "checkbox"},
                {label: "大纲", value: "view.outline", type: "checkbox"},
                {label: "行号", value: "view.line-numbers", type: "checkbox"},
                {label: "", value: "view.sep-1", separator: true},
                {label: "阅读主题：浅色", value: "view.theme-light", type: "radio"},
                {label: "阅读主题：棕褐", value: "view.theme-sepia", type: "radio"},
                {label: "阅读主题：深色", value: "view.theme-dark", type: "radio"},
                {label: "", value: "view.sep-2", separator: true},
                {label: "小地图", value: "view.minimap", type: "checkbox", disabled: true},
            ],
        },
        {
            id: "review",
            label: "审阅",
            disabled: true,
            items: [
                {label: "拼写检查", value: "review.spelling"},
                {label: "字数统计", value: "review.word-count"},
            ],
        },
    ],
    submenu: [
        {
            id: "file",
            label: "文件",
            items: [
                {label: "新建章节", value: "file.new-chapter", shortcut: "Ctrl+N"},
                {
                    label: "导出作品",
                    value: "file.export",
                    iconClass: "i-lucide-download",
                    children: [
                        {label: "EPUB 电子书", value: "export.epub", type: "checkbox"},
                        {label: "PDF 文档", value: "export.pdf", type: "checkbox"},
                        {label: "Markdown 纯文本", value: "export.md", type: "checkbox", disabled: true},
                        {label: "", value: "export.sep-1", separator: true},
                        {label: "删除导出缓存", value: "export.clear-cache", tone: "danger"},
                    ],
                },
                {label: "", value: "file.sep-1", separator: true},
                {label: "关闭全部标签", value: "file.close-all", shortcut: "Ctrl+Shift+W"},
            ],
        },
        {
            id: "view",
            label: "视图",
            items: [
                {
                    label: "排版",
                    value: "view.typography",
                    iconClass: "i-lucide-type",
                    children: [
                        {label: "自动换行", value: "layout.wrap", type: "checkbox"},
                        {label: "显示行号", value: "layout.line-numbers", type: "checkbox"},
                        {label: "", value: "layout.sep-1", separator: true},
                        {label: "等宽字体", value: "layout.font-mono", type: "radio"},
                        {label: "衬线字体", value: "layout.font-serif", type: "radio"},
                    ],
                },
            ],
        },
    ],
    empty: [],
};

const sceneKey = computed<SceneKey>(() => SCENE_KEYS.find((key) => key === props.scene) ?? "default");
const menus = computed<MenubarMenuData[]>(() => SCENE_MENUS[sceneKey.value]);
const checkableValues = computed<string[]>(() => collectCheckableValues(menus.value));

const checkedByValue = ref<Record<string, boolean>>(readCheckedSeed(props.data));
const lastSelection = ref<SelectedItemReadout | null>(null);

// 场景切换：所有本地状态回到登记初值。同一场景重复打开、或右栏点「还原」之后，看到的东西必须一样。
watch(() => props.scene, () => {
    checkedByValue.value = readCheckedSeed(props.data);
    lastSelection.value = null;
}, {immediate: true});

// 右栏假数据改动要立刻生效，但只重播勾选态，不动最近回传读数——那是事件记录，不是场景初值。
watch(() => props.data, () => {
    const seed = readCheckedSeed(props.data);
    // 回写数据面板会把刚写出去的值原样带回来；等值时跳过，否则「回写 → 回流 → 再回写」会自激。
    if (!isSameChecked(seed, checkedByValue.value)) {
        checkedByValue.value = seed;
    }
}, {deep: true});

// 回写数据面板：只有登记了 data 的场景才回写，否则右栏会凭空多出一份「可改的假数据」。
watch(checkedByValue, (next) => {
    if (props.data === undefined) {
        return;
    }
    syncLabData({checked: {...next}});
}, {deep: true, immediate: true});

const displayMenus = computed<MenubarMenuData[]>(() => menus.value.map((menu) => ({
    ...menu,
    items: withCheckedState(menu.items),
})));

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
        checkedByValue.value = {
            ...checkedByValue.value,
            [item.value]: !checkedByValue.value[item.value],
        };
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

/** 勾选态注入到每一层：递归下去才能覆盖子菜单里的可勾选项。 */
function withCheckedState(items: MenubarItemData[]): MenubarItemData[] {
    return items.map((item) => {
        const next: MenubarItemData = {...item};
        if (item.type === "checkbox" || item.type === "radio") {
            next.checked = checkedByValue.value[item.value] === true;
        }
        if (item.children !== undefined && item.children.length > 0) {
            next.children = withCheckedState(item.children);
        }
        return next;
    });
}

/** 登记 data 的形状是 {checked: {叶项 value: 初值}}；没登记或形状不符就全按未勾选播种。 */
function readCheckedSeed(value: unknown): Record<string, boolean> {
    const source = isRecord(value) && isRecord(value.checked) ? value.checked : {};
    const seed: Record<string, boolean> = {};
    // 只认结构里登记过的可勾选值：面板里手加的未知键不参与，免得标出 UI 上不存在的勾选态。
    for (const checkable of checkableValues.value) {
        seed[checkable] = source[checkable] === true;
    }
    return seed;
}

function isSameChecked(left: Record<string, boolean>, right: Record<string, boolean>): boolean {
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) {
        return false;
    }
    return keys.every((key) => left[key] === right[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col gap-3 p-3">
        <EditorToolbar
            data-lab-subject
            :menus="displayMenus"
            @select="onSelect"
        />

        <p
            v-if="sceneKey === 'empty'"
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
