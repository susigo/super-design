export function buildHeroImagePrompt(userPrompt: string): string {
  return (
    `Professional hero banner illustration for a web page about: ${userPrompt}. ` +
    'Wide 16:9 format, clean modern design, suitable as a website hero background. ' +
    'No text, no captions, high contrast, studio-quality.'
  );
}

export function extractPageTitle(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  const firstSentence = trimmed.match(/^[^.!?。！？]+[.!?。！？]?/)?.[0] ?? trimmed;
  return firstSentence.slice(0, 60).trim();
}

const DEFAULT_SECTIONS = ['Features', 'About', 'Services', 'Testimonials'];

export function extractPageSections(userPrompt: string): string[] {
  const parts = userPrompt
    .split(/[,;，；\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 80);

  if (parts.length >= 3 && parts.length <= 6) return parts;
  if (parts.length > 6) return parts.slice(0, 6);
  return DEFAULT_SECTIONS;
}
