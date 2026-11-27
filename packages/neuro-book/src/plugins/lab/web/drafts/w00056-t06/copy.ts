/**
 * 首页原型的文字（w00056 t06）：首屏第一句的候选、首屏说明、第一幕的几步。第一句交第 3 轮评审板挑，
 * 场景按 id 切换；`e3` 是第 2 轮开发者稍微偏好的那句，`d` 开头的是 @designer 第 3 轮给的，`m` 开头的是这一轮新拟的。
 */

export const HEADLINES: Readonly<Record<string, string>> = {
    e3: "每一个世界，都从一行字开始。",
    d1: "写下第一句，世界便有了形状。",
    d4: "长夜有灯，让没写完的世界留下来。",
    d5: "从一行草稿，到一部成书。",
    m1: "世界很大，从第一行写起。",
    m2: "写一部长篇，先摆好一张书桌。",
    m3: "你的世界，一章一章长出来。",
};

/** 第一句下面那行：说清它是什么、桌上有什么、东西存在哪。 */
export const LEDE = "写长篇小说的工作区：正文、随章节变化的设定和 AI 搭档星璃在同一个窗口里，作品是你电脑上的 Markdown 文件。";

export const ACT_ONE = {
    number: "第一幕",
    title: "一张随你摆的桌子",
    lede: "写长篇要同时看的东西很多。窗口里的每一块都能拖、能分、能收，摆成你顺手的样子。",
};

export interface StepCopy {
    readonly title: string;
    readonly body: string;
}

export const STEP_COPY: readonly StepCopy[] = [
    {title: "拖一个标签，分成两栏", body: "把第二章的标签拖到正文右边，两章并排，前后文一眼就对得上。"},
    {title: "视图放哪边，你说了算", body: "作品树整块搬到右栏，外框滑过去，里面的东西原样不动。"},
    {title: "要专心时，整面都给正文", body: "双击标签条，正文铺满窗口；再双击，旁边的一切回到原处。"},
    {title: "人物卡浮在正文上", body: "把艾莉丝的设定拖出来，成为一扇浮窗，写到她时抬眼就能看见。"},
    {title: "下次打开，还是这样", body: "关掉再打开，分栏、浮窗和每一个标签，都在你离开时的地方。"},
];

/** 步骤的序号：这是一幕里的先后。只写“一”会被看成一条横线，所以写全“第一步”。 */
export const STEP_NUMERALS = ["第一步", "第二步", "第三步", "第四步", "第五步"] as const;

/** 和首句 e3 呼应的那句英文（开发者 2026-11-26 更正为 from words to world）。 */
export const TAGLINE = "From words to world.";

/**
 * 第 5 轮（《入殿·俯案成界》）第一幕：跟着第五章的一场戏走五拍，最后交给访客。开发者看过第 4 轮后要三件事：
 * 放慢、讲清楚（每一拍先在字幕里说要做什么，再做）；把浮窗、视图换位置、关掉再打开这几步加回来；和首屏一样华丽。
 * 每一拍有一个短标题和两句字幕：开头说要做什么，做完说得到了什么。星璃的话在她自己的对话栏里。
 * 第 7 轮第一幕改成连播，短标题排成章节条（`ChapterRail`），压到 2 到 4 个字（@designer 第 7 轮）。
 * 第 8 轮字幕挪到工作台上面做眉题：短标题在前、大一号，后面是那一句；开演时眉题先是这一幕的名字（`ACT_ONE` 的 `number` 与 `title`）。
 */

export interface BeatCopy {
    readonly title: string;
    readonly opening: string;
    /** 动作中间换一句（一拍里有两个动作时：先打字再拖第一章；先高亮再批注；先浮出来再收窗角）。 */
    readonly middle?: string;
    readonly closing: string;
}

export const BEATS = {
    knock: {title: "两章并排", opening: "第五章，雨夜。她写到那声敲门。", middle: "第一章也有一声。把第一章拖到右边，两章并排。", closing: "两声敲门对在一起，伏笔埋得对不对，一眼就知道。"},
    // 第 6 轮加的一拍：开发者要顺手介绍编辑器的标注与高亮。走编辑器自己的选区菜单与批注卡片（字幕措辞参考 @designer 第 6 轮）。
    mark: {title: "高亮批注", opening: "两处敲门，各划一道高亮。", middle: "再在第五章那句上记一笔批注。", closing: "哪里埋了伏笔、哪里待改，一翻就看见。"},
    alice: {title: "人物浮窗", opening: "写到艾莉丝：把她的设定拖出来，成一扇浮窗。", middle: "拉一下窗角，收成手边一张卡，放在作品树下面。", closing: "写她的时候抬眼就看得见，正文一个字也不挡。"},
    move: {title: "视图换位", opening: "视图放哪边你说了算：把作品树整块拖到右栏。", closing: "外框滑过去，里面的东西原样不动；左边换成了设定。"},
    focus: {title: "专心写", opening: "要专心时，双击标签栏，正文铺满桌面。", closing: "再双击，一切回到原处。"},
    memory: {title: "下次还在", opening: "写完了，关灯。明天再打开。", closing: "分栏、浮窗、写到一半的那句，都在你离开时的地方。"},
} as const satisfies Readonly<Record<string, BeatCopy>>;

/** 交给访客：眉题换成这一句，下面展开星璃的小贴纸与两个按钮。 */
export const HANDOFF = {title: "换你来", line: "拖一个标签，摆到顺手的地方。"} as const;

/**
 * 第二幕（第 13 轮，开发者在 v12 上定照板上的脚本做原型）：开场落印的罗马数字，眉题开演时先是这一幕的名字。
 * 五拍接着第五章往下写，短标题照第一幕压到 2 到 4 个字（章节条）；顺序照 @designer 第 12 轮：先扣中文，最后回到原文收束。
 */
export const ACT_TWO = {
    number: "第二幕",
    numeral: "II",
    title: "为中文长篇做的编辑器",
} as const;

export const BEATS_TWO = {
    chinese: {title: "中文规矩", opening: "行首打一个顿号，叫出插入菜单。", middle: "再给“霜港”标上读音。", closing: "提示块、注音、紧挨标点的粗体，都照中文的规矩排。"},
    image: {title: "一张插图", opening: "从别处复制一张图，在正文里粘贴。", closing: "图存进了作品的插图文件夹，正文里就是它。"},
    props: {title: "章节属性", opening: "这一章是谁的视角、写到哪了，记在正文上方。", middle: "状态改成修改中，出场添上守门人。", closing: "收起来是一行摘要，改过的一眼看到。"},
    link: {title: "链到设定", opening: "提到灰塔，就链到它那一页。", closing: "按住 Ctrl 一点，灰塔的设定在新标签里翻开。"},
    file: {title: "还是原文", opening: "换个编辑器，打开同一章。", closing: "稿子就是 Markdown 文件，哪里都打得开。"},
} as const satisfies Readonly<Record<string, BeatCopy>>;

/** 第二幕交给访客：光标停在第五章末尾。 */
export const HANDOFF_TWO = {title: "轮到你写", line: "光标就在第五章末尾，接着写一句。"} as const;

/** 两章里要涂高亮的那两句：第五章刚打的，第一章末尾师傅的敲法。 */
export const KNOCK_ECHOES = ["门外有人敲门，三下。", "楼下有人敲门，三下，停一停，再一下。"] as const;

/** 批注加在第五章的哪一句上、写什么（作者给自己记的，和星璃的回答对得上：等不到第四下，门外就不是师傅）。 */
export const KNOCK_NOTE = {on: "她屏住气，等那第四下。", body: "第四下不会响：门外的人不是师傅。"} as const;
