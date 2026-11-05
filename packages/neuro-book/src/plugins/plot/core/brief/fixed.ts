/**
 * 简报里的固定句与段标题（docs/specs/plot/brief.md）。集中放在这一个文件：改固定句是行为变化（Spec 边界与兼容），
 * 测试对每一句各有一条断言。
 */

export const TITLES = {
    instruction: "写作指示",
    outline: "细纲",
    plan: "本章计划",
    brief: "简报",
    appearance: "涉及条目的样子",
    previous: "上一章末尾",
    target: "目标字数",
} as const;

/** 简报内的段，按顺序（输出 1）。 */
export const BRIEF_PARTS = {
    rules: "通则",
    secrets: "这一场的秘密",
    people: "在场的人",
    scene: "场景条件",
    address: "称谓",
    foreshadow: "伏笔",
    decisions: "决策",
    reader: "读者已知",
    allowed: "本章允许新增什么",
    selfReport: "自陈的格式",
} as const;

export const NONE = "无";

/** 通则（输出 3）：整份只出现一次。 */
export const RULES = [
    "没列为知道的人一律当作不知道。",
    "读者已知只是事实，不是要写出的效果。",
    "简报里的人名、设定以外的东西，按本章允许新增的规则处理。",
] as const;

export const PEOPLE_HEADER = "以下是动机，只用来决定他说什么、做什么；叙述里不写非视角人物想了什么，只写视角人物看得到的表现。";
export const OTHERS_NO_ATTITUDE = "其他人之间没有特别的态度";
export const SCENE_MISSING = "细纲与计划没写场景条件";
export const ADDRESS_FOOTER = "叙述一律用左边的称呼，其余名字只在简报里用。";
export const SELF_REPORT = "自陈分三栏：新出现的名字与事实、拿不准的、偏离细纲的。";
export const ALLOWED = [
    "场景里的小细节可以编，以不透露技术水平、社会制度、地理为限，拿不准就用泛称。",
    "不许新增有名字的人物、地点、物品、世界设定、数值（数量也算）。",
    "不许改变细纲写定的结果。",
] as const;
export const NO_PRESENTATION = "（作者没写在人前的表现）";
export const POV_OWN_SECRET = "视角人物自己的秘密，可以写进他的心理，但不能让在场的人看出来";
export const POV_NOT_THINK = "叙述不写他想到这件事";
export const DECISION_ABOUT_SECRET = "有一条涉及保密设定的决定";
export const PAYOFF_BY_OUTLINE = "回收方式按细纲写";
export const DONT_BREAK = "不要点破";

export const ending = (text: string) => `最后一句写${text}，之后不再写。`;
export const onlyWriteTo = (mode: "hint" | "explicit") => `只能写到：${mode === "explicit" ? "明说" : "暗示"}`;
export const topSecretOf = (subject: string) => `有一件涉及${subject}的绝密设定`;
export const presenceOf = (who: string, text: string) => `${who}在人前的表现：${text}`;
export const hiddenGoalOf = (holder: string) => `${holder}的一个隐秘目标`;
export const hiddenGoalSeeSecrets = `${"另有一个目标"}，见这一场的秘密`;
export const holderUnwritableGoal = (holder: string) => `${holder}另有一个不能写出的目标`;
export const otherDecisionSee = (name: string) => `另有关于这件事的决定，见${name}一项`;
export const decisionSeeSecrets = (name: string) => `另有关于${name}的决定，见这一场的秘密`;
export const omitted = (items: readonly string[]) => `已省略：${items.join("、")}`;

/** 绝密而本章不暗示也不揭示的知识点：它的名字就是真相，任何段、省略项与记录里都不写，一律用这个称呼。 */
export const HIDDEN_NAME = "绝密设定";
/** 知识点没有主体（条目树里的父条目）时的泛称：不退回知识点自己的名字。 */
export const NO_SUBJECT = "某件事";
export const READER_SEES_HIDDEN = "（见这一场的秘密里的绝密设定）";
export const DECISION_DUE_ABOUT_SECRET = "有一条涉及保密设定的待定决定到期了";
export const changeKnowing = (who: string, point: string, before: string, after: string) => `${who}对${point}：${before} → ${after}`;
export const aPrivateMatter = "一件绝密设定";
