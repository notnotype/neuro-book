/**
 * 内置角色表与服务、kit 按 id 取角色的对应：少了哪一个，那条路径就取不到模型（审批、压缩、缺省的主模型）。
 */

import {describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {MODEL_ROLES} from "@notnotype/nb-harness/kit/shapes";

import {BUILTIN_ROLES, DEFAULT_ROLES, MODEL_ROLE_IDS, RolesSchema} from "./shapes";

const builtinIds = new Set(BUILTIN_ROLES.map((role) => role.id));

describe("内置角色", () => {
    it("含服务按 id 取的每个角色", () => {
        for (const id of Object.values(MODEL_ROLE_IDS)) expect(builtinIds.has(id)).toBe(true);
    });

    it("含 nb-harness 的 kit 按角色取模型时用的每个 id", () => {
        for (const id of Object.values(MODEL_ROLES)) expect(builtinIds.has(id)).toBe(true);
    });

    it("缺省的角色设置是每个内置角色各一条、都未绑定，且符合设置形状", () => {
        expect(DEFAULT_ROLES.items.map((role) => role.id)).toEqual(BUILTIN_ROLES.map((role) => role.id));
        expect(DEFAULT_ROLES.items.every((role) => role.model === null)).toBe(true);
        expect(Value.Check(RolesSchema, DEFAULT_ROLES)).toBe(true);
    });
});
