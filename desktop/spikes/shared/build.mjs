import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname);
const output = resolve(root, "dist");
await mkdir(output, {recursive: true});
const result = await Bun.build({
    entrypoints: [resolve(root, "src", "product-launcher.ts")],
    outdir: output,
    target: "bun",
    format: "esm",
    naming: "product-launcher.mjs",
    sourcemap: "none",
    minify: false,
});
if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
}
console.log(JSON.stringify({output, outputs: result.outputs.map((item) => item.path)}, null, 4));
