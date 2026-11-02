<script setup lang="ts">
import {computed, ref} from "vue";
import Button from "../../../src/components/controls/Button.vue";
import ColorSwatches from "../../../src/components/form/ColorSwatches.vue";
import DropdownMenu from "../../../src/components/popup/DropdownMenu.vue";
import Menubar from "../../../src/components/popup/Menubar.vue";
import ContextMenu from "../../../src/components/popup/ContextMenu.vue";
import type {ContextMenuItem} from "../../../src/components/popup/context-menu.types";
import QuickPick, {type QuickPickItem} from "../../../src/components/popup/QuickPick.vue";
import Select from "../../../src/components/popup/Select.vue";
import FixtureShell from "./AcceptanceShell.vue";
import type {LabComponentDefinition} from "./definitions";

/**
 * 弹出列表的验收夹具（w00029 t04，e2e/popup-lists.spec.ts）：行高、字号、圆角、高亮与勾选列要在真实布局与真实指针下量，
 * happy-dom 没有布局也不产生指针移动。场景 `menus` 放菜单一族各一个：DropdownMenu（reka 的项加手工级联）、Menubar、
 * 右键菜单（全是普通按钮项）；`select`、`quick-pick` 各放一个，带说明的项与不带说明的项混排；`material` 放 Select、DropdownMenu
 * 与 ColorSwatches 比浮层材质；`long` 与 `quick-pick-long`
 * 是长列表与多级长级联，验截断、滑块与滚动。
 */
const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const controls = ref<Record<string, string | boolean>>({});

const DROPDOWN_ITEMS = [
    {label: "重命名", id: "rename", iconClass: "i-lucide-pencil", shortcut: "F2"},
    {label: "自动换行", id: "wrap", type: "checkbox" as const, checked: true, shortcut: "Alt+Z"},
    {label: "", id: "sep-1", separator: true},
    {label: "排序方式", id: "sort", children: [
        {label: "按名称", id: "sort-name", type: "radio" as const, checked: true, group: "sort"},
        {label: "按修改时间", id: "sort-mtime", type: "radio" as const, checked: false, group: "sort"},
    ]},
    {label: "删除", id: "delete", iconClass: "i-lucide-trash-2", tone: "danger" as const},
];

const MENUBAR_MENUS = [
    {id: "file", label: "文件", items: [
        {label: "新建章节", id: "new", shortcut: "Ctrl+N"},
        {label: "导出", id: "export", children: [
            {label: "Markdown", id: "export-md"},
            {label: "EPUB", id: "export-epub"},
        ]},
    ]},
    {id: "edit", label: "编辑", items: [{label: "撤销", id: "undo", shortcut: "Ctrl+Z"}]},
];

const CONTEXT_ITEMS: ContextMenuItem[] = [
    {label: "新建", iconClass: "i-lucide-file-plus", shortcut: "Ctrl+N"},
    {label: "更多", children: [{label: "子一"}, {label: "子二"}]},
    {separator: true},
    {label: "删除", iconClass: "i-lucide-trash-2", tone: "danger"},
];

const SELECT_OPTIONS = [
    {label: "Markdown", value: "md", iconClass: "i-lucide-file-text"},
    {label: "纯文本", value: "txt", iconClass: "i-lucide-file", description: "不带格式，换行照原样保留"},
    {label: "PDF（暂不可用）", value: "pdf", disabled: true},
];
const format = ref("txt");

const QUICK_PICK_ITEMS: QuickPickItem[] = [
    {id: "open", label: "打开项目", iconClass: "i-lucide-folder-open", shortcut: "Ctrl+O"},
    {id: "chapter", label: "新建章节", iconClass: "i-lucide-file-plus", description: "在当前卷末尾"},
    {id: "export", label: "导出", disabled: true},
    {id: "settings", label: "设置", iconClass: "i-lucide-settings"},
];
const quickPickOpen = ref(props.sceneId === "quick-pick" || props.sceneId === "quick-pick-long");
const quickPickQuery = ref("");
const quickPickActive = ref<string | null>(props.sceneId === "quick-pick-long" ? "命令-1" : "open");

const numbered = (prefix: string, count: number): {label: string; id: string}[] =>
    Array.from({length: count}, (_, index) => ({label: `${prefix} ${String(index + 1)}`, id: `${prefix}-${String(index + 1)}`}));

/** 长列表：主菜单 30 多项、第一项展开 20 项的子菜单（其中第一项再展开 20 项）、第二项只展开 2 项、第三项又是 20 项。 */
const LONG_DROPDOWN_ITEMS = [
    {label: "长子菜单", id: "long", children: [{label: "更深", id: "deeper", children: numbered("孙项", 20)}, ...numbered("子项", 19)]},
    {label: "短子菜单", id: "short", children: numbered("短项", 2)},
    {label: "长子菜单二", id: "long-2", children: numbered("二号子项", 20)},
    {label: "", id: "sep", separator: true},
    ...numbered("主项", 30),
];
const LONG_CONTEXT_ITEMS: ContextMenuItem[] = [
    {label: "长子菜单", children: numbered("子项", 20).map(({label}) => ({label}))},
    {label: "短子菜单", children: [{label: "短项 1"}, {label: "短项 2"}]},
    {separator: true},
    ...numbered("主项", 30).map(({label}) => ({label})),
];
const SHORT_DROPDOWN_ITEMS = numbered("项", 8);
/** 带说明的项与不带说明的项混排：每 4 项有一项带说明。 */
const LONG_SELECT_OPTIONS = numbered("第", 30).map((option, index) => ({value: option.id, label: `${option.label} 章`, description: index % 4 === 1 ? "带一行说明" : undefined}));
const longFormat = ref("第-20");

const QUICK_PICK_LONG: QuickPickItem[] = numbered("命令", 30);
const quickPickLongItems = computed(() => QUICK_PICK_LONG.filter((item) => item.label.includes(quickPickQuery.value)));

const swatch = ref<string | null>("#2e7d55");
const context = ref<{x: number; y: number} | null>(null);
const contextItems = computed(() => (props.sceneId === "long" ? LONG_CONTEXT_ITEMS : CONTEXT_ITEMS));
function openContext(event: MouseEvent): void {
    context.value = {x: event.clientX, y: event.clientY};
}
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div v-if="props.sceneId === 'select'" id="nb-lab-target" class="popup-lists-stage">
            <Select v-model="format" :options="SELECT_OPTIONS" class="w-[220px]" data-fixture-select />
        </div>
        <div v-else-if="props.sceneId === 'material'" id="nb-lab-target" class="popup-lists-stage">
            <!-- 三种浮层比材质：都只认 .nb-ui-popover-surface 与 .nb-ui-menu-surface 两个类。 -->
            <Select v-model="format" :options="SELECT_OPTIONS" class="w-[220px]" data-fixture-select />
            <DropdownMenu :items="DROPDOWN_ITEMS" :content-props="{'data-fixture-dropdown': ''}">
                <Button variant="secondary" size="sm" data-fixture-dropdown-trigger>下拉菜单</Button>
            </DropdownMenu>
            <ColorSwatches v-model="swatch" :colors="['#2e7d55', '#b8423a']" custom-label="自定义" />
        </div>
        <div v-else-if="props.sceneId === 'long'" id="nb-lab-target" class="popup-lists-stage">
            <DropdownMenu :items="LONG_DROPDOWN_ITEMS" :content-props="{'data-fixture-long-dropdown': ''}">
                <Button variant="secondary" size="sm" data-fixture-long-dropdown-trigger>长下拉菜单</Button>
            </DropdownMenu>
            <DropdownMenu :items="SHORT_DROPDOWN_ITEMS" :content-props="{'data-fixture-short-dropdown': ''}">
                <Button variant="secondary" size="sm" data-fixture-short-dropdown-trigger>8 项</Button>
            </DropdownMenu>
            <Select v-model="longFormat" :options="LONG_SELECT_OPTIONS" class="w-[200px]" data-fixture-long-select />
            <div data-fixture-context-area class="popup-lists-context" @contextmenu.prevent="openContext">在这里右键</div>
            <ContextMenu :open="context !== null" :x="context?.x ?? 0" :y="context?.y ?? 0" :items="contextItems" @request-close="context = null" />
        </div>
        <div v-else-if="props.sceneId === 'quick-pick' || props.sceneId === 'quick-pick-long'" id="nb-lab-target" class="popup-lists-stage">
            <QuickPick
                v-model:open="quickPickOpen"
                v-model:query="quickPickQuery"
                v-model:active-id="quickPickActive"
                :items="props.sceneId === 'quick-pick' ? QUICK_PICK_ITEMS : quickPickLongItems"
                title="命令"
                placeholder="输入命令"
                empty-text="没有匹配的命令"
                data-fixture-quick-pick
            />
        </div>
        <div v-else id="nb-lab-target" class="popup-lists-stage">
            <DropdownMenu :items="DROPDOWN_ITEMS" :content-props="{'data-fixture-dropdown': ''}">
                <Button variant="secondary" size="sm" data-fixture-dropdown-trigger>下拉菜单</Button>
            </DropdownMenu>
            <Menubar :menus="MENUBAR_MENUS" size="sm" data-fixture-menubar />
            <div data-fixture-context-area class="popup-lists-context" @contextmenu.prevent="openContext">在这里右键</div>
            <ContextMenu :open="context !== null" :x="context?.x ?? 0" :y="context?.y ?? 0" :items="contextItems" @request-close="context = null" />
        </div>
    </FixtureShell>
</template>

<style scoped>
.popup-lists-stage {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 24px;
    min-height: 420px;
}

.popup-lists-context {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 240px;
    height: 120px;
    border: 1px dashed var(--divider);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 12px;
}
</style>
