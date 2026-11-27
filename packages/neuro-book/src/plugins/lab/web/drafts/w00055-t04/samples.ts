/** w00055 t04 静态稿的样本：人物卡照 canon 的 Lab 场景（`groups.scenes.ts` 的 CharacterCard）抄一份，章表与立绘取 Lab 的样本。 */
import {SAMPLE_IMAGES} from "nbook/plugins/canon/web/lab/canon-images";
import type {PositionChapter} from "nbook/plugins/canon/web/positions";

export const CHAPTERS: readonly PositionChapter[] = [1, 2, 3].map((index) => ({chapter: String(index), index, title: null, start: `${index}:start`, end: `${index}:end`}));
export const PORTRAIT_URL = SAMPLE_IMAGES["插图/星瑕-立绘.png"]!;

const facts = [
    {id: "性别", label: "性别", text: "女"},
    {id: "年龄", label: "年龄", text: "17 岁"},
    {id: "身份", label: "身份", text: "隐退的魔法少女"},
    {id: "所属", label: "所属", text: "对策委员会魔法少女部", link: true},
    {id: "现在在哪", label: "现在在哪", text: "星家老宅", link: true, mark: "第 2 章改过"},
    {id: "生死", label: "生死", text: "活着"},
];
const condition = {id: "现在的状态", label: "现在的状态", text: "以哥哥的样子和妹妹同住，魔力还没恢复到能变身的程度", hint: "受伤、被通缉、刚搬家……此刻的处境", mark: "第 2 章改过"};
const passages = [
    {id: "性格", label: "性格", text: "迟钝，情商不高，做事认真。想对妹妹好，常常用错方法，过后才知道搞砸了。", hint: "遇事怎么反应，最在意什么"},
    {id: "说话方式", label: "说话方式", text: null, hint: "口头禅、语气、对不同的人怎么称呼"},
    {id: "背景", label: "背景", text: "六岁那年的城市大灾难里失去了父母，之后被对策委员会带进魔法少女部。", hint: "从哪里来，经历过什么"},
];
const presets = [{id: "生日", label: "生日"}, {id: "弱点", label: "弱点"}, {id: "动机", label: "动机"}];

export const characterFilled = {facts, condition, passages, portrait: {status: "image" as const, path: "插图/星瑕-立绘.png", alt: "星瑕的立绘"}, canAdd: true, presets, removed: [], addOpen: false};
export const characterEmpty = {
    ...characterFilled,
    facts: facts.map(({mark: _mark, ...fact}) => ({...fact, text: null})),
    condition: {...condition, text: null},
    passages: passages.map((passage) => ({...passage, text: null})),
    portrait: {status: "no-image" as const},
};
