/**
 * 第三方声明里列谁（`third-party-notices.ts`）：与发布包同一许可（AGPL-3.0-only）的自家包不列；自家换了许可的包（nb-layout 的 MIT）
 * 要列，否则应用包与 SDK 把它打进去时 MIT 的版权声明被静默丢掉；别人家的包不论许可都列（ADR 0054 第 5 条，w00026 t47）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {packageNotices, viteLicenseNotices, workspaceNotices} from "./third-party-notices";

let tmp: string;
const modules = () => join(tmp, "node_modules");

/** 在临时的 `node_modules` 下写一个包：`package.json` 与 LICENSE。 */
async function writePackage(name: string, license: string): Promise<string> {
    const directory = join(modules(), name);
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, "package.json"), JSON.stringify({name, version: "1.0.0", license}));
    await writeFile(join(directory, "LICENSE"), `${license} text of ${name}`);
    return directory;
}

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-notices", "third-party-notices");
});

afterAll(async () => {
    await rm(tmp, {recursive: true, force: true});
});

describe("列谁", () => {
    it("打包时找到的包目录：自家 AGPL 的不列，自家 MIT 的与别人家 AGPL 的都列", async () => {
        const directories = [
            await writePackage("@notnotype/nb-ui", "AGPL-3.0-only"),
            await writePackage("@notnotype/nb-layout", "MIT"),
            await writePackage("agpl-lib", "AGPL-3.0-only"),
        ];
        const notices = await packageNotices(directories);
        expect(notices.map((notice) => `${notice.name} ${notice.license}`)).toEqual(["@notnotype/nb-layout MIT", "agpl-lib AGPL-3.0-only"]);
        expect(notices[0]!.texts).toEqual(["MIT text of @notnotype/nb-layout"]);
    });

    it("Vite 的许可清单：同样的规则", async () => {
        const file = join(tmp, "license.json");
        await writeFile(file, JSON.stringify([
            {name: "@notnotype/nb-ui", version: "1.0.0", identifier: "AGPL-3.0-only", text: "AGPL"},
            {name: "@notnotype/nb-layout", version: "0.1.0", identifier: "MIT", text: "MIT License"},
            {name: "agpl-lib", version: "2.0.0", identifier: "AGPL-3.0-only", text: "AGPL"},
        ]));
        const notices = await viteLicenseNotices(file, modules());
        expect(notices.map((notice) => notice.name)).toEqual(["@notnotype/nb-layout", "agpl-lib"]);
    });

    it("工作区里的依赖：Vite 与 Bun 的清单看不见它们，按声明的依赖找，自家 AGPL 的不列、MIT 的列", async () => {
        const packages = join(tmp, "packages");
        for (const [dir, license] of [["nb-ui", "AGPL-3.0-only"], ["nb-layout", "MIT"]] as const) {
            await mkdir(join(packages, dir), {recursive: true});
            await writeFile(join(packages, dir, "package.json"), JSON.stringify({name: `@notnotype/${dir}`, version: "0.1.0", license}));
            await writeFile(join(packages, dir, "LICENSE"), `${license} text`);
        }
        const manifest = join(tmp, "app-package.json");
        await writeFile(manifest, JSON.stringify({dependencies: {"@notnotype/nb-ui": "workspace:^", vue: "^3.5.0"}, devDependencies: {"@notnotype/nb-layout": "workspace:^", "@notnotype/not-here": "workspace:*"}}));
        const notices = await workspaceNotices(manifest, packages);
        expect(notices.map((notice) => `${notice.name} ${notice.license}`)).toEqual(["@notnotype/nb-layout MIT"]);
        expect(notices[0]!.texts).toEqual(["MIT text"]);
    });
});
