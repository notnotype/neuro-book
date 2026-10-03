import {readBody} from "h3";
import {AgentComposerDraftStore} from "nbook/server/agent/drafts/agent-composer-draft-store";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {AgentComposerDraftIdentitySchema} from "nbook/shared/dto/agent-composer-draft.dto";

/** 在用户消息已 accepted 后删除对应 Composer 草稿。 */
export default defineEventHandler(async (event) => {
    const identity = AgentComposerDraftIdentitySchema.parse(await readBody(event));
    await new AgentComposerDraftStore(runtimePathsFromEnv().userNbookRoot).clear(identity);
    return {cleared: true};
});
