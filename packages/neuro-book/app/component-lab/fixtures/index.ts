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
        component: "DesktopTitleBarChrome",
        scenes: [
            {
                id: "desktop",
                label: "桌面（完整）",
                data: {
                    title: "第十三章 退潮 — NeuroBook",
                    projects: [
                        {projectRoot: "novels/destiny-poem", title: "命定之诗"},
                        {projectRoot: "novels/rain-and-tea", title: "雨与茶"},
                    ],
                    currentProjectRoot: "novels/destiny-poem",
                    surfaceActive: true,
                    agentPanelAvailable: true,
                    agentPanelOpen: false,
                    rendererMenus: true,
                    customWindowControls: true,
                    connection: "local",
                },
            },
            {
                id: "bookshelf",
                label: "书架态（未打开 Project）",
                data: {
                    title: "NeuroBook",
                    projects: [
                        {projectRoot: "novels/destiny-poem", title: "命定之诗"},
                        {projectRoot: "novels/rain-and-tea", title: "雨与茶"},
                    ],
                    currentProjectRoot: null,
                    surfaceActive: false,
                    agentPanelAvailable: true,
                    agentPanelOpen: false,
                    rendererMenus: true,
                    customWindowControls: true,
                    connection: "local",
                },
            },
            {
                id: "native-menu",
                label: "菜单与窗口按钮归系统",
                data: {
                    title: "NeuroBook（远端）",
                    projects: [{projectRoot: "novels/destiny-poem", title: "命定之诗"}],
                    currentProjectRoot: "novels/destiny-poem",
                    surfaceActive: true,
                    agentPanelAvailable: true,
                    agentPanelOpen: true,
                    rendererMenus: false,
                    customWindowControls: false,
                    connection: "remote",
                },
            },
            {
                id: "compact",
                label: "窄栏（紧凑菜单）",
                data: {
                    title: "命定之诗 — NeuroBook",
                    projects: [{projectRoot: "novels/destiny-poem", title: "命定之诗"}],
                    currentProjectRoot: "novels/destiny-poem",
                    surfaceActive: true,
                    agentPanelAvailable: true,
                    agentPanelOpen: false,
                    rendererMenus: true,
                    customWindowControls: true,
                    connection: "local",
                },
            },
            {
                id: "no-agent",
                label: "没有 Agent 面板能力",
                data: {
                    title: "NeuroBook",
                    projects: [],
                    currentProjectRoot: null,
                    surfaceActive: false,
                    agentPanelAvailable: false,
                    agentPanelOpen: false,
                    rendererMenus: true,
                    customWindowControls: true,
                    connection: null,
                },
            },
            {
                id: "menu-open",
                label: "File 菜单展开",
                data: {
                    title: "命定之诗 — NeuroBook",
                    projects: [{projectRoot: "novels/destiny-poem", title: "命定之诗"}],
                    currentProjectRoot: "novels/destiny-poem",
                    surfaceActive: true,
                    agentPanelAvailable: true,
                    agentPanelOpen: false,
                    rendererMenus: true,
                    customWindowControls: true,
                    connection: "local",
                    openMenu: "File",
                },
            },
        ],
        load: async () => (await import("./DesktopTitleBarChromeFixture.vue")).default,
    },
    {
        component: "AgentProfileIdentitySection",
        scenes: [{id: "default", label: "身份与状态", data: {section: "identity"}}],
        load: async () => (await import("./AgentProfileSectionsFixture.vue")).default,
    },
    {
        component: "AgentProfileModelSection",
        scenes: [{id: "default", label: "模型设置", data: {section: "model"}}],
        load: async () => (await import("./AgentProfileSectionsFixture.vue")).default,
    },
    {
        component: "AgentProfileCustomSettingsSection",
        scenes: [{id: "default", label: "专属设置", data: {section: "custom-settings"}}],
        load: async () => (await import("./AgentProfileSectionsFixture.vue")).default,
    },
    {
        component: "AgentProfileRuntimeSection",
        scenes: [{id: "default", label: "运行策略", data: {section: "runtime"}}],
        load: async () => (await import("./AgentProfileSectionsFixture.vue")).default,
    },
    {
        component: "AgentProfileDefaultProfileSection",
        scenes: [{id: "default", label: "默认 Profile", data: {section: "default-profile"}}],
        load: async () => (await import("./AgentProfileSectionsFixture.vue")).default,
    },
    {
        component: "AgentProfileDefaultModelSection",
        scenes: [{id: "default", label: "默认模型", data: {section: "default-model"}}],
        load: async () => (await import("./AgentProfileSectionsFixture.vue")).default,
    },
    {
        component: "AgentProfileDefaultRuntimeSection",
        scenes: [{id: "default", label: "默认运行策略", data: {section: "default-runtime"}}],
        load: async () => (await import("./AgentProfileSectionsFixture.vue")).default,
    },
    {
        component: "AgentProfileNavList",
        scenes: [
            {id: "statuses", label: "状态全集", data: {activeKey: "line-editor", search: "", defaultsDirty: false}},
            {id: "defaults", label: "默认设置", data: {activeKey: "", search: "", defaultsDirty: true}},
            {id: "long-list", label: "长列表与长文本", data: {activeKey: "story-writer", search: "", defaultsDirty: false}},
            {id: "empty", label: "空列表", data: {activeKey: "", search: "", defaultsDirty: false}},
            {id: "no-match", label: "搜索无匹配", data: {activeKey: "story-writer", search: "不存在的搜索词xyz", defaultsDirty: false}},
        ],
        load: async () => (await import("./AgentProfileNavListFixture.vue")).default,
    },
    {
        component: "AgentProfileSettingsView",
        scenes: [
            {id: "global", label: "全局设定", data: {editable: "fixture-owned"}},
            {id: "project", label: "项目设定", data: {editable: "fixture-owned"}},
            {id: "dialog-window", label: "DialogWindow 内嵌", data: {editable: "fixture-owned"}},
            {id: "statuses", label: "状态全集", data: {editable: "fixture-owned"}},
            {id: "custom-settings", label: "专属设置", data: {editable: "fixture-owned"}},
            {id: "empty", label: "空列表", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./AgentProfileSettingsViewFixture.vue")).default,
    },
    {
        component: "NovelIdeSettingsView",
        scenes: [
            {id: "global", label: "全局设定", data: {editable: "fixture-owned"}},
            {id: "project", label: "项目设定", data: {editable: "fixture-owned"}},
            {id: "dialog-window", label: "DialogWindow 内嵌", data: {editable: "fixture-owned"}},
            {id: "loading", label: "加载中", data: {editable: "fixture-owned"}},
            {id: "load-error", label: "加载失败", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./NovelIdeSettingsViewFixture.vue")).default,
    },
    {
        component: "FrontendSettingsView",
        scenes: [
            {id: "default", label: "默认（两轴选择器）", data: {editable: "fixture-owned"}},
            {id: "disabled", label: "读取中停用", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./FrontendSettingsViewFixture.vue")).default,
    },
    {
        component: "WebSettingsView",
        scenes: [
            {id: "default", label: "默认", data: {editable: "fixture-owned"}},
            {id: "configured", label: "两家已配置", data: {editable: "fixture-owned"}},
            {id: "brave-first", label: "Brave 优先", data: {editable: "fixture-owned"}},
            {id: "local-fetch-off", label: "本地抓取关闭", data: {editable: "fixture-owned"}},
            {id: "disabled", label: "整段停用", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./WebSettingsViewFixture.vue")).default,
    },
    {
        component: "EmbeddingSettingsView",
        scenes: [
            {id: "global-disabled", label: "全局未启用", data: {editable: "fixture-owned"}},
            {id: "global-enabled", label: "全局已配置", data: {editable: "fixture-owned"}},
            {id: "global-api-key", label: "已配置密钥", data: {editable: "fixture-owned"}},
            {id: "project-inherit", label: "项目继承", data: {editable: "fixture-owned"}},
            {id: "project-override", label: "项目覆盖", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./EmbeddingSettingsViewFixture.vue")).default,
    },
    {
        component: "CostSettingsView",
        scenes: [
            {id: "default", label: "美元", data: {editable: "fixture-owned"}},
            {id: "cny", label: "人民币", data: {editable: "fixture-owned"}},
            {id: "stale", label: "缓存汇率", data: {editable: "fixture-owned"}},
            {id: "missing-rate", label: "无汇率", data: {editable: "fixture-owned"}},
            {id: "refreshing", label: "刷新中", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./CostSettingsViewFixture.vue")).default,
    },
    {
        component: "ObservabilitySettingsView",
        scenes: [
            {id: "default", label: "默认", data: {editable: "fixture-owned"}},
            {id: "disabled", label: "停用", data: {editable: "fixture-owned"}},
            {id: "boundary", label: "边界值 0", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ObservabilitySettingsViewFixture.vue")).default,
    },
    {
        component: "EditorSettingsView",
        scenes: [
            {id: "default", label: "默认", data: {editable: "fixture-owned"}},
            {id: "custom", label: "自定义偏好", data: {editable: "fixture-owned"}},
            {id: "indent-off", label: "段首缩进关闭", data: {editable: "fixture-owned"}},
            {id: "boundary", label: "边界值", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./EditorSettingsViewFixture.vue")).default,
    },
    {
        component: "DesktopSettingsView",
        scenes: [
            {id: "default", label: "本地服务", data: {editable: "fixture-owned"}},
            {id: "remote-zoom-max", label: "远端与最大缩放", data: {editable: "fixture-owned"}},
            {id: "error", label: "更新失败", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./DesktopSettingsViewFixture.vue")).default,
    },
    {
        component: "SecuritySettingsView",
        scenes: [
            {id: "enabled", label: "已开启", data: {editable: "fixture-owned"}},
            {id: "disabled", label: "已关闭", data: {editable: "fixture-owned"}},
            {id: "unknown", label: "状态读取中", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./SecuritySettingsViewFixture.vue")).default,
    },
    {
        component: "ProviderSettingsView",
        scenes: [
            {id: "default", label: "全局默认", data: {editable: "fixture-owned"}},
            {id: "project", label: "项目覆盖", data: {editable: "fixture-owned"}},
            {id: "no-provider", label: "无 Provider", data: {editable: "fixture-owned"}},
            {id: "disabled-models", label: "停用与问题", data: {editable: "fixture-owned"}},
            {id: "dialog-window", label: "DialogWindow 内嵌", data: {editable: "fixture-owned"}},
            {id: "saving", label: "保存中", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ProviderSettingsViewFixture.vue")).default,
    },
    {
        component: "RolesSettingsView",
        scenes: [
            {id: "unconfigured", label: "全部未配置", data: {editable: "fixture-owned"}},
            {id: "partially-configured", label: "部分配置", data: {editable: "fixture-owned"}},
            {id: "fully-configured", label: "全部绑定", data: {editable: "fixture-owned"}},
            {id: "saving", label: "保存中", data: {editable: "fixture-owned"}},
            {id: "save-error", label: "保存失败", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./RolesSettingsViewFixture.vue")).default,
    },
    {
        component: "NovelIdeModelEditDialog",
        scenes: [
            {id: "default", label: "编辑模型", data: {editable: "fixture-owned"}},
            {id: "missing-fields", label: "缺字段", data: {editable: "fixture-owned"}},
            {id: "confirm-mode", label: "候选择确认", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./NovelIdeModelEditDialogFixture.vue")).default,
    },
    {
        component: "ModelDiscoveryDialog",
        scenes: [
            {id: "default", label: "发现结果", data: {editable: "fixture-owned"}},
            {id: "partial", label: "部分成功", data: {editable: "fixture-owned"}},
            {id: "empty", label: "无结果", data: {editable: "fixture-owned"}},
            {id: "discovering", label: "发现中", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ModelDiscoveryDialogFixture.vue")).default,
    },
    {
        component: "ModelLibraryDialog",
        scenes: [
            {id: "default", label: "标准资料", data: {editable: "fixture-owned"}},
            {id: "empty", label: "无结果", data: {editable: "fixture-owned"}},
            {id: "searching", label: "搜索中", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ModelLibraryDialogFixture.vue")).default,
    },
    {
        component: "ProjectPickerView",
        scenes: [
            {id: "default", label: "标准书架", data: {editable: "fixture-owned"}},
            {id: "walnut-shelf", label: "典藏一：胡桃木书阁", data: {editable: "fixture-owned"}},
            {id: "velvet-lectern", label: "典藏二：丝绒孤本台", data: {editable: "fixture-owned"}},
            {id: "gilded-folio", label: "典藏三：烫金函套典籍", data: {editable: "fixture-owned"}},
            {id: "empty", label: "零项目空态", data: {editable: "fixture-owned"}},
            {id: "create-dialog", label: "新建对话框", data: {editable: "fixture-owned"}},
            {id: "creating", label: "创建中", data: {editable: "fixture-owned"}},
            {id: "loading", label: "加载中", data: {editable: "fixture-owned"}},
            {id: "load-error", label: "加载失败", data: {editable: "fixture-owned"}},
            {id: "phone", label: "手机 390×844", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ProjectPickerViewFixture.vue")).default,
    },
    {
        component: "ProjectPickerHeader",
        scenes: [
            {id: "default", label: "桌面默认", data: {editable: "fixture-owned"}},
            {id: "loading", label: "加载与创建禁用", data: {editable: "fixture-owned"}},
            {id: "phone", label: "手机 390×844", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ProjectPickerHeaderFixture.vue")).default,
    },
    {
        component: "ProjectPickerEmptyState",
        scenes: [
            {id: "default", label: "零项目空态", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ProjectPickerEmptyStateFixture.vue")).default,
    },
    {
        component: "ProjectCard",
        scenes: [
            {id: "fallback", label: "排版封面降级", data: {editable: "fixture-owned"}},
            {id: "with-cover", label: "图片封面", data: {editable: "fixture-owned"}},
            {id: "delete-busy", label: "删除忙碌中", data: {editable: "fixture-owned"}},
            {id: "delete-recovery", label: "删除错误待恢复", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ProjectCardFixture.vue")).default,
    },
    {
        component: "ProjectCreateCoverPreview",
        scenes: [
            {id: "default", label: "默认通用", data: {editable: "fixture-owned"}},
            {id: "long-title", label: "长书名截断", data: {editable: "fixture-owned"}},
            {id: "xuanhuan", label: "玄幻修真题材", data: {editable: "fixture-owned"}},
            {id: "scifi", label: "科幻未来题材", data: {editable: "fixture-owned"}},
            {id: "mystery", label: "悬疑惊悚题材", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ProjectCreateCoverPreviewFixture.vue")).default,
    },
    {
        component: "ProjectCreateForm",
        scenes: [
            {id: "default", label: "默认表单", data: {editable: "fixture-owned"}},
            {id: "filled", label: "已填写内容", data: {editable: "fixture-owned"}},
            {id: "creating", label: "创建中加载态", data: {editable: "fixture-owned"}},
            {id: "recovery-error", label: "恢复报错与重试", data: {editable: "fixture-owned"}},
            {id: "phone", label: "手机 390×844 折叠", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ProjectCreateFormFixture.vue")).default,
    },
    {
        component: "ProjectCreateDialog",
        scenes: [
            {id: "open", label: "打开弹窗", data: {editable: "fixture-owned"}},
            {id: "creating", label: "创建中", data: {editable: "fixture-owned"}},
            {id: "with-recovery", label: "恢复报错", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ProjectCreateDialogFixture.vue")).default,
    },
    {
        component: "ProjectCoverDialog",
        scenes: [
            {id: "default", label: "无封面状态", data: {editable: "fixture-owned"}},
            {id: "with-cover", label: "已有封面状态", data: {editable: "fixture-owned"}},
            {id: "busy", label: "处理中", data: {editable: "fixture-owned"}},
        ],
        load: async () => (await import("./ProjectCoverDialogFixture.vue")).default,
    },
    {
        component: "WorkbenchContainerSurface",
        scenes: [
            // 标题取产品译文的已解析值（`ide.workbench.container.tools` / `.agent`）：解析归宿主，fixture 扮演宿主。
            {
                id: "product",
                label: "产品落位（左 scroll / 右 fill）",
                data: {leftTitle: "工具", rightTitle: "Agent", leftLayout: "scroll", rightLayout: "fill", rows: 30},
            },
            {
                id: "sections",
                label: "文件夹式侧栏（Section 列表与可见性）",
                data: {leftTitle: "资源管理器", rightTitle: "Agent", leftLayout: "scroll", rightLayout: "fill", rows: 15},
            },
            {
                id: "scroll",
                label: "两栏都 scroll",
                data: {leftTitle: "工具", rightTitle: "Agent", leftLayout: "scroll", rightLayout: "scroll", rows: 30},
            },
            {
                id: "fill",
                label: "两栏都 fill",
                data: {leftTitle: "工具", rightTitle: "Agent", leftLayout: "fill", rightLayout: "fill", rows: 30},
            },
        ],
        load: async () => (await import("./WorkbenchContainerSurfaceFixture.vue")).default,
    },
    {
        component: "WorkbenchPanelSurface",
        scenes: [
            {
                id: "default",
                label: "默认面板（问题列表 44 项）",
                data: {activeTab: "problems", collapsed: false, layout: "fill"},
            },
            {
                id: "terminal",
                label: "终端视图（fill 布局）",
                data: {activeTab: "terminal", collapsed: false, layout: "fill"},
            },
            {
                id: "collapsed",
                label: "收起态",
                data: {activeTab: "problems", collapsed: true, layout: "fill"},
            },
            {
                id: "scroll",
                label: "滚动布局（scroll 呈现）",
                data: {activeTab: "problems", collapsed: false, layout: "scroll"},
            },
        ],
        load: async () => (await import("./WorkbenchPanelSurfaceFixture.vue")).default,
    },
    {
        component: "WorkbenchStatusBar",
        scenes: [
            {
                id: "standard",
                label: "标准状态栏（全量项与计数）",
                data: {branch: "refactor/w00003-nb-ui-adoption", errors: 0, warnings: 3, infos: 14, narrow: false},
            },
            {
                id: "errors",
                label: "多诊断告警态（5 错误 / 12 警告）",
                data: {branch: "refactor/w00003-nb-ui-adoption", errors: 5, warnings: 12, infos: 8, narrow: false},
            },
            {
                id: "clean",
                label: "无告警干净态",
                data: {branch: "main", errors: 0, warnings: 0, infos: 0, narrow: false},
            },
            {
                id: "narrow",
                label: "窄容器防溢出（360px）",
                data: {branch: "refactor/w00003-nb-ui-adoption", errors: 2, warnings: 4, infos: 6, narrow: true},
            },
        ],
        load: async () => (await import("./WorkbenchStatusBarFixture.vue")).default,
    },
];

export function findLabFixture(component: string): LabFixture | null {
    return labFixtures.find((fixture) => fixture.component === component) ?? null;
}
