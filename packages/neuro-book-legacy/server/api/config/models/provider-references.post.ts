import {CheckProviderReferencesRequestDtoSchema, type CheckProviderReferencesRequestDto} from "nbook/shared/dto/app-settings.dto";
import {inspectProviderReferences} from "nbook/server/config/config-service";
import {validateBody} from "nbook/server/utils/novel-chapter";

/** Provider 删除前执行服务端完整引用扫描。 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<CheckProviderReferencesRequestDto>(event, CheckProviderReferencesRequestDtoSchema);
    return {references: await inspectProviderReferences(body.providerId)};
});
