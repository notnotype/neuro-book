import {readBody} from "h3";
import {AgentComposerDraftStore} from "nbook/server/agent/drafts/agent-composer-draft-store";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {AgentComposerDraftMigrationRequestSchema} from "nbook/shared/dto/agent-composer-draft.dto";

/** 首次加载时批量接收旧 WebView localStorage 草稿。 */
export default defineEventHandler(async (event) => {
    const body = AgentComposerDraftMigrationRequestSchema.parse(await readBody(event));
    return await new AgentComposerDraftStore(runtimePathsFromEnv().userNbookRoot).migrate(body.drafts);
});
