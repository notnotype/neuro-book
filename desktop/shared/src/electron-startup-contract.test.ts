import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

import {describe, expect, it} from "vitest";

describe("Electron startup recovery contract", () => {
    it("在配置/locator 错误时先显示启动页，再等待 Retry/Repair/Quit", async () => {
        const source = await readFile(resolve("desktop/electron/src/main.ts"), "utf8");
        const headlessIndex = source.indexOf("const headless =");
        const readConfigIndex = source.indexOf("config = readConfig();");
        expect(headlessIndex).toBeGreaterThan(-1);
        expect(readConfigIndex).toBeGreaterThan(headlessIndex);
        expect(source).toContain("startupFallbackConfig");
        expect(source).toContain("await createInteractiveWindow(config)");
        expect(source).toContain("while (configError)");
        expect(source).toContain("recoverStartup(config, configError)");
        expect(source).toContain("await closeApplication({kind: \"electron-startup-failure\"");
    });
});
