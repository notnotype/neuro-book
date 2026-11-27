/**
 * 管理面板列表页的查询状态（t10 计划 3.13）：页码与各页的筛选、搜索放在地址的查询参数里，刷新、后退回到同一页；
 * 翻页的基准（`anchor`，`site.admin` 输出 9）不进地址，只在内存里记着，同一次翻页里沿用。纯函数，`tests/admin-lists.test.ts` 覆盖。
 *
 * 一页的查询参数由一张表定义（`ListSchema`）：每个参数的缺省值与它收什么值。读地址时不合的值一律当作缺省（手改的地址、
 * 旧的书签不让页面出错，也不把服务端会拒的值发出去）；写地址时等于缺省的参数不写，页码 1 也不写，地址保持最短。
 */

import {PAGE} from "@notnotype/nb-site-identity-contract/constants";

/** 一个查询参数：缺省值与它收的值。`accepts` 为假的值读成缺省。 */
export interface QueryField {
    readonly fallback: string;
    readonly accepts: (value: string) => boolean;
}

export type ListSchema<Field extends string> = Readonly<Record<Field, QueryField>>;

/** 一页列表的查询状态：页码从 1 起，各参数都是字符串（缺省值也是一个具体的值，例如筛选项 `all`）。 */
export interface ListState<Field extends string> {
    readonly page: number;
    readonly fields: Readonly<Record<Field, string>>;
}

/** 地址里的一个查询参数可能是什么（vue-router 的 `LocationQueryValue` 与它的数组）。 */
export type RawQuery = Readonly<Record<string, string | null | readonly (string | null)[] | undefined>>;

/** 取值只能是这几个之一的参数（筛选项）。 */
export function oneOf(values: readonly string[], fallback: string): QueryField {
    return {fallback, accepts: (value) => values.includes(value)};
}

/**
 * 把状态里的一个值收窄成枚举的成员，发给接口：`oneOf` 读地址时已经只收这几个值，这里不在的值回 `fallback`。
 */
export function memberOf<Value extends string>(values: readonly Value[], value: string, fallback: Value): Value {
    return values.find((member) => member === value) ?? fallback;
}

/** 照这个写法的参数；空串是缺省（没有筛这一项）。 */
export function matching(pattern: RegExp): QueryField {
    return {fallback: "", accepts: (value) => value === "" || pattern.test(value)};
}

/** 搜索词：收至多 `maxLength` 个码点的任意文字，前后的空白不算（输入时也会去掉，见 `searchTerm`）。 */
export function searchText(maxLength: number): QueryField {
    return {fallback: "", accepts: (value) => value === value.trim() && [...value].length <= maxLength};
}

/** 输入框里的字变成搜索词：去掉前后的空白。只有空白时等于不搜。 */
export function searchTerm(input: string): string {
    return input.trim();
}

/** 页码与合同的 `page` 同一个写法（十进制正整数，至多 15 位）；不合时是第 1 页。 */
const PAGE_PATTERN = /^[1-9][0-9]{0,14}$/u;

function single(value: RawQuery[string]): string | undefined {
    // 同一个参数写了两遍（数组）不知道该信哪个，当作没写。
    return typeof value === "string" ? value : undefined;
}

export function readListState<Field extends string>(schema: ListSchema<Field>, query: RawQuery): ListState<Field> {
    const rawPage = single(query.page);
    const page = rawPage !== undefined && PAGE_PATTERN.test(rawPage) ? Number(rawPage) : PAGE.defaultPage;
    const fields = {} as Record<Field, string>;
    for (const name of Object.keys(schema) as Field[]) {
        const raw = single(query[name]);
        fields[name] = raw !== undefined && schema[name].accepts(raw) ? raw : schema[name].fallback;
    }
    return {page, fields};
}

/** 写进地址的查询参数：等于缺省的不写，第 1 页不写。参数的先后按表里的先后，页码在最后。 */
export function listQueryOf<Field extends string>(schema: ListSchema<Field>, state: ListState<Field>): Record<string, string> {
    const query: Record<string, string> = {};
    for (const name of Object.keys(schema) as Field[]) if (state.fields[name] !== schema[name].fallback) query[name] = state.fields[name];
    if (state.page !== PAGE.defaultPage) query.page = String(state.page);
    return query;
}

/** 换一个参数：页码回到第 1 页（计划 3.13：换筛选与换搜索都回到第 1 页）。 */
export function withField<Field extends string>(state: ListState<Field>, name: NoInfer<Field>, value: string): ListState<Field> {
    return {page: PAGE.defaultPage, fields: {...state.fields, [name]: value}};
}

/**
 * 筛选与搜索合起来的“这是哪一份列表”：同一份列表的几页共用一个基准，换了任何一个参数就是另一份。
 * 按表里的先后拼，参数值经 JSON 编码，值里有什么字都不会让两份不同的列表撞成同一个。
 */
export function listKey<Field extends string>(schema: ListSchema<Field>, state: ListState<Field>): string {
    return JSON.stringify((Object.keys(schema) as Field[]).map((name) => state.fields[name]));
}

/** 内存里记着的基准：哪一份列表（`listKey`）与它的 `anchor`。 */
export interface AnchorMemory {
    readonly key: string;
    readonly anchor: string;
}

/**
 * 这次请求带不带基准（`site.admin` 输出 9）：还是同一份列表时沿用，换了筛选或搜索就不带、以当时为基准重来。
 * 刷新页面时内存清空，自然也不带。
 */
export function anchorFor(memory: AnchorMemory | undefined, key: string): string | undefined {
    return memory !== undefined && memory.key === key ? memory.anchor : undefined;
}

/**
 * 一次回答之后记着的基准：没带基准的请求，回答里的就是这份列表的新基准；带了的，回答里的就是带去的那个，照旧。
 */
export function rememberAnchor(memory: AnchorMemory | undefined, key: string, anchor: string): AnchorMemory {
    return memory !== undefined && memory.key === key && memory.anchor === anchor ? memory : {key, anchor};
}

/** 回答里有算最后一页要用的 `items`（数组）与 `total`（非负整数）。 */
export function isListPage(response: {readonly items: unknown; readonly total: unknown}): boolean {
    return Array.isArray(response.items) && typeof response.total === "number" && Number.isSafeInteger(response.total) && response.total >= 0;
}

/**
 * 页码超过了最后一页（`site.admin` 输出 10：`items` 为空而 `total` 不为 0）时，该去的最后一页；没超时回 `undefined`。
 * 页码本来就在最后一页之内却没有行（两次请求之间数据变了）时也回最后一页：表格不该停在一页空的上面。
 */
export function lastPageIfPastEnd(response: {readonly items: readonly unknown[]; readonly total: number}, page: number, pageSize: number): number | undefined {
    if (response.items.length > 0 || response.total === 0) return undefined;
    const last = Math.ceil(response.total / pageSize);
    return last === page ? undefined : last;
}
