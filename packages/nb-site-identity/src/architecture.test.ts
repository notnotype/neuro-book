/**
 * 本包的结构守卫：账号库的连接只经 `db/connection.ts` 用（那里文件头的约束 3）。入口交进来的连接（`IdentityModuleOptions.db`，
 * 入口那边是 `ModuleContext.db`）只许模块入口 `index.ts` 取出来交给 `IdentityConnection`，别的源码要读写库都经它的 `read`、`write`、
 * `withLibTransaction`。直接用连接的代码会绕过队列：语句落进库正开着的事务、随它回滚（计划 3.3）。
 * 守卫按源码文字找对 `db` 属性的读取（`x.db`、`x?.db`）与解构（`{db}`、`{db: d}`）；`#db` 私有字段不算。规则带反例，证明它拦得下。
 * 文件末尾另一条守卫：删会话只在 `session.ts` 里。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const SRC = import.meta.dir;
const ALLOWED = ["db/connection.ts", "index.ts"];

/** 去掉 `//` 与块注释：注释里提到的不算。 */
function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

/** 读取或解构 `db` 属性的地方。 */
function dbPropertyUses(source: string): number {
    const code = withoutComments(source);
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

/**
 * 删会话只经 `session.ts` 的“结束会话”一组函数（omp 设计审查第 16 条、实现审查第 7 条）：t08 在那组函数里加对外 OAuth 令牌与
 * 授权码的撤销，别处直接删会话行就漏了撤销。这条守卫只按源码文字找 `DELETE FROM session`（大小写、引号与空白的写法都认）与库的
 * `deleteSession`、`deleteSessions` 调用，是提醒，拦不住拼出来的 SQL；真正的防线是 t08 的令牌撤销用例（每种结束会话的操作之后
 * 令牌都失效）。
 */
const SESSION_DELETERS = ["session.ts"];

function sessionDeletes(source: string): number {
    const code = withoutComments(source);
    const sql = [...code.matchAll(/\bDELETE\s+FROM\s+(?:"session"|`session`|\[session\]|'session'|session)(?![\w.])/giu)].length;
    const library = [...code.matchAll(/\.\s*deleteSessions?\s*\(/gu)].length;
    return sql + library;
}

describe("删会话只经 session.ts 的一组函数", () => {
    it("只有 session.ts 写 DELETE FROM session 或调库的 deleteSession、deleteSessions", () => {
        const deleters = productSources().filter((file) => sessionDeletes(readFileSync(join(SRC, file), "utf8")) > 0);
        expect(deleters.filter((file) => !SESSION_DELETERS.includes(file))).toEqual([]);
    });

    it("反例：各种写法的删除与库的调用会被找到，别的表、读会话与注释里的提及不会", () => {
        expect(sessionDeletes('tx.query(`DELETE FROM "session" WHERE "id" = ?`).run(id);')).toBe(1);
        expect(sessionDeletes("tx.query('delete from session where id = ?')")).toBe(1);
        expect(sessionDeletes("DELETE\n  FROM `session`")).toBe(1);
        expect(sessionDeletes("await ctx.context.internalAdapter.deleteSession(token);")).toBe(1);
        expect(sessionDeletes("await adapter.deleteSessions(userId);")).toBe(1);
        expect(sessionDeletes('DELETE FROM "session_audit"')).toBe(0);
        expect(sessionDeletes('SELECT "expiresAt" FROM "session"')).toBe(0);
        expect(sessionDeletes('// DELETE FROM "session"\n/* deleteSession(token) */')).toBe(0);
    });
});
