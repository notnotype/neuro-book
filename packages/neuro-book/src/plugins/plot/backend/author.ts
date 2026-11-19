/**
 * `nbook.plot/author` 的实现（docs/specs/plot/author-ui.md）：每次调用取一份快照，在读取位置那条线的视图上同步算完，结果带名字表。
 * 子列表有上限（远程单次预算），另给总数。
 */

import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";
import type {CanonReadView, Mode, ReadPosition} from "@notnotype/nb-canon/schema";

import type {CanonProject} from "nbook/plugins/canon/shared/contracts";

import {NameTable, personKnowing, pointKnowing} from "../core/author/knowing";
import type {plotAuthorContract} from "../shared/author";
import {ENTRY_TYPES} from "../shared/declarations";
import {fail, fitted, latest, lineViewOf} from "./results";
import type {Failure, Ok} from "./results";

/** “谁知道”里有行的人至多列这么多，其余只给总数（一行一个人，几百个人的作品也装得下一次调用）。 */
export const POINT_PEOPLE_MAX = 200;

interface Read {
    readonly view: CanonReadView;
    readonly position: ReadPosition;
    readonly mode: Mode;
}

export function remoteAuthor(canon: CanonProject): RemoteImplementation<typeof plotAuthorContract> {
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
    const isEntry = (view: CanonReadView, id: string, type?: string): boolean => {
        const stored = view.object({kind: "entry", id}) as {readonly type?: string; readonly deleted?: boolean} | undefined;
        return stored !== undefined && stored.deleted !== true && (type === undefined || stored.type === type);
    };
    return {
        methods: {
            person: (input) => read(input, ({view, position, mode}, names) => {
                if (!isEntry(view, input.person)) return fail("not-found");
                const knowing = personKnowing(view, mode, position, input.person);
                names.add(input.person);
                for (const row of [...knowing.secrets, ...knowing.others]) {
                    names.add(row.point);
                    names.add(row.from);
                }
                return {person: input.person, ...knowing};
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
        },
        events: {},
    };
}
