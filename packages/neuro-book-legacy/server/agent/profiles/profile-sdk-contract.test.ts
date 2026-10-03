import {mkdtemp, readdir, readFile, rm, copyFile, mkdir, writeFile} from "node:fs/promises";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {basename, join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {compileProfileArtifacts, createProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import {Fragment, jsx} from "nbook/profile-sdk/jsx-runtime";
import {ProfilePrompt, Type, builtin, defineAgentProfile, toolset} from "nbook/profile-sdk";

const builtinRoot = resolve("assets/workspace/.nbook/agent/profiles/builtin");
async function artifactContext(profileRoot: string, rootLabel: string) {
    return createProfileArtifactPathContext(profileRoot, rootLabel, await resolveRuntimeArtifactCompilerContext(resolve(".")));
}
const templateRoot = resolve("assets/workspace/.nbook/agent/profile-templates");
const temporaryRoots: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Profile SDK 稳定入口", () => {
    it("内置 Profile 与模板不再依赖 server 深层路径", async () => {
        const files = [
            ...await readdir(builtinRoot),
            ...await readdir(templateRoot),
        ].filter((fileName) => fileName.endsWith(".tsx"));
        const violations: string[] = [];
        for (const fileName of files) {
            const root = fileName.endsWith(".profile.tsx") ? builtinRoot : templateRoot;
            const source = await readFile(join(root, fileName), "utf8");
            if (source.includes("nbook/server/")) {
                violations.push(`${fileName}: server deep import`);
            }
            if (!source.includes("@jsxImportSource nbook/profile-sdk")) {
                violations.push(`${fileName}: unstable JSX runtime`);
            }
        }
        expect(violations).toEqual([]);
    });

    it("SDK JSX runtime 可直接构造 Profile DSL 节点", () => {
        expect(Fragment).toBeDefined();
        expect(jsx("System", {children: "ok"})).toMatchObject({
            kind: "System",
            children: ["ok"],
        });
    });

    it("SDK defineAgentProfile 只返回 authoring 声明", () => {
        const definition = defineAgentProfile({
            manifest: {key: "sdk-definition", name: "SDK Definition"},
            initialSchema: Type.Object({}),
            tools: toolset(builtin.file.read),
            context() {
                return ProfilePrompt({});
            },
        });

        expect(definition.manifest.key).toBe("sdk-definition");
        expect("rootToolKeys" in definition).toBe(false);
        expect("runtime" in definition).toBe(false);
        expect("prepare" in definition).toBe(false);
    });

    it("编译器拒绝 Profile 绕过 SDK 导入 server 实现", async () => {
        const temporaryRoot = await mkdtemp(testHostPath("nbook-profile-sdk-gate-"));
        temporaryRoots.push(temporaryRoot);
        const profileRoot = join(temporaryRoot, "profiles");
        await mkdir(profileRoot, {recursive: true});
        await writeFile(join(profileRoot, "deep.profile.tsx"), `
/** @jsxImportSource nbook/profile-sdk */
import {Type, defineAgentProfile, builtin, toolset, ProfilePrompt, System} from "nbook/profile-sdk";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";

export default defineAgentProfile({
    manifest: {key: "deep", name: "deep"},
    initialSchema: Type.Object({}),
    tools: toolset(builtin.file.read),
    context(_ctx: ProfilePrepareContext) {
        return <ProfilePrompt><System>deep</System></ProfilePrompt>;
    },
});
`, "utf8");
        const rootLabel = "profile-sdk-gate";
        const result = await compileProfileArtifacts({
            profileRoot,
            stagingRoot: join(temporaryRoot, "staging"),
            skipFresh: true,
            artifactPathContext: await artifactContext(profileRoot, rootLabel),
            orphanBudgetPolicy: "product",
        });

        expect(result.manifest.entries).toHaveLength(1);
        expect(result.manifest.entries[0]).toMatchObject({
            status: "compile_failed",
            issues: [{
                code: "compile_failed",
                message: expect.stringContaining("Profile SDK 违规"),
            }],
        });
    });

    it("编译器拒绝 Profile 导入 Authoring Kit 未提供的第三方包", async () => {
        const temporaryRoot = await mkdtemp(testHostPath("nbook-profile-sdk-package-gate-"));
        temporaryRoots.push(temporaryRoot);
        const profileRoot = join(temporaryRoot, "profiles");
        await mkdir(profileRoot, {recursive: true});
        await writeFile(join(profileRoot, "package.profile.ts"), `
import {z} from "zod";
import {Type, defineAgentProfile} from "nbook/profile-sdk";

export default defineAgentProfile({
    manifest: {key: "package", name: z.string().parse("package")},
    initialSchema: Type.Object({}),
    context() { return []; },
});
`, "utf8");
        const rootLabel = "profile-sdk-package-gate";
        const result = await compileProfileArtifacts({
            profileRoot,
            stagingRoot: join(temporaryRoot, "staging"),
            skipFresh: true,
            artifactPathContext: await artifactContext(profileRoot, rootLabel),
            orphanBudgetPolicy: "product",
        });

        expect(result.manifest.entries[0]).toMatchObject({
            status: "compile_failed",
            issues: [{message: expect.stringContaining("- zod")}],
        });
    });

    it("编译器只放行正式 writing SDK 子入口", async () => {
        const temporaryRoot = await mkdtemp(testHostPath("nbook-profile-sdk-writing-gate-"));
        temporaryRoots.push(temporaryRoot);
        const profileRoot = join(temporaryRoot, "profiles");
        await mkdir(profileRoot, {recursive: true});
        await writeFile(join(profileRoot, "writing.profile.ts"), `
import {Type, defineAgentProfile, builtin, toolset} from "nbook/profile-sdk";
import {DEFAULT_WRITING_STYLE_PRESET} from "nbook/profile-sdk/writing";

export default defineAgentProfile({
    manifest: {key: "writing", name: DEFAULT_WRITING_STYLE_PRESET},
    initialSchema: Type.Object({}),
    tools: toolset(builtin.file.read),
    context() { return []; },
});
`, "utf8");
        await writeFile(join(profileRoot, "hidden.profile.ts"), `
import {Type, defineAgentProfile, builtin, toolset} from "nbook/profile-sdk";
import type {ProfilePrepareContext} from "nbook/profile-sdk/contracts";

export default defineAgentProfile({
    manifest: {key: "hidden", name: "Hidden"},
    initialSchema: Type.Object({}),
    tools: toolset(builtin.file.read),
    context(_ctx: ProfilePrepareContext) { return []; },
});
`, "utf8");
        const rootLabel = "profile-sdk-writing-gate";
        const result = await compileProfileArtifacts({
            profileRoot,
            stagingRoot: join(temporaryRoot, "staging"),
            skipFresh: true,
            artifactPathContext: await artifactContext(profileRoot, rootLabel),
            orphanBudgetPolicy: "product",
        });

        expect(result.manifest.entries.find((entry) => entry.fileName === "writing.profile.ts")?.status).toBe("loaded");
        expect(result.manifest.entries.find((entry) => entry.fileName === "hidden.profile.ts")).toMatchObject({
            status: "compile_failed",
            issues: [{message: expect.stringContaining("nbook/profile-sdk/contracts")}],
        });
    });

    it("14 个内置 Profile 只通过 SDK 完成空目标编译", async () => {
        const temporaryRoot = await mkdtemp(testHostPath("nbook-profile-sdk-"));
        temporaryRoots.push(temporaryRoot);
        const profileRoot = join(temporaryRoot, "profiles");
        const stagingRoot = join(temporaryRoot, "staging");
        await mkdir(profileRoot, {recursive: true});
        const sourceFiles = (await readdir(builtinRoot)).filter((fileName) => fileName.endsWith(".profile.tsx"));
        await Promise.all(sourceFiles.map((fileName) => copyFile(join(builtinRoot, fileName), join(profileRoot, basename(fileName)))));
        const rootLabel = "profile-sdk-contract";
        const result = await compileProfileArtifacts({
            profileRoot,
            stagingRoot,
            skipFresh: true,
            artifactPathContext: await artifactContext(profileRoot, rootLabel),
            orphanBudgetPolicy: "product",
        });

        expect(result.manifest.entries).toHaveLength(14);
        const ordinaryProfiles = result.manifest.profiles.filter((entry) => !["writer", "rp.writer"].includes(entry.profileKey));
        expect(ordinaryProfiles).toHaveLength(12);
        for (const profile of ordinaryProfiles) {
            const dependencyPaths = profile.dependencies.map((dependency) => dependency.path.replaceAll("\\", "/"));
            expect(dependencyPaths, profile.fileName).not.toContain("server/agent/profiles/writer-writing-reference.ts");
            expect(dependencyPaths, profile.fileName).not.toContain("server/agent/profiles/writer-writing-style.ts");
            expect(dependencyPaths, profile.fileName).not.toContain("server/utils/frontmatter-document.ts");
            expect(dependencyPaths.join("\n"), profile.fileName).not.toMatch(/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?(?:yaml|zod)\//u);
        }
    }, 120_000);
});
