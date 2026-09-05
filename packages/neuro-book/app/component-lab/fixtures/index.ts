import type {Component} from "vue";

/**
 * 场景登记。这不是第二份组件清单——组件清单由 component-index 扫文档得到，
 * 这里只补文档里没有的东西：一个组件可以摆出哪几个场景。两者按组件名对上。
 */
export type LabScene = {
    id: string;
    label: string;
    /**
     * 这个场景的假数据初值。Lab 把它交给 fixture 的 `data`，并允许在右栏就地改。
     * 不写表示这个场景没有可改的数据，右栏的数据 tab 会说明这一点。
     * 必须是能 JSON 化的值——改数据用的是 JSON 编辑器。
     */
    data?: unknown;
};

export type LabFixture = {
    /** 与组件文档同名 */
    component: string;
    scenes: LabScene[];
    load: () => Promise<Component>;
};

/**
 * fixture 在被检视的那个零件上加 `data-lab-subject`，Lab 据此画常亮描边。
 *
 * 没有它 Lab 分不出哪块是零件、哪块是 fixture 自己搭的台子——多数 fixture 都带工具栏
 * 和说明文字。零件是单根节点时直接写在标签上即可，Vue 会把它落到根 DOM 节点。
 * 不标也能检查，只是无法把复合 fixture 的主要零件作为优先定位目标。
 */

export const labFixtures: LabFixture[] = [
    {
        component: "CollapsibleSidePanel",
        scenes: [
            {id: "default", label: "展开", data: {title: "示例侧栏", collapsedWidth: 40, rows: 6}},
            {id: "collapsed", label: "收起", data: {title: "示例侧栏", collapsedWidth: 40, rows: 6}},
            {id: "right", label: "靠右", data: {title: "检视", collapsedWidth: 40, rows: 6}},
            {id: "content", label: "内容层", data: {title: "检视", collapsedWidth: 40, rows: 6, layer: "content"}},
            {id: "long", label: "长内容", data: {title: "很长的一列条目", collapsedWidth: 40, rows: 40}},
        ],
        load: async () => (await import("./CollapsibleSidePanelFixture.vue")).default,
    },
    {
        component: "ViewportCanvas",
        scenes: [
            {id: "phone", label: "手机 390×844", data: {minSize: 200, showSize: true, cells: 6}},
            {id: "tablet", label: "平板 768×1024", data: {minSize: 200, showSize: true, cells: 6}},
            {id: "free", label: "不限尺寸", data: {minSize: 200, showSize: true, cells: 6}},
        ],
        load: async () => (await import("./ViewportCanvasFixture.vue")).default,
    },
    {
        component: "MarkdownView",
        scenes: [
            {id: "prose", label: "常规正文", data: {source: "## 小标题\n\n一段普通正文，里面有 **粗体**、*斜体* 和 `行内代码`。\n\n- 列表第一项\n- 列表第二项\n\n> 引用块\n\n[外部链接](https://example.com)"}},
            {id: "table", label: "表格与代码", data: {source: "| 列 A | 列 B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst answer: number = 42;\n```"}},
            {id: "html", label: "内嵌 HTML（会被净化）", data: {source: "下面这行的脚本会被净化掉，什么都不会发生：\n\n<script>alert(1)<\/script>\n\n<b>这个粗体标签是允许的</b>"}},
            {id: "empty", label: "空文本", data: {source: ""}},
        ],
        load: async () => (await import("./MarkdownViewFixture.vue")).default,
    },
    {
        component: "EventLogPanel",
        scenes: [
            {id: "mixed", label: "有负载与无负载混排", data: {emptyText: "还没有事件"}},
            {id: "empty", label: "空列表", data: {emptyText: "还没有事件"}},
        ],
        load: async () => (await import("./EventLogPanelFixture.vue")).default,
    },
    {
        component: "HighlightBox",
        scenes: [
            {id: "subject", label: "零件档（实线）", data: {label: "EventLogPanel  320 × 180", tone: "subject", width: 260, height: 120, show: true}},
            {id: "probe", label: "探针档（虚线）", data: {label: "div.flex.items-center  296 × 28", tone: "probe", width: 296, height: 28, show: true}},
            {id: "no-label", label: "只画框不带标签", data: {label: "", tone: "subject", width: 200, height: 200, show: true}},
            {id: "none", label: "没有要框的东西", data: {label: "看不见我", tone: "subject", width: 260, height: 120, show: false}},
        ],
        load: async () => (await import("./HighlightBoxFixture.vue")).default,
    },
    {
        component: "JsonViewer",
        scenes: [
            {
                id: "object",
                label: "对象",
                data: {
                    id: "chapter-01",
                    title: "第一章",
                    wordCount: 3182,
                    tags: ["草稿", "待审"],
                    meta: {createdAt: "2026-08-01T10:00:00Z", author: null, pinned: false},
                },
            },
            {
                id: "array",
                label: "数组",
                data: [
                    {tool: "read_file", ok: true, ms: 12},
                    {tool: "write_file", ok: false, ms: 340},
                    {tool: "list_dir", ok: true, ms: 3},
                ],
            },
            // 字符串走的是另一条路径：原样保留用户输入，不重排
            {id: "text", label: "未写完的字符串", data: '{\n  "unfinished": tru'},
            {id: "empty", label: "空对象", data: {}},
        ],
        load: async () => (await import("./JsonViewerFixture.vue")).default,
    },
    {
        component: "SurfaceTierDemo",
        scenes: [
            {id: "default", label: "5 档对照"},
        ],
        load: async () => (await import("./SurfaceTierDemoFixture.vue")).default,
    },
    {
        component: "AgentProfileNavList",
        scenes: [
            {id: "statuses", label: "状态全集", data: {activeKey: "p2", search: "", defaultsDirty: false}},
            {id: "defaults", label: "默认设置", data: {activeKey: "", search: "", defaultsDirty: true}},
            {id: "long-list", label: "长列表与长文本", data: {activeKey: "profile-0", search: "", defaultsDirty: false}},
            {id: "empty", label: "空列表", data: {activeKey: "", search: "", defaultsDirty: false}},
            {id: "no-match", label: "搜索无匹配", data: {activeKey: "p1", search: "不存在的搜索词xyz", defaultsDirty: false}},
        ],
        load: async () => (await import("./AgentProfileNavListFixture.vue")).default,
    },
];

export function findLabFixture(component: string): LabFixture | null {
    return labFixtures.find((fixture) => fixture.component === component) ?? null;
}
