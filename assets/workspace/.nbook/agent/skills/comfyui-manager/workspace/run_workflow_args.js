const { execFileSync } = require("child_process");
const { randomInt } = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  readJsonFile,
  resolveRuntimeRoot,
  stripBom,
} = require("./runtime_utils");

function usage() {
  console.error(
    "Usage: node run_workflow_args.js <run|submit|validate> <workflow_id> <args_json_file> [extra_comfyui_skill_args...]"
  );
  console.error(
    "Example: node run_workflow_args.js run local/anima-txt2img-aesthetic-lora args/job_01.json"
  );
  console.error(
    "Example: node run_workflow_args.js submit local/anima-txt2img-aesthetic-lora args/job_01.json --priority -1"
  );
  console.error(
    "Example: node run_workflow_args.js validate local/anima-txt2img-aesthetic-lora args/job_01.json"
  );
}

const [, , mode, workflowId, argsFile, ...extraArgs] = process.argv;

if (
  !mode ||
  !workflowId ||
  !argsFile ||
  !["run", "submit", "validate"].includes(mode)
) {
  usage();
  process.exit(2);
}

const workspace = __dirname;
const resolvedArgsFile = path.resolve(workspace, argsFile);

function workflowHistoryDirs(workflowIdValue) {
  const parts = String(workflowIdValue).split(/[\\/]/).filter(Boolean);
  const provider = parts.length >= 2 ? parts[0] : "local";
  const workflowName = parts[parts.length - 1];
  return [
    {
      source: path.join(workspace, "data", provider, workflowName, "history"),
      target: path.join(resolveRuntimeRoot(workspace), "history", workflowName),
    },
  ];
}

function runComfyuiSkill(args, options = {}) {
  const raw = execFileSync(
    "comfyui-skill",
    ["--json", "--dir", workspace, ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      env: process.env,
      timeout: options.timeout || 120000,
    }
  );
  return JSON.parse(stripBom(raw));
}

function normalizeStatus(value) {
  return String(value || "").toLowerCase();
}

function isTerminalStatus(statusPayload) {
  const status = normalizeStatus(statusPayload.status);
  return [
    "success",
    "completed",
    "error",
    "failed",
    "cancelled",
    "canceled",
  ].includes(status);
}

function writeRuntimeHistory(statusPayload, workflowId, argsJson) {
  const promptId = statusPayload.prompt_id || statusPayload.id;
  if (!promptId) return;
  const targetDir = workflowHistoryDirs(workflowId)[0].target;
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, `${promptId}.json`),
    JSON.stringify(
      {
        ...statusPayload,
        workflow_id: workflowId,
        run_id: promptId,
        args: JSON.parse(argsJson),
        created_at: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
}

function hasSeed(args) {
  return Object.prototype.hasOwnProperty.call(args, "seed") && args.seed !== "";
}

function applyDefaultSeed(args) {
  if (hasSeed(args)) return args;
  return {
    ...args,
    seed: randomInt(1, 0x100000000),
  };
}

function writeEffectiveArgs(filePath, args) {
  fs.writeFileSync(filePath, JSON.stringify(args, null, 2), "utf8");
}

function runBySubmitAndPoll() {
  const submitPayload = runComfyuiSkill([
    "submit",
    workflowId,
    `--args=${argsJson}`,
    ...extraArgs,
  ]);
  const promptId = submitPayload.prompt_id || submitPayload.id;
  if (!promptId) {
    console.log(JSON.stringify(submitPayload, null, 2));
    process.exit(1);
  }

  const startedAt = Date.now();
  const timeoutMs = Number.parseInt(
    process.env.COMFYUI_SKILL_RUN_TIMEOUT_MS || "1800000",
    10
  );
  const pollMs = Number.parseInt(
    process.env.COMFYUI_SKILL_POLL_MS || "2000",
    10
  );
  let statusPayload = submitPayload;

  while (Date.now() - startedAt <= timeoutMs) {
    statusPayload = runComfyuiSkill(["status", promptId]);
    if (isTerminalStatus(statusPayload)) {
      writeRuntimeHistory(statusPayload, workflowId, argsJson);
      console.log(JSON.stringify(statusPayload, null, 2));
      const status = normalizeStatus(statusPayload.status);
      process.exit(["success", "completed"].includes(status) ? 0 : 1);
    }
    // Synchronous sleep keeps this small CLI dependency-free while polling run status.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
  }

  console.error(
    `[run_workflow_args] Timed out waiting for prompt_id: ${promptId}`
  );
  console.log(JSON.stringify(statusPayload, null, 2));
  process.exit(1);
}

let argsJson;
try {
  const args = applyDefaultSeed(readJsonFile(resolvedArgsFile));
  writeEffectiveArgs(resolvedArgsFile, args);
  argsJson = JSON.stringify(args);
} catch (error) {
  console.error(
    `[run_workflow_args] Failed to read/parse args JSON: ${resolvedArgsFile}`
  );
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
}

if (mode === "submit") {
  const submitPayload = runComfyuiSkill([
    "submit",
    workflowId,
    `--args=${argsJson}`,
    ...extraArgs,
  ]);
  console.log(JSON.stringify(submitPayload, null, 2));
} else if (mode === "validate") {
  const validatePayload = runComfyuiSkill([
    "run",
    workflowId,
    "--validate",
    `--args=${argsJson}`,
    ...extraArgs,
  ]);
  console.log(JSON.stringify(validatePayload, null, 2));
} else {
  runBySubmitAndPoll();
}
