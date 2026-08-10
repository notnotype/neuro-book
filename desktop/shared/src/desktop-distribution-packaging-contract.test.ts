import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

import {writeZipArchive} from "nbook/scripts/utils/zip";
import {
    DESKTOP_AGGREGATE_DEPOT_ARCHIVE,
    DESKTOP_AGGREGATE_DEPOT_MANIFEST,
    DESKTOP_AGGREGATE_DEPOT_ENTRIES,
    createDesktopAggregateDepotManifest,
    inspectDesktopAggregateDepot,
    validateDesktopAggregateDepotEntries,
    verifyDesktopAggregateDepot,
    verifyDesktopAggregateDepotArchive,
    type DesktopAggregateDirectoryEntry,
} from "nbook/desktop/shared/src/desktop-aggregate-depot";

async function fixture(): Promise<{root: string; stagingRoot: string; archivePath: string; manifestPath: string}> {
    const tempRoot = join(process.cwd(), ".agent", "tmp");
    await mkdir(tempRoot, {recursive: true});
    const root = await mkdtemp(join(tempRoot, "desktop-aggregate-contract-"));
    const staging = join(root, "staging");
    await mkdir(staging, {recursive: true});
    for (const entry of DESKTOP_AGGREGATE_DEPOT_ENTRIES) {
        await writeFile(join(staging, entry), `${entry}\n`, "utf8");
    }
    const archive = join(root, DESKTOP_AGGREGATE_DEPOT_ARCHIVE);
    const payload = await inspectDesktopAggregateDepot(staging);
    await writeZipArchive(archive, payload.entries, 100);
    const manifest = join(root, DESKTOP_AGGREGATE_DEPOT_MANIFEST);
    await writeFile(manifest, `${JSON.stringify(await createDesktopAggregateDepotManifest({stagingRoot: staging, archivePath: archive}), null, 4)}\n`, "utf8");
    return {root, stagingRoot: staging, archivePath: archive, manifestPath: manifest};
}

describe("Desktop aggregate depot packaging contract", () => {
    it("固定为五项 Electron beta 载荷，并通过真实 staging、ZIP、sidecar 的闭环校验", async () => {
        const paths = await fixture();
        try {
            await expect(verifyDesktopAggregateDepotArchive(paths)).resolves.toMatchObject({
                schema: "nbook.desktop-depot/v1",
            });
            const manifest = await verifyDesktopAggregateDepot(paths);
            expect(manifest.entries).toEqual([...DESKTOP_AGGREGATE_DEPOT_ENTRIES]);
            expect(manifest.payload).toEqual({files: 5, bytes: expect.any(Number)});
            expect(manifest.archive.bytes).toBe((await readFile(paths.archivePath)).byteLength);
        } finally {
            await rm(paths.root, {recursive: true, force: true});
        }
    });

    it("缺失或多余顶层文件时 fail closed", async () => {
        const paths = await fixture();
        try {
            await rm(join(paths.stagingRoot, DESKTOP_AGGREGATE_DEPOT_ENTRIES[0]));
            await expect(inspectDesktopAggregateDepot(paths.stagingRoot)).rejects.toThrow("缺少文件");
            await writeFile(join(paths.stagingRoot, DESKTOP_AGGREGATE_DEPOT_ENTRIES[0]), "restored\n", "utf8");
            await writeFile(join(paths.stagingRoot, "unexpected.txt"), "unexpected\n", "utf8");
            await expect(inspectDesktopAggregateDepot(paths.stagingRoot)).rejects.toThrow("未登记文件");
        } finally {
            await rm(paths.root, {recursive: true, force: true});
        }
    });

    it("sidecar 必须是固定文件名的普通文件", async () => {
        const paths = await fixture();
        try {
            await rm(paths.manifestPath);
            await mkdir(paths.manifestPath);
            await expect(verifyDesktopAggregateDepotArchive(paths)).rejects.toThrow("必须是普通文件");
        } finally {
            await rm(paths.root, {recursive: true, force: true});
        }
    });

    it("拒绝 symlink、错误 payload bytes、错误 archive bytes 和错误 checksum", async () => {
        const symlink: DesktopAggregateDirectoryEntry = {
            name: DESKTOP_AGGREGATE_DEPOT_ENTRIES[0],
            source: "fixture",
            isFile: false,
            isDirectory: false,
            isSymbolicLink: true,
            bytes: 0,
        };
        const regularEntries = DESKTOP_AGGREGATE_DEPOT_ENTRIES.map((name) => ({
            name,
            source: name,
            isFile: true,
            isDirectory: false,
            isSymbolicLink: false,
            bytes: 1,
        }));
        expect(() => validateDesktopAggregateDepotEntries([symlink, ...regularEntries.slice(1)])).toThrow("symlink");

        const paths = await fixture();
        try {
            const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8")) as {payload: {bytes: number}; archive: {bytes: number; sha256: string}};
            manifest.payload.bytes += 1;
            await writeFile(paths.manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
            await expect(verifyDesktopAggregateDepot(paths)).rejects.toThrow("payload");

            const restored = await createDesktopAggregateDepotManifest({stagingRoot: paths.stagingRoot, archivePath: paths.archivePath});
            restored.archive.bytes += 1;
            await writeFile(paths.manifestPath, `${JSON.stringify(restored)}\n`, "utf8");
            await expect(verifyDesktopAggregateDepot(paths)).rejects.toThrow("archive");

            restored.archive.bytes = (await readFile(paths.archivePath)).byteLength;
            restored.archive.sha256 = `sha256:${"0".repeat(64)}`;
            await writeFile(paths.manifestPath, `${JSON.stringify(restored)}\n`, "utf8");
            await expect(verifyDesktopAggregateDepotArchive(paths)).rejects.toThrow("archive");
        } finally {
            await rm(paths.root, {recursive: true, force: true});
        }
    });

    it("打包脚本消费共享合同，而不是把 Product 或 Portable 重新展开", async () => {
        const source = await readFile(join(process.cwd(), "desktop/packaging/package-portable.mjs"), "utf8");
        expect(source).toContain("createDesktopAggregateDepotManifest");
        expect(source).toContain("DESKTOP_AGGREGATE_DEPOT_ENTRIES");
        const start = source.indexOf("async function buildAggregateDepot");
        const end = source.indexOf("\nasync function main", start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        expect(source.slice(start, end)).not.toContain("copyTree(args.imageRoot, join(stageRoot, \".output\"))");
    });
});
