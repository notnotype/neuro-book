import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type NetworkPage from "nbook/plugins/network/web/components/NetworkPage.vue";


export const fixtures: LabFixture[] = [
    defineLabFixture<typeof NetworkPage>({
        component: "NetworkPage",
        scenes: [
            {id: "system", label: "跟随系统：写出环境变量里的代理与来源", input: {props: {writable: true}}},
            {id: "system-none", label: "跟随系统：系统没有设代理", input: {props: {writable: true}}},
            {id: "system-unsupported", label: "跟随系统：自动配置脚本，不支持", input: {props: {writable: true}}},
            {id: "system-unreadable", label: "跟随系统：读不到系统设置", input: {props: {writable: true}}},
            {id: "loading", label: "正在读取现在用的代理", input: {props: {writable: true}}},
            {id: "custom-tested", label: "自定义并测过：连接成功，出口 IP 与耗时", input: {props: {writable: true}}},
            {id: "custom-empty", label: "自定义还没填地址", input: {props: {writable: true}}},
            {id: "testing", label: "测试进行中（按钮换成“取消测试”）", input: {props: {writable: true}}},
            {id: "test-failed", label: "测试失败：无法连接", input: {props: {writable: true}}},
            {id: "test-bypassed", label: "测试目标在旁路清单里：不说“连接成功”", input: {props: {writable: true}}},
            {id: "direct", label: "直连：没有测试一行", input: {props: {writable: true}}},
            {id: "catalog-never", label: "还没有取过在线目录", input: {props: {writable: true}}},
            {id: "catalog-failed", label: "上次更新失败（代理设置有问题）", input: {props: {writable: true}}},
            {id: "catalog-disabled", label: "这台机器关掉了在线目录", input: {props: {writable: true}}},
            {id: "catalog-unavailable", label: "模型服务没有运行：读不到目录状态", input: {props: {writable: true}}},
            {id: "readonly", label: "用户层不能写（控件停用）", input: {props: {writable: true}}},
            {id: "write-failed", label: "写不进去（窗口通知记进事件）", input: {props: {writable: true}}},
            {id: "custom-tested-english", label: "英文界面：自定义并测过", input: {props: {writable: true}}},
            {id: "system-unsupported-english", label: "英文界面：不支持的系统代理", input: {props: {writable: true}}},
            {id: "test-failed-narrow", label: "390px 宽：测试失败", input: {props: {writable: true}}},
            {id: "system-english-narrow", label: "390px 宽、英文：跟随系统", input: {props: {writable: true}}},
        ],
        load: async () => (await import("./NetworkPageFixture.vue")).default,
    }),
];
