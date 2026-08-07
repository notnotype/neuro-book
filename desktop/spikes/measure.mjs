import {readdir, stat, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

async function tree(root) {
    const rootInfo = await stat(root);
    if (rootInfo.isFile()) return {files: 1, bytes: rootInfo.size};
    let files = 0;
    let bytes = 0;
    async function walk(current) {
        for (const entry of await readdir(current, {withFileTypes: true})) {
            const path = resolve(current, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (entry.isFile()) {
                files += 1;
                bytes += (await stat(path)).size;
            }
        }
    }
    await walk(root);
    return {files, bytes};
}

const root = resolve(import.meta.dirname);
const inputs = {
    productImage: process.env.T140_PRODUCT_IMAGE_ROOT,
    electronRuntime: resolve(root, "electron", "node_modules", "electron", "dist"),
    electronBundle: resolve(root, "electron", "dist"),
    tauriBinary: resolve(root, "tauri", "target", "release", "neuro-book-tauri-envelope-spike.exe"),
    tauriDebugSymbols: resolve(root, "tauri", "target", "release", "neuro_book_tauri_envelope_spike.pdb"),
};
const measurements = {};
for (const [name, value] of Object.entries(inputs)) {
    if (!value) continue;
    try {
        measurements[name] = {path: value, ...(await tree(value))};
    } catch (error) {
        measurements[name] = {path: value, missing: error instanceof Error ? error.message : String(error)};
    }
}
const report = {
    schema: "nbook.desktop-envelope-spike-measurement/v1",
    capturedAt: new Date().toISOString(),
    environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        bun: process.env.T140_BUN_VERSION ?? null,
        electron: process.env.T140_ELECTRON_VERSION ?? null,
        tauri: process.env.T140_TAURI_VERSION ?? null,
    },
    measurements,
};
const output = process.env.T140_MEASUREMENT_OUTPUT;
if (output) await writeFile(output, `${JSON.stringify(report, null, 4)}\n`, "utf8");
console.log(JSON.stringify(report, null, 4));
