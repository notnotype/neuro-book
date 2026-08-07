import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("Manager GUI shared Electron payload contract", () => {
    it("uses a separate GUI entry but the same Electron runtime and secure preload", async () => {
        const build = await readFile(resolve("desktop/spikes/electron/build.mjs"), "utf8");
        const main = await readFile(resolve("desktop/spikes/electron/src/main.ts"), "utf8");
        const manager = await readFile(resolve("desktop/spikes/electron/src/manager-main.ts"), "utf8");
        const preload = await readFile(resolve("desktop/spikes/electron/src/manager-preload.ts"), "utf8");
        const html = await readFile(resolve("desktop/spikes/electron/src/manager.html"), "utf8");
        const packager = await readFile(resolve("desktop/spikes/package-portable.mjs"), "utf8");

        expect(build).toContain('naming: "manager-main.mjs"');
        expect(build).toContain('naming: "manager-preload.cjs"');
        expect(main).toContain("--manager-gui");
        expect(manager).toContain("nodeIntegration: false");
        expect(manager).toContain("contextIsolation: true");
        expect(manager).toContain('"manager:run"');
        expect(preload).toContain("contextBridge.exposeInMainWorld");
        expect(manager).toContain("AUTH_ADMIN_PASSWORD: undefined");
        expect(manager).toContain("validateSecretPipeHello");
        expect(manager).toContain("desktop-repair");
        expect(manager).toContain('return "uninstall"');
        expect(manager).toContain("windowsCommandLineQuote");
        expect(manager).toContain("UAC 未批准或提升进程未连接");
        expect(packager).toContain('join(envelopeDist, "manager-main.mjs")');
        expect(packager).toContain('join(envelopeDist, "manager-preload.cjs")');
        expect(packager).toContain("NeuroBook-Manager.cmd");
        expect(html).toContain("校验并安装");
        expect(html).toContain("--password-stdin");
        expect(html).toContain('$("adminPassword").value = ""');
        expect(html).toContain('id="apiKey" type="password"');
        expect(html).toContain('value="openai-responses"');
        expect(html).not.toContain('id="api" value="openai-completions"');
    });
});
