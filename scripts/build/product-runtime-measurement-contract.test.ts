import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

import {PRODUCT_PLATFORMS} from "@notnotype/neuro-book-contracts/platform";

import {selectProductPlatformMatrix} from "#scripts/build/product-platform-matrix";

describe("Product Runtime Image measurement contracts", () => {
    it("根编排器持有 measurement 与 policy preflight，应用包持有 Nuxt build", async () => {
        const [rootPackage, applicationPackage] = await Promise.all([
            readFile("package.json", "utf8").then((source) => JSON.parse(source) as {scripts: Record<string, string>}),
            readFile(resolve("packages", "neuro-book", "package.json"), "utf8")
                .then((source) => JSON.parse(source) as {scripts: Record<string, string>}),
        ]);

        expect(rootPackage.scripts["product:measure"]).toBe("bun scripts/build/measure-product-runtime-image.ts");
        expect(rootPackage.scripts["product:policy:check"]).toBe("bun scripts/build/check-product-runtime-policies.ts --require-all");
        expect(applicationPackage.scripts["nuxt:build"]).toBe("bun ../../scripts/build/build-product-runtime-image.ts");
    });

    it("手动 workflow 覆盖全部平台且只上传 measurement report", async () => {
        const workflow = await readFile(".github/workflows/product-runtime-baselines.yml", "utf8");

        expect(workflow).toContain("workflow_dispatch:");
        expect(workflow).not.toContain("pull_request:");
        expect(workflow).not.toContain("release:");
        for (const platform of PRODUCT_PLATFORMS) {
            expect(workflow).toContain(`platform: ${platform}`);
        }
        expect(workflow.match(/bun run product:measure --output/gu)).toHaveLength(2);
        expect(workflow).toContain("compare-product-runtime-measurements.ts");
        expect(workflow).toMatch(/name: Upload baseline measurement\r?\n\s+if: always\(\)/u);
        expect(workflow).toContain("product-runtime-measurement-${{ matrix.platform }}");
        expect(workflow).not.toContain("bun run nuxt:build\n");
        expect(workflow).not.toContain("release:product:");
    });

    it("平台 CI 按登记状态分流，正式 release 在构建前检查全部 policy", async () => {
        const [platformChecks, release] = await Promise.all([
            readFile(".github/workflows/product-platforms.yml", "utf8"),
            readFile(".github/workflows/release-container.yml", "utf8"),
        ]);

        expect(platformChecks).toContain("check-product-runtime-policies.ts --platform");
        expect(platformChecks).toContain("steps.runtime_policy.outputs.registered != 'true'");
        expect(platformChecks).toContain("steps.runtime_policy.outputs.registered == 'true'");
        expect(platformChecks).toContain("bun run product:measure --output");
        expect(selectProductPlatformMatrix("push").map((entry) => entry.platform).sort())
            .toEqual(PRODUCT_PLATFORMS.filter((candidate) => candidate !== "windows-x64").sort());
        expect(platformChecks).toMatch(
            /name: Verify Manager platform contracts\r?\n\s+if: steps\.runtime_policy\.outputs\.registered == 'true'/u,
        );
        expect(release).toContain("Verify approved Product Runtime Image policies");
        expect(release).toContain("run: bun run product:policy:check");
    });
});
