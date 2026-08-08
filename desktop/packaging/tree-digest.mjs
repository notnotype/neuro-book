import {createHash} from "node:crypto";
import {readFile, stat, writeFile} from "node:fs/promises";
import {relative, resolve} from "node:path";

const root = resolve(process.env.NBOOK_DESKTOP_DEV_APPLICATION_ROOT ?? "");
if (!root || root === resolve(".")) throw new Error("NBOOK_DESKTOP_DEV_APPLICATION_ROOT 必须是显式 Application Root");

const files = [];
async function walk(current) {
    for (const entry of await (await import("node:fs/promises")).readdir(current, {withFileTypes: true})) {
        const path = resolve(current, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) {
            const content = await readFile(path);
            files.push({path: relative(root, path).replaceAll("\\", "/"), bytes: content.byteLength, sha256: createHash("sha256").update(content).digest("hex")});
        }
    }
}
await stat(root);
await walk(root);
files.sort((left, right) => left.path.localeCompare(right.path));
const digest = createHash("sha256").update(JSON.stringify(files)).digest("hex");
const report = {schema: "nbook.desktop-envelope-application-tree/v1", root, files, digest: `sha256:${digest}`};
const output = process.env.NBOOK_DESKTOP_DEV_TREE_DIGEST_OUTPUT;
if (output) await writeFile(output, `${JSON.stringify(report, null, 4)}\n`, "utf8");
const baseline = process.env.NBOOK_DESKTOP_DEV_TREE_DIGEST_BASELINE;
if (baseline) {
    const expected = JSON.parse(await readFile(baseline, "utf8"));
    if (expected.digest !== report.digest || JSON.stringify(expected.files) !== JSON.stringify(report.files)) {
        throw new Error(`Application Root tree digest changed：before=${expected.digest} after=${report.digest}`);
    }
}
console.log(JSON.stringify({root, files: files.length, digest: report.digest}, null, 4));
