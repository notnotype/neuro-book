<script setup lang="ts">
import {computed, ref} from "vue";
import {useNotification} from "../../../src/composables";
import type {ContextMenuItem} from "../../../src/components/feedback/context-menu.types";
import type {QuickInputItem} from "../../../src/components/feedback/QuickInput.vue";
import type {TabsItem} from "../../../src/components/controls/Tabs.vue";
import type {TableColumn} from "../../../src/components/display/Table.vue";
import type {BadgeTone} from "../../../src/components/display/Badge.vue";

// 这一页渲染当前 nb-ui 公共组件，重点观察 NeuroBook 的纸面、器械和控件表面角色是否一致。
// 尺寸与行为仍由组件合同负责；主题切换只改变已经登记的形状、颜色与材料角色。
const notification = useNotification();
const dialogOpen = ref(false);
const windowOpen = ref(false);
const windowWidth = ref(420);
const windowHeight = ref(320);
const mode = ref("source");
const enabled = ref(true);
const name = ref("nb-ui");
const count = ref("3");
const framework = ref<string | null>(null);
const format = ref("");
const formatOptions = [
    {label: "Markdown（.md）", value: "md", description: "适合长文写作", iconClass: "i-lucide-file-text"},
    {label: "纯文本（.txt）", value: "txt", description: "不带格式的文本"},
    {label: "PDF（暂不可用）", value: "pdf", description: "导出器尚未安装", disabled: true},
];
const tags = ref<string[]>(["vue", "nuxt"]);
const activeTab = ref("controls");
const page = ref(3);

// QuickInput 受控演示：候选、查询与活动项都由宿主决定，原语只报告请求
const quickInputOpen = ref(false);
const quickInputQuery = ref(">");
const quickInputActiveId = ref<string | null>(null);
const quickInputItems: readonly QuickInputItem[] = [
    {id: "chapter.new", label: "新建章节文档", category: "章节", shortcut: "Ctrl+N"},
    {id: "world.entity", label: "打开世界观词条", category: "设定集", description: "检索人物、势力与地点"},
    {id: "export.mobi", label: "导出 MOBI（转换器未安装）", category: "导出", disabled: true},
];
const quickInputVisibleItems = computed(() => {
    const text = quickInputQuery.value.replace(/^>/u, "").trim().toLowerCase();
    return text === "" ? quickInputItems : quickInputItems.filter((item) => item.label.toLowerCase().includes(text));
});

function syncQuickInputActive(): void {
    const current = quickInputActiveId.value;
    if (current !== null && quickInputVisibleItems.value.some((item) => item.id === current && !item.disabled)) return;
    quickInputActiveId.value = quickInputVisibleItems.value.find((item) => !item.disabled)?.id ?? null;
}

function openQuickInput(): void {
    quickInputQuery.value = ">";
    syncQuickInputActive();
    quickInputOpen.value = true;
}

function setQuickInputQuery(value: string): void {
    quickInputQuery.value = value;
    syncQuickInputActive();
}

function acceptQuickInput(id: string): void {
    quickInputOpen.value = false;
    notification.success(`执行命令 ${id}`);
}

const menuItems = [
    {label: "复制", value: "copy", iconClass: "i-lucide-copy"},
    {label: "导出", value: "export", iconClass: "i-lucide-download"},
    {label: "已选择", value: "active", active: true, rightIconClass: "i-lucide-check"},
    {label: "", value: "sep", separator: true},
    {label: "删除", value: "delete", iconClass: "i-lucide-trash-2", tone: "danger" as const},
];

const tabItems: TabsItem[] = [
    {value: "controls", label: "控件", iconClass: "i-lucide-sliders-horizontal"},
    {value: "data", label: "数据", count: 4},
    {value: "off", label: "禁用", disabled: true},
];

// 右键菜单演示：含子菜单 / 危险项 / 分隔线
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextItems: ContextMenuItem[] = [
    {label: "打开", iconClass: "i-lucide-folder-open", shortcut: "Enter", action: () => notification.info("打开")},
    {label: "重命名", iconClass: "i-lucide-pencil", action: () => notification.info("重命名")},
    {
        label: "导出为",
        iconClass: "i-lucide-download",
        children: [
            {label: "Markdown", action: () => notification.info("导出 Markdown")},
            {label: "JSON", action: () => notification.info("导出 JSON")},
        ],
    },
    {separator: true},
    {label: "删除", iconClass: "i-lucide-trash-2", tone: "danger", action: () => notification.warning("已删除")},
];

function openContextMenu(event: MouseEvent): void {
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuVisible.value = true;
}

// Table 演示数据
type DemoRow = {id: string; name: string; status: string; size: number};
const tableRows: DemoRow[] = [
    {id: "1", name: "chapter-01.md", status: "synced", size: 12},
    {id: "2", name: "chapter-02.md", status: "draft", size: 8},
    {id: "3", name: "outline.md", status: "conflict", size: 3},
];
const tableColumns: TableColumn<DemoRow>[] = [
    {key: "name", label: "文件"},
    {key: "status", label: "状态", width: "110px"},
    {key: "size", label: "KB", width: "70px", align: "right"},
];
const statusTone: Record<string, BadgeTone> = {synced: "success", draft: "warning", conflict: "danger"};
</script>

<template>
    <!--
        铺一层窗体底纹。玻璃需要「背后有东西」才看得见：这一页原本是一片纯色 --bg-main，
        浮层再怎么磨砂也是把纯色糊成纯色，看起来就跟没开一样。
        非玻璃主题下 --window-backdrop 为 none，这一句是惰性的。

        底纹挂在页面上而不是 app.vue 的外壳上：外壳刻意不吃主题变量（见那边的注释），
        切主题时它要保持不动，变化才归因得到内容区。
    -->
    <main
        class="p-6 text-[var(--text-main)]"
        style="background-image: var(--window-backdrop, none); background-attachment: fixed"
    >
        <section class="mx-auto max-w-5xl space-y-6">
            <header>
                <h1 class="text-2xl font-semibold">组件画廊</h1>
                <p class="mt-2 text-sm text-[var(--text-secondary)]">
                    这里展示 nb-ui 公共组件在当前主题下的真实状态。NeuroBook 将暖纸内容面、冷色器械面和控件表面分开，主题判断请看
                    <NuxtLink to="/" class="underline">主题对照页</NuxtLink>。
                </p>
            </header>

            <!-- 导航：Tabs + Pagination -->
            <Panel class="space-y-4" padding="sm">
                <Tabs v-model="activeTab" :items="tabItems" aria-label="演示分区" size="sm" />
                <div class="flex items-center gap-3">
                    <Pagination v-model:page="page" :page-count="9" />
                    <span class="text-xs text-[var(--text-muted)]">第 {{ page }} / 9 页</span>
                </div>
            </Panel>

            <div class="grid gap-4 md:grid-cols-2">
                <Panel class="space-y-4" padding="sm">
                    <h2 class="text-base font-medium">Controls</h2>
                    <SegmentedControl v-model="mode" :options="[
                        {label: '源码', value: 'source', iconClass: 'i-lucide-code-2'},
                        {label: '预览', value: 'preview', count: 2},
                        {label: '警告', value: 'warning', tone: 'warning'},
                    ]" />
                    <SwitchField v-model="enabled" label="启用功能" description="继承 llmlint 的轻量开关样式。" />
                    <Dropdown :items="menuItems" @select="notification.info(`选择了 ${$event}`)">
                        <Button variant="secondary" block class="justify-start">打开菜单（方向键可导航）</Button>
                    </Dropdown>
                    <div class="flex items-center gap-2">
                        <IconButton title="通知" variant="accent" @click="notification.success('操作成功', {title: '通知'})">
                            <span class="i-lucide-bell h-4 w-4"></span>
                        </IconButton>
                        <IconButton title="删除" variant="danger">
                            <span class="i-lucide-trash-2 h-4 w-4"></span>
                        </IconButton>
                        <Tooltip text="hover 延迟显示 / focus 即时显示">
                            <IconButton title="帮助"><span class="i-lucide-circle-help h-4 w-4"></span></IconButton>
                        </Tooltip>
                    </div>
                </Panel>

                <Panel class="space-y-4" padding="sm">
                    <h2 class="text-base font-medium">Form / Dialog</h2>
                    <FormField label="名称（前缀插槽）">
                        <FormInput v-model="name">
                            <template #prefix><span class="text-[var(--text-muted)]">@</span></template>
                        </FormInput>
                    </FormField>
                    <FormField label="框架（Combobox，↑↓/Enter/Esc）">
                        <Combobox v-model="framework" :options="['Vue', 'React', 'Svelte', 'Solid', 'Nuxt']" placeholder="搜索…" />
                    </FormField>
                    <FormField label="格式（富选项 / 固定向下展开）">
                        <FormSelect v-model="format" :options="formatOptions" placeholder="选择格式" dropdown-direction="down" />
                    </FormField>
                    <FormField label="标签（TagInput，Enter/逗号添加）">
                        <TagInput v-model="tags" placeholder="输入后回车" />
                    </FormField>
                    <FormField label="数量（字符串中间态 / Enter 提交）">
                        <FormNumberInput v-model="count" min="0" max="20" step="0.5" @submit="notification.info('数字输入已提交')" />
                    </FormField>
                    <FormCheckbox v-model="enabled" />
                    <div class="flex gap-2">
                        <Button @click="dialogOpen = true">打开 Dialog</Button>
                        <Button variant="secondary" @click="windowOpen = true">打开浮动窗口</Button>
                        <Button variant="secondary" @click="openQuickInput">快速输入</Button>
                    </div>
                </Panel>
            </div>

            <!-- 展示原语 -->
            <Panel class="space-y-4" padding="sm">
                <h2 class="text-base font-medium">Display</h2>
                <div class="flex flex-wrap items-center gap-2">
                    <Badge>默认</Badge>
                    <Badge tone="accent">进行中</Badge>
                    <Badge tone="success" dot>在线</Badge>
                    <Badge tone="warning" variant="outline">待审核</Badge>
                    <Badge tone="danger" variant="solid">冲突</Badge>
                    <Spinner show-label />
                </div>
                <div class="flex items-center gap-3">
                    <Skeleton shape="circle" />
                    <div class="flex-1 space-y-2">
                        <Skeleton width="40%" />
                        <Skeleton width="70%" />
                    </div>
                </div>
            </Panel>

            <!-- 数据表 + 右键菜单演示 -->
            <Panel padding="none">
                <div class="border-b border-[var(--border-color)] px-4 py-3 text-sm text-[var(--text-secondary)]">在下方表格区域右键打开 ContextMenu（含子菜单 / 危险项）</div>
                <div @contextmenu.prevent="openContextMenu">
                    <Table :columns="tableColumns" :rows="tableRows" row-key="id">
                        <template #cell-status="{value}">
                            <Badge :tone="statusTone[String(value)] ?? 'neutral'" size="sm" dot>{{ value }}</Badge>
                        </template>
                    </Table>
                </div>
            </Panel>

            <Panel padding="none">
                <EmptyState icon-class="i-lucide-search-x" title="没有匹配的结果" description="EmptyState 常与 Table 空态搭配使用。" />
            </Panel>
        </section>

        <Dialog v-model="dialogOpen" title="组件库 Dialog" show-cancel>
            <p>焦点会被困在对话框内（Tab 循环），Esc 关闭后归还给触发按钮，背景滚动被锁定。</p>
            <FormField label="试试 Tab 循环" class="mt-3">
                <FormInput model-value="" name="trap-demo" />
            </FormField>
        </Dialog>

        <DialogWindow
            v-model="windowOpen"
            title="非模态浮动窗口"
            :width="windowWidth"
            :height="`${windowHeight}px`"
            :resizable="true"
            body-class="overflow-y-auto px-4 py-3"
            @update:width="windowWidth = $event"
            @update:height="windowHeight = $event"
        >
            <div class="space-y-3">
                <p>标题栏可拖动，页面其余部分保持可交互；窗口至少保留一角在视口内。</p>
                <p>右侧、底部和右下角手柄支持鼠标拖动；聚焦手柄后可用方向键调整尺寸。</p>
                <div class="h-72 rounded-[var(--radius-control)] border border-dashed border-[var(--divider)] p-3 text-xs text-[var(--text-muted)]">长内容滚动区域</div>
            </div>
            <template #footer>
                <Button size="sm" variant="secondary" @click="windowOpen = false">关闭浮动窗口</Button>
            </template>
        </DialogWindow>

        <QuickInput
            :open="quickInputOpen"
            :query="quickInputQuery"
            :items="quickInputVisibleItems"
            :active-id="quickInputActiveId"
            title="组件画廊命令"
            placeholder="输入命令名称"
            empty-text="没有匹配的命令"
            @update:open="quickInputOpen = $event"
            @update:query="setQuickInputQuery"
            @update:active-id="quickInputActiveId = $event"
            @accept="acceptQuickInput"
        />

        <ContextMenu :visible="contextMenuVisible" :x="contextMenuX" :y="contextMenuY" :items="contextItems" @close="contextMenuVisible = false" />
    </main>
</template>
