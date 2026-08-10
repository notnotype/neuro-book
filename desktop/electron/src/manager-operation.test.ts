import {describe, expect, it} from "vitest";

import {
    createSensitiveOutputGuard,
    managerInvocation,
    validateManagerOperation,
    type ManagerGuiOperation,
    type ManagerOperationBinding,
} from "./manager-operation";

const binding: ManagerOperationBinding = {
    installationId: "installation-1",
    installationRoot: "C:\\Program Files\\NeuroBook",
    manifestSha256: `sha256:${"a".repeat(64)}`,
    deleteData: false,
};

describe("Manager GUI typed operation contract", () => {
    it("maps independent runtime, Git and rg providers without accepting arbitrary CLI arguments", () => {
        const operation: ManagerGuiOperation = {
            kind: "install",
            source: {kind: "portable-archive", value: "C:\\Depot\\electron.zip"},
            scope: "machine",
            channel: "canary",
            runtimeProvider: "system",
            gitProvider: "managed",
            rgProvider: "system",
            addCliToPath: true,
            enableAuth: false,
        };

        expect(validateManagerOperation(operation)).toBe(operation);
        expect(managerInvocation(operation, binding).args).toEqual([
            "desktop", "install",
            "--archive", "C:\\Depot\\electron.zip",
            "--scope", "machine",
            "--channel", "canary",
            "--runtime-provider", "system",
            "--git-provider", "managed",
            "--rg-provider", "system",
            "--envelope", "electron",
            "--yes", "--json",
            "--add-cli-to-path",
        ]);
        expect(() => validateManagerOperation({
            ...operation,
            rgProvider: "arbitrary",
        } as unknown as ManagerGuiOperation)).toThrow("安装参数无效");
        expect(() => validateManagerOperation({
            ...operation,
            source: undefined,
        })).toThrow("安装参数无效");
    });

    it.each([
        ["portable-archive", "--archive", "C:\\Depot\\electron.zip"],
        ["aggregate-depot", "--depot", "C:\\Depot\\neuro-book-desktop-depot-win-x64.zip"],
        ["distribution-manifest", "--distribution-manifest", "C:\\Depot\\distribution.json"],
        ["https-manifest", "--distribution-manifest-url", "https://downloads.example/distribution.json"],
    ] as const)("maps the explicit %s source without extension guessing", (kind, flag, value) => {
        const operation: ManagerGuiOperation = {
            kind: "install",
            source: {kind, value},
            scope: "user",
            channel: "canary",
            runtimeProvider: "managed",
            gitProvider: "managed",
            rgProvider: "managed",
            addCliToPath: false,
            enableAuth: false,
        };
        expect(managerInvocation(operation, binding).args.slice(0, 4)).toEqual([
            "desktop", "install", flag, value,
        ]);
    });

    it.each([
        ["status", ["--root", binding.installationRoot, "status", "--json"]],
        ["doctor", ["--root", binding.installationRoot, "doctor", "--json"]],
        ["repair", ["--root", binding.installationRoot, "desktop", "repair", "--json"]],
    ] as const)("%s always binds the verified Installation Root", (kind, expected) => {
        expect(managerInvocation({kind}, binding).args).toEqual(expected);
    });

    it("binds provider persistence to the verified installation but keeps connectivity tests rootless", () => {
        const provider = {
            name: "Provider",
            baseURL: "https://provider.example/v1",
            api: "openai-responses",
            apiKey: "secret",
            model: "writer",
            discoverModels: true,
        };
        expect(managerInvocation({kind: "configure-provider", provider}, binding).args).toEqual([
            "--root", binding.installationRoot,
            "desktop", "configure-provider", "--stdin-json", "--json",
        ]);
        expect(managerInvocation({kind: "test-provider", provider}, binding).args).toEqual([
            "desktop", "test-provider", "--stdin-json", "--json",
        ]);
    });

    it("only adds delete-data for an explicit typed uninstall request", () => {
        expect(managerInvocation({kind: "uninstall", deleteData: false}, binding).args).not.toContain("--delete-data");
        expect(managerInvocation({kind: "uninstall", deleteData: true}, binding).args).toContain("--delete-data");
    });

    it("detects a Secret even when stdout splits it across lines or chunks", () => {
        const guard = createSensitiveOutputGuard(["密\n码"]);
        expect(() => guard?.check("prefix 密\n")).not.toThrow();
        expect(() => guard?.check("码 suffix\n")).toThrow("受保护 Secret");
        const escaped = createSensitiveOutputGuard(["密\n码"]);
        expect(() => escaped?.check('{"password":"密\\n码"}\n')).toThrow("受保护 Secret");
        expect(createSensitiveOutputGuard([])).toBeNull();
    });
});
