import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {ensureDirectory} from "#manager/files";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("ensureDirectory", () => {
    it("accepts an existing directory", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-files-"));
        roots.push(root);

        await expect(ensureDirectory(root)).resolves.toBeUndefined();
    });

    it("does not turn an existing file into a directory", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-files-"));
        roots.push(root);
        const file = join(root, "not-a-directory");
        await writeFile(file, "fixture", "utf8");

        await expect(ensureDirectory(file)).rejects.toMatchObject({code: "EEXIST"});
    });
});
