import {copyFile, mkdir} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname);
const output = resolve(root, "dist");
await mkdir(output, {recursive: true});
const result = await Bun.build({
    entrypoints: [resolve(root, "src", "main.ts"), resolve(root, "src", "preload.ts")],
    outdir: output,
    target: "node",
    format: "esm",
    naming: "[name].mjs",
    external: ["electron"],
    sourcemap: "none",
    minify: false,
});
if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
}
await copyFile(resolve(root, "..", "tauri", "icons", "icon.ico"), resolve(output, "icon.ico"));
console.log(JSON.stringify({output, outputs: result.outputs.map((item) => item.path)}, null, 4));
