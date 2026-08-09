import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {
    isCanonicalMachineManagerPath,
    isCanonicalMachineProductImagePath,
    materializeMachineManagerScript,
    materializeMachineProductImage,
} from "nbook/desktop/shared/src/manager-runtime";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("machine Manager runtime projection", () => {
    it("只把 canonical Program Files Manager 投影到 Cache Root，并按摘要复用", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-runtime-"));
        roots.push(root);
        const programFiles = join(root, "Program Files");
        const source = join(programFiles, "NeuroBook", "manager", "neuro-book.mjs");
        const cache = join(root, "Cache");
        await mkdir(resolve(source, ".."), {recursive: true});
        await writeFile(source, "console.log('manager')\n", "utf8");

        expect(isCanonicalMachineManagerPath(source, programFiles)).toBe(true);
        const first = await materializeMachineManagerScript(source, cache, programFiles);
        const second = await materializeMachineManagerScript(source, cache, programFiles);

        expect(first).toBe(second);
        expect(first).toContain(join("Cache", "manager-runtime"));
        await expect(readFile(first, "utf8")).resolves.toBe("console.log('manager')\n");
    });

    it("非 canonical 路径保持原路径，不建立缓存副本", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-runtime-portable-"));
        roots.push(root);
        const source = join(root, "manager", "neuro-book.mjs");
        await mkdir(resolve(source, ".."), {recursive: true});
        await writeFile(source, "console.log('portable')\n", "utf8");

        await expect(materializeMachineManagerScript(source, join(root, "Cache"), join(root, "Program Files"))).resolves.toBe(resolve(source));
    });

    it("machine Product image 投影完整 .output 到 Cache，并按 imageId 复用", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-product-runtime-"));
        roots.push(root);
        const programFiles = join(root, "Program Files");
        const source = join(programFiles, "NeuroBook", ".output");
        const cache = join(root, "Cache");
        await mkdir(join(source, "server", "commands", "chunks"), {recursive: true});
        await writeFile(join(source, "runtime-image.json"), JSON.stringify({imageId: `sha256:${"a".repeat(64)}`}), "utf8");
        await writeFile(join(source, "server", "index.mjs"), "export {};\n", "utf8");
        await writeFile(join(source, "server", "commands", "product-command.mjs"), "console.log('product');\n", "utf8");
        await writeFile(join(source, "server", "commands", "chunks", "shared.mjs"), "export {};\n", "utf8");

        expect(isCanonicalMachineProductImagePath(source, programFiles)).toBe(true);
        const first = await materializeMachineProductImage(source, cache, programFiles);
        const second = await materializeMachineProductImage(source, cache, programFiles);

        expect(first).toBe(second);
        expect(first).toContain(join("Cache", "product-runtime"));
        await expect(readFile(join(first, "server", "commands", "product-command.mjs"), "utf8"))
            .resolves.toBe("console.log('product');\n");
    });

    it("Portable 或非 canonical Product image 不复制", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-product-runtime-portable-"));
        roots.push(root);
        const source = join(root, ".output");
        await mkdir(join(source, "server"), {recursive: true});
        await writeFile(join(source, "runtime-image.json"), JSON.stringify({imageId: `sha256:${"b".repeat(64)}`}), "utf8");

        await expect(materializeMachineProductImage(source, join(root, "Cache"), join(root, "Program Files")))
            .resolves.toBe(resolve(source));
    });
});
