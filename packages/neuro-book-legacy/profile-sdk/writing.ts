import {
    buildWritingReference as buildWritingReferenceHost,
    DEFAULT_WRITING_REFERENCE_PRESET as defaultWritingReferencePresetHost,
    homeReferenceKeyToLegacyKey as homeReferenceKeyToLegacyKeyHost,
    legacyReferenceKeyToHomeKey as legacyReferenceKeyToHomeKeyHost,
    loadWritingReferencePresets as loadWritingReferencePresetsHost,
    normalizeReferenceHomeKey as normalizeReferenceHomeKeyHost,
} from "nbook/server/agent/profiles/writer-writing-reference";
import {
    buildWritingStyle as buildWritingStyleHost,
    DEFAULT_WRITING_STYLE_PRESET as defaultWritingStylePresetHost,
    homeStyleKeyToLegacyKey as homeStyleKeyToLegacyKeyHost,
    legacyStyleKeyToHomeKey as legacyStyleKeyToHomeKeyHost,
    loadWritingStylePresets as loadWritingStylePresetsHost,
    normalizeStyleHomeKey as normalizeStyleHomeKeyHost,
} from "nbook/server/agent/profiles/writer-writing-style";
import type {
    ProfileHomeFacade,
    WritingReferenceDefinition,
    WritingReferencePreset,
    WritingStyleDefinition,
    WritingStylePreset,
} from "nbook/profile-sdk/contracts";

export const DEFAULT_WRITING_REFERENCE_PRESET: string = defaultWritingReferencePresetHost;
export const DEFAULT_WRITING_STYLE_PRESET: string = defaultWritingStylePresetHost;

/** 把旧 writing reference key 映射到 Profile Home。 */
export function legacyReferenceKeyToHomeKey(key: string): string {
    return legacyReferenceKeyToHomeKeyHost(key);
}

/** 把 Profile Home writing reference key 映射到旧 key。 */
export function homeReferenceKeyToLegacyKey(key: string): string {
    return homeReferenceKeyToLegacyKeyHost(key);
}

/** 规范化 writing reference 的 Profile Home key。 */
export function normalizeReferenceHomeKey(key: string): string {
    return normalizeReferenceHomeKeyHost(key);
}

/** 把旧 writing style key 映射到 Profile Home。 */
export function legacyStyleKeyToHomeKey(key: string): string {
    return legacyStyleKeyToHomeKeyHost(key);
}

/** 把 Profile Home writing style key 映射到旧 key。 */
export function homeStyleKeyToLegacyKey(key: string): string {
    return homeStyleKeyToLegacyKeyHost(key);
}

/** 规范化 writing style 的 Profile Home key。 */
export function normalizeStyleHomeKey(key: string): string {
    return normalizeStyleHomeKeyHost(key);
}

/** 读取宿主提供的 writing reference 资源。 */
export async function loadWritingReferencePresets(candidates?: readonly string[]): Promise<WritingReferenceDefinition[]> {
    return loadWritingReferencePresetsHost(candidates);
}

/** 构造 writing reference 提示词。 */
export async function buildWritingReference(input: {preset?: WritingReferencePreset; home?: ProfileHomeFacade} = {}): Promise<string> {
    return buildWritingReferenceHost(input);
}

/** 读取宿主提供的 writing style 资源。 */
export async function loadWritingStylePresets(candidates?: readonly string[]): Promise<WritingStyleDefinition[]> {
    return loadWritingStylePresetsHost(candidates);
}

/** 构造 writing style 提示词。 */
export async function buildWritingStyle(input: {preset?: WritingStylePreset; home?: ProfileHomeFacade} = {}): Promise<string> {
    return buildWritingStyleHost(input);
}
