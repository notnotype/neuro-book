import {createSubjectFixture, defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type ProvidersPage from "nbook/plugins/models/web/components/ProvidersPage.vue";
import {withModelsText} from "./models-text";
import type RolesPage from "nbook/plugins/models/web/components/RolesPage.vue";
import type CapabilityIcons from "nbook/plugins/models/web/components/CapabilityIcons.vue";
import type HeadersEditor from "nbook/plugins/models/web/components/HeadersEditor.vue";
import type ModelRow from "nbook/plugins/models/web/components/ModelRow.vue";
import {SAMPLE_ROWS, sampleRow, SAMPLE_PROVIDERS, SAMPLE_TEMPLATES, generatedRows, SOURCE_AT, SAMPLE_DETECTION, SAMPLE_CANDIDATES} from "./sample";
import type ProviderRail from "nbook/plugins/models/web/components/ProviderRail.vue";
import type ProviderHeader from "nbook/plugins/models/web/components/ProviderHeader.vue";
import type ProviderIcon from "nbook/plugins/models/web/components/ProviderIcon.vue";
import type ProviderDetail from "nbook/plugins/models/web/components/ProviderDetail.vue";
import type ApiDetectResults from "nbook/plugins/models/web/components/ApiDetectResults.vue";
import type AllModelsView from "nbook/plugins/models/web/components/AllModelsView.vue";
import type AddProviderDialog from "nbook/plugins/models/web/components/AddProviderDialog.vue";
import type ManageModelsDialog from "nbook/plugins/models/web/components/ManageModelsDialog.vue";
import type ModelEditDialog from "nbook/plugins/models/web/components/ModelEditDialog.vue";


export const fixtures: LabFixture[] = [
    defineLabFixture<typeof ProvidersPage>({
        component: "ProvidersPage",
        scenes: [
            {id: "providers", label: "四家服务商：目录、改过地址、自定义、本机", input: {props: {writable: true}}},
            {id: "providers-empty", label: "还没有服务商（引导）", input: {props: {writable: true}}},
            {id: "providers-narrow", label: "560px 宽：左栏收成下拉", input: {props: {writable: true}}},
            {id: "providers-write-failed", label: "写不进去（窗口通知记进事件）", input: {props: {writable: true}}},
            {id: "providers-readonly", label: "模型服务没有运行（只读）", input: {props: {writable: true}}},
            {id: "providers-english", label: "英文界面", input: {props: {writable: true}}},
            {id: "providers-focus-key", label: "从对话的“设置密钥”打开：选中 OpenAI、焦点在密钥框", input: {props: {writable: true}}},
            {id: "providers-focus-add", label: "从对话的“添加服务商”打开：添加窗口开着", input: {props: {writable: true}}},
        ],
        load: async () => withModelsText((await import("./ModelsPageFixture.vue")).default),
    }),
    defineLabFixture<typeof RolesPage>({
        component: "RolesPage",
        scenes: [
            {id: "roles", label: "未绑定、没有密钥、自建角色", input: {props: {writable: true}}},
            {id: "roles-empty", label: "还没有模型，全部未绑定", input: {props: {writable: true}}},
            {id: "roles-readonly", label: "模型服务没有运行（只读）", input: {props: {writable: true}}},
            {id: "roles-english", label: "英文界面", input: {props: {writable: true}}},
            {id: "roles-focus", label: "从对话的“去绑定”打开：滚到“润色”、焦点在它的模型下拉", input: {props: {writable: true}}},
        ],
        load: async () => withModelsText((await import("./ModelsPageFixture.vue")).default),
    }),
    defineLabFixture<typeof CapabilityIcons>({
        component: "CapabilityIcons",
        scenes: [
            {id: "all", label: "看图与推理（悬停写推理档）", input: {props: {vision: true, reasoning: true, efforts: ["low", "medium", "high"]}}},
            {id: "vision", label: "只能看图", input: {props: {vision: true, reasoning: false}}},
            {id: "none", label: "都没有（什么都不画）", input: {props: {vision: false, reasoning: false}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof CapabilityIcons>((await import("nbook/plugins/models/web/components/CapabilityIcons.vue")).default)),
    }),
    defineLabFixture<typeof HeadersEditor>({
        component: "HeadersEditor",
        scenes: [
            {id: "filled", label: "两行请求头", input: {props: {headers: {"X-Team": "writing", "X-Region": "cn"}, hint: "中转站、网关常要"}}},
            {id: "credential", label: "名称像凭据、值不是 env:（提示）", input: {props: {headers: {"X-Api-Key": "abc"}}}},
            {id: "empty", label: "没有请求头", input: {props: {headers: {}}}},
            {id: "english", label: "英文界面", input: {props: {headers: {"X-Team": "writing"}}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof HeadersEditor>((await import("nbook/plugins/models/web/components/HeadersEditor.vue")).default, {events: ["commit"], writeBack: {commit: {layer: "props", key: "headers"}}, class: "w-full max-w-[520px]"})),
    }),
    defineLabFixture<typeof ModelRow>({
        component: "ModelRow",
        scenes: [
            {id: "enabled", label: "启用、带角色小标、检测通过", input: {props: {model: SAMPLE_ROWS.deepseek![0]!, roles: ["快速", "压缩"], check: {status: "done", at: 0, result: {ok: true}}}}},
            {id: "failed", label: "检测失败（点开看原因）", input: {props: {model: SAMPLE_ROWS.anthropic![0]!, check: {status: "done", at: 0, result: {ok: false, kind: "auth", code: "401", raw: "{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\"}}"}}}}},
            {id: "running", label: "检测中", input: {props: {model: SAMPLE_ROWS.volcengine![0]!, check: {status: "running"}}}},
            {id: "unknown", label: "结果未知（检测被取消，请求可能已经发出）", input: {props: {model: SAMPLE_ROWS.volcengine![0]!, check: {status: "unknown", at: 0}}}},
            {id: "incomplete", label: "缺上下文窗口（开关停用）", input: {props: {model: SAMPLE_ROWS.volcengine![2]!}}},
            {id: "edited", label: "来源模型改过字段（标“已改”）", input: {props: {model: SAMPLE_ROWS.deepseek![1]!}}},
            {id: "missing", label: "目录里没有了", input: {props: {model: SAMPLE_ROWS.anthropic![1]!}}},
            {id: "free", label: "免费的本机模型", input: {props: {model: SAMPLE_ROWS.ollama![0]!}}},
            {id: "unlisted", label: "服务商列表里没有、配置过：照用、标“列表里没有”", input: {props: {model: sampleRow("deepseek-v4-flash", {name: "DeepSeek V4 Flash", unlisted: true}), roles: ["快速"]}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof ModelRow>((await import("nbook/plugins/models/web/components/ModelRow.vue")).default, {events: ["toggle", "check", "edit"], class: "w-full list-none"})),
    }),
    defineLabFixture<typeof ProviderRail>({
        component: "ProviderRail",
        scenes: [
            {id: "providers", label: "当前是第一家；第二行写密钥问题或模型数", input: {props: {providers: SAMPLE_PROVIDERS, current: "deepseek"}}},
            {id: "all", label: "当前是“全部模型”", input: {props: {providers: SAMPLE_PROVIDERS, current: "all"}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof ProviderRail>((await import("nbook/plugins/models/web/components/ProviderRail.vue")).default, {events: ["select", "add"], writeBack: {select: {layer: "props", key: "current"}}, class: "h-[420px]"})),
    }),
    defineLabFixture<typeof ProviderHeader>({
        component: "ProviderHeader",
        scenes: [
            {id: "default", label: "模板的图标、名称与“复制一份”", input: {props: {provider: SAMPLE_PROVIDERS[0]!, builtinKeys: ["anthropic", "deepseek", "moonshot", "openai", "openrouter"]}}},
            {id: "initial", label: "空白模板：首字母块", input: {props: {provider: SAMPLE_PROVIDERS[2]!, builtinKeys: ["anthropic", "deepseek", "moonshot"]}}},
            {id: "custom-icon", label: "选过内置图标（面板里有“恢复模板的图标”）", input: {props: {provider: {...SAMPLE_PROVIDERS[3]!, icon: {kind: "builtin", key: "openai"}}, builtinKeys: ["anthropic", "deepseek", "openai"]}}},
            {id: "icon-error", label: "换图标失败（面板里写原因）", input: {props: {provider: SAMPLE_PROVIDERS[0]!, builtinKeys: ["deepseek"], iconError: "服务端没有接受这张图：the image was rejected (too-large)"}}},
            {id: "long-name", label: "名称很长（省略号截断）", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, name: "这是一个名字特别特别长的服务商名称用来看标题区在窄屏下怎么处理"}, builtinKeys: []}}},
            {id: "english", label: "英文界面", input: {props: {provider: SAMPLE_PROVIDERS[4]!, builtinKeys: ["moonshot"]}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof ProviderHeader>((await import("nbook/plugins/models/web/components/ProviderHeader.vue")).default, {events: ["rename", "set-icon", "duplicate"], class: "w-full max-w-[560px]"})),
    }),
    defineLabFixture<typeof ProviderIcon>({
        component: "ProviderIcon",
        scenes: [
            {id: "template", label: "跟随模板的图标", input: {props: {icon: null, template: "deepseek", name: "DeepSeek", size: 28}}},
            {id: "initial", label: "首字母块", input: {props: {icon: {kind: "initial"}, template: "deepseek", name: "火山方舟", size: 28}}},
            {id: "unknown", label: "图标表里没有的模板", input: {props: {icon: null, template: "blank-openai", name: "本地 Ollama", size: 28}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof ProviderIcon>((await import("nbook/plugins/models/web/components/ProviderIcon.vue")).default, {class: "p-4"})),
    }),
    defineLabFixture<typeof ProviderDetail>({
        component: "ProviderDetail",
        scenes: [
            {id: "catalog", label: "模板服务商，密钥已设置，系列默认收起", input: {props: {provider: SAMPLE_PROVIDERS[0]!, rows: SAMPLE_ROWS.deepseek!}}},
            {id: "overridden", label: "改过地址与协议（有“恢复模板地址”），环境变量没有值", input: {props: {provider: SAMPLE_PROVIDERS[1]!, rows: SAMPLE_ROWS.anthropic!}}},
            {id: "custom", label: "空白模板：接口格式、请求头、缺字段的模型", input: {props: {provider: SAMPLE_PROVIDERS[2]!, rows: SAMPLE_ROWS.volcengine!}}},
            {id: "keyless", label: "不要认证的本机端点（没有密钥框）", input: {props: {provider: SAMPLE_PROVIDERS[5]!, rows: SAMPLE_ROWS.ollama!}}},
            {id: "no-key", label: "还没有密钥（“未设置”）", input: {props: {provider: SAMPLE_PROVIDERS[3]!, rows: SAMPLE_ROWS.openai!}}},
            {id: "env-found", label: "有地区的模板：选了中国大陆，密钥取环境变量、已读到", input: {props: {provider: SAMPLE_PROVIDERS[4]!, rows: SAMPLE_ROWS.moonshot!, template: SAMPLE_TEMPLATES.find((item) => item.id === "moonshot")!}}},
            {id: "check-error", label: "没检成（原因写在模型列表头上）", input: {props: {provider: SAMPLE_PROVIDERS[0]!, rows: SAMPLE_ROWS.deepseek!, checkError: "没检成：模型服务没有运行"}}},
            {id: "big", label: "几百个模型：有搜索框，系列默认收起、收起的不渲染", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, modelCount: 600, enabledCount: 600}, rows: generatedRows(600)}}},
            {id: "loading", label: "模型行读取中", input: {props: {provider: SAMPLE_PROVIDERS[0]!, rows: [], rowsLoading: true}}},
            {id: "rows-failed", label: "读取模型失败（可重试）", input: {props: {provider: SAMPLE_PROVIDERS[0]!, rows: [], rowsFailure: "服务没有回应"}}},
            {id: "english", label: "英文界面", input: {props: {provider: SAMPLE_PROVIDERS[2]!, rows: SAMPLE_ROWS.volcengine!}}},
            {id: "source-ok", label: "服务商的列表：更新于某时、可重新拉取", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, source: {state: "ok", refreshing: false, checkedAt: SOURCE_AT, error: null}}, rows: SAMPLE_ROWS.deepseek!}}},
            {id: "source-refreshing", label: "正在拉取（按钮停用）", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, source: {state: "ok", refreshing: true, checkedAt: SOURCE_AT, error: null}}, rows: SAMPLE_ROWS.deepseek!}}},
            {id: "source-failed", label: "拉取失败，沿用上一次的列表", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, source: {state: "ok", refreshing: false, checkedAt: SOURCE_AT, error: {reason: "auth", message: "401"}}}, rows: SAMPLE_ROWS.deepseek!}}},
            {id: "source-changed", label: "改过地址或凭据：要重新拉取", input: {props: {provider: {...SAMPLE_PROVIDERS[1]!, source: {state: "changed", refreshing: false, checkedAt: null, error: null}}, rows: SAMPLE_ROWS.anthropic!}}},
            {id: "source-failed-english", label: "拉取失败，英文界面", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, source: {state: "ok", refreshing: false, checkedAt: SOURCE_AT, error: {reason: "bad-response", message: "503"}}}, rows: SAMPLE_ROWS.deepseek!}}},
            {id: "detect-done", label: "检测协议的结果在接口格式下面", input: {props: {provider: {...SAMPLE_PROVIDERS[2]!, connection: "c1"}, rows: SAMPLE_ROWS.volcengine!, detect: {status: "done", detection: SAMPLE_DETECTION}}}},
            {id: "detect-done-english", label: "检测协议的结果，英文界面", input: {props: {provider: {...SAMPLE_PROVIDERS[2]!, connection: "c1"}, rows: SAMPLE_ROWS.volcengine!, detect: {status: "done", detection: SAMPLE_DETECTION}}}},
            {id: "detect-running", label: "检测进行中（按钮换成“取消协议检测”）", input: {props: {provider: SAMPLE_PROVIDERS[2]!, rows: SAMPLE_ROWS.volcengine!, detect: {status: "running"}}}},
            {id: "check-run", label: "检测全部进行中：已检 N / 共 M", input: {props: {provider: SAMPLE_PROVIDERS[0]!, rows: SAMPLE_ROWS.deepseek!, checkRun: {done: 3, total: 24}}}},
            {id: "proxy-custom", label: "高级里的代理：自定义地址（展开“高级”看）", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, proxy: {mode: "custom", url: "http://127.0.0.1:7890"}}, rows: SAMPLE_ROWS.deepseek!}}},
            {id: "proxy-direct-english", label: "高级里的代理：直连，英文界面", input: {props: {provider: {...SAMPLE_PROVIDERS[0]!, proxy: {mode: "direct"}}, rows: SAMPLE_ROWS.deepseek!}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof ProviderDetail>((await import("nbook/plugins/models/web/components/ProviderDetail.vue")).default, {events: ["set-key", "clear-key", "update", "toggle-model", "check", "check-all", "cancel-checks", "edit-model", "add-model", "manage", "reload-rows", "refresh-source", "detect", "cancel-detect", "adopt"], class: "w-full"})),
    }),
    defineLabFixture<typeof ApiDetectResults>({
        component: "ApiDetectResults",
        scenes: [
            {id: "done", label: "四行结果：当前的标“正在用”，通过的“用这个”，失败的可复制原文", input: {props: {state: {status: "done", detection: SAMPLE_DETECTION}, connection: "c1"}}},
            {id: "adopted", label: "改用 Responses 之后：结果仍有效，“正在用”跟着换", input: {props: {state: {status: "done", detection: SAMPLE_DETECTION}, connection: "c-responses"}}},
            {id: "stale", label: "配置已改：整块置灰、请重新检测", input: {props: {state: {status: "done", detection: SAMPLE_DETECTION}, connection: "changed"}}},
            {id: "mixed", label: "混合协议的模板跟随中：哪一行都不是“正在用”，结果仍有效", input: {props: {state: {status: "done", detection: {...SAMPLE_DETECTION, connection: "c-follow"}}, connection: "c-follow"}}},
            {id: "running", label: "检测进行中", input: {props: {state: {status: "running"}, connection: "c1"}}},
            {id: "no-model", label: "没有能用来检测的模型：填一个模型 id", input: {props: {state: {status: "failed", code: "no-model", reason: "没有能用来检测的模型"}, connection: "c1"}}},
            {id: "failed", label: "没检成（原因红字）", input: {props: {state: {status: "failed", code: "unknown-provider", reason: "这家服务商已经不在了"}, connection: "c1"}}},
            {id: "done-english", label: "英文界面", input: {props: {state: {status: "done", detection: SAMPLE_DETECTION}, connection: "c1"}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof ApiDetectResults>((await import("nbook/plugins/models/web/components/ApiDetectResults.vue")).default, {events: ["adopt", "detect"], class: "w-full max-w-[560px]"})),
    }),
    defineLabFixture<typeof AllModelsView>({
        component: "AllModelsView",
        scenes: [
            {id: "models", label: "每家一节，默认收起（已读到各家的行）", input: {props: {providers: SAMPLE_PROVIDERS, rows: SAMPLE_ROWS}}},
            {id: "empty", label: "没有启用的模型", input: {props: {providers: []}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof AllModelsView>((await import("nbook/plugins/models/web/components/AllModelsView.vue")).default, {events: ["edit", "load"], class: "w-full"})),
    }),
    defineLabFixture<typeof AddProviderDialog>({
        component: "AddProviderDialog",
        scenes: [
            {id: "templates", label: "分组多列：已添加（可再加一份）、不要密钥、要登录", input: {model: {open: true}, props: {templates: SAMPLE_TEMPLATES, added: ["deepseek", "anthropic"]}}},
            {id: "loading", label: "模板表还在读", input: {model: {open: true}, props: {templates: null}}},
            {id: "english", label: "英文界面", input: {model: {open: true}, props: {templates: SAMPLE_TEMPLATES, added: ["deepseek"]}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof AddProviderDialog>((await import("nbook/plugins/models/web/components/AddProviderDialog.vue")).default, {events: ["update:open", "add"], writeBack: {"update:open": {layer: "model", key: "open"}}})),
    }),
    defineLabFixture<typeof ManageModelsDialog>({
        component: "ManageModelsDialog",
        scenes: [
            {id: "discovered", label: "服务商的列表：已加入、要补字段、类型不明一组", input: {model: {open: true}, props: {providerName: "火山方舟", candidates: SAMPLE_CANDIDATES, current: ["doubao-seed-2-0-pro"]}}},
            {id: "loading", label: "还在读", input: {model: {open: true}, props: {providerName: "火山方舟", candidates: null, current: []}}},
            {id: "failed", label: "读取失败", input: {model: {open: true}, props: {providerName: "火山方舟", candidates: null, current: [], error: "读取模型失败：服务没有回应"}}},
            {id: "english", label: "英文界面", input: {model: {open: true}, props: {providerName: "Volcengine", candidates: SAMPLE_CANDIDATES, current: ["doubao-seed-2-0-pro"]}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof ManageModelsDialog>((await import("nbook/plugins/models/web/components/ManageModelsDialog.vue")).default, {events: ["update:open", "done"], writeBack: {"update:open": {layer: "model", key: "open"}}})),
    }),
    defineLabFixture<typeof ModelEditDialog>({
        component: "ModelEditDialog",
        scenes: [
            {id: "manual", label: "手动添加的模型（都能改）", input: {model: {open: true}, props: {model: SAMPLE_ROWS.volcengine![0]!}}},
            {id: "source", label: "来源模型：改过的字段标“已改”、可恢复来源值", input: {model: {open: true}, props: {model: SAMPLE_ROWS.deepseek![1]!}}},
            {id: "add", label: "手动添加", input: {model: {open: true}, props: {model: null, takenIds: ["doubao-seed-2-0-pro"]}}},
            {id: "error", label: "保存失败（页脚写原因）", input: {model: {open: true}, props: {model: SAMPLE_ROWS.volcengine![1]!, error: "设置文件有错或写不进去，先修好设置文件"}}},
        ],
        load: async () => withModelsText(createSubjectFixture<typeof ModelEditDialog>((await import("nbook/plugins/models/web/components/ModelEditDialog.vue")).default, {events: ["update:open", "save"], writeBack: {"update:open": {layer: "model", key: "open"}}})),
    }),
];
