/**
 * 浏览器里的键位分发：把命令声明的默认键位编译成一张表，keydown 只查表与当前可用性（workbench.commands 的键位裁决）。
 *
 * 只实现单击组合（修饰词 + 一个主键）：chord、重复修饰、空键在解析时拒绝，不静默降级。修饰位按平台精确匹配，
 * Mod 在 mac 上是 Meta、其它平台是 Ctrl；多按或少按一个修饰键都是另一个组合，不会顺手命中某个绑定。
 *
 * 分发器不挂监听：挂在哪个元素、什么时候摘下归页面上的宿主（Lab 的命令场景、产品页的命令宿主）。
 */

import type {CommandResult, CommandService, Release} from "nbook/plugins/commands/shared/contracts";

export type KeyPlatform = "mac" | "other";

type Modifiers = {ctrl: boolean; meta: boolean; alt: boolean; shift: boolean};

type ParsedKeybinding = {key: string} & Modifiers;

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

const KEY_TOKEN = /^(?:[A-Z]|[0-9]|Escape|Enter|Space|F(?:[1-9]|1[0-2]))$/u;
const F_KEY = /^F(?:[1-9]|1[0-2])$/u;

function combinationOf(key: string, modifiers: Modifiers): string {
    return `${key}|${Number(modifiers.ctrl)}${Number(modifiers.meta)}${Number(modifiers.alt)}${Number(modifiers.shift)}`;
}

function invalid(reason: string): CommandResult<ParsedKeybinding> {
    return {ok: false, code: "invalid-args", reason};
}

export function parseKeybinding(binding: string, platform: KeyPlatform): CommandResult<ParsedKeybinding> {
    const tokens = binding.split("+");
    const key = tokens[tokens.length - 1] ?? "";
    if (!KEY_TOKEN.test(key)) return invalid(`键位主键不支持：${binding}`);
    const modifiers: Modifiers = {ctrl: false, meta: false, alt: false, shift: false};
    let hasMod = false;
    for (const token of tokens.slice(0, -1)) {
        if (token === "Mod") {
            if (hasMod) return invalid(`键位修饰词重复：${binding}`);
            hasMod = true;
            continue;
        }
        const flag = token === "Ctrl" ? "ctrl" : token === "Meta" ? "meta" : token === "Alt" ? "alt" : token === "Shift" ? "shift" : null;
        if (flag === null) return invalid(`未登记的键位修饰词：${token}`);
        if (modifiers[flag]) return invalid(`键位修饰词重复：${binding}`);
        modifiers[flag] = true;
    }
    if (hasMod) {
        // Mod 映射后可能与显式修饰词重合（例如 Windows 上的 Mod+Ctrl）：拒绝而不是猜。
        const mapped = platform === "mac" ? "meta" : "ctrl";
        if (modifiers[mapped]) return invalid(`Mod 与显式修饰词在 ${platform} 上重复：${binding}`);
        modifiers[mapped] = true;
    }
    return {ok: true, value: {key, ...modifiers}};
}

/** macOS 的修饰键符号，按系统菜单的次序（Control、Option、Shift、Command）。 */
const MAC_MODIFIERS = [["ctrl", "⌃"], ["alt", "⌥"], ["shift", "⇧"], ["meta", "⌘"]] as const;
/** 其它平台的写法与次序。 */
const OTHER_MODIFIERS = [["ctrl", "Ctrl"], ["meta", "Meta"], ["alt", "Alt"], ["shift", "Shift"]] as const;

/**
 * 键位按平台写给人看（docs/specs/workbench/commands.md 的“快捷键的显示”）：macOS 用 `⌃⌥⇧⌘` 符号连写（`Mod+Shift+P`
 * 写作 `⇧⌘P`），其它平台写 `Ctrl+Shift+P`。命令面板、应用菜单与命令搜索按钮共用；解析不了的键位原样返回。
 */
export function formatKeybinding(binding: string, platform: KeyPlatform): string {
    const parsed = parseKeybinding(binding, platform);
    if (!parsed.ok) return binding;
    const key = parsed.value.key;
    if (platform === "mac") return MAC_MODIFIERS.filter(([flag]) => parsed.value[flag]).map(([, symbol]) => symbol).join("") + key;
    return [...OTHER_MODIFIERS.filter(([flag]) => parsed.value[flag]).map(([, name]) => name), key].join("+");
}

/** 事件键归一：字母按大写比较（按住 Shift 时浏览器给大写），空格与 Esc 有别名，其它不参与键位。 */
function normalizeEventKey(key: string): string | null {
    if (key === " " || key === "Spacebar") return "Space";
    if (key === "Esc") return "Escape";
    if (key.length === 1) {
        if (key >= "a" && key <= "z") return key.toUpperCase();
        return (key >= "A" && key <= "Z") || (key >= "0" && key <= "9") ? key : null;
    }
    return key === "Escape" || key === "Enter" || F_KEY.test(key) ? key : null;
}

export function createKeymapDispatcher(commands: CommandService, platform: KeyPlatform, report: (error: Error) => void): KeymapDispatcher {
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
                if (!result.ok) report(new Error(`命令 ${id} 执行失败：${result.reason}`));
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

/** Mod 的平台口径：macOS 与 iOS 上是 Meta，其它平台是 Ctrl。`userAgentData` 只有 Chromium 系浏览器有，其余回退 `platform`。 */
export function currentKeyPlatform(): KeyPlatform {
    const browser = globalThis.navigator as {readonly userAgentData?: {readonly platform?: string}; readonly platform?: string} | undefined;
    const platform = browser?.userAgentData?.platform ?? browser?.platform ?? "";
    return /mac|iphone|ipad/iu.test(platform) ? "mac" : "other";
}
