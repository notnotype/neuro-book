/**
 * 插件 SDK 的组件入口：nb-ui 的组件，第三方插件以 `@notnotype/nb-plugin-sdk/components` 导入（docs/specs/runtime/plugin-code-loading.md
 * 的“共享入口即兼容承诺”）。nb-ui 是不发布的私有包，作者装不到它；组件的构建期实现与类型随 SDK 包分发，插件运行时宿主模块表给的
 * 是宿主自己用的那一份。
 *
 * 逐个列名而不是整体再导出：这里每一项都是兼容承诺，nb-ui 入口里给工作台用的内部件（分栏树、拖动手势、表单字段上下文、
 * 建议菜单的内部函数）不对外。nb-ui 新增单文件组件时在这里加一项：`sdk.test.ts` 把名单与 nb-ui 组件入口逐个对照，
 * `plugin-sdk/pack.test.ts` 核对生成的声明文件与名单一致。
 */

export {
    AlertDialog, AnchoredPopover, Badge, Banner, Breadcrumb, Button, Checkbox,
    CheckboxGroup, CodeBlock, Collapsible, CollapsibleCard, CollapsibleRow, ColorSwatches,
    ContextMenu, Dialog, DiffView, Drawer, FloatingWindow, DropdownMenu,
    EmptyState, Field, IconButton, InfoTip, Input, Kbd,
    Menubar, Notification, NotificationStack, NumberInput, OverlayScrollbar,
    Popover, Progress, QuickPick, RadioGroup, ScrollArea, SearchSelect,
    SegmentedControl, Select, Separator, Skeleton, Slider, Spinner,
    SuggestionMenu, Switch, Table, Tabs, Textarea,
    ToggleGroup, Toolbar, Tooltip, Tree,
} from "@notnotype/nb-ui/components";

export type {
    Align, AlertDialogTone, BadgeSize, BadgeTone, BadgeVariant, BannerTone,
    BreadcrumbItemData, ButtonSize, ButtonVariant, CheckboxOption, CodeBlockLine,
    CollapsibleCardStatus, CollapsibleRowStatus, ColorSwatchesSize, ControlSize, ContextMenuCloseReason, ContextMenuItem,
    DialogCloseReason, DialogSize, DrawerDirection, FloatingWindowCloseReason, DropdownMenuItemData,
    DropdownMenuItemType, FocusRingStyle, GenericTreeNode, IconButtonSize, IconButtonVariant,
    InputType, KbdSize, MenubarItemData, MenubarMenuData,
    NotificationPosition, NotificationTone, NumberInputSize, Orientation, OverlayCloseReason, ProgressSize, ProgressTone,
    QuickPickCloseReason, QuickPickItem, QuickPickProps, RadioGroupSize, RadioOption,
    ScrollAreaOrientation, ScrollAreaType, SearchSelectOption, SearchSelectSize, SegmentedControlOption,
    SegmentedControlSize, SegmentedControlValue, SelectDirection, SelectOption,
    SelectSize, Side, SkeletonShape, SliderSize, SpinnerSize, 
    SuggestionMenuAnchor, SuggestionMenuGroup, SuggestionMenuItem, SuggestionSide, SwitchSize,
    TableColumn, TableDensity, TabsItem, TabsSize, ToggleGroupOption,
    ToggleGroupSize, Tone,
    FieldContext,
} from "@notnotype/nb-ui/components";

export {DropFeedbackOverlay, DropIndicatorLabel, NestedGrid, Splitter} from "@notnotype/nb-layout/vue";
export type {DropFeedbackPreview, SplitterPanelConfig} from "@notnotype/nb-layout/vue";
export type {
    GridBranchChange, GridGestureCommit, GridGesturePreview,
    SplitterGestureCancelReason, SplitterGestureCancellation, SplitterGestureSource, SplitterGestureState,
} from "@notnotype/nb-layout";
