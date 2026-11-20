/**
 * “模型角色”页的思考档与图标列（docs/specs/models/settings-pages.md 输出 13 到 17）：选项来自绑定模型的推理能力，第一项“跟随模型”；
 * 没绑定、不推理、不能调档时停用并写原因；已存的档位不在新模型的选项里时补一个停用的项。数据经 Lab 场景同一份假远端。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createFakeModelsRemote} from "nbook/plugins/lab/web/fixtures/models-scene/fake-remote";
import {SAMPLE_SNAPSHOT, sampleModel} from "nbook/plugins/lab/web/fixtures/models-scene/sample";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import type {ModelsSnapshot} from "@notnotype/nb-models/contract";

import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import {createModelsStore} from "../models-store";
import {modelsCatalogs} from "../text";
import RolesPage from "./RolesPage.vue";

const global = {provide: provideText(testTextPort("zh-CN", {[MODELS_TEXT_NAMESPACE]: modelsCatalogs}))};
const mounted: Array<{unmount(): void}> = [];
const stores: Array<{dispose(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    for (const store of stores.splice(0)) store.dispose();
    document.body.innerHTML = "";
});

async function render(snapshot: ModelsSnapshot = SAMPLE_SNAPSHOT) {
    const fake = createFakeModelsRemote(snapshot);
    const store = createModelsStore(fake.remote);
    stores.push(store);
    const wrapper = mount(RolesPage, {global, props: {store, writable: true, reportWriteFailure: () => undefined}, attachTo: document.body});
    mounted.push(wrapper);
    await waitUntil("角色行", () => document.querySelector("[data-role-row]") !== null, {timeoutMs: 10_000});
    return {wrapper, fake, store};
}

const effortOf = (role: string) => document.querySelector(`[data-role-row='${role}'] [data-role-effort]`)!;
const triggerOf = (role: string) => effortOf(role).querySelector<HTMLButtonElement>("button[role='combobox']")!;

describe("角色的思考档", () => {
    it("没绑定、模型不推理时停用并写原因；绑了可调档的模型时可选", async () => {
        await render();
        // 样例里：tiny 没绑定；fast 绑的 DeepSeek Flash 不推理；main 绑的 Claude Sonnet 有三档。
        expect(triggerOf("tiny").disabled).toBe(true);
        expect(effortOf("tiny").textContent).toContain("先绑定模型");
        expect(triggerOf("fast").disabled).toBe(true);
        expect(effortOf("fast").textContent).toContain("这个模型不支持思考");
        expect(triggerOf("main").disabled).toBe(false);
        expect(effortOf("main").textContent).toContain("高");
        expect(effortOf("polish").textContent).toContain("先绑定模型");
    });

    it("已存的档位在不推理的模型上仍显示并能清除，清除写 effort: null", async () => {
        const roles = SAMPLE_SNAPSHOT.roles.map((role) => (role.id === "fast" ? {...role, effort: "high" as const} : role));
        const {store} = await render({...SAMPLE_SNAPSHOT, roles});
        expect(effortOf("fast").textContent).toContain("高");
        (effortOf("fast").querySelector("[data-role-effort-clear]") as HTMLElement).click();
        await flushPromises();
        await waitUntil("清除写进去", () => store.snapshot.value?.roles.find((role) => role.id === "fast")?.effort === null, {timeoutMs: 10_000});
    });

    it("改绑到没有这一档的模型后：下拉里补一个停用的项，说明实际用哪一档", async () => {
        const providers = SAMPLE_SNAPSHOT.providers.map((provider) => (provider.id === "anthropic"
            ? {...provider, models: [sampleModel("claude-sonnet-4-5", {name: "Claude Sonnet 4.5", reasoning: true, efforts: ["low", "medium"]})]}
            : provider));
        const roles = SAMPLE_SNAPSHOT.roles.map((role) => (role.id === "main" ? {...role, effort: "xhigh" as const} : role));
        await render({providers, roles});
        // 控件显示已存的档位；展开下拉，停用的项写“实际用”。
        triggerOf("main").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        await flushPromises();
        const items = [...document.body.querySelectorAll("[role='option']")];
        const stale = items.find((item) => item.textContent?.includes("极高"));
        expect(stale?.textContent).toContain("实际用 中");
        expect(stale?.getAttribute("data-disabled")).not.toBeNull();
    });
});

describe("自建角色的图标", () => {
    it("内置角色画自己的图标；自建角色有选图标的按钮", async () => {
        await render();
        expect(document.querySelector("[data-role-row='main'] .i-lucide-star")).not.toBeNull();
        expect(document.querySelector("[data-role-row='polish'] [data-role-icon]")).not.toBeNull();
        expect(document.querySelector("[data-role-row='main'] [data-role-icon]")).toBeNull();
    });
});
