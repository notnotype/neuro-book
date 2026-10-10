/**
 * 手势验收页的组件定义：场景、场景属性控件与事件日志收录的事件。原来在 playground 的组件 Lab 注册表里；组件实验
 * 改到新应用的 Component Lab 登记之后，只有这两个需要真实指针与布局引擎的手势验收留在 playground（见
 * e2e/nested-grid.spec.ts、e2e/splitter.spec.ts）。
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
