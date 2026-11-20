/**
 * 页面浮层的贡献点（docs/specs/ui/workbench-shell.md 输出 41，验收 44）：真实内核的浏览器实例，拥有者插件用产品的贡献点
 * 校验与 `OverlaySlot`；提供方插件自己关闭激活作用域，走内核真实的撤回路径。挂载、加载失败与渲染出错在
 * `overlays.dom.test.ts`。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {defineComponent} from "vue";

import type {Application} from "@notnotype/nb-runtime/application";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {overlaysPoint, WORKBENCH_OVERLAYS_POINT} from "../shared/overlays";
import type {OverlayDeclaration} from "../shared/overlays";
import type {WorkbenchOverlayImplementation} from "./contracts";
import {OverlaySlot} from "./overlays";

import {createApplication} from "nbook/application";

const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

const Sample = defineComponent({name: "SampleOverlay", render: () => null});

function provider(plugin: string, overlays: Readonly<Record<string, OverlayDeclaration>>, contexts: Map<string, ActivationContext>, location: "browser" | "server" = "browser"): PluginDefinition {
    return {
        id: plugin,
        entries: [{
            id: "main",
            location,
            activationEvents: ["onStartup"],
            contributions: Object.entries(overlays).map(([id, declaration]) => ({capability: WORKBENCH_OVERLAYS_POINT, id, declaration})),
            activate: (context) => {
                contexts.set(plugin, context);
                const implementation: WorkbenchOverlayImplementation = {load: async () => Sample};
                return {contributions: {[WORKBENCH_OVERLAYS_POINT]: Object.fromEntries(Object.keys(overlays).map((id) => [id, implementation]))}};
            },
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<{application: Application; slot: OverlaySlot; owner: () => ActivationContext}> {
    const holder: {slot: OverlaySlot | null; context: ActivationContext | null} = {slot: null, context: null};
    const owner: PluginDefinition = {
        id: "test.owner",
        contributionPoints: [overlaysPoint],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [WORKBENCH_OVERLAYS_POINT],
            activate: (context) => {
                holder.context = context;
                holder.slot = new OverlaySlot(context.signal);
                return {receivers: {[WORKBENCH_OVERLAYS_POINT]: holder.slot.receiver()}};
            },
        }],
    };
    const application = createApplication(
        {identity: {location: "browser", instanceId: "overlays"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [owner, ...plugins], requiredPlugins: ["test.owner"], gates: []},
    );
    started.push(application);
    await application.startup;
    return {application, slot: holder.slot!, owner: () => holder.context!};
}

const ids = (slot: OverlaySlot): string[] => slot.current.value.map((entry) => entry.id);

describe("页面浮层贡献点", () => {
    it("交付的浮层按 order 再按 id 排；加载经交付的实现取组件", async () => {
        const contexts = new Map<string, ActivationContext>();
        const {slot} = await start([
            provider("test.b", {"test.b.window": {order: 5}}, contexts),
            provider("test.a", {"test.a.window": {order: 5}, "test.a.first": {}}, contexts),
        ]);
        expect(ids(slot)).toEqual(["test.a.first", "test.a.window", "test.b.window"]);
        expect(await slot.current.value[0]!.load()).toBe(Sample);
    });

    it("提供方入口停止：它的浮层撤下，别的浮层还在；撤回后旧的加载入口被内核拒绝", async () => {
        const contexts = new Map<string, ActivationContext>();
        const {slot} = await start([provider("test.a", {"test.a.window": {}}, contexts), provider("test.b", {"test.b.window": {}}, contexts)]);
        const stale = slot.current.value[0]!;
        expect((await contexts.get("test.a")!.scope.parent!.close()).status).toBe("closed");
        expect(ids(slot)).toEqual(["test.b.window"]);
        await expect(stale.load()).rejects.toThrow();
    });

    it("id 要在自己的命名空间里（占用别人的 id 不算重复、挤不掉对方）；只接受浏览器入口；声明不认识的字段被拒", async () => {
        const contexts = new Map<string, ActivationContext>();
        const {application, slot} = await start([
            provider("test.a", {"test.a.same": {}}, contexts),
            provider("test.b", {"test.a.same": {}, "other.window": {}}, contexts),
            provider("test.c", {"test.c.extra": {extra: 1} as OverlayDeclaration}, contexts),
            provider("test.d", {"test.d.server": {}}, contexts, "server"),
        ]);
        // 别的插件用了不在自己命名空间里的同一个 id：那一条只因前缀被拒，不算重复者，挤不掉合法的这一条（runtime/plugins.md 输出 15）。
        expect(ids(slot)).toEqual(["test.a.same"]);
        const validation = (id: string) => application.plugins.contribution(WORKBENCH_OVERLAYS_POINT, id).map((entry) => entry.validation);
        expect(validation("test.a.same")).toEqual([{status: "accepted"}, expect.objectContaining({status: "rejected", detail: "贡献 id 要以插件 id test.b 加“.”开头：test.a.same"})]);
        expect(validation("other.window")[0]).toMatchObject({status: "rejected", detail: "贡献 id 要以插件 id test.b 加“.”开头：other.window"});
        expect(validation("test.c.extra")[0]).toMatchObject({status: "rejected"});
        expect(validation("test.d.server")[0]).toMatchObject({status: "rejected", detail: `${WORKBENCH_OVERLAYS_POINT} 只接受浏览器入口的贡献`});
    });

    it("拥有者入口停止：浮层全部撤下", async () => {
        const contexts = new Map<string, ActivationContext>();
        const {slot, owner} = await start([provider("test.a", {"test.a.window": {}}, contexts)]);
        expect(ids(slot)).toEqual(["test.a.window"]);
        await owner().scope.parent!.close();
        expect(ids(slot)).toEqual([]);
    });
});
