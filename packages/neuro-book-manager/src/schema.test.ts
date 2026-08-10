import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

import {TEST_RUNTIME_IMAGE_IDENTITY} from "#manager/fixtures/runtime-image";
import {PRODUCT_ASSET_NAMES} from "#manager/platform";
import {INSTALLED_MACOS_ROOT_LOCATORS, INSTALLED_WINDOWS_ROOT_LOCATORS, INSTALLATION_SCOPED_ROOT_LOCATORS} from "#manager/root-locators";
import {migrateOperationJournal, parseInstallationManifest, parseOperationJournal, parseReleaseManifest, parseReleaseManifestEnvelope} from "#manager/schema";
import {PRODUCT_PLATFORMS} from "#manager/types";

const SHA = "a".repeat(64);
const REVISION = "b".repeat(40);
const JOURNAL_ROOT = join(tmpdir(), "neuro-book-schema-fixture");

describe("Manager manifest schemas", () => {
    it("接受 Product Bun 的固定组件结构", () => {
        expect(parseInstallationManifest(productManifest()).profile).toBe("product-bun");
    });

    it("直接拒绝旧版Installation Manifest", () => {
        expect(() => parseInstallationManifest({...productManifest(), schemaVersion: 4})).toThrow("schema v5");
    });

    it("严格校验 Root Locator 路径与批准布局", () => {
        expect(() => parseInstallationManifest({
            ...productManifest(),
            roots: INSTALLED_WINDOWS_ROOT_LOCATORS,
        })).not.toThrow();
        expect(() => parseInstallationManifest({
            ...productManifest(),
            roots: INSTALLED_MACOS_ROOT_LOCATORS,
            components: {
                ...productManifest().components,
                product: {
                    ...productManifest().components.product,
                    platform: "darwin-aarch64" as const,
                },
            },
        })).not.toThrow();
        for (const path of ["", ".", "../data", "data/../cache", "C:/data", "/data"]) {
            expect(() => parseInstallationManifest({
                ...productManifest(),
                roots: {
                    ...INSTALLATION_SCOPED_ROOT_LOCATORS,
                    state: {base: "installation-root", path},
                },
            })).toThrow();
        }
        expect(() => parseInstallationManifest({
            ...productManifest(),
            roots: {
                ...INSTALLATION_SCOPED_ROOT_LOCATORS,
                state: {base: "local-app-data", path: "Other/data"},
            },
        })).toThrow("布局非法");
    });

    it("非容器 Product 与 Release asset 必须携带 Runtime Image identity", () => {
        const installation = productManifest();
        delete (installation.components.product as {imageId?: string}).imageId;
        expect(() => parseInstallationManifest(installation)).toThrow("schema v5");

        const release = releaseManifest();
        delete (release.products[0] as {sourceDigest?: string}).sourceDigest;
        expect(() => parseReleaseManifest(release)).toThrow("schema v5");
    });

    it("拒绝路径越界与 Source/Product revision 不一致", () => {
        const invalidPath = productManifest();
        invalidPath.components.manager.path = "../manager.mjs";
        expect(() => parseInstallationManifest(invalidPath)).toThrow("Installation Root");

        const mismatch = productManifest();
        mismatch.components.product.revision = "c".repeat(40);
        expect(() => parseInstallationManifest(mismatch)).toThrow("revision");
    });

    it("验证Release五平台完整且唯一", () => {
        const manifest = releaseManifest();
        expect(parseReleaseManifest(manifest).products[0]?.platform).toBe("windows-x64");
        manifest.products[manifest.products.length - 1] = {...manifest.products[0]!};
        expect(() => parseReleaseManifest(manifest)).toThrow("重复 Product 平台");
    });

    it("拒绝缺少任一平台或资产名错误的Release", () => {
        const missing = releaseManifest();
        missing.products = missing.products.filter((product) => product.platform !== "darwin-aarch64");
        expect(() => parseReleaseManifest(missing)).toThrow("缺少：darwin-aarch64");

        const wrongAsset = releaseManifest();
        wrongAsset.products[0] = {...wrongAsset.products[0]!, url: "https://example.com/product.zip"};
        expect(() => parseReleaseManifest(wrongAsset)).toThrow("资产名非法");
    });

    it("验证Release stateMigration三种policy、稳定slug与唯一性，不枚举Product catalog", () => {
        expect(parseReleaseManifest({...releaseManifest(), stateMigration: {policy: "none", steps: []}}).stateMigration.policy).toBe("none");
        expect(parseReleaseManifest({
            ...releaseManifest(),
            stateMigration: {policy: "manual", steps: [], guide: "docs/migrations/manual.md"},
        }).stateMigration.policy).toBe("manual");
        expect(() => parseReleaseManifest({
            ...releaseManifest(),
            stateMigration: {policy: "manual", steps: []},
        })).toThrow("必须提供 guide");
        expect(parseReleaseManifest({
            ...releaseManifest(),
            stateMigration: {policy: "automatic", steps: ["missing-step"]},
        }).stateMigration.steps).toEqual(["missing-step"]);
        expect(() => parseReleaseManifest({
            ...releaseManifest(),
            stateMigration: {policy: "automatic", steps: ["agent-session-v2", "agent-session-v2"]},
        })).toThrow("重复step");
        expect(() => parseReleaseManifest({
            ...releaseManifest(),
            stateMigration: {policy: "automatic", steps: ["Future Step"]},
        })).toThrow("Release schema v5");
    });

    it("要求容器Profile持久化engine，非容器Profile必须为null", () => {
        expect(() => parseInstallationManifest({...productManifest(), containerEngine: "docker"})).toThrow("Container Engine");
        const container = dockerManifest();
        expect(parseInstallationManifest(container).containerEngine).toBe("podman");
        expect(() => parseInstallationManifest({...container, containerEngine: null})).toThrow("Container Engine");
    });

    it("Operation Journal v6固定并校验Manifest engine 与 Root Locator", () => {
        const manifest = dockerManifest();
        const journal = operationJournal(manifest);
        expect(parseOperationJournal(journal, "memory.json").containerEngine).toBe("podman");
        expect(() => parseOperationJournal({...journal, containerEngine: "docker"}, "memory.json")).toThrow("不一致");
        expect(() => parseOperationJournal({...journal, roots: INSTALLED_WINDOWS_ROOT_LOCATORS}, "memory.json")).toThrow("Root Locator不一致");
        expect(() => parseOperationJournal({...journal, schemaVersion: 1}, "memory.json")).toThrow("不符合 schema");
    });

    it("Operation Journal v3只在读取边界转换为v6 Application State记录", () => {
        const current = operationJournal(dockerManifest());
        const {roots: _roots, ...legacyCurrent} = current;
        const legacy = {
            ...legacyCurrent,
            schemaVersion: 3,
            attachmentMigration: {
                runId: "operation-attachment",
                state: "applied",
                migratedSessions: 1,
                sessions: [{
                    sessionId: 1,
                    sourcePath: "workspace/book/.nbook/sessions/1/attachments/source.png",
                    sourceHash: SHA,
                    targetHash: SHA,
                }],
            },
        };

        expect(migrateOperationJournal(legacy, "memory.json")).toMatchObject({
            schemaVersion: 6,
            roots: INSTALLATION_SCOPED_ROOT_LOCATORS,
            applicationStateMigration: {runId: "operation", state: "applied"},
        });
    });

    it("Operation Journal v4/v5只在读取边界转换为v6，且新 schema 才允许 start", () => {
        const current = operationJournal(dockerManifest());
        const {roots: _roots, ...legacyCurrent} = current;
        const legacyV4 = {...legacyCurrent, schemaVersion: 4};
        const legacyV5 = {...legacyCurrent, schemaVersion: 5, action: "start"};

        expect(migrateOperationJournal(legacyV4, "memory.json")).toMatchObject({
            schemaVersion: 6,
            action: "update",
        });
        expect(migrateOperationJournal(legacyV5, "memory.json")).toMatchObject({
            schemaVersion: 6,
            action: "start",
        });
        expect(parseOperationJournal({...operationJournal(dockerManifest()), action: "start"}, "memory.json"))
            .toMatchObject({schemaVersion: 6, action: "start"});
    });

    it("可在严格payload解析前读取Release envelope", () => {
        expect(parseReleaseManifestEnvelope({schemaVersion: 99, minManagerVersion: "9.0.0", future: true})).toEqual({schemaVersion: 99, minManagerVersion: "9.0.0"});
    });
});

function productManifest() {
    return {
        schemaVersion: 5 as const,
        profile: "product-bun" as const,
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: "0.8.0",
        channel: "stable" as const,
        sourceRevision: REVISION,
        roots: INSTALLATION_SCOPED_ROOT_LOCATORS,
        components: {
            source: {
                provider: "release" as const,
                buildId: `sha256:${"9".repeat(64)}`,
                version: "0.8.0",
                revision: REVISION,
                path: "." as const,
                files: ["package.json"],
                archiveSha256: SHA,
                sourceUrl: "https://example.com/source.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
            product: {
                ...TEST_RUNTIME_IMAGE_IDENTITY,
                provider: "release" as const,
                buildId: `sha256:${"9".repeat(64)}`,
                version: "0.8.0",
                revision: REVISION,
                path: ".output" as const,
                platform: "windows-x64" as const,
                archiveSha256: SHA,
                sourceUrl: "https://example.com/product.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
            manager: {provider: "managed" as const, version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: SHA},
            managerRuntime: {provider: "system" as const, version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "system" as const, version: "1.3.0", executable: "bun"},
            tools: {},
        },
        installedAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function releaseManifest() {
    return {
        schemaVersion: 5 as const,
        buildId: `sha256:${"9".repeat(64)}`,
        version: "0.8.0",
        channel: "stable" as const,
        sourceRevision: REVISION,
        minManagerVersion: "0.1.0",
        source: {url: "https://example.com/source.zip", sha256: SHA, bytes: 1},
        products: PRODUCT_PLATFORMS.map((platform) => ({
            ...TEST_RUNTIME_IMAGE_IDENTITY,
            url: `https://example.com/${PRODUCT_ASSET_NAMES[platform]}`,
            sha256: SHA,
            bytes: 1,
            platform,
            sourceRevision: REVISION,
        })),
        windowsPortable: {url: "https://example.com/portable.zip", sha256: SHA, bytes: 1},
        ghcr: {ref: `ghcr.io/notnotype/neuro-book@sha256:${SHA}`, digest: `sha256:${SHA}`, sourceRevision: REVISION},
        stateMigration: {
            policy: "automatic" as const,
            steps: ["agent-attachment-v1", "agent-session-v2"],
        },
    };
}

function dockerManifest() {
    const manifest = productManifest();
    return {
        ...manifest,
        profile: "source-docker" as const,
        containerEngine: "podman" as const,
        components: {
            ...manifest.components,
            source: {provider: "git" as const, version: "0.8.0", revision: REVISION, path: "." as const, repository: "https://github.com/notnotype/neuro-book.git", branch: "master"},
            product: {
                provider: "container" as const,
                version: "0.8.0",
                revision: REVISION,
                image: "neuro-book-source:test",
                containerImageId: `sha256:${"8".repeat(64)}`,
            },
            applicationRuntime: {provider: "container" as const, version: "0.8.0"},
            tools: {
                rg: {provider: "container" as const, version: "source-docker"},
                git: {provider: "container" as const, version: "source-docker"},
                python: {provider: "container" as const, version: "source-docker"},
            },
        },
    };
}

function operationJournal(manifest: ReturnType<typeof dockerManifest>) {
    const now = "2026-07-16T00:00:00.000Z";
    return {
        schemaVersion: 6 as const,
        id: "operation",
        action: "update" as const,
        phase: "planned" as const,
        root: JOURNAL_ROOT,
        roots: manifest.roots,
        containerEngine: "podman" as const,
        effects: [],
        backupRoot: join(JOURNAL_ROOT, ".deploy", "backups", "operation"),
        previousManifest: manifest,
        nextManifest: manifest,
        createdAt: now,
        updatedAt: now,
    };
}
