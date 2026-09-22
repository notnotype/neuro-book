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
        component: "FixtureExample",
        scenes: [
            {
                id: "default",
                label: "默认受控卡片（居中与标准材质示范）",
                data: {
                    title: "章节大纲智能体编排",
                    description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                    status: "ready",
                    count: 12,
                    active: false,
                    disabled: false,
                },
            },
            {
                id: "active",
                label: "激活态与高亮外框",
                data: {
                    title: "章节大纲智能体编排",
                    description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                    status: "ready",
                    count: 12,
                    active: true,
                    disabled: false,
                },
            },
            {
                id: "busy",
                label: "忙碌呼吸状态",
                data: {
                    title: "正在生成第三卷剧情推演",
                    description: "后台正在计算角色动机转移概率矩阵与未回收伏笔拓扑图...",
                    status: "busy",
                    count: 99,
                    active: true,
                    disabled: false,
                },
            },
            {
                id: "warning",
                label: "警告冲突状态",
                data: {
                    title: "检测到人物性格设定冲突",
                    description: "角色「沈屿」在第二章的对话用词与素材库口吻约定存在 2 处偏差。",
                    status: "warning",
                    count: 2,
                    active: false,
                    disabled: false,
                },
            },
        ],
        load: async () => (await import("./FixtureExampleFixture.vue")).default,
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
            {
                id: "browser",
                label: "浏览器（无桌面能力）",
                data: {
                    title: "命定之诗 — NeuroBook",
                    projects: [{projectRoot: "novels/destiny-poem", title: "命定之诗"}],
                    currentProjectRoot: "novels/destiny-poem",
                    surfaceActive: true,
                    desktop: false,
                    editTarget: "native",
                    agentPanelAvailable: true,
                    agentPanelOpen: false,
                    rendererMenus: true,
                    customWindowControls: false,
                    connection: null,
                    openMenu: "View",
                },
            },
            {
                id: "edit-focus",
                label: "编辑动作（焦点不在可编辑处）",
                data: {
                    title: "命定之诗 — NeuroBook",
                    projects: [{projectRoot: "novels/destiny-poem", title: "命定之诗"}],
                    currentProjectRoot: "novels/destiny-poem",
                    surfaceActive: true,
                    desktop: true,
                    editTarget: "none",
                    agentPanelAvailable: true,
                    agentPanelOpen: false,
                    rendererMenus: true,
                    customWindowControls: true,
                    connection: "local",
                    openMenu: "Edit",
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
        component: "SettingsLoadState",
        scenes: [
            // data 只带文本入参：形态由场景 id 决定，数据面板改不出「叫 loading 却画 error」的场景
            {id: "loading", label: "加载中（默认文案）", data: {message: "", actionLabel: ""}},
            {id: "loading-message", label: "加载中（自定义说明）", data: {message: "正在读取本机设定…", actionLabel: ""}},
            {id: "error", label: "读取失败（默认重试文案）", data: {message: "读取全局配置失败：文件被占用", actionLabel: ""}},
            {id: "error-custom-action", label: "读取失败（自定义重试文案）", data: {message: "读取全局配置失败：文件被占用", actionLabel: "重新加载设置"}},
        ],
        load: async () => (await import("./SettingsLoadStateFixture.vue")).default,
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
            {id: "default", label: "经典网格", data: {editable: "fixture-owned"}},
            {id: "compact", label: "密集列表", data: {editable: "fixture-owned"}},
            {id: "editorial", label: "宽幅图文", data: {editable: "fixture-owned"}},
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
            // 标题是 Lab 的**教学名称**：主 / 辅助侧边栏是同一个容器部件的两个明确落位，不暗示产品布局变化。
            {
                id: "product",
                label: "产品落位（左 scroll / 右 fill）",
                data: {leftTitle: "主侧边栏 / Primary Side Bar", rightTitle: "辅助侧边栏 / Secondary Side Bar", leftLayout: "scroll", rightLayout: "fill", rows: 30},
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
            {
                id: "primary-sidebar",
                label: "单栏：主侧边栏（scroll）",
                data: {title: "主侧边栏 / Primary Side Bar", layout: "scroll", rows: 18},
            },
            {
                id: "secondary-sidebar",
                label: "单栏：辅助侧边栏（fill）",
                data: {title: "辅助侧边栏 / Secondary Side Bar", layout: "fill", rows: 12},
            },
        ],
        load: async () => (await import("./WorkbenchContainerSurfaceFixture.vue")).default,
    },
    {
        component: "WorkbenchContainerSection",
        scenes: [
            {id: "scroll", label: "展开（scroll 档 40 行长列表）", data: {title: "工具", contextLabel: "40 条", rows: 40, collapsed: false}},
            {id: "collapsed", label: "受控折叠初值（collapsed: true）", data: {title: "大纲", contextLabel: "7 章节", rows: 7, collapsed: true}},
            {id: "fill", label: "fill 档（内容自己滚）", data: {title: "对话记录", rows: 40, collapsed: false}},
            {id: "empty-text", label: "空态说明文字", data: {title: "关联引用", contextLabel: "0 项", rows: 0, collapsed: false, emptyText: "暂无关联引用，在正文中 @ 引用即可添加"}},
            {id: "no-collapse", label: "不可折叠（头部无展开语义）", data: {title: "工作区信息", contextLabel: "只读", rows: 4, collapsed: false}},
        ],
        load: async () => (await import("./WorkbenchContainerSectionFixture.vue")).default,
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
            {
                id: "empty-actions",
                label: "空面板：没有标签，只剩框架动作区",
                data: {collapsed: false, layout: "fill"},
            },
            {
                id: "view-actions",
                label: "标题区：View 动作 + 框架动作（真实动作部件）",
                data: {activeTab: "problems", collapsed: false, layout: "fill"},
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
    {
        component: "WorkbenchActivityBar",
        scenes: [
            {id: "default", label: "默认（三组几何 620px）", data: {height: 620}},
            {id: "overflow", label: "溢出（次要入口进 More）", data: {height: 320}},
            {id: "disabled", label: "禁用（入口在但给原因）", data: {height: 620}},
            {id: "short", label: "矮容器 220px（滚动兜底）", data: {height: 220}},
        ],
        load: async () => (await import("./WorkbenchActivityBarFixture.vue")).default,
    },
    {
        component: "NovelIdeActivityBar",
        scenes: [
            {id: "default", label: "桌面（Project 已打开）", data: {height: 620}},
            {id: "disabled", label: "书架态（未打开 Project）", data: {height: 620}},
            {id: "account", label: "账户菜单（假 AuthUserDto）", data: {height: 620}},
        ],
        load: async () => (await import("./NovelIdeActivityBarFixture.vue")).default,
    },
    {
        component: "EditorWorkbench",
        scenes: [
            {
                id: "empty",
                label: "空工作区 / 欢迎页",
                data: {
                    activePath: "",
                    tabs: [],
                    busy: false,
                    diagnosis: null,
                },
            },
            {
                id: "mixed",
                label: "固定、普通、预览与脏标记标签",
                data: {
                    activePath: "src/story/chapter-02.md",
                    busy: false,
                    diagnosis: null,
                    tabs: [
                        {path: "docs/architecture.md", title: "architecture.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
                        {path: ".env", title: ".env", pinned: false, preview: false, dirty: false, description: "...\\tim-completion-spike", iconClass: "i-lucide-key-round"},
                        {path: "AGENTS.md", title: "AGENTS.md", pinned: false, preview: false, dirty: false, statusText: "M", iconClass: "i-lucide-file-text"},
                        {path: "docs/002-product-decision-brief.md", title: "002-product-decision-brief.md", pinned: false, preview: false, dirty: false, statusText: "U", iconClass: "i-lucide-file-text"},
                        {path: "src/story/chapter-01.md", title: "chapter-01.md", pinned: false, preview: false, dirty: false, statusText: "U", iconClass: "i-lucide-file-text"},
                        {path: "src/story/chapter-02.md", title: "chapter-02.md", pinned: false, preview: false, dirty: true, statusText: "M", iconClass: "i-lucide-file-text"},
                        {path: "package.json", title: "package.json", pinned: false, preview: false, dirty: false, statusText: "M", iconClass: "i-lucide-braces"},
                        {path: ".agents/skills/doc-review/SKILL.md", title: "SKILL.md", pinned: false, preview: false, dirty: false, description: "...\\doc-review", iconClass: "i-lucide-file-text"},
                        {path: "src/notes/quick-draft.txt", title: "quick-draft.txt", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file"},
                    ],
                },
            },
            {
                id: "long-titles",
                label: "超长路径与横向截断滚动",
                data: {
                    activePath: "packages/neuro-book/app/components/novel-ide/settings/sections/providers/components/ProviderSettingsViewFixtureLongPathComponentName.vue",
                    busy: false,
                    diagnosis: null,
                    tabs: [
                        {
                            path: "packages/neuro-book/app/components/novel-ide/settings/sections/providers/components/ProviderSettingsViewFixtureLongPathComponentName.vue",
                            title: "ProviderSettingsViewFixtureLongPathComponentName.vue",
                            pinned: false,
                            preview: false,
                            dirty: true,
                            iconClass: "i-lucide-file-code-2",
                        },
                        {
                            path: "docs/specifications/drafts/2026-09-16-editor-workbench-architecture-and-view-host-contract-specification.md",
                            title: "2026-09-16-editor-workbench-architecture-and-view-host-contract-specification.md",
                            pinned: false,
                            preview: false,
                            dirty: false,
                            iconClass: "i-lucide-file-text",
                        },
                        {
                            path: "assets/workspace/deeply/nested/directory/structure/with-multiple-submodules/long-configuration-matrix-sample.json",
                            title: "long-configuration-matrix-sample.json",
                            pinned: false,
                            preview: true,
                            dirty: false,
                            iconClass: "i-lucide-file-code-2",
                        },
                    ],
                },
            },
            {
                id: "loading",
                label: "加载中 / 忙碌遮罩态",
                data: {
                    activePath: "src/heavy-dataset.json",
                    busy: true,
                    diagnosis: null,
                    tabs: [
                        {path: "src/heavy-dataset.json", title: "heavy-dataset.json", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
                    ],
                },
            },
            {
                id: "diagnosis",
                label: "诊断警告 / 未知打开方式",
                data: {
                    activePath: "assets/diagram.drawio",
                    busy: false,
                    diagnosis: "打开方式“diagram-viewer”不可用，当前使用源码编辑器。",
                    tabs: [
                        {path: "assets/diagram.drawio", title: "diagram.drawio", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-question"},
                    ],
                },
            },
            {
                id: "closing-cancel",
                label: "未保存关闭保护与取消决策",
                data: {
                    activePath: "src/draft-chapter.md",
                    busy: false,
                    diagnosis: null,
                    tabs: [
                        {path: "src/draft-chapter.md", title: "draft-chapter.md", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-text"},
                        {path: "src/saved-notes.md", title: "saved-notes.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
                    ],
                },
            },
            {
                id: "keyboard-menu",
                label: "菜单栏集合与键盘无障碍漫游",
                data: {
                    activePath: "src/main.ts",
                    busy: false,
                    diagnosis: null,
                    tabs: [
                        {path: "src/main.ts", title: "main.ts", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"},
                    ],
                },
            },
            {
                id: "multi-view",
                label: "真实 Registry / 第三视图同一正文切换",
                data: {
                    activePath: "chapter-01.md",
                    editorId: "code",
                    busy: false,
                    diagnosis: null,
                    tabs: [
                        {path: "chapter-01.md", title: "chapter-01.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
                    ],
                },
            },
        ],
        load: async () => (await import("./EditorWorkbenchFixture.vue")).default,
    },
    {
        component: "CodeEditorView",
        scenes: [
            {
                id: "markdown",
                label: "Markdown 正文源码",
                data: {
                    path: "manuscript/chapter-01.md",
                    languageId: "markdown",
                    readonly: false,
                    content: "# 开场\n\n潮水退下去的时候，礁石上留下了一层薄薄的盐。\n\n她把鞋提在手里，沿着滩涂往东走。\n\n> 那些没有说出口的话，最后都变成了潮声。\n\n- 第一件事：把灯点上\n- 第二件事：等他回来\n",
                },
            },
            {
                id: "json-invalid",
                label: "非法 JSON 原样保留",
                data: {
                    path: "project/chapters.json",
                    languageId: "json",
                    readonly: false,
                    content: "{\n    \"chapters\": [\n        {\"id\": 1, \"title\": \"开场\"},\n        {\"id\": 2, \"title\": \"退潮\", \"draft\": tru\n",
                },
            },
            {
                id: "html-source",
                label: "HTML 只有源码",
                data: {
                    path: "export/page.html",
                    languageId: "html",
                    readonly: false,
                    content: "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"utf-8\">\n    <title>退潮</title>\n</head>\n<body>\n    <p>这段 HTML 只有源码，没有预览。</p>\n</body>\n</html>\n",
                },
            },
            {
                id: "readonly",
                label: "只读文档",
                data: {
                    path: "assets/导出的旧稿.txt",
                    languageId: "plaintext",
                    readonly: true,
                    content: "这是一份只读文档：内核不允许输入，夹具也不伪造「保存成功」。\n",
                },
            },
            {
                id: "empty",
                label: "空文档",
                data: {path: "manuscript/未命名.md", languageId: "markdown", readonly: false, content: ""},
            },
            {
                id: "command-navigation",
                label: "命令与行号导航",
                data: {
                    path: "lab/command-navigation.txt",
                    languageId: "plaintext",
                    readonly: false,
                    content: Array.from({length: 60}, (_, index) => `第 ${index + 1} 行：命令导航验收`).join("\n"),
                },
            },
            {
                id: "commands-unavailable",
                label: "无活动编辑器",
                data: {path: "lab/commands-unavailable.txt", languageId: "plaintext", readonly: false, content: ""},
            },
        ],
        load: async () => (await import("./CodeEditorViewFixture.vue")).default,
    },
    {
        component: "MonacoCodeEditor",
        scenes: [
            {
                id: "markdown",
                label: "Markdown 源码",
                data: {initialValue: "# 退潮\n\n礁石上留下了一层薄薄的盐。\n\n- 把灯点上\n- 等他回来\n", language: "markdown", readonly: false},
            },
            {
                id: "typescript",
                label: "TypeScript 源码",
                data: {initialValue: "type Draft = {\n    id: string;\n    title: string;\n    words: number;\n};\n\nfunction isLong(draft: Draft): boolean {\n    return draft.words > 3000;\n}\n", language: "typescript", readonly: false},
            },
            {
                id: "readonly",
                label: "只读",
                data: {initialValue: "这份文档只读：可以选中、复制、滚动，但输入不会进入正文。\n", language: "plaintext", readonly: true},
            },
            {
                id: "placeholder",
                label: "空值占位文案",
                data: {initialValue: "", language: "markdown", placeholder: "在此输入正文，Ctrl+S 发出保存请求…"},
            },
            {
                id: "preferences",
                label: "显示偏好（不换行 / 无行号 / 显示空白 / 临时字号 22）",
                data: {
                    initialValue: "const unwrapped = \"这一段不自动换行，并且显示空白字符与行号开关的效果\";\n\n\t缩进用制表符，字号被临时调大。\n",
                    language: "javascript",
                    temporaryFontSize: 22,
                    preferences: {wordWrap: false, lineNumbers: false, renderWhitespace: true, tabSize: 8, fontSize: 18},
                },
            },
        ],
        load: async () => (await import("./MonacoCodeEditorFixture.vue")).default,
    },
    {
        component: "MarkdownEditorView",
        scenes: [
            {
                id: "prose",
                label: "普通正文",
                data: {
                    path: "manuscript/chapter-01.md",
                    readonly: false,
                    showFrontmatterPanel: false,
                    content: "# 开场\n\n潮水退下去的时候，礁石上留下了一层薄薄的盐。\n\n她把鞋提在手里，沿着滩涂往东走，**没有回头**。\n\n> 那些没有说出口的话，最后都变成了潮声。\n\n- 把灯点上\n- 等他回来\n\n行内代码写作 `manuscript/chapter-01.md`。\n",
                },
            },
            {
                id: "comments",
                label: "含批注的正文（批注面板经视图动作打开）",
                data: {
                    path: "manuscript/chapter-02.md",
                    readonly: false,
                    showFrontmatterPanel: false,
                    content: "# 退潮\n\n<comment body=\"这里要补一段潮汐的细节\">她把鞋提在手里，沿着滩涂往东走。</comment>\n\n<comment body=\"第二处批注：删掉重复的比喻\">礁石上留下了一层薄薄的盐。</comment>\n\n（打开右上角的批注动作可以看到这两条；修改批注会写回这份正文。）\n",
                },
            },
            {
                id: "frontmatter",
                label: "frontmatter 与正文分离",
                data: {
                    path: "manuscript/退潮/index.md",
                    readonly: false,
                    showFrontmatterPanel: true,
                    content: "---\ntitle: 退潮\nstatus: 草稿\nwords: 1284\n---\n\n# 退潮\n\n正文在第一段之后开始，frontmatter 不属于正文。\n",
                },
            },
            {
                id: "readonly",
                label: "只读文档",
                data: {
                    path: "manuscript/定稿/开场.md",
                    readonly: true,
                    showFrontmatterPanel: false,
                    content: "# 开场（定稿）\n\n这份文档只读：可以选中、复制、滚动与查看批注，但输入不会写回正文。\n",
                },
            },
            {
                id: "empty",
                label: "空文档",
                data: {path: "manuscript/未命名.md", readonly: false, showFrontmatterPanel: false, content: ""},
            },
        ],
        load: async () => (await import("./MarkdownEditorViewFixture.vue")).default,
    },
    {
        component: "EditorViewHost",
        scenes: [
            {
                id: "switch",
                label: "两个替身视图对同一份正文切换",
                data: {editorId: "code", path: "manuscript/chapter-01.md", content: "# 退潮\n\n礁石上留下了一层薄薄的盐。\n"},
            },
            {
                id: "pending",
                label: "目标视图慢就绪（旧视图仍可见）",
                data: {editorId: "code", path: "manuscript/chapter-01.md", content: "# 退潮\n\n礁石上留下了一层薄薄的盐。\n"},
            },
            {
                id: "view-error",
                label: "视图抛错被宿主收敛",
                data: {editorId: "crash", path: "manuscript/chapter-01.md", content: "# 退潮\n\n礁石上留下了一层薄薄的盐。\n"},
            },
            {
                id: "single",
                label: "单视图最小结构",
                data: {editorId: "code", path: "manuscript/chapter-01.md", content: "# 退潮\n\n礁石上留下了一层薄薄的盐。\n"},
            },
        ],
        load: async () => (await import("./EditorViewHostFixture.vue")).default,
    },
    {
        component: "EditorTabBar",
        scenes: [
            // 标签清单很长，登记初值只放在夹具里：两处各写一份 12 个长路径必然漂移。
            {id: "mixed", label: "固定 / 普通 / 预览 / 脏标记混排"},
            {id: "overflow", label: "12 个长标题：默认折行，切单行验证横向滚动"},
            {id: "pinned-only", label: "只有固定标签（固定行独立成行）"},
            {id: "single-preview", label: "预览标签与脏标记"},
        ],
        load: async () => (await import("./EditorTabBarFixture.vue")).default,
    },
    {
        component: "EditorToolbar",
        scenes: [
            {id: "default", label: "快捷键、分隔符、停用与危险项"},
            {
                id: "checked",
                label: "可勾选项与停用菜单",
                data: {
                    checked: {
                        "view.sidebar": true,
                        "view.outline": false,
                        "view.line-numbers": true,
                        "view.theme-light": false,
                        "view.theme-sepia": true,
                        "view.theme-dark": false,
                        "view.minimap": true,
                    },
                },
            },
            {
                id: "submenu",
                label: "子菜单递归勾选",
                data: {
                    checked: {
                        "export.epub": true,
                        "export.pdf": false,
                        "export.md": false,
                        "layout.wrap": true,
                        "layout.line-numbers": true,
                        "layout.font-mono": false,
                        "layout.font-serif": true,
                    },
                },
            },
            {id: "empty", label: "空菜单数组"},
        ],
        load: async () => (await import("./EditorToolbarFixture.vue")).default,
    },
    {
        component: "EditorWelcome",
        scenes: [
            // 节点快照字段很多，登记初值同样只放夹具一处。
            {id: "novel-empty", label: "小说工作区无标签（快捷动作）"},
            {id: "novel-recent", label: "有最近标签（主按钮变继续）"},
            {id: "user-assets", label: "素材库工作区"},
            {id: "compact", label: "紧凑档（只显示前 3 个标签）"},
            {id: "readonly-node", label: "节点不可编辑"},
        ],
        load: async () => (await import("./EditorWelcomeFixture.vue")).default,
    },
    {
        component: "AgentChatFlow",
        scenes: [
            {id: "empty-main", label: "主界面默认空状态"},
            {id: "empty-unselected", label: "未选择会话提示"},
            {id: "empty-compact", label: "紧凑侧栏等待态"},
            {id: "conversation", label: "多轮交替对话"},
            {id: "with-tools", label: "含工具调用会话"},
            {id: "history-loading", label: "顶部历史拉取态"},
            {id: "streaming-simulation", label: "流式吸底交互验证"},
        ],
        load: async () => (await import("./AgentChatFlowFixture.vue")).default,
    },
    {
        component: "AgentChatEmptyState",
        scenes: [
            {id: "main", label: "主模式欢迎引导"},
            {id: "unselected", label: "未选择对话提示"},
            {id: "compact", label: "紧凑模式等待"},
        ],
        load: async () => (await import("./AgentChatEmptyStateFixture.vue")).default,
    },
    {
        component: "AgentChatHistoryLoader",
        scenes: [
            {id: "idle", label: "空闲/可加载状态"},
            {id: "loading", label: "加载中状态"},
            {id: "error", label: "加载失败可重试状态"},
        ],
        load: async () => (await import("./AgentChatHistoryLoaderFixture.vue")).default,
    },
    {
        component: "AgentUserBubble",
        scenes: [
            {id: "default", label: "常规用户提问"},
            {id: "steer", label: "Steer 引导指令"},
            {id: "with-attachments", label: "带多模态参考图"},
            {id: "editing", label: "就地编辑态"},
            {id: "unknown-delivery", label: "未知投递状态"},
        ],
        load: async () => (await import("./AgentUserBubbleFixture.vue")).default,
    },
    {
        component: "AgentAssistantBubble",
        scenes: [
            {id: "default", label: "常规完成回答"},
            {id: "streaming", label: "流式输出进行中"},
            {id: "with-cost", label: "带 Token 与费用统计"},
            {id: "interrupted", label: "用户主动取消态"},
        ],
        load: async () => (await import("./AgentAssistantBubbleFixture.vue")).default,
    },
    {
        component: "AgentThinkingCollapsible",
        scenes: [
            {id: "default", label: "长思维链折叠"},
            {id: "expanded", label: "展开完整思维链"},
            {id: "short", label: "短思维链"},
            {id: "streaming", label: "流式生成中思维链"},
        ],
        load: async () => (await import("./AgentThinkingCollapsibleFixture.vue")).default,
    },
    {
        component: "AgentMessageActionBar",
        scenes: [
            {id: "all", label: "全部动作可用"},
            {id: "user", label: "用户消息动作"},
            {id: "assistant", label: "助手消息动作"},
            {id: "with-branch", label: "含分支指示器"},
            {id: "unknown", label: "未知投递操作"},
            {id: "disabled", label: "禁用状态"},
        ],
        load: async () => (await import("./AgentMessageActionBarFixture.vue")).default,
    },
    {
        component: "AgentSystemBubble",
        scenes: [
            {id: "prompt", label: "System Prompt 默认态"},
            {id: "reminder", label: "轻量系统提醒"},
            {id: "error", label: "运行时错误警示"},
        ],
        load: async () => (await import("./AgentSystemBubbleFixture.vue")).default,
    },
    {
        component: "AgentTextBubble",
        scenes: [
            {id: "user", label: "分发用户消息"},
            {id: "ai", label: "分发 AI 回复"},
            {id: "system", label: "分发系统消息"},
        ],
        load: async () => (await import("./AgentTextBubbleFixture.vue")).default,
    },
    {
        component: "AgentToolBubble",
        scenes: [
            {id: "default", label: "工具外壳分发展示"},
        ],
        load: async () => (await import("./AgentToolBubbleFixture.vue")).default,
    },
    {
        component: "AgentToolNode",
        scenes: [
            {id: "success", label: "成功完成折叠态"},
            {id: "expanded", label: "展开入参与结果"},
            {id: "running", label: "正在执行中"},
            {id: "error", label: "执行报错失败态"},
        ],
        load: async () => (await import("./AgentToolNodeFixture.vue")).default,
    },
    {
        component: "AgentEditFileBubble",
        scenes: [
            {id: "success", label: "文件修改已应用"},
            {id: "running", label: "流式修改进行中"},
        ],
        load: async () => (await import("./AgentEditFileBubbleFixture.vue")).default,
    },
    {
        component: "AgentWriteFileBubble",
        scenes: [
            {id: "success", label: "新建写入成功"},
            {id: "running", label: "正在写入文件"},
        ],
        load: async () => (await import("./AgentWriteFileBubbleFixture.vue")).default,
    },
    {
        component: "AgentApplyPatchBubble",
        scenes: [
            {id: "success", label: "补丁成功打入"},
            {id: "error", label: "补丁冲突报错"},
        ],
        load: async () => (await import("./AgentApplyPatchBubbleFixture.vue")).default,
    },
    {
        component: "AgentSwitchModeBubble",
        scenes: [
            {id: "reviewer", label: "切换审校模式"},
            {id: "writer", label: "切换创作模式"},
        ],
        load: async () => (await import("./AgentSwitchModeBubbleFixture.vue")).default,
    },
    {
        component: "AgentTaskBubble",
        scenes: [
            {id: "success", label: "任务清单执行完毕"},
            {id: "running", label: "任务正在推进中"},
        ],
        load: async () => (await import("./AgentTaskBubbleFixture.vue")).default,
    },
    {
        component: "AgentRequestUserInputBubble",
        scenes: [
            {id: "default", label: "请求用户输入决策"},
        ],
        load: async () => (await import("./AgentRequestUserInputBubbleFixture.vue")).default,
    },
    {
        component: "AgentQueuedMessageList",
        scenes: [
            {id: "mixed", label: "混合排队与转向"},
            {id: "steer-only", label: "仅有转向消息"},
            {id: "queue-only", label: "普通顺序排队"},
        ],
        load: async () => (await import("./AgentQueuedMessageListFixture.vue")).default,
    },
    {
        component: "AgentComposer",
        scenes: [
            {id: "ready", label: "正常就绪空闲"},
            {id: "with-text", label: "输入长提示词"},
            {id: "with-images", label: "包含图片附件"},
            {id: "queued", label: "带排队消息列表"},
            {id: "user-input-prompt", label: "用户决策交互提问"},
            {id: "running", label: "任务执行推进中"},
            {id: "readonly-unselected", label: "未选择会话锁定"},
            {id: "readonly-archived", label: "已归档会话只读"},
            {id: "discuss-mode", label: "讨论模式"},
            {id: "plan-mode", label: "规划模式"},
        ],
        load: async () => (await import("./AgentComposerFixture.vue")).default,
    },
    {
        component: "AgentComposerAvailabilityBanner",
        scenes: [
            {id: "unselected", label: "未选择对话"},
            {id: "empty", label: "空会话列表"},
            {id: "archived", label: "已归档会话"},
            {id: "load-error", label: "网络加载失败"},
            {id: "waiting-blocked", label: "等待输入被阻塞"},
        ],
        load: async () => (await import("./AgentComposerAvailabilityBannerFixture.vue")).default,
    },
    {
        component: "AgentComposerImageBar",
        scenes: [
            {id: "default", label: "多图正常预览"},
            {id: "unsupported-model", label: "模型不支持图片警告"},
            {id: "metadata-error", label: "元数据校验失败"},
            {id: "readonly", label: "只读状态"},
        ],
        load: async () => (await import("./AgentComposerImageBarFixture.vue")).default,
    },
    {
        component: "AgentComposerToolbar",
        scenes: [
            {id: "ready", label: "就绪普通模式"},
            {id: "running", label: "执行中带停止按钮"},
            {id: "discuss-mode", label: "讨论模式"},
            {id: "plan-mode", label: "规划模式"},
            {id: "disabled", label: "禁用/只读态"},
        ],
        load: async () => (await import("./AgentComposerToolbarFixture.vue")).default,
    },
    {
        component: "AgentSessionStatusBar",
        scenes: [
            {id: "idle", label: "常规空闲态"},
            {id: "running", label: "任务推进中"},
            {id: "connection-issue", label: "网络断开待重连"},
            {id: "discuss-mode", label: "讨论模式徽标"},
        ],
        load: async () => (await import("./AgentSessionStatusBarFixture.vue")).default,
    },
    {
        component: "AgentComposerInput",
        scenes: [
            {id: "empty", label: "空白占位"},
            {id: "with-text", label: "输入提示词"},
            {id: "expanded", label: "多行展开"},
            {id: "readonly", label: "只读锁定"},
        ],
        load: async () => (await import("./AgentComposerInputFixture.vue")).default,
    },
    {
        component: "AgentSessionModelControls",
        scenes: [
            {id: "closed", label: "参数面板折叠"},
            {id: "open", label: "展开参数调节面板"},
            {id: "readonly", label: "只读锁定"},
            {id: "saving", label: "保存中状态"},
        ],
        load: async () => (await import("./AgentSessionModelControlsFixture.vue")).default,
    },
    {
        component: "AgentUserInputPrompt",
        scenes: [
            {id: "single-choice", label: "单选决策"},
            {id: "open-ended", label: "开放式简答"},
            {id: "multi-question", label: "多步问答导航"},
            {id: "submitting", label: "提交处理中"},
        ],
        load: async () => (await import("./AgentUserInputPromptFixture.vue")).default,
    },
    {
        component: "AgentSessionHeader",
        scenes: [
            {id: "default", label: "活跃会话标题栏"},
            {id: "with-dropdown", label: "新建会话配置下拉"},
            {id: "with-badges", label: "状态徽标与总结器"},
        ],
        load: async () => (await import("./AgentSessionHeaderFixture.vue")).default,
    },
    {
        component: "AgentSystemPromptPanel",
        scenes: [
            {id: "expanded", label: "展开状态（Markdown 渲染）"},
            {id: "loading", label: "加载中"},
            {id: "error", label: "加载失败"},
            {id: "empty", label: "Prompt 为空"},
        ],
        load: async () => (await import("./AgentSystemPromptPanelFixture.vue")).default,
    },
    {
        component: "AgentLinkedAgentPanel",
        scenes: [
            {id: "populated", label: "有关联 Agent"},
            {id: "empty", label: "无关联 Agent"},
            {id: "loading", label: "加载中"},
        ],
        load: async () => (await import("./AgentLinkedAgentPanelFixture.vue")).default,
    },
    {
        component: "AgentSidebarView",
        scenes: [
            {id: "empty", label: "创作入口（最近会话+推荐词）"},
            {id: "conversation", label: "常规对话与工具"},
            {id: "streaming", label: "实时生成流式态"},
            {id: "history", label: "历史追溯与长对话"},
            {id: "delivery-unknown", label: "未知投递重发忽略"},
            {id: "images", label: "图文多模态创作"},
            {id: "pending-input", label: "人机决策待决审批"},
            {id: "workflow", label: "多Agent工作流"},
            {id: "workspace-changes", label: "工作区历史变更"},
            {id: "sessions", label: "多会话列表与管理"},
            {id: "context-inspector", label: "Prompt上下文检查"},
            {id: "unavailable", label: "不可用异常状态"},
        ],
        load: async () => (await import("./AgentSidebarViewFixture.vue")).default,
    },
    {
        component: "EditorTabItem",
        scenes: [
            {id: "default", label: "常规标签"},
            {id: "active", label: "激活状态"},
            {id: "pinned", label: "固定标签"},
            {id: "preview", label: "预览斜体"},
            {id: "dirty", label: "未保存脏标记"},
            {id: "git-modified", label: "Git 已修改 (M)"},
            {id: "git-untracked", label: "Git 新建 (U)"},
            {id: "with-description", label: "路径消歧义"},
        ],
        load: async () => (await import("./EditorTabItemFixture.vue")).default,
    },
    {
        component: "EditorBreadcrumbs",
        scenes: [
            {id: "default", label: "常规路径与符号"},
            {id: "long", label: "深层超长路径"},
        ],
        load: async () => (await import("./EditorBreadcrumbsFixture.vue")).default,
    },
    {
        component: "WorkbenchCommandPalette",
        scenes: [
            {
                id: "command-navigation",
                label: "命令与行号导航",
                data: {
                    path: "lab/command-navigation.txt",
                    languageId: "plaintext",
                    readonly: false,
                    content: Array.from({length: 60}, (_, index) => `第 ${index + 1} 行：命令导航验收`).join("\n"),
                },
            },
            {
                id: "readonly",
                label: "只读文档",
                data: {
                    path: "assets/导出的旧稿.txt",
                    languageId: "plaintext",
                    readonly: true,
                    content: "这是一份只读文档：内核不允许输入，夹具也不伪造「保存成功」。\n",
                },
            },
            {
                id: "commands-unavailable",
                label: "无活动编辑器",
                data: {path: "lab/commands-unavailable.txt", languageId: "plaintext", readonly: false, content: ""},
            },
        ],
        load: async () => (await import("./WorkbenchCommandPaletteFixture.vue")).default,
    },
    {
        component: "WorkbenchTitleActions",
        scenes: [
            {id: "default", label: "默认（主操作 + 更多）"},
            {id: "overflow", label: "窄条折叠进更多"},
            {id: "disabled", label: "禁用并给出原因"},
            {id: "checked", label: "受控勾选/单选项"},
        ],
        load: async () => (await import("./WorkbenchTitleActionsFixture.vue")).default,
    },
    {
        component: "WorkbenchShellLayout",
        scenes: [
            {id: "default", label: "默认（底部 / 居中）"},
            {id: "panel-positions", label: "Panel 在左侧"},
            {id: "panel-alignments", label: "底部 / 两端对齐"},
            {id: "panel-collapsed", label: "32px 标题头"},
            {id: "panel-hidden", label: "隐藏（零占用）"},
            {id: "panel-maximized", label: "最大化（瞬时）"},
            {id: "empty-panel", label: "空 Panel"},
            {id: "containers", label: "多容器单选（含空容器）"},
            {id: "container-moved", label: "整容器搬到 Panel"},
            {id: "view-reordered", label: "容器内换序"},
            {id: "view-actions", label: "View 贡献的标题动作"},
            {id: "narrow", label: "窄画布 390×844（紧凑）"},
            {id: "short", label: "短容器（高 260）"},
            {id: "lifetime", label: "实例生命周期探针"},
            {id: "view-hidden", label: "视图不可见（空态给原因）"},
            {id: "unknown-factory", label: "未知 factoryKey（失败可见）"},
        ],
        load: async () => (await import("./WorkbenchShellLayoutFixture.vue")).default,
    },
    {
        component: "WorkbenchPanelTab",
        scenes: [
            {id: "default", label: "多页签（其一激活，带图标与角标）"},
            {id: "disabled", label: "禁用项 + 可关闭项"},
            {id: "keyboard", label: "宿主 Tab 条的键盘漫游（方向键 / Home / End / Enter）"},
        ],
        load: async () => (await import("./WorkbenchPanelTabFixture.vue")).default,
    },
    {
        component: "WorkbenchStatusBarItem",
        scenes: [
            {id: "default", label: "图标 + 文本 + 角标（含激活态）"},
            {id: "variants", label: "error / warning / info / success 四个变体"},
            {id: "readonly", label: "只读（clickable=false，不发事件）"},
        ],
        load: async () => (await import("./WorkbenchStatusBarItemFixture.vue")).default,
    },
    {
        component: "WorkbenchViewInstances",
        scenes: [
            {id: "default", label: "实例落在左栏（可搬容器、可设不可见）"},
            {id: "moved", label: "搬到面板：同一实例不重挂"},
            {id: "hidden", label: "不可见的视图不渲染实例"},
        ],
        load: async () => (await import("./WorkbenchViewInstancesFixture.vue")).default,
    },
];

export function findLabFixture(component: string): LabFixture | null {
    return labFixtures.find((fixture) => fixture.component === component) ?? null;
}
