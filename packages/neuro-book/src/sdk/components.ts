/**
 * 插件 SDK 的组件入口：nb-ui 的组件，第三方插件以 `@notnotype/nb-plugin-sdk/components` 导入（docs/specs/runtime/plugin-code-loading.md
 * 的“共享入口即兼容承诺”）。nb-ui 是不发布的私有包，作者装不到它；组件的构建期实现与类型随 SDK 包分发，插件运行时宿主模块表给的
 * 是宿主自己用的那一份。
 *
 * 逐个列名而不是整体再导出：这里每一项都受插件 API 的兼容起点保护（docs/specs/runtime/plugin-code-loading.md 的
 * “共享入口即兼容承诺”），nb-ui 入口里给工作台用的内部件（分栏树、拖动手势、表单字段上下文、建议菜单的内部函数）不对外。
 * nb-ui、nb-workbench-layout 的名字与这里声明的弃用别名是 SDK 自己的承诺；nb-layout 的名字在 nb-layout 里标 `@experimental`，
 * 它们的签名发生不兼容改动时同样提 `PLUGIN_API_SINCE`，`sdk.test.ts` 的 nb-layout 快照会提醒（w00026 t48）。
 *
 * nb-ui 新增单文件组件时在这里加一项：`sdk.test.ts` 把名单与 nb-ui 组件入口逐个对照，
 * `plugin-sdk/pack.test.ts` 核对生成的声明文件与名单一致。
 */

import type {SashGestureCancelReason as CancelReason, SashGestureSource as Source} from "@notnotype/nb-layout";

export {
    AlertDialog, AnchoredPopover, Badge, Banner, Breadcrumb, Button, Checkbox,
    CheckboxGroup, CodeBlock, Collapsible, CollapsibleCard, CollapsibleRow, ColorSwatches,
    ContextMenu, CopyButton, DataTable, DateInput, DetailDialog, Dialog, DiffView, Drawer, FloatingWindow, DropdownMenu,
    EmptyState, Field, IconButton, ImagePreviewDialog, InfoTip, Input, Kbd,
    Menubar, Notification, NotificationStack, NumberInput, OverlayScrollbar,
    Pagination, Popover, Progress, QuickPick, RadioGroup, ScrollArea, SearchSelect,
    SegmentedControl, Select, Separator, SidePanel, Skeleton, Slider, Spinner,
    SuggestionMenu, Switch, Table, Tabs, TagInput, Textarea,
    ToggleGroup, Toolbar, Tooltip, Tree,
} from "@notnotype/nb-ui/components";

export type {
    Align, AlertDialogTone, BadgeSize, BadgeTone, BadgeVariant, BannerTone,
    BreadcrumbItemData, ButtonSize, ButtonVariant, CheckboxOption, CodeBlockLine,
    CollapsibleCardStatus, CollapsibleRowStatus, ColorSwatchesSize, ControlSize, ContextMenuCloseReason, ContextMenuItem, CopyButtonState,
    DateInputSize, DateInputVariant,
    DialogCloseReason, DialogSize, DrawerDirection, FloatingWindowCloseReason, DropdownMenuItemData,
    DropdownMenuItemType, FocusRingStyle, GenericTreeNode, IconButtonSize, IconButtonVariant,
    InputType, KbdSize, MenubarItemData, MenubarMenuData,
    NotificationPosition, NotificationTone, NumberInputSize, Orientation, OverlayCloseReason, PopoverReference, ProgressSize, ProgressTone,
    QuickPickCloseReason, QuickPickItem, QuickPickProps, RadioGroupSize, RadioOption,
    ScrollAreaOrientation, ScrollAreaType, SearchSelectOption, SearchSelectSize, SegmentedControlOption,
    SegmentedControlSize, SegmentedControlValue, SelectDirection, SelectOption,
    SelectSize, Side, SkeletonShape, SliderSize, SpinnerSize, 
    SuggestionMenuAnchor, SuggestionMenuGroup, SuggestionMenuItem, SuggestionMenuStatus, SuggestionSide, SwitchSize,
    TableColumn, TableDensity, TabsItem, TabsSize, TagInputSize, TagInputVariant, ToggleGroupOption,
    ToggleGroupSize, Tone, TreeSurface, TreeToggleOn,
    FieldContext,
} from "@notnotype/nb-ui/components";

export {DropFeedbackOverlay, DropIndicatorLabel, DropSectorsOverlay, FloatWindowHandles, NestedGrid, SortableList, Splitter} from "@notnotype/nb-layout/vue";
export {TabStrip} from "@notnotype/nb-workbench-layout/vue";
export type {DropFeedbackPreview, SplitterPanelConfig} from "@notnotype/nb-layout/vue";
export type {TabStripItem, TabStripPartition} from "@notnotype/nb-workbench-layout/vue";
export type {
    GridBranchChange, GridCommitFailureCode, GridFailure, GridGestureCancellation, GridGestureCommit, GridGesturePreview, GridGestureStart, GridHostIssueCode, GridIssue, GridIssueCode,
    GridLayoutCommitResult, GridParamValue, SashGestureCancelReason, SashGestureSource, SplitterGestureCancellation, SplitterGestureState,
} from "@notnotype/nb-layout";

/**
 * 改名前的两个名字，留作弃用别名（w00026 t36）：它们描述的是 `NestedGrid` 与独立 `Splitter` 共用的手势来源与取消原因，不只属于
 * `Splitter`。写成就地的类型声明而不是改名再导出，`@deprecated` 才挂得上、作者的编辑器才会划线。弃用期多长在下一档发布前定。
 * `sdk.test.ts` 的 `DEPRECATED_ALIASES` 表登记这两个别名；去掉别名时两处一起改。
 */
/** @deprecated 改用 `SashGestureSource`。 */
export type SplitterGestureSource = Source;
/** @deprecated 改用 `SashGestureCancelReason`。 */
export type SplitterGestureCancelReason = CancelReason;
