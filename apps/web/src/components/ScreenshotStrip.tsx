import { useState } from 'react';
import { useT } from '../i18n';
import type { PersistedAgentEvent } from '@open-design/contracts';

type ScreenshotEvent = Extract<PersistedAgentEvent, { kind: 'screenshot' }>;

export function ScreenshotStrip({ items }: { items: ScreenshotEvent[] }) {
  const t = useT();
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (items.length === 0) return null;

  const viewportLabel = (vp: string) => {
    if (vp === 'desktop') return t('screenshots.desktop');
    if (vp === 'tablet') return t('screenshots.tablet');
    if (vp === 'mobile') return t('screenshots.mobile');
    return vp;
  };

  return (
    <>
      <div className="screenshot-strip">
        <div className="screenshot-strip-header">
          <span className="screenshot-strip-icon" aria-hidden>&#x1F4F7;</span>
          <span className="screenshot-strip-title">{t('screenshots.title')}</span>
        </div>
        <div className="screenshot-strip-grid">
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              className="screenshot-thumb"
              onClick={() => setLightbox(item.imageUrl)}
              title={viewportLabel(item.viewport)}
            >
              <img
                src={item.imageUrl}
                alt={`${viewportLabel(item.viewport)} screenshot`}
                loading="lazy"
              />
              <span className="screenshot-thumb-label">{viewportLabel(item.viewport)}</span>
            </button>
          ))}
        </div>
      </div>
      {lightbox ? (
        <div
          className="screenshot-lightbox"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <img src={lightbox} alt="Screenshot preview" />
        </div>
      ) : null}
    </>
  );
}
