import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type PluginsPage from "nbook/plugins/plugins/web/components/PluginsPage.vue";


export const fixtures: LabFixture[] = [
    defineLabFixture<typeof PluginsPage>({
        component: "PluginsPage",
        scenes: [
            {id: "pending", label: "有待生效的变化（升级、降级、安装、禁用、卸载）", input: {props: {locale: "zh-CN"}}},
            {id: "problems", label: "显示名、说明，服务端与本窗口的问题（入口失败、受阻、贡献被拒）", input: {props: {locale: "zh-CN"}}},
            {id: "problems-english", label: "显示名、说明与问题，英文界面", input: {props: {locale: "en-US"}}},
            {id: "empty", label: "没有第三方插件", input: {props: {locale: "zh-CN"}}},
            {id: "not-loaded", label: "没有登记：清单无效、不兼容", input: {props: {locale: "zh-CN"}}},
            {id: "safe-mode", label: "安全模式", input: {props: {locale: "zh-CN"}}},
            {id: "long", label: "很长的 id 与版本", input: {props: {locale: "zh-CN"}}},
            {id: "downgrade", label: "安装预览为降级", input: {props: {locale: "zh-CN"}}},
            {id: "blocked", label: "升级预览列出重启后受阻的插件", input: {props: {locale: "zh-CN"}}},
            {id: "blocked-english", label: "升级预览列出重启后受阻的插件，英文界面", input: {props: {locale: "en-US"}}},
            {id: "loading", label: "读取中", input: {props: {locale: "zh-CN"}}},
            {id: "failed", label: "读取失败", input: {props: {locale: "zh-CN"}}},
            {id: "english", label: "英文界面", input: {props: {locale: "en-US"}}},
            {id: "write-failed", label: "写操作失败（点开关看失败说明）", input: {props: {locale: "zh-CN"}}},
            {id: "write-failed-english", label: "写操作失败，英文界面", input: {props: {locale: "en-US"}}},
            {id: "busy", label: "写操作进行中（点开关或卸载后不结算）", input: {props: {locale: "zh-CN"}}},
        ],
        load: async () => (await import("./PluginsPageFixture.vue")).default,
    }),
];
