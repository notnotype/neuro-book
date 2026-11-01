/**
 * 设置场景的数据：产品里真实的配置项（主题、明暗、界面语言）与外观分区，加几个示例插件的配置项与 page 分区，覆盖通用列表
 * 的每种控件、“其它”分区与 page 的两种排法。每个场景按 id 给出各层的初始内容、标签与要交付的页面。
 */

import {computed, defineComponent, h, ref} from "vue";

import {settingsChoicesEvent, settingsPageEvent} from "nbook/plugins/settings/shared/contracts";
import type {Component} from "vue";

import {APPEARANCE_SECTION, APPEARANCE_SECTION_DECLARATION, localeSetting} from "nbook/plugins/settings/shared/contracts";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {appearanceSetting, themeSetting} from "nbook/plugins/workbench/shared/contracts";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";

import SampleModelsPage from "./SampleModelsPage.vue";
import SampleSnippetsPage from "./SampleSnippetsPage.vue";
import {MODELS_PROVIDER, MODELS_SECTION, modelChoice, modelsSettings, notesSettings, SNIPPETS_SECTION, snippetsSettings, TEMPLATES_PROVIDER} from "./scene-settings";
import type {SettingsWindowSceneId} from "./scene-settings";
import {createSettingsHost} from "./settings-host";
import type {HostLayer, HostSection, SettingsHost} from "./settings-host";

type SceneSetting = {readonly plugin: string; readonly definition: SettingDefinition<unknown>};

/** 场景里已接受的全部配置项：产品的三项加示例插件的。 */
export const SCENE_SETTINGS: ReadonlyArray<SceneSetting> = [
    {plugin: "nbook.workbench", definition: themeSetting},
    {plugin: "nbook.workbench", definition: appearanceSetting},
    {plugin: "nbook.settings", definition: localeSetting},
    ...Object.values(notesSettings).map((definition) => ({plugin: "example.notes", definition})),
    ...Object.values(snippetsSettings).map((definition) => ({plugin: "example.snippets", definition})),
    ...Object.values(modelsSettings).map((definition) => ({plugin: "example.models", definition})),
] as ReadonlyArray<SceneSetting>;

const SECTIONS: ReadonlyArray<HostSection> = [
    {id: APPEARANCE_SECTION, plugin: "nbook.settings", kind: "list", declaration: APPEARANCE_SECTION_DECLARATION},
    {id: MODELS_SECTION, plugin: "example.models", declaration: {title: {"zh-CN": "模型服务", "en-US": "Model Providers"}, description: {"zh-CN": "写作助手用的模型与服务商", "en-US": "Models and providers used by the assistant"}, icon: "i-lucide-server", category: "ai", layout: "fill", layers: ["user"], keywords: [{"zh-CN": "API Key", "en-US": "API key"}, {"zh-CN": "大模型", "en-US": "LLM"}]}, kind: "page"},
    {id: SNIPPETS_SECTION, plugin: "example.snippets", declaration: {title: {"zh-CN": "常用片段", "en-US": "Snippets"}, description: {"zh-CN": "写作时常用的固定文字", "en-US": "Fixed text you insert often"}, icon: "i-lucide-text-quote", category: "plugins"}, kind: "page"},
];

/** 模板库的选项；“已不存在”的场景里当前值是库里删掉的“旧版周记”。 */
const TEMPLATES = [
    {value: "diary", label: {"zh-CN": "日记", "en-US": "Diary"}},
    {value: "scene", label: {"zh-CN": "场景卡", "en-US": "Scene Card"}, description: {"zh-CN": "时间、地点、人物、冲突", "en-US": "Time, place, people, conflict"}},
    {value: "character", label: {"zh-CN": "人物卡", "en-US": "Character Card"}},
];

/** “模型服务”的示例服务商；API Key 是写着玩的占位文字。 */
const SAMPLE_PROVIDERS = [
    {id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", timeout: 60, apiKey: "示例密钥-不要用", models: ["deepseek-chat", "deepseek-reasoner"]},
    {id: "local", name: "本地 Ollama", baseUrl: "http://127.0.0.1:11434/v1", timeout: 120, apiKey: "", models: ["qwen3:8b"]},
];

/** “设置文件”场景里用户层的文件：带注释、有一个没有声明的键（别的插件卸载后留下的）。 */
const USER_FILE_TEXT = "// 我的设置\n{\n    // 主题跟着 macOS\n    \"nbook.workbench/theme\": \"macos\",\n    \"example.notes/interval\": 120,\n    \"retired.plugin/flag\": true\n}\n";

/** “设置文件（有错）”场景里用户层的文件：第 3 行少了逗号。 */
const BROKEN_FILE_TEXT = "{\n    \"nbook.workbench/theme\": \"macos\"\n    \"example.notes/interval\": 120\n}\n";

/** 按需激活的场景里，提供者入口收到触发之后过一会儿才交付：看得见“加载中”。 */
const LAZY_DELIVERY_MS = 800;

/** 场景里那部作品的书名与项目层文件的位置。 */
export const SCENE_BOOK = "雾港";
export const SCENE_PROJECT_FILE = "/home/writer/Documents/NeuroBook/雾港/.nbook/settings.json";

interface SceneSpec {
    readonly user?: HostLayer;
    readonly project?: HostLayer;
    readonly section: string;
    readonly layer?: "user" | "project";
    /** 打开后立即搜索的词（搜索结果的场景）。 */
    readonly query?: string;
    /** 只在这个场景里多登记的分区。 */
    readonly extraSections?: ReadonlyArray<HostSection>;
}

/** 左栏装不下的两个标题（176px 宽），中英文各一个：截断后悬停显示全名。 */
const LONG_TITLE_SECTIONS: ReadonlyArray<HostSection> = [
    {id: "example.snippets.long-zh", plugin: "example.snippets", kind: "page", declaration: {title: {"zh-CN": "人物关系、世界观与时间线的一致性检查", "en-US": "Character and World Consistency"}, icon: "i-lucide-users", category: "plugins"}},
    {id: "example.snippets.long-en", plugin: "example.snippets", kind: "page", declaration: {title: {"zh-CN": "Manuscript Export Presets", "en-US": "Manuscript Export Presets"}, icon: "i-lucide-file-output", category: "plugins"}},
];

const BOOK = {values: {"nbook.workbench/appearance": "light"}} satisfies HostLayer;

const SPECS: Readonly<Record<SettingsWindowSceneId, SceneSpec>> = {
    "user": {user: {values: {"nbook.workbench/appearance": "system"}}, project: BOOK, section: APPEARANCE_SECTION},
    "project": {user: {values: {"nbook.workbench/appearance": "system"}}, project: BOOK, section: APPEARANCE_SECTION, layer: "project"},
    "unbound": {user: {values: {"nbook.workbench/theme": "macos"}}, section: APPEARANCE_SECTION},
    "user-invalid": {user: {values: {"nbook.workbench/appearance": "dark"}, invalid: "第 3 行：缺少逗号"}, project: BOOK, section: APPEARANCE_SECTION},
    "project-invalid": {user: {}, project: {...BOOK, invalid: "第 2 行：同一个键出现了两次", path: SCENE_PROJECT_FILE}, section: APPEARANCE_SECTION, layer: "project"},
    "unreachable": {user: {}, project: {...BOOK, unreachable: true}, section: APPEARANCE_SECTION, layer: "project"},
    "write-failed": {user: {values: {"nbook.workbench/theme": "macos"}}, section: APPEARANCE_SECTION},
    "other": {user: {values: {"example.notes/interval": 120, "example.notes/signature": "——写于雾港"}}, project: {values: {"example.notes/autosave": false}}, section: "other"},
    "choices": {user: {values: {"example.notes/template": "weekly"}}, section: "other"},
    "choices-lazy": {user: {values: {"example.notes/template": "scene"}}, section: "other"},
    "choices-unavailable": {user: {}, section: "other"},
    "file": {user: {values: {"nbook.workbench/theme": "macos", "example.notes/interval": 120}, text: USER_FILE_TEXT}, project: BOOK, section: "file"},
    "file-invalid": {user: {values: {"nbook.workbench/theme": "macos"}, text: BROKEN_FILE_TEXT}, project: BOOK, section: "file"},
    "search": {user: {values: {"nbook.workbench/appearance": "system"}}, project: BOOK, section: APPEARANCE_SECTION, query: "字"},
    "page-declared": {project: BOOK, section: SNIPPETS_SECTION},
    "page-blocked": {project: BOOK, section: SNIPPETS_SECTION},
    "page-failed": {project: BOOK, section: SNIPPETS_SECTION},
    "page-stopped": {project: BOOK, section: SNIPPETS_SECTION},
    "page-load-failed": {project: BOOK, section: SNIPPETS_SECTION},
    "page-column": {user: {values: {"example.snippets/items": [{name: "旁白", text: "雾从港口漫上来。"}, {name: "落款", text: "——写于雾港"}]}}, project: {values: {"example.snippets/autoInsert": true}}, section: SNIPPETS_SECTION},
    "page-fill": {user: {values: {"example.models/effort": "high", "example.models/providers": SAMPLE_PROVIDERS, "example.models/defaultModel": modelChoice("deepseek", "deepseek-chat")}}, project: BOOK, section: MODELS_SECTION},
    "long-titles": {project: BOOK, section: APPEARANCE_SECTION, extraSections: LONG_TITLE_SECTIONS},
};

/** 页面组件：插件的页面在自己的激活里拿到自己的配置服务，这里同样在交付时绑定。 */
function page(component: Component, settings: SettingsService): Component {
    return defineComponent({
        name: "LabSettingsPage",
        props: {context: {type: Object as () => SettingsPageContext, required: true}},
        setup: (props) => () => h(component, {context: props.context, settings}),
    });
}

export interface SettingsScene {
    readonly host: SettingsHost;
    /** 打开窗口到场景的分区与标签。 */
    open(): void;
    /** 再次交付 page 分区（撤回、加载失败的场景用）。 */
    deliver(): void;
}

export function createSettingsScene(id: SettingsWindowSceneId, notify: (input: NotificationInput) => void, report: (message: string) => void): SettingsScene {
    const spec = SPECS[id];
    const host = createSettingsHost({
        settings: SCENE_SETTINGS,
        sections: [...SECTIONS, ...(spec.extraSections ?? [])],
        ...(spec.user === undefined ? {} : {user: spec.user}),
        ...(spec.project === undefined ? {} : {project: spec.project}),
        projectTitle: SCENE_BOOK,
        choices: [{id: TEMPLATES_PROVIDER, plugin: "example.notes"}, {id: MODELS_PROVIDER, plugin: "example.models"}],
        activationEvents: {
            "example.notes": [settingsChoicesEvent(TEMPLATES_PROVIDER)],
            "example.models": [settingsPageEvent(MODELS_SECTION), settingsChoicesEvent(MODELS_PROVIDER)],
        },
        notify,
        report,
    });
    const templates = () => ref({status: "ready" as const, items: TEMPLATES});
    // 模型服务的入口一次交付页面与选项提供者；选项是已保存的服务商的模型（同产品里插件在自己的激活里读自己的配置）。
    const models = host.service("example.models");
    const deliverModels = (): void => {
        host.publish(MODELS_SECTION, async () => page(SampleModelsPage, models));
        host.publishChoices(MODELS_PROVIDER, () => computed(() => ({
            status: "ready" as const,
            items: models.get(modelsSettings.providers).flatMap((provider) => (provider.models ?? []).map((name) => ({value: modelChoice(provider.id, name), label: `${provider.name} / ${name}`}))),
        })));
    };
    const triggered = new Set<string>();
    host.onTrigger((event) => {
        if (id === "choices-lazy" && event === settingsChoicesEvent(TEMPLATES_PROVIDER)) {
            host.pluginEntry("example.notes", "activating");
            setTimeout(() => host.publishChoices(TEMPLATES_PROVIDER, templates), LAZY_DELIVERY_MS);
        }
        // 模型服务按需激活：页面或它的选项先被要到时交付，只交付一次。
        if ((event === settingsPageEvent(MODELS_SECTION) || event === settingsChoicesEvent(MODELS_PROVIDER)) && !triggered.has("models")) {
            triggered.add("models");
            deliverModels();
        }
    });
    if (id === "choices-lazy") host.pluginEntry("example.notes", "registered");
    else if (id === "choices-unavailable") host.pluginEntry("example.notes", "failed", "模板库读不到：权限不足");
    else host.publishChoices(TEMPLATES_PROVIDER, templates);
    const deliver = (): void => {
        host.publish(SNIPPETS_SECTION, async () => page(SampleSnippetsPage, host.service("example.snippets")));
        // 模型服务的入口只在打开它的分区（或要它的选项）时才激活，见上面的触发。
    };
    host.pluginEntry("example.models", "registered");
    // “重试”：入口恢复、重新激活后交付。
    host.onRetry(async () => {
        deliver();
        return {status: "activated"};
    });
    if (id === "write-failed") host.user.failWrites("write-failed");
    if (id === "page-declared") host.entry(SNIPPETS_SECTION, "activating");
    else if (id === "page-blocked") host.entry(SNIPPETS_SECTION, "blocked", "nbook.files/files");
    else if (id === "page-failed") host.entry(SNIPPETS_SECTION, "failed", "读不到片段库：权限不足");
    else if (id === "page-load-failed") host.publish(SNIPPETS_SECTION, async () => {
        throw new Error("页面模块下载失败");
    });
    else {
        deliver();
        if (id === "page-stopped") host.revoke(SNIPPETS_SECTION, "scope-closed");
    }
    return {
        host,
        open: () => {
            host.window.openWindow({section: spec.section, ...(spec.layer === undefined ? {} : {layer: spec.layer})});
            if (spec.query !== undefined) host.window.search(spec.query);
        },
        deliver,
    };
}
