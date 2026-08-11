import {Buffer} from "node:buffer";

import {DESKTOP_UAC_MAX_SECRET_BYTES} from "nbook/shared/desktop-uac-broker";

export type ManagerGuiProvider = "managed" | "system";
export type ManagerGuiScope = "user" | "machine";
export type ManagerGuiChannel = "stable" | "canary";
export type ManagerGuiInstallSource =
    | {kind: "portable-archive"; value: string}
    | {kind: "aggregate-depot"; value: string}
    | {kind: "distribution-manifest"; value: string}
    | {kind: "https-manifest"; value: string};
export type ManagerGuiLocalSourceKind = Exclude<ManagerGuiInstallSource["kind"], "https-manifest">;

export type ManagerGuiProviderInput = {
    name: string;
    baseURL: string;
    api: string;
    apiKey: string;
    model: string;
    discoverModels?: boolean;
};

export type ManagerGuiProviderTestResult = {
    ok: boolean;
    status: number | null;
    warning: string | null;
    discoverySupported: boolean;
    models: string[] | null;
};

export type ManagerRunResult = {
    exitCode: number | null;
    signal: string | null;
    installationRoot?: string;
    providerTest?: ManagerGuiProviderTestResult;
};

export type ManagerOperationBinding = {
    installationId: string | null;
    installationRoot: string;
    manifestSha256: string | null;
    deleteData: boolean;
};

export type ManagerCliInvocation = {
    args: string[];
    stdin?: string;
    sensitiveValues?: string[];
};

export type SensitiveOutputGuard = {
    check(fragment: string): void;
};

export type ManagerGuiOperation =
    | {
        kind: "install";
        source: ManagerGuiInstallSource;
        scope: ManagerGuiScope;
        channel: ManagerGuiChannel;
        runtimeProvider: ManagerGuiProvider;
        gitProvider: ManagerGuiProvider;
        rgProvider: ManagerGuiProvider;
        addCliToPath: boolean;
        enableAuth: boolean;
        adminPassword?: string;
    }
    | {kind: "status"}
    | {kind: "doctor"}
    | {kind: "repair"}
    | {kind: "uninstall"; deleteData: boolean}
    | {kind: "configure-provider"; provider: ManagerGuiProviderInput}
    | {kind: "test-provider"; provider: ManagerGuiProviderInput};

export function validateManagerOperation(input: unknown): ManagerGuiOperation {
    if (!input || typeof input !== "object" || !("kind" in input) || typeof input.kind !== "string") {
        throw new Error("Manager GUI 操作无效。");
    }
    const value = input as ManagerGuiOperation;
    switch (value.kind) {
        case "install": {
            const source = value.source;
            if ((value.scope !== "user" && value.scope !== "machine")
                || (value.channel !== "stable" && value.channel !== "canary")
                || (value.runtimeProvider !== "managed" && value.runtimeProvider !== "system")
                || (value.gitProvider !== "managed" && value.gitProvider !== "system")
                || (value.rgProvider !== "managed" && value.rgProvider !== "system")
                || !source
                || typeof source !== "object"
                || !["portable-archive", "aggregate-depot", "distribution-manifest", "https-manifest"].includes(source.kind)
                || typeof source.value !== "string"
                || source.value.length === 0
                || source.value.includes("\0")) {
                throw new Error("Manager GUI 安装参数无效。");
            }
            if (source.kind === "https-manifest" && !source.value.startsWith("https://")) {
                throw new Error("在线 Desktop manifest 必须使用 HTTPS。");
            }
            if (value.adminPassword !== undefined
                && Buffer.byteLength(value.adminPassword, "utf8") > DESKTOP_UAC_MAX_SECRET_BYTES) {
                throw new Error("管理员密码超过 4096 bytes。");
            }
            if (value.enableAuth && !value.adminPassword) {
                throw new Error("启用 auth 时必须提供管理员密码。");
            }
            return value;
        }
        case "configure-provider":
        case "test-provider":
            validateProviderInput(value.provider);
            return value;
        case "status":
        case "doctor":
        case "repair":
            return value;
        case "uninstall":
            if (typeof value.deleteData !== "boolean") throw new Error("卸载 deleteData 参数无效。");
            return value;
        default:
            throw new Error("Manager GUI 操作不受支持。");
    }
}

export function managerInvocation(
    operation: ManagerGuiOperation,
    binding: ManagerOperationBinding,
): ManagerCliInvocation {
    switch (operation.kind) {
        case "install": {
            const args = [
                "desktop", "install",
                installSourceArgument(operation.source.kind),
                operation.source.value,
                "--scope", operation.scope,
                "--channel", operation.channel,
                "--runtime-provider", operation.runtimeProvider,
                "--git-provider", operation.gitProvider,
                "--rg-provider", operation.rgProvider,
                "--envelope", "electron",
                "--yes", "--json",
            ];
            if (operation.addCliToPath) args.push("--add-cli-to-path");
            if (operation.enableAuth) args.push("--enable-auth", "--password-stdin");
            return {
                args,
                ...(operation.adminPassword !== undefined ? {stdin: operation.adminPassword} : {}),
                ...(operation.adminPassword ? {sensitiveValues: [operation.adminPassword]} : {}),
            };
        }
        case "status":
            return {args: ["--root", binding.installationRoot, "status", "--json"]};
        case "doctor":
            return {args: ["--root", binding.installationRoot, "doctor", "--json"]};
        case "repair":
            return {args: ["--root", binding.installationRoot, "desktop", "repair", "--json"]};
        case "uninstall":
            return {
                args: ["--root", binding.installationRoot, "uninstall", "--yes", "--json", ...(operation.deleteData ? ["--delete-data"] : [])],
            };
        case "configure-provider":
            return {
                args: ["--root", binding.installationRoot, "desktop", "configure-provider", "--stdin-json", "--json"],
                stdin: JSON.stringify(operation.provider),
                ...(operation.provider.apiKey ? {sensitiveValues: [operation.provider.apiKey]} : {}),
            };
        case "test-provider":
            return {
                args: ["desktop", "test-provider", "--stdin-json", "--json"],
                stdin: JSON.stringify(operation.provider),
                ...(operation.provider.apiKey ? {sensitiveValues: [operation.provider.apiKey]} : {}),
            };
    }
}

function installSourceArgument(source: ManagerGuiInstallSource["kind"]): string {
    switch (source) {
        case "portable-archive":
            return "--archive";
        case "aggregate-depot":
            return "--depot";
        case "distribution-manifest":
            return "--distribution-manifest";
        case "https-manifest":
            return "--distribution-manifest-url";
    }
}

function validateProviderInput(provider: ManagerGuiProviderInput): void {
    if (!provider || typeof provider !== "object"
        || typeof provider.name !== "string"
        || typeof provider.baseURL !== "string"
        || typeof provider.api !== "string"
        || typeof provider.apiKey !== "string"
        || typeof provider.model !== "string"
        || (provider.discoverModels !== undefined && typeof provider.discoverModels !== "boolean")
        || provider.apiKey.includes("\0")
        || Buffer.byteLength(provider.apiKey, "utf8") > 16 * 1024) {
        throw new Error("Manager GUI Provider 参数无效。");
    }
}

export function createSensitiveOutputGuard(values: string[]): SensitiveOutputGuard | null {
    const secrets = [...new Set(values.flatMap(secretOutputRepresentations))];
    if (secrets.length === 0) return null;
    const keep = Math.max(...secrets.map((value) => value.length - 1), 0);
    let tail = "";
    return {
        check(fragment: string): void {
            const candidate = tail + fragment;
            if (secrets.some((secret) => candidate.includes(secret))) {
                throw new Error("Manager CLI 输出包含受保护 Secret；操作已终止。");
            }
            tail = keep > 0 ? candidate.slice(-keep) : "";
        },
    };
}

function secretOutputRepresentations(value: string): string[] {
    if (!value) return [];
    const normalized = value.replace(/\r\n?/gu, "\n");
    return [
        value,
        normalized,
        JSON.stringify(value).slice(1, -1),
        JSON.stringify(normalized).slice(1, -1),
    ].filter((candidate) => candidate.length > 0);
}
