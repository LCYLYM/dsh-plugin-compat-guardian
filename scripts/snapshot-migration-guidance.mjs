// Refresh the reviewed, MIT-licensed evidence snapshot from a local checkout.
// Runtime repair never downloads or executes code from the reference project.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parse } from 'yaml';
import { sha256 } from '../lib/hash.js';
import { runCommand } from '../lib/process.js';
const root = resolve(process.argv[2]);
const source = join(root, 'skills/plugin-upgrade/references');
const revision = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
const sets = [];
for (const filename of (await readdir(source)).filter(name => /^v\d.*\.md$/.test(name)).sort()) {
  const text = await readFile(join(source, filename), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replaceAll('\r\n', '\n'));
  if (!match) throw new Error(`missing version metadata: ${filename}`);
  const meta = parse(match[1]);
  const body = match[2];
  const headings = [...body.matchAll(/^###\s+([A-Za-z0-9.-]+)\s+·\s+(.+)$/gm)];
  const cards = headings.map((heading, index) => {
    const card = body.slice(heading.index, headings[index + 1]?.index ?? body.length).trim();
    const field = name => new RegExp(`^- \\*\\*${name}\\*\\*:\\s*([^\\r\\n]+)`, 'm').exec(card)?.[1]?.trim();
    return { id: heading[1], title: heading[2], type: field('Type'),
      touchpoints: [...new Set([...(field('Touchpoints') ?? '').matchAll(/#([1-7])/g)].map(m => Number(m[1])))],
      text: card };
  });
  sets.push({ from: meta.from, to: meta.to, status: meta.status, coverage: meta.coverage,
    file: filename, sha256: sha256(text), cards });
}
const snapshot = { schema: 1, source: 'https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill', revision, sets,
  patterns: JSON.parse(await readFile(join(source, 'pre-flight-patterns.json'), 'utf8')) };
const output = resolve('data/migration-guidance');
await mkdir(output, { recursive: true });
await writeFile(join(output, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
await writeFile(join(output, 'LICENSE'), await readFile(join(root, 'LICENSE')));
console.log(JSON.stringify({ revision, sets: sets.length, cards: sets.reduce((n, s) => n + s.cards.length, 0) }));
