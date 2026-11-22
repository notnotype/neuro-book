/**
 * 设置页的远程合同：应用只给 id，`defineRemoteService` 接受这份定义（结构合法），推出的合同类型就是 `ModelsSettingsContract`，
 * 方法的输入、输出与失败各是自己的形状，不退化成 `unknown`。类型上的断言由 `bun run typecheck` 判定，运行时只核对结构。
 */

import {describe, expect, it} from "bun:test";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";
import type {Static} from "typebox";

import type {ModelsSnapshot} from "./shapes";
import {modelsSettingsSpec} from "./settings-spec";
import type {ModelsSettingsContract} from "./settings-spec";

/** 两个类型相同时为 true；`unknown`、`any` 与具体类型都不相同。 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const contract = defineRemoteService({id: "acme.models/settings", ...modelsSettingsSpec});

type Methods = RemoteImplementation<typeof contract>["methods"];

describe("设置页的远程合同", () => {
    it("应用加上 id 定义出的合同就是 ModelsSettingsContract，方法的输入、输出与失败码各有自己的类型", () => {
        const sameContract: Equals<typeof contract, ModelsSettingsContract> = true;
        const snapshotOutput: Equals<Static<ModelsSettingsContract["methods"]["snapshot"]["output"]>, ModelsSnapshot> = true;
        const setRoleInput: Equals<Parameters<Methods["setRole"]>[0], {id: string; model?: string | null; effort?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null; icon?: string | null}> = true;
        const setKeyErrors: Equals<keyof ModelsSettingsContract["methods"]["setKey"]["errors"], "invalid-value" | "write-conflict" | "settings-unavailable" | "unknown-provider" | "credentials-unavailable" | "partially-applied"> = true;
        const changedPayload: Equals<Static<ModelsSettingsContract["events"]["changed"]["payload"]>, ModelsSnapshot> = true;
        expect([sameContract, snapshotOutput, setRoleInput, setKeyErrors, changedPayload]).toEqual([true, true, true, true, true]);

        expect(contract).toMatchObject({id: "acme.models/settings", version: 4, provider: "server", callers: ["browser"]});
        expect(Object.keys(contract.methods).sort()).toEqual([
            "addProvider", "addRole", "check", "checkAll", "clearKey", "duplicateProvider", "enabledModels", "modelsByReference", "providerModels",
            "refreshSource", "removeModel", "removeProvider", "removeRole", "setIcon", "setKey", "setModels", "setRole", "snapshot", "templates", "updateProvider", "updateRole", "upsertModel",
        ]);
    });
});
