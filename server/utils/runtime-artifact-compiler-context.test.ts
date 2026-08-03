import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";

const verifier = {
    openSelfVerified: vi.fn(async (path: string) => ({
        path,
        manifest: {
            imageId: "sha256:verified",
            version: "0.9.0",
            revision: "fixture-revision",
            platform: "windows-x64" as const,
            sourceDigest: "sha256:source",
            lockfileSha256: "sha256:lockfile",
        },
    })),
};

vi.mock("nbook/shared/product-runtime-image-verifier", () => ({
    ProductRuntimeImageVerifier: class {
        openSelfVerified = verifier.openSelfVerified;
    },
}));
import {
    resolveRuntimeArtifactCompilerContext,
    resolveRuntimeArtifactNbookPath,
} from "nbook/server/utils/runtime-artifact-compiler-context";

describe("runtime artifact compiler context", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("Product build只使用Authoring Kit编译上下文，artifact require继续指向Product runtime", async () => {
        const root = resolve(".agent", "tmp", "artifact-context-test", randomUUID());
        roots.push(root);
        const outputRoot = join(root, ".output", "server");
        const authoringRoot = join(outputRoot, "authoring");
        const outputNbookFile = join(authoringRoot, "nbook", "server", "marker.ts");
        await mkdir(join(root, "node_modules"), {recursive: true});
        await mkdir(join(authoringRoot, "nbook", "server"), {recursive: true});
        await mkdir(join(authoringRoot, "nbook", "world-engine", "schema"), {recursive: true});
        await writeFile(join(root, "package.json"), '{"name":"neuro-book"}\n', "utf8");
        await writeFile(join(root, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(outputRoot, "package.json"), '{"name":"neuro-book-output"}\n', "utf8");
        await writeFile(join(outputRoot, "index.mjs"), "", "utf8");
        await mkdir(join(authoringRoot, "node_modules", "typebox"), {recursive: true});
        await writeFile(join(authoringRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(authoringRoot, "package.json"), '{"name":"@notnotype/neuro-book-profile-authoring-kit"}\n', "utf8");
        await writeFile(join(authoringRoot, "profile-compile-worker.mjs"), "export {};\n", "utf8");
        await writeFile(outputNbookFile, "export const marker = true;\n", "utf8");
        await writeFile(join(authoringRoot, "nbook", "world-engine", "schema", "index.mjs"), "export {};\n", "utf8");
        await writeFile(join(authoringRoot, "nbook", "world-engine", "zod.mjs"), "export {};\n", "utf8");

        const context = await resolveRuntimeArtifactCompilerContext(root, {NEURO_BOOK_PRODUCT_IMAGE_ROOT: join(root, ".output")});

        expect(context).toEqual(expect.objectContaining({
            kind: "product",
            productRuntime: true,
            nbookRoot: join(authoringRoot, "nbook"),
            compilerPackageRoot: join(authoringRoot, "package.json"),
            compilerNodeModulesRoot: join(authoringRoot, "node_modules"),
            artifactRuntimeRequireRoot: join(outputRoot, "index.mjs"),
            tsconfigPath: join(authoringRoot, "tsconfig.json"),
        }));
        expect(context.kind === "product" ? context.imageIdentity.imageId : null).toBe("sha256:verified");
        expect(verifier.openSelfVerified).toHaveBeenCalledWith(join(root, ".output"));
        expect(resolveRuntimeArtifactNbookPath(context, "server/marker")).toBe(outputNbookFile);
    });

    it("Product缺少自包含tsconfig时拒绝回退Source根", async () => {
        const root = resolve(".agent", "tmp", "artifact-context-missing-test", randomUUID());
        roots.push(root);
        const outputRoot = join(root, ".output", "server");
        await mkdir(outputRoot, {recursive: true});
        await writeFile(join(root, "package.json"), '{"name":"neuro-book-product"}\n', "utf8");
        await writeFile(join(root, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(outputRoot, "package.json"), '{"name":"neuro-book-output"}\n', "utf8");
        await writeFile(join(outputRoot, "index.mjs"), "", "utf8");

        await expect(resolveRuntimeArtifactCompilerContext(root, {
            NEURO_BOOK_PRODUCT_IMAGE_ROOT: join(root, ".output"),
        })).rejects.toThrow("Product runtime 缺少自包含 Authoring Kit");
    });

    it("Product identity验证失败时拒绝回退完整Source checkout", async () => {
        const root = resolve(".agent", "tmp", "artifact-context-unverified-test", randomUUID());
        roots.push(root);
        const outputRoot = join(root, ".output", "server");
        const authoringRoot = join(outputRoot, "authoring");
        await mkdir(join(root, "node_modules"), {recursive: true});
        await mkdir(authoringRoot, {recursive: true});
        await writeFile(join(root, "package.json"), '{"name":"neuro-book"}\n', "utf8");
        await writeFile(join(root, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(outputRoot, "package.json"), '{"name":"neuro-book-output"}\n', "utf8");
        await writeFile(join(outputRoot, "index.mjs"), "", "utf8");
        await writeFile(join(authoringRoot, "package.json"), '{"name":"authoring-kit"}\n', "utf8");
        await writeFile(join(authoringRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(authoringRoot, "profile-compile-worker.mjs"), "export {};\n", "utf8");
        await mkdir(join(authoringRoot, "nbook", "world-engine", "schema"), {recursive: true});
        await writeFile(join(authoringRoot, "nbook", "world-engine", "schema", "index.mjs"), "export {};\n", "utf8");
        await writeFile(join(authoringRoot, "nbook", "world-engine", "zod.mjs"), "export {};\n", "utf8");
        verifier.openSelfVerified.mockRejectedValueOnce(new Error("tampered image"));

        await expect(resolveRuntimeArtifactCompilerContext(root, {
            NEURO_BOOK_PRODUCT_IMAGE_ROOT: join(root, ".output"),
        })).rejects.toThrow("必须来自 verified image identity");
    });

    it("没有显式 Product identity 时始终使用 Source Dev", async () => {
        const root = resolve(".agent", "tmp", "artifact-context-source-test", randomUUID());
        roots.push(root);
        const outputRoot = join(root, ".output", "server");
        await mkdir(outputRoot, {recursive: true});
        await writeFile(join(root, "package.json"), '{"name":"neuro-book-product"}\n', "utf8");
        await writeFile(join(outputRoot, "package.json"), '{"name":"neuro-book-output"}\n', "utf8");
        await writeFile(join(outputRoot, "index.mjs"), "", "utf8");

        await expect(resolveRuntimeArtifactCompilerContext(root)).resolves.toMatchObject({
            kind: "source",
            productRuntime: false,
        });
    });
});
