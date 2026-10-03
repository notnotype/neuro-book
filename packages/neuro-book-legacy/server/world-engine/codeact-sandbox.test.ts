/**
 * Phase 3: CodeAct Sandbox 测试
 */

import { describe, test, expect } from "vitest";
import { executeCodeAct } from "./codeact-sandbox";
import type { WorldApi } from "./codeact-sandbox";

describe("CodeAct Sandbox", () => {
    describe("基础执行", () => {
        test("执行简单代码", async () => {
            const mockApi = createMockWorldApi({
                subject: {
                    ...createMockWorldApi().subject,
                    async get() { return { hp: 100 }; },
                },
            });

            const result = await executeCodeAct("return 1 + 1", mockApi);
            expect(result).toBe(2);
        });

        test("可以访问 world API", async () => {
            const mockApi = createMockWorldApi({
                subject: {
                    ...createMockWorldApi().subject,
                    async get(id: string) {
                        return id === "test" ? { hp: 100 } : null;
                    },
                },
            });

            const result = await executeCodeAct(
                `const data = await world.subject.get("test"); return data.hp;`,
                mockApi,
            );
            expect(result).toBe(100);
        });

        test("支持 async/await", async () => {
            const mockApi = createMockWorldApi({
                subject: {
                    ...createMockWorldApi().subject,
                    async list() { return [{ id: "a", type: "character", name: "A" }]; },
                },
            });

            const result = await executeCodeAct(
                `const items = await world.subject.list("character"); return items.length;`,
                mockApi,
            );
            expect(result).toBe(1);
        });

        test("不暴露旧平铺 World API alias", async () => {
            const mockApi = createMockWorldApi();

            const result = await executeCodeAct(
                `return {
                    getMany: typeof world.getMany,
                    gets: typeof world.gets,
                    get: typeof world.get,
                    list: typeof world.list,
                    parseTime: typeof world.parseTime,
                    writeSlice: typeof world.writeSlice,
                    editMutations: typeof world.editMutations,
                    getSlice: typeof world.getSlice,
                };`,
                mockApi,
            );

            expect(result).toEqual({
                getMany: "undefined",
                gets: "undefined",
                get: "undefined",
                list: "undefined",
                parseTime: "undefined",
                writeSlice: "undefined",
                editMutations: "undefined",
                getSlice: "undefined",
            });
        });
    });

    describe("安全限制", () => {
        test("异步代码超时限制", async () => {
            const mockApi = createMockWorldApi();

            await expect(
                executeCodeAct(
                    "await new Promise((resolve) => setTimeout(resolve, 200)); return 'done';",
                    mockApi,
                    { timeout: 50 },
                ),
            ).rejects.toThrow("执行超时");
        });

        test("结果大小限制", async () => {
            const mockApi = createMockWorldApi();

            await expect(
                executeCodeAct(
                    "return Array(10000).fill('x').join('')",
                    mockApi,
                    { maxResultSize: 100 },
                ),
            ).rejects.toThrow("查询结果超过");
        });
    });

    describe("允许的内置对象", () => {
        test("可以使用 Math", async () => {
            const mockApi = createMockWorldApi();

            const result = await executeCodeAct("return Math.sqrt(16)", mockApi);
            expect(result).toBe(4);
        });

        test("可以使用 JSON", async () => {
            const mockApi = createMockWorldApi();

            const result = await executeCodeAct(
                'return JSON.parse(\'{"a": 1}\')',
                mockApi,
            );
            expect(result).toEqual({ a: 1 });
        });

        test("可以使用 Array/Object", async () => {
            const mockApi = createMockWorldApi();

            const result = await executeCodeAct(
                "return Object.keys({ a: 1, b: 2 })",
                mockApi,
            );
            expect(result).toEqual(["a", "b"]);
        });
    });
});

function createMockWorldApi(overrides: Partial<WorldApi> = {}): WorldApi {
    return {
        time: {
            parse() { return BigInt(0); },
            format(instant: bigint) { return instant.toString(); },
            now() { return BigInt(0); },
        },
        subject: {
            async get() { return null; },
            async gets() { return []; },
            async list() { return []; },
            async findRefs() { return []; },
        },
        search: {
            async text() { return []; },
        },
        slice: {
            async list() { return []; },
            async get() { return null; },
        },
        ...overrides,
    };
}
