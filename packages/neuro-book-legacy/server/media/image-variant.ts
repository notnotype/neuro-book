import {createHash, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    imageMimeType,
    isSharpPixelLimitError,
    MAX_RASTER_IMAGE_PIXELS,
} from "nbook/server/media/raster-image";
import {
    ImageVariantError,
    type ImageVariantResult,
    type ImageVariantSource,
    type ImageVariantSpec,
} from "nbook/server/media/image-variant-contract";

export {
    IMAGE_VARIANT_PRESETS,
    ImageVariantError,
    type ImageVariantErrorCode,
    type ImageVariantFit,
    type ImageVariantPreset,
    type ImageVariantResult,
    type ImageVariantSource,
    type ImageVariantSpec,
} from "nbook/server/media/image-variant-contract";

const CACHE_VERSION = "v2";
const CACHE_FILE_PATTERN = /^([a-f0-9]{64})-([a-f0-9]{64})-([a-f0-9]{64})\.webp$/u;
const LEGACY_CACHE_FILE_PATTERN = /^[a-f0-9]{64}-[a-f0-9]{64}\.webp$/u;
const TEMP_FILE_PATTERN = /^\.image-variant-.*\.tmp$/u;
const MAX_OUTPUT_EDGE = 2048;
const MAX_ACTIVE_JOBS = 2;
const MAX_QUEUED_JOBS = 64;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 10_000;
const MAX_VARIANTS_PER_SOURCE = 32;

/** 生产使用固定默认值；仅测试通过构造参数收紧预算以验证淘汰。 */
export type ImageVariantModuleLimits = Readonly<{
    activeJobs: number;
    queuedJobs: number;
    cacheBytes: number;
    cacheEntries: number;
    variantsPerSource: number;
}>;

const DEFAULT_LIMITS: ImageVariantModuleLimits = Object.freeze({
    activeJobs: MAX_ACTIVE_JOBS,
    queuedJobs: MAX_QUEUED_JOBS,
    cacheBytes: MAX_CACHE_BYTES,
    cacheEntries: MAX_CACHE_ENTRIES,
    variantsPerSource: MAX_VARIANTS_PER_SOURCE,
});

type CacheEntry = {
    readonly cacheKey: string;
    readonly fileName: string;
    readonly sourceScope: string;
    readonly contentDigest: string;
    readonly bytes: number;
    readonly generatedAt: number;
};

/**
 * 共享图片变体 Module。
 *
 * Module 只消费已授权 source capability；领域授权、HTTP、Session、Project 和路径解析
 * 均留在调用方。缓存是有界、可删除、可重建的运行时产物。
 */
export class ImageVariantModule {
    private readonly inventory = new Map<string, CacheEntry>();
    private readonly flights = new Map<string, Promise<ImageVariantResult>>();
    private readonly queue: Array<() => void> = [];
    private initialization: Promise<void> | null = null;
    private activeJobs = 0;
    private persistentWritesEnabled = true;

    /** 建立绑定到单个Cache Root的变体 Module；旧State Root副本仅作为可重建数据删除。 */
    constructor(
        private readonly cacheRoot: AbsoluteFsPath,
        private readonly limits: ImageVariantModuleLimits = DEFAULT_LIMITS,
        private readonly obsoleteCacheRoot?: AbsoluteFsPath,
    ) {}

    /** 读取命中缓存或在受限队列中生成同一规格的 WebP。 */
    async render(source: ImageVariantSource, spec: ImageVariantSpec): Promise<ImageVariantResult> {
        validateNormalizedSpec(spec);
        await this.initialize();
        const sourceScope = digest(source.identity);
        const cacheKey = digest(JSON.stringify({
            version: CACHE_VERSION,
            identity: source.identity,
            revision: source.revision,
            spec: canonicalSpec(spec),
        }));
        const etag = `"iv-${cacheKey}"`;

        const cached = await this.readCached(cacheKey, etag);
        if (cached) {
            return cached;
        }
        const existing = this.flights.get(cacheKey);
        if (existing) {
            return existing;
        }
        const flight = this.schedule(async () => {
            const secondHit = await this.readCached(cacheKey, etag);
            if (secondHit) {
                return secondHit;
            }
            const bytes = await this.transform(source, spec);
            await this.persist(cacheKey, sourceScope, bytes);
            return Object.freeze({bytes, etag, cache: "generated" as const});
        });
        this.flights.set(cacheKey, flight);
        try {
            return await flight;
        } finally {
            this.flights.delete(cacheKey);
        }
    }

    /** 首次使用时清理孤立 temp、建立库存并把已有缓存收回硬预算内。 */
    private async initialize(): Promise<void> {
        if (this.initialization) {
            return this.initialization;
        }
        this.initialization = (async () => {
            try {
                if (this.obsoleteCacheRoot && path.resolve(this.obsoleteCacheRoot) !== path.resolve(this.cacheRoot)) {
                    await fs.rm(this.obsoleteCacheRoot, {recursive: true, force: true});
                }
                await fs.mkdir(this.cacheRoot, {recursive: true});
                const names = await fs.readdir(this.cacheRoot);
                for (const fileName of names) {
                    const target = path.join(this.cacheRoot, fileName);
                    if (TEMP_FILE_PATTERN.test(fileName)) {
                        await fs.rm(target, {force: true});
                        continue;
                    }
                    if (LEGACY_CACHE_FILE_PATTERN.test(fileName)) {
                        await fs.rm(target, {force: true});
                        continue;
                    }
                    const match = CACHE_FILE_PATTERN.exec(fileName);
                    if (!match) {
                        continue;
                    }
                    const entryStat = await fs.stat(target);
                    if (!entryStat.isFile()) {
                        continue;
                    }
                    const entry: CacheEntry = {
                        cacheKey: match[2]!,
                        fileName,
                        sourceScope: match[1]!,
                        contentDigest: match[3]!,
                        bytes: entryStat.size,
                        generatedAt: entryStat.mtimeMs,
                    };
                    const existing = this.inventory.get(entry.cacheKey);
                    if (!existing) {
                        this.inventory.set(entry.cacheKey, entry);
                        continue;
                    }
                    const keepExisting = oldestFirst(existing, entry) >= 0;
                    const discarded = keepExisting ? entry : existing;
                    await fs.rm(path.join(this.cacheRoot, discarded.fileName), {force: true});
                    this.inventory.set(entry.cacheKey, keepExisting ? existing : entry);
                }
                await this.reclaim();
            } catch {
                this.persistentWritesEnabled = false;
                this.inventory.clear();
            }
        })();
        return this.initialization;
    }

    /** 缓存命中只读变体文件；缺失或明显损坏时删除库存并重新生成。 */
    private async readCached(cacheKey: string, etag: string): Promise<ImageVariantResult | null> {
        const entry = this.inventory.get(cacheKey);
        if (!entry) {
            return null;
        }
        try {
            const bytes = await fs.readFile(path.join(this.cacheRoot, entry.fileName));
            if (imageMimeType(bytes) !== "image/webp" || digestBytes(bytes) !== entry.contentDigest) {
                try {
                    await this.removeCacheEntry(cacheKey);
                } catch {
                    this.persistentWritesEnabled = false;
                    this.inventory.delete(cacheKey);
                }
                return null;
            }
            return Object.freeze({bytes, etag, cache: "hit" as const});
        } catch {
            this.inventory.delete(cacheKey);
            return null;
        }
    }

    /** 在单个受限 job 内读取原图、校验像素并生成静态 WebP。 */
    private async transform(source: ImageVariantSource, spec: ImageVariantSpec): Promise<Buffer> {
        const input = Buffer.from(await source.read());
        if (!imageMimeType(input)) {
            throw new ImageVariantError("UNSUPPORTED_IMAGE_TYPE", "图片源不是支持的 PNG、JPEG、WebP 或 GIF");
        }
        try {
            const {default: sharp} = await import("sharp");
            const pipeline = sharp(input, {
                animated: false,
                failOn: "error",
                limitInputPixels: MAX_RASTER_IMAGE_PIXELS,
                sequentialRead: true,
            });
            const metadata = await pipeline.metadata();
            if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_RASTER_IMAGE_PIXELS) {
                throw new ImageVariantError("IMAGE_VARIANT_SOURCE_TOO_LARGE", "图片像素超过 64 MP 限制");
            }
            const swapsEdges = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
            const sourceWidth = swapsEdges ? metadata.height : metadata.width;
            const sourceHeight = swapsEdges ? metadata.width : metadata.height;
            const resize = resizePlan(sourceWidth, sourceHeight, spec);
            return await pipeline
                .rotate()
                .resize({
                    width: resize.width,
                    height: resize.height,
                    fit: resize.fit,
                })
                .webp({quality: spec.quality})
                .toBuffer();
        } catch (error) {
            if (error instanceof ImageVariantError) {
                throw error;
            }
            if (isSharpPixelLimitError(error)) {
                throw new ImageVariantError(
                    "IMAGE_VARIANT_SOURCE_TOO_LARGE",
                    "图片像素超过 64 MP 限制",
                    {cause: error},
                );
            }
            throw new ImageVariantError(
                "IMAGE_VARIANT_DECODE_FAILED",
                "图片无法完整解码",
                {cause: error},
            );
        }
    }

    /** 使用同目录 temp 和 rename 原子发布；缓存故障只关闭后续持久写入。 */
    private async persist(cacheKey: string, sourceScope: string, bytes: Buffer): Promise<void> {
        if (!this.persistentWritesEnabled) {
            return;
        }
        const contentDigest = digestBytes(bytes);
        const fileName = `${sourceScope}-${cacheKey}-${contentDigest}.webp`;
        const target = path.join(this.cacheRoot, fileName);
        const temporary = path.join(this.cacheRoot, `.image-variant-${randomUUID()}.tmp`);
        try {
            const handle = await fs.open(temporary, "wx");
            try {
                await handle.writeFile(bytes);
                await handle.sync();
            } finally {
                await handle.close();
            }
            await fs.rename(temporary, target);
            const generatedAt = Date.now();
            this.inventory.set(cacheKey, {
                cacheKey,
                fileName,
                sourceScope,
                contentDigest,
                bytes: bytes.byteLength,
                generatedAt,
            });
            await this.reclaim();
        } catch {
            this.persistentWritesEnabled = false;
        } finally {
            try {
                await fs.rm(temporary, {force: true});
            } catch {
                this.persistentWritesEnabled = false;
            }
        }
    }

    /** 先收紧每源数量，再按生成时间收紧全局条目和字节预算。 */
    private async reclaim(): Promise<void> {
        const bySource = new Map<string, CacheEntry[]>();
        for (const entry of this.inventory.values()) {
            const entries = bySource.get(entry.sourceScope) ?? [];
            entries.push(entry);
            bySource.set(entry.sourceScope, entries);
        }
        for (const entries of bySource.values()) {
            entries.sort(oldestFirst);
            while (entries.length > this.limits.variantsPerSource) {
                await this.removeCacheEntry(entries.shift()!.cacheKey);
            }
        }

        const oldest = [...this.inventory.values()].sort(oldestFirst);
        let totalBytes = oldest.reduce((sum, entry) => sum + entry.bytes, 0);
        while (oldest.length > this.limits.cacheEntries || totalBytes > this.limits.cacheBytes) {
            const entry = oldest.shift()!;
            await this.removeCacheEntry(entry.cacheKey);
            totalBytes -= entry.bytes;
        }
    }

    /** 删除一个缓存项；失败时上抛，由调用方统一关闭后续持久写入。 */
    private async removeCacheEntry(cacheKey: string): Promise<void> {
        const entry = this.inventory.get(cacheKey);
        if (!entry) {
            return;
        }
        await fs.rm(path.join(this.cacheRoot, entry.fileName), {force: true});
        this.inventory.delete(cacheKey);
    }

    /** 以 active=2、queued=64 的固定预算执行读取与转换。 */
    private async schedule<T>(job: () => Promise<T>): Promise<T> {
        if (this.activeJobs >= this.limits.activeJobs) {
            if (this.queue.length >= this.limits.queuedJobs) {
                throw new ImageVariantError(
                    "IMAGE_VARIANT_QUEUE_SATURATED",
                    "图片变体服务正忙，请稍后重试",
                );
            }
            await new Promise<void>((resolve) => this.queue.push(resolve));
        }
        this.activeJobs += 1;
        try {
            return await job();
        } finally {
            this.activeJobs -= 1;
            this.queue.shift()?.();
        }
    }
}

/** 对调用方构造的规范化规格做最后一道不变量校验。 */
function validateNormalizedSpec(spec: ImageVariantSpec): void {
    if (
        (spec.width === undefined && spec.height === undefined)
        || (spec.width !== undefined && (!Number.isInteger(spec.width) || spec.width < 1 || spec.width > MAX_OUTPUT_EDGE))
        || (spec.height !== undefined && (!Number.isInteger(spec.height) || spec.height < 1 || spec.height > MAX_OUTPUT_EDGE))
        || (spec.fit !== "cover" && spec.fit !== "contain")
        || (spec.fit === "cover" && (spec.width === undefined || spec.height === undefined))
        || !Number.isInteger(spec.quality)
        || spec.quality < 40
        || spec.quality > 95
    ) {
        throw new ImageVariantError("INVALID_IMAGE_VARIANT", "图片变体参数无效");
    }
}

/** JSON 缓存键只保留输出相关字段，preset 与显式同规格自然共享缓存。 */
function canonicalSpec(spec: ImageVariantSpec): ImageVariantSpec {
    return Object.freeze({
        ...(spec.width !== undefined ? {width: spec.width} : {}),
        ...(spec.height !== undefined ? {height: spec.height} : {}),
        fit: spec.fit,
        quality: spec.quality,
    });
}

/**
 * 先按应用 EXIF 后的尺寸计算最终目标，保证 libvips 不会因方向 metadata 而放大小图。
 * contain 使用等比精确尺寸；cover 无法达到请求尺寸时返回同宽高比的最大原生裁剪。
 */
function resizePlan(
    sourceWidth: number,
    sourceHeight: number,
    spec: ImageVariantSpec,
): {readonly width: number; readonly height: number; readonly fit: "cover" | "fill"} {
    const boxWidth = spec.width ?? MAX_OUTPUT_EDGE;
    const boxHeight = spec.height ?? MAX_OUTPUT_EDGE;
    if (spec.fit === "contain") {
        const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight, 1);
        return Object.freeze({
            width: Math.max(1, Math.round(sourceWidth * scale)),
            height: Math.max(1, Math.round(sourceHeight * scale)),
            fit: "fill" as const,
        });
    }

    const requiredScale = Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
    if (requiredScale <= 1) {
        return Object.freeze({width: boxWidth, height: boxHeight, fit: "cover" as const});
    }
    const targetRatio = boxWidth / boxHeight;
    const sourceRatio = sourceWidth / sourceHeight;
    if (sourceRatio >= targetRatio) {
        return Object.freeze({
            width: Math.max(1, Math.floor(sourceHeight * targetRatio)),
            height: sourceHeight,
            fit: "cover" as const,
        });
    }
    return Object.freeze({
        width: sourceWidth,
        height: Math.max(1, Math.floor(sourceWidth / targetRatio)),
        fit: "cover" as const,
    });
}

/** 生成不泄漏 source identity 的稳定文件名片段。 */
function digest(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

/** 计算已读取缓存 bytes 的完整性摘要，不重新进入图片解码器。 */
function digestBytes(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** 淘汰只依赖生成时间；命中不更新磁盘时间，因此不是伪 LRU。 */
function oldestFirst(left: CacheEntry, right: CacheEntry): number {
    return left.generatedAt - right.generatedAt || left.fileName.localeCompare(right.fileName);
}
