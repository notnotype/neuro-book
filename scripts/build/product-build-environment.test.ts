import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";

import {PRODUCT_PLATFORMS} from "@notnotype/neuro-book-contracts/platform";
import {
    PRODUCT_SOURCE_DATE_EPOCH,
    PRODUCT_NODE_OPTIONS,
    productBuildEnvironment,
    productRuntimeOwnerBaselines,
    withProductBuildLease,
} from "#scripts/build/build-product-runtime-image";
import {
    assertAllProductRuntimeBuildPolicies,
    missingProductRuntimeBuildPolicies,
} from "#scripts/build/check-product-runtime-policies";

describe("Product build environment", () => {
    it("只透传 OS 启动变量，并固定所有会改变 Nuxt/Nitro payload 的输入", () => {
        const source: NodeJS.ProcessEnv = {
            Path: "C:\\tools",
            TEMP: "C:\\temp",
            NODE_OPTIONS: "--require malicious-build-hook.cjs",
            NUXT_DEVTOOLS: "1",
            NUXT_PUBLIC_LEAK: "host-value",
            NITRO_PRESET: "cloudflare-pages",
            VITE_PRIVATE_VALUE: "host-value",
            NODE_ENV: "development",
            SOURCE_DATE_EPOCH: "12345",
            NEURO_BOOK_OUTPUT_DIR: "unexpected-output",
            DATABASE_URL: "secret-runtime-value",
            ...(process.platform === "win32" && process.arch === "x64"
                ? {NEURO_BOOK_MSVC_RUNTIME_DIR: "C:\\msvc-runtime"}
                : {}),
        };

        const environment = productBuildEnvironment(source);

        expect(environment).toMatchObject({
            Path: "C:\\tools",
            TEMP: "C:\\temp",
            LANG: "C",
            LC_ALL: "C",
            NITRO_PRESET: "node-server",
            NODE_ENV: "production",
            NUXT_DEVTOOLS: "0",
            NUXT_TELEMETRY_DISABLED: "1",
            NODE_OPTIONS: PRODUCT_NODE_OPTIONS,
            SOURCE_DATE_EPOCH: PRODUCT_SOURCE_DATE_EPOCH,
            TZ: "UTC",
        });
        expect(environment).not.toHaveProperty("NUXT_PUBLIC_LEAK");
        expect(environment).not.toHaveProperty("VITE_PRIVATE_VALUE");
        expect(environment).not.toHaveProperty("NEURO_BOOK_OUTPUT_DIR");
        expect(environment).not.toHaveProperty("DATABASE_URL");
        if (process.platform === "win32" && process.arch === "x64") {
            expect(environment).toHaveProperty("NEURO_BOOK_MSVC_RUNTIME_DIR", "C:\\msvc-runtime");
        } else {
            expect(environment).not.toHaveProperty("NEURO_BOOK_MSVC_RUNTIME_DIR");
        }
        expect(source.NUXT_DEVTOOLS).toBe("1");
    });

    it("win32-x64 无显式 MSVC Runtime 时注入仓库默认输入目录", () => {
        const environment = productBuildEnvironment({});
        if (process.platform === "win32" && process.arch === "x64") {
            expect(environment.NEURO_BOOK_MSVC_RUNTIME_DIR).toMatch(/scripts[\\/]build[\\/]inputs[\\/]msvc-runtime$/u);
        } else {
            expect(environment).not.toHaveProperty("NEURO_BOOK_MSVC_RUNTIME_DIR");
        }
    });

    it("五个平台只返回各自实测 baseline，正式 policy preflight 全部通过", () => {
        expect(Object.fromEntries(PRODUCT_PLATFORMS.map((platform) => [
            platform,
            productRuntimeOwnerBaselines(platform),
        ]))).toEqual({
            "windows-x64": [
                {name: "frontend", files: 177, bytes: 15_272_680},
                {name: "server-bundle", files: 1, bytes: 12_300_171},
                {name: "commands", files: 116, bytes: 10_865_638},
                {name: "authoring-kit", files: 509, bytes: 14_477_260},
                {name: "native-islands", files: 2_059, bytes: 75_260_630},
                {name: "system-assets", files: 442, bytes: 5_919_094},
                {name: "runtime-meta", files: 3, bytes: 4_762},
            ],
            "linux-x64-glibc": [
                {name: "frontend", files: 177, bytes: 15_272_675},
                {name: "server-bundle", files: 1, bytes: 12_300_888},
                {name: "commands", files: 116, bytes: 10_866_185},
                {name: "authoring-kit", files: 509, bytes: 14_475_922},
                {name: "native-islands", files: 2_062, bytes: 75_144_692},
                {name: "system-assets", files: 442, bytes: 5_856_353},
                {name: "runtime-meta", files: 3, bytes: 4_762},
            ],
            "linux-aarch64-glibc": [
                {name: "frontend", files: 177, bytes: 15_272_675},
                {name: "server-bundle", files: 1, bytes: 12_300_888},
                {name: "commands", files: 116, bytes: 10_866_185},
                {name: "authoring-kit", files: 509, bytes: 14_475_922},
                {name: "native-islands", files: 2_062, bytes: 72_567_998},
                {name: "system-assets", files: 442, bytes: 5_856_353},
                {name: "runtime-meta", files: 3, bytes: 4_762},
            ],
            "darwin-x64": [
                {name: "frontend", files: 177, bytes: 15_272_675},
                {name: "server-bundle", files: 1, bytes: 12_300_888},
                {name: "commands", files: 116, bytes: 10_866_185},
                {name: "authoring-kit", files: 509, bytes: 14_475_922},
                {name: "native-islands", files: 2_062, bytes: 75_913_156},
                {name: "system-assets", files: 442, bytes: 5_856_353},
                {name: "runtime-meta", files: 3, bytes: 4_762},
            ],
            "darwin-aarch64": [
                {name: "frontend", files: 177, bytes: 15_272_675},
                {name: "server-bundle", files: 1, bytes: 12_300_888},
                {name: "commands", files: 116, bytes: 10_866_185},
                {name: "authoring-kit", files: 509, bytes: 14_475_922},
                {name: "native-islands", files: 2_062, bytes: 71_965_408},
                {name: "system-assets", files: 442, bytes: 5_856_353},
                {name: "runtime-meta", files: 3, bytes: 4_762},
            ],
        });
        expect(missingProductRuntimeBuildPolicies()).toEqual([]);
        expect(() => assertAllProductRuntimeBuildPolicies()).not.toThrow();
    });

    it("raw Nuxt pipeline 只读取 tracked 的空 Product dotenv", async () => {
        const [packageText, productEnv, attributes] = await Promise.all([
            readFile(resolve("packages/neuro-book", "package.json"), "utf8"),
            readFile(resolve("packages/neuro-book", ".env.product"), "utf8"),
            readFile(".gitattributes", "utf8").then((text) => text.replaceAll("\r\n", "\n")),
        ]);
        const packageJson = JSON.parse(packageText) as {scripts: {"nuxt:build:raw": string}};

        expect(packageJson.scripts["nuxt:build:raw"].match(/--dotenv \.env\.product/gu)).toHaveLength(1);
        expect(packageJson.scripts["nuxt:build:raw"]).toContain("bun ../../node_modules/nuxt/bin/nuxt.mjs");
        expect(productEnv).toBe("# Product builds intentionally load no local runtime configuration.\n");
        expect(attributes).toContain("server/generated/project-prisma/** text eol=lf\n");
        expect(attributes).toContain("bun.lock text eol=lf\n");
        expect(attributes).toContain(".env.product text eol=lf\n");
        expect(attributes).toContain("*.mjs text eol=lf\n");
    });

    it("整个 Product pipeline 共用一个 fail-fast build lease", async () => {
        const root = await mkdtemp(testHostPath("nbook-product-build-lease-"));
        let enterFirst!: () => void;
        let releaseFirst!: () => void;
        const firstStarted = new Promise<void>((resolvePromise) => {
            enterFirst = resolvePromise;
        });
        const firstGate = new Promise<void>((resolvePromise) => {
            releaseFirst = resolvePromise;
        });
        try {
            const first = withProductBuildLease(root, async () => {
                enterFirst();
                await firstGate;
                return "first";
            });
            await firstStarted;
            try {
                await expect(withProductBuildLease(root, async () => "second")).rejects.toThrow("拒绝并发构建");
            } finally {
                releaseFirst();
                await expect(first).resolves.toBe("first");
            }
            await expect(withProductBuildLease(root, async () => "third")).resolves.toBe("third");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});
