// Portions (c) Microsoft Corp.

'use strict';

const child_process = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// This is a needed workaround because electron-builder is discarding the
// node_modules of the dependencies and that was making the app fail.
exports.default = async context => {
  let dest = path.join(context.appOutDir, 'resources/app/node_modules');

  if (context.electronPlatformName === 'darwin') {
    // Downstream: rename macOS app bundle for AKS desktop branding
    dest = path.join(context.appOutDir, 'AKS Desktop.app/Contents/Resources/app/node_modules');
  }

  try {
    fs.cpSync('./prod_deps/node_modules', dest, { recursive: true });
  } catch (err) {
    console.error('Failed to copy node_modules after pack:', err);
  }

  // Mac has a problem with symlinks in the node_modules directory, so we replace them.
  if (context.electronPlatformName === 'darwin') {
    const tmpNodeModules = dest + '.tmp';

    // Copy the node_modules directory to a temporary location, replacing any symlinks with the files they point to
    child_process.spawnSync('rsync', [
      '--archive',
      '--verbose',
      '--copy-links',
      dest + '/',
      tmpNodeModules,
    ]);

    // Remove the original node_modules directory
    fs.rmSync(dest, { recursive: true, force: true });

    // Move the copied directory back to the original location
    fs.renameSync(tmpNodeModules, dest);
  }

  if (fs.existsSync('.env')) {
    console.info('Copying .env file to app resources directory!');
    try {
      fs.copyFileSync('.env', path.join(context.appOutDir, 'resources', '.env'));
    } catch (err) {
      console.error('Failed to copy .env after pack:', err);
    }
  }

  // Run post-build verification to ensure external tools are bundled correctly
  console.log('\n========================================');
  console.log('Running post-build verification tests...');
  console.log('========================================\n');

  const verifyScript = path.join(__dirname, '../../../build/verify-bundled-tools.ts');

  if (fs.existsSync(verifyScript)) {
    try {
      // Run the verification script using tsx
      const result = child_process.spawnSync('npx', ['--yes', 'tsx', verifyScript], {
        stdio: 'inherit',
        cwd: path.join(__dirname, '../../..'),
        shell: true,
      });

      if (result.status !== 0) {
        console.error('\n❌ Post-build verification FAILED!');
        console.error('The bundled external tools are not correctly configured.');
        process.exit(1);
      }

      console.log('\n✅ Post-build verification PASSED!');
    } catch (err) {
      console.error('Failed to run post-build verification:', err);
      console.error('⚠️  Continuing build, but external tools may not be bundled correctly.');
    }
  } else {
    console.warn('⚠️  Post-build verification script not found at:', verifyScript);
    console.warn('Skipping verification. External tools may not be bundled correctly.');
  }
};
