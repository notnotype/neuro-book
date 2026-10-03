import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const accountMenuPath = fileURLToPath(new URL("../NovelIdeAccountMenu.vue", import.meta.url));
const activityBarPath = fileURLToPath(new URL("../NovelIdeActivityBar.vue", import.meta.url));
const pickerPath = fileURLToPath(new URL("../ProjectPickerScreen.vue", import.meta.url));
const profileDialogPath = fileURLToPath(new URL("../NovelIdeProfileDialog.vue", import.meta.url));
const profilePanelPath = fileURLToPath(new URL("./NovelIdePassportProfilePanel.vue", import.meta.url));
const indexPagePath = fileURLToPath(new URL("../../../pages/index.vue", import.meta.url));

describe("Novel IDE profile frontend contract", () => {
    it("Activity Bar 在 Project 与书架页复用同一账户菜单", async () => {
        const [accountMenu, activityBar, picker, indexPage] = await Promise.all([
            readFile(accountMenuPath, "utf8"),
            readFile(activityBarPath, "utf8"),
            readFile(pickerPath, "utf8"),
            readFile(indexPagePath, "utf8"),
        ]);

        expect(accountMenu).toContain("props.currentUser?.role === \"admin\"");
        expect(accountMenu).toContain("ide.header.localLogout");
        expect(activityBar).toContain("<NovelIdeAccountMenu");
        expect(activityBar).not.toContain("const userMenuItems");
        expect(picker).not.toContain("<slot name=\"header-actions\"></slot>");
        expect(picker).not.toContain("/api/auth/");
        expect(indexPage).not.toContain("<template #header-actions>");
        expect(indexPage).toContain("<NovelIdeActivityBar");
        expect(indexPage).toContain(':current-user="currentUser"');
    });

    it("Profile 文件归属和命名不再依赖设置面板", async () => {
        const dialog = await readFile(profileDialogPath, "utf8");
        expect(dialog).toContain("profile/NovelIdePassportProfilePanel.vue");
        expect(dialog).toContain("<NovelIdePassportProfilePanel />");
        expect(dialog).not.toContain("NovelIdePassportSettingsPanel");
    });

    it("关联状态具有 loading、error、loaded 三态且错误可重试", async () => {
        const panel = await readFile(profilePanelPath, "utf8");
        expect(panel).toContain("const statusError = ref(\"\")");
        expect(panel).toContain("statusError.value = \"\";");
        expect(panel).toContain("status.value = null;");
        expect(panel).toContain("statusError.value = resolveApiErrorMessage(error, t(\"ide.profile.loadFailed\"))");
        expect(panel).toContain("v-if=\"statusLoading && !status\"");
        expect(panel).toContain("v-else-if=\"statusError\"");
        expect(panel).toContain("v-else-if=\"status\"");
        expect(panel).toContain("@click=\"void loadStatus()\"");
    });
});
