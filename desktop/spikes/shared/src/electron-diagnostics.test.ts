import {EventEmitter} from "node:events";
import {mkdir, mkdtemp, readFile, rm} from "node:fs/promises";
import {resolve} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {ElectronDiagnostics} from "nbook/desktop/spikes/electron/src/diagnostics";

class BrokenPipeStream extends EventEmitter {
    writes = 0;

    write(): boolean {
        this.writes += 1;
        this.emit("error", Object.assign(new Error("broken pipe"), {code: "EPIPE"}));
        return false;
    }
}

describe("Electron diagnostics", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("stdout 断开时不让 GUI 主进程崩溃，并继续把诊断写入 State Root 日志", async () => {
        const parent = resolve(".agent", "tmp");
        await mkdir(parent, {recursive: true});
        const root = await mkdtemp(resolve(parent, "electron-diagnostics-"));
        roots.push(root);
        const stdout = new BrokenPipeStream();
        const diagnostics = new ElectronDiagnostics({stdout, stderr: null});
        diagnostics.setLogRoot(root);

        expect(() => diagnostics.info({kind: "electron-startup-stage", stage: "启动本地服务..."})).not.toThrow();
        expect(() => diagnostics.info({kind: "electron-window-ready", elapsedMs: 123})).not.toThrow();
        await diagnostics.flush();

        expect(stdout.writes).toBe(1);
        const lines = (await readFile(resolve(root, "desktop-envelope-current.jsonl"), "utf8"))
            .trim()
            .split(/\r?\n/u)
            .map((line) => JSON.parse(line) as {level: string; kind: string});
        expect(lines).toEqual([
            expect.objectContaining({level: "info", kind: "electron-startup-stage"}),
            expect.objectContaining({level: "info", kind: "electron-window-ready"}),
        ]);
    });
});
