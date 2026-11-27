import {createSubjectFixture, defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type SearchSettingsPage from "nbook/plugins/web-tools/web/components/SearchSettingsPage.vue";
import {withWebText} from "./web-text";
import type ApiKeyField from "nbook/plugins/web-tools/web/components/ApiKeyField.vue";

function webToolsFixtures(): LabFixture[] {
    return [
        defineLabFixture<typeof SearchSettingsPage>({
            component: "SearchSettingsPage",
            scenes: [
                {id: "unset", label: "还没有密钥（检测停用）", input: {props: {writable: true}}},
                {id: "set", label: "已设置", input: {props: {writable: true}}},
                {id: "loading", label: "读取中", input: {props: {writable: true}}},
                {id: "checking", label: "检测中", input: {props: {writable: true}}},
                {id: "passed", label: "检测通过", input: {props: {writable: true}}},
                {id: "failed", label: "检测没通过（密钥不对）", input: {props: {writable: true}}},
                {id: "not-run", label: "没检成（结果未知）", input: {props: {writable: true}}},
                {id: "readonly", label: "网页工具没有运行（只读）", input: {props: {writable: true}}},
                {id: "unreadable", label: "密钥文件读不了", input: {props: {writable: true}}},
                {id: "write-failed", label: "写不进去（窗口通知记进事件）", input: {props: {writable: true}}},
                {id: "use-tavily-no-key", label: "使用中的 Tavily 还没有密钥（左栏钥匙、密钥行写未填写）", input: {props: {writable: true}}},
                {id: "use-tavily", label: "用 Tavily、两家都有密钥", input: {props: {writable: true}}},
                {id: "rules", label: "搜索规则（屏蔽了两个网站）", input: {props: {writable: true}}},
                {id: "advanced", label: "Tavily 改过接口地址与深度：高级默认展开", input: {props: {writable: true}}},
                {id: "use-tavily-no-key-english", label: "英文界面：使用中的 Tavily 还没有密钥", input: {props: {writable: true}}},
                {id: "use-tavily-no-key-narrow", label: "390px 宽：左栏换成下拉", input: {props: {writable: true}}},
                {id: "rules-english", label: "英文界面：搜索规则", input: {props: {writable: true}}},
                {id: "failed-english", label: "英文界面：检测没通过", input: {props: {writable: true}}},
                {id: "failed-narrow", label: "390px 宽：检测没通过", input: {props: {writable: true}}},
            ],
            load: async () => withWebText((await import("./SearchSettingsPageFixture.vue")).default),
        }),
        defineLabFixture<typeof ApiKeyField>({
            component: "ApiKeyField",
            scenes: [
                {id: "unset", label: "还没有填写", input: {props: {state: "unset", service: "DeepSeek"}}},
                {id: "set", label: "已设置（有“清除”）", input: {props: {state: "set", service: "DeepSeek"}}},
                {id: "loading", label: "读取中（停用）", input: {props: {state: "loading", service: "DeepSeek"}}},
                {id: "disabled", label: "停用", input: {props: {state: "set", service: "DeepSeek", disabled: true}}},
                {id: "english", label: "英文界面", input: {props: {state: "set", service: "DeepSeek"}}},
            ],
            load: async () => withWebText(createSubjectFixture<typeof ApiKeyField>((await import("nbook/plugins/web-tools/web/components/ApiKeyField.vue")).default)),
        }),
    ];
}

export const fixtures: LabFixture[] = [
    ...webToolsFixtures(),
];
