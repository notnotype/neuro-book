import {mkdtemp, readdir, rm, stat, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {
    DEFAULT_RUNTIME_ARTIFACT_RETENTION,
    importRuntimeArtifact,
    type RuntimeArtifactRetention,
} from "nbook/server/utils/runtime-artifact-import";

describe("importRuntimeArtifact", () => {
    it("通过原生动态 import 加载运行时生成的 mjs artifact", async () => {
        const root = await mkdtemp(testHostPath("nbook-runtime-artifact-"));
        try {
            const artifactPath = join(root, "runtime artifact.mjs");
            await writeFile(artifactPath, "export const value = 'loaded'; export default {answer: 42};\n", "utf8");

            const mod = await importRuntimeArtifact<{default: {answer: number}; value: string}>(artifactPath);

            expect(mod.value).toBe("loaded");
            expect(mod.default.answer).toBe(42);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("用物理 cache key 区分同一路径 artifact", async () => {
        const root = await mkdtemp(testHostPath("nbook-runtime-artifact-query-"));
        const cacheBase = join(root, "runtime-artifact-import-cache");
        const cacheRoot = join(cacheBase, "test");
        try {
            const artifactPath = join(root, "runtime-artifact.mjs");
            const firstSource = "export const version = 1;\n";
            const secondSource = "export const version = 2;\n";
            await writeFile(artifactPath, firstSource, "utf8");

            const first = await importRuntimeArtifact<{version: number}>(artifactPath, {
                cache: {
                    root: cacheBase,
                    namespace: "test",
                    key: "version-1",
                    bytes: Buffer.byteLength(firstSource, "utf-8"),
                    retention: DEFAULT_RUNTIME_ARTIFACT_RETENTION,
                },
            });
            await writeFile(artifactPath, secondSource, "utf8");
            const second = await importRuntimeArtifact<{version: number}>(artifactPath, {
                cache: {
                    root: cacheBase,
                    namespace: "test",
                    key: "version-2",
                    bytes: Buffer.byteLength(secondSource, "utf-8"),
                    retention: DEFAULT_RUNTIME_ARTIFACT_RETENTION,
                },
            });

            expect(first.version).toBe(1);
            expect(second.version).toBe(2);
            await expect(readdir(cacheRoot)).resolves.toEqual(["version-1.mjs", "version-2.mjs"]);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("retention 达到条目上限后按最旧优先驱逐，且不驱逐本次导入的副本", async () => {
        const root = await mkdtemp(testHostPath("nbook-runtime-artifact-retention-"));
        const cacheBase = join(root, "runtime-artifact-import-cache");
        const cacheRoot = join(cacheBase, "test");
        const retention: RuntimeArtifactRetention = {maxEntries: 2, maxBytes: 1024 * 1024};
        try {
            const artifactPath = join(root, "runtime-artifact.mjs");
            for (const version of [1, 2, 3]) {
                const source = `export const version = ${version};\n`;
                await writeFile(artifactPath, source, "utf8");
                const mod = await importRuntimeArtifact<{version: number}>(artifactPath, {
                    cache: {
                        root: cacheBase,
                        namespace: "test",
                        key: `version-${version}`,
                        bytes: Buffer.byteLength(source, "utf-8"),
                        retention,
                    },
                });
                expect(mod.version).toBe(version);
            }

            const remaining = (await readdir(cacheRoot)).sort();
            // 最旧的 version-1 被驱逐；刚写入的 version-3 必须存活，否则接下来的 import 会 ENOENT。
            expect(remaining).toEqual(["version-2.mjs", "version-3.mjs"]);
            await expect(stat(join(cacheRoot, "version-3.mjs"))).resolves.toBeTruthy();
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("字节预算比条目上限更严格时同样收敛", async () => {
        const root = await mkdtemp(testHostPath("nbook-runtime-artifact-bytes-"));
        const cacheBase = join(root, "runtime-artifact-import-cache");
        const cacheRoot = join(cacheBase, "test");
        try {
            const artifactPath = join(root, "runtime-artifact.mjs");
            const source = "export const version = 0;\n";
            const bytes = Buffer.byteLength(source, "utf-8");
            // maxEntries 很宽松，只有 maxBytes 会触发驱逐。
            const retention: RuntimeArtifactRetention = {maxEntries: 64, maxBytes: bytes * 2};
            for (const index of [1, 2, 3, 4]) {
                await writeFile(artifactPath, source, "utf8");
                await importRuntimeArtifact<{version: number}>(artifactPath, {
                    cache: {root: cacheBase, namespace: "test", key: `entry-${index}`, bytes, retention},
                });
            }

            expect((await readdir(cacheRoot)).length).toBeLessThanOrEqual(2);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});
