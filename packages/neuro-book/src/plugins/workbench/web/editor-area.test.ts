/**
 * 编辑器槽的贡献点（docs/specs/ui/workbench-shell.md 非目标第一条）：真实内核的浏览器实例，拥有者插件用产品的贡献点
 * 校验与 `EditorAreaSlot`；提供方插件自己关闭激活作用域，走内核真实的撤回路径。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {defineComponent} from "vue";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {WORKBENCH_EDITOR_AREA_POINT} from "../shared/contracts";
import type {EditorAreaImplementation} from "./contracts";
import {EditorAreaSlot, validateEditorAreaContribution} from "./editor-area";

const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

const Sample = defineComponent({name: "SampleEditorArea", render: () => null});

function provider(id: string, order: number, contexts: Map<string, ActivationContext>, location: "browser" | "server" = "browser"): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location,
            activationEvents: ["onStartup"],
            contributions: [{capability: WORKBENCH_EDITOR_AREA_POINT, id: `${id}.area`, declaration: {order}}],
            activate: (context) => {
                contexts.set(id, context);
                const implementation: EditorAreaImplementation = {load: async () => Sample};
                return {contributions: {[WORKBENCH_EDITOR_AREA_POINT]: {[`${id}.area`]: implementation}}};
            },
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<{application: Application; slot: EditorAreaSlot; reports: string[]}> {
    const reports: string[] = [];
    const holder: {slot: EditorAreaSlot | null} = {slot: null};
    const owner: PluginDefinition = {
        id: "test.owner",
        contributionPoints: [{id: WORKBENCH_EDITOR_AREA_POINT, implementation: "required", validate: validateEditorAreaContribution}],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [WORKBENCH_EDITOR_AREA_POINT],
            activate: () => {
                holder.slot = new EditorAreaSlot((message) => reports.push(message));
                return {receivers: {[WORKBENCH_EDITOR_AREA_POINT]: holder.slot.receiver()}};
            },
        }],
    };
    const application = createApplication(
        {identity: {location: "browser", instanceId: "editor-area"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [owner, ...plugins], requiredPlugins: ["test.owner"], gates: []},
    );
    started.push(application);
    await application.startup;
    if (holder.slot === null) throw new Error("拥有者没有激活");
    return {application, slot: holder.slot, reports};
}

describe("Spec ui.workbench-shell 编辑器槽的贡献点", () => {
    it("没有贡献时为空；挂 order 最小的一个，其余记诊断；加载经交付的实现", async () => {
        const contexts = new Map<string, ActivationContext>();
        const {slot, reports} = await start([provider("test.late", 5, contexts), provider("test.early", 1, contexts)]);
        expect(slot.current.value?.id).toBe("test.early.area");
        expect(await slot.current.value?.load()).toBe(Sample);
        expect(reports).toContain("编辑器槽有 2 个提供者，只挂 test.early.area：test.late.area 不挂");

        const empty = await start([]);
        expect(empty.slot.current.value).toBeNull();
    });

    it("挂着的提供者停止：换到下一个；全部停止后为空，旧提供者的加载被拒", async () => {
        const contexts = new Map<string, ActivationContext>();
        const {slot} = await start([provider("test.first", 0, contexts), provider("test.second", 1, contexts)]);
        const first = slot.current.value;
        expect(first?.id).toBe("test.first.area");
        expect((await contexts.get("test.first")?.scope.parent?.close())?.status).toBe("closed");
        expect(slot.current.value?.id).toBe("test.second.area");
        expect((await contexts.get("test.second")?.scope.parent?.close())?.status).toBe("closed");
        expect(slot.current.value).toBeNull();
        await expect(first?.load()).rejects.toThrow("已撤回");
    });

    it("只接受浏览器入口与有限的 order", async () => {
        const contexts = new Map<string, ActivationContext>();
        const {application, slot} = await start([provider("test.server", 0, contexts, "server")]);
        expect(slot.current.value).toBeNull();
        expect(application.plugins.contribution(WORKBENCH_EDITOR_AREA_POINT, "test.server.area")[0]?.validation).toMatchObject({status: "rejected", detail: `${WORKBENCH_EDITOR_AREA_POINT} 只接受浏览器入口的贡献`});
        expect(validateEditorAreaContribution({location: "browser", declaration: {order: Number.NaN}} as never)).toBe("order 必须是有限数");
    });
});
