/**
 * 手势验收页的组件定义：场景、场景属性控件与事件日志收录的事件。原来在 playground 的组件 Lab 注册表里；组件实验
 * 改到新应用的 Component Lab 登记之后，只有需要真实指针与布局引擎的验收留在 playground：两个手势验收、一个
 * 勾选框聚焦滚动验收与弹出列表的尺寸与高亮验收（见 e2e/ 下同名的 spec）。
 */

export type LabControlType = "boolean" | "text" | "select";

export type LabPropControl = {
    id: string;
    label: string;
    type: LabControlType;
    options?: readonly {label: string; value: string}[];
    /** 切换场景时恢复到的默认值；缺省按类型推导（boolean→false、text→""、select→首项） */
    defaultValue?: string | boolean;
};

export type LabScene = {id: string; label: string};

export type LabComponentDefinition = {
    id: string;
    label: string;
    scenes: LabScene[];
    controls: LabPropControl[];
    /** 事件日志只记录名单内的事件 */
    events: string[];
};

export const ACCEPTANCE_DEFINITIONS: Record<string, LabComponentDefinition> = {
    "splitter": {
        id: "splitter",
        label: "Splitter",
        scenes: [{id: "default", label: "默认"}],
        controls: [
            {id: "direction", label: "方向", type: "select", defaultValue: "horizontal", options: [
                {label: "水平", value: "horizontal"},
                {label: "垂直", value: "vertical"},
            ]},
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "zeroSecondSash", label: "第二条分隔条零宽", type: "boolean"},
        ],
        events: ["layout", "gesture-start", "gesture-update", "gesture-end", "gesture-cancel"],
    },
    "nested-grid": {
        id: "nested-grid",
        label: "NestedGrid",
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
        events: ["layout", "gesture-start", "gesture-update", "gesture-end", "gesture-cancel", "restore"],
    },
    "popup-lists": {
        id: "popup-lists",
        label: "弹出列表",
        scenes: [{id: "menus", label: "菜单一族"}, {id: "select", label: "Select"}, {id: "quick-pick", label: "QuickPick"}, {id: "long", label: "长列表与级联"}, {id: "quick-pick-long", label: "QuickPick 长列表"}, {id: "material", label: "浮层材质"}],
        controls: [],
        events: [],
    },
    "dialog-surfaces": {
        id: "dialog-surfaces",
        label: "对话框分档",
        scenes: [
            {id: "single", label: "一个对话框"},
            {id: "nested", label: "对话框里的对话框"},
            {id: "alert", label: "对话框里的确认框"},
            {id: "nested-probe", label: "对话框里的对话框（二级那档改成可区分的值）"},
            {id: "alert-probe", label: "对话框里的确认框（二级那档与确认框圆角改成可区分的值）"},
            {id: "window-probe", label: "浮动窗口里的浮动窗口（二级那档与对话框圆角改成可区分的值）"},
            {id: "drawer-in-dialog", label: "对话框里的抽屉（抽屉不画二级的面）"},
            {id: "alert-in-window", label: "浮动窗口里的确认框"},
        ],
        controls: [],
        events: [],
    },
    "suggestion-menu": {
        id: "suggestion-menu",
        label: "SuggestionMenu",
        scenes: [{id: "caret", label: "贴光标"}, {id: "header", label: "与输入框同宽、顶部搜索框"}, {id: "wide", label: "锚点比窗口宽"}],
        controls: [],
        events: [],
    },
    "checkbox-focus": {
        id: "checkbox-focus",
        label: "Checkbox",
        scenes: [{id: "default", label: "滚动列表底部聚焦"}],
        controls: [],
        events: [],
    },
    "control-invalid": {
        id: "control-invalid",
        label: "输入框出错外观",
        scenes: [{id: "default", label: "出错与正常对照"}],
        controls: [],
        events: [],
    },
};

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
