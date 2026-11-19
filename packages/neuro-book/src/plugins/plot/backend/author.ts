/**
 * `nbook.plot/author` 的实现（docs/specs/plot/author-ui.md）：每次调用取一份快照，在读取位置那条线的视图上同步算完，结果带名字表。
 * 子列表有上限（远程单次预算），另给总数。
 */

import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";
import type {CanonReadView, Mode, ReadPosition} from "@notnotype/nb-canon/schema";

import type {CanonProject} from "nbook/plugins/canon/shared/contracts";

import {NameTable, personKnowing, pointKnowing} from "../core/author/knowing";
import {authorExperience} from "../core/author/experience";
import {authorGoals, personGoals} from "../core/author/goals";
import type {AuthorHolder} from "../core/author/goals";
import {authorLedger} from "../core/author/ledger";
import {plotLines} from "../core/author/lines";
import type {AuthorLedgerRow} from "../core/author/ledger";
import type {AuthorExperienceItem} from "../core/author/experience";
import {defaultPeople, secretsTable} from "../core/author/secrets";
import type {SecretRow} from "../core/author/secrets";
import type {plotAuthorContract} from "../shared/author";
import {ENTRY_TYPES} from "../shared/declarations";
import {fail, fitted, latest, lineViewOf, pagedList} from "./results";
import type {Failure, Ok} from "./results";

/** “谁知道”里有行的人至多列这么多，其余只给总数（一行一个人，几百个人的作品也装得下一次调用）。 */
export const POINT_PEOPLE_MAX = 200;

interface Read {
    readonly view: CanonReadView;
    readonly position: ReadPosition;
    readonly mode: Mode;
}

/** 目标表一组里引用到的条目：持有者、目标、冲突的目标与它们的持有者、基于的知识点、态度的对象与起因。 */
function nameGoals(names: NameTable, group: Pick<AuthorHolder, "holder" | "goals" | "attitudes">): void {
    names.add(group.holder);
    for (const goal of group.goals) {
        names.add(goal.id);
        for (const point of goal.基于) names.add(point);
        for (const conflict of goal.conflicts) {
            names.add(conflict.id);
            names.add(conflict.holder);
        }
    }
    for (const attitude of group.attitudes) {
        names.add(attitude.object);
        names.add(attitude.起因);
    }
}

/** 只用到世界的快照（规模脚本因此能在进程内的世界服务上直接量这些方法）。 */
export function remoteAuthor(canon: Pick<CanonProject, "snapshot">): RemoteImplementation<typeof plotAuthorContract> {
    /** 取一份快照，换到读取位置那条线的视图，同步算完；结果带戳、线与名字表。 */
    const read = async (input: {readonly position?: ReadPosition; readonly mode?: Mode}, run: (read: Read, names: NameTable) => Record<string, unknown> | Failure): Promise<Ok<unknown> | Failure> => {
        const snapshot = await canon.snapshot();
        if ("code" in snapshot) return fail(snapshot.code);
        const main = snapshot.view;
        const position = input.position ?? latest(main);
        const mode = input.mode ?? "actual";
        const view = lineViewOf(main, position, mode);
        if ("ok" in view) return view;
        if (view.positionKey(position) === null) return fail("chapter-not-found");
        const names = new NameTable(view, position, mode);
        const result = run({view, position, mode}, names);
        if ("ok" in result && result.ok === false) return result as Failure;
        return fitted({version: view.version, inputDigest: view.stamp.inputDigest, line: view.line, ...result, names: names.build()});
    };
    /**
     * 分页的读取：整张表算完再分页（条数、候选要按全表）；名字表只给这一页的项。`params` 进游标（同一份读取输入、同样的参数才能接着读）。
     */
    const paged = async <T>(input: {readonly position?: ReadPosition; readonly mode?: Mode; readonly cursor?: string; readonly limit?: number}, run: (read: Read) => {readonly items: readonly T[]; readonly params: {readonly method: string} & Readonly<Record<string, unknown>>; readonly extra: Readonly<Record<string, unknown>>; readonly name: (names: NameTable, items: readonly T[]) => void} | Failure): Promise<Ok<unknown> | Failure> => {
        const snapshot = await canon.snapshot();
        if ("code" in snapshot) return fail(snapshot.code);
        const position = input.position ?? latest(snapshot.view);
        const mode = input.mode ?? "actual";
        const view = lineViewOf(snapshot.view, position, mode);
        if ("ok" in view) return view;
        if (view.positionKey(position) === null) return fail("chapter-not-found");
        const built = run({view, position, mode});
        if ("ok" in built) return built;
        const page = pagedList(view, built.items, input, {...built.params, position, mode}, {line: view.line, ...built.extra});
        if (!page.ok) return page;
        const value = page.value as {readonly items: readonly T[]};
        const names = new NameTable(view, position, mode);
        built.name(names, value.items);
        return fitted({...value, names: names.build()});
    };
    const isEntry = (view: CanonReadView, id: string, type?: string): boolean => {
        const stored = view.object({kind: "entry", id}) as {readonly type?: string; readonly deleted?: boolean} | undefined;
        return stored !== undefined && stored.deleted !== true && (type === undefined || stored.type === type);
    };
    return {
        methods: {
            person: (input) => read(input, ({view, position, mode}, names) => {
                if (!isEntry(view, input.person)) return fail("not-found");
                const knowing = personKnowing(view, mode, position, input.person);
                const goals = personGoals(view, mode, position, input.person);
                names.add(input.person);
                for (const row of [...knowing.secrets, ...knowing.others]) {
                    names.add(row.point);
                    names.add(row.from);
                }
                nameGoals(names, {holder: input.person, ...goals});
                return {person: input.person, ...knowing, ...goals};
            }),
            point: (input) => read(input, ({view, position, mode}, names) => {
                if (!isEntry(view, input.point, ENTRY_TYPES.point)) return fail("not-found");
                const detail = pointKnowing(view, mode, position, input.point);
                const people = detail.people.slice(0, POINT_PEOPLE_MAX);
                names.add(input.point);
                for (const row of people) {
                    names.add(row.person);
                    names.add(row.from);
                }
                for (const item of detail.related.foreshadows) names.add(item.id);
                for (const item of detail.related.attitudes) {
                    names.add(item.holder);
                    names.add(item.object);
                }
                for (const goal of detail.related.goals) names.add(goal);
                return {...detail, people, peopleTotal: detail.people.length};
            }),
            secrets: (input) => paged(input, ({view, position, mode}) => {
                const segment = input.segment ?? "all";
                // 没点名时按缺省选（输出 10）：要先知道主要角色与候选，算两遍表（第一遍不点名，只取候选），只在第一次打开时发生。
                const people = input.people ?? defaultPeople(view, position, mode, secretsTable(view, mode, position, [], segment));
                const table = secretsTable(view, mode, position, people, segment);
                return {
                    items: table.rows,
                    params: {method: "author.secrets", people: input.people ?? null, segment},
                    extra: {counts: table.counts, candidates: table.candidates, main: table.main, people},
                    // 名字表只给这一页用到的条目、候选的人与主要角色：整张表的名字可能上千个。
                    name: (names: NameTable, rows: readonly SecretRow[]) => {
                        for (const id of [...people, ...table.candidates, ...table.main]) names.add(id);
                        for (const row of rows) {
                            names.add(row.point);
                            names.add(row.subject);
                            for (const other of row.others) names.add(other.person);
                        }
                    },
                };
            }),
            plotLines: (input) => read(input, ({view, position, mode}, names) => {
                const lines = plotLines(view, position, mode);
                for (const id of lines) names.add(id);
                return {items: lines};
            }),
            goals: (input) => paged(input, ({view, position, mode}) => ({
                items: authorGoals(view, mode, position, {...(input.holder === undefined ? {} : {holder: input.holder}), ...(input.finished === undefined ? {} : {finished: input.finished})}),
                params: {method: "author.goals", holder: input.holder ?? null, finished: input.finished ?? false},
                extra: {},
                name: (names: NameTable, groups: readonly AuthorHolder[]) => {
                    for (const group of groups) nameGoals(names, group);
                },
            })),
            ledger: (input) => paged(input, ({view, position, mode}) => {
                const segment = input.segment ?? "unpaid";
                const table = authorLedger(view, mode, position, segment);
                return {
                    items: table.rows,
                    params: {method: "author.ledger", segment},
                    extra: {counts: table.counts},
                    name: (names: NameTable, rows: readonly AuthorLedgerRow[]) => {
                        for (const row of rows) names.add(row.id);
                    },
                };
            }),
            experience: (input) => paged(input, ({view, position, mode}) => {
                if (!isEntry(view, input.person)) return fail("not-found");
                const read = authorExperience(view, mode, position, input.person);
                return {
                    items: read.items,
                    params: {method: "author.experience", person: input.person},
                    extra: {uncast: read.uncast},
                    name: (names: NameTable, items: readonly AuthorExperienceItem[]) => {
                        for (const item of items) for (const member of item.cast) if ("who" in member) names.add(member.who);
                    },
                };
            }),
        },
        events: {},
    };
}
