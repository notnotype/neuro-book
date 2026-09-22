// @vitest-environment jsdom
import {createApp, nextTick} from "vue";
import type {App} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import AgentProfileSettingsViewFixture from "./AgentProfileSettingsViewFixture.vue";
import {LAB_DATA_SINK} from "../lab-event-sink";

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
    it("修改后立即把新的 saved 与 message 推送到 Lab 数据面板", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const snapshots: Array<{draft: unknown; saved: unknown; message: unknown}> = [];
        const app = createApp(AgentProfileSettingsViewFixture, {scene: "global"});
        app.provide(LAB_DATA_SINK, (value: unknown) => snapshots.push(value as typeof snapshots[number]));
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

        await vi.waitFor(() => expect(snapshots.at(-1)?.message).toBe("改动已就地保存到本次预览；未写入真实配置。"));

        const latest = snapshots.at(-1)!;
        expect(latest.saved).toEqual(latest.draft);
    });
});
