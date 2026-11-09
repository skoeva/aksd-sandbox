// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = process.cwd();
const { verifyLinuxApp, verifyLinuxProxyHelp, withLinuxAzureConfig } = require(
  path.join(root, 'build/linux-package-verification.ts')
);
const { readAzureCliConfig, resolveAzCliVersion } = require(
  path.join(root, 'build/az-cli-config.ts')
);
const project = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const arch = process.env.AKS_NATIVE_ARCH;
assert.ok(arch === 'x64' || arch === 'arm64');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, arch, 'Native architecture must match the package');
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(source, process.env.EXPECTED_SOURCE_SHA, 'Unexpected application source revision');

interface AppProof {
  elfFiles: number;
  azureCliVersion: string;
  offlineProxyHelp: boolean;
}

interface Report {
  source: string;
  arch: string;
  formats: Record<string, AppProof>;
  guiTestsPassed: boolean;
  uninstalled: boolean;
  failure?: string;
  cleanupFailure?: string;
}

const report: Report = { source, arch, formats: {}, guiTestsPassed: false, uninstalled: false };
const output = path.join(root, 'linux-proof');
fs.mkdirSync(output, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-pr1115-install-'));
const deb = path.join(root, 'linux-packages', `aks-desktop_${project.version}-1_${arch === 'x64' ? 'amd64' : 'arm64'}.deb`);
const tarball = path.join(root, 'linux-packages', `aks-desktop-${project.version}-linux-${arch}.tar.gz`);
const packageName = execFileSync('dpkg-deb', ['-f', deb, 'Package'], { encoding: 'utf8' }).trim();
assert.equal(packageName, 'aks-desktop', 'Only the test application may be installed or removed');
const existing = spawnSync('dpkg-query', ['-W', packageName], { encoding: 'utf8' });
if (existing.error) throw existing.error;
assert.equal(existing.status, 1, 'A pre-existing installation must not be modified');

function run(command: string, args: string[], env = process.env): void {
  execFileSync(command, args, { env, stdio: 'inherit', timeout: 600_000 });
}

function findApp(payload: string): string {
  const found: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === 'app-build-manifest.json' && path.basename(dir) === 'resources') {
        found.push(path.dirname(dir));
      }
    }
  }
  walk(payload);
  assert.equal(found.length, 1, 'Payload must contain exactly one application manifest');
  return found[0];
}

function verifyRunnableApp(app: string, payload = app): AppProof {
  const inventory = verifyLinuxApp(app, arch, project.version, payload);
  const az = path.join(app, 'resources/external-tools/az-cli/linux/bin/az-wrapper');
  const versionJson = withLinuxAzureConfig(az, (env: NodeJS.ProcessEnv) =>
    execFileSync(az, ['version', '--output', 'json'], {
      env, encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
    })
  );
  const cliVersion = JSON.parse(versionJson)['azure-cli'];
  assert.equal(cliVersion, resolveAzCliVersion(readAzureCliConfig(root), 'linux'));
  const help = verifyLinuxProxyHelp(az, arch);
  assert.match(help, /az connectedk8s proxy/);
  console.log(`PASS ${app}: ${inventory.files.length} native ELF files; Azure CLI ${cliVersion}; offline proxy help`);
  return { elfFiles: inventory.files.length, azureCliVersion: cliVersion, offlineProxyHelp: true };
}

let installAttempted = false;
let installedApp: string | undefined;
const failures: unknown[] = [];
try {
  const debPayload = path.join(scratch, 'deb');
  const tarPayload = path.join(scratch, 'tar');
  fs.mkdirSync(debPayload);
  fs.mkdirSync(tarPayload);
  run('dpkg-deb', ['-x', deb, debPayload]);
  run('tar', ['-xf', tarball, '-C', tarPayload]);
  report.formats.debPayload = verifyRunnableApp(findApp(debPayload), debPayload);
  report.formats.tarball = verifyRunnableApp(findApp(tarPayload), tarPayload);

  run('sudo', ['apt-get', 'update']);
  installAttempted = true;
  run('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', 'xvfb', deb]);
  const files = execFileSync('dpkg-query', ['-L', packageName], { encoding: 'utf8' }).split('\n');
  const manifests = files.filter(file => file.endsWith('/resources/app-build-manifest.json'));
  assert.equal(manifests.length, 1);
  installedApp = path.dirname(path.dirname(manifests[0]));
  report.formats.installedDeb = verifyRunnableApp(installedApp);
  run('xvfb-run', ['--auto-servernum', 'npm', 'run', 'test:packaged-theme'], {
    ...process.env,
    AKS_DESKTOP_EXECUTABLE: path.join(installedApp, 'aks-desktop'),
  });
  report.guiTestsPassed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  failures.push(error);
  console.error(error);
} finally {
  if (installAttempted) {
    try {
      run('sudo', ['dpkg', '--purge', packageName]);
      const removed = spawnSync('dpkg-query', ['-W', packageName], { encoding: 'utf8' });
      if (removed.error) throw removed.error;
      assert.equal(removed.status, 1, 'Package registration remains after purge');
      if (installedApp) assert.equal(fs.existsSync(path.join(installedApp, 'aks-desktop')), false);
      report.uninstalled = true;
    } catch (error) {
      report.cleanupFailure = error instanceof Error ? error.message : String(error);
      failures.push(error);
      console.error(error);
    }
  }
  fs.writeFileSync(path.join(output, 'installed-package.json'), JSON.stringify(report, null, 2) + '\n');
  fs.rmSync(scratch, { recursive: true, force: true });
}
if (failures.length) throw new AggregateError(failures, 'Linux installed-package validation failed');
assert.equal(report.guiTestsPassed && report.uninstalled, true);
