/**
 * 数据分页的界面经真实内核的贡献点交付（component-views.ts；docs/specs/canon/author-ui.md 输出 12 与“状态与转换”）：交付了就
 * 加载它的组件，同一次交付只加载一次；加载失败给出原因；贡献方停了以后注册表不再给它（条目页换成通用字段表）。声明里没写
 * `title` 时补约定键。只收浏览器入口、id 按插件前缀核对。
 */

import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h} from "vue";
import type {Component} from "vue";

import type {Application} from "@notnotype/nb-runtime/application";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createApplication} from "nbook/application";

import {CANON_COMPONENT_VIEWS_POINT, componentViewsPoint, validateComponentViewContribution} from "../shared/component-views";
import {ComponentViewRegistry} from "./component-views";

const started: Application[] = [];
afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

const View: Component = defineComponent({name: "ThingView", setup: () => () => h("div")});

async function start(load: () => Promise<Component>, declaration: Record<string, unknown> = {}): Promise<{registry: ComponentViewRegistry; loads: () => number; application: Application}> {
    const holder: {registry: ComponentViewRegistry | null} = {registry: null};
    let loads = 0;
    const owner: PluginDefinition = {
        id: "test.owner",
        contributionPoints: [componentViewsPoint],
        entries: [{
            id: "browser", location: "browser", activationEvents: ["onStartup"], receives: [CANON_COMPONENT_VIEWS_POINT],
            activate: () => {
                holder.registry = new ComponentViewRegistry();
                return {receivers: {[CANON_COMPONENT_VIEWS_POINT]: holder.registry.receiver()}};
            },
        }],
    };
    const provider: PluginDefinition = {
        id: "test.views",
        entries: [{
            id: "browser", location: "browser", activationEvents: ["onStartup"],
            contributions: [{capability: CANON_COMPONENT_VIEWS_POINT, id: "test.views.thing", declaration}],
            activate: () => ({contributions: {[CANON_COMPONENT_VIEWS_POINT]: {"test.views.thing": {load: () => {
                loads += 1;
                return load();
            }}}}}),
        }],
    };
    const application = createApplication(
        {identity: {location: "browser", instanceId: "component-views"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [owner, provider], requiredPlugins: ["test.owner"], gates: []},
    );
    started.push(application);
    await application.startup;
    if (holder.registry === null) throw new Error("拥有者没有激活");
    return {registry: holder.registry, loads: () => loads, application};
}

describe("数据分页的界面", () => {
    it("交付了就加载组件，同一次交付只加载一次；没写标题时是约定键；贡献方停了以后没有", async () => {
        const {registry, loads, application} = await start(() => Promise.resolve(View));
        expect(registry.view("nbook.canon.person")).toEqual({status: "none"});
        expect(registry.view("test.views.thing").status).toBe("loading");
        await waitUntil("加载完", () => registry.view("test.views.thing").status === "ready");
        expect(registry.view("test.views.thing")).toEqual({status: "ready", component: View, title: {kind: "text", ns: "test.views", key: "componentViews.thing.title"}});
        registry.view("test.views.thing");
        expect(loads()).toBe(1);

        await application.stop();
        started.splice(0);
        expect(registry.view("test.views.thing")).toEqual({status: "none"});
    });

    it("加载失败：给出原因", async () => {
        const {registry} = await start(() => Promise.reject(new Error("坏了")), {title: "东西"});
        registry.view("test.views.thing");
        await waitUntil("失败", () => registry.view("test.views.thing").status === "failed");
        expect(registry.view("test.views.thing")).toEqual({status: "failed", title: "东西", reason: "坏了"});
    });

    it("声明校验：只收浏览器入口；声明只有 title", () => {
        expect(validateComponentViewContribution({plugin: "p", entry: "e", location: "browser", capability: CANON_COMPONENT_VIEWS_POINT, id: "p.thing", declaration: {}} as never)).toBeNull();
        expect(validateComponentViewContribution({plugin: "p", entry: "e", location: "server", capability: CANON_COMPONENT_VIEWS_POINT, id: "p.thing", declaration: {}} as never)).toContain("browser");
        expect(validateComponentViewContribution({plugin: "p", entry: "e", location: "browser", capability: CANON_COMPONENT_VIEWS_POINT, id: "p.thing", declaration: {icon: "x"}} as never)).toContain("invalid declaration");
    });
});
