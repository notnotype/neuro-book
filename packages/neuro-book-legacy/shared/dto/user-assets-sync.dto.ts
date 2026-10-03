import {z} from "zod";

export const UserAssetsProfileSyncWarningDtoSchema = z.object({
    fileName: z.string(),
    profileKey: z.string(),
    message: z.string(),
});

export const UserAssetsAssetSyncWarningDtoSchema = z.object({
    assetPath: z.string(),
    message: z.string(),
});

export const UserAssetsSyncResultDtoSchema = z.object({
    copied: z.number(),
    skipped: z.number(),
    updatedProfiles: z.number().optional(),
    profileWarnings: z.array(UserAssetsProfileSyncWarningDtoSchema).optional(),
    updatedAssets: z.number().optional(),
    assetWarnings: z.array(UserAssetsAssetSyncWarningDtoSchema).optional(),
});

export const UserAssetsSyncConflictKindDtoSchema = z.enum(["profile", "asset"]);
export const UserAssetsSyncConflictReasonDtoSchema = z.enum(["missing", "binary", "too_large"]);

export const UserAssetsSyncConflictDetailDtoSchema = z.object({
    kind: UserAssetsSyncConflictKindDtoSchema,
    fileName: z.string().optional(),
    assetPath: z.string().optional(),
    label: z.string(),
    systemContent: z.string(),
    userContent: z.string(),
    baseContent: z.string().optional(),
    language: z.string(),
    systemSha256: z.string(),
    userSha256: z.string(),
    systemBytes: z.number(),
    userBytes: z.number(),
    lastSyncedUserHash: z.string().optional(),
    upstreamHash: z.string().optional(),
    diffable: z.boolean().default(true),
    reason: UserAssetsSyncConflictReasonDtoSchema.optional(),
});

export type UserAssetsProfileSyncWarningDto = z.infer<typeof UserAssetsProfileSyncWarningDtoSchema>;
export type UserAssetsAssetSyncWarningDto = z.infer<typeof UserAssetsAssetSyncWarningDtoSchema>;
export type UserAssetsSyncResultDto = z.infer<typeof UserAssetsSyncResultDtoSchema>;
export type UserAssetsSyncConflictKindDto = z.infer<typeof UserAssetsSyncConflictKindDtoSchema>;
export type UserAssetsSyncConflictReasonDto = z.infer<typeof UserAssetsSyncConflictReasonDtoSchema>;
export type UserAssetsSyncConflictDetailDto = z.infer<typeof UserAssetsSyncConflictDetailDtoSchema>;
