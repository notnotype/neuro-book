import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";
import type {
    LowCodeFieldComponentDto,
    LowCodeFieldDto,
    LowCodeFieldOptionDto,
    LowCodeFieldOptionValueDto,
    LowCodeFormDto,
    LowCodeFormIssueDto,
    LowCodeJsonObject,
    LowCodeResourceMutationDto,
    LowCodeResourcePresetDto,
    LowCodeJsonValue,
} from "nbook/shared/dto/low-code-form.dto";
import type {ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";
import {defineResourcePreset, profileHomeResource, type ResourcePresetDefinition} from "nbook/server/low-code-form/resource-preset";
import type {WorkspaceRootRef} from "nbook/server/workspace-files/workspace-root-ref";

export {defineResourcePreset, profileHomeResource};

export type LowCodeFormResolveContext = {
    profileKey: string;
    scope: "global" | "project";
    workspaceRoot: WorkspaceRootRef;
    projectPath?: string;
    values?: LowCodeJsonObject;
    home?: ProfileHomeFacade;
    globalHome?: ProfileHomeFacade;
    allowGlobalResourceKeys?: boolean;
    resourceMutationKeyView?: LowCodeResourceMutationKeyView;
};

export type LowCodeResourceMutationKeyView = {
    knownKeys: ReadonlySet<string>;
    finalKeys: ReadonlySet<string>;
};

export type LowCodeFieldOptionsProvider = (
    ctx: LowCodeFormResolveContext,
) => readonly LowCodeFieldOptionDto[] | Promise<readonly LowCodeFieldOptionDto[]>;

export type LowCodeFieldDefinition = {
    path: string;
    component: LowCodeFieldComponentDto;
    label: string;
    /** 可选展示分区；同 key 的连续字段由前端归入同一组。 */
    section?: {
        key: string;
        label: string;
        description?: string;
    };
    description?: string;
    placeholder?: string;
    required?: boolean;
    defaultValue?: LowCodeJsonValue;
    options?: readonly LowCodeFieldOptionDto[] | LowCodeFieldOptionsProvider;
    rows?: number;
    min?: number;
    max?: number;
    step?: number;
    integer?: boolean;
    resource?: ResourcePresetDefinition;
};

export type LowCodeFormDefinition<TSettingsSchema extends TSchema = TSchema> = {
    schema: TSettingsSchema;
    defaults: Static<TSettingsSchema>;
    fields: readonly LowCodeFieldDefinition[];
    /** 整套 Profile 设置预设；模型参数和运行策略不属于低代码表单，因此天然不会被快照。 */
    presets?: {
        storagePath: string;
        activePath: string;
        excludedPaths?: readonly string[];
    };
    validate?: (
        value: Static<TSettingsSchema>,
        ctx: LowCodeFormResolveContext,
    ) => readonly LowCodeFormIssueDto[] | Promise<readonly LowCodeFormIssueDto[]>;
};

export type LowCodeFormValidationResult<TValue> = {
    value: TValue;
    issues: LowCodeFormIssueDto[];
};

export type LowCodeResourceMutationResult = {
    fieldPath: string;
    issues: LowCodeFormIssueDto[];
    finalKeys?: string[];
};

/**
 * 表示低代码表单校验失败，同时保留字段级 issues。
 */
export class LowCodeFormValidationError extends Error {
    constructor(
        message: string,
        readonly issues: LowCodeFormIssueDto[],
    ) {
        super(message);
        this.name = "LowCodeFormValidationError";
    }
}

/**
 * 定义低代码表单，并保留 TypeBox schema 推导能力。
 */
export function defineLowCodeForm<const TSettingsSchema extends TSchema>(
    definition: LowCodeFormDefinition<TSettingsSchema>,
): LowCodeFormDefinition<TSettingsSchema> {
    assertLowCodeFormDefinition(definition);
    return definition;
}

/**
 * 执行动态 options，生成前端可渲染的低代码表单 DTO。
 */
export async function resolveLowCodeForm<TSettingsSchema extends TSchema>(
    form: LowCodeFormDefinition<TSettingsSchema>,
    ctx: LowCodeFormResolveContext,
): Promise<LowCodeFormDto> {
    const defaults = cloneJsonObject(form.defaults as LowCodeJsonObject);
    return {
        defaults,
        fields: await Promise.all(form.fields.map((field) => resolveField(field, ctx, defaults))),
        ...(form.presets ? {
            presets: {
                storagePath: form.presets.storagePath,
                activePath: form.presets.activePath,
                excludedPaths: [...(form.presets.excludedPaths ?? [])],
            },
        } : {}),
    };
}

/**
 * 合并 defaults 与存储 patch，并返回已通过 TypeBox 校验的值。
 */
export function parseLowCodeFormValue<TSettingsSchema extends TSchema>(
    form: LowCodeFormDefinition<TSettingsSchema>,
    rawValue: LowCodeJsonObject | undefined,
): Static<TSettingsSchema> {
    const merged = mergeSettings(form.defaults as LowCodeJsonObject, rawValue);
    const schemaIssues = typeboxIssues(form.schema, merged);
    if (schemaIssues.length > 0) {
        throw new LowCodeFormValidationError("低代码表单值校验失败", schemaIssues);
    }
    return Value.Parse(form.schema, merged) as Static<TSettingsSchema>;
}

/**
 * 校验低代码表单值，并执行 options 与自定义校验。
 */
export async function validateLowCodeFormValue<TSettingsSchema extends TSchema>(
    form: LowCodeFormDefinition<TSettingsSchema>,
    rawValue: LowCodeJsonObject | undefined,
    ctx: LowCodeFormResolveContext,
): Promise<LowCodeFormValidationResult<Static<TSettingsSchema>>> {
    let value: Static<TSettingsSchema>;
    let issues: LowCodeFormIssueDto[] = [];
    try {
        value = parseLowCodeFormValue(form, rawValue);
    } catch (error) {
        if (error instanceof LowCodeFormValidationError) {
            return {
                value: mergeSettings(form.defaults as LowCodeJsonObject, rawValue) as Static<TSettingsSchema>,
                issues: error.issues,
            };
        }
        throw error;
    }

    const defaults = cloneJsonObject(form.defaults as LowCodeJsonObject);
    const resolvedFields = await Promise.all(form.fields.map((field) => resolveField(field, ctx, defaults)));
    issues = issues.concat(optionIssues(value as LowCodeJsonObject, resolvedFields));
    issues = issues.concat(await resourcePresetIssues(value as LowCodeJsonObject, form.fields, ctx));
    if (form.validate) {
        issues = issues.concat([...(await form.validate(value, ctx))]);
    }
    return {value, issues};
}

/**
 * 合并 profile 默认值与用户 patch。
 */
export function mergeLowCodeFormValue(
    defaults: LowCodeJsonObject,
    patch: LowCodeJsonObject | undefined,
): LowCodeJsonObject {
    return mergeSettings(defaults, patch);
}

/**
 * 解析单个字段的 options。
 */
async function resolveField(
    field: LowCodeFieldDefinition,
    ctx: LowCodeFormResolveContext,
    defaults: LowCodeJsonObject,
): Promise<LowCodeFieldDto> {
    const {resource: _serverResource, ...serializableField} = field;
    const options = await resolveFieldOptions(field.options, ctx);
    const normalizedOptions = normalizeOptions(options);
    assertFieldOptions(field, normalizedOptions);
    const defaultValue = field.defaultValue ?? readPath(defaults, field.path);
    const resource = field.resource ? await resolveResourcePresetField(field, ctx, defaultValue) : undefined;
    return {
        ...serializableField,
        required: field.required ?? false,
        ...(defaultValue !== undefined ? {defaultValue} : {}),
        options: normalizedOptions,
        ...(resource ? {resource} : {}),
    };
}

/**
 * 校验低代码 form 定义期合同。第一版只支持顶层字段，避免 patch 合并语义变成隐式 deep merge。
 */
function assertLowCodeFormDefinition(form: LowCodeFormDefinition): void {
    const paths = new Set<string>();
    for (const field of form.fields) {
        assertFieldPath(field.path);
        if (paths.has(field.path)) {
            throw new Error(`低代码表单字段 path 重复：${field.path}`);
        }
        paths.add(field.path);
        if (field.section && (!field.section.key.trim() || !field.section.label.trim())) {
            throw new Error(`低代码表单字段 ${field.path} 的 section key/label 不能为空。`);
        }
        if (Array.isArray(field.options)) {
            assertFieldOptions(field, field.options);
        }
        if (field.component === "resource-preset" && !field.resource) {
            throw new Error(`低代码 resource-preset 字段 ${field.path} 必须声明 resource resolver。`);
        }
    }
    if (form.presets) {
        assertFieldPath(form.presets.storagePath);
        assertFieldPath(form.presets.activePath);
        for (const path of form.presets.excludedPaths ?? []) {
            assertFieldPath(path);
        }
    }
}

/**
 * 第一版 field.path 仅表示 settings 对象的顶层 key。
 */
function assertFieldPath(path: string): void {
    if (!/^[A-Za-z0-9_-]+$/u.test(path)) {
        throw new Error(`低代码表单字段 path 第一版只支持顶层字段：${path}`);
    }
}

/**
 * 校验组件自己的 option 约束。
 */
function assertFieldOptions(field: Pick<LowCodeFieldDefinition, "component" | "path">, options: readonly LowCodeFieldOptionDto[]): void {
    if (field.component !== "checkbox") {
        return;
    }
    for (const option of options) {
        if (typeof option.value !== "string" && typeof option.value !== "number") {
            throw new Error(`低代码 checkbox 字段 ${field.path} 的 option value 只支持 string 或 number。`);
        }
    }
}

/**
 * 调用字段 options provider。
 */
async function resolveFieldOptions(
    options: LowCodeFieldDefinition["options"],
    ctx: LowCodeFormResolveContext,
): Promise<readonly LowCodeFieldOptionDto[]> {
    if (!options) {
        return [];
    }
    if (typeof options === "function") {
        return options(ctx);
    }
    return options;
}

/**
 * 规范化 options，保证前端拿到稳定数组。
 */
function normalizeOptions(options: readonly LowCodeFieldOptionDto[]): LowCodeFieldOptionDto[] {
    return options.map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.description ? {description: option.description} : {}),
        ...(option.disabled ? {disabled: option.disabled} : {}),
    }));
}

/**
 * 用 TypeBox 生成字段级 issue。
 */
function typeboxIssues(schema: TSchema, value: LowCodeJsonValue): LowCodeFormIssueDto[] {
    if (Value.Check(schema, value)) {
        return [];
    }
    return [...Value.Errors(schema, value)].map((issue) => ({
        path: pointerToPath(readIssuePath(issue)),
        severity: "error",
        code: "type",
        message: issue.message,
    }));
}

/**
 * TypeBox error 联合里不是所有分支都公开 path 字段，运行时按可选字段读取。
 */
function readIssuePath(issue: object): string {
    return "path" in issue && typeof issue.path === "string" ? issue.path : "";
}

/**
 * 校验选择类字段的值必须来自 options。
 */
function optionIssues(value: LowCodeJsonObject, fields: readonly LowCodeFieldDto[]): LowCodeFormIssueDto[] {
    const issues: LowCodeFormIssueDto[] = [];
    for (const field of fields) {
        if (!requiresOptionsValidation(field.component) || field.options.length === 0) {
            continue;
        }
        const current = readPath(value, field.path);
        if (current === undefined || current === null || current === "") {
            continue;
        }
        if (field.component === "checkbox") {
            issues.push(...checkboxOptionIssues(field, current));
            continue;
        }
        if (!isOptionValue(current) || !hasOptionValue(field.options, current)) {
            issues.push({
                path: field.path,
                severity: "error",
                code: "option",
                message: `字段 ${field.label} 的值不在可用选项中。`,
            });
        }
    }
    return issues;
}

/**
 * 判断组件是否需要 options 校验。
 */
function requiresOptionsValidation(component: LowCodeFieldComponentDto): boolean {
    return component === "select"
        || component === "combobox"
        || component === "radio"
        || component === "checkbox";
}

async function resolveResourcePresetField(
    field: LowCodeFieldDefinition,
    ctx: LowCodeFormResolveContext,
    defaultValue: LowCodeJsonValue | undefined,
): Promise<LowCodeResourcePresetDto> {
    if (!field.resource) {
        throw new Error(`低代码 resource-preset 字段 ${field.path} 缺少 resource resolver。`);
    }
    if (!ctx.home) {
        return disabledResourcePreset(field.resource);
    }
    const options = await listResourcePresetOptions(field.resource, ctx);
    const selected = readPath(ctx.values ?? {}, field.path) ?? defaultValue;
    const selectedKey = typeof selected === "string" ? selected : options[0]?.key;
    const contents = await Promise.all(options.map((option) => readResourcePresetContent(field.resource!, ctx, option)));
    const availableContents = contents.filter((content): content is NonNullable<LowCodeResourcePresetDto["content"]> => Boolean(content));
    const content = selectedKey ? availableContents.find((item) => item.key === selectedKey) ?? null : null;
    return {
        contentType: field.resource.contentType,
        options: options.map((option) => ({
            key: option.key,
            label: option.label,
            ...(option.description ? {description: option.description} : {}),
            ...(option.origin ? {origin: option.origin} : {}),
            editable: option.editable ?? false,
            deletable: option.deletable ?? false,
        })),
        content,
        contents: availableContents,
        ...(field.resource.template !== undefined ? {template: field.resource.template} : {}),
        ...(field.resource.createKeyPrefix !== undefined ? {createKeyPrefix: field.resource.createKeyPrefix} : {}),
        ...(field.resource.createKeySuffix !== undefined ? {createKeySuffix: field.resource.createKeySuffix} : {}),
        capabilities: {
            create: hasResourceKeyTemplate(field.resource) && Boolean(field.resource.create && field.resource.createKey),
            update: Boolean(field.resource.update),
            rename: hasResourceKeyTemplate(field.resource) && Boolean(field.resource.rename && field.resource.renameKey),
            remove: Boolean(field.resource.remove),
        },
    };
}

function disabledResourcePreset(resource: ResourcePresetDefinition): LowCodeResourcePresetDto {
    return {
        contentType: resource.contentType,
        options: [],
        content: null,
        contents: [],
        ...(resource.template !== undefined ? {template: resource.template} : {}),
        ...(resource.createKeyPrefix !== undefined ? {createKeyPrefix: resource.createKeyPrefix} : {}),
        ...(resource.createKeySuffix !== undefined ? {createKeySuffix: resource.createKeySuffix} : {}),
        capabilities: {
            create: false,
            update: false,
            rename: false,
            remove: false,
        },
    };
}

async function listResourcePresetOptions(
    resource: ResourcePresetDefinition,
    ctx: LowCodeFormResolveContext,
): Promise<Array<LowCodeResourcePresetDto["options"][number]>> {
    const optionsByKey = new Map<string, LowCodeResourcePresetDto["options"][number]>();
    const primaryOrigin = ctx.scope === "global" ? "global" as const : "project" as const;
    for (const option of await resource.list(ctx)) {
        optionsByKey.set(option.key, {
            ...option,
            origin: option.origin ?? primaryOrigin,
            editable: option.editable ?? false,
            deletable: option.deletable ?? false,
        });
    }
    if (ctx.scope === "project" && ctx.globalHome) {
        const globalCtx = resourceContextWithHome(ctx, ctx.globalHome);
        for (const option of await resource.list(globalCtx)) {
            if (optionsByKey.has(option.key)) {
                continue;
            }
            optionsByKey.set(option.key, {
                ...option,
                origin: "global",
                editable: false,
                deletable: false,
            });
        }
    }
    return [...optionsByKey.values()];
}

async function readResourcePresetContent(
    resource: ResourcePresetDefinition,
    ctx: LowCodeFormResolveContext,
    option: LowCodeResourcePresetDto["options"][number],
): Promise<LowCodeResourcePresetDto["content"]> {
    const readCtx = option.origin === "global" && ctx.scope === "project" && ctx.globalHome
        ? resourceContextWithHome(ctx, ctx.globalHome)
        : ctx;
    try {
        const content = await resource.read(readCtx, option.key);
        return {
            ...content,
            ...(option.origin ? {origin: option.origin} : {}),
        };
    } catch {
        return null;
    }
}

function resourceContextWithHome(ctx: LowCodeFormResolveContext, home: ProfileHomeFacade): LowCodeFormResolveContext {
    return {
        ...ctx,
        home,
        globalHome: undefined,
    };
}

async function resourcePresetIssues(
    value: LowCodeJsonObject,
    fields: readonly LowCodeFieldDefinition[],
    ctx: LowCodeFormResolveContext,
): Promise<LowCodeFormIssueDto[]> {
    const issues: LowCodeFormIssueDto[] = [];
    for (const field of fields) {
        if (field.component !== "resource-preset" || !field.resource) {
            continue;
        }
        if (!ctx.home && !ctx.globalHome) {
            continue;
        }
        const current = readPath(value, field.path);
        if (current === undefined || current === null || current === "") {
            continue;
        }
        if (typeof current !== "string") {
            issues.push({
                path: field.path,
                severity: "error",
                code: "resource_key",
                message: `字段 ${field.label} 必须保存资源 key。`,
            });
            continue;
        }
        const candidateKeys = [current];
        if (!current.includes("/") && field.resource.createKeyPrefix && field.resource.createKeySuffix) {
            const suffix = field.resource.createKeySuffix;
            const slug = current.endsWith(suffix) ? current.slice(0, -suffix.length) : current;
            candidateKeys.push(`${field.resource.createKeyPrefix}${slug}${suffix}`);
        }
        const uniqueCandidateKeys = [...new Set(candidateKeys)];
        const valid = await resourcePresetKeyExists(field.resource, ctx, uniqueCandidateKeys, Boolean(ctx.allowGlobalResourceKeys));
        if (!valid) {
            issues.push({
                path: field.path,
                severity: "error",
                code: "resource_key",
                message: `字段 ${field.label} 选择的资源不存在。`,
            });
        }
    }
    return issues;
}

async function resourcePresetKeyExists(
    resource: ResourcePresetDefinition,
    ctx: LowCodeFormResolveContext,
    candidateKeys: readonly string[],
    includeGlobalHome: boolean,
): Promise<boolean> {
    const mutationKeyResult = resourceMutationKeyResult(ctx, candidateKeys);
    if (mutationKeyResult !== null) {
        return mutationKeyResult;
    }
    const contexts = [
        ...(ctx.home ? [ctx] : []),
        ...(includeGlobalHome && ctx.globalHome ? [resourceContextWithHome(ctx, ctx.globalHome)] : []),
    ];
    for (const candidateCtx of contexts) {
        if (resource.validateKey) {
            for (const key of candidateKeys) {
                if (await resource.validateKey(candidateCtx, key)) {
                    return true;
                }
            }
            continue;
        }
        if ((await resource.list(candidateCtx)).some((option) => candidateKeys.includes(option.key))) {
            return true;
        }
    }
    return false;
}

function resourceMutationKeyResult(ctx: LowCodeFormResolveContext, candidateKeys: readonly string[]): boolean | null {
    if (!ctx.resourceMutationKeyView) {
        return null;
    }
    const normalizedKeys = candidateKeys.map(normalizeResourceMutationKey);
    if (!normalizedKeys.some((key) => ctx.resourceMutationKeyView!.knownKeys.has(key))) {
        return null;
    }
    return normalizedKeys.some((key) => ctx.resourceMutationKeyView!.finalKeys.has(key));
}

export async function applyLowCodeResourceMutations(
    form: LowCodeFormDefinition,
    mutations: readonly LowCodeResourceMutationDto[] | undefined,
    ctx: LowCodeFormResolveContext,
    currentValues: LowCodeJsonObject,
): Promise<LowCodeResourceMutationResult[]> {
    if (!mutations?.length) {
        return [];
    }
    const validationResults = await validateLowCodeResourceMutations(form, mutations, ctx, currentValues);
    if (validationResults.some((result) => result.issues.some((issue) => issue.severity === "error"))) {
        return validationResults;
    }
    const results: LowCodeResourceMutationResult[] = [];
    for (const mutation of mutations) {
        const field = form.fields.find((item) => item.path === mutation.fieldPath);
        if (!field?.resource) {
            continue;
        }
        try {
            await applyResourceMutation(field.resource, mutation, ctx);
            results.push({fieldPath: field.path, issues: []});
        } catch (error) {
            results.push({
                fieldPath: field.path,
                issues: [{
                    path: field.path,
                    severity: "error",
                    code: "resource_action",
                    message: error instanceof Error ? error.message : "资源操作失败。",
                }],
            });
        }
    }
    return results;
}

export async function validateLowCodeResourceMutations(
    form: LowCodeFormDefinition,
    mutations: readonly LowCodeResourceMutationDto[] | undefined,
    ctx: LowCodeFormResolveContext,
    currentValues: LowCodeJsonObject,
): Promise<LowCodeResourceMutationResult[]> {
    if (!mutations?.length) {
        return [];
    }
    const states = new Map<string, Set<string>>();
    const results: LowCodeResourceMutationResult[] = [];
    for (const mutation of mutations) {
        const field = form.fields.find((item) => item.path === mutation.fieldPath);
        if (!field || field.component !== "resource-preset" || !field.resource) {
            results.push({
                fieldPath: mutation.fieldPath,
                issues: [{path: mutation.fieldPath, severity: "error", code: "resource_field", message: "资源字段不存在。"}],
            });
            continue;
        }
        const state = await resourceKeyState(states, field.path, field.resource, ctx);
        const issue = await validateResourceMutation(field, mutation, state, currentValues, ctx);
        results.push({
            fieldPath: field.path,
            issues: issue ? [issue] : [],
            finalKeys: [...state],
        });
    }
    return results;
}

async function validateResourceMutation(
    field: LowCodeFieldDefinition,
    mutation: LowCodeResourceMutationDto,
    state: Set<string>,
    currentValues: LowCodeJsonObject,
    ctx: LowCodeFormResolveContext,
): Promise<LowCodeFormIssueDto | null> {
    if (!field.resource) {
        return {path: field.path, severity: "error", code: "resource_field", message: "资源字段不存在。"};
    }
    if (mutation.type === "create") {
        if (!field.resource.create) return {path: field.path, severity: "error", code: "resource_action", message: "该资源不支持新建。"};
        if (!hasResourceKeyTemplate(field.resource)) return {path: field.path, severity: "error", code: "resource_action", message: "该资源缺少可序列化 key 模板。"};
        if (!field.resource.createKey) return {path: field.path, severity: "error", code: "resource_action", message: "该资源缺少新建 key 预校验能力。"};
        const keyResult = await resourceCreateKey(field.resource, ctx, mutation);
        if (typeof keyResult !== "string") return {path: field.path, severity: "error", code: "resource_key", message: keyResult.message};
        const key = keyResult;
        if (state.has(key)) return {path: field.path, severity: "error", code: "resource_exists", message: `资源已存在：${key}`};
        state.add(key);
        return null;
    }
    if (mutation.type === "update") {
        if (!field.resource.update) return {path: field.path, severity: "error", code: "resource_action", message: "该资源不支持编辑。"};
        if (!state.has(normalizeResourceMutationKey(mutation.key))) return {path: field.path, severity: "error", code: "resource_missing", message: `资源不存在：${mutation.key}`};
        return null;
    }
    if (mutation.type === "rename") {
        if (!field.resource.rename) return {path: field.path, severity: "error", code: "resource_action", message: "该资源不支持重命名。"};
        if (!hasResourceKeyTemplate(field.resource)) return {path: field.path, severity: "error", code: "resource_action", message: "该资源缺少可序列化 key 模板。"};
        if (!field.resource.renameKey) return {path: field.path, severity: "error", code: "resource_action", message: "该资源缺少重命名 key 预校验能力。"};
        const oldKey = normalizeResourceMutationKey(mutation.key);
        const keyResult = await resourceRenameKey(field.resource, ctx, mutation);
        if (typeof keyResult !== "string") return {path: field.path, severity: "error", code: "resource_key", message: keyResult.message};
        const nextKey = keyResult;
        if (!state.has(oldKey)) return {path: field.path, severity: "error", code: "resource_missing", message: `资源不存在：${mutation.key}`};
        if (state.has(nextKey)) return {path: field.path, severity: "error", code: "resource_exists", message: `资源已存在：${nextKey}`};
        state.delete(oldKey);
        state.add(nextKey);
        return null;
    }
    if (!field.resource.remove) return {path: field.path, severity: "error", code: "resource_action", message: "该资源不支持删除。"};
    const key = normalizeResourceMutationKey(mutation.key);
    if (readPath(currentValues, field.path) === mutation.key) {
        return {path: field.path, severity: "error", code: "resource_in_use", message: "不能删除当前正在使用的资源。"};
    }
    if (!state.has(key)) return {path: field.path, severity: "error", code: "resource_missing", message: `资源不存在：${mutation.key}`};
    state.delete(key);
    return null;
}

async function resourceKeyState(
    states: Map<string, Set<string>>,
    fieldPath: string,
    resource: ResourcePresetDefinition,
    ctx: LowCodeFormResolveContext,
): Promise<Set<string>> {
    const cached = states.get(fieldPath);
    if (cached) {
        return cached;
    }
    const state = new Set((await resource.list(ctx)).map((option) => normalizeResourceMutationKey(option.key)));
    states.set(fieldPath, state);
    return state;
}

async function resourceCreateKey(
    resource: ResourcePresetDefinition,
    ctx: LowCodeFormResolveContext,
    mutation: Extract<LowCodeResourceMutationDto, {type: "create"}>,
): Promise<string | {message: string}> {
    try {
        return normalizeResourceMutationKey(await resource.createKey!(ctx, mutation));
    } catch (error) {
        return {message: error instanceof Error ? error.message : "资源 key 不合法。"};
    }
}

async function resourceRenameKey(
    resource: ResourcePresetDefinition,
    ctx: LowCodeFormResolveContext,
    mutation: Extract<LowCodeResourceMutationDto, {type: "rename"}>,
): Promise<string | {message: string}> {
    try {
        return normalizeResourceMutationKey(await resource.renameKey!(ctx, mutation.key, {label: mutation.label, slug: mutation.slug}));
    } catch (error) {
        return {message: error instanceof Error ? error.message : "资源 key 不合法。"};
    }
}

function normalizeResourceMutationKey(key: string): string {
    return key.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}

function hasResourceKeyTemplate(resource: ResourcePresetDefinition): boolean {
    return resource.createKeyPrefix !== undefined && resource.createKeySuffix !== undefined;
}

async function applyResourceMutation(
    resource: ResourcePresetDefinition,
    mutation: LowCodeResourceMutationDto,
    ctx: LowCodeFormResolveContext,
): Promise<void> {
    if (mutation.type === "create") {
        if (!resource.create) throw new Error("该资源不支持新建。");
        await resource.create(ctx, mutation);
        return;
    }
    if (mutation.type === "update") {
        if (!resource.update) throw new Error("该资源不支持编辑。");
        await resource.update(ctx, mutation.key, {
            ...(mutation.label !== undefined ? {label: mutation.label} : {}),
            ...(mutation.content !== undefined ? {content: mutation.content} : {}),
        });
        return;
    }
    if (mutation.type === "rename") {
        if (!resource.rename) throw new Error("该资源不支持重命名。");
        await resource.rename(ctx, mutation.key, {label: mutation.label, slug: mutation.slug});
        return;
    }
    if (!resource.remove) throw new Error("该资源不支持删除。");
    await resource.remove(ctx, mutation.key);
}

/**
 * 校验 checkbox 数组值。
 */
function checkboxOptionIssues(field: LowCodeFieldDto, value: LowCodeJsonValue): LowCodeFormIssueDto[] {
    if (!Array.isArray(value)) {
        return [{
            path: field.path,
            severity: "error",
            code: "option",
            message: `字段 ${field.label} 必须是数组。`,
        }];
    }
    return value.flatMap((item) => {
        if (!isCheckboxOptionValue(item) || !hasOptionValue(field.options, item)) {
            return [{
                path: field.path,
                severity: "error" as const,
                code: "option",
                message: `字段 ${field.label} 包含不可用选项。`,
            }];
        }
        return [];
    });
}

/**
 * 判断值是否能作为单选 option value。
 */
function isOptionValue(value: LowCodeJsonValue): value is LowCodeFieldOptionValueDto {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * 判断值是否能作为 checkbox option value。
 */
function isCheckboxOptionValue(value: LowCodeJsonValue): value is string | number {
    return typeof value === "string" || typeof value === "number";
}

/**
 * 判断 option 列表中是否包含指定值。
 */
function hasOptionValue(options: readonly LowCodeFieldOptionDto[], value: LowCodeFieldOptionValueDto): boolean {
    return options.some((option) => option.value === value);
}

/**
 * 用点路径读取对象字段。
 */
function readPath(value: LowCodeJsonObject, path: string): LowCodeJsonValue | undefined {
    const segments = path.split(".").filter(Boolean);
    let current: LowCodeJsonValue | undefined = value;
    for (const segment of segments) {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}

/**
 * 合并 settings patch。只保留 defaults 声明过的顶层 key：
 * 表单字段下线后，旧存档里残留的 key 会被直接忽略，而不是触发
 * additionalProperties 校验失败导致整份 settings 回退默认或保存被拒。
 */
function mergeSettings(defaults: LowCodeJsonObject, patch: LowCodeJsonObject | undefined): LowCodeJsonObject {
    const merged = cloneJsonObject(defaults);
    if (!patch) {
        return merged;
    }
    const clonedPatch = cloneJsonObject(patch);
    for (const key of Object.keys(merged)) {
        // JSON 值不可能为 undefined；非 undefined 即代表 patch 携带了该键，兼替代索引签名下无法收窄的 hasOwn。
        const patchValue = clonedPatch[key];
        if (patchValue !== undefined) {
            merged[key] = patchValue;
        }
    }
    return merged;
}

/**
 * 克隆 JSON 对象，避免调用方共享引用。
 */
function cloneJsonObject(value: LowCodeJsonObject): LowCodeJsonObject {
    return JSON.parse(JSON.stringify(value)) as LowCodeJsonObject;
}

/**
 * 将 JSON pointer 转成低代码字段路径。
 */
function pointerToPath(pointer: string): string {
    return pointer
        .replace(/^\//u, "")
        .split("/")
        .filter(Boolean)
        .map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"))
        .join(".");
}
