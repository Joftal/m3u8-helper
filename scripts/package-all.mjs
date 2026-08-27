import { spawnSync } from 'node:child_process';

function runNpmScript(scriptName) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['run', scriptName], {
    stdio: 'inherit',
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.platform === 'win32') {
  console.log('[package:all] Windows detected: building Windows target only.');
  console.log('[package:all] macOS target is skipped on Windows.');
  runNpmScript('package:win');
  process.exit(0);
}

if (process.platform === 'darwin') {
  console.log('[package:all] macOS detected: building macOS target only.');
  console.log('[package:all] Windows target is skipped on macOS by default.');
  runNpmScript('package:mac');
  process.exit(0);
}

console.log('[package:all] Unsupported host platform. No package target was executed.');
process.exit(1);
