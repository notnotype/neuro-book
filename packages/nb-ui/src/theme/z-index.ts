/**
 * 浮层层级的唯一登记处（规则见 docs/ui-development-spec.md 的“叠放层级”一节）。
 *
 * z-index 不是主题语义，不进 CSS 变量契约；组件用 :style 绑定消费，避免在原子类里复制魔法值。固定定位或传送出去的
 * 整页浮层一律从这里取；组件内部的局部叠放（`z-10` 这类）不必登记。新增整页浮层时在此登记，并保持各档的先后。
 */
import type {ComputedRef, InjectionKey} from "vue";

export const NB_Z_INDEX = {
    /** DropdownMenu / Select 等局部浮层（不在对话框里时） */
    popover: 60,
    tooltip: 70,
    /** 拖放落点提示（`DropFeedbackOverlay`），与局部浮层同档：拖放时不会同时开着下拉 */
    dropFeedback: 60,
    /** 工作台拖动时跟着指针的拖影：高于页面里的浮层，低于对话框（拖动不会发生在对话框之下） */
    dragFeedback: 1000,
    /** 非模态浮动窗口（`FloatingWindow`）带的起点；最外层的窗口各占一条“车道”按最近聚焦排序，见 NB_DIALOG_WINDOW_LANE */
    dialogWindow: 8900,
    /** 模态对话框的第一层；同时打开的模态按打开顺序往上，见 NB_MODAL_Z_STEP */
    dialog: 9000,
    /** 右下角的通知：高于所有模态层，模态开着时出的通知也看得见 */
    notification: 9050,
    /** 右键菜单；子菜单用 contextMenu + 1 */
    contextMenu: 9100,
    /** 全局命令面板角色：QuickPick 的遮罩与面板同档，面板在后绘制 */
    commandPalette: 9200,
    /** 组件 Lab 的检查框：要压住被检查的一切，包括对话框与命令面板 */
    inspectorProbe: 9900,
} as const;

/** 对话框或窗口内容树中的局部浮层层级；未提供时回退到普通页面浮层层级。 */
export const NB_POPOVER_Z_INDEX: InjectionKey<number> = Symbol("nb-popover-z-index");

/**
 * 浮动窗口每深一层占的层级跨度：本体一格、空一格。一条车道容纳 5 层嵌套；
 * 再深的嵌套不该靠 z-index 解决，而是重新想清楚那是不是两个窗口。
 */
export const NB_DIALOG_WINDOW_Z_STEP = 2;

/** 最外层窗口的“车道”宽：一条车道放一个最外层窗口和它里面嵌套的窗口（5 层 × `NB_DIALOG_WINDOW_Z_STEP`）。 */
export const NB_DIALOG_WINDOW_LANE = 10;

/** 窗口带里最多有几条车道（`dialogWindow` 到模态 `dialog` 之间）；同时开的最外层窗口更多时，多出的与最上面一条同档。 */
export const NB_DIALOG_WINDOW_MAX_LANES = (NB_Z_INDEX.dialog - NB_Z_INDEX.dialogWindow) / NB_DIALOG_WINDOW_LANE;

/**
 * 窗口向内容树提供的局部浮层层级：窗口带的最上一格。窗口里的下拉、菜单只在用户正在这个窗口里操作时开着，开着时它所在的窗口
 * 一定在最上面（点击与聚焦会把窗口提到最上），所以不必跟着窗口的车道走。
 */
export const NB_WINDOW_POPOVER_Z_INDEX = NB_Z_INDEX.dialog - 1;

/** 所在的最外层窗口：车道起点（响应式，窗口被提到最上时变）与“提到最上”。 */
export interface NbWindowFamily {
    readonly base: ComputedRef<number>;
    raise(): void;
}
export const NB_DIALOG_WINDOW_FAMILY: InjectionKey<NbWindowFamily> = Symbol("nb-dialog-window-family");

/** 当前所在的浮动窗口嵌套深度，最外层窗口是 1。未提供时按 0 处理（注入方即第 1 层）。 */
export const NB_DIALOG_WINDOW_DEPTH: InjectionKey<number> = Symbol("nb-dialog-window-depth");

/**
 * 当前所在的对话框层数（模态对话框与浮动窗口都算），最外层是 1；未提供时按 0。层数 ≥ 2 的对话框画二级的面
 * （`.nb-ui-dialog-surface--nested`）。按组件树数、在建立时取定：从应用根上的服务打开的对话框不在别的对话框的组件树里，
 * 即使看上去压在设置窗口上也算一级。
 */
export const NB_DIALOG_LAYER: InjectionKey<number> = Symbol("nb-dialog-layer");

/** 同时打开的模态每多一层往上的跨度。 */
export const NB_MODAL_Z_STEP = 2;

/** 同时打开的模态最多叠几层（9000–9009）；再多的叠放说明交互该重想，不靠层级解决。 */
export const NB_MODAL_MAX_LAYERS = 5;

/**
 * 模态向内容树提供的局部浮层层级：一个高于所有模态层、低于通知的固定值。注入在组件建立时就要给出，而模态叠在第几层
 * 要到打开时才知道，所以不按层算。代价：下层对话框的浮层在上层对话框打开时仍开着，会盖住上层；点上层的入口按钮时
 * 外部点击已经把它关掉了，正常操作碰不到。
 */
export const NB_MODAL_POPOVER_Z_INDEX = NB_Z_INDEX.dialog + NB_MODAL_MAX_LAYERS * NB_MODAL_Z_STEP;
