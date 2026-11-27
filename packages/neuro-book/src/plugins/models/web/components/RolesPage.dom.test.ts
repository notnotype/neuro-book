/**
 * “模型角色”页的思考档与图标列（docs/specs/models/settings-pages.md 输出 13 到 17）：选项来自绑定模型的推理能力，第一项“跟随模型”；
 * 没绑定、不推理、不能调档时停用并写原因；已存的档位不在新模型的选项里时补一个停用的项。数据经 Lab 场景同一份假远端。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createFakeModelsRemote} from "nbook/plugins/models/web/lab/fake-remote";
import {SAMPLE_ROWS, SAMPLE_SNAPSHOT, sampleRow} from "nbook/plugins/models/web/lab/sample";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import type {ModelRow, ModelsSnapshot} from "@notnotype/nb-models/contract";

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

async function render(snapshot: ModelsSnapshot = SAMPLE_SNAPSHOT, rows: Readonly<Record<string, readonly ModelRow[]>> = SAMPLE_ROWS) {
    const fake = createFakeModelsRemote(snapshot, {rows});
    const store = createModelsStore(fake.remote);
    stores.push(store);
    const wrapper = mount(RolesPage, {global, props: {store, writable: true, reportWriteFailure: () => undefined}, attachTo: document.body});
    mounted.push(wrapper);
    await waitUntil("角色行", () => document.querySelector("[data-role-row]") !== null, {timeoutMs: 10_000});
    // 绑着的模型名与推理能力经选用数据按引用取：等取到再断言。
    const bound = snapshot.roles.filter((role) => role.model !== null).length;
    await waitUntil("选用数据到齐", () => store.selection.ready.value && store.selection.lookup.value.size >= new Set(snapshot.roles.flatMap((role) => (role.model === null ? [] : [role.model]))).size && bound >= 0, {timeoutMs: 10_000});
    await flushPromises();
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
        const roles = SAMPLE_SNAPSHOT.roles.map((role) => (role.id === "main" ? {...role, effort: "xhigh" as const} : role));
        await render({...SAMPLE_SNAPSHOT, roles}, {...SAMPLE_ROWS, anthropic: [sampleRow("claude-sonnet-4-5", {name: "Claude Sonnet 4.5", reasoning: true, efforts: ["low", "medium"]})]});
        // 控件显示已存的档位；展开下拉，停用的项写“实际用”。
        triggerOf("main").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        await flushPromises();
        const items = [...document.body.querySelectorAll("[role='option']")];
        const stale = items.find((item) => item.textContent?.includes("极高"));
        expect(stale?.textContent).toContain("实际用 中");
        expect(stale?.getAttribute("data-disabled")).not.toBeNull();
    });
});

/** 展开某个角色的思考档下拉，交回选项。 */
async function openEffort(role: string): Promise<HTMLElement[]> {
    triggerOf(role).dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
    await flushPromises();
    return [...document.body.querySelectorAll<HTMLElement>("[role='option']")];
}
/** 选中一项：Reka 的 Select 按指针类型决定在按下、抬起还是点击时选，三个都发。 */
function choose(item: HTMLElement): void {
    item.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "mouse", button: 0}));
    item.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, pointerType: "mouse", button: 0}));
    item.click();
}
/** 选项的名字：每项的第一段文字（说明紧跟在名字后面）。 */
const labelsOf = (items: HTMLElement[]) => items.map((item) => ["跟随模型", "关闭", "极低", "极高", "低", "中", "高", "最大"].find((label) => item.textContent?.startsWith(label)) ?? item.textContent);
const effortInStore = (store: {snapshot: {value: ModelsSnapshot | null}}, role: string) => store.snapshot.value?.roles.find((item) => item.id === role)?.effort;

describe("选思考档", () => {
    it("选项是“跟随模型”、能真关时的“关闭”和模型的档位；选一档写 effort，选“跟随模型”写 null", async () => {
        const {store} = await render();
        const items = await openEffort("main");
        expect(labelsOf(items)).toEqual(["跟随模型", "关闭", "低", "中", "高"]);
        choose(items.find((item) => item.textContent?.startsWith("低"))!);
        await waitUntil("选低写进去", () => effortInStore(store, "main") === "low", {timeoutMs: 10_000});
        const again = await openEffort("main");
        choose(again.find((item) => item.textContent?.startsWith("跟随模型"))!);
        await waitUntil("选跟随模型写 null", () => effortInStore(store, "main") === null, {timeoutMs: 10_000});
    });

    it("只能降到最低档的模型没有“关闭”；没写支持哪几档的梯级，选项旁有说明", async () => {
        await render(SAMPLE_SNAPSHOT, {...SAMPLE_ROWS, anthropic: [sampleRow("claude-sonnet-4-5", {name: "Claude Sonnet 4.5", reasoning: true, efforts: ["low", "medium"], thinking: {kind: "levels", levels: ["low", "medium"], off: "lowest", unset: null, verified: false}})]});
        const items = await openEffort("main");
        // main 已存的“高”不在这个模型的档里：补在最后一项（停用，说明实际用哪一档）。
        expect(labelsOf(items)).toEqual(["跟随模型", "低", "中", "高"]);
        expect(items.slice(1, 3).every((item) => item.textContent?.includes("没写支持哪几档"))).toBe(true);
    });
});

describe("自建角色的图标", () => {
    it("图标菜单每项有中文名，选了写 icon，当前的画勾", async () => {
        const {store} = await render();
        (document.querySelector("[data-role-row='polish'] [data-role-icon]") as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        await flushPromises();
        const items = [...document.body.querySelectorAll<HTMLElement>("[role='menuitemradio']")];
        expect(items.map((item) => item.textContent?.trim())).toContain("烧瓶");
        choose(items.find((item) => item.textContent?.trim() === "烧瓶")!);
        await waitUntil("选图标写进去", () => store.snapshot.value?.roles.find((item) => item.id === "polish")?.icon === "flask", {timeoutMs: 10_000});
    });

    it("内置角色画自己的图标；自建角色有选图标的按钮", async () => {
        await render();
        expect(document.querySelector("[data-role-row='main'] .i-lucide-star")).not.toBeNull();
        expect(document.querySelector("[data-role-row='polish'] [data-role-icon]")).not.toBeNull();
        expect(document.querySelector("[data-role-row='main'] [data-role-icon]")).toBeNull();
    });
});
