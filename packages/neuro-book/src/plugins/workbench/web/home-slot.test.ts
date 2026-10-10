/**
 * 无项目首页的贡献点（docs/specs/ui/workbench-shell.md 输出 36）：真实内核的浏览器实例，拥有者插件用产品的贡献点校验与
 * `HomeSlot`；提供方插件自己关闭激活作用域，走内核真实的撤回路径。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {defineComponent} from "vue";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {validateHomeContribution, WORKBENCH_HOME_POINT} from "../shared/home";
import type {WorkbenchHomeImplementation} from "./contracts";
import {HomeSlot} from "./home-slot";

const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

const Sample = defineComponent({name: "SampleHome", render: () => null});

function provider(id: string, contexts: Map<string, ActivationContext>, options: {readonly location?: "browser" | "server"; readonly declaration?: unknown} = {}): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location: options.location ?? "browser",
            activationEvents: ["onStartup"],
            contributions: [{capability: WORKBENCH_HOME_POINT, id: `${id}.home`, declaration: options.declaration ?? {title: {"zh-CN": "书架", "en-US": "Bookshelf"}}}],
            activate: (context) => {
                contexts.set(id, context);
                const implementation: WorkbenchHomeImplementation = {load: async () => Sample};
                return {contributions: {[WORKBENCH_HOME_POINT]: {[`${id}.home`]: implementation}}};
            },
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<{application: Application; slot: HomeSlot; reports: string[]}> {
    const reports: string[] = [];
    const holder: {slot: HomeSlot | null} = {slot: null};
    const owner: PluginDefinition = {
        id: "test.owner",
        contributionPoints: [{id: WORKBENCH_HOME_POINT, implementation: "required", validate: validateHomeContribution}],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [WORKBENCH_HOME_POINT],
            activate: () => {
                holder.slot = new HomeSlot((message) => reports.push(message));
                return {receivers: {[WORKBENCH_HOME_POINT]: holder.slot.receiver()}};
            },
        }],
    };
    const application = createApplication(
        {identity: {location: "browser", instanceId: "home-slot"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [owner, ...plugins], requiredPlugins: ["test.owner"], gates: []},
    );
    started.push(application);
    await application.startup;
    if (holder.slot === null) throw new Error("拥有者没有激活");
    return {application, slot: holder.slot, reports};
}

describe("Spec ui.workbench-shell 无项目首页的贡献点", () => {
    it("没有贡献时为空；恰好一个时采用，加载经交付的实现", async () => {
        const empty = await start([]);
        expect(empty.slot.current.value).toBeNull();

        const {slot, reports} = await start([provider("test.shelf", new Map())]);
        expect(slot.current.value?.id).toBe("test.shelf.home");
        expect(await slot.current.value?.load()).toBe(Sample);
        expect(reports).toEqual([]);
    });

    it("两个提供者都不采用并记诊断（按 id 排序）；一个停止后另一个被采用；都停止后为空，旧提供者的加载被拒", async () => {
        const contexts = new Map<string, ActivationContext>();
        const {slot, reports} = await start([provider("test.b", contexts), provider("test.a", contexts)]);
        expect(slot.current.value).toBeNull();
        expect(reports).toEqual(["首页有 2 个提供者，都不采用：test.a.home、test.b.home"]);
        expect((await contexts.get("test.a")?.scope.parent?.close())?.status).toBe("closed");
        const remaining = slot.current.value;
        expect(remaining?.id).toBe("test.b.home");
        expect((await contexts.get("test.b")?.scope.parent?.close())?.status).toBe("closed");
        expect(slot.current.value).toBeNull();
        await expect(remaining?.load()).rejects.toThrow("已撤回");
    });

    it("只接受浏览器入口与合格的声明", async () => {
        const contexts = new Map<string, ActivationContext>();
        const {application, slot} = await start([provider("test.server", contexts, {location: "server"}), provider("test.bad", contexts, {declaration: {}})]);
        expect(slot.current.value).toBeNull();
        expect(application.plugins.contribution(WORKBENCH_HOME_POINT, "test.server.home")[0]?.validation).toMatchObject({status: "rejected", detail: `${WORKBENCH_HOME_POINT} 只接受浏览器入口的贡献`});
        expect(application.plugins.contribution(WORKBENCH_HOME_POINT, "test.bad.home")[0]?.validation).toMatchObject({status: "rejected", detail: expect.stringContaining("首页 test.bad.home 的声明不合格")});
    });
});
