import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const settingsDialogPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeSettingsDialog.vue", import.meta.url));

async function readDialog(): Promise<string> {
    return (await readFile(settingsDialogPath, "utf8")).replace(/\r\n/g, "\n");
}

describe("Novel IDE Settings Current Project contract", () => {
    it("Project scope 只消费当前已打开的 Project，不读取或选择 Catalog", async () => {
        const source = await readDialog();

        expect(source).not.toContain("loadProjects(");
        expect(source).not.toContain("selectTargetNovel");
        expect(source).toContain('activeScope.value === "project" && novelIdeStore.currentProjectRoot');
        expect(source).toContain("projectRoot: novelIdeStore.currentProjectRoot");
        expect(source).toContain('novelIdeStore.currentNovel?.title || novelIdeStore.currentProjectRoot || "Project Workspace"');
    });

    it("设置界面不提供项目切换：项目作用域只消费当前已打开的 Project", async () => {
        const source = await readDialog();

        // 切换项目是标题栏/书架的事；设置里不做项目选择，也不显示配置目标标签。
        expect(source).not.toContain("projectOptions");
        expect(source).not.toContain("switchToNovelWorkspace(");
        expect(source).not.toContain("ProjectSwitcher");
        expect(source).not.toContain(":target-label");
    });

    it("没有当前 Project 或位于 user-assets 时拒绝进入 Project scope", async () => {
        const source = await readDialog();

        expect(source).toContain('const projectScopeAvailable = computed(() => novelIdeStore.workspaceKind !== "user-assets"');
        expect(source).toContain('if (scope === "project" && !projectScopeAvailable.value)');
        expect(source).toContain('([workspaceKind, currentProjectRoot]) => {');
        expect(source).toContain('(workspaceKind === "user-assets" || !currentProjectRoot) && activeScope.value === "project"');
        // 「项目」档在不可进入时带禁用原因，用户能直接看到为什么进不去。
        expect(source).toContain('disabledReason: projectScopeAvailable.value ? undefined : t("settings.scope.project.unavailable")');
    });
});
