/**
 * 浏览器里的键位分发：把命令声明的默认键位编译成一张表，keydown 只查表与当前可用性（workbench.commands 的键位裁决）。
 *
 * 只实现单击组合（修饰词 + 一个主键）：chord、重复修饰、空键在解析时拒绝，不静默降级。修饰位按平台精确匹配，
 * Mod 在 mac 上是 Meta、其它平台是 Ctrl；多按或少按一个修饰键都是另一个组合，不会顺手命中某个绑定。
 *
 * 分发器不挂监听：挂在哪个元素、什么时候摘下归页面上的宿主（Lab 的命令场景、产品页的命令宿主）。
 */

import {parseKeybinding} from "nbook/plugins/commands/shared/contracts";
import type {CommandFailure, CommandService, KeyModifiers, KeyPlatform, Release} from "nbook/plugins/commands/shared/contracts";

import {failureDiagnostic} from "./failure-notice";

/** 分发器读取的按键事件字段；浏览器的 KeyboardEvent 满足它。 */
export interface KeyInput {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
    readonly repeat: boolean;
    readonly isComposing: boolean;
    readonly defaultPrevented: boolean;
    getModifierState?(key: string): boolean;
    preventDefault(): void;
    stopImmediatePropagation(): void;
}

export interface KeymapDispatcher {
    handle(event: KeyInput): void;
    /** 幂等；之后不再分发，也不再随命令表重建。 */
    dispose: Release;
}

const F_KEY = /^F(?:[1-9]|1[0-2])$/u;

function combinationOf(key: string, modifiers: KeyModifiers): string {
    return `${key}|${Number(modifiers.ctrl)}${Number(modifiers.meta)}${Number(modifiers.alt)}${Number(modifiers.shift)}`;
}

/** 事件键归一：字母按大写比较（按住 Shift 时浏览器给大写），空格与 Esc 有别名，其它不参与键位。 */
function normalizeEventKey(key: string): string | null {
    if (key === " " || key === "Spacebar") return "Space";
    if (key === "Esc") return "Escape";
    if (key.length === 1) {
        if (key >= "a" && key <= "z") return key.toUpperCase();
        return (key >= "A" && key <= "Z") || (key >= "0" && key <= "9") || key === "," ? key : null;
    }
    return key === "Escape" || key === "Enter" || F_KEY.test(key) ? key : null;
}

/**
 * `failed`：快捷键执行的命令失败时调用（与命令面板同一种告诉用户的方式）；诊断照记。
 */
export function createKeymapDispatcher(commands: CommandService, platform: KeyPlatform, report: (error: Error) => void, failed?: (id: string, failure: CommandFailure) => void): KeymapDispatcher {
    let bindings = new Map<string, string>();
    const reported = new Set<string>();
    const reportOnce = (key: string, message: string): void => {
        if (reported.has(key)) return;
        reported.add(key);
        report(new Error(message));
    };

    const rebuild = (): void => {
        const next = new Map<string, string>();
        for (const metadata of commands.list()) {
            const binding = metadata.keybinding;
            if (binding === undefined) continue;
            const parsed = parseKeybinding(binding, platform);
            if (!parsed.ok) {
                // 键位不合法只是不启用：命令仍可从面板执行。
                reportOnce(`invalid|${metadata.id}|${binding}`, `命令 ${metadata.id} 的默认键位不可用（${binding}）：${parsed.reason}`);
                continue;
            }
            const combination = combinationOf(parsed.value.key, parsed.value);
            const holder = next.get(combination);
            if (holder !== undefined) {
                // 同一组合按登记顺序保留首个；后来的不启用，首个不可用时也不回落到它。
                reportOnce(`conflict|${combination}|${metadata.id}`, `键位冲突：${metadata.id} 与 ${holder} 都声明 ${binding}，保留先登记的 ${holder}`);
                continue;
            }
            next.set(combination, metadata.id);
        }
        bindings = next;
    };

    let disposed = false;
    rebuild();
    const unsubscribe = commands.onDidChange(rebuild);

    return {
        handle(event) {
            if (disposed || event.repeat || event.isComposing || event.defaultPrevented) return;
            if (event.getModifierState?.("AltGraph") === true) return;
            const key = normalizeEventKey(event.key);
            if (key === null) return;
            const id = bindings.get(combinationOf(key, {ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey}));
            if (id === undefined || !commands.isEnabled(id).ok) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            void commands.execute(id, {}, {source: "user"}).then((result) => {
                if (result.ok) return;
                report(failureDiagnostic(id, result));
                failed?.(id, result);
            });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribe();
            bindings.clear();
        },
    };
}
