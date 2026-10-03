import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {projectLlmlintSkill} from "nbook/server/workspace-files/llmlint-skill-projection";

describe("llmlint skill system asset projection", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("只投影包源码，排除用户状态/评测/依赖并校验manifest与文件内容", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "nbook-llmlint-projection-"));
        roots.push(root);
        const sourceRoot = path.join(root, "packages", "llmlint", "skill");
        const targetRoot = path.join(root, "assets", "workspace", ".nbook", "agent", "skills", "llmlint");
        await Promise.all([
            mkdir(path.join(sourceRoot, "src"), {recursive: true}),
            mkdir(path.join(sourceRoot, "node_modules", "ignored"), {recursive: true}),
            mkdir(path.join(sourceRoot, "evals", "ignored"), {recursive: true}),
            mkdir(path.join(targetRoot, "stale"), {recursive: true}),
        ]);
        await Promise.all([
            writeFile(path.join(sourceRoot, "package.json"), JSON.stringify({name: "llmlint", version: "3.0.0"}), "utf8"),
            writeFile(path.join(sourceRoot, "SKILL.md"), "# Skill\n", "utf8"),
            writeFile(path.join(sourceRoot, "src", "cli.ts"), "export const cli = true;\n", "utf8"),
            writeFile(path.join(sourceRoot, "node_modules", "ignored", "index.js"), "ignored\n", "utf8"),
            writeFile(path.join(sourceRoot, "evals", "ignored", "report.json"), "ignored\n", "utf8"),
            writeFile(path.join(sourceRoot, ".env.local"), "SECRET=ignored\n", "utf8"),
            writeFile(path.join(targetRoot, "stale", "old.txt"), "stale\n", "utf8"),
        ]);

        const result = await projectLlmlintSkill({sourceRoot, targetRoot});

        expect(result.sourceFiles).toBe(3);
        expect(result.copied).toBe(3);
        expect(result.removed).toBe(1);
        await expect(readFile(path.join(targetRoot, "SKILL.md"), "utf8")).resolves.toBe("# Skill\n");
        await expect(readFile(path.join(targetRoot, "src", "cli.ts"), "utf8")).resolves.toContain("cli");
        await expect(readFile(path.join(targetRoot, "node_modules", "ignored", "index.js"), "utf8")).rejects.toThrow();
        await expect(readFile(path.join(targetRoot, "evals", "ignored", "report.json"), "utf8")).rejects.toThrow();
        await expect(readFile(path.join(targetRoot, ".env.local"), "utf8")).rejects.toThrow();

        await writeFile(path.join(sourceRoot, "src", "cli.ts"), "export const cli = false;\n", "utf8");
        const second = await projectLlmlintSkill({sourceRoot, targetRoot});
        expect(second.unchanged).toBe(2);
        expect(second.copied).toBe(1);
        await expect(readFile(path.join(targetRoot, "src", "cli.ts"), "utf8")).resolves.toContain("false");
    });

    it("缺少llmlint manifest时fail closed", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "nbook-llmlint-projection-invalid-"));
        roots.push(root);
        const sourceRoot = path.join(root, "source");
        const targetRoot = path.join(root, "target");
        await mkdir(sourceRoot, {recursive: true});
        await writeFile(path.join(sourceRoot, "README.md"), "source\n", "utf8");

        await expect(projectLlmlintSkill({sourceRoot, targetRoot})).rejects.toThrow("package.json");
    });
});
