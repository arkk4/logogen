#!/usr/bin/env node
/**
 * tools/generate_logo.mjs
 *
 * Generates public/logo.svg, public/logo.png and public/badge.svg from version.json.
 * Uses cli/logogen.mjs directly (logogen bootstraps itself).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const logogenPath = resolve(repoRoot, 'cli', 'logogen.mjs');
const versionFile = resolve(repoRoot, 'version.json');

if (!existsSync(logogenPath)) {
  console.error(`[generate_logo] logogen not found at ${logogenPath}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(versionFile, 'utf-8'));
const name    = config.name || 'logogen';
const version = `v${config.version || '2026.10.13'}`;
const pattern = config.logo?.pattern || 'mirror';
const palette = Array.isArray(config.logo?.palette)
  ? config.logo.palette.join(',')
  : (config.logo?.palette || '#09090b,#27272a,#52525b,#a1a1aa,#e4e4e7');
const shape  = config.logo?.shape || 'squircle';
const font   = config.logo?.font  || 'mono';

const logoSvg  = resolve(repoRoot, 'public', 'logo.svg');
const logoPng  = resolve(repoRoot, 'public', 'logo.png');
const badgeOut = resolve(repoRoot, 'public', 'badge.svg');

// 1. Generate logo.svg
execFileSync('node', [logogenPath, '--name', name, '--version', version,
  '--pattern', pattern, '--palette', palette, '--shape', shape, '--font', font,
  '--out', logoSvg], { stdio: 'inherit' });

// 2. Rasterize logo.svg → logo.png (128×128, crisp)
execFileSync('rsvg-convert', ['-w', '128', '-h', '128', '-f', 'png', logoSvg, '-o', logoPng]);

// 3. Generate badge.svg
execFileSync('node', [logogenPath, '--badge', '--name', name, '--version', version,
  '--pattern', pattern, '--palette', palette, '--font', font,
  '--out', badgeOut], { stdio: 'inherit' });

console.log(`✓ Generated public/logo.svg + logo.png + badge.svg (${name} ${version})`);
