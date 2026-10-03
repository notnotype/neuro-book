import {describe, expect, it} from "vitest";
import {modelLibrary, modelKnowledge} from "nbook/server/models/model-library";

describe("Model Library", () => {
    it("按精确 model ID 生成唯一稳定条目，不暴露 Provider 价格和传输配置", () => {
        const library = modelLibrary();
        const ids = library.models.map((model) => model.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual([...ids].sort((left, right) => left.localeCompare(right)));

        const mimo = modelKnowledge("mimo-v2.5-pro");
        expect(mimo).toMatchObject({source: "xiaomi", contextWindowTokens: 1_048_576, maxTokens: 131_072});
        expect(mimo).not.toHaveProperty("cost");
        expect(mimo).not.toHaveProperty("defaultApi");
        expect(mimo).not.toHaveProperty("compatByApi");
    });

    it("只允许精确 ID 命中", () => {
        expect(modelKnowledge("mimo-v2.5")).not.toBeNull();
        expect(modelKnowledge("mimo-v2.5 ")).not.toBeNull();
        expect(modelKnowledge("mimo")).toBeNull();
    });
});
