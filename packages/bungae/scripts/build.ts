import { platform } from 'os';

import { $ } from 'bun';

async function main() {
  // Run bunup
  await $`bunup`;

  // Only run chmod on non-Windows platforms
  if (platform() !== 'win32') {
    await $`chmod +x dist/cli.cjs`;
  }
}

main().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
