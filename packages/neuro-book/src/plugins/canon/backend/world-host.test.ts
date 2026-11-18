/**
 * 世界宿主转交插件诊断的登记（world-host.ts 的 `registerDiagnostics`；docs/specs/canon/project.md 输出 34）：真实的宿主在临时项目里
 * 打开世界，订阅世界服务的事件。首次登记、同一插件再登记（替换）、注销各通知一次；替换不先注销，旧登记的停止函数之后调不起作用。
 */

import {rm} from "node:fs/promises";

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {WorldService} from "@notnotype/nb-canon/node";

import {BUILTIN_COMPONENTS} from "../shared/components";
import {createWorldHost} from "./world-host";
import type {WorldHost} from "./world-host";

let root = "";
let host: WorldHost | null = null;

beforeEach(async () => {
    root = await createTestTmpRoot("neuro-book-canon", "world-host");
});

afterEach(async () => {
    await host?.stop();
    host = null;
    await rm(root, {recursive: true, force: true});
});

async function opened(): Promise<{host: WorldHost; service: WorldService}> {
    host = createWorldHost(root, () => undefined);
    host.setComponents(BUILTIN_COMPONENTS);
    const service = await host.ready();
    if ("code" in service) throw new Error(service.code);
    return {host, service};
}

describe("世界宿主：插件诊断的登记", () => {
    it("首次登记、同一插件再登记、注销各通知一次 diagnostics；替换掉的那次登记的停止函数之后调不起作用", async () => {
        const {host, service} = await opened();
        const seen: string[] = [];
        service.subscribe((event) => {
            if (event.kind === "inputChanged") seen.push(event.what);
        });
        const first = host.registerDiagnostics("test.plugin", {compute: {}, dataVersion: "1"});
        expect(seen.splice(0)).toEqual(["diagnostics"]);
        const second = host.registerDiagnostics("test.plugin", {compute: {}, dataVersion: "1"});
        expect(seen.splice(0)).toEqual(["diagnostics"]);
        first();
        expect(seen.splice(0)).toEqual([]);
        second();
        expect(seen.splice(0)).toEqual(["diagnostics"]);
    });
});
