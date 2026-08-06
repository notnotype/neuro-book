import {copyFile, mkdir, rm} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname);
const output = resolve(root, "dist");
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
const mainResult = await Bun.build({
    entrypoints: [resolve(root, "src", "main.ts")],
    outdir: output,
    target: "node",
    format: "esm",
    naming: "main.mjs",
    external: ["electron"],
    sourcemap: "none",
    minify: false,
});
const preloadResult = await Bun.build({
    entrypoints: [resolve(root, "src", "preload.ts")],
    outdir: output,
    target: "node",
    format: "cjs",
    naming: "preload.cjs",
    external: ["electron"],
    sourcemap: "none",
    minify: false,
});
if (!mainResult.success || !preloadResult.success) {
    for (const log of [...mainResult.logs, ...preloadResult.logs]) console.error(log);
    process.exit(1);
}
await copyFile(resolve(root, "..", "tauri", "icons", "icon.ico"), resolve(output, "icon.ico"));
console.log(JSON.stringify({
    output,
    outputs: [...mainResult.outputs, ...preloadResult.outputs].map((item) => item.path),
}, null, 4));
