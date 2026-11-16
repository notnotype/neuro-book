/**
 * 产品版本常量与包 `package.json` 保持一致：插件兼容检查与内置插件版本都用它，漂移会让第三方插件误判兼容。`engines.bun` 同理：
 * `nbook` 入口按它拦低版本的 Bun。
 */

import {expect, it} from "bun:test";
import {readFileSync} from "node:fs";

import semver from "semver";

import {BUN_ENGINE, PLUGIN_API_SINCE, PRODUCT_VERSION} from "./product";

it("PRODUCT_VERSION 与 package.json 的 version 一致", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {readonly version?: unknown};
    expect(pkg.version).toBe(PRODUCT_VERSION);
});

it("BUN_ENGINE 与 package.json 的 engines.bun 一致", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {readonly engines?: {readonly bun?: unknown}};
    expect(pkg.engines?.bun).toBe(BUN_ENGINE);
});

it("PLUGIN_API_SINCE 是规范的版本，不晚于 PRODUCT_VERSION", () => {
    expect(semver.valid(PLUGIN_API_SINCE)).toBe(PLUGIN_API_SINCE);
    expect(semver.lte(PLUGIN_API_SINCE, PRODUCT_VERSION)).toBe(true);
});
