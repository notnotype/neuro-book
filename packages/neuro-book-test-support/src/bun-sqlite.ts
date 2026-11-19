/**
 * Vitest（Node）里替代 `bun:sqlite`：组件测试的场地要装存储插件的项目入口（剧情插件依赖它），存储分区的代码
 * （`packages/neuro-book/src/plugins/storage/backend/partition.ts`）用 `bun:sqlite`，Node 加载不了。这里用 Node 自带的
 * `node:sqlite`（同样是真实的 SQLite、同步接口）实现分区代码用到的几种调用，SQL 照原样交给 SQLite 执行。
 *
 * 只由应用包 `vitest.config.ts` 的别名引用；Bun 里跑的测试仍用真的 `bun:sqlite`。分区代码用到这里没有的调用时直接抛错，
 * 照着补，不静默。两边的差别在这里抹平：没有行时 `get` 给 null（Node 给 undefined）；行换成普通对象（Node 给的原型是 null，
 * 规范 JSON 一类按原型判断的代码会认不出）。
 */

import {DatabaseSync} from "node:sqlite";
import type {SQLInputValue, StatementSync} from "node:sqlite";

type Row = Record<string, unknown>;

const plain = (row: unknown): Row => ({...(row as Row)});

class Statement<R = Row> {
    readonly #statement: StatementSync;

    constructor(statement: StatementSync) {
        this.#statement = statement;
    }

    run(...params: SQLInputValue[]): void {
        this.#statement.run(...params);
    }

    get(...params: SQLInputValue[]): R | null {
        const row = this.#statement.get(...params);
        return row === undefined ? null : (plain(row) as R);
    }

    all(...params: SQLInputValue[]): R[] {
        return this.#statement.all(...params).map((row) => plain(row) as R);
    }
}

export class Database {
    readonly #db: DatabaseSync;

    constructor(path: string, options: {readonly create?: boolean; readonly readonly?: boolean} = {}) {
        // `create: false` 时 bun 要求文件已存在；分区代码只用 `create: true`，这里不另做检查。
        this.#db = new DatabaseSync(path, {readOnly: options.readonly ?? false});
    }

    /** 不带参数地执行 SQL（分区代码只这样用）。 */
    run(sql: string): void {
        this.#db.exec(sql);
    }

    query<R = Row, _P = unknown>(sql: string): Statement<R> {
        return new Statement<R>(this.#db.prepare(sql));
    }

    get inTransaction(): boolean {
        return this.#db.isTransaction;
    }

    close(): void {
        this.#db.close();
    }
}
