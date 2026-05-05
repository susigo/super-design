/**
 * Prompt-building utilities for the ppt-design scenario.
 * Each function takes the user's raw prompt and returns a capability-ready prompt.
 * Kept pure (no I/O) so they are easy to snapshot-test.
 */

/** Prompt for generating the cover / background image of the first slide. */
export function buildCoverImagePrompt(userPrompt: string): string {
  return (
    `Professional presentation cover illustration for: ${userPrompt}. ` +
    'Wide 16:9 format, clean modern design, suitable as a slide background. ' +
    'No text, no captions, high contrast, studio-quality.'
  );
}

/** Prompt for generating background/ambient music for the deck. */
export function buildBackgroundMusicPrompt(userPrompt: string): string {
  return (
    `Ambient background music for a professional presentation about: ${userPrompt}. ` +
    'Subtle, non-distracting, corporate/modern style, 30 seconds.'
  );
}

/**
 * Extract a concise title from the user prompt (first sentence or first 60 chars).
 */
export function extractTitle(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  const firstSentence = trimmed.match(/^[^.!?。！？]+[.!?。！？]?/)?.[0] ?? trimmed;
  return firstSentence.slice(0, 60).trim();
}
