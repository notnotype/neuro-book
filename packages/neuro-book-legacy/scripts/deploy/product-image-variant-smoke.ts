#!/usr/bin/env bun
import {readdir} from "node:fs/promises";
import {imageMimeType} from "nbook/server/media/raster-image";
import {ImageVariantModule, IMAGE_VARIANT_PRESETS, type ImageVariantSource} from "nbook/server/media/image-variant";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

if (!process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || !process.env.NEURO_BOOK_STATE_ROOT?.trim()) {
    throw new Error("Product Image Variant smoke 必须显式设置 Application Root 与 State Root。");
}

const runtimePaths = runtimePathsFromEnv();
const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
);
let sourceReads = 0;
const nonce = `${String(process.pid)}-${String(Date.now())}`;
const source: ImageVariantSource = Object.freeze({
    identity: `product-smoke:${nonce}`,
    revision: "v1",
    read: async () => {
        sourceReads += 1;
        return png;
    },
});

const generated = await new ImageVariantModule(runtimePaths.imageVariantRoot)
    .render(source, IMAGE_VARIANT_PRESETS["project-cover"]);
const hit = await new ImageVariantModule(runtimePaths.imageVariantRoot)
    .render(source, IMAGE_VARIANT_PRESETS["project-cover"]);
const cacheNames = await readdir(runtimePaths.imageVariantRoot);
const cacheFiles = cacheNames.filter((name) => name.endsWith(".webp"));

if (generated.cache !== "generated" || hit.cache !== "hit") {
    throw new Error(`Product Image Variant cache 合同失败：${generated.cache} -> ${hit.cache}`);
}
if (generated.etag !== hit.etag || sourceReads !== 1) {
    throw new Error("Product Image Variant 缓存命中仍读取原图或改变了 ETag。");
}
if (imageMimeType(generated.bytes) !== "image/webp" || imageMimeType(hit.bytes) !== "image/webp") {
    throw new Error("Product Image Variant 没有生成固定 WebP。");
}
if (cacheFiles.length < 1 || cacheNames.some((name) => name.endsWith(".tmp"))) {
    throw new Error("Product Image Variant 没有原子发布持久缓存。");
}

console.log(JSON.stringify({
    ok: true,
    platform: `${process.platform}-${process.arch}`,
    cache: [generated.cache, hit.cache],
    sourceReads,
    outputBytes: generated.bytes.byteLength,
    cacheEntries: cacheFiles.length,
    imageVariantRoot: runtimePaths.imageVariantRoot,
}, null, 2));
