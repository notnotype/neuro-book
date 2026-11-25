/**
 * 管理列表的分页（`site.admin` 输出 9、10，验收 4；w00037 t07 计划 3.10 的“分页”，设计审查第 7 条、omp 设计审查第 17 条）。四个
 * 列表（账号、注册码、全站邀请码、审计）都经 `readPage`：调用方给表、列、搜索条件与筛选项，这里管基准、`total` 与 `counts`、
 * 排序与页码。
 *
 * 基准（`anchor`）是“那一刻的最大 id”，写成 `<前缀><id>`：表的 id 都是 `AUTOINCREMENT`，之后新增的 id 一定更大，所以只看
 * `id <= 基准` 就把之后新增的挡在 `items`、`total` 与 `counts` 之外；排序仍按建立时间倒序、再按 id 倒序（导入的旧条目 id 小、
 * 时间早，排序与 id 的大小无关）。基准的数字部分可以是 0：空表的最大 id 按 0 算，空列表给出的基准要能带回来。
 * 基准只看写法与“不晚于当前的最大 id”，不签名：别人自己拼一个合规的 `rc5` 也收下，它的含义仍然自洽（计划 3.10）。
 */

import type {SQLQueryBindings} from "bun:sqlite";

import {PAGE} from "@notnotype/nb-site-identity-contract";

import type {IdentityTx} from "../db/connection";
import {IdentityFailure} from "../errors";

/** 一段 SQL 与它的 `?` 依次绑定的值。 */
export interface Sql {
    readonly text: string;
    readonly params: readonly SQLQueryBindings[];
}

export function sql(text: string, ...params: SQLQueryBindings[]): Sql {
    return {text, params};
}

/** 查询串里的分页参数，已按合同包的 schema 判过写法。 */
export interface PageQuery {
    readonly page?: string;
    readonly pageSize?: string;
    readonly anchor?: string;
}

export interface PageSpec<Filter extends string> {
    /** 基准的前缀：`u` 账号、`rc` 注册码、`ic` 邀请码、`a` 审计。 */
    readonly anchorPrefix: string;
    /** 取最大 id 的表名（已加引号的写法）。 */
    readonly table: string;
    /** `FROM` 之后的部分：表与别名，以及要连的表。连接只能是一对一或多对一，不能让一行变成几行，否则计数不对。 */
    readonly from: string;
    /** 表的 id 列与建立时间列（带别名）。 */
    readonly idColumn: string;
    readonly createdColumn: string;
    /** 一页里要的列。 */
    readonly select: Sql;
    /** 搜索条件（账号列表的 `q`、审计列表的几项）；没有时省略。 */
    readonly where?: Sql;
    /** 每个筛选项的条件；`counts` 的键就是它们。没有筛选项的列表给 `{all: sql("1")}`、不回 `counts`。 */
    readonly filters: Readonly<Record<Filter, Sql>>;
    /** 这次按哪个筛选项取一页。 */
    readonly filter: Filter;
}

export interface Page<Row, Filter extends string> {
    readonly items: Row[];
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    readonly anchor: string;
    readonly counts: Record<Filter, number>;
}

const ANCHOR_PARTS = /^([a-z]{1,2})(\d+)$/u;

/**
 * 读一页。在一个读事务里调：基准、计数与这一页在同一个快照上。`page` 越界时 `items` 为空、`total` 照给（输出 10）。
 * `page` 至多 15 位、`pageSize` 至多 100（合同包的写法），偏移量可能超过安全整数；偏移量不小于 `total` 时不查这一页，
 * 所以交给 SQLite 的偏移量总小于 `total`，不会溢出。
 */
export function readPage<Row, Filter extends string>(tx: IdentityTx, spec: PageSpec<Filter>, query: PageQuery): Page<Row, Filter> {
    const page = query.page === undefined ? PAGE.defaultPage : Number(query.page);
    const pageSize = query.pageSize === undefined ? PAGE.defaultPageSize : Number(query.pageSize);
    const maxId = tx.query<{max_id: number}, []>(`SELECT coalesce(max(id), 0) AS max_id FROM ${spec.table}`).get()!.max_id;
    const anchorId = query.anchor === undefined ? maxId : parseAnchor(query.anchor, spec.anchorPrefix, maxId);

    const where = spec.where ?? sql("1");
    const filterKeys = Object.keys(spec.filters) as Filter[];
    const countColumns = filterKeys.map((key, index) => `coalesce(sum(CASE WHEN (${spec.filters[key].text}) THEN 1 ELSE 0 END), 0) AS c${String(index)}`).join(", ");
    const countParams = filterKeys.flatMap((key) => spec.filters[key].params);
    const countRow = tx
        .query<Record<string, number>, SQLQueryBindings[]>(`SELECT ${countColumns} FROM ${spec.from} WHERE ${spec.idColumn} <= ? AND (${where.text})`)
        .get(...countParams, anchorId, ...where.params)!;
    const counts = Object.fromEntries(filterKeys.map((key, index) => [key, countRow[`c${String(index)}`]!])) as Record<Filter, number>;
    const total = counts[spec.filter];

    const offset = (page - 1) * pageSize;
    const condition = spec.filters[spec.filter];
    const items =
        offset >= total
            ? []
            : tx
                  .query<Row, SQLQueryBindings[]>(
                      `SELECT ${spec.select.text} FROM ${spec.from}
                       WHERE ${spec.idColumn} <= ? AND (${where.text}) AND (${condition.text})
                       ORDER BY ${spec.createdColumn} DESC, ${spec.idColumn} DESC LIMIT ? OFFSET ?`,
                  )
                  .all(...spec.select.params, anchorId, ...where.params, ...condition.params, pageSize, offset);
    return {items, total, page, pageSize, anchor: `${spec.anchorPrefix}${String(anchorId)}`, counts};
}

/** 前缀不是这个列表的、或晚于当前的最大 id：`validation_failed`、`fields: ["anchor"]`（输出 10）。 */
function parseAnchor(anchor: string, prefix: string, maxId: number): number {
    const parts = ANCHOR_PARTS.exec(anchor);
    const id = parts === null ? Number.NaN : Number(parts[2]);
    if (parts === null || parts[1] !== prefix || !Number.isSafeInteger(id) || id > maxId) throw new IdentityFailure("validation_failed", ["anchor"]);
    return id;
}
