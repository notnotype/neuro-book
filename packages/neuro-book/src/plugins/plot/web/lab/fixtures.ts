import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type SecretsMatrix from "nbook/plugins/plot/web/components/SecretsMatrix.vue";
import type {SecretRow} from "nbook/plugins/plot/core/author/secrets";
import type {AuthorDegree} from "nbook/plugins/plot/core/author/knowing";
import type PeoplePicker from "nbook/plugins/plot/web/components/PeoplePicker.vue";
import type NodeBand from "nbook/plugins/plot/web/components/NodeBand.vue";
import type {Role} from "nbook/plugins/plot/core/foreshadowing";
import type GoalGroup from "nbook/plugins/plot/web/components/GoalGroup.vue";
import type {AuthorAttitude, AuthorGoal} from "nbook/plugins/plot/core/author/goals";
import type ReadFailure from "nbook/plugins/plot/web/components/ReadFailure.vue";
import type PlotSidebar from "nbook/plugins/plot/web/components/PlotSidebar.vue";

/** 剧情侧的几个零件（plot 插件，docs/specs/plot/author-ui.md 输出 1、8、12、14）：场景用带剧情数据的星瑕样本里的样子手写。 */
function plotFixtures() {
    const name = (text: string, type = "人物") => ({name: text, type});
    const names = {
        xia: name("星瑕"), jin: name("星瑾"), hui: name("彗"), parents: name("父母"), sprite: name("魔法精灵（名字未定）"),
        k1: name("哥哥就是星瑕", "知识点"), k2: name("星瑕做过魔法少女", "知识点"), k3: name("那几年哥哥是被软禁", "知识点"), k4: name("父母没有死", "知识点"),
        g1: name("不让星瑾知道那几年的事", "目标"), g2: name("做个好哥哥", "目标"), g3: name("把星瑾接回家", "目标"), g4: name("弄清哥哥那几年去了哪", "目标"),
        line1: name("做个好哥哥", "剧情线"), line2: name("兄妹的心结", "剧情线"), line3: name("双王", "剧情线"),
    };
    const cell = (degree: AuthorDegree, belief: string | null = null) => ({degree, belief});
    const rows: SecretRow[] = [
        {point: "k1", secrecy: "secret", subject: "xia", people: {hui: cell("knows"), xia: cell("knows"), jin: cell("none")}, others: [], othersTotal: 0, reader: {degree: "knows", suspects: {chapter: "1", paragraph: 8}, knows: {chapter: "1", paragraph: 8}}, reveals: [{plan: "p0", chapter: "1", mode: "explicit", done: true}], decisions: [], guards: []},
        {point: "k2", secrecy: "secret", subject: "xia", people: {hui: cell("knows"), xia: cell("knows"), jin: cell("forgot")}, others: [{person: "sprite", degree: "knows"}], othersTotal: 1, reader: {degree: "knows", suspects: {chapter: "1", paragraph: 13}, knows: {chapter: "1", paragraph: 13}}, reveals: [], decisions: [], guards: []},
        {point: "k3", secrecy: "secret", subject: "xia", people: {hui: cell("knows"), xia: cell("knows"), jin: cell("misbelieves", "哥哥那几年不想回家，也不想管她")}, others: [], othersTotal: 0, reader: {degree: "suspects", suspects: {chapter: "2", paragraph: 10}, knows: null}, reveals: [], decisions: [{id: "d1", text: "什么时候让星瑾知道那几年的事", status: "pending", conclusion: null, due: "3"}], guards: []},
        {point: "k4", secrecy: "topSecret", subject: "parents", people: {hui: cell("none"), xia: cell("none"), jin: cell("none")}, others: [{person: "parents", degree: "knows"}, {person: "sprite", degree: "suspects"}], othersTotal: 2, reader: {degree: "unaware", suspects: null, knows: null}, reveals: [{plan: "p1", chapter: "3", mode: "explicit", done: false}], decisions: [{id: "d2", text: "父母以什么身份回来", status: "decided", conclusion: "双王", due: null}], guards: []},
    ];
    const people = ["hui", "xia", "jin"];
    const goal = (id: string, holder: string, extra: Partial<AuthorGoal>): AuthorGoal => ({id, holder, name: names[id as keyof typeof names].name, 状态: "active", 轻重: "major", 层次: "want", 为什么: null, 基于: [], 冲突: [], 后继: null, 隐秘: null, conflicts: [], last: null, quiet: 2, stalled: false, ...extra});
    const goals: AuthorGoal[] = [
        goal("g1", "xia", {隐秘: "k3", 基于: ["k3"], conflicts: [{id: "g4", writtenOn: "other", holder: "jin"}]}),
        goal("g2", "xia", {隐秘: "k1", quiet: 31, stalled: true}),
        goal("g3", "xia", {状态: "achieved", last: {chapter: "2"}, quiet: 1}),
    ];
    const attitudes: AuthorAttitude[] = [
        {object: "jin", 态度: "想补偿她，又不知道怎么开口", notReduced: false, 起因: null, 称呼: "星瑾"},
        {object: "hui", 态度: null, notReduced: true, 起因: null, 称呼: "彗"},
    ];
    const node = (role: Role, chapter: string, written: boolean) => ({role, chapter, written});
    const candidates = [{id: "hui", name: "彗"}, {id: "xia", name: "星瑕"}, {id: "jin", name: "星瑾"}, {id: "parents", name: "父母"}, {id: "sprite", name: "魔法精灵（名字未定）"}];
    return [
        defineLabFixture<typeof SecretsMatrix>({
            component: "SecretsMatrix",
            scenes: [
                {id: "sample", label: "按主体分组：知道、信错了、忘了、读者从哪一段起、计划与决策", input: {props: {rows, people, names, now: 3}}},
                {id: "compact", label: "窄的版式：一行一条的列表", input: {props: {rows, people, names, now: 3, compact: true}}},
                {id: "sample-english", label: "英文界面", input: {props: {rows, people, names, now: 3}}},
            ],
            load: async () => (await import("./SecretsMatrixFixture.vue")).default,
        }),
        defineLabFixture<typeof PeoplePicker>({
            component: "PeoplePicker",
            scenes: [
                {id: "sample", label: "缺省点名三个主要角色", input: {props: {candidates}, model: {modelValue: ["hui", "xia", "jin"]}}},
                {id: "max", label: "选满了（上限 2）", input: {props: {candidates, max: 2}, model: {modelValue: ["xia", "jin"]}}},
                {id: "sample-english", label: "英文界面", input: {props: {candidates}, model: {modelValue: ["xia"]}}},
            ],
            load: async () => (await import("./PeoplePickerFixture.vue")).default,
        }),
        defineLabFixture<typeof NodeBand>({
            component: "NodeBand",
            scenes: [
                {id: "sample", label: "写了的实心、打算写的虚线框，跳过的章收成省略格", input: {props: {nodes: [node("plant", "1", true), node("echo", "2", true), node("mislead", "7", true), node("partial", "12", false), node("payoff", "30", false)], now: 12}}},
                {id: "one", label: "只埋了一次", input: {props: {nodes: [node("plant", "2", true)], now: 3}}},
                {id: "sample-english", label: "英文界面", input: {props: {nodes: [node("plant", "1", true), node("payoff", "3", false)], now: 2}}},
            ],
            load: async () => (await import("./NodeBandFixture.vue")).default,
        }),
        defineLabFixture<typeof GoalGroup>({
            component: "GoalGroup",
            scenes: [
                {id: "sample", label: "瞒着别人、打架、因为、停滞、达成，态度里一条还没归纳", input: {props: {goals, attitudes, names}}},
                {id: "goals-only", label: "只有目标", input: {props: {goals: goals.slice(0, 1), attitudes: [], names}}},
                {id: "sample-english", label: "英文界面", input: {props: {goals, attitudes, names}}},
            ],
            load: async () => (await import("./GoalGroupFixture.vue")).default,
        }),
        defineLabFixture<typeof ReadFailure>({
            component: "ReadFailure",
            scenes: [
                {id: "thrown", label: "取数出错：写服务给的说明", input: {props: {failure: {code: "external-failed", detail: "剧情插件还没启动"}}}},
                {id: "line", label: "这条线读不到", input: {props: {failure: {code: "line-not-found"}}}},
                {id: "not-found", label: "找不到这个条目", input: {props: {failure: {code: "not-found", detail: {code: "not-found"}}}}},
                {id: "thrown-english", label: "英文界面", input: {props: {failure: {code: "external-failed", detail: "The plot plugin has not started"}}}},
            ],
            load: async () => (await import("./ReadFailureFixture.vue")).default,
        }),
        defineLabFixture<typeof PlotSidebar>({
            component: "PlotSidebar",
            scenes: [
                {id: "sample", label: "三张表（选中谁知道什么）与剧情线", input: {props: {lines: ["line1", "line2", "line3"], names, active: "secrets"}}},
                {id: "no-lines", label: "还没有剧情线", input: {props: {lines: [], names}}},
                {id: "unbound", label: "没有打开作品", input: {props: {unbound: true}}},
                {id: "sample-english", label: "英文界面", input: {props: {lines: ["line1", "line2"], names, active: "ledger"}}},
            ],
            load: async () => (await import("./PlotSidebarFixture.vue")).default,
        }),
    ];
}

export const fixtures: LabFixture[] = [
    ...plotFixtures(),
];
