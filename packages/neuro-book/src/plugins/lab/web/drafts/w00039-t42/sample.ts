/** w00039 t42 静态稿的样本：星瑕（填好的）与刚新建的人物；人物分页的数据照 Lab 里 CharacterCard 的“填好的人物”。 */

export const FACTS = [
    {id: "性别", label: "性别", text: "女"},
    {id: "年龄", label: "年龄", text: "17 岁"},
    {id: "身份", label: "身份", text: "隐退的魔法少女"},
    {id: "所属", label: "所属", text: "对策委员会魔法少女部", link: true},
    {id: "现在在哪", label: "现在在哪", text: "星家老宅", link: true, mark: "第 2 章改过"},
    {id: "生死", label: "生死", text: "活着"},
    {id: "种族", label: "种族", text: "人类", own: true},
];
const CONDITION = {id: "现在的状态", label: "现在的状态", text: "以哥哥的样子和妹妹同住，魔力还没恢复到能变身的程度", hint: "受伤、被通缉、刚搬家……此刻的处境", mark: "第 2 章改过"};
const PASSAGES = [
    {id: "性格", label: "性格", text: "迟钝，情商不高，做事认真。想对妹妹好，常常用错方法，过后才知道搞砸了。", hint: "遇事怎么反应，最在意什么"},
    {id: "说话方式", label: "说话方式", text: null, hint: "口头禅、语气、对不同的人怎么称呼"},
    {id: "背景", label: "背景", text: "六岁那年的城市大灾难里失去了父母。之后觉醒了时间系的天赋，被对策委员会带进魔法少女部，几年里成了蓝星最强；灾难平息后，官方给她安了罪名，她顺势隐退。", hint: "从哪里来，经历过什么"},
];

export const FILLED_CARD = {
    facts: FACTS,
    condition: CONDITION,
    passages: PASSAGES,
    portrait: {status: "image" as const, path: "插图/星瑕-立绘.png", alt: "星瑕的立绘"},
    canAdd: true,
};
export const BLANK_CARD = {
    facts: FACTS.slice(0, 6).map(({mark: _mark, ...fact}) => ({...fact, text: null})),
    condition: {...CONDITION, text: null, mark: undefined},
    passages: PASSAGES.map((passage) => ({...passage, text: null})),
    portrait: {status: "no-image" as const},
    canAdd: true,
};

/** 一个分页：`kind` 给分段用：设定组（各一页，含剧情插件登记的知情、态度）、文字、不对应设定组的看法（经历、情节）。 */
export type DraftTab = {readonly value: string; readonly label: string; readonly icon: string; readonly kind: "group" | "text" | "view"; readonly count?: number};

export const FILLED_TABS: readonly DraftTab[] = [
    {value: "person", label: "人物", icon: "i-lucide-user-round", kind: "group"},
    {value: "look", label: "形象", icon: "i-lucide-shirt", kind: "group"},
    {value: "text", label: "文字", icon: "i-lucide-file-text", kind: "text"},
    {value: "panel", label: "面板", icon: "i-lucide-gauge", kind: "group"},
    {value: "know", label: "知道什么", icon: "i-lucide-key-round", kind: "group"},
    {value: "goals", label: "目标与态度", icon: "i-lucide-target", kind: "group"},
    {value: "experience", label: "经历", icon: "i-lucide-footprints", kind: "view"},
    {value: "plot", label: "情节", icon: "i-lucide-git-commit-horizontal", kind: "view", count: 12},
];
/** 空作品里刚新建、加上了形象：没有剧情，经历与情节空着、不出。 */
export const BLANK_TABS: readonly DraftTab[] = FILLED_TABS.filter((tab) => tab.kind !== "view" && ["person", "look", "text"].includes(tab.value));

export const CHAPTERS = [
    {n: 1, title: "雨夜的来客"},
    {n: 2, title: "妹妹的布丁"},
    {n: 3, title: "学院开学"},
];
