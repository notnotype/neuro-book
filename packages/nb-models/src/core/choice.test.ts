/** 选择顺序（docs/specs/models/service.md 输出 8）：每一步一条，前一步命中时后面的步骤不看。 */

import {describe, expect, it} from "bun:test";

import type {CoreSettings, ModelQuery} from "@notnotype/nb-harness/kernel/contracts";
import {MODEL_ROLES} from "@notnotype/nb-harness/kit/shapes";

import type {ProfileModelDefaults} from "../contract/service";
import {chooseModel} from "./choice";

const CORE: CoreSettings = {model: null, effort: null, approvalMode: "ask", readOnly: false};
const query = (patch: Partial<ModelQuery> = {}, model: string | null = null): ModelQuery => ({settings: {...CORE, model}, purpose: "turn", profile: "acme.writer", ...patch});

/** 记下被问到的 Profile；问到即说明走到了 Profile 那两步。 */
function profiles(defaults: ProfileModelDefaults) {
    const asked: string[] = [];
    return {asked, lookup: (profile: string): ProfileModelDefaults => {
        asked.push(profile);
        return defaults;
    }};
}

describe("选择顺序", () => {
    it("请求点名的角色先于用途、会话选择与 Profile", () => {
        const {asked, lookup} = profiles({model: "p/m", role: "deep"});
        expect(chooseModel(query({role: "tiny", purpose: "compaction"}, "x/y"), lookup)).toEqual({role: "tiny"});
        expect(asked).toEqual([]);
    });

    it("用途是压缩时取 kit 按角色取模型的那个压缩角色，先于会话选择", () => {
        const {asked, lookup} = profiles({model: "p/m"});
        expect(chooseModel(query({purpose: "compaction"}, "x/y"), lookup)).toEqual({role: MODEL_ROLES.compaction});
        expect(asked).toEqual([]);
    });

    it("用途是审批时取快速档，先于会话选择", () => {
        const {asked, lookup} = profiles({model: "p/m"});
        expect(chooseModel(query({purpose: "approval"}, "x/y"), lookup)).toEqual({role: "fast"});
        expect(asked).toEqual([]);
    });

    it("会话里选的（模型引用或 role:<id>）先于 Profile 缺省", () => {
        const {asked, lookup} = profiles({model: "p/m"});
        expect(chooseModel(query({}, "x/y"), lookup)).toEqual({selection: "x/y"});
        expect(chooseModel(query({purpose: "background"}, "role:deep"), lookup)).toEqual({selection: "role:deep"});
        expect(asked).toEqual([]);
    });

    it("没有会话选择时取当前 Profile 缺省的模型，先于它缺省的角色", () => {
        const {asked, lookup} = profiles({model: "p/m", role: "deep"});
        expect(chooseModel(query(), lookup)).toEqual({reference: "p/m"});
        expect(asked).toEqual(["acme.writer"]);
    });

    it("Profile 只给了角色时取那个角色；什么都没给、没有 Profile 缺省时取主力档", () => {
        expect(chooseModel(query(), profiles({role: "deep"}).lookup)).toEqual({role: "deep"});
        expect(chooseModel(query(), profiles({}).lookup)).toEqual({role: "main"});
        expect(chooseModel(query())).toEqual({role: "main"});
    });
});
