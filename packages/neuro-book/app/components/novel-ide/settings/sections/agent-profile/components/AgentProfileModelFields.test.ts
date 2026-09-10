// @vitest-environment jsdom
import {createApp, defineComponent, h, nextTick, ref} from "vue";
import type {App} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {AgentProfileModelConfigDto} from "nbook/shared/dto/app-settings.dto";
import AgentProfileModelFields from "./AgentProfileModelFields.vue";
import AgentProfileModelSection from "./AgentProfileModelSection.vue";
import AgentProfileDefaultModelSection from "./AgentProfileDefaultModelSection.vue";
import type {AgentProfileModelDraft, AgentProfileModelFieldErrors} from "../agent-profile-draft";

const mounted: App[] = [];

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({
        t: (key: string) => ({
            "settings.panels.profileModels.temperature": "温度",
            "settings.panels.profileModels.emptyPlaceholder": "留空表示继承",
            "settings.panels.profileModels.topkInvalid": "TopK 无效",
            "settings.panels.profileModels.temperatureInvalid": "温度无效",
            "settings.panels.profileModels.settingsView.advancedModel": "高级模型参数",
        }[key] ?? key),
    }));
});

afterEach(() => {
    for (const app of mounted.splice(0)) app.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

const inherited: AgentProfileModelConfigDto = {
    modelKey: null,
    temperature: 0.2,
    topK: 20,
    reasoningEffort: "medium",
    stream: true,
};

const model: AgentProfileModelDraft = {
    modelKey: null,
    temperature: "-1",
    topK: "2.5",
    reasoningEffort: null,
    stream: null,
};

function mountFields(errors: AgentProfileModelFieldErrors): HTMLElement {
    const host = document.createElement("div");
    document.body.append(host);
    const modelValue = ref(model);
    const app = createApp(defineComponent({
        setup() {
            return () => h(AgentProfileModelFields, {
                modelValue: modelValue.value,
                inherited,
                enabledModels: [],
                validationIssues: [],
                inheritMode: "profile",
                visibleFields: ["advanced"],
                errors,
                disabled: false,
                "onUpdate:modelValue": (value: AgentProfileModelDraft) => {
                    modelValue.value = value;
                },
            });
        },
    }));
    mounted.push(app);
    app.mount(host);
    return host;
}

function mountSection(component: typeof AgentProfileModelSection | typeof AgentProfileDefaultModelSection, errors: AgentProfileModelFieldErrors): HTMLElement {
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(component, component === AgentProfileModelSection
        ? {model, inherited, enabledModels: [], validationIssues: [], modelErrors: errors, disabled: false}
        : {scope: "global", modelDefaults: model, globalModelDefaults: inherited, enabledModels: [], validationIssues: [], modelErrors: errors, disabled: false});
    mounted.push(app);
    app.mount(host);
    return host;
}

describe("模型高级区段", () => {
    it("Profile 详情的模型错误会自动展开高级参数", async () => {
        const host = mountSection(AgentProfileModelSection, {temperature: "温度无效"});
        await nextTick();
        const trigger = [...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")]
            .find((button) => button.textContent?.includes("高级模型参数"));

        expect(trigger?.getAttribute("aria-expanded")).toBe("true");
        expect(host.textContent).toContain("温度无效");
    });

    it("默认设置的模型错误会自动展开高级参数", async () => {
        const host = mountSection(AgentProfileDefaultModelSection, {temperature: "温度无效"});
        await nextTick();
        const trigger = [...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")]
            .find((button) => button.textContent?.includes("高级模型参数"));

        expect(trigger?.getAttribute("aria-expanded")).toBe("true");
        expect(host.textContent).toContain("温度无效");
    });
});
describe("AgentProfileModelFields", () => {
    it("在温度和 TopK 下显示校验错误并标记输入无效", () => {
        const host = mountFields({temperature: "温度无效", topK: "TopK 无效"});
        const inputs = [...host.querySelectorAll<HTMLInputElement>("input[type='number']")];

        expect(host.textContent).toContain("温度无效");
        expect(host.textContent).toContain("TopK 无效");
        expect(inputs).toHaveLength(2);
        expect(inputs.every((input) => input.getAttribute("aria-invalid") === "true")).toBe(true);
    });
});
