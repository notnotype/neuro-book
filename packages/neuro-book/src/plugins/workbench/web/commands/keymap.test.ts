/** 键位解析与分发（workbench.commands 场景 3、9）：用真实的命令表，按键事件只造分发器读取的字段。 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import type {ContextValues, WhenPredicate} from "nbook/plugins/commands/shared/context-keys";
import type {CommandResult, Release} from "nbook/plugins/commands/shared/contracts";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";

import {createKeymapDispatcher, parseKeybinding} from "./keymap";
import type {KeyInput, KeyPlatform} from "./keymap";

type Press = Partial<Omit<KeyInput, "preventDefault" | "stopImmediatePropagation" | "getModifierState">> & {key: string; altGraph?: boolean};

/** 按键事件：记下分发器是否拦截了它。 */
function press(init: Press): KeyInput & {prevented: number; stopped: number} {
    const event = {
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
        isComposing: false,
        defaultPrevented: false,
        ...init,
        prevented: 0,
        stopped: 0,
        getModifierState: (name: string) => name === "AltGraph" && init.altGraph === true,
        preventDefault() {
            event.prevented += 1;
        },
        stopImmediatePropagation() {
            event.stopped += 1;
        },
    };
    return event;
}

function harness(platform: KeyPlatform) {
    let context: ContextValues = {};
    const reported: string[] = [];
    const waiters: Array<() => void> = [];
    const runs: string[] = [];
    const registry = createCommandRegistry({contextKeys: {"editor-active": "需要活动编辑器"}, context: () => context, report: () => undefined});
    const dispatcher = createKeymapDispatcher(registry, platform, (error) => {
        reported.push(error.message);
        for (const wake of waiters.splice(0)) wake();
    });
    const bind = (id: string, options: {keybinding?: string; when?: WhenPredicate; result?: CommandResult<unknown>} = {}): Release => {
        const registered = registry.register({
            id,
            source: "nbook.test",
            declaration: {
                title: {"zh-CN": id, "en-US": id},
                description: "test command",
                args: Type.Object({}, {additionalProperties: false}),
                effect: "read",
                keybinding: options.keybinding,
                when: options.when,
            },
            run: () => {
                runs.push(id);
                return options.result ?? {ok: true, value: null};
            },
        });
        if (!registered.ok) throw new Error(registered.reason);
        return registered.value;
    };
    return {
        registry,
        dispatcher,
        reported,
        runs,
        bind,
        /** 下一次报告到达时完成。 */
        nextReport: () => new Promise<void>((resolve) => waiters.push(resolve)),
        setContext: (values: ContextValues) => {
            context = values;
        },
    };
}

describe("parseKeybinding", () => {
    it("Mod 按平台映射，组合顺序不影响结果", () => {
        expect(parseKeybinding("Mod+Shift+P", "mac")).toEqual({ok: true, value: {key: "P", ctrl: false, meta: true, alt: false, shift: true}});
        expect(parseKeybinding("Shift+Mod+P", "mac")).toEqual(parseKeybinding("Mod+Shift+P", "mac"));
        expect(parseKeybinding("Mod+Shift+P", "other")).toEqual({ok: true, value: {key: "P", ctrl: true, meta: false, alt: false, shift: true}});
    });

    it("支持 A–Z、0–9、Escape、Enter、Space、F1–F12", () => {
        for (const key of ["A", "Z", "0", "9", "Escape", "Enter", "Space", "F1", "F12"]) expect(parseKeybinding(`Mod+${key}`, "other").ok).toBe(true);
    });

    it("拒绝 chord、重复修饰、空键与未登记的修饰词", () => {
        for (const binding of ["Ctrl+K Ctrl+S", "Mod+Mod+P", "Mod+", "", "Cmd+P", "Mod+P+", "Mod+F13", "mod+p", "Mod+PageDown"]) {
            const result = parseKeybinding(binding, "other");
            expect(result.ok ? "" : result.reason).not.toBe("");
        }
    });

    it("Mod 映射后与显式修饰词重合被拒绝；mac 上 Mod+Ctrl 合法", () => {
        expect(parseKeybinding("Mod+Ctrl+P", "other").ok).toBe(false);
        expect(parseKeybinding("Mod+Ctrl+P", "mac")).toEqual({ok: true, value: {key: "P", ctrl: true, meta: true, alt: false, shift: false}});
        expect(parseKeybinding("Mod+Meta+P", "mac").ok).toBe(false);
        expect(parseKeybinding("Ctrl+Ctrl+P", "other").ok).toBe(false);
    });
});

describe("createKeymapDispatcher", () => {
    it("mac 上命中 Mod+Shift+P：执行一次，并阻止浏览器默认行为与其它监听器", () => {
        const app = harness("mac");
        app.bind("nbook.quick-open.open-commands", {keybinding: "Mod+Shift+P"});
        const event = press({key: "P", metaKey: true, shiftKey: true});
        app.dispatcher.handle(event);
        expect(app.runs).toEqual(["nbook.quick-open.open-commands"]);
        expect([event.prevented, event.stopped]).toEqual([1, 1]);
    });

    it("其它平台认 Ctrl 不认 Meta；小写的 event.key 归一后照样命中", () => {
        const app = harness("other");
        app.bind("nbook.quick-open.open-commands", {keybinding: "Mod+Shift+P"});
        const meta = press({key: "P", metaKey: true, shiftKey: true});
        app.dispatcher.handle(meta);
        expect(meta.prevented).toBe(0);
        app.dispatcher.handle(press({key: "p", ctrlKey: true, shiftKey: true}));
        expect(app.runs).toEqual(["nbook.quick-open.open-commands"]);
    });

    it("少按或多按修饰键、按到别的键都不拦截", () => {
        const app = harness("other");
        app.bind("nbook.quick-open.open-commands", {keybinding: "Mod+Shift+P"});
        for (const init of [{key: "P", ctrlKey: true}, {key: "P", ctrlKey: true, shiftKey: true, altKey: true}, {key: "O", ctrlKey: true, shiftKey: true}]) {
            const event = press(init);
            app.dispatcher.handle(event);
            expect(event.prevented).toBe(0);
        }
        expect(app.runs).toEqual([]);
    });

    it("长按重复、输入法组合中、已被上层处理、AltGraph 都不拦截", () => {
        const app = harness("other");
        app.bind("nbook.quick-open.open-commands", {keybinding: "Mod+Shift+P"});
        for (const init of [{repeat: true}, {isComposing: true}, {defaultPrevented: true}, {altGraph: true}]) {
            const event = press({key: "P", ctrlKey: true, shiftKey: true, ...init});
            app.dispatcher.handle(event);
            expect(event.prevented).toBe(0);
        }
        expect(app.runs).toEqual([]);
    });

    it("when 不满足时不拦截，也不回落到同一组合的另一条命令", () => {
        const app = harness("other");
        app.bind("nbook.editor.focus", {keybinding: "Mod+Shift+P", when: {requires: ["editor-active"]}});
        app.bind("nbook.quick-open.open-commands", {keybinding: "Mod+Shift+P"});

        const blocked = press({key: "P", ctrlKey: true, shiftKey: true});
        app.dispatcher.handle(blocked);
        expect(blocked.prevented).toBe(0);
        expect(app.runs).toEqual([]);
        expect(app.reported.some((message) => message.includes("键位冲突"))).toBe(true);

        app.setContext({"editor-active": true});
        app.dispatcher.handle(press({key: "P", ctrlKey: true, shiftKey: true}));
        expect(app.runs).toEqual(["nbook.editor.focus"]);
    });

    it("同一组合保留先登记的；它释放后下一个接管，冲突不重复报告", () => {
        const app = harness("other");
        const first = app.bind("nbook.editor.focus", {keybinding: "Mod+Shift+P"});
        app.bind("nbook.quick-open.open-commands", {keybinding: "Mod+Shift+P"});
        app.dispatcher.handle(press({key: "P", ctrlKey: true, shiftKey: true}));
        expect(app.runs).toEqual(["nbook.editor.focus"]);
        expect(app.reported).toHaveLength(1);

        first();
        app.dispatcher.handle(press({key: "P", ctrlKey: true, shiftKey: true}));
        expect(app.runs).toEqual(["nbook.editor.focus", "nbook.quick-open.open-commands"]);
        expect(app.reported).toHaveLength(1);
    });

    it("不合法的键位只报告一次、不启用，命令照样能直接执行", async () => {
        const app = harness("other");
        app.bind("nbook.quick-open.open-commands", {keybinding: "Mod+Mod+P"});
        app.bind("nbook.editor.focus", {keybinding: "Mod+K"});
        expect(app.reported).toHaveLength(1);
        expect(app.reported[0]).toContain("Mod+Mod+P");
        expect(await app.registry.execute("nbook.quick-open.open-commands")).toEqual({ok: true, value: null});
    });

    it("执行失败交给报告；dispose 幂等，之后不再分发", async () => {
        const app = harness("other");
        app.bind("nbook.quick-open.open-commands", {keybinding: "Mod+Shift+P", result: {ok: false, code: "unavailable", reason: "没有地方放面板"}});
        const reported = app.nextReport();
        app.dispatcher.handle(press({key: "P", ctrlKey: true, shiftKey: true}));
        await reported;
        expect(app.reported).toEqual(["命令 nbook.quick-open.open-commands 执行失败：没有地方放面板"]);

        app.dispatcher.dispose();
        app.dispatcher.dispose();
        const after = press({key: "P", ctrlKey: true, shiftKey: true});
        app.dispatcher.handle(after);
        expect(after.prevented).toBe(0);
    });
});
