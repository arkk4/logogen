#!/usr/bin/env node
// logogen.mjs — детермінований SVG-логотип і GitHub-бейдж з назви, версії та палітри. Без залежностей.
//
// CLI (логотип):
//   node logogen.mjs --name "Nebula Sync" --version 2.3.1 \
//        --palette "#264653,#2a9d8f,#e9c46a,#f4a261,#e76f51" --out logo.svg
//   додатково: --letters auto|1|2|3|full  --pattern classic|extra|all|<назва макета>
//              --font sans|mono  --no-outline  --shape squircle|circle|square  --size 256
//
// CLI (бейдж [ Назва | версія ]):
//   node logogen.mjs --badge --name "Nebula Sync" --version 2.3.1 --out badge.svg
//   додатково: --badge-style flat|flat-square  --label-color "#555"  --label "Інший текст"
//              (--palette, --pattern, --font, --no-outline діють так само, як для логотипа)
//
// Версії: semver (1.2.3, 1.2.3-rc.1, 1.2.0+3a4b5c6), calver (2026.01.08, 2026-01-08.3, 2026.01.08-3),
//         git-хеш (3a4b5c6…, довгий і короткий дають однаковий логотип), довільний текст.
//
// Ідея: «родина» логотипа задається назвою, а відмінності між версіями — версією.
//   назва             -> літери (стабільно між версіями)
//   «груба» частина   -> макет і розподіл кольорів   (semver: major; calver: рік+місяць; хеш: увесь хеш)
//   повна версія      -> кут, зсуви, дрібні деталі
//
// Логотип і бейдж беруть арт із ОДНІЄЇ функції buildArt(), тому для однакових
// (name, version, palette, pattern) вони завжди збігаються.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------- детермінований PRNG ----------
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rngFor = (...parts) => mulberry32(xmur3(parts.join("|"))());
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const range = (r, a, b) => a + r() * (b - a);
const shuffle = (r, arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const f = (n) => +n.toFixed(2);

// ---------- версії ----------
const pad2 = (n) => String(n).padStart(2, "0");
const looksLikeHash = (s) => /^[0-9a-f]{7,40}$/i.test(s) && /[a-f]/i.test(s);
const normSuffix = (s) => {
  s = s.replace(/^[-+._]+/, "");
  const m = /^g?([0-9a-f]{7,40})$/i.exec(s);
  return m && /[a-f]/i.test(m[1]) ? m[1].slice(0, 7).toLowerCase() : s;
};

export function parseVersion(input) {
  const s = String(input ?? "").trim().replace(/^v(?=\d)/i, "") || "0.0.0";

  // git-хеш (довгий і короткий — той самий логотип)
  if (looksLikeHash(s)) {
    const h = s.slice(0, 7).toLowerCase();
    return { kind: "hash", label: h, layoutKey: [h], detailKey: [h], fields: { hash: h } };
  }
  // calver: YYYY.MM[.DD][-N | .N | -текст]
  let m = /^(\d{4})[.\-/](\d{1,2})(?:[.\-/](\d{1,2}))?(?:[-.+_](.+))?$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = m[3] != null ? +m[3] : null, suffix = m[4] ? normSuffix(m[4]) : "";
    if (mo >= 1 && mo <= 12 && (d == null || (d >= 1 && d <= 31))) {
      const label = `${y}.${pad2(mo)}${d != null ? "." + pad2(d) : ""}${suffix ? "-" + suffix : ""}`;
      return {
        kind: "calver", label,
        layoutKey: ["cal", y, pad2(mo)],
        detailKey: ["cal", y, mo, d ?? 0, suffix],
        fields: { y, mo, d, suffix },
      };
    }
  }
  // semver (з необов'язковим суфіксом: -rc.1, +build, -g<хеш>)
  m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+_.](.+))?$/.exec(s);
  if (m) {
    const [major, minor, patch] = [+m[1], +(m[2] ?? 0), +(m[3] ?? 0)];
    const pre = m[4] ? normSuffix(m[4]) : "";
    return {
      kind: "semver",
      label: `${major}.${minor}.${patch}${pre ? "-" + pre : ""}`,
      layoutKey: [major],
      detailKey: [major, minor, patch, ...(pre ? [pre] : [])],
      fields: { major, minor, patch, pre },
    };
  }
  return { kind: "text", label: s, layoutKey: [s], detailKey: [s], fields: {} };
}

// ---------- колір ----------
function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
// Колір літер: найкращий контраст проти найгіршого з кольорів палітри під нею.
function textColor(palette) {
  const cands = ["#ffffff", "#111111", ...palette];
  let best = cands[0], bestScore = -1;
  for (const c of cands) {
    const score = Math.min(...palette.map((p) => contrast(c, p)));
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return { color: best, score: bestScore };
}
/** Найгірший контраст літер із палітрою (WCAG ratio). < 3 — без аутлайна читатиметься погано. */
export const legibility = (palette) => textColor(palette).score;

// ---------- літери та текст ----------
function pickLetters(name, count) {
  const spaced = name.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2");
  const words = spaced.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => Array.from(w));
  if (!words.length) return "?";
  const up = (s) => s.toLocaleUpperCase();
  const n = count === "auto" ? (words.length > 1 ? 2 : 1) : Math.min(+count, 3);
  if (n === 1) return up(words[0][0]);
  if (words.length >= 2) return up(words.slice(0, n).map((w) => w[0]).join(""));
  // одне слово: перша літера + стабільно (від назви, не від версії) обрана ще одна
  const r = rngFor("letters", name);
  const rest = words[0].slice(1).filter((c) => /\p{L}/u.test(c));
  const out = [words[0][0]];
  while (out.length < n && rest.length) out.push(rest.splice(Math.floor(r() * rest.length), 1)[0]);
  return up(out.join(""));
}

// грубий оцінювач ширини тексту в em (для підгонки розміру шрифту під повну назву)
function emWidth(s, mono) {
  if (mono) return Array.from(s).length * 0.6;
  let w = 0;
  for (const ch of s) w += /[\p{Lu}\p{N}]/u.test(ch) ? 0.74 : ch === " " ? 0.3 : 0.6;
  return w;
}
function planText(name, letters, mono) {
  if (letters === "full") {
    const full = name.trim();
    const words = full.split(/\s+/).filter(Boolean);
    const options = [[full]];
    if (words.length > 1) options.push(words.length <= 3 ? words : [words[0], words[1], words.slice(2).join(" ")]);
    let best = null;
    for (const lines of options) {
      const w = Math.max(...lines.map((l) => emWidth(l, mono)));
      const fs = Math.min(58, 80 / w, 80 / (lines.length * 1.12));
      if (!best || fs > best.fs) best = { lines, fs };
    }
    return { lines: best.lines, fs: Math.max(6, f(best.fs)), full: true };
  }
  const text = pickLetters(name, letters);
  return { lines: [text], fs: text.length === 1 ? 58 : text.length === 2 ? 44 : 34, full: false };
}

// ---------- макети ----------
const S = 100;

// згладжений замкнений контур через Catmull-Rom → Безьє
function blobPath(cx, cy, r, rs, rotDeg) {
  const n = rs.length;
  const pts = rs.map((k, i) => {
    const a = (i / n) * 2 * Math.PI + (rotDeg * Math.PI) / 180;
    return [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k];
  });
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + "Z";
}

const layouts = {
  // ===== classic =====
  // діагональні смуги
  bands(c, L, D) {
    const ang = L.angle + D.jitter * 25;
    const n = 3 + (L.n % 2);
    const h = S * 1.6 / n;
    let out = `<rect width="${S}" height="${S}" fill="${c[0]}"/><g transform="rotate(${f(ang)} 50 50)">`;
    for (let i = 1; i < n; i++)
      out += `<rect x="-30" y="${f(-30 + i * h + D.shift * 10)}" width="160" height="${f(h)}" fill="${c[i % c.length]}"/>`;
    return out + "</g>";
  },
  // великі кола
  orbs(c, L, D) {
    let out = `<rect width="${S}" height="${S}" fill="${c[0]}"/>`;
    for (let i = 1; i <= 3; i++) {
      const x = L.pts[i][0] + D.jitter * 12, y = L.pts[i][1] + D.shift * 12;
      out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(L.rad[i] + D.shift * 6)}" fill="${c[i % c.length]}"/>`;
    }
    return out;
  },
  // концентричні кільця з зсунутим центром
  rings(c, L, D) {
    const cx = 50 + L.pts[1][0] / 4 - 12 + D.jitter * 14, cy = 50 + L.pts[1][1] / 4 - 12 + D.shift * 14;
    let out = `<rect width="${S}" height="${S}" fill="${c[0]}"/>`;
    const k = 4;
    for (let i = k; i >= 1; i--) out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(i * 17 + 4)}" fill="${c[i % c.length]}"/>`;
    return out;
  },
  // 2×2 плитки з чвертями кіл / напівколами / трикутниками
  tiles(c, L, D) {
    let out = `<rect width="${S}" height="${S}" fill="${c[0]}"/>`;
    const t = S / 2;
    for (let i = 0; i < 4; i++) {
      const x = (i % 2) * t, y = Math.floor(i / 2) * t;
      const kind = L.kinds[i], col = c[(i + 1) % c.length];
      const rot = (L.rots[i] + (D.flip[i] ? 90 : 0)) % 360;
      let shape;
      if (kind === 0) shape = `<path d="M${x} ${y}h${t}v${t}A${t} ${t} 0 0 1 ${x} ${y}z"/>`;
      else if (kind === 1) shape = `<circle cx="${x + t / 2}" cy="${y + t / 2}" r="${t / 2 - 3}"/>`;
      else if (kind === 2) shape = `<path d="M${x} ${y}h${t}l${-t} ${t}z"/>`;
      else shape = `<rect x="${x + 6}" y="${y + 6}" width="${t - 12}" height="${t - 12}" rx="4"/>`;
      out += `<g fill="${col}" transform="rotate(${rot} ${x + t / 2} ${y + t / 2})">${shape}</g>`;
    }
    return out;
  },

  // ===== extra =====
  // промені з зсунутого центру
  sunburst(c, L, D) {
    const n = L.rays;
    const cx = 50 + (L.pts[0][0] - 50) * 0.5 + D.jitter * 6;
    const cy = 50 + (L.pts[0][1] - 50) * 0.5 + D.shift * 6;
    const a0 = L.angle + D.jitter * 15, step = 360 / n;
    const P = (a) => [cx + 150 * Math.cos((a * Math.PI) / 180), cy + 150 * Math.sin((a * Math.PI) / 180)];
    let out = `<rect width="${S}" height="${S}" fill="${c[0]}"/>`;
    for (let i = 0; i < n; i += 2) {
      const [x1, y1] = P(a0 + i * step), [x2, y2] = P(a0 + (i + 1) * step);
      out += `<path d="M${f(cx)} ${f(cy)}L${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}Z" fill="${c[1 + (i / 2) % Math.max(1, c.length - 1)]}"/>`;
    }
    return out;
  },
  // шахівниця (інколи під 45°) з акцентними клітинками
  checker(c, L, D) {
    const g = 3 + (L.n % 2), s = S / g;
    const rot = L.n % 3 === 0 ? 45 : 0;
    let out = rot ? `<g transform="translate(50 50) rotate(${rot}) scale(1.5) translate(-50 -50)">` : "<g>";
    for (let i = 0; i < g * g; i++) {
      const x = i % g, y = Math.floor(i / g);
      const odd = (x + y) % 2;
      let col = odd ? c[1 % c.length] : c[0];
      if (L.cells[i] % 5 === 0 && c.length > 2) col = c[2 + ((L.cells[i] >> 3) % (c.length - 2))];
      if (D.flips16[i]) col = odd ? c[0] : c[1 % c.length];
      out += `<rect x="${f(x * s)}" y="${f(y * s)}" width="${f(s + 0.3)}" height="${f(s + 0.3)}" fill="${col}"/>`;
    }
    return out + "</g>";
  },
  // шари хвиль
  waves(c, L, D) {
    let out = `<rect width="${S}" height="${S}" fill="${c[0]}"/>`;
    for (let i = 0; i < 3; i++) {
      const w = L.waves[i];
      const y = 22 + i * 26 + (w.y - 57) * 0.25 + D.shift * 4;
      const x0 = -50 + w.ph * 0.5 + D.jitter * 15;
      out += `<path d="M${f(x0)} ${f(y)}q20 ${f(-w.amp)} 40 0t40 0t40 0t40 0t40 0V110H${f(x0)}Z" fill="${c[(i + 1) % c.length]}"/>`;
    }
    return out;
  },
  // вкладені повернуті квадрати
  nested(c, L, D) {
    const cx = 50 + D.jitter * 5, cy = 50 + D.shift * 5, rot = L.angle + D.jitter * 12;
    let out = `<rect width="${S}" height="${S}" fill="${c[0]}"/>`;
    for (let i = 0; i < 4; i++) {
      const size = 120 - i * 26;
      out += `<rect x="${f(cx - size / 2)}" y="${f(cy - size / 2)}" width="${size}" height="${size}" rx="${L.n % 2 ? f(size * 0.2) : 0}" fill="${c[(i + 1) % c.length]}" transform="rotate(${f(rot)} ${f(cx)} ${f(cy)})"/>`;
    }
    return out;
  },
  // органічні плями
  blobs(c, L, D) {
    let out = `<rect width="${S}" height="${S}" fill="${c[0]}"/>`;
    for (let i = 0; i < 3; i++) {
      const b = L.blobs[i], sgn = i % 2 ? 1 : -1;
      out += `<path d="${blobPath(b.cx + sgn * D.jitter * 8, b.cy + D.shift * 8, b.r + 6, b.rs, b.a + D.jitter * 30)}" fill="${c[(i + 1) % c.length]}"/>`;
    }
    return out;
  },
  // симетричний піксельний «ідентикон» 5×5
  mirror(c, L, D) {
    const s = 16, off = 10;
    let out = `<rect width="${S}" height="${S}" fill="${c[0]}"/>`;
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 3; x++) {
        const i = y * 3 + x;
        let on = L.mask[i] > 0.45;
        if (D.flips16[i]) on = !on;
        if (!on) continue;
        const col = c[1 + (L.cidx[i] % Math.max(1, c.length - 1))];
        for (const xx of x === 2 ? [2] : [x, 4 - x])
          out += `<rect x="${f(off + xx * s)}" y="${f(off + y * s)}" width="${s - 2}" height="${s - 2}" rx="3" fill="${col}"/>`;
      }
    return out;
  },
  // градієнт + м'які світні плями
  aurora(c, L, D, uid) {
    const a = ((L.angle + D.jitter * 20) * Math.PI) / 180;
    const x2 = 50 + 50 * Math.cos(a), y2 = 50 + 50 * Math.sin(a);
    let defs = `<linearGradient id="${uid}g" gradientUnits="userSpaceOnUse" x1="${f(100 - x2)}" y1="${f(100 - y2)}" x2="${f(x2)}" y2="${f(y2)}"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1 % c.length]}"/></linearGradient>`;
    let out = `<rect width="${S}" height="${S}" fill="url(#${uid}g)"/>`;
    for (let i = 0; i < 3; i++) {
      const col = c[(i + 2) % c.length];
      defs += `<radialGradient id="${uid}r${i}"><stop offset="0" stop-color="${col}" stop-opacity="0.95"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`;
      const sgn = i % 2 ? 1 : -1;
      out += `<circle cx="${f(L.pts[i + 1][0] + sgn * D.jitter * 8)}" cy="${f(L.pts[i + 1][1] + D.shift * 8)}" r="${f(L.rad[i + 1] * 1.2)}" fill="url(#${uid}r${i})"/>`;
    }
    return `<defs>${defs}</defs>${out}`;
  },
};

const CLASSIC = ["bands", "orbs", "rings", "tiles"];
const EXTRA = ["sunburst", "checker", "waves", "nested", "blobs", "mirror", "aurora"];
/** Допустимі значення `pattern`: набори (classic / extra / all) або конкретний макет. */
export const PATTERNS = ["classic", "extra", "all", ...CLASSIC, ...EXTRA];
const poolFor = (p) =>
  p === "classic" ? CLASSIC : p === "extra" ? EXTRA : p === "all" ? [...CLASSIC, ...EXTRA] : layouts[p] ? [p] : CLASSIC;

const FONTS = {
  sans: { stack: "Inter, 'Helvetica Neue', Arial, sans-serif", mono: false },
  mono: { stack: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace", mono: true },
};

const DEFAULT_PALETTE = ["#264653", "#2a9d8f", "#e9c46a", "#f4a261", "#e76f51"];

// ---------- спільне ядро: арт для логотипа і бейджа ----------
// Логотип і бейдж беруть арт ЗВІДСИ — тому для однакових (name, version, palette, pattern) він ідентичний.
function buildArt({ name, v, palette, pattern }, uid) {
  if (palette.length < 2) palette = [palette[0] ?? "#333333", palette[0] ?? "#333333"];

  const rLay = rngFor("layout", name, ...v.layoutKey);          // змінюється з «грубою» частиною версії
  const rDet = rngFor("detail", name, ...v.detailKey);          // змінюється з кожною версією

  // Порядок викликів rLay/rDet не змінювати — від нього залежить вигляд уже згенерованих логотипів.
  const layoutName = pick(rLay, poolFor(pattern));
  const colors = shuffle(rLay, palette);
  const L = {
    angle: range(rLay, -60, 60),
    n: Math.floor(rLay() * 4),
    pts: Array.from({ length: 4 }, () => [range(rLay, 5, 95), range(rLay, 5, 95)]),
    rad: Array.from({ length: 4 }, () => range(rLay, 28, 55)),
    kinds: Array.from({ length: 4 }, () => Math.floor(rLay() * 4)),
    rots: Array.from({ length: 4 }, () => pick(rLay, [0, 90, 180, 270])),
  };
  const D = {
    jitter: rDet() * 2 - 1,
    shift: rDet() * 2 - 1,
    flip: Array.from({ length: 4 }, () => rDet() < 0.25),
  };
  // дані для додаткових макетів — завжди ПІСЛЯ класичних
  L.rays = 2 * (3 + Math.floor(rLay() * 5));
  L.cells = Array.from({ length: 16 }, () => Math.floor(rLay() * 1000));
  L.waves = Array.from({ length: 3 }, () => ({ y: range(rLay, 30, 85), amp: range(rLay, 6, 16), ph: range(rLay, -40, 0) }));
  L.blobs = Array.from({ length: 3 }, () => ({
    cx: range(rLay, 25, 75), cy: range(rLay, 25, 75), r: range(rLay, 26, 40),
    rs: Array.from({ length: 7 }, () => range(rLay, 0.72, 1.22)), a: range(rLay, 0, 360),
  }));
  L.mask = Array.from({ length: 15 }, () => rLay());
  L.cidx = Array.from({ length: 15 }, () => Math.floor(rLay() * 100));
  D.flips16 = Array.from({ length: 16 }, () => rDet() < 0.14);

  return { art: layouts[layoutName](colors, L, D, uid), colors };
}

// ---------- логотип ----------
export function generateLogo({
  name,
  version = "1.0.0",
  palette = DEFAULT_PALETTE,
  letters = "auto",     // "auto" | 1 | 2 | 3 | "full" (вся назва)
  shape = "squircle",   // "squircle" | "circle" | "square"
  pattern = "classic",  // "classic" | "extra" | "all" | назва макета
  font = "sans",        // "sans" | "mono"
  outline = true,       // обводка літер
  size = 256,
} = {}) {
  if (!name) throw new Error("name is required");
  const v = parseVersion(version);
  const clipId = "c" + xmur3(`${name}${v.label}`)().toString(36);
  const { art, colors } = buildArt({ name, v, palette, pattern }, clipId);

  const fnt = FONTS[font] ?? FONTS.sans;
  const plan = planText(name, letters, fnt.mono);
  const { color: fg } = textColor(colors);
  const halo = luminance(fg) > 0.5 ? "#000000" : "#ffffff";
  const ls = fnt.mono ? 0 : plan.full ? f(-plan.fs * 0.02) : -1;
  const sw = plan.full ? f(Math.min(5, plan.fs * 0.09)) : 5;
  const lh = plan.fs * 1.12;
  const textAttrs =
    `font-family="${fnt.stack}" font-weight="800" font-size="${plan.fs}" letter-spacing="${ls}" fill="${fg}"` +
    (outline ? ` stroke="${halo}" stroke-opacity="0.9" stroke-width="${sw}" paint-order="stroke" stroke-linejoin="round"` : "");
  const texts = plan.lines
    .map((ln, i) => `<text x="50" y="${f(50 + (i - (plan.lines.length - 1) / 2) * lh)}" dy="0.35em" text-anchor="middle">${escapeXml(ln)}</text>`)
    .join("");

  const clip =
    shape === "circle" ? `<circle cx="50" cy="50" r="50"/>`
    : shape === "square" ? `<rect width="100" height="100"/>`
    : `<rect width="100" height="100" rx="24"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${escapeXml(name)} ${escapeXml(v.label)}">
<title>${escapeXml(name)} ${escapeXml(v.label)}</title>
<defs><clipPath id="${clipId}">${clip}</clipPath></defs>
<g clip-path="url(#${clipId})">${art}</g>
<g ${textAttrs} text-anchor="middle">${texts}</g>
</svg>
`;
}

// ---------- GitHub-бейдж: [ Назва | версія ] ----------
// Ліва частина — стандартний сірий (#555) з білим текстом, як у shields.io.
// Права — той самий арт, що й у логотипі (центральна смуга, «cover»), а текст — версія.

// грубий оцінювач ширини тексту (Verdana ~ shields.io), у px
function badgeTextWidth(s, px, mono) {
  if (mono) return Array.from(s).length * px * 0.6;
  let w = 0;
  for (const ch of s) {
    if (ch === " ") w += 0.35;
    else if (/[0-9]/.test(ch)) w += 0.64;
    else if (/[ijl.,:;'|!]/.test(ch)) w += 0.34;
    else if (/[-_()[\]]/.test(ch)) w += 0.45;
    else if (/[mwMW@]/.test(ch)) w += 0.95;
    else if (/\p{Lu}/u.test(ch)) w += 0.7;
    else w += 0.6;
  }
  return w * px;
}

/** Повертає { svg, width, height } (розміри в px при scale=1; висота стандартна — 20). */
export function makeBadge({
  name,
  version = "1.0.0",
  palette = DEFAULT_PALETTE,
  pattern = "classic",
  font = "sans",              // шрифт версії: "sans" | "mono"
  outline = true,             // обводка тексту версії (читабельність на арті)
  label,                      // за замовчуванням = name
  labelColor = "#555555",     // «стандартний» колір бейджів
  style = "flat",             // "flat" (rx 3) | "flat-square"
  scale = 1,
} = {}) {
  if (!name) throw new Error("name is required");
  const v = parseVersion(version);
  const uid = "b" + xmur3(`${name}${v.label}`)().toString(36);
  const { art, colors } = buildArt({ name, v, palette, pattern }, uid);

  const fnt = FONTS[font] ?? FONTS.sans;
  const H = 20, px = 11, pad = 6;
  const left = label ?? name;
  const right = v.kind === "semver" ? `v${v.label}` : v.label;
  const lw = Math.ceil(badgeTextWidth(left, px, false)) + pad * 2;
  const rw = Math.ceil(badgeTextWidth(right, px, fnt.mono)) + pad * 2;
  const W = lw + rw;

  // арт 100×100 вкриває праву частину рівномірно (cover) і центрується — видно середню смугу
  const k = Math.max(rw, H) / S;
  const ox = lw + (rw - S * k) / 2, oy = (H - S * k) / 2;

  const { color: fg } = textColor(colors);
  const halo = luminance(fg) > 0.5 ? "#000000" : "#ffffff";
  const rx = style === "flat-square" ? 0 : 3;
  const sans = "Verdana, Geneva, 'DejaVu Sans', sans-serif";
  const rText =
    `fill="${fg}"` + (outline ? ` stroke="${halo}" stroke-opacity="0.9" stroke-width="2.2" paint-order="stroke" stroke-linejoin="round"` : "");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W * scale)}" height="${f(H * scale)}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(left)}: ${escapeXml(right)}">
<title>${escapeXml(left)}: ${escapeXml(right)}</title>
<defs><clipPath id="${uid}c"><rect width="${W}" height="${H}" rx="${rx}"/></clipPath><clipPath id="${uid}v"><rect x="${lw}" width="${rw}" height="${H}"/></clipPath></defs>
<g clip-path="url(#${uid}c)">
<rect width="${lw}" height="${H}" fill="${labelColor}"/>
<g clip-path="url(#${uid}v)"><g transform="translate(${f(ox)} ${f(oy)}) scale(${+k.toFixed(4)})">${art}</g></g>
</g>
<g text-anchor="middle" font-size="${px}" text-rendering="geometricPrecision">
<g font-family="${sans}">
<text x="${lw / 2}" y="11" dy="0.35em" fill="#010101" fill-opacity=".3" textLength="${lw - pad * 2}">${escapeXml(left)}</text>
<text x="${lw / 2}" y="10" dy="0.35em" fill="#fff" textLength="${lw - pad * 2}">${escapeXml(left)}</text>
</g>
<text x="${lw + rw / 2}" y="10" dy="0.35em" font-family="${fnt.stack}" font-weight="700" ${rText} textLength="${rw - pad * 2}">${escapeXml(right)}</text>
</g>
</svg>
`;
  return { svg, width: W, height: H };
}

export const generateBadge = (opts) => makeBadge(opts).svg;

const escapeXml = (s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

// ---------- CLI ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith("--") ? [...acc, [v.slice(2), a[i + 1]]] : acc), [])
  );
  if (!args.name) {
    console.error(
      'Usage: node logogen.mjs --name "Product" [--version 1.2.3|2026.01.08-3|3a4b5c6] [--palette "#hex,#hex,..."]\n' +
      `       [--letters auto|1|2|3|full] [--pattern ${PATTERNS.slice(0, 3).join("|")}|<макет>] [--font sans|mono] [--no-outline]\n` +
      "       [--shape squircle|circle|square] [--size 256] [--out logo.svg]\n" +
      '       [--badge [--badge-style flat|flat-square] [--label-color "#555"] [--label текст]]'
    );
    process.exit(1);
  }
  const palette = args.palette?.split(",").map((s) => s.trim());
  if ("badge" in args) {
    const svg = generateBadge({
      name: args.name,
      version: args.version,
      palette,
      pattern: args.pattern ?? "classic",
      font: args.font ?? "sans",
      outline: !("no-outline" in args),
      style: args["badge-style"] ?? "flat",
      labelColor: args["label-color"] ?? "#555555",
      label: args.label,
    });
    if (args.out) writeFileSync(args.out, svg); else process.stdout.write(svg);
    process.exit(0);
  }
  const svg = generateLogo({
    name: args.name,
    version: args.version,
    palette,
    letters: args.letters ?? "auto",
    shape: args.shape ?? "squircle",
    pattern: args.pattern ?? "classic",
    font: args.font ?? "sans",
    outline: !("no-outline" in args),
    size: args.size ? +args.size : 256,
  });
  if (args.out) writeFileSync(args.out, svg);
  else process.stdout.write(svg);
}
