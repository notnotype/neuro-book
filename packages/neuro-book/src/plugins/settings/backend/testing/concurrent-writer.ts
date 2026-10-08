/**
 * 测试用的独立进程：在给定的配置文件上建一个层拥有者，依次写 `count` 个自己的键，然后退出。两个这样的进程同时写
 * 同一个文件，用来验证写入锁让两边的键都保留（docs/specs/settings/configuration.md 验收 5）。
 *
 * 参数：<配置文件路径> <键名前缀> <个数>。键是 `x.race/<前缀><序号>`，两个进程的前缀不同。
 */

import {createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {Type} from "typebox";

import {defineSetting} from "nbook/shared/settings";

import type {DeclaredSetting} from "../../shared/layers";
import {createLayerOwner} from "../layer-owner";

const [path, prefix, countText] = process.argv.slice(2);
if (path === undefined || prefix === undefined || countText === undefined) throw new Error("用法：concurrent-writer.ts <路径> <前缀> <个数>");
const count = Number(countText);
const title = {"zh-CN": "竞争", "en-US": "Race"};

const declarations = new Map<string, DeclaredSetting>();
for (const side of ["a", "b"]) {
    for (let index = 0; index < count; index += 1) {
        const setting = defineSetting({plugin: "x.race", name: `${side}${String(index)}`, schema: Type.Number(), default: 0, title});
        declarations.set(setting.key, {plugin: "x.race", declaration: setting.declaration});
    }
}

const owner = createLayerOwner({
    path,
    layer: "project",
    declarations: () => declarations,
    clock: new ManualClock(),
    diagnostics: createDiagnosticsStore({identity: {location: "project", instanceId: `writer-${prefix}`}}),
    source: "nbook.settings",
});
await owner.ready;
const consumer = {instanceId: "writer", location: "project", client: null, plugin: "x.race", entry: "main", generation: 1, via: null} as const;
for (let index = 0; index < count; index += 1) {
    const result = await owner.write(consumer, `x.race/${prefix}${String(index)}`, {kind: "set", value: index + 1});
    if (!result.ok) throw new Error(`写入失败：${result.code} ${result.detail}`);
}
await owner.close();
console.log("done");
