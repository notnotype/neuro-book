import type {Component} from "vue";

/**
 * 场景登记。这不是第二份组件清单——组件清单由 component-index 扫文档得到，
 * 这里只补文档里没有的东西：一个组件可以摆出哪几个场景。两者按组件名对上。
 */
export type LabScene = {
    id: string;
    label: string;
};

export type LabFixture = {
    /** 与组件文档同名 */
    component: string;
    scenes: LabScene[];
    load: () => Promise<Component>;
};

export const labFixtures: LabFixture[] = [
    {
        component: "CollapsibleSidePanel",
        scenes: [
            {id: "default", label: "展开"},
            {id: "collapsed", label: "收起"},
            {id: "right", label: "靠右"},
            {id: "long", label: "长内容"},
        ],
        load: async () => (await import("./CollapsibleSidePanelFixture.vue")).default,
    },
    {
        component: "ViewportCanvas",
        scenes: [
            {id: "phone", label: "手机 390×844"},
            {id: "tablet", label: "平板 768×1024"},
            {id: "free", label: "不限尺寸"},
        ],
        load: async () => (await import("./ViewportCanvasFixture.vue")).default,
    },
    {
        component: "JsonViewer",
        scenes: [
            {id: "object", label: "对象"},
            {id: "array", label: "数组"},
            {id: "text", label: "未写完的字符串"},
            {id: "empty", label: "空对象"},
        ],
        load: async () => (await import("./JsonViewerFixture.vue")).default,
    },
];

export function findLabFixture(component: string): LabFixture | null {
    return labFixtures.find((fixture) => fixture.component === component) ?? null;
}
