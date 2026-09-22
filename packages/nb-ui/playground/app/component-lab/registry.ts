import {nbColorwayVarKeys} from "../../../src/colorway/colorway-contract";
import {getInstalledThemes} from "../../../src/theme/theme-loader";
import {
    nbElevationTokens,
    nbMotionTokens,
    nbRadiusTokens,
    nbSpacingTokens,
    nbThemeDecorTokens,
    nbThemeMetricTokens,
    nbThemeRoleTokens,
    nbTypographyTokens,
} from "../../../src/theme/tokens";

export type LabComponentId =
    | "form-input" | "form-number-input" | "form-select" | "form-checkbox" | "time-picker" | "radio-group" | "slider" | "pin-input" | "calendar" | "date-picker" | "range-calendar" | "date-range-picker" | "date-field" | "time-field" | "month-picker" | "year-picker" | "listbox" | "color-picker" | "autocomplete" | "checkbox-group"
    | "button" | "icon-button" | "segmented-control" | "toggle-group" | "switch" | "switch-field" | "dropdown" | "tabs" | "toolbar" | "menubar" | "editable" | "stepper"
    | "badge" | "avatar" | "progress" | "kbd" | "spinner" | "rating"
    | "pagination" | "breadcrumb" | "navigation-menu" | "tree"
    | "splitter" | "accordion" | "scroll-area"
    | "drop-indicator"
    | "dialog-window" | "drawer" | "popover" | "alert-dialog"
    | "quick-input"
    | "nested-grid";
export type LabViewportId = "responsive" | "phone" | "tablet";
export type LabControlType = "boolean" | "text" | "select";

export type LabOption = {
    label: string;
    value: string;
};

export type LabPropControl = {
    id: string;
    label: string;
    type: LabControlType;
    options?: readonly LabOption[];
    /** 切换场景时恢复到的默认值；缺省按类型推导（boolean→false、text→""、select→首项） */
    defaultValue?: string | boolean;
};

export type LabScene = {
    id: string;
    label: string;
    /** 场景语义是结构化的：检查器据此断言 aria-invalid，不再靠场景 id 字符串匹配 */
    invalid?: boolean;
    disabled?: boolean;
};

export type LabComponentDefinition = {
    id: LabComponentId;
    label: string;
    /** 中文名，导航里作主名，英文组件名作副名 */
    labelZh: string;
    group: string;
    description: string;
    scenes: LabScene[];
    controls: LabPropControl[];
    /** 检查器读取的真实目标元素选择器 */
    targetSelector: string;
    /** 用户可观察事件名单；事件日志只记录名单内的事件 */
    events: string[];
};

const sizeOptions = [
    {label: "默认", value: "default"},
    {label: "紧凑", value: "sm"},
] as const;

const directionOptions = [
    {label: "自动", value: "auto"},
    {label: "向上", value: "up"},
    {label: "向下", value: "down"},
] as const;

export const labComponents: LabComponentDefinition[] = [
    {
        id: "form-input",
        label: "FormInput",
        labelZh: "输入框",
        group: "表单",
        description: "文本、搜索、密码与数字字符串输入；支持前缀、只读和字段错误语义。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "prefix", label: "前缀"},
            {id: "invalid", label: "错误", invalid: true},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "readonly", label: "只读", type: "boolean"},
            {id: "type", label: "类型", type: "select", defaultValue: "text", options: [
                {label: "文本", value: "text"},
                {label: "搜索", value: "search"},
                {label: "密码", value: "password"},
                {label: "数字", value: "number"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "focus"],
    },
    {
        id: "form-number-input",
        label: "FormNumberInput",
        labelZh: "数字输入",
        group: "表单",
        description: "保留编辑中间态的数字字符串输入；支持步进、边界和 Enter 提交。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "bounded", label: "边界"},
            {id: "invalid", label: "错误", invalid: true},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "readonly", label: "只读", type: "boolean"},
            {id: "size", label: "尺寸", type: "select", defaultValue: "default", options: sizeOptions},
            {id: "step", label: "步进", type: "text", defaultValue: "0.5"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "submit"],
    },
    {
        id: "form-select",
        label: "FormSelect",
        labelZh: "选择器",
        group: "表单",
        description: "Reka Select 选择器；支持说明、图标、方向、紧凑尺寸与禁用项。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "rich", label: "丰富选项"},
            {id: "invalid", label: "错误", invalid: true},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "hideCheckmark", label: "隐藏勾选", type: "boolean"},
            {id: "size", label: "尺寸", type: "select", defaultValue: "default", options: sizeOptions},
            {id: "direction", label: "展开方向", type: "select", defaultValue: "auto", options: directionOptions},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "focus"],
    },
    {
        id: "form-checkbox",
        label: "FormCheckbox",
        labelZh: "复选框",
        group: "表单",
        description: "布尔字段；支持可选文字、true/false 回退、禁用和错误语义。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "fallback", label: "值回退"},
            {id: "invalid", label: "错误", invalid: true},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "label", label: "标签", type: "text", defaultValue: "启用同步"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "focus"],
    },
    {
        id: "time-picker",
        label: "TimePicker",
        labelZh: "时间选择",
        group: "表单",
        description: "第一个允许主题覆盖实现的组件：默认是输入框+时间列表，macOS 主题是滚轮，v-model 契约一致。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "invalid", label: "错误", invalid: true},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "step", label: "步进（分）", type: "text", defaultValue: "30"},
            {id: "min", label: "下限", type: "text", defaultValue: "08:00"},
            {id: "max", label: "上限", type: "text", defaultValue: "20:00"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "button",
        label: "Button",
        labelZh: "按钮",
        group: "控件",
        description: "五种变体两档尺寸；loading 场景锁定交互并给出忙碌指示。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "loading", label: "加载"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "variant", label: "变体", type: "select", defaultValue: "primary", options: [
                {label: "主要", value: "primary"},
                {label: "次要", value: "secondary"},
                {label: "柔和", value: "subtle"},
                {label: "危险", value: "danger"},
                {label: "幽灵", value: "ghost"},
            ]},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "默认", value: "md"},
                {label: "紧凑", value: "sm"},
            ]},
            {id: "block", label: "撑满宽度", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["click"],
    },
    {
        id: "icon-button",
        label: "IconButton",
        labelZh: "图标按钮",
        group: "控件",
        description: "紧凑图标操作；title 即无障碍名称，是检查器的可读名称来源。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "variant", label: "变体", type: "select", defaultValue: "default", options: [
                {label: "默认", value: "default"},
                {label: "强调", value: "accent"},
                {label: "危险", value: "danger"},
            ]},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "默认", value: "md"},
                {label: "紧凑", value: "sm"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["click"],
    },
    {
        id: "segmented-control",
        label: "SegmentedControl",
        labelZh: "分段选择",
        group: "控件",
        description: "互斥选项组；lab 页自己的场景/视口切换就是它，禁用项场景展示不可选态。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled-item", label: "禁用项"},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "sm", options: [
                {label: "紧凑", value: "sm"},
                {label: "更小", value: "xs"},
            ]},
            {id: "tone", label: "色调", type: "select", defaultValue: "default", options: [
                {label: "默认", value: "default"},
                {label: "强调", value: "accent"},
                {label: "警告", value: "warning"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "switch-field",
        label: "SwitchField",
        labelZh: "开关字段",
        group: "控件",
        description: "role=switch 的布尔字段；aria-checked 是检查器的重点读数。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "description", label: "描述", type: "text", defaultValue: "本地修改实时同步到工作区"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "dropdown",
        label: "Dropdown",
        labelZh: "下拉菜单",
        group: "控件",
        description: "触发器+菜单原语；含一层子菜单、受控 radio / checkbox、分隔线与危险项，键盘可全程操作。",
        scenes: [
            {id: "default", label: "平面项与长列表"},
            {id: "submenu", label: "一层子菜单（父项不执行）"},
            {id: "checked", label: "受控 radio / checkbox"},
            {id: "controlled-open", label: "受控 open"},
        ],
        controls: [
            {id: "compact", label: "紧凑触发器", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target [aria-haspopup]",
        events: ["select"],
    },
    {
        id: "tabs",
        label: "Tabs",
        labelZh: "页签",
        group: "控件",
        description: "tablist 语义与方向键漫游；禁用项不可聚焦，选中项带计数。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "默认", value: "md"},
                {label: "紧凑", value: "sm"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "badge",
        label: "Badge",
        labelZh: "徽章",
        group: "显示",
        description: "状态色三件套（主色/底色/边框）的直接消费方；dot 场景用于「运行中」类状态。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "dot", label: "圆点"},
        ],
        controls: [
            {id: "tone", label: "色调", type: "select", defaultValue: "accent", options: [
                {label: "中性", value: "neutral"},
                {label: "强调", value: "accent"},
                {label: "成功", value: "success"},
                {label: "警告", value: "warning"},
                {label: "危险", value: "danger"},
            ]},
            {id: "variant", label: "变体", type: "select", defaultValue: "soft", options: [
                {label: "柔和", value: "soft"},
                {label: "描边", value: "outline"},
                {label: "实心", value: "solid"},
            ]},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "默认", value: "md"},
                {label: "紧凑", value: "sm"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: [],
    },
    {
        id: "spinner",
        label: "Spinner",
        labelZh: "加载指示",
        group: "显示",
        description: "role=status 的加载指示；label 是无障碍名称，showLabel 场景同时显示文字。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "labeled", label: "带文字"},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "紧凑", value: "sm"},
                {label: "默认", value: "md"},
                {label: "大", value: "lg"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: [],
    },
    {
        id: "pagination",
        label: "Pagination",
        labelZh: "分页",
        group: "导航",
        description: "nav 语义 + 页码窗口；边界场景下上一页/下一页按钮自动禁用。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "first", label: "首页边界"},
            {id: "last", label: "末页边界"},
        ],
        controls: [
            {id: "pageCount", label: "总页数", type: "text", defaultValue: "9"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:page"],
    },
    {
        id: "slider",
        label: "Slider",
        labelZh: "滑动条",
        group: "表单",
        description: "连续数值/范围调节滑动条；支持单值/双滑块范围、水平/垂直方向与多档尺寸。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "紧凑", value: "sm"},
                {label: "默认", value: "md"},
                {label: "大", value: "lg"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "radio-group",
        label: "RadioGroup",
        labelZh: "单选组",
        group: "表单",
        description: "单选选项组；支持纵向/横向排布、富描述文本与无障碍单选语义。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "orientation", label: "排布方向", type: "select", defaultValue: "vertical", options: [
                {label: "纵向", value: "vertical"},
                {label: "横向", value: "horizontal"},
            ]},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "紧凑", value: "sm"},
                {label: "默认", value: "md"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "pin-input",
        label: "PinInput",
        labelZh: "验证码输入",
        group: "表单",
        description: "分格 PIN 码与加密口令输入；支持掩码模式、退格自动聚焦与完成回调。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "mask", label: "密文掩码", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "complete"],
    },
    {
        id: "calendar",
        label: "Calendar",
        labelZh: "日历选择",
        group: "表单",
        description: "无障碍网格日历选择器；支持月份翻页、今日标记与键盘焦点导航。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "toggle-group",
        label: "ToggleGroup",
        labelZh: "切换组",
        group: "控件",
        description: "单选/多选切换按钮组；适配富文本排版操作栏与多重样式叠加。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [],
        targetSelector: "#nb-lab-target",
        events: ["update:formatting", "update:alignment"],
    },
    {
        id: "switch",
        label: "Switch",
        labelZh: "开关",
        group: "控件",
        description: "现代胶囊开关控件；支持三档尺寸与平滑物理过渡动效。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "紧凑", value: "sm"},
                {label: "默认", value: "md"},
                {label: "大", value: "lg"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "toolbar",
        label: "Toolbar",
        labelZh: "工具栏",
        group: "控件",
        description: "编辑器操作工具栏容器；内置 Roving Focus 与语义分组支持。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "orientation", label: "方向", type: "select", defaultValue: "horizontal", options: [
                {label: "水平", value: "horizontal"},
                {label: "垂直", value: "vertical"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: [],
    },
    {
        id: "avatar",
        label: "Avatar",
        labelZh: "头像",
        group: "显示",
        description: "人物与势力头像；支持图片加载平滑降级 Fallback 与现代超椭圆形态。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "shape", label: "形态", type: "select", defaultValue: "squircle", options: [
                {label: "超椭圆 (Squircle)", value: "squircle"},
                {label: "圆形 (Circle)", value: "circle"},
            ]},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "极小 (xs)", value: "xs"},
                {label: "紧凑 (sm)", value: "sm"},
                {label: "默认 (md)", value: "md"},
                {label: "大 (lg)", value: "lg"},
                {label: "特大 (xl)", value: "xl"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: [],
    },
    {
        id: "progress",
        label: "Progress",
        labelZh: "进度条",
        group: "显示",
        description: "全胶囊圆角进度条；支持 4 种语义状态色与平滑位移动效。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "tone", label: "语调", type: "select", defaultValue: "accent", options: [
                {label: "强调 (Accent)", value: "accent"},
                {label: "成功 (Success)", value: "success"},
                {label: "警告 (Warning)", value: "warning"},
                {label: "危险 (Danger)", value: "danger"},
            ]},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "紧凑", value: "sm"},
                {label: "默认", value: "md"},
                {label: "大", value: "lg"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: [],
    },
    {
        id: "kbd",
        label: "Kbd",
        labelZh: "快捷键帽",
        group: "显示",
        description: "实体物理键帽质感快捷键展示；支持等宽排版与三档尺寸。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "紧凑", value: "sm"},
                {label: "默认", value: "md"},
                {label: "大", value: "lg"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: [],
    },
    {
        id: "breadcrumb",
        label: "Breadcrumb",
        labelZh: "面包屑",
        group: "导航",
        description: "层级目录与书库导航栏；支持图标、链接跳转与当前页无障碍标记。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [],
        targetSelector: "#nb-lab-target",
        events: ["click"],
    },
    {
        id: "drop-indicator",
        label: "DropIndicator",
        labelZh: "拖放反馈",
        group: "布局",
        description: "区域、条目与插入线共用视觉皮肤；宿主提供尺寸、坐标和落点语义。",
        scenes: [
            {id: "area", label: "区域"},
            {id: "entry", label: "条目"},
            {id: "line", label: "插入线"},
            {id: "compact", label: "小目标"},
            {id: "long-label", label: "长提示"},
        ],
        controls: [],
        targetSelector: "#nb-lab-target",
        events: [],
    },
    {
        id: "splitter",
        label: "Splitter",
        labelZh: "多栏分割",
        group: "布局",
        description: "多栏可调节分割工作区；支持水平/垂直方向、面板折叠与平滑拖拽吸附。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "direction", label: "方向", type: "select", defaultValue: "horizontal", options: [
                {label: "水平", value: "horizontal"},
                {label: "垂直", value: "vertical"},
            ]},
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "zeroSecondSash", label: "第二条分隔条零宽", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["layout", "gesture-start", "gesture-update", "gesture-end", "gesture-cancel"],
    },
    {
        id: "nested-grid",
        label: "NestedGrid",
        labelZh: "嵌套分栏",
        group: "布局",
        description: "两轴嵌套分栏工作区（外层左右 + 内层上下）；两轴几何独立、手势单次提交与快照恢复保障。",
        scenes: [
            {id: "default", label: "默认两轴嵌套"},
            {id: "unknown-ref", label: "未知引用恢复"},
            {id: "malformed", label: "畸形重复身份拒绝"},
            {id: "high-version", label: "高版本快照拒绝"},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "forceOverConstrained", label: "模拟过约束降级", type: "boolean"},
            {id: "zeroInnerSash", label: "内层分隔条零高", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["layout", "gesture-start", "gesture-update", "gesture-end", "gesture-cancel", "restore"],
    },
    {
        id: "accordion",
        label: "Accordion",
        labelZh: "手风琴折叠",
        group: "布局",
        description: "大纲章节手风琴折叠面板与轻量 Collapsible 容器；平滑高度动效。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "type", label: "展开模式", type: "select", defaultValue: "single", options: [
                {label: "单项展开", value: "single"},
                {label: "多项展开", value: "multiple"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "scroll-area",
        label: "ScrollArea",
        labelZh: "滚动区域",
        group: "布局",
        description: "平滑自定义滚动容器；内置自适应悬浮 macOS 胶囊滑块。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [],
        targetSelector: "#nb-lab-target",
        events: [],
    },
    {
        id: "dialog-window",
        label: "DialogWindow",
        labelZh: "非模态浮动窗口",
        group: "浮层",
        description: "无遮罩、页面仍可交互的非模态浮动窗口；标题栏可拖动，支持可选窗口缩放与内部滚动。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "resizable", label: "可调整大小"},
        ],
        controls: [
            {id: "resizable", label: "允许调整大小", type: "boolean"},
            {id: "closable", label: "显示关闭按钮", type: "boolean", defaultValue: true},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "request-close", "update:width", "update:height"],
    },
    {
        id: "drawer",
        label: "Drawer",
        labelZh: "抽屉面板",
        group: "浮层",
        description: "四向滑出侧边抽屉；支持磨砂遮罩模糊与长篇设定集快速预览。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "direction", label: "弹出方向", type: "select", defaultValue: "right", options: [
                {label: "右侧", value: "right"},
                {label: "左侧", value: "left"},
                {label: "底部", value: "bottom"},
                {label: "顶部", value: "top"},
            ]},
            {id: "handle", label: "拖拽把手", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:open"],
    },
    {
        id: "popover",
        label: "Popover",
        labelZh: "气泡与悬浮卡片",
        group: "浮层",
        description: "通用磨砂气泡卡片 (Popover) 与长文写作划词预览卡片 (HoverCard)。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "side", label: "弹出方位", type: "select", defaultValue: "bottom", options: [
                {label: "下方", value: "bottom"},
                {label: "上方", value: "top"},
                {label: "左侧", value: "left"},
                {label: "右侧", value: "right"},
            ]},
            {id: "arrow", label: "指示箭头", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:open"],
    },
    {
        id: "alert-dialog",
        label: "AlertDialog",
        labelZh: "警示弹窗",
        group: "浮层",
        description: "破坏性操作二次确认模态窗；强制提供明确操作出口与多档语调。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "tone", label: "警示语调", type: "select", defaultValue: "danger", options: [
                {label: "危险 (Danger)", value: "danger"},
                {label: "警告 (Warning)", value: "warning"},
                {label: "主要 (Accent)", value: "accent"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["confirm", "cancel"],
    },
    {
        id: "menubar",
        label: "Menubar",
        labelZh: "桌面主菜单栏",
        group: "控件",
        description: "桌面端长篇写作与全屏工作区应用级主菜单栏，支持横向键盘无缝穿梭与子菜单快捷键。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "标准 (Medium)", value: "md"},
                {label: "紧凑 (Small)", value: "sm"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["select"],
    },
    {
        id: "editable",
        label: "Editable",
        labelZh: "行内即时编辑",
        group: "控件",
        description: "双击或点击即时切换编辑输入框，用于大纲章节名、角色名快速就地重命名。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "标准 (Medium)", value: "md"},
                {label: "紧凑 (Small)", value: "sm"},
                {label: "突出 (Large)", value: "lg"},
            ]},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["submit"],
    },
    {
        id: "stepper",
        label: "Stepper",
        labelZh: "步骤向导器",
        group: "控件",
        description: "新建作品向导、多格式电子书导出流程与发布流水线步骤指示器。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "orientation", label: "排布方向", type: "select", defaultValue: "horizontal", options: [
                {label: "水平排布", value: "horizontal"},
                {label: "垂直排布", value: "vertical"},
            ]},
            {id: "linear", label: "线性约束", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "date-picker",
        label: "DatePicker",
        labelZh: "复合日期选择器",
        group: "表单",
        description: "输入框触发器与磨砂日历网格浮层，支持作品定档与发布计划选择。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "标准 (Medium)", value: "md"},
                {label: "紧凑 (Small)", value: "sm"},
                {label: "大号 (Large)", value: "lg"},
            ]},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "range-calendar",
        label: "RangeCalendar",
        labelZh: "区间选择日历",
        group: "表单",
        description: "在单个日历网格中连续选择起止日期区间，用于写作打卡统计与字数统计周期过滤。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "listbox",
        label: "Listbox",
        labelZh: "高级列表选择框",
        group: "表单",
        description: "长篇大纲章节批量选择、设定集人物/标签多选池，支持紧凑行、富实体卡片与分卷分组。",
        scenes: [
            {id: "default", label: "方案 1: macOS 经典紧凑检查器"},
            {id: "card", label: "方案 2: 现代富实体卡片"},
            {id: "grouped", label: "方案 3: 分段多组折叠大纲"},
            {id: "transfer", label: "方案 4: 双栏穿梭流转分配器"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "variant", label: "展示形态", type: "select", defaultValue: "compact", options: [
                {label: "紧凑列表 (Compact)", value: "compact"},
                {label: "富实体卡片 (Card)", value: "card"},
            ]},
            {id: "multiple", label: "多选模式", type: "boolean", defaultValue: true},
            {id: "showFilter", label: "搜索过滤条", type: "boolean", defaultValue: true},
            {id: "showActionBar", label: "底部统计与全选栏", type: "boolean", defaultValue: true},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "标准 (Medium)", value: "md"},
                {label: "紧凑 (Small)", value: "sm"},
                {label: "大号 (Large)", value: "lg"},
            ]},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "color-picker",
        label: "ColorPicker",
        labelZh: "取色器与调色板",
        group: "表单",
        description: "主题包定制调色与标签自定义色彩选择器，集成预设色板与 Hex 实时微调。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "标准 (Medium)", value: "md"},
                {label: "紧凑 (Small)", value: "sm"},
            ]},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "rating",
        label: "Rating",
        labelZh: "星级评分条",
        group: "显示",
        description: "角色设定重要度评级、章节张力与满意度打分，支持悬浮动态弹性微动效。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "标准 (Medium)", value: "md"},
                {label: "紧凑 (Small)", value: "sm"},
                {label: "大号 (Large)", value: "lg"},
            ]},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "navigation-menu",
        label: "NavigationMenu",
        labelZh: "多栏形变导航菜单",
        group: "导航",
        description: "带平滑共享视口与指示器的高级导航菜单，支持鼠标滑动自适应平移与宽高形变过渡。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [],
        targetSelector: "#nb-lab-target",
        events: ["select", "update:modelValue"],
    },
    {
        id: "tree",
        label: "Tree",
        labelZh: "通用无限层级树",
        group: "导航",
        description: "无限层级大纲目录树，支持虚拟化滚动渲染、多选与无障碍键盘快捷遍历。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "multiple", label: "多选模式", type: "boolean"},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["select", "update:modelValue", "update:expanded"],
    },
    {
        id: "date-range-picker",
        label: "DateRangePicker",
        labelZh: "复合日期区间选择器",
        group: "表单",
        description: "输入框触发器与磨砂区间日历浮层，支持作品活动与连载起止日期快速圈选。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "标准 (Medium)", value: "md"},
                {label: "紧凑 (Small)", value: "sm"},
                {label: "大号 (Large)", value: "lg"},
            ]},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "date-field",
        label: "DateField",
        labelZh: "分段日期输入框",
        group: "表单",
        description: "年/月/日分段独立输入框，支持 Tab 快速切换与上下键微调。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "标准 (Medium)", value: "md"},
                {label: "紧凑 (Small)", value: "sm"},
                {label: "大号 (Large)", value: "lg"},
            ]},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "time-field",
        label: "TimeField",
        labelZh: "分段时间输入框",
        group: "表单",
        description: "时/分/秒独立段落键盘快速键入，无需弹层即可精准输入时间。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "标准 (Medium)", value: "md"},
                {label: "紧凑 (Small)", value: "sm"},
                {label: "大号 (Large)", value: "lg"},
            ]},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "month-picker",
        label: "MonthPicker",
        labelZh: "月份与区间选择器",
        group: "表单",
        description: "月份网格与跨月区间选择，用于创作月报与月度字数统计分析。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "year-picker",
        label: "YearPicker",
        labelZh: "年份与跨年选择器",
        group: "表单",
        description: "年份网格与跨年代区间选择，用于宏观时间轴与编年史设定管理。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "autocomplete",
        label: "Autocomplete",
        labelZh: "自动联想输入框",
        group: "表单",
        description: "设定集词条、人名与专有名词就地智能输入联想补全。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "标准 (Medium)", value: "md"},
                {label: "紧凑 (Small)", value: "sm"},
                {label: "大号 (Large)", value: "lg"},
            ]},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["select", "update:modelValue"],
    },
    {
        id: "checkbox-group",
        label: "CheckboxGroup",
        labelZh: "复选框受控组合",
        group: "表单",
        description: "统一受控数组管理的多 Checkbox 容器，支持水平/垂直排布。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "orientation", label: "排布方向", type: "select", defaultValue: "vertical", options: [
                {label: "垂直排布", value: "vertical"},
                {label: "水平排布", value: "horizontal"},
            ]},
            {id: "disabled", label: "禁用状态", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "quick-input",
        label: "QuickInput",
        labelZh: "快速输入",
        group: "反馈",
        description: "全局快速输入浮层（S4 命令面板基座）：候选项、查询与活动项全由宿主控制，前缀语义不在这里。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "empty", label: "空结果"},
            {id: "disabled", label: "含禁用项", disabled: true},
            {id: "loading", label: "加载中"},
            {id: "long-list", label: "长列表"},
            {id: "dialog-stack", label: "嵌套对话框"},
        ],
        controls: [
            {id: "open", label: "打开浮层", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:open", "close", "closed", "accept", "update:query", "update:activeId"],
    },
];

export const labViewports: {id: LabViewportId; label: string; width: number | null}[] = [
    {id: "responsive", label: "自适应", width: null},
    {id: "phone", label: "390", width: 390},
    {id: "tablet", label: "768", width: 768},
];

export type LabTokenGroup = {
    id: string;
    label: string;
    tokens: readonly string[];
};

const colorwayGroups: LabTokenGroup[] = [
    {id: "colorway-surface", label: "配色 · 表面", tokens: nbColorwayVarKeys.filter((token) => token.startsWith("--bg-") || token === "--color-scheme")},
    {id: "colorway-text", label: "配色 · 文字", tokens: nbColorwayVarKeys.filter((token) => token.startsWith("--text-"))},
    {id: "colorway-border", label: "配色 · 描边", tokens: nbColorwayVarKeys.filter((token) => token.startsWith("--border-"))},
    {id: "colorway-accent", label: "配色 · 强调", tokens: nbColorwayVarKeys.filter((token) => token.startsWith("--accent-"))},
    {id: "colorway-status", label: "配色 · 状态", tokens: nbColorwayVarKeys.filter((token) => token.startsWith("--status-"))},
    {id: "colorway-other", label: "配色 · 其他", tokens: nbColorwayVarKeys.filter((token) => !token.startsWith("--bg-") && !token.startsWith("--text-") && !token.startsWith("--border-") && !token.startsWith("--accent-") && !token.startsWith("--status-") && token !== "--color-scheme")},
];

export const labCoreTokenGroups: LabTokenGroup[] = [
    ...colorwayGroups,
    {id: "typography", label: "设计 · 排版", tokens: nbTypographyTokens},
    {id: "spacing", label: "设计 · 间距", tokens: nbSpacingTokens},
    {id: "radius", label: "设计 · 圆角", tokens: nbRadiusTokens},
    {id: "elevation", label: "设计 · 层级", tokens: nbElevationTokens},
    {id: "motion", label: "设计 · 动效", tokens: nbMotionTokens},
    {id: "theme-metric", label: "主题 · 度量", tokens: nbThemeMetricTokens},
    {id: "theme-decor", label: "主题 · 装饰", tokens: nbThemeDecorTokens},
    {id: "theme-role", label: "主题 · 角色", tokens: nbThemeRoleTokens},
];

/**
 * 已装主题 manifest.declares 声明的变量，去重并排除核心组已登记的名字。
 * 必须在主题装载完成后调用（页面 setup 时主题已装完），不能放在模块顶层求值。
 */
export function collectDeclaredTokenGroup(): LabTokenGroup | null {
    const registered = new Set(labCoreTokenGroups.flatMap((group) => group.tokens));
    const declared: string[] = [];
    for (const theme of getInstalledThemes()) {
        for (const declaration of theme.manifest.declares ?? []) {
            if (!registered.has(declaration.name) && !declared.includes(declaration.name)) {
                declared.push(declaration.name);
            }
        }
    }
    return declared.length === 0 ? null : {id: "theme-declares", label: "主题 · 声明", tokens: declared};
}

export function isLabComponentId(value: unknown): value is LabComponentId {
    return typeof value === "string" && labComponents.some((component) => component.id === value);
}

export function isLabViewportId(value: unknown): value is LabViewportId {
    return typeof value === "string" && labViewports.some((viewport) => viewport.id === value);
}

export function getLabComponent(id: LabComponentId): LabComponentDefinition {
    return labComponents.find((component) => component.id === id) ?? labComponents[0]!;
}

export function getLabScene(definition: LabComponentDefinition, sceneId: string): LabScene {
    return definition.scenes.find((scene) => scene.id === sceneId) ?? definition.scenes[0]!;
}

/** 控件的默认值：显式 defaultValue 优先，否则按类型推导 */
export function controlDefaultValue(control: LabPropControl): string | boolean {
    if (control.defaultValue !== undefined) return control.defaultValue;
    if (control.type === "boolean") return false;
    if (control.type === "select") return control.options?.[0]?.value ?? "";
    return "";
}
