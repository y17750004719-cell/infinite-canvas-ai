import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectNativeCodexSource, nativeCodexLock, sha256File } from './native-codex-preflight.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] && resolve(process.argv[2]);
const toolchain = process.argv[3] && resolve(process.argv[3]);
if (!source || !toolchain) throw new Error('Usage: node scripts/build-native-codex.mjs <independent-source-root> <rust-toolchain-bin>');
inspectNativeCodexSource(source);
const rust = execFileSync(join(toolchain, 'rustc'), ['--version'], { encoding: 'utf8' }).trim();
if (!rust.startsWith(`rustc ${nativeCodexLock.rustVersion} `)) throw new Error('native_rust_version_mismatch');
const runtimeRoot = join(project, 'runtime', 'native-codex');
await mkdir(runtimeRoot, { recursive: true });
const target = join(runtimeRoot, 'target');
const cargo = spawn(join(toolchain, 'cargo'), ['build', '--locked', '-p', nativeCodexLock.package, '--bin', nativeCodexLock.binary], {
  cwd: join(source, 'codex-rs'), stdio: 'inherit', shell: false,
  env: { PATH: `${toolchain}:/usr/bin:/bin:/usr/sbin:/sbin`, CARGO_HOME: join(runtimeRoot, 'cargo'),
    CARGO_TARGET_DIR: target, CARGO_BUILD_JOBS: '4', CARGO_PROFILE_DEV_DEBUG: '0' },
});
const exitCode = await new Promise((resolveExit, reject) => {
  cargo.once('error', reject);
  cargo.once('exit', (code) => resolveExit(code));
});
if (exitCode !== 0) throw new Error('native_build_failed');
inspectNativeCodexSource(source);
const binaryPath = join(target, 'debug', nativeCodexLock.binary);
await copyFile(join(source, 'LICENSE'), join(runtimeRoot, 'LICENSE'));
const manifest = { ...nativeCodexLock, binaryPath, binarySha256: sha256File(binaryPath), rust, builtAt: new Date().toISOString() };
await writeFile(join(runtimeRoot, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(manifest, null, 2));
