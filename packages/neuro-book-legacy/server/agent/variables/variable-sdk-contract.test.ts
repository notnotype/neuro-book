import {describe, expect, it} from "vitest";
import {Type, defineWorkspaceRootVariable} from "nbook/variable-sdk";

describe("Variable SDK 稳定入口", () => {
    it("constructor 只返回 authoring 声明，不借用宿主默认值", () => {
        const definition = defineWorkspaceRootVariable({
            key: "sdk-contract",
            schema: Type.String(),
        });

        expect(definition).toMatchObject({namespace: "global", key: "sdk-contract"});
        expect("readable" in definition).toBe(false);
        expect("writableBy" in definition).toBe(false);
        expect("writeMode" in definition).toBe(false);
    });
});
