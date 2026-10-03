/** @jsxImportSource nbook/profile-sdk */
/** @jsxRuntime automatic */
import {Type} from "nbook/profile-sdk";
import type {Static} from "nbook/profile-sdk";
import {defineAgentProfile} from "nbook/profile-sdk";
import {builtin, toolset} from "nbook/profile-sdk";
import {ProfilePrompt, System} from "nbook/profile-sdk";

export const profileManifest = {
    key: "__PROFILE_KEY__",
    name: "__PROFILE_NAME__",
    description: "__PROFILE_DESCRIPTION__",
} as const;

export const InitialSchema = Type.Object({});
export const OutputSchema = Type.Object({});
export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export const profileTools = toolset(
    builtin.file.read,
);

function renderSystemPrompt(): string {
    return `__SYSTEM_PROMPT__`.trim();
}

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: profileTools,
    context() {
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt()}</System>
            </ProfilePrompt>
        );
    },
});
