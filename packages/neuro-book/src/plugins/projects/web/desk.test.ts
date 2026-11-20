/**
 * 案头的贡献位（docs/specs/workbench/bookshelf.md 输出 22）：恰好一条贡献才采用，书架画出来之后才加载，加载失败与多于一条记诊断、
 * 不采用，撤回后收回组件。句柄是运行时 `ContributionHandle` 的同形替身（只用 `published`、`id` 与 `implementation()`）；装进真实
 * 运行时、由 agent 贡献的那一条在 e2e bots-chat 的书房一组。
 */

import {describe, expect, it} from "bun:test";
import {defineComponent, nextTick} from "vue";
import type {Component} from "vue";

import type {ContributionHandle} from "@notnotype/nb-runtime/plugins";

import {createDeskSlot} from "./desk";
import type {DeskImplementation} from "./desk";

function handle(id: string, load: () => Promise<Component>): ContributionHandle<unknown, DeskImplementation> & {loads: number} {
    const entry = {
        capability: "projects.desk", id, plugin: id.split(".").slice(0, 2).join("."), entry: "browser", generation: 1, kind: "entry" as const, declaration: {},
        published: true, loads: 0,
        implementation: (): DeskImplementation => ({load: () => {
            entry.loads += 1;
            return load();
        }}),
    };
    return entry;
}

const settle = async (): Promise<void> => {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("案头的贡献位", () => {
    it("恰好一条：书架画出来之前不加载，画出来后加载并采用；撤回后收回", async () => {
        const reports: string[] = [];
        const slot = createDeskSlot((event) => reports.push(event));
        const Companion = defineComponent({render: () => null});
        const one = handle("nbook.agent.desk", async () => Companion);
        slot.receiver.published!(one, undefined);
        await settle();
        expect(one.loads).toBe(0);
        slot.want();
        await settle();
        expect(slot.companion.value).toBe(Companion);
        slot.receiver.revoke!(one, undefined, "activation-stopped");
        await settle();
        expect(slot.companion.value).toBeNull();
        expect(reports).toEqual([]);
    });

    it("多于一条：都不采用、记诊断；加载失败：不采用、记诊断", async () => {
        const reports: string[] = [];
        const slot = createDeskSlot((event) => reports.push(event));
        slot.want();
        const a = handle("acme.cat.desk", async () => defineComponent({render: () => null}));
        const b = handle("nbook.agent.desk", async () => defineComponent({render: () => null}));
        slot.receiver.published!(a, undefined);
        slot.receiver.published!(b, undefined);
        await settle();
        expect(slot.companion.value).toBeNull();
        expect(reports).toContain("projects.desk-ambiguous");

        const failing = createDeskSlot((event) => reports.push(event));
        failing.want();
        failing.receiver.published!(handle("nbook.agent.desk", async () => {
            throw new Error("chunk 404");
        }), undefined);
        await settle();
        expect(failing.companion.value).toBeNull();
        expect(reports).toContain("projects.desk-load-failed");
    });

    it("加载期间撤回：晚到的组件不采用", async () => {
        const slot = createDeskSlot(() => undefined);
        slot.want();
        let finish!: (component: Component) => void;
        const one = handle("nbook.agent.desk", () => new Promise<Component>((resolve) => {
            finish = resolve;
        }));
        slot.receiver.published!(one, undefined);
        await settle();
        slot.receiver.revoke!(one, undefined, "activation-stopped");
        finish(defineComponent({render: () => null}));
        await settle();
        expect(slot.companion.value).toBeNull();
    });
});
