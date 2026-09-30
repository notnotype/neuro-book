// @vitest-environment jsdom
import {createApp, defineComponent, h, nextTick, ref} from "vue";
import type {App} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import AgentProfileSettingsViewFixture from "./AgentProfileSettingsViewFixture.vue";
import {agentProfileSettingsViewScenes} from "./SettingsProject.scenes";
import {LAB_EVENT_SINK, LAB_INPUT_SINK} from "../lab-event-sink";

const mounted: App[] = [];

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
});

afterEach(() => {
    for (const app of mounted.splice(0)) app.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

describe("AgentProfileSettingsViewFixture 数据同步", () => {
    it("修改后将页面草稿回写 Lab model 输入", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const scene = agentProfileSettingsViewScenes.find((entry) => entry.id === "global")!;
        const input = ref(structuredClone(scene.input));
        const app = createApp(defineComponent({setup: () => () => h(AgentProfileSettingsViewFixture, {scene: "global", input: input.value})}));
        app.provide(LAB_INPUT_SINK, (layer, key, value) => {
            input.value = {...input.value, [layer]: {...input.value[layer], [key]: value}};
        });
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        const defaults = [...host.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => button.textContent?.includes("settings.panels.profileModels.nav.defaults"));
        expect(defaults).toBeDefined();
        defaults!.click();
        await nextTick();
        const advanced = [...host.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => button.textContent?.includes("settings.panels.profileModels.settingsView.advancedModel"));
        expect(advanced).toBeDefined();
        advanced!.click();
        await vi.waitFor(() => expect(advanced!.getAttribute("aria-expanded")).toBe("true"));
        const temperature = host.querySelector<HTMLInputElement>("input[type='number']");
        expect(temperature).not.toBeNull();
        temperature!.value = "0.4";
        temperature!.dispatchEvent(new Event("input", {bubbles: true}));

        await vi.waitFor(() => expect(input.value.model.modelValue.modelDefaults.temperature).toBe("0.4"));
        expect(host.textContent).toContain("改动已就地保存到本次预览；未写入真实配置。");
    });
});
