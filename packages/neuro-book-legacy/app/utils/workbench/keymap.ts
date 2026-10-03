/**
 * 最小键位分发：把命令声明的默认键位编译成一张表，keydown 只查表与当前 when。
 *
 * 只实现单击组合（修饰词 + 一个主键）：chord、重复修饰、空键在解析期拒绝，不静默降级。
 * 修饰位按平台精确匹配——Mod 在 mac 是 Meta、其它平台是 Ctrl；多按或少按一个修饰键都算另一回事，
 * 不会「顺手」命中某个绑定。
 */
import type {CommandRegistry, CommandResult, Release} from "nbook/app/utils/workbench/commands";

type Modifiers = {ctrl: boolean; meta: boolean; alt: boolean; shift: boolean};

type ParsedKeybinding = {key: string} & Modifiers;

const KEY_TOKEN = /^(?:[A-Z]|[0-9]|Escape|Enter|Space|F(?:[1-9]|1[0-2]))$/u;
const F_KEY = /^F(?:[1-9]|1[0-2])$/u;

function combinationOf(key: string, modifiers: Modifiers): string {
    return `${key}|${Number(modifiers.ctrl)}${Number(modifiers.meta)}${Number(modifiers.alt)}${Number(modifiers.shift)}`;
}

function invalid(reason: string): CommandResult<ParsedKeybinding> {
    return {ok: false, code: "invalid-args", reason};
}

export function parseKeybinding(
    binding: string,
    platform: "mac" | "other",
): CommandResult<ParsedKeybinding> {
    const tokens = binding.split("+");
    const key = tokens[tokens.length - 1] ?? "";
    if (!KEY_TOKEN.test(key)) {
        return invalid(`键位主键不支持：${binding}`);
    }

    const modifiers: Modifiers = {ctrl: false, meta: false, alt: false, shift: false};
    let hasMod = false;
    for (const token of tokens.slice(0, -1)) {
        if (token === "Mod") {
            if (hasMod) {
                return invalid(`键位修饰词重复：${binding}`);
            }
            hasMod = true;
            continue;
        }
        const flag = token === "Ctrl" ? "ctrl"
            : token === "Meta" ? "meta"
                : token === "Alt" ? "alt"
                    : token === "Shift" ? "shift"
                        : null;
        if (flag === null) {
            return invalid(`未登记的键位修饰词：${token}`);
        }
        if (modifiers[flag]) {
            return invalid(`键位修饰词重复：${binding}`);
        }
        modifiers[flag] = true;
    }

    if (hasMod) {
        // Mod 映射后的最终修饰位可能与显式修饰词重合（如 Windows 下 Mod+Ctrl）：拒绝而不是猜。
        const mapped = platform === "mac" ? "meta" : "ctrl";
        if (modifiers[mapped]) {
            return invalid(`Mod 与显式修饰词在 ${platform} 上重复：${binding}`);
        }
        modifiers[mapped] = true;
    }

    return {ok: true, value: {key, ...modifiers}};
}

/** 事件键归一：字母按大写比较，空格与 Esc 有别名，其它保持原样。 */
function normalizeEventKey(key: string): string | null {
    if (key === " " || key === "Spacebar") {
        return "Space";
    }
    if (key.length === 1) {
        if (key >= "a" && key <= "z") {
            return key.toUpperCase();
        }
        if ((key >= "A" && key <= "Z") || (key >= "0" && key <= "9")) {
            return key;
        }
        return null;
    }
    if (key === "Esc") {
        return "Escape";
    }
    if (key === "Escape" || key === "Enter" || F_KEY.test(key)) {
        return key;
    }
    return null;
}

export function createKeymapDispatcher(
    registry: CommandRegistry,
    platform: "mac" | "other",
    report: (error: Error) => void,
): {handle: (event: KeyboardEvent) => void; dispose: Release} {
    let bindings = new Map<string, string>();
    const conflicted = new Set<string>();
    const reportedInvalid = new Set<string>();

    const rebuild = (): void => {
        const next = new Map<string, string>();
        for (const metadata of registry.getAllCommands()) {
            const binding = metadata.defaultKeybinding;
            if (binding === undefined) {
                continue;
            }
            const parsed = parseKeybinding(binding, platform);
            if (!parsed.ok) {
                // 非法键位只是不启用：命令仍可从按钮 / 面板执行，metadata 不被改写。
                const invalidKey = `${metadata.id}|${binding}`;
                if (!reportedInvalid.has(invalidKey)) {
                    reportedInvalid.add(invalidKey);
                    report(new Error(`命令 ${metadata.id} 的默认键位不可用（${binding}）：${parsed.reason}`));
                }
                continue;
            }
            const combination = combinationOf(parsed.value.key, parsed.value);
            const holder = next.get(combination);
            if (holder !== undefined) {
                // 同键冲突按注册顺序保留首个；后来的不启用、也不回落到别的命令。
                const conflictKey = `${combination}|${metadata.id}`;
                if (!conflicted.has(conflictKey)) {
                    conflicted.add(conflictKey);
                    report(new Error(`键位冲突：${metadata.id} 与 ${holder} 都声明 ${binding}，保留先注册的 ${holder}`));
                }
                continue;
            }
            next.set(combination, metadata.id);
        }
        bindings = next;
    };

    const handle = (event: KeyboardEvent): void => {
        if (event.repeat || event.isComposing || event.defaultPrevented) {
            return;
        }
        if (typeof event.getModifierState === "function" && event.getModifierState("AltGraph")) {
            return;
        }
        const key = normalizeEventKey(event.key);
        if (key === null) {
            return;
        }
        const id = bindings.get(combinationOf(key, {
            ctrl: event.ctrlKey,
            meta: event.metaKey,
            alt: event.altKey,
            shift: event.shiftKey,
        }));
        if (id === undefined) {
            return;
        }
        const enabled = registry.isCommandEnabled(id);
        if (!enabled.ok || enabled.value !== true) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        void registry.executeCommand(id, {}, {source: "user"}).then((result) => {
            if (!result.ok) {
                report(new Error(`命令 ${id} 执行失败：${result.reason}`));
            }
        });
    };

    rebuild();
    const unsubscribe = registry.onDidChange(rebuild);
    let disposed = false;

    return {
        handle,
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            unsubscribe();
            bindings.clear();
        },
    };
}
