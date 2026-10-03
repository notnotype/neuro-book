import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const dialogPath = fileURLToPath(new URL("./BackupRecoveryCodeDialog.vue", import.meta.url));
const panelPath = fileURLToPath(new URL("./NovelIdePassportProfilePanel.vue", import.meta.url));

describe("backup recovery code frontend contract", () => {
    it("复制或下载至少一项成功并明确勾选后才允许确认", async () => {
        const dialog = await readFile(dialogPath, "utf8");
        expect(dialog).toContain("deliverySucceeded.value && acknowledged.value && Boolean(recoveryCode.value)");
        expect(dialog).toContain("await navigator.clipboard.writeText(recoveryCode.value)");
        expect(dialog).toContain("error.value = t(\"ide.profile.keys.copyFailed\")");
        expect(dialog).toContain("anchor.download = `neurobook-backup-recovery-${shownKeyId.value}.txt`");
        expect(dialog.match(/deliverySucceeded\.value = true/g)).toHaveLength(2);
        expect(dialog).toContain(":disabled=\"busy || !canConfirmPreparedKey\"");
    });

    it("取消只关闭 Dialog，确认后才调用 active 接口", async () => {
        const dialog = await readFile(dialogPath, "utf8");
        const closeBody = dialog.slice(dialog.indexOf("function close()"), dialog.indexOf("async function copyRecoveryCode"));
        expect(closeBody).not.toContain("/api/passport/backup-keys/confirm");
        expect(closeBody).not.toContain("/api/passport/backups");
        expect(dialog).toContain("/api/passport/backup-keys/prepare");
        expect(dialog).toContain("/api/passport/backup-keys/confirm");
    });

    it("首次备份先确认 key，缺失恢复 key 时先导入，密码复验导出留在专用 Dialog", async () => {
        const panel = await readFile(panelPath, "utf8");
        const dialog = await readFile(dialogPath, "utf8");
        expect(panel).toContain("if (!backupKeys.value?.activeKeyId)");
        expect(panel).toContain("backupAfterKeyConfirm.value = true");
        expect(panel).toContain("if (!backupKeys.value?.keys.some((key) => key.keyId === backup.keyId))");
        expect(panel).toContain("openKeyDialog(\"import\", backup.keyId)");
        expect(panel).not.toContain("recoveryCode");
        expect(dialog).toContain("body: {keyId: props.keyId, password: password.value}");
        expect(dialog).not.toContain("useNotification");
    });
});
