/**
 * 资源地址（docs/specs/workspace/resources.md 的“输入与前置条件”）。
 */

import {describe, expect, it} from "bun:test";

import {basenameOf, formatResource, joinResource, MAX_PATH_BYTES, parentOf, parseResource} from "./resource";

describe("Spec workspace.resources 资源地址", () => {
    it("合法地址解析为方案与相对路径；根是空路径；名字里的 : 与 .nbook 不由地址规则拒绝", () => {
        expect(parseResource("project://a/b.md")).toEqual({ok: true, resource: {scheme: "project", path: "a/b.md"}});
        expect(parseResource("user://")).toEqual({ok: true, resource: {scheme: "user", path: ""}});
        expect(parseResource("project://notes/a:b.md")).toEqual({ok: true, resource: {scheme: "project", path: "notes/a:b.md"}});
        expect(parseResource("project://第一卷/第2章.md")).toMatchObject({ok: true});
        expect(parseResource("project://.nbook/project.json")).toMatchObject({ok: true});
    });

    it("不合法的路径逐条为 invalid-address", () => {
        const cases = ["project:///a", "project://a/", "project://a//b", "project://./a", "project://a/../b", "project://..", "project://a\\b", "project://a\0b", "project://C:", "project://C:notes.md", "project://c:/x", "project:/a", "a/b.md"];
        for (const address of cases) expect({address, parsed: parseResource(address)}).toMatchObject({address, parsed: {ok: false, code: "invalid-address"}});
        expect(parseResource(`project://${"a".repeat(MAX_PATH_BYTES)}`)).toMatchObject({ok: true});
        expect(parseResource(`project://${"a".repeat(MAX_PATH_BYTES + 1)}`)).toMatchObject({ok: false, code: "invalid-address"});
        // 上限按 UTF-8 字节：每个汉字 3 字节。
        expect(parseResource(`project://${"字".repeat(Math.floor(MAX_PATH_BYTES / 3))}`)).toMatchObject({ok: true});
        expect(parseResource(`project://${"字".repeat(Math.floor(MAX_PATH_BYTES / 3) + 1)}`)).toMatchObject({ok: false, code: "invalid-address"});
    });

    it("格式合法但没有这个方案为 unknown-scheme", () => {
        expect(parseResource("docs://guide.md")).toMatchObject({ok: false, code: "unknown-scheme"});
    });

    it("父目录、名字与拼接", () => {
        const file = {scheme: "project", path: "a/b/c.md"} as const;
        expect(parentOf(file)).toEqual({scheme: "project", path: "a/b"});
        expect(parentOf({scheme: "project", path: "c.md"})).toEqual({scheme: "project", path: ""});
        expect(parentOf({scheme: "project", path: ""})).toBeNull();
        expect(basenameOf(file)).toBe("c.md");
        expect(formatResource(joinResource({scheme: "user", path: ""}, "x.md"))).toBe("user://x.md");
        expect(formatResource(joinResource({scheme: "project", path: "a"}, "C:x.md"))).toBe("project://a/C:x.md");
        for (const name of ["", "a/b", "..", "C:x"]) expect(() => joinResource({scheme: "project", path: ""}, name)).toThrow(RangeError);
    });
});
