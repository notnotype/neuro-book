<script setup lang="ts">
import FormCheckbox from "nbook/app/components/common/form/FormCheckbox.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import ProfileTemplateSourcePanel from "nbook/app/components/profile-template-editor/ProfileTemplateSourcePanel.vue";
import ProfileTemplateVariableGroups from "nbook/app/components/profile-template-editor/ProfileTemplateVariableGroups.vue";
import type {
    InspectorTab,
    PreviewVariableGroup,
    SelectOption,
    SelectedPropEntry,
} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {AgentProfileDetailDto, AgentProfileSchemaFieldDto} from "nbook/shared/dto/agent-profile.dto";
import type {
    ProfileTemplateIssueDto,
    ProfileTemplateNodeDto,
    ProfileTemplatePropValue,
} from "nbook/shared/dto/profile-template.dto";

const props = defineProps<{
    activeTab: InspectorTab;
    tabs: Array<{value: InspectorTab; label: string}>;
    selectedNode: ProfileTemplateNodeDto | null;
    selectedPropEntries: SelectedPropEntry[];
    selectedTextLength: number;
    sourceText: string;
    sourceLineCount: number;
    parsingSource: boolean;
    selectedTemplateFileName: string;
    issues: ProfileTemplateIssueDto[];
    variableSearch: string;
    variableGroups: PreviewVariableGroup[];
    filteredVariableGroups: PreviewVariableGroup[];
    filteredRuntimeVariableGroups: PreviewVariableGroup[];
    roleOptions: SelectOption[];
    toolStatusOptions: SelectOption[];
    sourceOptions: SelectOption[];
    theme: IdeTheme;
    monacoPreferences: import("nbook/shared/editor-workbench").MonacoEditorPreferences;
    isExpressionValue: (value: ProfileTemplatePropValue | undefined) => boolean;
    propInputValue: (value: ProfileTemplatePropValue) => string;
    propLabel: (key: string) => string;
    nodeTitle: (node: ProfileTemplateNodeDto) => string;
    issueDetail: (issue: ProfileTemplateIssueDto) => string;
    formatVariableValue: (value: unknown) => string;
    isVariableGroupCollapsed: (group: string) => boolean;
    profileDetail?: AgentProfileDetailDto | null;
}>();

const emit = defineEmits<{
    (e: "update:activeTab", value: InspectorTab): void;
    (e: "update:variableSearch", value: string): void;
    (e: "collapse"): void;
    (e: "source-change", value: string): void;
    (e: "source-save-request"): void;
    (e: "update-prop", key: string, value: ProfileTemplatePropValue): void;
    (e: "update-expression-prop", key: string, value: string): void;
    (e: "update-text", value: string): void;
    (e: "commit-message-text"): void;
    (e: "toggle-variable-group", group: string): void;
    (e: "save-schema", payload: {schemaName: ProfileSchemaName; fields: AgentProfileSchemaFieldDto[]}): void;
}>();

const schemaTypeOptions = [
    {value: "string", label: "string"},
    {value: "number", label: "number"},
    {value: "boolean", label: "boolean"},
    {value: "enum", label: "enum"},
    {value: "array", label: "array"},
    {value: "object", label: "object"},
];
const fileChangeNoticeModeOptions = [
    {value: "off", label: "off"},
    {value: "minimal", label: "minimal"},
    {value: "full", label: "full"},
];
type ProfileSchemaName = "InitialSchema" | "PayloadSchema" | "OutputSchema";

const editingSchemaName = ref<ProfileSchemaName>("InitialSchema");
const schemaFields = ref<SchemaFieldDraft[]>([]);

type SchemaFieldDraft = {
    name: string;
    type: AgentProfileSchemaFieldDto["type"];
    required: boolean;
    description: string;
    defaultValueText: string;
    enumValuesText: string;
    itemType: AgentProfileSchemaFieldDto["type"];
};

watch(() => props.profileDetail, () => {
    resetSchemaDraft();
}, {immediate: true});

watch(editingSchemaName, () => {
    resetSchemaDraft();
});

/**
 * 从 JSON Schema 初始化可编辑字段草稿。
 */
function resetSchemaDraft(): void {
    const schema = currentSchemaDetail()?.jsonSchema;
    schemaFields.value = schema ? fieldsFromJsonSchema(schema) : [];
}

/**
 * 判断当前 schema 是否允许低代码保存。
 */
function canSaveSchema(): boolean {
    const detail = currentSchemaDetail();
    return Boolean(detail && detail.editMode === "source");
}

function currentSchemaDetail(): AgentProfileDetailDto["initialSchema"] | undefined {
    if (!props.profileDetail) {
        return undefined;
    }
    if (editingSchemaName.value === "InitialSchema") {
        return props.profileDetail.initialSchema;
    }
    if (editingSchemaName.value === "PayloadSchema") {
        return props.profileDetail.payloadSchema;
    }
    return props.profileDetail.outputSchema;
}

/**
 * 从 JSON Schema 读取第一版 builder 支持的对象字段。
 */
function fieldsFromJsonSchema(schema: Record<string, unknown>): SchemaFieldDraft[] {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? new Set(schema.required.filter((item): item is string => typeof item === "string")) : new Set<string>();
    return Object.entries(properties).map(([name, value]) => {
        const property = isRecord(value) ? value : {};
        const type = readSchemaType(property);
        return {
            name,
            type,
            required: required.has(name),
            description: typeof property.description === "string" ? property.description : "",
            defaultValueText: property.default === undefined ? "" : JSON.stringify(property.default),
            enumValuesText: Array.isArray(property.enum) ? property.enum.filter((item): item is string => typeof item === "string").join("\n") : "",
            itemType: readSchemaType(isRecord(property.items) ? property.items : {}),
        };
    });
}

/**
 * 读取 JSON Schema 类型标签。
 */
function readSchemaType(schema: Record<string, unknown>): AgentProfileSchemaFieldDto["type"] {
    if (Array.isArray(schema.enum)) {
        return "enum";
    }
    if (schema.type === "number" || schema.type === "integer") {
        return "number";
    }
    if (schema.type === "boolean") {
        return "boolean";
    }
    if (schema.type === "array") {
        return "array";
    }
    if (schema.type === "object") {
        return "object";
    }
    return "string";
}

/**
 * 新增 schema 字段。
 */
function addSchemaField(): void {
    schemaFields.value.push({
        name: `field${schemaFields.value.length + 1}`,
        type: "string",
        required: false,
        description: "",
        defaultValueText: "",
        enumValuesText: "",
        itemType: "string",
    });
}

/**
 * 删除 schema 字段。
 */
function removeSchemaField(index: number): void {
    schemaFields.value.splice(index, 1);
}

/**
 * 保存当前 schema 草稿。
 */
function saveSchemaDraft(): void {
    emit("save-schema", {
        schemaName: editingSchemaName.value,
        fields: schemaFields.value
            .filter((field) => field.name.trim())
            .map(toSchemaFieldDto),
    });
}

/**
 * 转成服务端 schema builder DTO。
 */
function toSchemaFieldDto(field: SchemaFieldDraft): AgentProfileSchemaFieldDto {
    const result: AgentProfileSchemaFieldDto = {
        name: field.name.trim(),
        type: field.type,
        required: field.required,
    };
    if (field.description.trim()) {
        result.description = field.description.trim();
    }
    if (field.defaultValueText.trim()) {
        result.defaultValue = parseDefaultValue(field.defaultValueText);
    }
    if (field.type === "enum") {
        result.enumValues = field.enumValuesText.split("\n").map((item) => item.trim()).filter(Boolean);
    }
    if (field.type === "array") {
        result.itemType = field.itemType === "array" ? "string" : field.itemType;
    }
    return result;
}

/**
 * 解析默认值；简单裸字符串按字符串处理，合法 JSON 按 JSON 处理。
 */
function parseDefaultValue(value: string): AgentProfileSchemaFieldDto["defaultValue"] {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

/**
 * 判断普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
</script>

<template>
    <!-- 右侧属性检查器：属性、变量、运行时变量 -->
    <section class="panel flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
        <div class="mb-3 flex shrink-0 items-center gap-2 border-b border-[var(--border-color)]">
            <div class="flex min-w-0 flex-1 overflow-x-auto custom-scrollbar no-scrollbar">
                <button
                    v-for="tab in props.tabs"
                    :key="tab.value"
                    class="relative h-8 shrink-0 px-3 text-xs font-medium transition-colors"
                    :class="props.activeTab === tab.value ? 'text-[var(--accent-text)] after:absolute after:bottom-[-1px] after:left-0 after:h-0.5 after:w-full after:bg-[var(--accent-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                    @click="emit('update:activeTab', tab.value)"
                >
                    {{ tab.label }}
                </button>
            </div>
            <button type="button" class="panel-icon-btn" title="收起右侧面板" @click="emit('collapse')">
                <span class="i-lucide-panel-right-close h-4 w-4"></span>
            </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto pr-1 custom-scrollbar no-scrollbar">
            <div v-if="props.activeTab === 'source'" class="h-full min-h-[520px]">
                <ProfileTemplateSourcePanel
                    :source-text="props.sourceText"
                    :source-line-count="props.sourceLineCount"
                    :parsing-source="props.parsingSource"
                    :selected-template-file-name="props.selectedTemplateFileName"
                    :theme="props.theme"
                    :monaco-preferences="props.monacoPreferences"
                    embedded
                    @change="emit('source-change', $event)"
                    @save-request="emit('source-save-request')"
                />
            </div>

            <div v-else-if="props.activeTab === 'props'">
                <div v-if="props.selectedNode" class="space-y-3">
                    <div v-if="props.selectedPropEntries.length > 0" class="space-y-3">
                        <div v-for="[key, value] in props.selectedPropEntries" :key="key" class="space-y-1">
                            <div class="flex items-center justify-between gap-2">
                                <div class="field-label">{{ props.propLabel(key) }}</div>
                                <span v-if="props.isExpressionValue(value)" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)]">表达式</span>
                            </div>
                            <FormSelect v-if="key === 'role'" :model-value="String(value ?? 'user')" :options="props.roleOptions" @update:model-value="emit('update-prop', key, $event)" />
                            <FormSelect v-else-if="key === 'status'" :model-value="String(value ?? 'drafting')" :options="props.toolStatusOptions" @update:model-value="emit('update-prop', key, $event)" />
                            <FormSelect v-else-if="key === 'source'" :model-value="String(value ?? 'context')" :options="props.sourceOptions" @update:model-value="emit('update-prop', key, $event)" />
                            <FormSelect v-else-if="props.selectedNode.type === 'FileChangeNotice' && key === 'mode' && !props.isExpressionValue(value)" :model-value="String(value ?? 'minimal')" :options="fileChangeNoticeModeOptions" @update:model-value="emit('update-prop', key, $event)" />
                            <FormTextarea
                                v-else-if="props.isExpressionValue(value)"
                                :model-value="props.propInputValue(value)"
                                :rows="4"
                                class="textarea font-mono"
                                @update:model-value="emit('update-expression-prop', key, $event)"
                            />
                            <FormCheckbox v-else-if="typeof value === 'boolean'" :model-value="value" @update:model-value="emit('update-prop', key, $event)" />
                            <FormInput v-else-if="typeof value === 'number'" :model-value="String(value)" type="number" @update:model-value="emit('update-prop', key, Number($event || 0))" />
                            <FormInput v-else :model-value="props.propInputValue(value)" @update:model-value="emit('update-prop', key, $event)" />
                        </div>
                    </div>
                    <div v-else class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 px-3 py-2 text-xs text-[var(--text-muted)]">此节点暂无属性。</div>

                    <template v-if="props.selectedNode.type === 'System' || props.selectedNode.type === 'Message' || props.selectedNode.type === 'AIMessage' || props.selectedNode.type === 'ToolCall' || props.selectedNode.type === 'ToolResult' || props.selectedNode.type === 'Text' || props.selectedNode.type === 'CompactionPrompt' || props.selectedNode.type === 'CompactionSummaryPrefix'">
                        <div class="field-label">{{ props.selectedNode.textKind === "source" ? "内容（TSX 表达式内容）" : props.selectedNode.type === "Text" ? "文本片段" : "内容（支持变量引用）" }}</div>
                        <StructuredTextEditor
                            :model-value="props.selectedNode.text ?? ''"
                            :rows="props.selectedNode.type === 'ToolCall' ? 5 : 8"
                            :min-height="props.selectedNode.type === 'ToolCall' ? 120 : 172"
                            :max-height="420"
                            :default-mode="props.selectedNode.textKind === 'source' ? 'source' : 'rich'"
                            :show-format-toolbar="props.selectedNode.type !== 'Text' && props.selectedNode.textKind !== 'source' && props.selectedNode.textKind !== 'template'"
                            :theme="props.theme"
                            :placeholder="props.selectedNode.type === 'Text' ? '输入文本片段' : '输入 Message 正文，可使用 Markdown 与变量引用'"
                            @blur="emit('commit-message-text')"
                            @update:model-value="emit('update-text', $event)"
                        />
                        <div class="text-right text-[11px] text-[var(--text-muted)]">字数：{{ props.selectedTextLength }} / 20000</div>
                    </template>
                </div>
                <div v-else class="empty-state">请选择一个节点。</div>

                <div class="mt-4 border-t border-[var(--border-color)] pt-3">
                    <div class="mb-2 text-xs font-semibold text-[var(--text-secondary)]">验证结果</div>
                    <div v-if="props.issues.length === 0" class="text-xs text-[var(--status-success)]">暂无问题</div>
                    <div v-for="issue in props.issues" :key="`${issue.message}-${issue.nodeId ?? ''}`" class="mb-1 rounded-md border px-2 py-1 text-xs" :class="issue.severity === 'error' ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'">
                        <div class="font-medium">{{ issue.message }}</div>
                        <div v-if="props.issueDetail(issue)" class="mt-1 text-[10px] leading-4 opacity-80">{{ props.issueDetail(issue) }}</div>
                    </div>
                </div>
            </div>

            <div v-else-if="props.activeTab === 'variables'" class="space-y-3">
                <div class="text-[11px] leading-5 text-[var(--text-muted)]">变量信息仅用于检查 Profile schema 与运行时上下文，不会生成 TSX helper。</div>
                <FormInput :model-value="props.variableSearch" placeholder="搜索变量、路径或当前值" @update:model-value="emit('update:variableSearch', $event)" />
                <ProfileTemplateVariableGroups
                    :groups="props.filteredVariableGroups"
                    :is-collapsed="props.isVariableGroupCollapsed"
                    :format-value="props.formatVariableValue"
                    @toggle-group="emit('toggle-variable-group', $event)"
                />
            </div>

            <div v-else-if="props.activeTab === 'runtime'" class="space-y-3">
                <FormInput :model-value="props.variableSearch" placeholder="搜索运行时变量" @update:model-value="emit('update:variableSearch', $event)" />
                <ProfileTemplateVariableGroups
                    :groups="props.filteredRuntimeVariableGroups"
                    compact
                    :is-collapsed="props.isVariableGroupCollapsed"
                    :format-value="props.formatVariableValue"
                    @toggle-group="emit('toggle-variable-group', $event)"
                />
            </div>

            <div v-else class="space-y-3">
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3 text-xs leading-5 text-[var(--text-secondary)]">
                    <div class="mb-2 font-semibold text-[var(--text-main)]">Agent Profile</div>
                    <template v-if="props.profileDetail">
                        <div class="profile-row"><span>key</span><code>{{ props.profileDetail.catalogItem.profileKey }}</code></div>
                        <div class="profile-row"><span>kind</span><code>{{ props.profileDetail.catalogItem.kind ?? "unknown" }}</code></div>
                        <div class="profile-row"><span>来源</span><code>{{ props.profileDetail.catalogItem.source }} / {{ props.profileDetail.catalogItem.overrideState }}</code></div>
                        <div class="profile-row"><span>加载</span><code>{{ props.profileDetail.catalogItem.loadStatus }}</code></div>
                        <div class="profile-row"><span>schema</span><code>{{ props.profileDetail.catalogItem.schemaLocked ? "builtin locked" : props.profileDetail.initialSchema.editMode }}</code></div>
                    </template>
                    <div v-else>当前模板不是动态 Agent Profile。</div>
                </div>
                <div v-if="props.profileDetail" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3 text-xs leading-5 text-[var(--text-secondary)]">
                    <div class="mb-2 font-semibold text-[var(--text-main)]">工具权限</div>
                    <div v-if="props.profileDetail.toolKeys.length" class="flex flex-wrap gap-1.5">
                        <code v-for="toolKey in props.profileDetail.toolKeys" :key="toolKey" class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5">{{ toolKey }}</code>
                    </div>
                    <div v-else>未声明工具。</div>
                </div>
                <div v-if="props.profileDetail" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3 text-xs leading-5 text-[var(--text-secondary)]">
                    <div class="mb-2 font-semibold text-[var(--text-main)]">InitialSchema</div>
                    <div>{{ props.profileDetail.initialSchema.reason }}</div>
                    <pre v-if="props.profileDetail.initialSchema.jsonSchema" class="schema-preview">{{ JSON.stringify(props.profileDetail.initialSchema.jsonSchema, null, 2) }}</pre>
                </div>
                <div v-if="props.profileDetail" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3 text-xs leading-5 text-[var(--text-secondary)]">
                    <div class="mb-2 font-semibold text-[var(--text-main)]">PayloadSchema</div>
                    <div>{{ props.profileDetail.payloadSchema.reason }}</div>
                    <pre v-if="props.profileDetail.payloadSchema.jsonSchema" class="schema-preview">{{ JSON.stringify(props.profileDetail.payloadSchema.jsonSchema, null, 2) }}</pre>
                </div>
                <div v-if="props.profileDetail" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3 text-xs leading-5 text-[var(--text-secondary)]">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <div class="font-semibold text-[var(--text-main)]">TypeBox Schema</div>
                        <FormSelect v-model="editingSchemaName" class="w-40" :options="[{value: 'InitialSchema', label: 'InitialSchema'}, {value: 'PayloadSchema', label: 'PayloadSchema'}, {value: 'OutputSchema', label: 'OutputSchema'}]" />
                    </div>
                    <div class="mb-3 text-[11px] text-[var(--text-muted)]">
                        {{ currentSchemaDetail()?.reason }}
                    </div>
                    <pre v-if="currentSchemaDetail()?.jsonSchema" class="schema-preview">{{ JSON.stringify(currentSchemaDetail()?.jsonSchema, null, 2) }}</pre>
                    <div class="mt-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 text-[11px] text-[var(--text-muted)]">
                        TypeBox Schema Builder 第一版暂不写回；请在源码面板中编辑 `InitialSchema` / `PayloadSchema` / `OutputSchema`。
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.no-scrollbar {
    scrollbar-width: none;
    scrollbar-color: transparent transparent;
    -ms-overflow-style: none;
}

.no-scrollbar::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
}

.panel {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-panel);
    padding: 12px;
    box-shadow: 0 16px 44px color-mix(in srgb, var(--shadow-color) 5%, transparent);
}

.panel-icon-btn {
    display: inline-flex;
    height: 32px;
    width: 32px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    color: var(--text-muted);
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.panel-icon-btn:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
    color: var(--accent-text);
}

.field-label {
    display: block;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
}

.field,
.textarea {
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    color: var(--text-main);
    font-size: 12px;
    outline: none;
}

.textarea {
    min-height: 150px;
    resize: vertical;
    padding: 9px 10px;
    line-height: 1.6;
}

.textarea:focus {
    border-color: var(--accent-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 16%, transparent);
}

.variable-chip {
    display: inline-flex;
    max-width: 100%;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    border: 1px solid color-mix(in srgb, var(--accent-main) 30%, var(--border-color));
    border-radius: 5px;
    background: var(--accent-bg);
    padding: 3px 7px;
    color: var(--accent-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
}

.empty-state {
    display: flex;
    min-height: 180px;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--border-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-input) 55%, transparent);
    color: var(--text-muted);
    font-size: 13px;
}

.profile-row {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
}

.profile-row + .profile-row {
    margin-top: 4px;
}

.schema-preview {
    margin-top: 8px;
    max-height: 260px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-panel);
    padding: 8px;
    font-size: 11px;
    line-height: 1.5;
}

.schema-field-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: color-mix(in srgb, var(--bg-panel) 72%, transparent);
    padding: 8px;
}

.schema-icon-btn,
.schema-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    color: var(--text-secondary);
    font-size: 12px;
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.schema-icon-btn {
    height: 28px;
    width: 28px;
}

.schema-action-btn {
    height: 30px;
    padding: 0 10px;
}

.schema-action-btn.primary {
    border-color: color-mix(in srgb, var(--accent-main) 42%, var(--border-color));
    color: var(--accent-text);
}

.schema-action-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.schema-icon-btn:hover,
.schema-action-btn:not(:disabled):hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
    color: var(--accent-text);
}
</style>
