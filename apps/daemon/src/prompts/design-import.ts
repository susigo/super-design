// @ts-nocheck
// System prompt + JSON schema for the "Sample Importer" feature.
//
// Goal: distill any user-supplied source (image / PDF / HTML / ZIP)
// into a 9-section DESIGN.md the rest of OD can consume. We force
// structured output via tool use because the downstream regex
// extractors in design-systems.ts (extractCategory / extractSwatches
// / extractSurface) fail on free-form Markdown ~30% of the time.
//
// The renderer below converts the tool's structured input into
// canonical DESIGN.md text using the same H2 section names as
// design-systems/default/DESIGN.md so picker swatches keep working.

export const DESIGN_IMPORT_SYSTEM = `You are a design-system distiller.

Given one or more brand-design source assets (screenshots of a marketing
page, a PDF brand guide, a single HTML page, or a ZIP of related files),
extract a concise design system that another AI can later use to
generate on-brand artifacts.

Hard rules:

1. Emit your answer ONLY by calling the \`emit_design_md\` tool. Never
   write the answer as prose; never wrap it in code fences. The tool
   has the only schema we accept.
2. Never invent values. If the source does not show a brand color, type
   choice, or grid, write the literal string "(unknown)" for that field
   rather than guessing. We surface "(unknown)" cleanly; we cannot
   un-hallucinate a wrong hex.
3. Color tokens MUST be hex strings (#rrggbb). Drop any color you can't
   represent that way. If the source shows ranges or gradients, pick the
   single most representative stop.
4. Typography choices should be web-safe / Google Fonts where possible.
   When the source uses a custom face you can't reliably name, write
   "(unknown)" for the family and describe the *style* (e.g. "geometric
   sans, two weights"). Do NOT make up font filenames.
5. Voice + Anti-patterns are short ("editorial, restrained" / "no neon
   gradients on warm beige"). One line each, max 12 words.
6. Slug must be lowercased ASCII, hyphen-separated, no longer than 32
   characters. Derive it from the brand name when possible.

Output discipline matters. The downstream renderer is keyed on these
field names; renaming or omitting a field breaks the import pipeline.`;

export const DESIGN_MD_TOOL_SCHEMA = {
  type: 'object',
  required: ['slug', 'title', 'category', 'summary', 'colors', 'typography'],
  additionalProperties: false,
  properties: {
    slug: { type: 'string', maxLength: 32 },
    title: { type: 'string' },
    category: { type: 'string' },
    summary: { type: 'string' },
    colors: {
      type: 'object',
      additionalProperties: false,
      properties: {
        primary_brand: { type: 'string', description: 'hex' },
        accent: { type: 'string', description: 'hex' },
        background: { type: 'string', description: 'hex' },
        foreground: { type: 'string', description: 'hex' },
        border: { type: 'string', description: 'hex' },
        muted: { type: 'string', description: 'hex' },
        notes: { type: 'string' },
      },
    },
    typography: {
      type: 'object',
      additionalProperties: false,
      properties: {
        display_family: { type: 'string' },
        body_family: { type: 'string' },
        scale: { type: 'string' },
        notes: { type: 'string' },
      },
    },
    spacing: { type: 'string' },
    layout: { type: 'string' },
    components: { type: 'string' },
    motion: { type: 'string' },
    voice: { type: 'string' },
    anti_patterns: { type: 'string' },
  },
};

/**
 * Render the structured tool input into canonical DESIGN.md text.
 * Section order + H2 names mirror design-systems/default/DESIGN.md so
 * the existing extractCategory / extractSwatches regexes keep working.
 */
export function renderDesignMd(input) {
  const safe = input || {};
  const colors = safe.colors || {};
  const typo = safe.typography || {};
  const lines = [];
  lines.push(`# ${safe.title || '(unknown)'}\n`);
  lines.push(`> Category: ${safe.category || '(unknown)'}\n`);
  if (safe.summary) lines.push(`${safe.summary}\n`);
  lines.push(`## Color`);
  lines.push(formatColorSection(colors));
  lines.push(`\n## Typography`);
  lines.push(formatTypographySection(typo));
  if (safe.spacing) lines.push(`\n## Spacing\n\n${safe.spacing}`);
  if (safe.layout) lines.push(`\n## Layout\n\n${safe.layout}`);
  if (safe.components) lines.push(`\n## Components\n\n${safe.components}`);
  if (safe.motion) lines.push(`\n## Motion\n\n${safe.motion}`);
  if (safe.voice) lines.push(`\n## Voice\n\n${safe.voice}`);
  if (safe.anti_patterns)
    lines.push(`\n## Anti-patterns\n\n${safe.anti_patterns}`);
  return lines.join('\n').trim() + '\n';
}

function formatColorSection(c) {
  const labels = [
    ['Primary Brand', 'primary_brand'],
    ['Accent', 'accent'],
    ['Background', 'background'],
    ['Foreground', 'foreground'],
    ['Border', 'border'],
    ['Muted', 'muted'],
  ];
  const rows = labels
    .map(([label, key]) => {
      const value = c?.[key];
      if (!value) return null;
      // Render hex inside backticks so extractSwatches form A regex
      // matches (`- **Background:** \`#FAFAFA\``).
      return `- **${label}:** \`${value}\``;
    })
    .filter(Boolean);
  if (rows.length === 0) rows.push('- **Primary Brand:** (unknown)');
  if (c?.notes) {
    rows.push('');
    rows.push(c.notes);
  }
  return rows.join('\n');
}

function formatTypographySection(t) {
  const lines = [];
  if (t?.display_family) lines.push(`- **Display:** ${t.display_family}`);
  if (t?.body_family) lines.push(`- **Body:** ${t.body_family}`);
  if (t?.scale) lines.push(`- **Scale:** ${t.scale}`);
  if (lines.length === 0) lines.push('- **Display:** (unknown)');
  if (t?.notes) {
    lines.push('');
    lines.push(t.notes);
  }
  return lines.join('\n');
}

/**
 * Best-effort slug sanitiser used by the save route. Mirror the rules
 * we promise the model so a sloppy `slug` still lands somewhere safe.
 */
export function sanitizeDesignSystemSlug(raw) {
  const lowered = String(raw || '').toLowerCase();
  const cleaned = lowered.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 32) || 'imported-design-system';
}
