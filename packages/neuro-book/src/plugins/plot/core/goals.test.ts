import {describe, expect, test} from "bun:test";

import {COMPONENT_IDS} from "../shared/declarations";
import {chapter, end, PlotWorld, start} from "../testing/world";
import {conflictsOf, goalsOf, goalTable} from "./goals";

const CHAPTERS = Array.from({length: 8}, (_, index) => `ch${String(index + 1)}`);
const setStatus = (goal: string, value: string) => ({op: "set" as const, at: {entry: goal, path: "goal.状态"}, value});

describe("plot.goals 输出 1：某人在一个位置上的目标", () => {
    test("挂在他下面、已出场、状态为进行或受挫的；出场之前不算，改成达成以后不算，别人的不算", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const find = w.goal("查出哥哥在瞒什么", jin, {}, {appears: chapter("ch3")});
        const hide = w.goal("躲开哥哥", jin, {状态: "blocked"});
        w.goal("不让妹妹卷进来", brother);
        const ids = (at: Parameters<typeof goalsOf>[2]) => goalsOf(w.view(), jin, at, "actual").map((goal) => goal.id);

        expect(ids(start("ch2"))).toEqual([hide]);
        expect(ids(end("ch3"))).toEqual([find, hide]);
        expect(goalsOf(w.view(), jin, end("ch3"), "actual")[0]).toMatchObject({holder: jin, name: "查出哥哥在瞒什么", 状态: "active", 轻重: "major", 层次: "want"});

        w.change(chapter("ch5"), {patches: [setStatus(find, "achieved")]});
        expect(ids(start("ch5"))).toEqual([find, hide]);
        expect(ids(end("ch5"))).toEqual([hide]);
    });
});

describe("plot.goals 输出 2、验收场景 3：冲突是对称的读取", () => {
    test("哥哥的目标写了星瑾的：读星瑾的目标，冲突里也有哥哥的；两边都写了的只列一次；还没出场的目标两边都不列", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother, sage] = [w.person("星瑾"), w.person("哥哥"), w.person("贤者")];
        const find = w.goal("查出哥哥在瞒什么", jin);
        const keep = w.goal("不让妹妹卷进来", brother, {冲突: [{id: find}]});
        const view = () => w.view();
        expect(conflictsOf(view(), find, end("ch1"), "actual")).toEqual([{id: keep, writtenOn: "other"}]);
        expect(conflictsOf(view(), keep, end("ch1"), "actual")).toEqual([{id: find, writtenOn: "this"}]);

        // 贤者的目标第 6 章才出场：第 6 章之前，读星瑾的目标不列它；它写在星瑾的冲突里也不列。
        const late = w.goal("让星瑾自己发现", sage, {冲突: [{id: keep}]}, {appears: chapter("ch6")});
        w.change(chapter("ch2"), {patches: [{op: "listAdd", at: {entry: find, path: "goal.冲突"}, value: {id: keep}}, {op: "listAdd", at: {entry: find, path: "goal.冲突"}, value: {id: late}}]});
        expect(conflictsOf(view(), find, end("ch3"), "actual")).toEqual([{id: keep, writtenOn: "both"}]);
        expect(conflictsOf(view(), keep, end("ch3"), "actual")).toEqual([{id: find, writtenOn: "both"}]);
        expect(conflictsOf(view(), find, end("ch6"), "actual")).toEqual([{id: keep, writtenOn: "both"}, {id: late, writtenOn: "this"}]);
        expect(conflictsOf(view(), keep, end("ch6"), "actual")).toEqual([{id: find, writtenOn: "both"}, {id: late, writtenOn: "other"}]);
        expect(conflictsOf(view(), late, end("ch3"), "actual")).toBeNull();
    });
});

describe("plot.goals 输出 5：目标表", () => {
    test("主要角色 = 在这个位置上至少有一个已出场目标的持有者（不论轻重）；态度表按对象；按状态筛只收窄目标", () => {
        const w = new PlotWorld(CHAPTERS);
        const withAttitude = {init: {name: "星瑾", aliases: [], summary: "", text: [], data: {
            know: {type: COMPONENT_IDS.knowing, version: 1, enabled: true, fields: {知情: [], 听过的说法: null}},
            att: {type: COMPONENT_IDS.attitude, version: 1, enabled: true, fields: {态度: []}},
        }}};
        const [jin, brother, sage] = [w.person("星瑾", withAttitude), w.person("哥哥"), w.person("贤者")];
        const find = w.goal("查出哥哥在瞒什么", jin);
        const minor = w.goal("尝尝新菜", brother, {轻重: "minor"});
        const cause = w.point("哥哥瞒着她", brother);
        w.change(chapter("ch1"), {patches: [{op: "listAdd", at: {entry: jin, path: "att.态度"}, value: {id: brother, 态度: "不接话、不看他", 起因: {ref: cause}}}]});
        const table = (filter = {}) => goalTable(w.view(), end("ch2"), "actual", filter);
        expect(table().map((row) => [row.holder, row.goals.map((goal) => goal.id)])).toEqual([[jin, [find]], [brother, [minor]]]);
        expect(table()[0]!.attitudes).toEqual([{object: brother, 态度: "不接话、不看他", 起因: cause, 称呼: null}]);
        w.change(chapter("ch2"), {patches: [setStatus(minor, "achieved")]});
        // 哥哥只剩一个已达成的目标：仍是主要角色，按状态筛进行的时目标列表为空，人不消失。
        expect(table({status: "active"}).map((row) => [row.holder, row.goals.length])).toEqual([[jin, 1], [brother, 0]]);
        expect(table({holder: sage})).toEqual([]);
    });
});

describe("plot.goals 验收场景 2：态度随事件变", () => {
    const START = "不接话、不看他，但会夹他做的菜";
    const EVENT = "她第一次主动叫了他一声";
    const REDUCED = "冷淡，但愿意开口";

    function attitudeWorld() {
        const w = new PlotWorld(CHAPTERS);
        const withAttitude = {init: {name: "星瑾", aliases: [], summary: "", text: [], data: {
            know: {type: COMPONENT_IDS.knowing, version: 1, enabled: true, fields: {知情: [], 听过的说法: null}},
            att: {type: COMPONENT_IDS.attitude, version: 1, enabled: true, fields: {态度: []}},
        }}};
        const [jin, brother] = [w.person("星瑾", withAttitude), w.person("哥哥")];
        const cause = w.point("哥哥瞒着她", brother);
        w.goal("查出哥哥在瞒什么", jin);
        w.change(chapter("ch1"), {patches: [{op: "listAdd", at: {entry: jin, path: "att.态度"}, value: {id: brother, 态度: START, 起因: {ref: cause}}}]});
        w.change(chapter("ch5"), {patches: [{op: "note", at: {entry: jin, path: `att.态度[${brother}].态度`}, value: EVENT}]});
        const attitude = (at: ReturnType<typeof end>) => goalTable(w.view(), at, "actual").find((row) => row.holder === jin)!.attitudes;
        return {w, brother, cause, attitude};
    }

    test("第 1 章是写下的那句；第 5 章末尾归纳还没补上时是“起点；之后：事件”的未归纳写法，起因是知识点“哥哥瞒着她”", () => {
        const {brother, cause, attitude} = attitudeWorld();
        expect(attitude(end("ch4"))).toEqual([{object: brother, 态度: START, 起因: cause, 称呼: null}]);
        expect(attitude(end("ch5"))).toEqual([{object: brother, 态度: `${START}；之后：${EVENT}`, 起因: cause, 称呼: null}]);
    });

    test("归纳补进缓存以后，第 5 章末尾的态度是归纳后的那句，第 4 章末尾不受影响", () => {
        const {w, brother, cause, attitude} = attitudeWorld();
        // 归纳缓存按“起点加事件”查：只有这一组输入有归纳。
        w.world = w.world.withOptions({...w.world.options, reductions: (input) => (input.anchor === START && input.events.length === 1 && input.events[0] === EVENT ? REDUCED : undefined)});
        expect(attitude(end("ch5"))).toEqual([{object: brother, 态度: REDUCED, 起因: cause, 称呼: null}]);
        expect(attitude(end("ch4"))[0]!.态度).toBe(START);
    });
});
