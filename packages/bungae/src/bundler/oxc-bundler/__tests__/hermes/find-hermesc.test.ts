import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { findHermesc } from '../../hermes/find-hermesc';

describe('findHermesc', () => {
  const testDir = join(tmpdir(), 'bungae-hermesc-test');

  it('should return null when react-native is not installed', () => {
    const result = findHermesc('/nonexistent/path');
    expect(result).toBeNull();
  });

  it('should find hermesc in react-native SDK path', () => {
    // Create fake react-native structure with hermesc
    const rnDir = join(testDir, 'node_modules', 'react-native');
    const platform = process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'win64' : 'linux64';
    const hermescDir = join(rnDir, 'sdks', 'hermesc', `${platform}-bin`);

    mkdirSync(hermescDir, { recursive: true });
    writeFileSync(join(rnDir, 'package.json'), '{"name": "react-native", "version": "0.83.0"}');
    writeFileSync(join(hermescDir, 'hermesc'), '#!/bin/bash\necho "hermesc"');
    chmodSync(join(hermescDir, 'hermesc'), 0o755);

    const result = findHermesc(testDir);
    expect(result).toBe(join(hermescDir, 'hermesc'));

    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return null when hermesc binary does not exist', () => {
    // Create fake react-native without hermesc
    const rnDir = join(testDir, 'node_modules', 'react-native');
    mkdirSync(rnDir, { recursive: true });
    writeFileSync(join(rnDir, 'package.json'), '{"name": "react-native", "version": "0.83.0"}');

    const result = findHermesc(testDir);
    expect(result).toBeNull();

    rmSync(testDir, { recursive: true, force: true });
  });
});
