#!/usr/bin/env node
/**
 * Backfill `od.capabilities_used` (and `od.scenario` for deck/ppt skills)
 * in all SKILL.md files.
 *
 * Usage (dry-run, shows diff):
 *   node --experimental-strip-types scripts/backfill-skill-capabilities.ts
 *
 * Apply changes:
 *   node --experimental-strip-types scripts/backfill-skill-capabilities.ts --apply
 *
 * Phase 2 acceptance criterion: script + manual review. Run dry-run first,
 * inspect the output, then re-run with --apply once satisfied.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const APPLY = process.argv.includes('--apply');

// ---------------------------------------------------------------------------
// Capability inference rules
// ---------------------------------------------------------------------------

interface CapabilityEntry {
  id: string;
  version: string;
  required: boolean;
}

function inferCapabilities(odData: Record<string, unknown>): CapabilityEntry[] | null {
  const mode = typeof odData['mode'] === 'string' ? odData['mode'] : null;
  const surface = typeof odData['surface'] === 'string' ? odData['surface'] : null;

  // deck / ppt skills use image-gen (required) + music-gen (optional)
  if (mode === 'deck') {
    return [
      { id: 'image-gen', version: '^0', required: true },
      { id: 'music-gen', version: '^0', required: false },
    ];
  }

  // image skills use image-gen (required)
  if (mode === 'image' || surface === 'image') {
    return [{ id: 'image-gen', version: '^0', required: true }];
  }

  // audio skills use music-gen (required)
  if (mode === 'audio' || surface === 'audio') {
    return [{ id: 'music-gen', version: '^0', required: true }];
  }

  // video skills: no capability package yet (Phase 4+)
  if (mode === 'video' || surface === 'video') {
    return null; // skip
  }

  // prototype / other: no media capabilities
  return null;
}

/**
 * For deck skills, also update od.scenario to the technical scenario id so
 * the Phase 2 dispatch routes them through the orchestrator.
 */
function inferScenario(odData: Record<string, unknown>): string | null {
  const mode = typeof odData['mode'] === 'string' ? odData['mode'] : null;
  if (mode === 'deck') return 'ppt-design';
  return null;
}

// ---------------------------------------------------------------------------
// Frontmatter surgery (text-level, preserves formatting of unchanged keys)
// ---------------------------------------------------------------------------

function buildCapabilitiesYaml(caps: CapabilityEntry[]): string {
  const lines: string[] = ['  capabilities_used:'];
  for (const cap of caps) {
    lines.push(`    - id: ${cap.id}`);
    lines.push(`      version: '${cap.version}'`);
    lines.push(`      required: ${cap.required}`);
  }
  return lines.join('\n');
}

function patchFrontmatter(
  src: string,
  caps: CapabilityEntry[],
  newScenario: string | null,
): { patched: string; changed: boolean } {
  // Locate the frontmatter block
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!fmMatch) return { patched: src, changed: false };

  let fm = fmMatch[1]!;
  const rest = src.slice(fmMatch[0].length);
  let changed = false;

  // ── capabilities_used ──────────────────────────────────────────────────
  if (!fm.includes('capabilities_used:')) {
    fm = fm.replace(/^(od:\s*\n(?:[ \t]+\S.*\n)*)/m, (odBlock) => {
      changed = true;
      return odBlock.trimEnd() + '\n' + buildCapabilitiesYaml(caps) + '\n';
    });
  }

  // ── od.scenario ────────────────────────────────────────────────────────
  if (newScenario) {
    const scenarioReplaced = fm.replace(
      /(^|\n)([ \t]+scenario:\s*)\S+/,
      (_, prefix, key) => {
        changed = true;
        return `${prefix}${key}${newScenario}`;
      },
    );
    if (scenarioReplaced !== fm) {
      fm = scenarioReplaced;
    } else if (!fm.includes('  scenario:')) {
      // No scenario key yet — add it inside od:
      fm = fm.replace(/^(od:\s*\n)/m, (_, odLine) => {
        changed = true;
        return `${odLine}  scenario: ${newScenario}\n`;
      });
    }
  }

  if (!changed) return { patched: src, changed: false };
  return { patched: `---\n${fm}\n---\n${rest}`, changed: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface SkillChange {
  file: string;
  caps: CapabilityEntry[];
  newScenario: string | null;
  patched: string;
}

async function main() {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  } catch {
    console.error(`skills directory not found: ${SKILLS_DIR}`);
    process.exit(1);
  }

  const changes: SkillChange[] = [];
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    let src: string;
    try {
      src = await readFile(skillMd, 'utf8');
    } catch {
      skipped++;
      continue;
    }

    // Minimal frontmatter extraction for the od block
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
    if (!fmMatch) { skipped++; continue; }
    const fm = fmMatch[1]!;

    // Parse od block (naive line scan — good enough for flat od keys)
    const odData: Record<string, unknown> = {};
    let inOd = false;
    for (const line of fm.split('\n')) {
      if (/^od:\s*$/.test(line)) { inOd = true; continue; }
      if (inOd && /^\S/.test(line)) { inOd = false; }
      if (inOd) {
        const m = /^\s+(\w+):\s*(.+)/.exec(line);
        if (m) odData[m[1] as string] = m[2]?.trim();
      }
    }

    if (fm.includes('capabilities_used:')) { skipped++; continue; }

    const caps = inferCapabilities(odData);
    if (!caps) { skipped++; continue; }

    const newScenario = inferScenario(odData);
    const { patched, changed } = patchFrontmatter(src, caps, newScenario);
    if (!changed) { skipped++; continue; }

    changes.push({ file: skillMd, caps, newScenario, patched });
  }

  // ── Report ────────────────────────────────────────────────────────────
  console.log(`\nBackfill summary (${APPLY ? 'APPLY' : 'DRY RUN'}):`);
  console.log(`  Skills to update : ${changes.length}`);
  console.log(`  Skills skipped   : ${skipped}`);
  console.log();

  for (const change of changes) {
    const rel = path.relative(path.join(__dirname, '..'), change.file);
    const capsStr = change.caps.map((c) => `${c.id}@${c.version}${c.required ? '' : '?'}`).join(', ');
    const scenarioStr = change.newScenario ? ` | scenario → ${change.newScenario}` : '';
    console.log(`  ${rel}`);
    console.log(`    capabilities_used: [${capsStr}]${scenarioStr}`);
  }

  if (changes.length === 0) {
    console.log('  Nothing to update.\n');
    return;
  }

  if (!APPLY) {
    console.log(
      '\n  Run with --apply to write changes.\n' +
      '  Review the capability assignments above before applying.\n',
    );
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────
  let written = 0;
  for (const change of changes) {
    await writeFile(change.file, change.patched, 'utf8');
    written++;
  }
  console.log(`\n  Written ${written} file(s).\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
