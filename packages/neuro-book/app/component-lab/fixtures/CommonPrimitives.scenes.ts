import type {LabFixtureDefinition} from "./index";
import type ContextMenu from "../../components/common/ContextMenu.vue";
import type Dialog from "../../components/common/Dialog.vue";
import type Dropdown from "../../components/common/Dropdown.vue";
import type IconButton from "../../components/common/IconButton.vue";
import type LucideIconPickerDialog from "../../components/common/LucideIconPickerDialog.vue";
import type ReferenceChip from "../../components/common/ReferenceChip.vue";
import type SideDetailPanel from "../../components/common/SideDetailPanel.vue";
import type SkillChip from "../../components/common/SkillChip.vue";
import type Tooltip from "../../components/common/Tooltip.vue";
import type TagInput from "../../components/common/form/TagInput.vue";
import type LowCodeFieldShell from "../../components/common/low-code-form/LowCodeFieldShell.vue";
import type LowCodeNumberField from "../../components/common/low-code-form/LowCodeNumberField.vue";
import type LowCodeRadioField from "../../components/common/low-code-form/LowCodeRadioField.vue";
import type LowCodeResourcePresetField from "../../components/common/low-code-form/LowCodeResourcePresetField.vue";
import type LowCodeSelectField from "../../components/common/low-code-form/LowCodeSelectField.vue";
import type LowCodeSwitchField from "../../components/common/low-code-form/LowCodeSwitchField.vue";
import type LowCodeTextareaField from "../../components/common/low-code-form/LowCodeTextareaField.vue";
import type LowCodeTextField from "../../components/common/low-code-form/LowCodeTextField.vue";
import type FormCheckbox from "../../components/common/form/FormCheckbox.vue";
import type FormField from "../../components/common/form/FormField.vue";
import type FormInput from "../../components/common/form/FormInput.vue";
import type FormNumberInput from "../../components/common/form/FormNumberInput.vue";
import type FormTextarea from "../../components/common/form/FormTextarea.vue";
import type StructuredTextEditor from "../../components/common/form/StructuredTextEditor.vue";
import type ReferencePlainTextEditor from "../../components/common/form/ReferencePlainTextEditor.vue";
import type ReferenceSelectorPopover from "../../components/common/form/ReferenceSelectorPopover.vue";
import type SegmentedControl from "../../components/common/form/SegmentedControl.vue";
import type DiffWorkbench from "../../components/common/diff/DiffWorkbench.vue";
import type DiffWorkbenchDialog from "../../components/common/diff/DiffWorkbenchDialog.vue";
import type SharedDiffEditor from "../../components/common/diff/SharedDiffEditor.vue";
import type SharedMergeEditor from "../../components/common/diff/SharedMergeEditor.vue";
import type Combobox from "../../components/common/form/Combobox.vue";
import type FormColorField from "../../components/common/form/FormColorField.vue";
import type FormSelect from "../../components/common/form/FormSelect.vue";
import type LowCodeCheckboxField from "../../components/common/low-code-form/LowCodeCheckboxField.vue";
import type LowCodeComboboxField from "../../components/common/low-code-form/LowCodeComboboxField.vue";
import type LowCodeForm from "../../components/common/low-code-form/LowCodeForm.vue";
import type {LowCodeJsonObject} from "nbook/shared/dto/low-code-form.dto";

type MenuInputItem = {
    label?: string;
    shortcut?: string;
    tone?: "default" | "danger";
    disabled?: boolean;
    danger?: boolean;
    children?: MenuInputItem[];
};

const ordinaryMenuItems: MenuInputItem[] = [
    {label: "打开章节", shortcut: "Enter"},
    {label: "复制引用"},
    {label: "删除草稿", tone: "danger"},
];
const nestedMenuItems: MenuInputItem[] = [
    {label: "打开章节"},
    {label: "更多操作", children: [
        {label: "复制路径"},
        {label: "导出", children: [{label: "Markdown"}, {label: "纯文本"}]},
    ]},
];
const disabledMenuItems: MenuInputItem[] = [
    {label: "当前章节", disabled: true},
    {label: "复制引用"},
    {label: "删除草稿", danger: true},
];

export const contextMenuScenes = [
            {id: "default", label: "常规命令", input: {props: {visible: true, x: 260, y: 160, items: ordinaryMenuItems}}},
            {id: "nested", label: "多级子菜单", input: {props: {visible: true, x: 260, y: 160, items: nestedMenuItems}}},
            {id: "disabled", label: "禁用命令", input: {props: {visible: true, x: 260, y: 160, items: disabledMenuItems}}},
        ] satisfies LabFixtureDefinition<typeof ContextMenu>["scenes"];

export const dialogScenes = [
            {id: "default", label: "确认操作", input: {props: {title: "确认操作", showCancel: true}, model: {modelValue: true}, slots: {default: true, "header-extra": true, footer: true}}},
            {id: "transparent", label: "透明遮罩", input: {props: {title: "无不透明遮罩", overlayType: "transparent", showFooter: false}, model: {modelValue: true}, slots: {default: true}}},
            {id: "busy", label: "处理中", input: {props: {title: "处理中", busy: true, showCancel: true}, model: {modelValue: true}, slots: {default: true, footer: true}}},
        ] satisfies LabFixtureDefinition<typeof Dialog>["scenes"];

export const dropdownScenes = [
            {id: "default", label: "常规菜单", input: {props: {items: [{label: "打开章节", value: "open"}, {label: "复制引用", value: "copy"}, {label: "更多操作", value: "more", children: [{label: "导出 Markdown", value: "export-md"}]}]}, slots: {default: true}}},
            {id: "nested", label: "嵌套菜单与选择项", input: {props: {compact: true, items: [{label: "视图", value: "view", type: "radio", group: "view", checked: true}, {label: "换行", value: "wrap", type: "checkbox", checked: false}, {label: "更多", value: "more", children: [{label: "二级操作", value: "nested", children: [{label: "三级操作", value: "deep"}]}]}]}, slots: {default: true}}},
            {id: "disabled", label: "禁用菜单", input: {props: {disabled: true, items: [{label: "不可用", value: "disabled"}]}, slots: {default: true}}},
        ] satisfies LabFixtureDefinition<typeof Dropdown>["scenes"];

export const iconButtonScenes = [
            {id: "default", label: "常规图标按钮", input: {props: {title: "复制示例内容"}, slots: {default: true}}},
            {id: "small-danger", label: "小尺寸危险操作", input: {props: {title: "删除示例内容", size: "sm", variant: "danger"}, slots: {default: true}}},
            {id: "disabled", label: "禁用状态", input: {props: {title: "复制示例内容", disabled: true}, slots: {default: true}}},
        ] satisfies LabFixtureDefinition<typeof IconButton>["scenes"];

export const lucideIconPickerDialogScenes = [
            {id: "default", label: "默认图标库", input: {props: {}, model: {modelValue: true}}},
            {id: "search", label: "搜索图标", input: {props: {selectedIcon: "book-open"}, model: {modelValue: true}}},
            {id: "selected", label: "已有选中图标", input: {props: {selectedIcon: "book-open"}, model: {modelValue: true}}},
        ] satisfies LabFixtureDefinition<typeof LucideIconPickerDialog>["scenes"];

export const referenceChipScenes = [
            {id: "chapter", label: "章节引用", input: {props: {label: "第一章：钟楼停摆", target: "chapter://chapter-001", entryType: "chapter"}}},
            {id: "broken", label: "断链引用", input: {props: {label: "已移除的参考", target: "chapter://missing", entryType: "chapter", broken: true}}},
            {id: "inferred-file", label: "工作区文件引用", input: {props: {label: "钟楼设定.md", target: "workspace/projects/novel/.agent/plan/clock-tower.md"}}},
        ] satisfies LabFixtureDefinition<typeof ReferenceChip>["scenes"];

export const sideDetailPanelScenes = [
            {id: "expanded", label: "展开详情", input: {props: {visible: true, panelClass: "max-h-[70vh]", bodyClass: ""}, model: {height: 280}, slots: {header: true, actions: true, default: true}}},
            {id: "collapsed", label: "收起详情", input: {props: {visible: true, panelClass: "max-h-[70vh]", bodyClass: ""}, model: {height: 44}, slots: {header: true, actions: true, default: true}}},
            {id: "long", label: "长内容滚动", input: {props: {visible: true, panelClass: "max-h-[70vh]", bodyClass: ""}, model: {height: 280}, slots: {header: true, actions: true, default: true}}},
        ] satisfies LabFixtureDefinition<typeof SideDetailPanel>["scenes"];

export const skillChipScenes = [
            {id: "skill", label: "技能名", input: {props: {name: "novel-outline"}}},
            {id: "long-name", label: "长技能名", input: {props: {name: "novel-character-motivation-and-continuity-review"}}},
        ] satisfies LabFixtureDefinition<typeof SkillChip>["scenes"];

export const tooltipScenes = [
            {id: "right", label: "右侧提示", input: {props: {text: "查看完整提示说明", placement: "right", showDelay: 300, hideDelay: 100}}},
            {id: "bottom", label: "下方提示", input: {props: {text: "向下查看提示", placement: "bottom", showDelay: 0, hideDelay: 0}}},
        ] satisfies LabFixtureDefinition<typeof Tooltip>["scenes"];

export const tagInputScenes = [
            {id: "tags", label: "已有标签", input: {props: {placeholder: "回车或逗号添加标签", accentStyle: true}, model: {modelValue: ["伏笔", "人物动机"]}}},
        ] satisfies LabFixtureDefinition<typeof TagInput>["scenes"];

export const lowCodeFieldShellScenes = [
            {id: "field-shell", label: "说明与校验状态", input: {props: {field: {path: "profile.displayName", component: "text", label: "显示名称", description: "用于作者资料中的公开称呼。", required: true, options: []}, issues: [{path: "profile.displayName", severity: "warning", code: "legacy", message: "当前名称来自旧配置。"}, {path: "profile.displayName", severity: "error", code: "required", message: "保存前请填写显示名称。"}]}, slots: {actions: true, default: true}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeFieldShell>["scenes"];

export const lowCodeNumberFieldScenes = [
            {id: "bounded-decimal", label: "有界小数", input: {props: {field: {path: "profile.temperature", component: "number", label: "创造性", description: "较高会增加输出变化。", placeholder: "例如 0.7", required: false, options: [], min: 0, max: 2, step: 0.1, integer: false}}, model: {modelValue: 0.7}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeNumberField>["scenes"];

export const lowCodeRadioFieldScenes = [
            {id: "described-options", label: "选项说明与禁用项", input: {props: {field: {path: "profile.responseMode", component: "radio", label: "回复模式", required: false, options: [{value: "balanced", label: "均衡", description: "保持信息与篇幅平衡。"}, {value: "concise", label: "精简", description: "优先给出简短结论。"}, {value: "detailed", label: "详细", description: "展开背景与推理过程。", disabled: true}]}}, model: {modelValue: "balanced"}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeRadioField>["scenes"];

export const lowCodeResourcePresetFieldScenes = [
            {id: "project-global-readonly", label: "项目范围的全局只读资源", input: {props: {field: {path: "writer.style", component: "resource-preset", label: "写作风格", required: false, options: [], resource: {contentType: "markdown", options: [{key: "styles/clear-prose.md", label: "清晰叙述", description: "简洁、明确的叙述风格。", origin: "global", editable: false, deletable: false}], content: {key: "styles/clear-prose.md", content: "# 清晰叙述\n\n使用准确、简洁的句子。", contentType: "markdown", origin: "global"}, contents: [{key: "styles/clear-prose.md", content: "# 清晰叙述\n\n使用准确、简洁的句子。", contentType: "markdown", origin: "global"}], capabilities: {create: false, update: false, rename: false, remove: false}, createKeyPrefix: "styles/", createKeySuffix: ".md"}}, scope: "project", disabled: false}, model: {modelValue: "styles/clear-prose.md", mutations: []}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeResourcePresetField>["scenes"];

export const lowCodeSelectFieldScenes = [
            {id: "selected-option", label: "当前选中项", input: {props: {field: {path: "profile.workspace", component: "select", label: "工作节奏", placeholder: "选择节奏", required: false, options: [{value: "balanced", label: "均衡", description: "兼顾深度与推进速度。"}, {value: "focused", label: "专注", description: "优先处理当前任务。"}]}}, model: {modelValue: "balanced"}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeSelectField>["scenes"];

export const lowCodeSwitchFieldScenes = [
            {id: "enabled", label: "已启用", input: {props: {field: {path: "tools.webEnabled", component: "switch", label: "启用网页工具", required: false, options: []}}, model: {modelValue: true}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeSwitchField>["scenes"];

export const lowCodeTextareaFieldScenes = [
            {id: "multiline", label: "多行说明", input: {props: {field: {path: "profile.instructions", component: "textarea", label: "补充说明", description: "提供额外的写作约束。", placeholder: "输入说明", required: false, options: [], rows: 4}}, model: {modelValue: "保持人物称谓一致。\n避免重复解释已知背景。"}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeTextareaField>["scenes"];

export const lowCodeTextFieldScenes = [
            {id: "prefilled", label: "预填文本", input: {props: {field: {path: "profile.displayName", component: "text", label: "显示名称", placeholder: "输入名称", required: false, options: []}}, model: {modelValue: "章节规划助手"}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeTextField>["scenes"];

export const formCheckboxScenes = [
            {id: "checked", label: "已勾选", input: {model: {modelValue: true}, props: {label: "包含附录章节"}}},
        ] satisfies LabFixtureDefinition<typeof FormCheckbox>["scenes"];

export const formFieldScenes = [
            {id: "labeled", label: "带标签字段", input: {props: {label: "章节标题", stacked: true}, slots: {default: true}}},
        ] satisfies LabFixtureDefinition<typeof FormField>["scenes"];

export const formInputScenes = [
            {id: "prefixed", label: "前置图标", input: {model: {modelValue: "第一章 退潮"}, props: {type: "text", placeholder: "输入文本"}, slots: {prefix: true}}},
        ] satisfies LabFixtureDefinition<typeof FormInput>["scenes"];

export const formNumberInputScenes = [
            {id: "stepped", label: "带边界步进", input: {model: {modelValue: "2.5"}, props: {step: "0.5", min: "0", max: "10", placeholder: "输入数值", size: "sm", title: "数值步进"}}},
        ] satisfies LabFixtureDefinition<typeof FormNumberInput>["scenes"];

export const formTextareaScenes = [
            {id: "multiline", label: "多行正文", input: {model: {modelValue: "退潮之后，桩影逐渐显露。"}, props: {rows: 3, placeholder: "写一段正文"}}},
        ] satisfies LabFixtureDefinition<typeof FormTextarea>["scenes"];

export const structuredTextEditorScenes = [
            {id: "rich", label: "富文本", input: {model: {modelValue: "## 退潮之后\n\n码头上的灯仍亮着。", mode: "rich"}, props: {placeholder: "记录场景目的"}}},
            {id: "source", label: "Markdown 源码", input: {props: {}, model: {modelValue: "## 场景目的\n\n- 找到线索\n- 留下伏笔", mode: "source"}}},
        ] satisfies LabFixtureDefinition<typeof StructuredTextEditor>["scenes"];

export const referencePlainTextEditorScenes = [
            {id: "references", label: "Markdown 引用", input: {model: {modelValue: "相关章节：[第一章 退潮](manuscript/volume-1/chapter-01.md)\\n后续将从退潮后的码头继续。"}, props: {placeholder: "输入正文", ariaLabel: "消息正文", minHeight: 64, maxHeight: 150}}},
        ] satisfies LabFixtureDefinition<typeof ReferencePlainTextEditor>["scenes"];

export const referenceSelectorPopoverScenes = [
            {id: "cursor-menu", label: "光标位置候选", input: {props: {prefix: "@", title: "引用章节", sections: [{id: "manuscript", title: "手稿", items: [{id: "chapter-01", label: "第一章 退潮", description: "卷首章节", iconClass: "i-lucide-file-text", hint: "章节"}, {id: "chapter-02", label: "第二章 灯塔", description: "下一章", iconClass: "i-lucide-file-text", hint: "章节", disabled: true}]}], activeIndex: 0, direction: "down", density: "compact", matchAnchorWidth: true, teleportTarget: false}}},
        ] satisfies LabFixtureDefinition<typeof ReferenceSelectorPopover>["scenes"];

export const segmentedControlScenes = [
            {id: "text-mode", label: "写作模式", input: {model: {modelValue: "write"}, props: {options: [{value: "write", label: "写作"}, {value: "review", label: "审阅"}]}}},
        ] satisfies LabFixtureDefinition<typeof SegmentedControl>["scenes"];

export const diffWorkbenchScenes = [
            {id: "diff", label: "双向差异", input: {props: {document: {id: "lab-diff", title: "第一章", path: "chapters/01.md", language: "markdown", baseContent: "# 退潮\n\n灯还亮着。\n", currentContent: "# 退潮\n\n灯已经熄了。\n", incomingContent: "# 退潮\n\n礁石上还留着灯光。\n", resultContent: "# 退潮\n\n灯已经熄了。\n", currentLabel: "当前稿", incomingLabel: "建议稿", baseLabel: "审阅基线", resultLabel: "合并结果"}, availableModes: ["diff", "merge", "current-base", "incoming-base"], initialMode: "diff"}, model: {mode: "diff"}}},
            {id: "merge", label: "冲突合并编辑", input: {props: {document: {id: "lab-diff", title: "第一章", path: "chapters/01.md", language: "markdown", baseContent: "# 退潮\n\n灯还亮着。\n", currentContent: "# 退潮\n\n灯已经熄了。\n", incomingContent: "# 退潮\n\n礁石上还留着灯光。\n", resultContent: "# 退潮\n\n灯在远处摇晃。\n", currentLabel: "当前稿", incomingLabel: "建议稿", baseLabel: "审阅基线", resultLabel: "合并结果"}, availableModes: ["diff", "merge", "current-base", "incoming-base"], initialMode: "merge"}, model: {mode: "merge"}}},
            {id: "unavailable", label: "二进制文件不可比较", input: {props: {document: {id: "lab-binary", title: "cover.png", path: "assets/cover.png", language: "plaintext", diffable: false, unavailableReason: "binary", notice: "二进制文件不能逐行比较。", currentContent: "", incomingContent: "", metadata: {currentBytes: 128, incomingBytes: 256}}, initialMode: "diff"}, model: {mode: "diff"}}},
        ] satisfies LabFixtureDefinition<typeof DiffWorkbench>["scenes"];

export const diffWorkbenchDialogScenes = [
            {id: "merge-open", label: "打开冲突合并对话框", input: {props: {document: {id: "lab-conflict", title: "chapters/01.md", path: "chapters/01.md", language: "markdown", baseContent: "# 退潮\n\n灯还亮着。\n", currentContent: "# 退潮\n\n灯已经熄了。\n", incomingContent: "# 退潮\n\n礁石上还留着灯光。\n", resultContent: "# 退潮\n\n灯在远处摇晃。\n", currentLabel: "本地稿", incomingLabel: "远端稿", baseLabel: "共同基线", resultLabel: "合并结果"}, title: "检视文档冲突", subtitle: "比较两侧内容并检查合并结果", initialMode: "merge", availableModes: ["diff", "merge", "current-base", "incoming-base"], actions: [{id: "cancel", label: "关闭", closeOnAction: false}, {id: "use-current", label: "采用本地稿", closeOnAction: false}, {id: "use-incoming", label: "采用远端稿", closeOnAction: false}, {id: "save-result", label: "报告合并结果", tone: "primary", closeOnAction: false}]}, model: {modelValue: true}}},
            {id: "unavailable-open", label: "打开不可比较文档", input: {props: {document: {id: "lab-unavailable", title: "archive.dat", path: "archive.dat", language: "plaintext", diffable: false, unavailableReason: "binary", notice: "此文件仅显示元信息。", currentContent: "", incomingContent: ""}, title: "无法比较的文档", initialMode: "diff", actions: [{id: "cancel", label: "关闭", closeOnAction: false}]}, model: {modelValue: true}}},
            {id: "no-document", label: "等待文档", input: {props: {document: null, title: "等待文档", actions: [{id: "cancel", label: "关闭", closeOnAction: false}]}, model: {modelValue: true}}},
        ] satisfies LabFixtureDefinition<typeof DiffWorkbenchDialog>["scenes"];

export const sharedDiffEditorScenes = [
            {id: "side-by-side", label: "并排只读差异", input: {props: {originalContent: "# 雾\n\n沿海的灯塔还亮着。\n", modifiedContent: "# 雾\n\n沿海灯塔已经熄灭。\n", originalLabel: "审阅基线", modifiedLabel: "当前稿", language: "markdown", readonly: true, renderSideBySide: true, modelKey: "lab-diff-wide"}}},
            {id: "inline", label: "行内只读差异", input: {props: {originalContent: "export const title = '草稿';\n", modifiedContent: "export const title = '定稿';\n", originalLabel: "原始版本", modifiedLabel: "修改版本", language: "typescript", readonly: true, renderSideBySide: false, modelKey: "lab-diff-inline"}}},
        ] satisfies LabFixtureDefinition<typeof SharedDiffEditor>["scenes"];

export const sharedMergeEditorScenes = [
            {id: "editable", label: "可编辑合并结果", input: {props: {currentContent: "# 退潮\n\n灯已经熄了。\n", incomingContent: "# 退潮\n\n礁石上还留着灯光。\n", currentLabel: "本地稿", incomingLabel: "远端稿", language: "markdown", readonly: false, modelKey: "lab-merge-editable", showWhitespace: false, resultLabel: "合并结果"}, model: {modelValue: "# 退潮\n\n灯在远处摇晃。\n"}}},
            {id: "readonly", label: "只读合并结果", input: {props: {currentContent: "type State = 'open';\n", incomingContent: "type State = 'closed';\n", currentLabel: "当前", incomingLabel: "来稿", language: "typescript", readonly: true, modelKey: "lab-merge-readonly", showWhitespace: true, resultLabel: "只读结果"}, model: {modelValue: "type State = 'pending';\n"}}},
        ] satisfies LabFixtureDefinition<typeof SharedMergeEditor>["scenes"];

export const comboboxScenes = [
            {id: "selected", label: "选择项", input: {props: {options: [{value: "markdown", label: "Markdown"}, {value: "typescript", label: "TypeScript"}, {value: "json", label: "JSON"}], placeholder: "搜索语言", size: "default"}, model: {modelValue: "typescript"}}},
            {id: "free-text", label: "自由输入", input: {props: {options: ["compact", "comfortable", "spacious"], placeholder: "输入或选择密度", size: "sm"}, model: {modelValue: "comfort"}}},
            {id: "disabled", label: "禁用", input: {props: {options: ["local", "remote"], placeholder: "环境", disabled: true, size: "sm"}, model: {modelValue: "local"}}},
        ] satisfies LabFixtureDefinition<typeof Combobox>["scenes"];

export const formColorFieldScenes = [
            {id: "valid", label: "有效强调色", input: {props: {label: "强调色", variableName: "--accent-main", allowAlpha: true, pickerTheme: "white"}, model: {modelValue: "#3b82f6"}}},
            {id: "alpha", label: "半透明高亮", input: {props: {label: "半透明高亮", variableName: "--accent-bg", allowAlpha: true, pickerTheme: "black"}, model: {modelValue: "rgba(59, 130, 246, 0.24)"}}},
            {id: "invalid", label: "无效草稿", input: {props: {label: "待修正颜色", variableName: "--accent-main", placeholder: "#000000", allowAlpha: false}, model: {modelValue: "not-a-color"}}},
        ] satisfies LabFixtureDefinition<typeof FormColorField>["scenes"];

export const formSelectScenes = [
            {id: "selected", label: "当前草稿状态", input: {props: {options: [{label: "草稿", value: "draft", description: "尚未发布"}, {label: "已发布", value: "published"}, {label: "已停用", value: "retired", disabled: true}], id: "lab-status", name: "status", placeholder: "选择状态", size: "default", dropdownDirection: "auto"}, model: {modelValue: "draft"}}},
            {id: "disabled", label: "禁用选择", input: {props: {options: [{label: "草稿", value: "draft"}, {label: "已发布", value: "published"}, {label: "已停用", value: "retired", disabled: true}], id: "lab-status", name: "status", placeholder: "选择状态", size: "default", dropdownDirection: "auto", disabled: true}, model: {modelValue: "published"}}},
            {id: "empty", label: "无可选项", input: {props: {options: [], placeholder: "没有可选项", size: "sm"}, model: {modelValue: ""}}},
        ] satisfies LabFixtureDefinition<typeof FormSelect>["scenes"];

export const lowCodeCheckboxFieldScenes = [
            {id: "selected", label: "多项可选", input: {props: {field: {path: "flags", component: "checkbox", label: "标记", description: "选择适用项", required: false, options: [{value: "draft", label: "草稿"}, {value: "reviewed", label: "已审核"}, {value: "locked", label: "锁定", disabled: true}]}}, model: {modelValue: ["draft"]}}},
            {id: "disabled", label: "禁用字段", input: {props: {field: {path: "flags", component: "checkbox", label: "标记", description: "选择适用项", required: false, options: [{value: "draft", label: "草稿"}, {value: "reviewed", label: "已审核"}, {value: "locked", label: "锁定", disabled: true}]}, disabled: true}, model: {modelValue: ["draft"]}}},
            {id: "stale", label: "保留未知历史值", input: {props: {field: {path: "flags", component: "checkbox", label: "标记", description: "选择适用项", required: false, options: [{value: "draft", label: "草稿"}, {value: "reviewed", label: "已审核"}]}}, model: {modelValue: ["retired"]}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeCheckboxField>["scenes"];

export const lowCodeComboboxFieldScenes = [
            {id: "selected", label: "当前模型", input: {props: {field: {path: "model", component: "combobox", label: "模型", placeholder: "搜索模型", required: false, options: [{value: "alpha", label: "Alpha", description: "稳定版"}, {value: "beta", label: "Beta", description: "预览版"}, {value: "legacy", label: "Legacy", disabled: true}]}}, model: {modelValue: "alpha"}}},
            {id: "unmatched", label: "已下线模型值", input: {props: {field: {path: "model", component: "combobox", label: "模型", placeholder: "搜索模型", required: false, options: [{value: "alpha", label: "Alpha", description: "稳定版"}, {value: "beta", label: "Beta", description: "预览版"}, {value: "legacy", label: "Legacy", disabled: true}]}}, model: {modelValue: "retired-model"}}},
            {id: "disabled", label: "禁用字段", input: {props: {field: {path: "model", component: "combobox", label: "模型", placeholder: "搜索模型", required: false, options: [{value: "alpha", label: "Alpha", description: "稳定版"}, {value: "beta", label: "Beta", description: "预览版"}, {value: "legacy", label: "Legacy", disabled: true}]}, disabled: true}, model: {modelValue: "alpha"}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeComboboxField>["scenes"];

const emptyInheritedValue: LowCodeJsonObject = {};
const projectInheritedValue: LowCodeJsonObject = {displayName: "上层名称", status: "published", flags: ["reviewed"]};
const globalFormDraft: LowCodeJsonObject = {displayName: "星河", status: "draft", flags: ["draft"]};
const projectFormDraft: LowCodeJsonObject = {displayName: "项目名称", status: "draft", flags: ["draft"]};
const issueFormDraft: LowCodeJsonObject = {displayName: "", status: "retired", flags: []};
const emptyFormDraft: LowCodeJsonObject = {};
const fullFormDefaults: LowCodeJsonObject = {displayName: "星河", status: "draft", flags: ["draft"]};
const emptyFormDefaults: LowCodeJsonObject = {};

export const lowCodeFormScenes = [
            {id: "global", label: "全局设置", input: {props: {form: {defaults: fullFormDefaults, fields: [{path: "displayName", component: "text", label: "显示名称", placeholder: "输入名称", required: false, defaultValue: "星河", options: []}, {path: "status", component: "select", label: "状态", placeholder: "选择状态", required: false, options: [{value: "draft", label: "草稿"}, {value: "published", label: "已发布"}]}, {path: "flags", component: "checkbox", label: "标记", required: false, options: [{value: "draft", label: "草稿"}, {value: "reviewed", label: "已审核"}]}]}, scope: "global", inheritanceMode: "manual", issues: [], inheritedValue: emptyInheritedValue, disabled: false}, model: {modelValue: globalFormDraft, overridePaths: [], resourceMutations: []}}},
            {id: "project-inherited", label: "继承全局值", input: {props: {form: {defaults: fullFormDefaults, fields: [{path: "displayName", component: "text", label: "显示名称", placeholder: "输入名称", required: false, defaultValue: "星河", options: []}, {path: "status", component: "select", label: "状态", placeholder: "选择状态", required: false, options: [{value: "draft", label: "草稿"}, {value: "published", label: "已发布"}]}, {path: "flags", component: "checkbox", label: "标记", required: false, options: [{value: "draft", label: "草稿"}, {value: "reviewed", label: "已审核"}]}]}, scope: "project", inheritanceMode: "manual", inheritedValue: projectInheritedValue, issues: []}, model: {modelValue: emptyFormDraft, overridePaths: [], resourceMutations: []}}},
            {id: "project-override", label: "手动覆盖", input: {props: {form: {defaults: fullFormDefaults, fields: [{path: "displayName", component: "text", label: "显示名称", placeholder: "输入名称", required: false, defaultValue: "星河", options: []}, {path: "status", component: "select", label: "状态", placeholder: "选择状态", required: false, options: [{value: "draft", label: "草稿"}, {value: "published", label: "已发布"}]}, {path: "flags", component: "checkbox", label: "标记", required: false, options: [{value: "draft", label: "草稿"}, {value: "reviewed", label: "已审核"}]}]}, scope: "project", inheritanceMode: "manual", inheritedValue: projectInheritedValue, issues: []}, model: {modelValue: projectFormDraft, overridePaths: ["displayName", "status", "flags"], resourceMutations: []}}},
            {id: "disabled", label: "整张表单禁用", input: {props: {form: {defaults: fullFormDefaults, fields: [{path: "displayName", component: "text", label: "显示名称", placeholder: "输入名称", required: false, defaultValue: "星河", options: []}, {path: "status", component: "select", label: "状态", placeholder: "选择状态", required: false, options: [{value: "draft", label: "草稿"}, {value: "published", label: "已发布"}]}, {path: "flags", component: "checkbox", label: "标记", required: false, options: [{value: "draft", label: "草稿"}, {value: "reviewed", label: "已审核"}]}]}, scope: "global", inheritanceMode: "manual", issues: [], inheritedValue: emptyInheritedValue, disabled: true}, model: {modelValue: globalFormDraft, overridePaths: [], resourceMutations: []}}},
            {id: "issues", label: "问题与失效选项", input: {props: {form: {defaults: fullFormDefaults, fields: [{path: "displayName", component: "text", label: "显示名称", placeholder: "输入名称", required: false, defaultValue: "星河", options: []}, {path: "status", component: "select", label: "状态", placeholder: "选择状态", required: false, options: [{value: "draft", label: "草稿"}, {value: "published", label: "已发布"}]}, {path: "flags", component: "checkbox", label: "标记", required: false, options: [{value: "draft", label: "草稿"}, {value: "reviewed", label: "已审核"}]}]}, scope: "global", inheritanceMode: "manual", issues: [{path: "displayName", severity: "error", code: "invalid", message: "名称无效"}], inheritedValue: emptyInheritedValue, disabled: false}, model: {modelValue: issueFormDraft, overridePaths: [], resourceMutations: []}}},
            {id: "empty", label: "空表单", input: {props: {form: {defaults: emptyFormDefaults, fields: []}, scope: "global", inheritanceMode: "manual", issues: [], inheritedValue: emptyInheritedValue, disabled: false}, model: {modelValue: emptyFormDraft, overridePaths: [], resourceMutations: []}}},
        ] satisfies LabFixtureDefinition<typeof LowCodeForm>["scenes"];
