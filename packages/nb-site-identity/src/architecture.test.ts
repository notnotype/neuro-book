/**
 * 本包的结构守卫：账号库的连接只经 `db/connection.ts` 用（那里文件头的约束 3）。入口交进来的连接（`IdentityModuleOptions.db`，
 * 入口那边是 `ModuleContext.db`）只许模块入口 `index.ts` 取出来交给 `IdentityConnection`，别的源码要读写库都经它的 `read`、`write`、
 * `withLibTransaction`。直接用连接的代码会绕过队列：语句落进库正开着的事务、随它回滚（计划 3.3）。
 * 守卫按源码文字找对 `db` 属性的读取（`x.db`、`x?.db`）与解构（`{db}`、`{db: d}`）；`#db` 私有字段不算。规则带反例，证明它拦得下。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const SRC = import.meta.dir;
const ALLOWED = ["db/connection.ts", "index.ts"];

/** 读取或解构 `db` 属性的地方；去掉了 `//` 与块注释，注释里提到它不算。 */
function dbPropertyUses(source: string): number {
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
    const member = [...code.matchAll(/(?:\?\.|\.)\s*db\b/gu)].length;
    const destructured = [...code.matchAll(/[{,]\s*db\s*(?=[,}:])/gu)].length;
    return member + destructured;
}

/** 本包的产品源码：`src` 下除测试与 `testing/` 以外的 `.ts`，路径相对 `src`。 */
function productSources(): string[] {
    return readdirSync(SRC, {recursive: true, encoding: "utf8"})
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.startsWith("testing/"))
        .sort();
}

describe("账号库的连接只经 db/connection.ts 用", () => {
    it("只有 db/connection.ts 与 index.ts 读取或解构 db 属性", () => {
        const users = productSources().filter((file) => dbPropertyUses(readFileSync(join(SRC, file), "utf8")) > 0);
        expect(users.filter((file) => !ALLOWED.includes(file))).toEqual([]);
    });

    it("反例：读取与解构会被找到，私有字段、别的名字与注释里的提及不会", () => {
        expect(dbPropertyUses("new IdentityConnection(options.db, {log});")).toBe(1);
        expect(dbPropertyUses("const conn = context?.db;")).toBe(1);
        expect(dbPropertyUses("const {db, log} = options;")).toBe(1);
        expect(dbPropertyUses("function start({log, db: database}: Options) {}")).toBe(1);
        expect(dbPropertyUses("return this.#db.inTransaction;")).toBe(0);
        expect(dbPropertyUses("const dbName = options.dbName;")).toBe(0);
        expect(dbPropertyUses("conn.write((db) => db.query('SELECT 1').get());")).toBe(0);
        expect(dbPropertyUses("// options.db\n/* const {db} = options; */")).toBe(0);
    });
});
