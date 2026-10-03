import type {
    StoryDecisionAnchorKindDto,
    StoryDecisionStatusDto,
    StoryPromiseBeatKindDto,
    StoryPromiseBeatStateDto,
    StoryPromiseDerivedStageDto,
    StoryPromiseImportanceDto,
    StoryPromiseStatusDto,
} from "nbook/shared/dto/plot.dto";

/**
 * 规划层 UI 状态色调。
 * 按仓库状态语义口诀映射:进行中/引用=info,计划/待审/占位=warning,完成=success,错误/死引用=danger,归档/放弃=muted。
 */
export type PlanningTone = "info" | "success" | "warning" | "danger" | "muted";

/**
 * 下拉选项(带说明),结构兼容 FormSelect 的 SelectOption。
 */
export type PlanningSelectOption = {
    value: string;
    label: string;
    // 为空表示无需补充说明。
    description?: string;
};

/**
 * 色调 → 主题变量 class 串。chip 用于胶囊标签,dot 用于状态圆点。
 * 全部消费主题 CSS 变量,禁 Tailwind 调色板类。
 */
export const PLANNING_TONE_CLASSES: Record<PlanningTone, {chip: string; dot: string}> = {
    info: {
        chip: "border border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]",
        dot: "bg-[var(--status-info)]",
    },
    success: {
        chip: "border border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]",
        dot: "bg-[var(--status-success)]",
    },
    warning: {
        chip: "border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]",
        dot: "bg-[var(--status-warning)]",
    },
    danger: {
        chip: "border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]",
        dot: "bg-[var(--status-danger)]",
    },
    muted: {
        chip: "border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]",
        dot: "bg-[var(--text-muted)]/40",
    },
};

/**
 * Promise 存储态(作者意图)标签与色调。open=进行中债务,fulfilled=已兑现,abandoned=作者放弃(中性,非错误)。
 */
export const PROMISE_STATUS_META: Record<StoryPromiseStatusDto, {label: string; tone: PlanningTone}> = {
    open: {label: "进行中", tone: "info"},
    fulfilled: {label: "已兑现", tone: "success"},
    abandoned: {label: "已放弃", tone: "muted"},
};

/**
 * Promise 重要性标签与色调。high 用 warning 提示密度权重,medium/low 中性。
 */
export const PROMISE_IMPORTANCE_META: Record<StoryPromiseImportanceDto, {label: string; tone: PlanningTone}> = {
    high: {label: "高", tone: "warning"},
    medium: {label: "中", tone: "muted"},
    low: {label: "低", tone: "muted"},
};

/**
 * Promise 派生阶段(从有效 beats 派生,不落库)标签与色调。unplanted=许了愿还没埋=warning。
 */
export const PROMISE_DERIVED_STAGE_META: Record<StoryPromiseDerivedStageDto, {label: string; tone: PlanningTone}> = {
    unplanted: {label: "未埋设", tone: "warning"},
    planted: {label: "已埋设", tone: "info"},
    echoed: {label: "已呼应", tone: "info"},
    paid_off: {label: "已收束", tone: "success"},
};

/**
 * beat 类型标签与图标(埋/呼/挫/收)。
 */
export const PROMISE_BEAT_KIND_META: Record<StoryPromiseBeatKindDto, {label: string; iconClass: string}> = {
    plant: {label: "埋设", iconClass: "i-lucide-sprout"},
    advance: {label: "推进", iconClass: "i-lucide-trending-up"},
    setback: {label: "反挫", iconClass: "i-lucide-zap"},
    payoff: {label: "兑现", iconClass: "i-lucide-circle-check"},
};

/**
 * beat 三态(随所在 Scene.status 派生)标签与色调。计划=草稿语义用 warning,事实=success,归档不参与派生=muted。
 */
export const PROMISE_BEAT_STATE_META: Record<StoryPromiseBeatStateDto, {label: string; tone: PlanningTone}> = {
    planned: {label: "计划", tone: "warning"},
    factual: {label: "事实", tone: "success"},
    archived: {label: "已归档", tone: "muted"},
};

/**
 * Decision 生命周期标签与色调。open=未决(待审)=warning,decided=已拍板=success,取代/作废=muted。
 */
export const DECISION_STATUS_META: Record<StoryDecisionStatusDto, {label: string; tone: PlanningTone}> = {
    open: {label: "未决", tone: "warning"},
    decided: {label: "已拍板", tone: "success"},
    superseded: {label: "已取代", tone: "muted"},
    dropped: {label: "已作废", tone: "muted"},
};

/**
 * Decision 主锚点类型标签。
 */
export const DECISION_ANCHOR_KIND_META: Record<StoryDecisionAnchorKindDto, {label: string}> = {
    story: {label: "全书"},
    act: {label: "卷"},
    chapter: {label: "章"},
    thread: {label: "线"},
    scene: {label: "场"},
    promise: {label: "承诺"},
    content: {label: "内容节点"},
};

/**
 * Scene.outcomeType 下拉选项。首项「未填写」=空串,提交映射 null(D29:null 只表示未填写)。
 */
export const SCENE_OUTCOME_TYPE_OPTIONS: PlanningSelectOption[] = [
    {value: "", label: "未填写"},
    {value: "yes_but", label: "yes_but 得手但有代价", description: "主动尝试成功,但引入新代价或麻烦"},
    {value: "no_and", label: "no_and 失败且恶化", description: "主动尝试失败,局面进一步恶化"},
    {value: "yes_and", label: "yes_and 得手且更进", description: "成功且额外获益(爽点连击的正当用法)"},
    {value: "no_but", label: "no_but 失败但有转机", description: "失败,但留下希望或线索"},
    {value: "yes", label: "yes 干脆成功", description: "无保留的成功(碾压/爽点场)"},
    {value: "no", label: "no 干脆失败", description: "无转机的失败"},
    {value: "no_conflict", label: "no_conflict 无冲突", description: "日常/纯信息场,本场没有尝试-结果结构"},
    {value: "passive", label: "passive 被动承受", description: "主要角色只承受未主动尝试(被绑走/旁观)"},
];

/**
 * Scene.pacingRole 下拉选项。首项「未填写」=空串,提交映射 null。
 */
export const SCENE_PACING_ROLE_OPTIONS: PlanningSelectOption[] = [
    {value: "", label: "未填写"},
    {value: "setup", label: "setup 铺垫", description: "建立信息与期待"},
    {value: "escalation", label: "escalation 升级", description: "推高张力与筹码"},
    {value: "breather", label: "breather 喘息", description: "松弛回落,给读者呼吸感"},
    {value: "climax", label: "climax 高潮", description: "局部张力极值"},
    {value: "resolution", label: "resolution 收束", description: "落定余波,收拢结果"},
];

/**
 * Thread.miceType 下拉选项(MICE Quotient 线型:提示这条线怎样才算关)。首项「未填写」=空串,提交映射 null。
 */
export const THREAD_MICE_TYPE_OPTIONS: PlanningSelectOption[] = [
    {value: "", label: "未填写"},
    {value: "milieu", label: "milieu 舞台", description: "进入某地开线,离开/立足即关线"},
    {value: "idea", label: "idea 谜题", description: "提出问题开线,谜底揭晓即关线"},
    {value: "character", label: "character 角色", description: "身份认同失衡开线,达成新认同即关线"},
    {value: "event", label: "event 事件", description: "外部危机开线,危机解决即关线"},
];
