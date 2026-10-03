import path from "node:path";
import {fileURLToPath} from "node:url";
import {
    compileProfileArtifacts,
    compileVariableDefinitions,
    generateProfileVariableIdeTypes,
    PROFILE_VARIABLE_IDE_TYPES_FILE,
} from "@notnotype/neuro-book/build";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {resolveVariableDefinitionArtifactPathContext} from "nbook/server/agent/variables/definition-artifact";

const applicationSourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const profileRoot = path.resolve(applicationSourceRoot, "assets", "workspace", ".nbook", "agent", "profiles");
const variableDefinitionRoot = path.resolve(applicationSourceRoot, "assets", "workspace", ".nbook", "agent", "variables");
const variableArtifactPathContext = await resolveVariableDefinitionArtifactPathContext(
    variableDefinitionRoot,
    "assets/workspace/.nbook/agent/variables",
    applicationSourceRoot,
);
await compileVariableDefinitions({
    definitionRoot: variableDefinitionRoot,
    artifactPathContext: variableArtifactPathContext,
    skipFresh: true,
});
const profileArtifactPathContext = await resolveProfileArtifactPathContext(
    profileRoot,
    "assets/workspace/.nbook/agent/profiles",
    applicationSourceRoot,
);
await compileProfileArtifacts({
    profileRoot,
    artifactPathContext: profileArtifactPathContext,
    skipFresh: true,
});

const ideTypes = await generateProfileVariableIdeTypes({
    outputPath: path.resolve(process.cwd(), PROFILE_VARIABLE_IDE_TYPES_FILE),
    variableDefinitionRoots: [{root: variableDefinitionRoot, artifactPathContext: variableArtifactPathContext}],
    profileRoots: [{root: profileRoot, artifactPathContext: profileArtifactPathContext}],
});

console.log(`generated profile variable IDE types: ${path.relative(process.cwd(), ideTypes.outputPath)} (${ideTypes.includedFiles.length} artifact type file(s))`);
