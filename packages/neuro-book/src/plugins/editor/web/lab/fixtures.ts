import {defineLabFixture, defineSubjectFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type EditorGroupHead from "nbook/plugins/editor/web/components/EditorGroupHead.vue";
import type EditorBreadcrumbs from "nbook/plugins/editor/web/components/EditorBreadcrumbs.vue";
import {fileIconForName} from "nbook/ui/file-icons/file-icons";
import type CodeInput from "nbook/plugins/editor/web/components/CodeInput.vue";
import type EditorPageBreadcrumbs from "nbook/plugins/editor/web/components/EditorPageBreadcrumbs.vue";
import type EditorTabBar from "nbook/plugins/editor/web/components/EditorTabBar.vue";


export const fixtures: LabFixture[] = [
    defineLabFixture<typeof EditorGroupHead>({
        component: "EditorGroup",
        // 集成场景：真实的编辑器区控制器、文档模型与控件，文件换成内存适配器；界面语言由场景 id 决定（`english` 用英文），输入只给多行标签（它是头的属性，所以类型按头）。
        scenes: [
            {id: "live", label: "内存数据：两个标签", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "split", label: "向右拆分的两组", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "english", label: "英文界面", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "empty", label: "没有标签：标志与提示", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "dialect", label: "Markdown 方言、提示块与原样内容", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "stickers", label: "表情：显示成图、一段只有表情的大图、打出结尾冒号变成表情", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "comments", label: "批注：批注末尾的小符号出浮层、按住 Ctrl 悬停，Ctrl+Alt+M 加批注，块菜单整块批注", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "comments-margin", label: "批注：页边开着（视口够宽时画在稿纸右边）", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "comments-slots", label: "批注页边：一段几条批注、短段与长段、下一段有无批注、表格行", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "comments-overlap", label: "批注：重叠的波浪线、块批注的显示", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "unrepresentable", label: "写不出：组顶部的提示", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "recycle", label: "回收：每种编辑器只留 2 个控件", input: {props: {groupId: "g0", wrapTabs: true}}},
        ],
        load: async () => (await import("./EditorAreaFixture.vue")).default,
    }),
    defineSubjectFixture<typeof EditorBreadcrumbs>({
        component: "EditorBreadcrumbs",
        events: ["open", "reveal", "escape"],
        class: "w-full",
        scenes: (() => {
            const segments = [
                {kind: "root" as const, label: "长夜", address: "project://"},
                {kind: "dir" as const, label: "正文", address: "project://正文"},
                {kind: "dir" as const, label: "卷一 一个相当长的卷名用来看截断", address: "project://正文/卷一 一个相当长的卷名用来看截断"},
                {kind: "file" as const, label: "第二章 旧城.md", address: "project://正文/卷一 一个相当长的卷名用来看截断/第二章 旧城.md", icon: fileIconForName("第二章 旧城.md")},
            ];
            const outline = {binding: "lab", version: 1, items: [{id: "h0", level: 1, text: "第二章 旧城"}, {id: "h1", level: 2, text: "雨夜的来客"}, {id: "h2", level: 2, text: "旧书店"}], current: "h1"};
            const base = {segments, parent: segments[2]?.address ?? null, locale: "zh-CN" as const};
            return [
                {id: "outline", label: "目录、文件与光标所在的标题", input: {props: {...base, outline}}},
                {id: "plain", label: "不是 Markdown：没有标题段", input: {props: {...base, outline: null}}},
            ];
        })(),
        // 目录下拉的列表：场景里的假数据，点哪个目录都列出同样几项。
        runtimeProps: async () => ({list: async (address: string) => ({ok: true as const, entries: [{name: "卷二", address: `${address}/卷二`, kind: "directory" as const}, {name: "第一章 雨夜.md", address: `${address}/第一章 雨夜.md`, kind: "file" as const}, {name: "第二章 旧城.md", address: `${address}/第二章 旧城.md`, kind: "file" as const}]})}),
        subject: () => import("nbook/plugins/editor/web/components/EditorBreadcrumbs.vue"),
    }),
    defineLabFixture<typeof CodeInput>({
        component: "CodeInput",
        scenes: [
            {id: "text", label: "两段文字", input: {props: {label: "主文字"}, model: {modelValue: "星瑕是个不怎么出门的数字游民，靠给各种工作室做外包维生。\n\n她的银白色长发是天生的，<V of=\"character.发色\" /> 这样的标签写一个字段的值。"}}},
            {id: "empty", label: "空的", input: {props: {label: "主文字"}, model: {modelValue: ""}}},
            {id: "readonly", label: "只读", input: {props: {label: "主文字", readonly: true}, model: {modelValue: "提交期间不能输入，能选能复制。"}}},
            {id: "json", label: "JSON", input: {props: {label: "设置", language: "json"}, model: {modelValue: "{\n    \"name\": \"星瑕\",\n    \"age\": 22\n}"}}},
            {id: "long-line", label: "很长的一行：折行，不出横向滚动", input: {props: {label: "主文字"}, model: {modelValue: "一行很长很长的文字".repeat(40)}}},
            {id: "stack", label: "二十个排在一起：进入视野才建编辑器", input: {props: {label: "第 1 块"}, model: {modelValue: "第 1 块\n\n往下滚，下面的块才建编辑器。"}}},
            {id: "english", label: "英文", input: {props: {label: "Text"}, model: {modelValue: "Xingxia rarely leaves her flat; she lives on contract work for small studios.\n\nHer silver hair is natural."}}},
        ],
        load: async () => (await import("./CodeInputFixture.vue")).default,
    }),
    defineLabFixture<typeof EditorPageBreadcrumbs>({
        component: "EditorPageBreadcrumbs",
        scenes: [
            {id: "entry", label: "条目页：设定 › 人物 › 星瑕 › 哥哥（“人物”与最后一段不可点）", input: {props: {items: [{label: "设定"}, {label: "人物"}, {label: "星瑕"}, {label: "哥哥"}]}}},
            {id: "long", label: "中间的段很长：先缩短它", input: {props: {items: [{label: "设定"}, {label: "改动记录里一条很长很长的修订标题：按故事种子开局，建了 18 个条目、10 条前史，记下 7 个未决问题"}, {label: "这次改动"}]}}},
            {id: "plain", label: "没有可点的段", input: {props: {items: [{label: "设定"}, {label: "第 2 章"}, {label: "订了星瑾小时候最喜欢的蛋糕"}]}}},
        ],
        load: async () => (await import("./EditorPageBreadcrumbsFixture.vue")).default,
    }),
    defineSubjectFixture<typeof EditorTabBar>({
        component: "EditorTabBar",
        events: ["activate", "keep", "close", "unpin", "move", "menu"],
        class: "w-full",
        scenes: (() => {
            type Extra = {preview?: boolean; dirty?: boolean; active?: boolean; pinned?: boolean; hint?: string};
            const tab = (id: string, label: string, extra: Extra = {}) => ({id, label, title: `project://chapters/${label}`, preview: extra.preview ?? false, dirty: extra.dirty ?? false, active: extra.active ?? false, pinned: extra.pinned ?? false, icon: fileIconForName(label), hint: extra.hint ?? null});
            const base = {label: "打开的编辑器", unsavedLabel: "未保存", pinnedLabel: "已固定"};
            const typical = [
                tab("p1", "大纲.md", {pinned: true}),
                tab("p2", "人物.md", {pinned: true, dirty: true}),
                tab("t1", "第一章 雨夜.md"),
                tab("t2", "第二章 旧城.md", {active: true, dirty: true}),
                tab("t3", "README.md", {hint: "notes"}),
                tab("t4", "README.md", {hint: "drafts"}),
                tab("t5", "cover.png"),
                tab("t6", "第三章 渡口.md", {preview: true}),
            ];
            const many = [tab("p1", "大纲.md", {pinned: true}), ...Array.from({length: 18}, (_, index) => tab(`t${String(index)}`, `第${String(index + 1)}章 一个相当长的章节标题.md`, {active: index === 9, dirty: index % 4 === 0}))];
            return [
                {id: "mixed", label: "固定、未保存、同名、预览与活动标签", input: {props: {...base, tabs: typical}}},
                {id: "many", label: "多行：固定标签单独一行，普通标签至多 3 行后滚动", input: {props: {...base, tabs: many}}},
                {id: "single-line", label: "关掉多行：一行横向滚动", input: {props: {...base, tabs: many, wrap: false}}},
                {id: "inactive-group", label: "不是活动组：活动标签文字为次级色", input: {props: {...base, tabs: typical, groupActive: false}}},
                {id: "single", label: "只有一个预览标签", input: {props: {...base, tabs: [tab("t1", "第一章.md", {preview: true, active: true})]}}},
            ];
        })(),
        runtimeProps: async () => ({closeLabel: (name: string) => `关闭 ${name}`, unpinLabel: (name: string) => `取消固定 ${name}`}),
        subject: () => import("nbook/plugins/editor/web/components/EditorTabBar.vue"),
    }),
];
