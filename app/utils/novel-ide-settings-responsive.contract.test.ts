import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const settingsDialogPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeSettingsDialog.vue", import.meta.url));

describe("Novel IDE Settings responsive contract", () => {
    it("窄屏使用横向导航和上下布局，桌面保留侧栏", async () => {
        const source = (await readFile(settingsDialogPath, "utf8")).replace(/\r\n/g, "\n");

        expect(source).toContain("flex-col gap-4 md:flex-row md:gap-6");
        expect(source).toContain("w-full min-w-0 flex-col pb-2 md:w-[220px] md:shrink-0");
        expect(source).toContain("gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0");
        expect(source).toContain("hidden truncate text-[10px] text-[var(--text-muted)] md:block");
        expect(source).toContain("mt-auto hidden pt-4 md:block");
    });
});
