const fs = require('fs');
const path = require('path');

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function readJsonFile(filePath) {
  return JSON.parse(stripBom(fs.readFileSync(filePath, 'utf8')));
}

function readJsonOrNull(filePath) {
  try {
    return readJsonFile(filePath);
  } catch {
    return null;
  }
}

function findExistingRuntimeRoot(start, runtimeName) {
  let cursor = path.resolve(start);
  while (cursor) {
    const root = path.join(cursor, 'runtime');
    if (fs.existsSync(root)) return path.join(root, runtimeName);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return '';
}

function resolveRuntimeFromConfig(workspace) {
  const configPath = path.join(workspace, 'config.json');
  if (!fs.existsSync(configPath)) return '';
  try {
    const config = readJsonFile(configPath);
    const server = Array.isArray(config.servers) ? config.servers.find((item) => item && item.output_dir) : null;
    if (!server) return '';
    const outputDir = path.resolve(workspace, server.output_dir);
    if (path.basename(outputDir).toLowerCase() !== 'outputs') return '';
    if (path.dirname(outputDir) === path.resolve(workspace)) {
      return path.resolve(workspace, '..', '..', 'runtime', 'comfyui-manager');
    }
    return path.dirname(outputDir);
  } catch {
    return '';
  }
}

function resolveRuntimeRoot(workspace) {
  if (process.env.COMFYUI_MANAGER_RUNTIME_DIR) {
    return path.resolve(process.env.COMFYUI_MANAGER_RUNTIME_DIR);
  }
  const runtimeRoot = process.env.SKILL_RUNTIME_ROOT;
  if (runtimeRoot) {
    return path.resolve(runtimeRoot, 'comfyui-manager');
  }
  const configRuntime = resolveRuntimeFromConfig(workspace);
  if (configRuntime) {
    return configRuntime;
  }
  const existingRuntime = findExistingRuntimeRoot(workspace, 'comfyui-manager');
  if (existingRuntime) {
    return existingRuntime;
  }
  return path.resolve(workspace, '..', '..', 'runtime', 'comfyui-manager');
}

module.exports = {
  findExistingRuntimeRoot,
  readJsonFile,
  readJsonOrNull,
  resolveRuntimeFromConfig,
  resolveRuntimeRoot,
  stripBom,
};
