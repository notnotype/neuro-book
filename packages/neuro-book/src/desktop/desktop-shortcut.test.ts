/**
 * 桌面快捷方式的判定与串行同步（desktop-shortcut.ts、install-facts.ts）。端口换成一个在临时目录里建、删文件的实现：它和 Windows
 * 端口一样先看现状再动手，每次动作可以停在关卡上，用来造出“前一个还在做、又来了新的值”的交错。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtemp, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {createShortcutSync, desktopShortcutAction} from "./desktop-shortcut";
import type {ShortcutAction, ShortcutPort, ShortcutResult} from "./desktop-shortcut";
import {isInstalledRun} from "./install-facts";

describe("要不要动桌面快捷方式", () => {
    it("关着时每次都确保没有，包括这次运行第一次收到的值", () => {
        expect(desktopShortcutAction({value: false, previous: null, applies: true})).toBe("ensure-absent");
        expect(desktopShortcutAction({value: false, previous: false, applies: true})).toBe("ensure-absent");
        expect(desktopShortcutAction({value: false, previous: true, applies: true})).toBe("ensure-absent");
    });

    it("只有这次运行里从关改成开才补建；启动时就是开的不补", () => {
        expect(desktopShortcutAction({value: true, previous: false, applies: true})).toBe("ensure-present");
        expect(desktopShortcutAction({value: true, previous: null, applies: true})).toBeNull();
        expect(desktopShortcutAction({value: true, previous: true, applies: true})).toBeNull();
    });

    it("不是安装版或状态根不是缺省位置时什么都不做", () => {
        for (const value of [true, false]) {
            for (const previous of [null, true, false]) expect(desktopShortcutAction({value, previous, applies: false})).toBeNull();
        }
    });
});

describe("算不算安装版", () => {
    const channelRoot = "C:\\Users\\me\\AppData\\Local\\io.github.notnotype.neurobook\\stable";
    const execPath = `${channelRoot}\\app\\bin\\bun.exe`;
    const base = {channel: "stable", portable: false, channelRoot, execPath, platform: "win32"};

    it("稳定频道、没有便携标记、程序在通道根的 app\\bin 里：是（大小写不同也是）", () => {
        expect(isInstalledRun(base)).toBe(true);
        expect(isInstalledRun({...base, execPath: execPath.toUpperCase()})).toBe(true);
        expect(isInstalledRun({...base, channel: "canary", channelRoot: channelRoot.replace("stable", "canary"), execPath: execPath.replace("stable", "canary")})).toBe(true);
    });

    it("开发构建、便携、取不到通道根、程序不在通道根里：都不是", () => {
        expect(isInstalledRun({...base, channel: "dev"})).toBe(false);
        expect(isInstalledRun({...base, channel: ""})).toBe(false);
        expect(isInstalledRun({...base, portable: true})).toBe(false);
        expect(isInstalledRun({...base, channelRoot: null})).toBe(false);
        expect(isInstalledRun({...base, execPath: "D:\\NeuroBook\\bin\\bun.exe"})).toBe(false);
        expect(isInstalledRun({...base, execPath: `${channelRoot}\\app\\bin\\nested\\bun.exe`})).toBe(false);
    });
});

/** 在 `file` 上建、删一个文件的端口；`gate` 不为 null 时，看完现状后停在那里等放行（模拟 PowerShell 还没跑完）。 */
function filePort(file: string): ShortcutPort & {readonly calls: ShortcutAction[]; gate: Promise<void> | null} {
    const port = {
        calls: [] as ShortcutAction[],
        gate: null as Promise<void> | null,
        async apply(action: ShortcutAction, signal: AbortSignal): Promise<ShortcutResult> {
            port.calls.push(action);
            const exists = await stat(file).then(() => true, () => false);
            if (port.gate !== null) {
                const gate = port.gate;
                const aborted = new Promise<"aborted">((resolve) => signal.addEventListener("abort", () => resolve("aborted"), {once: true}));
                if (await Promise.race([gate.then(() => "open" as const), aborted]) === "aborted") return {ok: false, reason: "aborted"};
            }
            if (action === "ensure-absent") {
                if (!exists) return {ok: true, outcome: "absent"};
                await rm(file);
                return {ok: true, outcome: "removed"};
            }
            if (exists) return {ok: true, outcome: "present"};
            await writeFile(file, "lnk");
            return {ok: true, outcome: "created"};
        },
    };
    return port;
}

function deferred(): {promise: Promise<void>; resolve: () => void} {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return {promise, resolve};
}

const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

describe("串行同步", () => {
    let tmp: string;
    let file: string;
    beforeEach(async () => {
        tmp = await mkdtemp(join(tmpdir(), "nbook-shortcut-"));
        file = join(tmp, "NeuroBook.lnk");
    });
    afterEach(async () => {
        await rm(tmp, {recursive: true, force: true});
    });

    it("前一个还在做时连改几次：只做最新的那一个，桌面上的结果跟最后的值一致", async () => {
        const port = filePort(file);
        const lines: string[] = [];
        const sync = createShortcutSync(port, (line) => lines.push(line));
        const gate = deferred();
        port.gate = gate.promise;
        sync.request("ensure-present");
        sync.request("ensure-absent");
        sync.request("ensure-present");
        sync.request("ensure-absent");
        port.gate = null;
        gate.resolve();
        while (lines.length < 2) await new Promise((resolve) => setTimeout(resolve, 1));
        await sync.close(5_000);
        expect(port.calls).toEqual(["ensure-present", "ensure-absent"]);
        expect(await exists(file)).toBe(false);
        expect(lines).toEqual(["desktop.shortcut.created action=ensure-present", "desktop.shortcut.removed action=ensure-absent"]);
    });

    it("关闭时等在做的那一次做完；之后的请求不接", async () => {
        const port = filePort(file);
        const sync = createShortcutSync(port, () => {});
        const gate = deferred();
        port.gate = gate.promise;
        sync.request("ensure-present");
        const closing = sync.close(5_000);
        sync.request("ensure-absent");
        gate.resolve();
        await closing;
        expect(port.calls).toEqual(["ensure-present"]);
        expect(await exists(file)).toBe(true);
    });

    it("在做的那一次过了截止还没完：abort 它，等它结束后关闭才完成", async () => {
        const port = filePort(file);
        const lines: string[] = [];
        const sync = createShortcutSync(port, (line) => lines.push(line));
        port.gate = new Promise<void>(() => {});
        sync.request("ensure-present");
        await sync.close(20);
        expect(lines).toEqual(["desktop.shortcut.failed action=ensure-present aborted"]);
        expect(await exists(file)).toBe(false);
    });

    it("端口抛错时记失败，后面的动作照做", async () => {
        const lines: string[] = [];
        let first = true;
        const sync = createShortcutSync({
            async apply() {
                if (first) {
                    first = false;
                    throw new Error("powershell missing");
                }
                return {ok: true, outcome: "absent"};
            },
        }, (line) => lines.push(line));
        sync.request("ensure-absent");
        while (lines.length < 1) await Promise.resolve();
        sync.request("ensure-absent");
        while (lines.length < 2) await Promise.resolve();
        await sync.close(5_000);
        expect(lines).toEqual(["desktop.shortcut.failed action=ensure-absent powershell missing", "desktop.shortcut.absent action=ensure-absent"]);
    });
});
