import type {LabFixtureDefinition} from "./index";
import type WorkbenchActivityBar from "nbook/app/components/workbench/WorkbenchActivityBar.vue";
import type WorkbenchContainerSection from "nbook/app/components/workbench/WorkbenchContainerSection.vue";
import type WorkbenchContainerSurface from "nbook/app/components/workbench/WorkbenchContainerSurface.vue";
import type WorkbenchPanelSurface from "nbook/app/components/workbench/WorkbenchPanelSurface.vue";
import type WorkbenchPanelTab from "nbook/app/components/workbench/WorkbenchPanelTab.vue";
import type WorkbenchStatusBar from "nbook/app/components/workbench/WorkbenchStatusBar.vue";
import type WorkbenchStatusBarItem from "nbook/app/components/workbench/WorkbenchStatusBarItem.vue";
import type WorkbenchTitleActions from "nbook/app/components/workbench/WorkbenchTitleActions.vue";
import {SHELL_LEFT_CONTAINER, SHELL_RIGHT_CONTAINER} from "nbook/app/utils/workbench/containers";

const primary = [
    {id: "files", label: "文件", icon: "i-lucide-files", active: true},
    {id: "search", label: "搜索", icon: "i-lucide-search"},
    {id: "outline", label: "大纲", icon: "i-lucide-list-tree"},
    {id: "world", label: "世界引擎", icon: "i-lucide-globe-2"},
];
const secondary = [
    {id: "trace", label: "链路查看器", icon: "i-lucide-activity"},
    {id: "history", label: "历史收件箱", icon: "i-lucide-inbox"},
];
const footer = [
    {id: "account", label: "账户", icon: "i-lucide-user-round"},
    {id: "settings", label: "设置", icon: "i-lucide-settings"},
];
const longSecondary = [
    ...secondary,
    {id: "jobs", label: "任务中心", icon: "i-lucide-list-checks"},
    {id: "ports", label: "端口", icon: "i-lucide-radio"},
    {id: "output", label: "输出", icon: "i-lucide-file-text"},
    {id: "problems", label: "问题", icon: "i-lucide-alert-circle", reason: "还没有诊断结果"},
];

export const workbenchActivityBarScenes = [
    {id: "default", label: "默认（三组几何 620px）", input: {props: {primary, secondary, footer, label: "工作台导航（Lab 演示）", moreLabel: "更多"}}},
    {id: "overflow", label: "溢出（次要入口进 More）", input: {props: {primary: primary.slice(0, 2), secondary: longSecondary, footer, label: "工作台导航（Lab 演示）", moreLabel: "更多"}}},
    {id: "disabled", label: "禁用（入口在但给原因）", input: {props: {primary: [
        {id: "files", label: "文件", icon: "i-lucide-files", disabled: true, reason: "请先打开一个 Project"},
        {id: "search", label: "搜索", icon: "i-lucide-search", disabled: true, reason: "请先打开一个 Project"},
        {id: "outline", label: "大纲", icon: "i-lucide-list-tree"},
    ], secondary, footer, label: "工作台导航（Lab 演示）", moreLabel: "更多"}}},
    {id: "short", label: "矮容器 220px（滚动兜底）", input: {props: {primary: [...primary,
        {id: "characters", label: "人物", icon: "i-lucide-users-round"},
        {id: "source-control", label: "源代码管理", icon: "i-lucide-git-branch"},
    ], secondary: longSecondary, footer: [footer[0]!, {id: "settings", label: "设置", icon: "i-lucide-settings", badge: 2}], label: "工作台导航（Lab 演示）", moreLabel: "更多"}}},
] satisfies LabFixtureDefinition<typeof WorkbenchActivityBar>["scenes"];

export const workbenchContainerSectionScenes = [
    {id: "scroll", label: "展开（scroll 档 40 行长列表）", input: {props: {id: "lab-section", title: "工具", contextLabel: "40 条", collapsible: true, layout: "scroll", emptyText: "暂无内容"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
    {id: "collapsed", label: "受控折叠初值（collapsed: true）", input: {props: {id: "lab-section", title: "大纲", contextLabel: "7 章节", collapsible: true, layout: "scroll", emptyText: "暂无内容"}, model: {collapsed: true}, slots: {default: true, actions: true}}},
    {id: "fill", label: "fill 档（内容自己滚）", input: {props: {id: "lab-section", title: "对话记录", contextLabel: "", collapsible: true, layout: "fill", emptyText: "暂无内容"}, model: {collapsed: false}, slots: {default: true, actions: true, context: true}}},
    {id: "empty-text", label: "空态说明文字", input: {props: {id: "lab-section", title: "关联引用", contextLabel: "0 项", collapsible: true, layout: "scroll", emptyText: "暂无关联引用，在正文中 @ 引用即可添加"}, model: {collapsed: false}, slots: {default: false, actions: true}}},
    {id: "no-collapse", label: "不可折叠（头部无展开语义）", input: {props: {id: "lab-section", title: "工作区信息", contextLabel: "只读", collapsible: false, layout: "scroll", emptyText: "暂无内容"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
] satisfies LabFixtureDefinition<typeof WorkbenchContainerSection>["scenes"];

const leftSections = [
    {id: "files", title: "项目文件", contextLabel: "workspace", layout: "scroll", collapsible: true, collapsed: false, canToggleVisibility: true},
    {id: "outline", title: "大纲", contextLabel: "7 章节", layout: "scroll", collapsible: true, collapsed: false, canToggleVisibility: true},
    {id: "timeline", title: "时间线", contextLabel: "已更新", layout: "scroll", collapsible: true, collapsed: true, canToggleVisibility: true},
    {id: "references", title: "关联引用", contextLabel: "0 项", layout: "scroll", collapsible: true, collapsed: false, empty: true, emptyText: "暂无关联引用，在正文中 @ 引用即可添加", canToggleVisibility: true},
] as const;
const rightSections = [
    {id: "overflow", title: "这是一个超长的区段标题用来检验省略截断", contextLabel: "超长上下文标签描述文本", layout: "scroll", collapsible: true, collapsed: false, canToggleVisibility: true},
    {id: "compact", title: "备忘录", contextLabel: "3 项", layout: "scroll", collapsible: true, collapsed: false, canToggleVisibility: true},
] as const;
export const workbenchContainerSurfaceScenes = [
    {id: "product", label: "产品落位（左 scroll / 右 fill）", input: {props: {container: SHELL_LEFT_CONTAINER, title: "主侧边栏 / Primary Side Bar", layout: "scroll"}, model: {visibleSections: []}, slots: {default: true, head: true, content: true, actions: true}}},
    {id: "sections", label: "文件夹式侧栏（Section 列表与可见性）", input: {props: {container: SHELL_LEFT_CONTAINER, title: "资源管理器", sections: leftSections}, model: {visibleSections: leftSections.map((section) => section.id)}, slots: {actions: true}}},
    {id: "scroll", label: "两栏都 scroll", input: {props: {container: SHELL_LEFT_CONTAINER, title: "工具", layout: "scroll"}, model: {visibleSections: []}, slots: {default: true, head: true, content: true, actions: true}}},
    {id: "fill", label: "两栏都 fill", input: {props: {container: SHELL_LEFT_CONTAINER, title: "工具", layout: "fill"}, model: {visibleSections: []}, slots: {default: true, head: true, content: true, actions: true}}},
    {id: "primary-sidebar", label: "单栏：主侧边栏（scroll）", input: {props: {container: SHELL_LEFT_CONTAINER, title: "主侧边栏 / Primary Side Bar", layout: "scroll"}, model: {visibleSections: []}, slots: {default: true, actions: true}}},
    {id: "secondary-sidebar", label: "单栏：辅助侧边栏（fill）", input: {props: {container: SHELL_RIGHT_CONTAINER, title: "辅助侧边栏 / Secondary Side Bar", layout: "fill"}, model: {visibleSections: []}, slots: {default: true, actions: true}}},
] satisfies LabFixtureDefinition<typeof WorkbenchContainerSurface>["scenes"];

const panelProps = {title: "问题与输出", layout: "fill"} as const;
export const workbenchPanelSurfaceScenes = [
    {id: "default", label: "默认面板（问题列表 44 项）", input: {props: panelProps, model: {activeTab: "problems", collapsed: false}, slots: {tabs: true, actions: true, content: true}}},
    {id: "terminal", label: "终端视图（fill 布局）", input: {props: panelProps, model: {activeTab: "terminal", collapsed: false}, slots: {tabs: true, actions: true, content: true}}},
    {id: "collapsed", label: "收起态", input: {props: panelProps, model: {activeTab: "problems", collapsed: true}, slots: {tabs: true, actions: true, content: true}}},
    {id: "scroll", label: "滚动布局（scroll 呈现）", input: {props: {title: "问题与输出", layout: "scroll"}, model: {activeTab: "problems", collapsed: false}, slots: {tabs: true, actions: true, content: true}}},
    {id: "empty-actions", label: "空面板：没有标签，只剩框架动作区", input: {props: {title: "空面板（没有标签）", layout: "fill"}, model: {activeTab: "", collapsed: false}, slots: {tabs: true, actions: true, content: true}}},
    {id: "view-actions", label: "标题区：View 动作 + 框架动作（真实动作部件）", input: {props: panelProps, model: {activeTab: "problems", collapsed: false}, slots: {tabs: true, actions: true, content: true}}},
] satisfies LabFixtureDefinition<typeof WorkbenchPanelSurface>["scenes"];

export const workbenchStatusBarScenes = [
    {id: "standard", label: "标准状态栏（全量项与计数）", input: {props: {ariaLabel: "状态栏"}, slots: {left: true, right: true}}},
    {id: "errors", label: "多诊断告警态（5 错误 / 12 警告）", input: {props: {ariaLabel: "状态栏"}, slots: {left: true, right: true}}},
    {id: "clean", label: "无告警干净态", input: {props: {ariaLabel: "状态栏"}, slots: {left: true, right: true}}},
    {id: "narrow", label: "窄容器防溢出（360px）", input: {props: {ariaLabel: "状态栏"}, slots: {left: true, right: true}}},
] satisfies LabFixtureDefinition<typeof WorkbenchStatusBar>["scenes"];

const defaultTabProps = {id: "problems", label: "问题", icon: "i-lucide-alert-circle", badge: 44, active: true, closable: false, disabled: false};
export const workbenchPanelTabScenes = [
    {id: "default", label: "多页签（其一激活，带图标与角标）", input: {props: defaultTabProps}},
    {id: "disabled", label: "禁用项 + 可关闭项", input: {props: {...defaultTabProps, badge: 3}}},
    {id: "keyboard", label: "宿主 Tab 条的键盘漫游（方向键 / Home / End / Enter）", input: {props: {id: "problems", label: "问题", badge: 3, active: true, closable: false, disabled: false}}},
] satisfies LabFixtureDefinition<typeof WorkbenchPanelTab>["scenes"];

export const workbenchStatusBarItemScenes = [
    {id: "default", label: "图标 + 文本 + 角标（含激活态）", input: {props: {id: "status-item-subject", label: "refactor/w00003-nb-ui-adoption", icon: "i-lucide-git-branch", badge: "1↑", variant: "default", clickable: true, active: false, title: "当前 Git 分支（带未推送提交角标）"}}},
    {id: "variants", label: "error / warning / info / success 四个变体", input: {props: {id: "status-item-subject", label: "5 个错误", icon: "i-lucide-x-circle", badge: 5, variant: "error", clickable: true, active: false, title: "工作区诊断错误计数"}}},
    {id: "readonly", label: "只读（clickable=false，不发事件）", input: {props: {id: "status-item-subject", label: "UTF-8", icon: "", badge: "", variant: "default", clickable: false, active: false, title: "只读：文件编码模式"}}},
] satisfies LabFixtureDefinition<typeof WorkbenchStatusBarItem>["scenes"];

const defaultSecondary = [{id: "secondary-demo", label: "示例次要动作", icon: "i-lucide-wand-2"}];
export const workbenchTitleActionsScenes = [
    {id: "default", label: "默认（主操作 + 更多）", input: {props: {scope: "view", primary: [{id: "refresh", label: "刷新", icon: "i-lucide-refresh-cw"}, {id: "pin", label: "固定", icon: "i-lucide-star"}], secondary: defaultSecondary, label: "视图操作"}}},
    {id: "overflow", label: "窄条折叠进更多", input: {props: {scope: "view", primary: ["refresh-cw", "wand-2", "list-tree", "search", "bell", "star"].map((icon, index) => ({id: `action-${index + 1}`, label: `动作 ${index + 1}`, icon: `i-lucide-${icon}`})), secondary: defaultSecondary, label: "视图操作"}}},
    {id: "disabled", label: "禁用并给出原因", input: {props: {scope: "view", primary: [{id: "maximize", label: "最大化面板", icon: "i-lucide-maximize-2", disabled: true, reason: "居中对齐后可最大化"}, {id: "hide", label: "隐藏面板", icon: "i-lucide-eye-off"}], secondary: defaultSecondary, label: "视图操作"}}},
    {id: "checked", label: "受控勾选/单选项", input: {props: {scope: "view", primary: [{id: "mark", label: "标记当前视图", icon: "i-lucide-star", type: "checkbox", checked: false}], secondary: [{id: "density", label: "列表密度", icon: "i-lucide-list", children: [
        {id: "density:comfortable", label: "宽松", type: "radio", group: "density", checked: true},
        {id: "density:compact", label: "紧凑", type: "radio", group: "density", checked: false},
    ]}, {id: "reset", label: "重置标记", icon: "i-lucide-undo-2", disabled: true, reason: "还没有标记"}], label: "视图操作"}}},
] satisfies LabFixtureDefinition<typeof WorkbenchTitleActions>["scenes"];
