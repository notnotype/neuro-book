import {describe, expect, it, vi, type Mock} from "vitest";
import {createKeymapDispatcher, parseKeybinding} from "nbook/app/utils/workbench/keymap";
import {createCommandRegistry, type CommandDescriptor, type CommandResult, type Release} from "nbook/app/utils/workbench/commands";
import type {ContextValues, WhenPredicate} from "nbook/app/utils/workbench/context-keys";
import {Type, type TSchema} from "typebox";

type KeyEventInit = {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    repeat?: boolean;
    isComposing?: boolean;
    defaultPrevented?: boolean;
    altGraph?: boolean;
};

/** Node 环境没有 KeyboardEvent：造一个只含分发器真正读取的字段的事件。 */
function press(init: KeyEventInit): KeyboardEvent & {preventDefault: Mock; stopImmediatePropagation: Mock} {
    const altGraph = init.altGraph ?? false;
    const event = {
        key: init.key,
        ctrlKey: init.ctrlKey ?? false,
        metaKey: init.metaKey ?? false,
        altKey: init.altKey ?? false,
        shiftKey: init.shiftKey ?? false,
        repeat: init.repeat ?? false,
        isComposing: init.isComposing ?? false,
        defaultPrevented: init.defaultPrevented ?? false,
        getModifierState: (name: string) => name === "AltGraph" && altGraph,
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
    };
    return event as unknown as KeyboardEvent & {preventDefault: Mock; stopImmediatePropagation: Mock};
}

function command(overrides: {
    id: string;
    defaultKeybinding?: string;
    when?: WhenPredicate;
    run?: () => CommandResult<unknown>;
}): CommandDescriptor<TSchema, unknown> {
    return {
        id: overrides.id,
        titleKey: "workbenchCommands.test",
        description: "test command",
        argsSchema: Type.Object({}, {additionalProperties: false}),
        effect: "read",
        when: overrides.when,
        defaultKeybinding: overrides.defaultKeybinding,
        run: overrides.run ?? (() => ({ok: true, value: null})),
    };
}

function harness(platform: "mac" | "other") {
    let context: ContextValues = {};
    const reported: Error[] = [];
    const runs: string[] = [];
    const registry = createCommandRegistry({
        context: () => context,
        agentMode: () => "normal",
        development: false,
        report: () => undefined,
    });
    const dispatcher = createKeymapDispatcher(registry, platform, (error) => reported.push(error));
    return {
        registry,
        reported,
        runs,
        dispatcher,
        setContext: (values: ContextValues) => {
            context = values;
        },
        bindRunningCommand(id: string, options: {defaultKeybinding?: string; when?: WhenPredicate} = {}): Release {
            const result = registry.registerCommand(command({
                id,
                defaultKeybinding: options.defaultKeybinding,
                when: options.when,
                run: () => {
                    runs.push(id);
                    return {ok: true, value: null};
                },
            }));
            if (!result.ok) {
                throw new Error(result.reason);
            }
            return result.value;
        },
    };
}

describe("parseKeybinding", () => {
    it("Mod 按平台映射，组合顺序不影响等价性", () => {
        expect(parseKeybinding("Mod+Shift+P", "mac")).toEqual({
            ok: true,
            value: {key: "P", ctrl: false, meta: true, alt: false, shift: true},
        });
        expect(parseKeybinding("Shift+Mod+P", "mac")).toEqual(parseKeybinding("Mod+Shift+P", "mac"));
        expect(parseKeybinding("Mod+Shift+P", "other")).toEqual({
            ok: true,
            value: {key: "P", ctrl: true, meta: false, alt: false, shift: true},
        });
    });

    it("支持 A–Z / 0–9 / Escape / Enter / Space / F1–F12", () => {
        for (const key of ["A", "Z", "0", "9", "Escape", "Enter", "Space", "F1", "F12"]) {
            expect(parseKeybinding(`Mod+${key}`, "other").ok).toBe(true);
        }
    });

    it("拒绝 chord、重复修饰、空键与未登记修饰词", () => {
        for (const binding of ["Ctrl+K Ctrl+S", "Mod+Mod+P", "Mod+", "", "Cmd+P", "Mod+P+", "Mod+F13", "mod+p", "Mod+PageDown"]) {
            const result = parseKeybinding(binding, "other");
            expect(result.ok).toBe(false);
            expect(result.ok ? "" : result.reason).toBeTruthy();
        }
    });

    it("映射后的最终修饰位重复被拒绝；mac 上 Mod+Ctrl 合法", () => {
        expect(parseKeybinding("Mod+Ctrl+P", "other").ok).toBe(false);
        expect(parseKeybinding("Mod+Ctrl+P", "mac")).toEqual({
            ok: true,
            value: {key: "P", ctrl: true, meta: true, alt: false, shift: false},
        });
        expect(parseKeybinding("Mod+Meta+P", "mac").ok).toBe(false);
        expect(parseKeybinding("Ctrl+Ctrl+P", "other").ok).toBe(false);
    });
});

describe("createKeymapDispatcher", () => {
    it("mac 上命中 Mod+Shift+P：只分发一次并阻止浏览器默认行为", () => {
        const app = harness("mac");
        app.bindRunningCommand("nbook.quick-open.open-commands", {defaultKeybinding: "Mod+Shift+P"});

        const event = press({key: "P", metaKey: true, shiftKey: true});
        app.dispatcher.handle(event);

        expect(app.runs).toEqual(["nbook.quick-open.open-commands"]);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    });

    it("其它平台认 Ctrl 而不认 Meta；大小写不同的 event.key 归一后仍命中", () => {
        const app = harness("other");
        app.bindRunningCommand("nbook.quick-open.open-commands", {defaultKeybinding: "Mod+Shift+P"});

        const meta = press({key: "P", metaKey: true, shiftKey: true});
        app.dispatcher.handle(meta);
        expect(app.runs).toEqual([]);
        expect(meta.preventDefault).not.toHaveBeenCalled();

        // 真实键盘在按住 Shift 时给出大写 P；归一保证声明的小写/大写写法都不会漏
        app.dispatcher.handle(press({key: "p", ctrlKey: true, shiftKey: true}));
        expect(app.runs).toEqual(["nbook.quick-open.open-commands"]);
    });

    it("少按 / 多按修饰键或按到别的键都不拦截", () => {
        const app = harness("other");
        app.bindRunningCommand("nbook.quick-open.open-commands", {defaultKeybinding: "Mod+Shift+P"});

        for (const init of [
            {key: "P", ctrlKey: true},
            {key: "P", ctrlKey: true, shiftKey: true, altKey: true},
            {key: "O", ctrlKey: true, shiftKey: true},
        ] satisfies KeyEventInit[]) {
            const event = press(init);
            app.dispatcher.handle(event);
            expect(event.preventDefault).not.toHaveBeenCalled();
        }
        expect(app.runs).toEqual([]);
    });

    it("repeat / composition / 已被上层消费 / AltGraph 不拦截", () => {
        const app = harness("other");
        app.bindRunningCommand("nbook.quick-open.open-commands", {defaultKeybinding: "Mod+Shift+P"});

        for (const init of [
            {key: "P", ctrlKey: true, shiftKey: true, repeat: true},
            {key: "P", ctrlKey: true, shiftKey: true, isComposing: true},
            {key: "P", ctrlKey: true, shiftKey: true, defaultPrevented: true},
            {key: "P", ctrlKey: true, shiftKey: true, altGraph: true},
        ] satisfies KeyEventInit[]) {
            const event = press(init);
            app.dispatcher.handle(event);
            expect(event.preventDefault).not.toHaveBeenCalled();
        }
        expect(app.runs).toEqual([]);
    });

    it("when 不满足不拦截，也不回落到同键的另一条命令", async () => {
        const app = harness("other");
        app.bindRunningCommand("nbook.editor.focus", {defaultKeybinding: "Mod+Shift+P", when: {requires: ["editor-active"]}});
        app.bindRunningCommand("nbook.quick-open.open-commands", {defaultKeybinding: "Mod+Shift+P"});

        const blocked = press({key: "P", ctrlKey: true, shiftKey: true});
        app.dispatcher.handle(blocked);
        expect(blocked.preventDefault).not.toHaveBeenCalled();
        expect(app.runs).toEqual([]);
        expect(app.reported.some((error) => error.message.includes("键位冲突"))).toBe(true);

        app.setContext({"editor-active": true});
        app.dispatcher.handle(press({key: "P", ctrlKey: true, shiftKey: true}));
        expect(app.runs).toEqual(["nbook.editor.focus"]);
    });

    it("同键冲突保留先注册者；旧持有者卸载后新首个接管且不重复刷报告", () => {
        const app = harness("other");
        const first = app.bindRunningCommand("nbook.editor.focus", {defaultKeybinding: "Mod+Shift+P"});
        app.bindRunningCommand("nbook.quick-open.open-commands", {defaultKeybinding: "Mod+Shift+P"});

        app.dispatcher.handle(press({key: "P", ctrlKey: true, shiftKey: true}));
        expect(app.runs).toEqual(["nbook.editor.focus"]);
        expect(app.reported).toHaveLength(1);

        first();
        app.dispatcher.handle(press({key: "P", ctrlKey: true, shiftKey: true}));
        expect(app.runs).toEqual(["nbook.editor.focus", "nbook.quick-open.open-commands"]);
        expect(app.reported).toHaveLength(1);
    });

    it("非法键位只报告一次、不启用，命令仍可直接执行", async () => {
        const app = harness("other");
        const release = app.bindRunningCommand("nbook.quick-open.open-commands", {defaultKeybinding: "Mod+Mod+P"});
        app.bindRunningCommand("nbook.editor.focus", {defaultKeybinding: "Mod+K"});

        expect(app.reported).toHaveLength(1);
        expect(app.reported[0]!.message).toContain("Mod+Mod+P");
        expect(app.runs).toEqual([]);

        // 键位没启用不等于命令不可用：按钮 / 面板仍然能执行它。
        await expect(app.registry.executeCommand("nbook.quick-open.open-commands")).resolves.toEqual({ok: true, value: null});
        expect(app.runs).toEqual(["nbook.quick-open.open-commands"]);

        release();
    });

    it("执行失败交给错误回调；dispose 幂等且随后不再分发", async () => {
        const app = harness("other");
        app.registry.registerCommand(command({
            id: "nbook.quick-open.open-commands",
            defaultKeybinding: "Mod+Shift+P",
            run: () => ({ok: false, code: "unavailable", reason: "装不下了"}),
        }));

        app.dispatcher.handle(press({key: "P", ctrlKey: true, shiftKey: true}));
        await vi.waitFor(() => expect(app.reported).toHaveLength(1));
        expect(app.reported[0]!.message).toContain("装不下了");

        app.dispatcher.dispose();
        app.dispatcher.dispose();
        const afterDispose = press({key: "P", ctrlKey: true, shiftKey: true});
        app.dispatcher.handle(afterDispose);
        expect(afterDispose.preventDefault).not.toHaveBeenCalled();
        expect(app.reported).toHaveLength(1);
    });
});
