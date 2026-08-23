import {readdir, readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("Docker Product runtime contract", () => {
    it("runner 只消费 Builder 生成的 verified Runtime Image", async () => {
        const packageDirectories = (await readdir(resolve("packages"), {withFileTypes: true}))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
        const [dockerfile, dockerignore, entrypoint, releaseWorkflow, posixVerify, rootManifest, ...workspaceManifests] = await Promise.all([
            readFile(resolve("packages", "neuro-book", "Dockerfile"), "utf8"),
            readFile(resolve(".dockerignore"), "utf8"),
            readFile(resolve("scripts", "deploy", "docker-product-entrypoint.sh"), "utf8"),
            readFile(resolve(".github", "workflows", "release-container.yml"), "utf8"),
            readFile(resolve("scripts", "release", "verify-posix-product.sh"), "utf8"),
            readFile(resolve("package.json"), "utf8"),
            ...packageDirectories.map((directory) => readFile(resolve("packages", directory, "package.json"), "utf8")),
        ]);
        await expect(readFile(resolve("Dockerfile"), "utf8")).rejects.toThrow();

        expect(dockerfile).toContain("ARG NEURO_BOOK_SOURCE_REVISION");
        expect(dockerfile).toContain("ENV NEURO_BOOK_SOURCE_REVISION=${NEURO_BOOK_SOURCE_REVISION}");
        const dependencyStage = dockerfile.split("FROM runtime-base AS deps")[1]?.split("FROM runtime-base AS build")[0];
        expect(dependencyStage).toBeDefined();
        const installIndex = dependencyStage!.indexOf("bun install --frozen-lockfile --linker hoisted");
        expect(dependencyStage!.indexOf("COPY patches ./patches")).toBeLessThan(installIndex);
        expect(dependencyStage!.indexOf("COPY packages/neuro-agent-harness/src ./packages/neuro-agent-harness/src")).toBeLessThan(installIndex);
        expect(dependencyStage!.indexOf("COPY packages/neuro-agent-harness/tsconfig.json packages/neuro-agent-harness/tsconfig.build.json")).toBeLessThan(installIndex);
        const manifests = [rootManifest, ...workspaceManifests].map((source) => JSON.parse(source) as {
            name: string;
            scripts?: Record<string, string>;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            optionalDependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
        });
        expect(manifests[0]?.scripts?.postinstall).toBe("bun run --cwd packages/neuro-agent-harness build");
        const manifestPathByName = new Map(workspaceManifests.map((source, index) => [
            (JSON.parse(source) as {name: string}).name,
            `packages/${packageDirectories[index]}/package.json`,
        ]));
        const workspaceDependencies = new Set(manifests.flatMap((manifest) => [
            ...Object.entries(manifest.dependencies ?? {}),
            ...Object.entries(manifest.devDependencies ?? {}),
            ...Object.entries(manifest.optionalDependencies ?? {}),
            ...Object.entries(manifest.peerDependencies ?? {}),
        ]).filter(([, version]) => version.startsWith("workspace:"))
            .map(([name]) => name));
        for (const dependency of workspaceDependencies) {
            const manifestPath = manifestPathByName.get(dependency);
            expect(manifestPath, `${dependency}必须对应packages下的workspace manifest`).toBeDefined();
            const copyIndex = dependencyStage!.indexOf(`COPY ${manifestPath} ./${manifestPath}`);
            expect(copyIndex, `${dependency} manifest必须在frozen install前复制`).toBeGreaterThan(-1);
            expect(copyIndex).toBeLessThan(installIndex);
        }
        const buildStage = dockerfile.split("FROM runtime-base AS build")[1]?.split("FROM runtime-base AS runner")[0];
        expect(buildStage).toBeDefined();
        const sourceCopyIndex = buildStage!.indexOf("COPY . .");
        const harnessBuildIndex = buildStage!.indexOf("RUN bun run --cwd packages/neuro-agent-harness build");
        const productBuildIndex = buildStage!.indexOf("RUN NEURO_BOOK_OUTPUT_DIR=/app/.output bun run --cwd packages/neuro-book nuxt:build");
        expect(sourceCopyIndex).toBeGreaterThan(-1);
        expect(harnessBuildIndex).toBeGreaterThan(sourceCopyIndex);
        expect(productBuildIndex).toBeGreaterThan(harnessBuildIndex);
        const runnerStage = dockerfile.split("FROM runtime-base AS runner")[1];
        expect(runnerStage).toBeDefined();
        expect(runnerStage).toContain("ARG NEURO_BOOK_SOURCE_REVISION");
        expect(runnerStage).toContain("LABEL org.opencontainers.image.revision=${NEURO_BOOK_SOURCE_REVISION}");
        expect(dockerfile).toContain("RUN NEURO_BOOK_OUTPUT_DIR=/app/.output bun run --cwd packages/neuro-book nuxt:build");
        const dockerignoreEntries = dockerignore.split(/\r?\n/u);
        expect(dockerignoreEntries).toContain("logs");
        expect(dockerignoreEntries).toContain("packages/**/data.db");
        expect(dockerignoreEntries).toContain("packages/**/data.db-*");
        expect(dockerignoreEntries).toContain("packages/**/server/generated/prisma");
        expect(dockerignoreEntries).toContain("server/generated/prisma");
        expect(dockerignoreEntries).toContain("!packages/neuro-book/.env.docker.example");
        expect(dockerignoreEntries).not.toContain("packages/llmlint/web/data.db");
        expect(dockerfile).toContain("COPY --from=build /app/scripts/deploy/docker-product-entrypoint.sh ./docker-product-entrypoint.sh");
        expect(dockerfile).toContain('ENTRYPOINT ["sh", "./docker-product-entrypoint.sh"]');
        for (const sourceDirectory of ["/app/app", "/app/server", "/app/shared", "/app/scripts ./scripts", "/app/docs", "/app/assets"]) {
            expect(dockerfile).not.toContain(sourceDirectory);
        }
        expect(dockerfile).not.toContain("prepare-system-assets.ts --force --product-build");
        expect(releaseWorkflow.replaceAll("\r\n", "\n")).toContain([
            "          context: .",
            "          file: packages/neuro-book/Dockerfile",
        ].join("\n"));
        expect(releaseWorkflow.replaceAll("\r\n", "\n")).toContain([
            "build-args: |",
            "            NEURO_BOOK_SOURCE_REVISION=${{ inputs.revision }}",
        ].join("\n"));
        expect(entrypoint).toContain(".output/server/commands/product-command.mjs command start");
        expect(entrypoint).not.toContain("command migrate-database");
        expect(entrypoint).not.toContain("command migrate-application-state");
        expect(entrypoint).not.toContain(".output/server/scripts/");
        expect(posixVerify).toContain(".output/server/commands/product-command.mjs command migrate-application-state --apply");
        expect(posixVerify).not.toContain("command migrate-database");
        expect(releaseWorkflow).toContain('"${product_root}/.output/server/commands/product-command.mjs" command migrate-application-state --apply');
        expect(releaseWorkflow).not.toContain("command migrate-database");
    });
});
