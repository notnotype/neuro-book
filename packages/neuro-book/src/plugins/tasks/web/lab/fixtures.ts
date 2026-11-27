import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type TasksView from "nbook/plugins/tasks/web/components/TasksView.vue";
import type TasksHover from "nbook/plugins/tasks/web/components/TasksHover.vue";


export const fixtures: LabFixture[] = [
    defineLabFixture<typeof TasksView>({
        component: "TasksView",
        scenes: (() => {
            // 集成场景：内存里的任务仓库由包装组件建；输入只是占位，场景不读它。
            const placeholder = {props: {context: {id: "nbook.tasks.list", generation: 1, visible: {value: false}, location: {value: "panel" as const}}}};
            return [
                {id: "mixed", label: "会话、项目与应用三种组（右栏隐藏时的宽度）", input: placeholder},
                {id: "mixed-tall", label: "拉高看全：会话块、等你处理、项目组与应用组", input: placeholder},
                {id: "mixed-all-tall", label: "全部项目：每个项目一组", input: placeholder},
                {id: "mixed-narrow", label: "默认布局的宽度", input: placeholder},
                {id: "mixed-phone-tall", label: "390 宽：每件两行", input: placeholder},
                {id: "mixed-collapsed-tall", label: "一个会话块收起", input: placeholder},
                {id: "mixed-cancelling-stopping-tall", label: "一件正在取消、一行正在停止", input: placeholder},
                {id: "mixed-more-tall", label: "另有 12 件没有列出、其他项目还有 1 件在运行", input: placeholder},
                {id: "empty", label: "没有任务", input: placeholder},
                {id: "mixed-tall-english", label: "英文界面", input: placeholder},
                {id: "mixed-phone-tall-english", label: "英文界面，390 宽", input: placeholder},
                {id: "mixed-phone-long-english", label: "英文界面，390 宽，拉长到应用组", input: placeholder},
                {id: "elsewhere", label: "当前项目没有、其他项目还有 3 件在运行", input: placeholder},
            ];
        })(),
        load: async () => (await import("./TasksFixture.vue")).default,
    }),
    defineLabFixture<typeof TasksHover>({
        component: "TasksHover",
        noInput: "唯一的属性是任务仓库，不是场景能写的数据；包装组件在内存里建一份",
        scenes: [{id: "hover", label: "五件在跑、列出三件：确定与不确定进度，末尾写还有几件"}],
        load: async () => (await import("./TasksFixture.vue")).default,
    }),
];
