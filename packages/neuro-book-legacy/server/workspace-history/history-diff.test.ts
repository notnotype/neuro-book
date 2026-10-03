import {describe, expect, it} from "vitest";
import {isSensitiveHistoryDiffPath, readWorkspaceHistoryDiff} from "nbook/server/workspace-history/history-diff";
import type {WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";

describe("workspace history diff security", () => {
    it("服务端阻断环境变量、凭据与私钥路径", () => {
        for (const path of [
            ".env",
            "config/.env.production",
            "config/.env-production",
            "config/production.env",
            ".envrc",
            ".git-credentials",
            ".NPMRC",
            "config/.pypirc",
            "home/.netrc",
            ".aws/credentials",
            ".AZURE/config",
            ".kube/config",
            ".docker/config.json",
            ".gnupg/private-keys-v1.d/key",
            "credentials",
            "credentials.json",
            "service-account.json",
            "service_account_key.json",
            "application_default_credentials.json",
            "application-default-credentials.json",
            "id_rsa",
            "ID_DSA",
            "id_ecdsa",
            "id_ed25519",
            "certs/server.pem",
            "certs/server.KEY",
            "certs/client.p12",
            "certs/client.pfx",
            "certs/app.jks",
            "certs/app.keystore",
            ".ssh/id_ed25519.pub",
            "Secrets\\ID_RSA",
        ]) {
            expect(isSensitiveHistoryDiffPath(path), path).toBe(true);
        }
    });

    it("普通创作文件与安全近似名称不被宽泛误拦", () => {
        for (const path of [
            "manuscript/chapter-1.md",
            "manuscript/secrets-of-magic.md",
            "lorebook/credential-system.md",
            "certs/public.crt",
            "notes/.env-guide.md",
            "notes/.env-example.txt",
            "notes/environment.md",
            "characters/service-accountant.md",
            "characters/credentials-officer.md",
            "certs/public.pem.md",
            "notes/id_rsa-history.md",
        ]) {
            expect(isSensitiveHistoryDiffPath(path), path).toBe(false);
        }
    });

    it("敏感路径不会读取 snapshot body，也不会返回正文", async () => {
        let textDiffCalled = false;
        const result = await readWorkspaceHistoryDiff({
            history: {
                async textDiff() {
                    textDiffCalled = true;
                    return {available: true, changes: [], beforeText: "SECRET_OLD", afterText: "SECRET_NEW"};
                },
            },
            group: group(".env"),
            mode: "full",
        });

        expect(textDiffCalled).toBe(false);
        expect(result).toEqual({status: "blocked", reason: "sensitive_path"});
        expect(JSON.stringify(result)).not.toContain("SECRET");
    });

    it("inline 模式对大 diff 只返回统计，不返回正文", async () => {
        const largeText = "line\n".repeat(200);
        const result = await readWorkspaceHistoryDiff({
            history: {
                async textDiff() {
                    return {
                        available: true,
                        changes: [{value: largeText, added: true, count: 200}],
                        beforeText: "",
                        afterText: largeText,
                    };
                },
            },
            group: group("manuscript/chapter-1.md"),
            mode: "inline",
        });

        expect(result.status).toBe("too_large");
        expect(JSON.stringify(result)).not.toContain("line\\nline");
    });

    it("安全小 diff 返回 Monaco 与内联预览共用的数据", async () => {
        const result = await readWorkspaceHistoryDiff({
            history: {
                async textDiff() {
                    return {
                        available: true,
                        changes: [
                            {value: "old\n", removed: true, count: 1},
                            {value: "new\n", added: true, count: 1},
                        ],
                        beforeText: "old\n",
                        afterText: "new\n",
                    };
                },
            },
            group: group("manuscript/chapter-1.md"),
            mode: "inline",
        });

        expect(result).toMatchObject({
            status: "available",
            original: "old\n",
            modified: "new\n",
            changedLineCount: 2,
        });
    });
});

function group(path: string): WorkspaceHistoryInboxGroupDto {
    return {
        path,
        revision: 1,
        baseHash: "before",
        endHash: "after",
        entries: [],
    };
}
