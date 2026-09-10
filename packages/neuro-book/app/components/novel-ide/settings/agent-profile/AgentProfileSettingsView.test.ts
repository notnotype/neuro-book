// @vitest-environment jsdom
import {createApp, defineComponent, h, nextTick, ref} from "vue";
import type {App} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {AgentProfileSettingsContext, AgentProfileSettingsPageDraft} from "./AgentProfileSettingsView.types";
import AgentProfileSettingsView from "./AgentProfileSettingsView.vue";
import type {AgentProfileModelConfigDto} from "nbook/shared/dto/app-settings.dto";
import type {ProfileRuntimeSettingsDto} from "nbook/shared/dto/config.dto";
import {createProfileRuntimeSettingsDraft} from "./profile-runtime-settings";

const mounted: App[] = [];

const harnessRuntime: ProfileRuntimeSettingsDto = {
    summarizer: {
        enabled: true,
        profileKey: "summarizer.default",
        trigger: "afterInvocation",
        interval: {kind: "sourceInvocation", value: 20},
        maxDialogueContentTokens: 4096,
    },
    compaction: {
        enabled: true,
        trigger: {kind: "autoReserve"},
        reserveTokens: 16_384,
        keepRecent: {kind: "percent", value: 0.25},
        prompt: "请压缩以下对话内容，保留关键事实。",
        summaryPrefix: "[摘要]",
    },
    fileChangeNotice: {diffMaxChars: 2048},
};

const modelDefaults: AgentProfileModelConfigDto = {
    modelKey: null,
    temperature: 0.2,
    topK: 20,
    reasoningEffort: "off",
    stream: true,
};

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({
        t: (key: string) => ({
            "settings.panels.profileModels.nav.defaults": "默认设置",
            "settings.panels.profileModels.settingsView.temperatureInvalid": "温度错误",
            "settings.panels.profileModels.settingsView.topkInvalid": "TopK 错误",
            "settings.panels.profileModels.settingsView.advancedModel": "高级模型参数",
            "settings.panels.profileModels.settingsView.savingHint": "保存中…",
            "common.cancel": "取消",
            "common.confirm": "确定",
        }[key] ?? key),
    }));
});

afterEach(() => {
    for (const app of mounted.splice(0)) app.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

function profileMetadata() {
    return {
        profileKey: "writer",
        name: "故事写手",
        canResetHome: false,
        model: modelDefaults,
        loadStatus: "loaded" as const,
        hasSettingsForm: false,
        runtime: {
            profileDefaults: {},
            effective: harnessRuntime,
            globalDefaultsPatch: {},
            globalProfilePatch: {},
            projectDefaultsPatch: {},
            projectProfilePatch: {},
        },
        issue: null,
        sourcePath: null,
        buildState: {running: false, queued: false, reason: null, updatedAt: null},
        settings: null,
    };
}

function context(): AgentProfileSettingsContext {
    return {
        scope: "global",
        inheritedDefaultProfileKey: "writer",
        globalModelDefaults: modelDefaults,
        globalProfileModels: {},
        settings: {
            enabledModels: [],
            validationIssues: [],
            profileModelDefaults: modelDefaults,
            harnessRuntimeDefaults: harnessRuntime,
            profileRuntimeDefaults: harnessRuntime,
            globalRuntimeDefaultsPatch: {},
            projectRuntimeDefaultsPatch: {},
            agentProfiles: [profileMetadata()],
        },
        descriptions: {writer: "负责章节初稿的连续写作。"},
    };
}

function pageDraft(temperature: string, topK: string): AgentProfileSettingsPageDraft {
    return {
        defaultProfileKey: "",
        modelDefaults: {
            modelKey: null,
            temperature: "",
            topK: "",
            reasoningEffort: "off",
            stream: true,
        },
        runtimeDefaults: createProfileRuntimeSettingsDraft(undefined),
        profiles: [{
            profileKey: "writer",
            name: "故事写手",
            canResetHome: false,
            model: {modelKey: null, temperature, topK, reasoningEffort: null, stream: null},
            loadStatus: "loaded",
            runtime: createProfileRuntimeSettingsDraft(undefined),
            runtimeEffective: harnessRuntime,
            runtimeSources: {
                summarizerEnabled: "harness", summarizerProfileKey: "harness", summarizerIntervalKind: "harness", summarizerIntervalValue: "harness", summarizerMaxTokens: "harness",
                compactionEnabled: "harness", compactionTriggerKind: "harness", compactionTriggerValue: "harness", compactionReserveTokens: "harness",
                compactionKeepRecentKind: "harness", compactionKeepRecentValue: "harness", compactionPrompt: "harness", compactionSummaryPrefix: "harness", fileChangeDiffMaxChars: "harness",
            },
            runtimeErrors: {},
            issue: null,
            sourcePath: null,
            buildState: {running: false, queued: false, reason: null, updatedAt: null},
            settings: null,
        }],
    };
}


type MountedView = {
    host: HTMLElement;
    app: App;
    updates: AgentProfileSettingsPageDraft[];
};

function mountView(initial: AgentProfileSettingsPageDraft, showNavHeading = true): MountedView {
    const host = document.createElement("div");
    document.body.append(host);
    const updates: AgentProfileSettingsPageDraft[] = [];
    const modelValue = ref(initial);
    const app = createApp(defineComponent({
        setup() {
            return () => h(AgentProfileSettingsView, {
                modelValue: modelValue.value,
                context: context(),
                showNavHeading,
                loading: false,
                saving: false,
                loadError: "",
                saveError: "",
                "onUpdate:modelValue": (value: AgentProfileSettingsPageDraft) => {
                    updates.push(value);
                    modelValue.value = value;
                },
            });
        },
    }));
    mounted.push(app);
    app.mount(host);
    return {host, app, updates};
}

describe("AgentProfileSettingsView 模型校验链路", () => {
    it("点击默认设置后把非法 temperature/TopK 传到真实字段链路并把字段标为非法", async () => {
        const modelValue = pageDraft("", "");
        modelValue.modelDefaults = {...modelValue.modelDefaults, temperature: "-1", topK: "2.5"};
        const mountedView = mountView(modelValue);
        const host = mountedView.host;
        await nextTick();
        await nextTick();

        const defaultsButton = [...host.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => button.textContent?.includes("默认设置"));
        expect(defaultsButton).toBeDefined();
        defaultsButton!.click();
        await nextTick();
        await nextTick();

        const trigger = [...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")]
            .find((button) => button.textContent?.includes("高级模型参数"));
        const numberInputs = [...host.querySelectorAll<HTMLInputElement>("input[type='number']")];

        expect(trigger?.getAttribute("aria-expanded")).toBe("true");
        expect(host.textContent).toContain("温度错误");
        expect(host.textContent).toContain("TopK 错误");
        expect(numberInputs).toHaveLength(2);
        expect(numberInputs.every((input) => input.getAttribute("aria-invalid") === "true")).toBe(true);
    });
});

describe("AgentProfileSettingsView 就地保存", () => {
    it("没有保存/放弃按钮，字段修改即时向上发出", async () => {
        const mountedView = mountView(pageDraft("", ""));
        const host = mountedView.host;
        await nextTick();
        await nextTick();

        const labels = [...host.querySelectorAll<HTMLButtonElement>("button")].map((button) => button.textContent ?? "");
        expect(labels.some((text) => text.includes("保存修改"))).toBe(false);
        expect(labels.some((text) => text.includes("放弃修改"))).toBe(false);

        const defaults = [...host.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => button.textContent?.includes("默认设置"));
        expect(defaults).toBeDefined();
        defaults!.click();
        await nextTick();
        await nextTick();

        const advanced = [...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")]
            .find((button) => button.textContent?.includes("高级模型参数"));
        expect(advanced).toBeDefined();
        advanced!.click();
        await vi.waitFor(() => expect(advanced!.getAttribute("aria-expanded")).toBe("true"));

        const temperature = host.querySelector<HTMLInputElement>("input[type='number']");
        expect(temperature).not.toBeNull();
        temperature!.value = "0.4";
        temperature!.dispatchEvent(new Event("input", {bubbles: true}));
        await nextTick();

        expect(mountedView.updates.at(-1)?.modelDefaults.temperature).toBe("0.4");
    });
});

describe("AgentProfileSettingsView 内嵌窗口标题", () => {
    it("隐藏视觉 Agent Profiles 标题但保留导航无障碍名称", async () => {
        const mountedView = mountView(pageDraft("0.2", ""), false);
        await nextTick();
        await nextTick();

        const navigation = mountedView.host.querySelector("nav");
        expect(navigation?.getAttribute("aria-labelledby")).toBeTruthy();
        expect(navigation?.querySelector("h2.sr-only")?.textContent).toContain("Agent Profiles");
        expect(navigation?.querySelector("header")).toBeNull();
    });
});
