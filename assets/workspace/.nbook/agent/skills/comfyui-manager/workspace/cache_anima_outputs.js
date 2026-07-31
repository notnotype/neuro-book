const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readJsonOrNull, resolveRuntimeRoot, stripBom } = require('./runtime_utils');

const workspace = __dirname;
const runtimeRoot = resolveRuntimeRoot(workspace);
const defaultWorkflowId = 'local/anima-txt2img-aesthetic-lora';
const workflowId = argValue('--workflow-id', defaultWorkflowId);
const workflowName = workflowNameFromId(workflowId);
const historyDir = path.join(runtimeRoot, 'history', workflowName);
const manifestPath = argValue('--manifest');

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function workflowNameFromId(value) {
  const parts = String(value || '').split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : defaultWorkflowId.split('/').pop();
}

function normalizeDate(value) {
  return String(value || '').replace(/[^\d-]/g, '').slice(0, 10);
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromAnimaPath(value) {
  const match = /(?:^|[\\/])anima[\\/](\d{4}-\d{2}-\d{2})(?:[\\/]|$)/i.exec(String(value || ''));
  return match ? match[1] : '';
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return readJsonOrNull(file);
}

function serverOutputRoots() {
  const roots = [];
  const configured = findOutputRoot();
  if (configured) roots.push(configured);
  const mainPy = comfyuiMainPathFromStatus();
  if (mainPy) {
    const comfyuiRoot = path.dirname(mainPy);
    const outputArg = comfyuiOutputArgFromStatus();
    if (outputArg) {
      roots.push(path.resolve(comfyuiRoot, outputArg));
    }
    roots.push(path.join(comfyuiRoot, 'output'));
  }
  return [...new Set(roots.map((item) => path.resolve(item)))];
}

function serverStatus() {
  try {
    const raw = execFileSync('comfyui-skill', ['--json', '--dir', workspace, 'server', 'status'], {
      cwd: workspace,
      encoding: 'utf8',
      env: process.env,
      timeout: 120000,
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function promptStatus(promptId) {
  const raw = execFileSync('comfyui-skill', ['--json', '--dir', workspace, 'status', promptId], {
    cwd: workspace,
    encoding: 'utf8',
    env: process.env,
    timeout: 120000,
  });
  return JSON.parse(stripBom(raw));
}

function comfyuiArgv() {
  const status = serverStatus();
  return status && status.data && status.data.system && Array.isArray(status.data.system.argv)
    ? status.data.system.argv
    : [];
}

function comfyuiMainPathFromStatus() {
  return comfyuiArgv().find((item) => /(?:^|[\\/])main\.py$/i.test(String(item || ''))) || '';
}

function comfyuiOutputArgFromStatus() {
  const argv = comfyuiArgv();
  const index = argv.findIndex((item) => ['--output-directory', '--output_dir', '--output-dir'].includes(String(item || '')));
  return index >= 0 && argv[index + 1] ? String(argv[index + 1]) : '';
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function cacheImage(source, imageCachePath) {
  if (path.resolve(source).toLowerCase() === path.resolve(imageCachePath).toLowerCase()) {
    return 'same-path';
  }
  if (fs.existsSync(imageCachePath)) {
    return 'exists';
  }
  try {
    fs.linkSync(source, imageCachePath);
    return 'hardlink';
  } catch {
    fs.copyFileSync(source, imageCachePath);
    return 'copy';
  }
}

function findOutputRoot() {
  const fromArg = argValue('--output-root');
  if (fromArg) return path.resolve(fromArg);
  if (process.env.COMFYUI_OUTPUT_DIR) return path.resolve(process.env.COMFYUI_OUTPUT_DIR);

  const config = readJson(path.join(workspace, 'config.json'));
  const configuredOutputs = Array.isArray(config && config.servers)
    ? config.servers.map((server) => server && server.output_dir).filter(Boolean)
    : [];
  const candidates = [
    path.join(runtimeRoot, 'outputs'),
    ...configuredOutputs.map((outputDir) => path.resolve(workspace, outputDir)),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const runtimeOutputs = path.join(runtimeRoot, 'outputs');
  mkdirp(runtimeOutputs);
  return runtimeOutputs;
}

function outputPath(outputRoot, preview) {
  const subfolder = preview.subfolder ? String(preview.subfolder) : '';
  return path.join(outputRoot, subfolder, preview.filename);
}

function normalizeCompletedStatus(status) {
  return ['success', 'completed'].includes(String(status || '').toLowerCase()) ? 'completed' : String(status || '');
}

function previewFromLocalOutput(output) {
  if (!output || !output.filename) return null;
  return {
    filename: output.filename,
    subfolder: output.subfolder || '',
    type: output.type || 'output',
    media_type: output.media_type || 'image',
    local_path: output.local_path || '',
  };
}

function jobsFromLocalHistory() {
  if (!fs.existsSync(historyDir)) return [];
  return fs.readdirSync(historyDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const localHistoryPath = path.join(historyDir, name);
      const localHistory = readJson(localHistoryPath);
      const output = localHistory && Array.isArray(localHistory.outputs)
        ? localHistory.outputs.find((item) => item && item.media_type === 'image' && item.filename)
        : null;
      return {
        id: (localHistory && (localHistory.prompt_id || localHistory.run_id)) || path.basename(name, '.json'),
        status: normalizeCompletedStatus(localHistory && localHistory.status),
        preview_output: previewFromLocalOutput(output),
        local_history_path: localHistoryPath,
      };
    });
}

function jobsFromManifest(file) {
  const manifest = readJson(path.resolve(workspace, file));
  const items = Array.isArray(manifest) ? manifest : [];
  return items.flatMap((item) => {
    const promptId = item && item.prompt_id;
    if (!promptId) {
      return [{ id: '', status: 'failed', preview_output: null, reason: 'missing prompt_id' }];
    }
    let rawStatus;
    try {
      rawStatus = promptStatus(promptId);
    } catch (error) {
      return [{
        id: promptId,
        prompt_id: promptId,
        status: 'failed',
        preview_output: null,
        reason: error && error.message ? error.message : String(error),
      }];
    }
    const status = rawStatus && rawStatus.data ? rawStatus.data : rawStatus;
    const outputs = status && Array.isArray(status.outputs)
      ? status.outputs.filter((entry) => entry && entry.media_type === 'image' && entry.filename)
      : null;
    if (!outputs || outputs.length === 0) {
      return [{
        id: promptId,
        prompt_id: promptId,
        status: normalizeCompletedStatus(status && status.status),
        preview_output: null,
        reason: 'missing image outputs',
      }];
    }
    return outputs.map((output, index) => ({
      id: outputs.length === 1 ? promptId : `${promptId}-${index + 1}`,
      prompt_id: promptId,
      status: normalizeCompletedStatus(status && status.status),
      preview_output: previewFromLocalOutput(output),
      args_file: item.args_file || '',
      workflow_id: item.workflow_id || workflowId,
    }));
  });
}

function cacheOne(job, outputRoot) {
  const preview = job.preview_output;
  if (!preview || !preview.filename) {
    return { id: job.id, cached: false, reason: 'missing preview_output' };
  }

  const source = resolveSourcePath(outputRoot, preview);
  if (!fs.existsSync(source)) {
    return { id: job.id, cached: false, reason: `source not found: ${source}` };
  }

  const dateFromSubfolder = dateFromAnimaPath(preview.subfolder);
  const dateFromSource = dateFromAnimaPath(source);
  const date = normalizeDate(argValue('--date')) || dateFromSubfolder || dateFromSource || localDateString();
  const cacheDir = path.join(runtimeRoot, 'cache', 'anima', date);
  mkdirp(cacheDir);

  const imageCachePath = path.join(cacheDir, preview.filename);
  const cache_mode = cacheImage(source, imageCachePath);

  const localHistoryPath = job.local_history_path || path.join(historyDir, `${job.id}.json`);
  const localHistory = readJson(localHistoryPath);
  const manifestArgs = job.args_file ? readJson(path.resolve(workspace, job.args_file)) : null;
  const args = manifestArgs || (localHistory && localHistory.args) || {};
  const stem = path.basename(preview.filename, path.extname(preview.filename));
  const argsPath = path.join(cacheDir, `${stem}.args.json`);
  const manifestPath = path.join(cacheDir, `${stem}.manifest.json`);

  writeJson(argsPath, args);
  writeJson(manifestPath, {
    workflow_id: job.workflow_id || workflowId,
    prompt_id: job.prompt_id || job.id,
    status: job.status,
    source_local_path: source,
    cache_local_path: imageCachePath,
    cache_mode,
    args_path: argsPath,
    filename_prefix: args.filename_prefix || '',
    created_at: new Date().toISOString(),
    preview_output: preview,
    local_history_path: fs.existsSync(localHistoryPath) ? localHistoryPath : '',
  });

  return { id: job.id, cached: true, cache_local_path: imageCachePath, args_path: argsPath, manifest_path: manifestPath };
}

function resolveSourcePath(outputRoot, preview) {
  const candidates = [];
  if (preview.local_path) candidates.push(path.resolve(preview.local_path));
  candidates.push(outputPath(outputRoot, preview));
  for (const root of serverOutputRoots()) {
    candidates.push(outputPath(root, preview));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function main() {
  const limit = Number.parseInt(argValue('--limit', '50'), 10) || 50;
  const outputRoot = findOutputRoot();
  let jobs = manifestPath ? jobsFromManifest(manifestPath) : jobsFromLocalHistory()
    .filter((job) => job.status === 'completed')
    .sort((a, b) => {
      const aTime = fs.statSync(a.local_history_path).mtimeMs;
      const bTime = fs.statSync(b.local_history_path).mtimeMs;
      return bTime - aTime;
    })
    .slice(0, limit);

  if (!manifestPath && jobs.length === 0) {
    const raw = execFileSync('comfyui-skill', ['--json', '--dir', workspace, 'history', 'list', workflowId, '--server', '--limit', String(limit)], {
      cwd: workspace,
      encoding: 'utf8',
      env: process.env,
    });
    const data = JSON.parse(raw);
    jobs = Array.isArray(data.jobs) ? data.jobs.filter((job) => job.status === 'completed') : [];
  }
  const results = jobs.map((job) => {
    if (job.status !== 'completed') {
      return { id: job.id, prompt_id: job.prompt_id || job.id, cached: false, reason: job.reason || `not completed: ${job.status}` };
    }
    try {
      return cacheOne(job, outputRoot);
    } catch (error) {
      return {
        id: job.id,
        prompt_id: job.prompt_id || job.id,
        cached: false,
        reason: error && error.message ? error.message : String(error),
      };
    }
  });
  const completedSeen = jobs.filter((job) => job.status === 'completed').length;
  console.log(JSON.stringify({
    workflow_id: workflowId,
    workflow_name: workflowName,
    output_root: outputRoot,
    total_completed_seen: completedSeen,
    cached: results.filter((item) => item.cached).length,
    failed: results.filter((item) => !item.cached).length,
    results,
  }, null, 2));
}

main();
