/** HTTP raw 图片、Attachment admission 与 Provider hydration 共用的产品预算。 */
export const AGENT_IMAGE_POLICY = {
    maxInputImages: 8,
    maxImageBytes: 16 * 1024 * 1024,
    maxInputBytes: 32 * 1024 * 1024,
    maxRequestBytes: 48 * 1024 * 1024,
    maxProviderBlocks: 16,
    maxProviderSourceBytes: 64 * 1024 * 1024,
} as const;
