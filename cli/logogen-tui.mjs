#!/usr/bin/env node
// logogen-tui.mjs — інтерактивний перегляд логотипів і GitHub-бейджів у терміналі (iTerm2 / WezTerm inline images).
// Оболонка над logogen.mjs. Лежати мають в одній теці.
// Перший «продукт» із власним логотипом: назва + версія + мале лого перед промптом.
//
//   npm i @resvg/resvg-js        # растеризатор SVG→PNG (альтернатива: brew install librsvg)
//   node logogen-tui.mjs [--name "Nebula Sync"] [--version 1.0.0|2026.01.08-3|3a4b5c6]
//        [--palette catppuccin-mocha|"#hex,#hex,..."] [--pattern classic|extra|all|<макет>]
//        [--letters auto|1|2|3|full] [--font sans|mono] [--no-outline] [--shape squircle|circle|square]
//        [--badge-style flat|flat-square] [--label-color "#555"] [--no-badges]
//        [--out-dir ./logos] [--inline|--no-inline]
//   node logogen-tui.mjs --version      # (без значення) показати мале лого + версію TUI

import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import readline from "node:readline";
import { generateLogo, makeBadge, parseVersion, PATTERNS, legibility } from "./logogen.mjs";

// версія самого TUI — calver із номером збірки (теж приклад формату версій)
const APP_NAME = "logogen";
const APP_VERSION = "2026.10.13-1";

// ---------- палітри ----------
const PRESETS = {
  // з теми azure-contrast
  azure:                ["#171c27", "#52708b", "#508aaa", "#6ab0a3", "#add3cc"],
  "azure-warm":         ["#293348", "#52708b", "#6ab0a3", "#94b8cc", "#f7b83d"],
  "azure-pop":          ["#0d1117", "#508aaa", "#6ab0a3", "#f7b83d", "#e61f44"],
  // популярні теми
  "catppuccin-latte":   ["#ccd0da", "#8839ef", "#d20f39", "#fe640b", "#1e66f5"],
  "catppuccin-frappe":  ["#303446", "#ca9ee6", "#e78284", "#ef9f76", "#8caaee"],
  "catppuccin-macchiato": ["#24273a", "#c6a0f6", "#ed8796", "#f5a97f", "#8aadf4"],
  "catppuccin-mocha":   ["#1e1e2e", "#cba6f7", "#f38ba8", "#fab387", "#89b4fa"],
  dracula:              ["#282a36", "#bd93f9", "#ff79c6", "#ffb86c", "#50fa7b"],
  nord:                 ["#2e3440", "#5e81ac", "#88c0d0", "#a3be8c", "#ebcb8b"],
  "gruvbox-dark":       ["#282828", "#fb4934", "#fabd2f", "#8ec07c", "#83a598"],
  "gruvbox-light":      ["#fbf1c7", "#9d0006", "#b57614", "#427b58", "#076678"],
  "tokyo-night":        ["#1a1b26", "#7aa2f7", "#bb9af7", "#f7768e", "#e0af68"],
  "solarized-dark":     ["#002b36", "#268bd2", "#2aa198", "#b58900", "#cb4b16"],
  "solarized-light":    ["#fdf6e3", "#268bd2", "#2aa198", "#b58900", "#dc322f"],
  "one-dark":           ["#282c34", "#61afef", "#c678dd", "#e06c75", "#98c379"],
  "rose-pine":          ["#191724", "#c4a7e7", "#eb6f92", "#f6c177", "#9ccfd8"],
  "zinc-dark":          ["#09090b", "#27272a", "#52525b", "#a1a1aa", "#e4e4e7"],
  "zinc-light":         ["#fafafa", "#e4e4e7", "#a1a1aa", "#52525b", "#18181b"],
  sunset:               ["#264653", "#2a9d8f", "#e9c46a", "#f4a261", "#e76f51"],
};
const PRESET_NAMES = Object.keys(PRESETS);
const LETTERS = ["auto", "1", "2", "3", "full"];
const SHAPES = ["squircle", "circle", "square"];
const FONTS = ["sans", "mono"];
const BADGE_STYLES = ["flat", "flat-square"];

// ---------- аргументи ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

// ---------- утиліти ----------
const pad2 = (n) => String(n).padStart(2, "0");
const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "logo";
const fileSafe = (s) => s.replace(/[^\p{L}\p{N}.\-_+]+/gu, "_");
const sha7 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 7);
const normHex = (h) => {
  h = h.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = [...h].map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(h) ? "#" + h : null;
};
function parsePalette(input) {
  if (PRESETS[input]) return { colors: PRESETS[input], label: input };
  const colors = input.split(/[\s,;]+/).filter(Boolean).map(normHex);
  if (colors.length < 2 || colors.includes(null)) return null;
  return { colors, label: "custom" };
}
const swatch = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m  \x1b[0m`;
};

// ---------- операції над версіями (semver / calver / хеш) ----------
// level: low (←/→) · mid (↑/↓) · high ([ / ])
function applyStep(vs, level, dir) {
  const p = parseVersion(vs), F = p.fields;
  if (p.kind === "semver") {
    let { major, minor, patch } = F;
    if (level === "low") patch = Math.max(0, patch + dir);
    else if (level === "mid") { minor = Math.max(0, minor + dir); if (dir > 0) patch = 0; }
    else { major = Math.max(0, major + dir); if (dir > 0) { minor = 0; patch = 0; } }
    return `${major}.${minor}.${patch}`;
  }
  if (p.kind === "calver") {
    let { y, mo, d, suffix } = F;
    const hasDay = d != null;
    const fmt = (yy, mm, dd, suf) => `${yy}.${pad2(mm)}${dd != null ? "." + pad2(dd) : ""}${suf ? "-" + suf : ""}`;
    if (level === "low") { // номер збірки
      const n = /^\d+$/.test(suffix) ? +suffix : 0;
      const nn = n + dir;
      return fmt(y, mo, d, nn > 0 ? String(nn) : "");
    }
    const monthStep = () => { const t = new Date(Date.UTC(y, mo - 1 + dir, 1)); return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, hasDay ? 1 : null, ""); };
    const yearStep = () => fmt(y + dir, hasDay ? 1 : 1, hasDay ? 1 : null, "");
    if (level === "mid") {
      if (!hasDay) return monthStep();
      const t = new Date(Date.UTC(y, mo - 1, d + dir));
      return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), "");
    }
    return hasDay ? monthStep() : yearStep(); // high
  }
  if (p.kind === "hash") return sha7(`${F.hash}:${level}:${dir}`);
  return vs; // text
}

function nextEntries(vs) {
  const p = parseVersion(vs);
  const s = (lvl, dir = 1) => applyStep(vs, lvl, dir);
  if (p.kind === "semver")
    return [
      { v: s("low"), tag: "patch" }, { v: s("mid"), tag: "minor" },
      { v: s("high"), tag: "major" }, { v: applyStep(s("high"), "high", 1), tag: "major" },
    ];
  if (p.kind === "calver") {
    const hasDay = p.fields.d != null;
    const yr = hasDay ? `${p.fields.y + 1}.01.01` : `${p.fields.y + 2}.01`;
    return [
      { v: s("low"), tag: "збірка" },
      { v: s("mid"), tag: hasDay ? "день" : "місяць" },
      { v: s("high"), tag: hasDay ? "місяць" : "рік" },
      { v: yr, tag: "рік" },
    ];
  }
  if (p.kind === "hash") return ["low", "mid", "high", "x"].map((l) => ({ v: s(l), tag: "коміт" }));
  return [];
}

const today = () => { const t = new Date(); return `${t.getFullYear()}.${pad2(t.getMonth() + 1)}.${pad2(t.getDate())}`; };
const FORMATS = ["semver", "calver", "calver-n", "hash"];
function formatId(vs) {
  const p = parseVersion(vs);
  if (p.kind === "calver") return p.fields.suffix ? "calver-n" : "calver";
  return p.kind === "text" ? "semver" : p.kind;
}
function sampleOf(fmtName) {
  switch (fmtName) {
    case "calver": return today();
    case "calver-n": return `${today()}-1`;
    case "hash": return randomBytes(4).toString("hex").slice(0, 7).replace(/^[0-9]+$/, "a" + "bcdef0"); // має містити літеру
    default: return "1.0.0";
  }
}

// ---------- стан ----------
const initPal = parsePalette(opt("palette", "catppuccin-mocha")) ?? { colors: PRESETS["catppuccin-mocha"], label: "catppuccin-mocha" };
const st = {
  name: opt("name", "Nebula Sync"),
  version: parseVersion(opt("version", "1.0.0")).label,
  palette: initPal.colors,
  paletteLabel: initPal.label,
  letters: Math.max(0, LETTERS.indexOf(opt("letters", "auto"))),
  shape: Math.max(0, SHAPES.indexOf(opt("shape", "squircle"))),
  pattern: Math.max(0, PATTERNS.indexOf(opt("pattern", "classic"))),
  font: Math.max(0, FONTS.indexOf(opt("font", "sans"))),
  outline: !flag("no-outline"),
  badgeStyle: Math.max(0, BADGE_STYLES.indexOf(opt("badge-style", "flat"))),
  labelColor: opt("label-color", "#555555"),
  badges: !flag("no-badges"),
  outDir: resolve(opt("out-dir", ".")),
};
let msg = "";

const logoOpts = (version = st.version) => ({
  name: st.name,
  version,
  palette: st.palette,
  letters: LETTERS[st.letters],
  shape: SHAPES[st.shape],
  pattern: PATTERNS[st.pattern],
  font: FONTS[st.font],
  outline: st.outline,
});

// Усе, що впливає на арт (name, version, palette, pattern), — з того самого стану, що й для логотипа.
const badgeOpts = (version = st.version) => ({
  name: st.name,
  version,
  palette: st.palette,
  pattern: PATTERNS[st.pattern],
  font: FONTS[st.font],
  outline: st.outline,
  style: BADGE_STYLES[st.badgeStyle],
  labelColor: st.labelColor,
});

// ---------- растеризація ----------
async function loadRasterizer() {
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    return (svg, width) =>
      new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true } }).render().asPng();
  } catch { /* fallthrough */ }
  const probe = spawnSync("rsvg-convert", ["--version"]);
  if (probe.status === 0)
    return (svg, width) => {
      const r = spawnSync("rsvg-convert", ["-w", String(width), "-f", "png"], { input: svg, maxBuffer: 64 << 20 });
      if (r.status !== 0) throw new Error("rsvg-convert failed");
      return r.stdout;
    };
  return null;
}

// ---------- прев'ю-аркуш: поточний великий + 4 «наступні версії» ----------
function buildSheet() {
  const nexts = nextEntries(st.version);
  const pad = 12, big = 200, sm = 96, lab = 16;
  const H = pad + 2 * (sm + lab + pad);
  const hasSmall = nexts.length > 0;
  const gx = pad + big + pad * 2;
  const W = hasSmall ? gx + 2 * sm + pad + pad : pad + big + pad;
  const place = (svg, x, y) => svg.replace("<svg ", `<svg x="${x}" y="${y}" `);
  const label = (x, y, w, t, bold) =>
    `<text x="${x + w / 2}" y="${y + 12}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" ${bold ? 'font-weight="700" fill="#e6edf3"' : 'fill="#8b949e"'}>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;

  const p = parseVersion(st.version);
  const by = (H - (big + lab)) / 2;
  let body = place(generateLogo({ ...logoOpts(), size: big }), pad, by) +
    label(pad, by + big, big, p.kind === "semver" ? `v${p.label}` : p.label, true);
  nexts.forEach((n, i) => {
    const x = gx + (i % 2) * (sm + pad), y = pad + Math.floor(i / 2) * (sm + lab + pad);
    body += place(generateLogo({ ...logoOpts(n.v), size: sm }), x, y) + label(x, y + sm, sm, `${n.v} · ${n.tag}`);
  });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`, W, H };
}

// ---------- прев'ю бейджів: поточна версія + 4 «наступні» ----------
function buildBadges() {
  const pad = 8, gap = 6;
  const items = [st.version, ...nextEntries(st.version).map((n) => n.v)];
  let y = pad, W = 0, body = "";
  for (const v of items) {
    const b = makeBadge(badgeOpts(v));
    body += b.svg.replace("<svg ", `<svg x="${pad}" y="${y}" `);
    y += b.height + gap;
    W = Math.max(W, b.width);
  }
  W += pad * 2;
  const H = y + pad - gap;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`, W, H };
}

// ---------- інлайн-графіка ----------
const inlineCapable = flag("inline") ||
  (!flag("no-inline") && (["iTerm.app", "WezTerm"].includes(process.env.TERM_PROGRAM) || process.env.LC_TERMINAL === "iTerm2"));

function inlineImage(png, { width, height } = {}) {
  const dim = height ? `height=${height}` : `width=${width}px`;
  let seq = `\x1b]1337;File=inline=1;size=${png.length};${dim};preserveAspectRatio=1:${png.toString("base64")}\x07`;
  if (process.env.TMUX) seq = `\x1bPtmux;${seq.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`; // потрібен: set -g allow-passthrough on
  return seq;
}

// ---------- власний бренд: мале лого + назва + версія (використовуємо самі себе) ----------
let rasterize = null;
let brandSeq = "";
function initBrand() {
  if (!rasterize || !inlineCapable) return;
  try {
    const svg = generateLogo({
      name: APP_NAME, version: APP_VERSION, palette: PRESETS["catppuccin-mocha"],
      pattern: "all", font: "mono", letters: "auto", size: 96,
    });
    brandSeq = inlineImage(rasterize(svg, 96), { height: 1 });
  } catch { brandSeq = ""; }
}
const brand = () => `${brandSeq}${brandSeq ? " " : ""}\x1b[1m${APP_NAME}\x1b[0m \x1b[2m${APP_VERSION}\x1b[0m`;

// ---------- малювання ----------
const out = (s) => process.stdout.write(s);

async function draw() {
  const p = parseVersion(st.version);
  let screen = "\x1b[H\x1b[2J\x1b[?25l";
  screen += ` ${brand()}\n\n`;
  screen += ` назва: \x1b[1m${st.name}\x1b[0m   версія: \x1b[1m${p.label}\x1b[0m \x1b[2m(${p.kind})\x1b[0m\n`;
  const lg = legibility(st.palette);
  const warn = !st.outline && lg < 3 ? `  \x1b[33m⚠ контраст літер ${lg.toFixed(1)} — без аутлайна можуть не читатися\x1b[0m` : "";
  screen += ` літери: ${LETTERS[st.letters]}   форма: ${SHAPES[st.shape]}   патерн: ${PATTERNS[st.pattern]}   шрифт: ${FONTS[st.font]}   аутлайн: ${st.outline ? "так" : "ні"}   бейдж: ${st.badges ? BADGE_STYLES[st.badgeStyle] : "вимк."}${warn}\n`;
  screen += ` палітра: ${st.palette.map(swatch).join(" ")}  ${st.paletteLabel}  \x1b[2m${st.palette.join(",")}\x1b[0m\n\n`;
  out(screen);

  if (!rasterize) {
    out(" Немає растеризатора SVG→PNG. Встановіть:  npm i @resvg/resvg-js   (або brew install librsvg)\n");
  } else {
    try {
      const { svg, W } = buildSheet();
      const png = rasterize(svg, W * 2);
      if (inlineCapable) out(inlineImage(png, { width: W }) + "\n");
      else {
        const f = join(tmpdir(), "logogen-preview.png");
        writeFileSync(f, png);
        out(` (інлайн-графіка вимкнена) прев'ю: ${f}\n`);
      }
      if (st.badges) {
        const b = buildBadges();
        const bpng = rasterize(b.svg, b.W * 4);
        if (inlineCapable) out(inlineImage(bpng, { width: b.W * 2 }) + "\n");
        else {
          const bf = join(tmpdir(), "logogen-badges.png");
          writeFileSync(bf, bpng);
          out(` бейджі: ${bf}\n`);
        }
      }
    } catch (e) {
      out(` помилка рендеру: ${e.message}\n`);
    }
  }
  out(`\n ${msg}\n\n`);
  out("\x1b[2m ←/→ patch·збірка  ↑/↓ minor·день  [ / ] major·місяць  0 скинути  f формат версії\n" +
      "  p/P палітра  e свої кольори  t/T патерн  l літери  m шрифт  o аутлайн  s форма\n" +
      "  b бейджі вкл/викл  y стиль бейджа  n назва  v версія\n" +
      "  w зберегти SVG  W SVG+PNG  B зберегти бейдж  q вихід\x1b[0m\n");
}

// ---------- ввід: власний рядковий редактор (readline ламає курсор після інлайн-зображення) ----------
let promptHandler = null;
function ask(q, hint = "") {
  return new Promise((res) => {
    let buf = "";
    out(`\n ${brand()} \x1b[36m❯\x1b[0m ${q}${hint ? ` \x1b[2m[${hint}]\x1b[0m` : ""} `);
    out("\x1b[?25h");
    const done = (v) => { promptHandler = null; out("\x1b[?25l"); res(v); };
    promptHandler = (s, k) => {
      if (k.ctrl && k.name === "c") return done(null);
      if (k.name === "return" || k.name === "enter") return done(buf.trim());
      if (k.name === "escape") return done(null);
      if (k.name === "backspace") {
        if (buf) { const a = Array.from(buf); a.pop(); buf = a.join(""); out("\b \b"); }
        return;
      }
      if (s && !k.ctrl && !k.meta && !s.startsWith("\x1b") && s.codePointAt(0) >= 32) { buf += s; out(s); }
    };
  });
}

function quit(code = 0) {
  out("\x1b[?25h\n");
  try { process.stdin.setRawMode(false); } catch {}
  process.exit(code);
}

async function save(withPng) {
  mkdirSync(st.outDir, { recursive: true });
  const base = join(st.outDir, `${slug(st.name)}-${fileSafe(parseVersion(st.version).label)}`);
  const svg = generateLogo({ ...logoOpts(), size: 512 });
  writeFileSync(base + ".svg", svg);
  msg = `збережено: ${base}.svg`;
  if (withPng) {
    if (!rasterize) msg += "  (PNG неможливий: немає растеризатора)";
    else { writeFileSync(base + ".png", rasterize(svg, 1024)); msg += " + .png"; }
  }
}

async function saveBadge() {
  mkdirSync(st.outDir, { recursive: true });
  const base = join(st.outDir, `${slug(st.name)}-${fileSafe(parseVersion(st.version).label)}-badge`);
  const b = makeBadge(badgeOpts());
  writeFileSync(base + ".svg", b.svg);
  msg = `збережено: ${base}.svg`;
  if (rasterize) { writeFileSync(base + ".png", rasterize(b.svg, b.width * 4)); msg += " + .png"; }
}

const cycle = (i, n, dir = 1) => (i + dir + n) % n;

async function onKey(str, key) {
  if (!key) return;
  if (key.ctrl && key.name === "c") return quit();
  msg = "";
  const step = (level, dir) => {
    if (parseVersion(st.version).kind === "text") { msg = "для довільного тексту кроків немає — змініть версію клавішею v"; return; }
    st.version = applyStep(st.version, level, dir);
  };
  switch (key.name) {
    case "right": step("low", +1); break;
    case "left":  step("low", -1); break;
    case "up":    step("mid", +1); break;
    case "down":  step("mid", -1); break;
    default:
      switch (str) {
        case "]": step("high", +1); break;
        case "[": step("high", -1); break;
        case "0": st.version = "1.0.0"; break;
        case "f": {
          const nextFmt = FORMATS[cycle(FORMATS.indexOf(formatId(st.version)), FORMATS.length)];
          st.version = sampleOf(nextFmt); msg = `формат версії: ${nextFmt}`;
          break;
        }
        case "p": case "P": {
          const cur = PRESET_NAMES.indexOf(st.paletteLabel);
          const next = cycle(cur < 0 ? 0 : cur, PRESET_NAMES.length, str === "p" ? 1 : -1);
          st.paletteLabel = PRESET_NAMES[next]; st.palette = PRESETS[st.paletteLabel];
          break;
        }
        case "t": st.pattern = cycle(st.pattern, PATTERNS.length, 1); break;
        case "T": st.pattern = cycle(st.pattern, PATTERNS.length, -1); break;
        case "l": st.letters = cycle(st.letters, LETTERS.length); break;
        case "m": st.font = cycle(st.font, FONTS.length); break;
        case "o": st.outline = !st.outline; break;
        case "s": st.shape = cycle(st.shape, SHAPES.length); break;
        case "b": st.badges = !st.badges; break;
        case "y": st.badgeStyle = cycle(st.badgeStyle, BADGE_STYLES.length); break;
        case "n": { const a = await ask("назва", st.name); if (a) st.name = a; break; }
        case "v": { const a = await ask("версія (1.2.3 · 2026.01.08-3 · 3a4b5c6)", st.version); if (a) st.version = parseVersion(a).label; break; }
        case "e": {
          const a = await ask("кольори через кому або пресет", "p/P — перебір пресетів");
          if (a) { const pp = parsePalette(a); if (pp) { st.palette = pp.colors; st.paletteLabel = pp.label; } else msg = `не вдалося розібрати палітру (≥2 hex-кольорів або пресет: ${PRESET_NAMES.join(", ")})`; }
          break;
        }
        case "w": await save(false); break;
        case "W": await save(true); break;
        case "B": await saveBadge(); break;
        case "q": return quit();
        default: return; // невідома клавіша — не перемальовуємо
      }
  }
  await draw();
}

// ---------- старт ----------
rasterize = await loadRasterizer();
initBrand();

if (flag("version") && opt("version") === undefined) { // `logogen-tui --version` без значення → мале лого + версія
  out(`${brand()}\n`);
  process.exit(0);
}
if (!process.stdin.isTTY) {
  console.error("logogen-tui потребує інтерактивного терміналу (TTY).");
  process.exit(1);
}
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
let chain = Promise.resolve();
process.stdin.on("keypress", (s, k) => {
  if (promptHandler) return promptHandler(s, k ?? {});
  chain = chain.then(() => onKey(s, k)).catch((e) => { msg = `помилка: ${e.message}`; return draw(); });
});
process.on("exit", () => out("\x1b[?25h"));
await draw();
