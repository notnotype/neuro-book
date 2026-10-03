// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {describe, expect, it, vi} from "vitest";
import {defineComponent, h, nextTick} from "vue";
import {Type} from "typebox";
import {LAB_EVENT_SINK} from "../lab-event-sink";
import {useLabCommandScene, type LabCommandScene} from "./lab-command-scene";

vi.mock("vue-i18n", () => ({useI18n: () => ({t: (key: string) => key})}));

function mountScene() {
    const events: {name: string; payload: unknown}[] = [];
    let scene!: LabCommandScene;
    const wrapper = mount(defineComponent({
        setup() {
            scene = useLabCommandScene();
            return () => h("div");
        },
    }), {
        attachTo: document.body,
        global: {provide: {[LAB_EVENT_SINK as symbol]: (name: string, payload?: unknown) => events.push({name, payload})}},
    });
    return {wrapper, scene, events};
}

function pressPalette(): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {key: "P", ctrlKey: true, metaKey: false, shiftKey: true, bubbles: true, cancelable: true});
    window.dispatchEvent(event);
    return event;
}

describe("useLabCommandScene", () => {
    it("场景挂载期间 Mod+Shift+P 打开本场景面板，执行审计成为 Lab command 事件", async () => {
        const {wrapper, scene, events} = mountScene();

        const event = pressPalette();
        await nextTick();

        expect(event.defaultPrevented).toBe(true);
        expect(scene.host.palette.open.value).toBe(true);
        expect(events.filter((entry) => entry.name === "command")).toEqual([
            {name: "command", payload: expect.objectContaining({id: "nbook.quick-open.open-commands", ok: true})},
        ]);
        wrapper.unmount();
    });

    it("场景卸载后键位监听与面板入口命令一起释放，不残留到下一个场景", async () => {
        const first = mountScene();
        const firstHost = first.scene.host;
        first.wrapper.unmount();

        expect(firstHost.registry.getAllCommands()).toEqual([]);
        expect(firstHost.palette.open.value).toBe(false);

        const stray = pressPalette();
        expect(stray.defaultPrevented).toBe(false);
        expect(first.events.filter((entry) => entry.name === "command")).toEqual([]);

        // 下一个场景各建各的宿主：旧宿主的状态不影响新场景。
        const second = mountScene();
        expect(second.scene.host).not.toBe(firstHost);
        pressPalette();
        await nextTick();
        expect(second.scene.host.palette.open.value).toBe(true);
        expect(firstHost.palette.open.value).toBe(false);
        second.wrapper.unmount();
    });

    it("卸载时把未决的 agent 确认结算为拒绝，注册表里的调用不会永远挂着", async () => {
        const {wrapper, scene} = mountScene();
        const registration = scene.host.registry.registerCommand({
            id: "nbook.edit.lab-confirmed-write",
            titleKey: "workbenchCommands.undo",
            description: "needs confirmation",
            argsSchema: Type.Object({}, {additionalProperties: false}),
            effect: "write",
            expose: {human: true, agent: "confirm"},
            run: () => ({ok: true, value: null}),
        });
        expect(registration.ok).toBe(true);

        const execution = scene.host.registry.executeCommand("nbook.edit.lab-confirmed-write", {}, {source: "agent", callerId: "lab"});
        await nextTick();
        expect(scene.confirmation.pending.value?.request.callerId).toBe("lab");
        expect(scene.confirmation.visible.value).toBe(true);

        wrapper.unmount();

        await expect(execution).resolves.toMatchObject({ok: false, code: "denied"});
        expect(scene.confirmation.pending.value).toBeNull();
    });
});
