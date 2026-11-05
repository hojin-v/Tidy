// Read-only macOS probe. Never prompts for permission or moves any windows.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeBridge} from '../desktop/native-bridge.js';

if (process.platform !== 'darwin') throw new Error('Run this probe on macOS.');
const directory = mkdtempSync(join(tmpdir(), 'tidy-native-smoke-'));
const native = fileURLToPath(new URL('../desktop/native/', import.meta.url));
let bridge;
try {
    const compile = spawnSync('xcrun', ['swiftc', '-O', join(native, 'macos.swift'), '-o', join(directory, 'tidy-native')], {stdio: 'inherit'});
    assert.equal(compile.status, 0);
    bridge = new NativeBridge(directory);
    const permissions = await bridge.request('permissions', {prompt: false});
    assert.equal(typeof permissions.trusted, 'boolean');
    const state = await bridge.snapshot();
    assert.equal(typeof state.mouseDown, 'boolean');
    assert.equal(typeof state.trusted, 'boolean');
    await assert.rejects(bridge.place({id: '0', pid: 0}, {x: 0, y: 0, width: 100, height: 100}));
    console.log(`PASS: ${process.platform} native helper compile, permissions, snapshot and error protocol`);
} finally {
    await bridge?.close();
    rmSync(directory, {recursive: true, force: true});
}
