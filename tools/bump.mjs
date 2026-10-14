#!/usr/bin/env node
/**
 * tools/bump.mjs — bump logogen version and regenerate assets.
 * Usage: node tools/bump.mjs [new-version]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..');
const versionFile = resolve(repoRoot, 'version.json');

const versionData  = JSON.parse(readFileSync(versionFile, 'utf-8'));
const currentVersion = versionData.version || '2026.10.13';

// Default: bump calver to today
function todayCalver() {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

async function askVersion() {
  const arg = process.argv[2];
  if (arg && !arg.startsWith('-')) return arg;
  if (!process.stdin.isTTY) return todayCalver();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    rl.question(`Current: ${currentVersion}\nNew version [default: ${todayCalver()}]: `, ans => {
      rl.close(); res(ans.trim() || todayCalver());
    });
  });
}

const newVersion = await askVersion();

versionData.version = newVersion;
versionData.date = new Date().toISOString().slice(0, 10);
writeFileSync(versionFile, JSON.stringify(versionData, null, 2) + '\n');
console.log(`✓ Updated version.json to ${newVersion}`);

console.log('Generating logo and badge...');
execFileSync('node', [resolve(__dirname, 'generate_logo.mjs')], { stdio: 'inherit' });

execFileSync('git', ['add', 'version.json', 'public/logo.svg', 'public/logo.png', 'public/badge.svg'], { cwd: repoRoot, stdio: 'inherit' });
execFileSync('git', ['commit', '-m', `chore(release): v${newVersion}`], { cwd: repoRoot, stdio: 'inherit' });
console.log(`\n🎉 Bumped and committed v${newVersion}! Run 'git push' to publish.`);
