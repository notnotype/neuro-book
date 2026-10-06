/**
 * 命令场景的局部宿主（ui.component-lab 场景 16 的组件半边，workbench.commands 场景 5 的确认界面）：
 * 宿主与场景同寿，快捷键只在场景挂载期间响应；Agent 调用 `confirm` 命令时出现确认框，批准后执行、卸载时按拒绝结算。
 * 真实的命令表、面板、nb-ui 确认框与 Lab 事件通道。
 */

import {mount} from "@vue/test-utils";
import {Type} from "typebox";
import {afterEach, describe, expect, it, vi} from "vitest";
import {defineComponent, h, nextTick} from "vue";

import {LAB_EVENT_SINK} from "../../lab-event-sink";
import LabCommandSceneLayer from "./LabCommandSceneLayer.vue";
import {useLabCommandScene} from "./lab-command-scene";
import type {LabCommandScene} from "./lab-command-scene";

afterEach(() => {
    document.body.innerHTML = "";
});

function mountScene() {
    const events: Array<{name: string; payload: unknown}> = [];
    let scene: LabCommandScene | null = null;
    const wrapper = mount(defineComponent({
        setup() {
            const created = useLabCommandScene();
            scene = created;
            return () => h(LabCommandSceneLayer, {scene: created});
        },
    }), {
        attachTo: document.body,
        global: {provide: {[LAB_EVENT_SINK as symbol]: (name: string, payload?: unknown) => events.push({name, payload})}},
    });
    if (scene === null) throw new Error("场景没有建立");
    return {wrapper, scene: scene as LabCommandScene, events};
}

function pressPalette(): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {key: "P", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true});
    window.dispatchEvent(event);
    return event;
}

function registerConfirmed(scene: LabCommandScene, run: () => void): void {
    const result = scene.registry.register({
        id: "nbook.edit.lab-confirmed-write",
        source: "nbook.lab",
        declaration: {title: {"zh-CN": "需要确认的写入", "en-US": "Confirmed write"}, description: "needs confirmation", args: Type.Object({}, {additionalProperties: false}), effect: "write", expose: {agent: "confirm"}},
        run: () => {
            run();
            return {ok: true, value: null};
        },
    });
    if (!result.ok) throw new Error(result.reason);
}

describe("useLabCommandScene", () => {
    it("场景挂载期间 Ctrl+Shift+P 打开本场景的面板，执行记录成为 Lab 的 command 事件", async () => {
        const {wrapper, scene, events} = mountScene();
        await nextTick();
        expect(pressPalette().defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(document.body.querySelector('[role="combobox"]')).not.toBeNull());
        expect(scene.palette.open.value).toBe(true);
        expect(scene.context.value["quick-open-visible"]).toBe(true);
        expect(events.filter((entry) => entry.name === "command").map((entry) => entry.payload)).toEqual([expect.objectContaining({id: "nbook.quick-open.open-commands", ok: true})]);
        wrapper.unmount();
    });

    it("卸载后键位监听与面板命令一起释放，不残留到下一个场景", async () => {
        const first = mountScene();
        await nextTick();
        const firstScene = first.scene;
        first.wrapper.unmount();
        expect(firstScene.registry.list()).toEqual([]);
        expect(pressPalette().defaultPrevented).toBe(false);
        expect(first.events.filter((entry) => entry.name === "command")).toEqual([]);

        const second = mountScene();
        await nextTick();
        expect(pressPalette().defaultPrevented).toBe(true);
        expect(second.scene.palette.open.value).toBe(true);
        expect(firstScene.palette.open.value).toBe(false);
        second.wrapper.unmount();
    });

    it("Agent 调用 confirm 命令：出现确认框，批准后执行一次", async () => {
        const {wrapper, scene} = mountScene();
        let runs = 0;
        registerConfirmed(scene, () => {
            runs += 1;
        });
        const execution = scene.registry.execute("nbook.edit.lab-confirmed-write", {}, {source: "agent", callerId: "lab"});
        await vi.waitFor(() => expect(document.body.querySelector('[role="alertdialog"]')?.textContent).toContain("lab 请求执行“需要确认的写入”"));
        expect(runs).toBe(0);

        const approve = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.includes("批准执行"));
        approve?.click();
        expect(await execution).toEqual({ok: true, value: null});
        expect(runs).toBe(1);
        wrapper.unmount();
    });

    it("卸载时把未决的确认结算为拒绝，命令表里的调用不会一直等着", async () => {
        const {wrapper, scene} = mountScene();
        registerConfirmed(scene, () => undefined);
        const execution = scene.registry.execute("nbook.edit.lab-confirmed-write", {}, {source: "agent", callerId: "lab"});
        await vi.waitFor(() => expect(scene.confirmation.visible.value).toBe(true));
        wrapper.unmount();
        expect(await execution).toMatchObject({ok: false, code: "denied"});
        expect(scene.confirmation.pending.value).toBeNull();
    });
});
