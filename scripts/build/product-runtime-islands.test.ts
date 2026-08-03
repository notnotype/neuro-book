import {mkdir, mkdtemp, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {
    productRuntimeIslandDefinitions,
    productRuntimeIslandPackageNames,
    productRuntimeIslandSourceRoot,
} from "nbook/scripts/build/product-runtime-islands";

const temporaryRoots: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Product Runtime package island graph", () => {
    it("从声明 package 内解析未 hoist 的动态与平台依赖", async () => {
        const root = await createSourceFixture({
            jsdomDependencies: {"nested-dynamic": "1.0.0"},
        });

        const definitions = productRuntimeIslandDefinitions();
        const platformOwner = definitions[1]!.packages[0]!;
        const nestedPlatformPackage = definitions[1]!.packages[1]!;

        expect(productRuntimeIslandPackageNames(root)).toEqual(expect.arrayContaining([
            "jsdom",
            "nested-dynamic",
            nestedPlatformPackage,
        ]));
        await expect(realpath(join(root, "node_modules", "jsdom", "node_modules", "nested-dynamic")))
            .resolves.toBe(productRuntimeIslandSourceRoot("nested-dynamic", root));
        await expect(realpath(join(
            root,
            "node_modules",
            ...platformOwner.split("/"),
            "node_modules",
            ...nestedPlatformPackage.split("/"),
        ))).resolves.toBe(productRuntimeIslandSourceRoot(nestedPlatformPackage, root));
    });

    it("拒绝动态闭包中同名不同版本的 package 实例", async () => {
        const root = await createSourceFixture({
            jsdomDependencies: {"parent-a": "1.0.0", "parent-b": "1.0.0"},
        });
        for (const [parentName, sharedVersion] of [["parent-a", "1.0.0"], ["parent-b", "2.0.0"]] as const) {
            const parentRoot = join(root, "node_modules", "jsdom", "node_modules");
            await writePackage(parentRoot, parentName, "1.0.0", {dependencies: {shared: sharedVersion}});
            await writePackage(
                join(parentRoot, parentName, "node_modules"),
                "shared",
                sharedVersion,
            );
        }

        expect(() => productRuntimeIslandPackageNames(root))
            .toThrow("Product package island 无法扁平化 shared：1.0.0 != 2.0.0");
    });
});

/** 创建具备当前平台静态 islands 的最小 Source Root。 */
async function createSourceFixture(options: {
    jsdomDependencies: Record<string, string>;
}): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-runtime-islands-"));
    temporaryRoots.push(root);
    await writeFile(join(root, "package.json"), `${JSON.stringify({name: "fixture", private: true})}\n`, "utf8");
    await writePackage(join(root, "node_modules"), "jsdom", "1.0.0", {
        dependencies: options.jsdomDependencies,
    });
    await writePackage(join(root, "node_modules"), "typescript", "1.0.0");

    const staticDefinitions = productRuntimeIslandDefinitions().slice(1);
    for (const definition of staticDefinitions) {
        const [owner, ...dependencies] = definition.packages;
        await writePackage(join(root, "node_modules"), owner, "1.0.0", {
            optionalDependencies: Object.fromEntries(dependencies.map((packageName) => [packageName, "1.0.0"])),
        });
        for (const packageName of dependencies) {
            await writePackage(
                join(root, "node_modules", ...owner.split("/"), "node_modules"),
                packageName,
                "1.0.0",
            );
        }
    }
    for (const packageName of options.jsdomDependencies ? Object.keys(options.jsdomDependencies) : []) {
        await writePackage(join(root, "node_modules", "jsdom", "node_modules"), packageName, "1.0.0");
    }
    return root;
}

/** 写入一个仅用于依赖图解析的最小 package。 */
async function writePackage(
    nodeModulesRoot: string,
    packageName: string,
    version: string,
    fields: {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
    } = {},
): Promise<void> {
    const packageRoot = join(nodeModulesRoot, ...packageName.split("/"));
    await mkdir(packageRoot, {recursive: true});
    await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
        name: packageName,
        version,
        ...fields,
    })}\n`, "utf8");
}
