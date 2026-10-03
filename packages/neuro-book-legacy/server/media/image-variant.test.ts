import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import sharp from "sharp";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    IMAGE_VARIANT_PRESETS,
    ImageVariantError,
    ImageVariantModule,
    type ImageVariantModuleLimits,
    type ImageVariantSource,
    type ImageVariantSpec,
} from "nbook/server/media/image-variant";

const roots: string[] = [];
const DEFAULT_TEST_LIMITS: ImageVariantModuleLimits = Object.freeze({
    activeJobs: 2,
    queuedJobs: 64,
    cacheBytes: 512 * 1024 * 1024,
    cacheEntries: 10_000,
    variantsPerSource: 32,
});

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe("ImageVariantModule", () => {
    it("生成固定 WebP、应用 EXIF 方向、保留透明度且不放大小图", async () => {
        const module = await createModule();
        const oriented = await sharp({
            create: {width: 20, height: 40, channels: 4, background: {r: 20, g: 40, b: 60, alpha: 0.5}},
        }).jpeg().withMetadata({orientation: 6}).toBuffer();

        const result = await module.render(source("orientation", "v1", oriented), {
            width: 100,
            fit: "contain",
            quality: 80,
        });
        const metadata = await sharp(result.bytes).metadata();

        expect(result.cache).toBe("generated");
        expect(metadata.format).toBe("webp");
        expect(metadata.width).toBe(40);
        expect(metadata.height).toBe(20);
        expect(metadata.orientation).toBeUndefined();

        const transparent = await sharp({
            create: {width: 24, height: 12, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}},
        }).png().toBuffer();
        const alphaResult = await module.render(source("transparent", "v1", transparent), {
            width: 24,
            height: 12,
            fit: "contain",
            quality: 80,
        });
        expect((await sharp(alphaResult.bytes).metadata()).hasAlpha).toBe(true);
    });

    it("支持 PNG、JPEG、WebP 与 GIF 静态首帧", async () => {
        const module = await createModule();
        const base = sharp({create: {width: 8, height: 6, channels: 3, background: "#336699"}});
        const fixtures = [
            await base.clone().png().toBuffer(),
            await base.clone().jpeg().toBuffer(),
            await base.clone().webp().toBuffer(),
            Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
        ];
        for (const [index, bytes] of fixtures.entries()) {
            const result = await module.render(source(`fixture-${index}`, "v1", bytes), {
                width: 8,
                fit: "contain",
                quality: 80,
            });
            expect((await sharp(result.bytes).metadata()).format).toBe("webp");
        }
    });

    it("preset 与显式同规格共享缓存键，命中不再读取原图", async () => {
        const root = await temporaryRoot();
        const bytes = await fixturePng();
        let reads = 0;
        const authorized: ImageVariantSource = {
            identity: "same-image",
            revision: "v1",
            read: async () => {
                reads += 1;
                return bytes;
            },
        };
        const first = await new ImageVariantModule(absoluteFsPath(root)).render(
            authorized,
            IMAGE_VARIANT_PRESETS["project-cover"],
        );
        const second = await new ImageVariantModule(absoluteFsPath(root)).render(authorized, {
            width: 384,
            height: 576,
            fit: "cover",
            quality: 80,
        });

        expect(first.etag).toBe(second.etag);
        expect(second.cache).toBe("hit");
        expect(reads).toBe(1);
    });

    it("Cache Root分离后删除旧State Root可重建副本", async () => {
        const root = await temporaryRoot();
        const current = absoluteFsPath(path.join(root, "cache", "image-variants"));
        const obsolete = absoluteFsPath(path.join(root, "state", "cache", "image-variants"));
        await fs.mkdir(obsolete, {recursive: true});
        await fs.writeFile(path.join(obsolete, "obsolete.webp"), "rebuildable");
        const module = new ImageVariantModule(current, DEFAULT_TEST_LIMITS, obsolete);

        await module.render(source("migration", "v1", await fixturePng()), {
            width: 8,
            fit: "contain",
            quality: 80,
        });

        await expect(fs.stat(obsolete)).rejects.toMatchObject({code: "ENOENT"});
        expect((await fs.readdir(current)).some((name) => name.endsWith(".webp"))).toBe(true);
    });

    it("相同 miss single-flight，source revision 改变后重新生成", async () => {
        const module = await createModule();
        const bytes = await fixturePng();
        let reads = 0;
        const shared: ImageVariantSource = {
            identity: "single-flight",
            revision: "v1",
            read: async () => {
                reads += 1;
                await new Promise((resolve) => setTimeout(resolve, 15));
                return bytes;
            },
        };
        const [left, right] = await Promise.all([
            module.render(shared, IMAGE_VARIANT_PRESETS["attachment-grid"]),
            module.render(shared, IMAGE_VARIANT_PRESETS["attachment-grid"]),
        ]);
        expect(reads).toBe(1);
        expect(left.etag).toBe(right.etag);

        const revised = await module.render({...shared, revision: "v2"}, IMAGE_VARIANT_PRESETS["attachment-grid"]);
        expect(reads).toBe(2);
        expect(revised.etag).not.toBe(left.etag);
    });

    it("截断或同长度篡改的缓存会重新生成", async () => {
        const root = await temporaryRoot();
        const module = new ImageVariantModule(absoluteFsPath(root));
        const bytes = await fixturePng();
        let reads = 0;
        const authorized = source("corruption", "v1", bytes, () => reads += 1);
        await module.render(authorized, IMAGE_VARIANT_PRESETS["attachment-chat"]);
        const fileName = (await fs.readdir(root)).find((name) => name.endsWith(".webp"))!;
        const cachePath = path.join(root, fileName);
        const original = await fs.readFile(cachePath);
        await fs.writeFile(cachePath, original.subarray(0, 12));

        expect((await module.render(authorized, IMAGE_VARIANT_PRESETS["attachment-chat"])).cache).toBe("generated");
        const regenerated = await fs.readFile(cachePath);
        const tampered = Buffer.from(regenerated);
        tampered[Math.floor(tampered.length / 2)] ^= 0xff;
        await fs.writeFile(cachePath, tampered);
        expect((await new ImageVariantModule(absoluteFsPath(root))
            .render(authorized, IMAGE_VARIANT_PRESETS["attachment-chat"])).cache).toBe("generated");
        expect(reads).toBe(3);
    });

    it("被删除的缓存和旧 v1 缓存都按需重建或清理", async () => {
        const root = await temporaryRoot();
        const bytes = await fixturePng();
        const legacyFile = `${"a".repeat(64)}-${"b".repeat(64)}.webp`;
        await fs.writeFile(path.join(root, legacyFile), await sharp(bytes).webp().toBuffer());
        const module = new ImageVariantModule(absoluteFsPath(root));
        let reads = 0;
        const authorized = source("deleted", "v1", bytes, () => reads += 1);
        await module.render(authorized, IMAGE_VARIANT_PRESETS["attachment-chat"]);
        expect((await fs.readdir(root))).not.toContain(legacyFile);

        const fileName = (await fs.readdir(root)).find((name) => name.endsWith(".webp"))!;
        await fs.rm(path.join(root, fileName));
        expect((await module.render(authorized, IMAGE_VARIANT_PRESETS["attachment-chat"])).cache).toBe("generated");
        expect(reads).toBe(2);
    });

    it("重启建立 inventory 时只保留同一逻辑键的最新 v2 文件", async () => {
        const root = await temporaryRoot();
        const bytes = await fixturePng();
        let reads = 0;
        const authorized = source("duplicate-v2", "v1", bytes, () => reads += 1);
        await new ImageVariantModule(absoluteFsPath(root)).render(authorized, spec(8));
        const currentFile = (await cacheFiles(root))[0]!;
        const [sourceScope, cacheKey] = currentFile.slice(0, -".webp".length).split("-");
        const duplicateBytes = await sharp({
            create: {width: 8, height: 8, channels: 3, background: "#993366"},
        }).webp().toBuffer();
        const duplicateDigest = createHash("sha256").update(duplicateBytes).digest("hex");
        const duplicateFile = `${sourceScope}-${cacheKey}-${duplicateDigest}.webp`;
        await fs.writeFile(path.join(root, duplicateFile), duplicateBytes);
        const now = Date.now();
        await fs.utimes(path.join(root, duplicateFile), new Date(now - 2_000), new Date(now - 2_000));
        await fs.utimes(path.join(root, currentFile), new Date(now), new Date(now));

        const hit = await new ImageVariantModule(absoluteFsPath(root)).render(authorized, spec(8));

        expect(hit.cache).toBe("hit");
        expect(reads).toBe(1);
        expect(await cacheFiles(root)).toEqual([currentFile]);
    });

    it("损坏缓存无法删除时关闭后续持久写入，但仍返回内存变体", async () => {
        const root = await temporaryRoot();
        const module = new ImageVariantModule(absoluteFsPath(root));
        const bytes = await fixturePng();
        let reads = 0;
        const authorized = source("undeletable-corruption", "v1", bytes, () => reads += 1);
        await module.render(authorized, spec(8));
        const fileName = (await fs.readdir(root)).find((name) => name.endsWith(".webp"))!;
        const cachePath = path.join(root, fileName);
        await fs.writeFile(cachePath, "corrupt");
        const remove = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
            if (String(target) === cachePath) {
                throw new Error("cache is read-only");
            }
            return await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
                .then((actual) => actual.rm(target, options));
        });

        try {
            expect((await module.render(authorized, spec(8))).cache).toBe("generated");
            expect((await module.render(authorized, spec(8))).cache).toBe("generated");
            expect(reads).toBe(3);
            expect(await fs.readFile(cachePath, "utf8")).toBe("corrupt");
        } finally {
            remove.mockRestore();
        }
    });

    it("全局最多执行两个 source read，并在等待队列饱和时返回稳定错误", async () => {
        const root = await temporaryRoot();
        const limits = {...DEFAULT_TEST_LIMITS, activeJobs: 1, queuedJobs: 1};
        const module = new ImageVariantModule(absoluteFsPath(root), limits);
        const bytes = await fixturePng();
        let releaseFirst: () => void = () => undefined;
        const firstGate = new Promise<void>((resolve) => releaseFirst = resolve);
        let active = 0;
        let maximum = 0;
        const blockedSource = (identity: string): ImageVariantSource => ({
            identity,
            revision: "v1",
            read: async () => {
                active += 1;
                maximum = Math.max(maximum, active);
                if (identity === "first") {
                    await firstGate;
                }
                active -= 1;
                return bytes;
            },
        });
        const first = module.render(blockedSource("first"), IMAGE_VARIANT_PRESETS["attachment-grid"]);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const second = module.render(blockedSource("second"), IMAGE_VARIANT_PRESETS["attachment-grid"]);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const third = module.render(blockedSource("third"), IMAGE_VARIANT_PRESETS["attachment-grid"]);

        await expect(third).rejects.toMatchObject<ImageVariantError>({code: "IMAGE_VARIANT_QUEUE_SATURATED"});
        releaseFirst();
        await Promise.all([first, second]);
        expect(maximum).toBe(1);
    });

    it("按每源、条目和字节硬预算淘汰最老生成项", async () => {
        const bytes = await fixturePng();
        const perSourceRoot = await temporaryRoot();
        const perSource = new ImageVariantModule(absoluteFsPath(perSourceRoot), {
            ...DEFAULT_TEST_LIMITS,
            variantsPerSource: 2,
        });
        for (const width of [8, 9, 10]) {
            await perSource.render(source("bounded-source", "v1", bytes), spec(width));
            await new Promise((resolve) => setTimeout(resolve, 2));
        }
        expect(await cacheFiles(perSourceRoot)).toHaveLength(2);

        const entryRoot = await temporaryRoot();
        const byEntry = new ImageVariantModule(absoluteFsPath(entryRoot), {
            ...DEFAULT_TEST_LIMITS,
            cacheEntries: 2,
        });
        for (const identity of ["one", "two", "three"]) {
            await byEntry.render(source(identity, "v1", bytes), spec(8));
            await new Promise((resolve) => setTimeout(resolve, 2));
        }
        expect(await cacheFiles(entryRoot)).toHaveLength(2);

        const byteRoot = await temporaryRoot();
        const byBytes = new ImageVariantModule(absoluteFsPath(byteRoot), {
            ...DEFAULT_TEST_LIMITS,
            cacheBytes: 1,
        });
        const generated = await byBytes.render(source("too-large-for-cache", "v1", bytes), spec(8));
        expect(generated.bytes.byteLength).toBeGreaterThan(1);
        expect(await cacheFiles(byteRoot)).toHaveLength(0);
    });

    it("首次使用清理 temp；缓存目录故障时仍返回内存中的变体", async () => {
        const root = await temporaryRoot();
        await fs.writeFile(path.join(root, ".image-variant-orphan.tmp"), "orphan");
        const bytes = await fixturePng();
        await new ImageVariantModule(absoluteFsPath(root)).render(source("cleanup", "v1", bytes), spec(8));
        expect((await fs.readdir(root)).some((name) => name.endsWith(".tmp"))).toBe(false);

        const invalidRoot = path.join(await temporaryRoot(), "cache-file");
        await fs.writeFile(invalidRoot, "not a directory");
        const result = await new ImageVariantModule(absoluteFsPath(invalidRoot))
            .render(source("degraded", "v1", bytes), spec(8));
        expect(result.cache).toBe("generated");
        expect((await sharp(result.bytes).metadata()).format).toBe("webp");
    });

    it("区分非图片、无法解码和非法规范", async () => {
        const module = await createModule();
        await expect(module.render(source("text", "v1", Buffer.from("hello")), spec(8)))
            .rejects.toMatchObject<ImageVariantError>({code: "UNSUPPORTED_IMAGE_TYPE"});
        const brokenPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        await expect(module.render(source("broken", "v1", brokenPng), spec(8)))
            .rejects.toMatchObject<ImageVariantError>({code: "IMAGE_VARIANT_DECODE_FAILED"});
        await expect(module.render(source("invalid", "v1", await fixturePng()), {
            width: 20,
            fit: "cover",
            quality: 80,
        })).rejects.toMatchObject<ImageVariantError>({code: "INVALID_IMAGE_VARIANT"});
    });
});

/** 建立单测专用 cache root。 */
async function temporaryRoot(): Promise<string> {
    const root = await fs.mkdtemp(testHostPath("nbook-image-variant-"));
    roots.push(root);
    return root;
}

/** 建立使用生产预算的 Module。 */
async function createModule(): Promise<ImageVariantModule> {
    return new ImageVariantModule(absoluteFsPath(await temporaryRoot()));
}

/** 生成小型无 metadata PNG。 */
async function fixturePng(): Promise<Buffer> {
    return sharp({create: {width: 12, height: 8, channels: 3, background: "#336699"}}).png().toBuffer();
}

/** 建立不携带路径的授权 source capability。 */
function source(
    identity: string,
    revision: string,
    bytes: Uint8Array,
    onRead: () => void = () => undefined,
): ImageVariantSource {
    return Object.freeze({
        identity,
        revision,
        read: async () => {
            onRead();
            return bytes;
        },
    });
}

/** 简化预算测试规格。 */
function spec(width: number): ImageVariantSpec {
    return Object.freeze({width, fit: "contain", quality: 80});
}

/** 只统计正式 WebP 缓存项。 */
async function cacheFiles(root: string): Promise<string[]> {
    return (await fs.readdir(root)).filter((name) => name.endsWith(".webp"));
}
