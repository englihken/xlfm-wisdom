// scripts/check-site-quotes.ts — the site's attributed quotes must be registered.
// Brief docs/briefs/2026-09-11-homepage-quotes.md: any sentence attributed to
// 卢军宏台长 / 台长 / 师父 on the public site has to be a verbatim hit in the
// corpus, and the ONLY thing this check accepts as proof is an entry in
// docs/site-quotes.json (verified by the architect). Scans
// src/components/**/*.tsx and src/app/**/page.tsx for
//   (a) 「…」-bracketed strings (JSX text, may span lines / <br />), and
//   (b) the text of a quote-card-body paragraph,
// and fails (exit 1) when an attribution (台长 / 师父) appears within 6 lines
// and the sentence is not registered verbatim. Runs inside `npm run lint`.
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const REGISTER = path.join(ROOT, 'docs', 'site-quotes.json');
const ATTRIBUTION = /台长|师父/;
const WINDOW = 6;

type Register = { quotes: { id: string; text: string }[] };
const register = JSON.parse(fs.readFileSync(REGISTER, 'utf8')) as Register;
const squash = (s: string) => s.replace(/\s+/g, '');
const registered = new Set(register.quotes.map((q) => squash(q.text)));

function walk(dir: string, pick: (p: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pick, out);
    else if (pick(p)) out.push(p);
  }
  return out;
}
const files = [
  ...walk(path.join(ROOT, 'src', 'components'), (p) => p.endsWith('.tsx')),
  ...walk(path.join(ROOT, 'src', 'app'), (p) => /[\\/]page\.tsx$/.test(p)),
];

// JSX text → plain text: drop tags, comments and JS expressions.
const plain = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '');

type Candidate = { file: string; line: number; text: string };
function candidates(file: string, lines: string[]): Candidate[] {
  const out: Candidate[] = [];
  // (a) 「…」 — join up to 4 following lines so a quote split by <br /> still counts.
  for (let i = 0; i < lines.length; i++) {
    const joined = plain(lines.slice(i, i + 4).join(''));
    const re = /「([^「」]{6,})」/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(joined)) !== null) {
      const startsHere = plain(lines[i]).includes('「');
      if (startsHere) out.push({ file, line: i + 1, text: m[1] });
    }
  }
  // (b) quote-card-body paragraphs: the next non-empty JSX text line.
  for (let i = 0; i < lines.length; i++) {
    if (!/quote-card-body/.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const t = plain(lines[j]).trim();
      if (t) {
        out.push({ file, line: j + 1, text: t });
        break;
      }
    }
  }
  // Only sentences: at least 6 CJK characters (drops code residue like ");" or
  // `{props.children}` containers whose text arrives at runtime).
  return out.filter((c) => (c.text.match(/[一-鿿]/g) ?? []).length >= 6);
}

let failures = 0;
let checked = 0;
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const c of candidates(file, lines)) {
    const window = lines.slice(Math.max(0, c.line - 1 - WINDOW), c.line + WINDOW).join('\n');
    if (!ATTRIBUTION.test(window)) continue; // not attributed → not our business
    checked++;
    const key = squash(c.text.replace(/^「|」$/g, ''));
    const ok = registered.has(key) || [...registered].some((r) => r.includes(key) || key.includes(r));
    const rel = path.relative(ROOT, file);
    if (ok) console.log(`  ✓ ${rel}:${c.line}  ${c.text.slice(0, 40)}`);
    else {
      failures++;
      console.error(`  ✗ ${rel}:${c.line}  attributed quote not in docs/site-quotes.json: ${c.text.slice(0, 80)}`);
    }
  }
}
console.log(`site quotes: ${checked} attributed, ${failures} unregistered`);
if (failures > 0) {
  console.error('Register the sentence in docs/site-quotes.json ONLY after the architect has verified it verbatim in the corpus.');
  process.exit(1);
}
