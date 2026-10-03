import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const pickerPath = fileURLToPath(new URL("../components/novel-ide/ProjectPickerScreen.vue", import.meta.url));

describe("Project Picker Session recovery contract", () => {
    it("首次展开后才按 recovery filter 读取第一页", async () => {
        const picker = await readFile(pickerPath, "utf8");

        expect(picker).toContain("if (recoveryExpanded.value && !recoveryLoaded.value)");
        expect(picker).toContain("await loadRecoverySessions(0, false)");
        expect(picker).toContain('scope: "all"');
        expect(picker).toContain('recovery: "required"');
        expect(picker).toContain("limit: RECOVERY_PAGE_SIZE");
    });

    it("沿用 nextOffset/hasMore 分页，并支持 Project 与 Workspace Root 两种恢复", async () => {
        const picker = await readFile(pickerPath, "utf8");

        expect(picker).toContain("recoveryOffset.value = page.nextOffset ?? offset + page.items.length");
        expect(picker).toContain("recoveryHasMore.value = page.hasMore");
        expect(picker).toContain("loadRecoverySessions(recoveryOffset, true)");
        expect(picker).toContain("projectRoot: workspaceRoot ? null : target");
        expect(picker).toContain("sessionApi.updateSessionCurrentProject(session.sessionId");
    });

    it("追加页按 sessionId 去重，恢复一项后同步前移下一页 offset", async () => {
        const picker = await readFile(pickerPath, "utf8");

        expect(picker).toContain("const knownSessionIds = new Set(recoverySessions.value.map((session) => session.sessionId));");
        expect(picker).toContain("page.items.filter((session) => !knownSessionIds.has(session.sessionId))");
        expect(picker).toContain("recoveryOffset.value = Math.max(0, recoveryOffset.value - 1);");
    });
});
