import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import {
  captureProjectScreenshot,
  fetchProjectScreenshots,
  type ScreenshotEntry,
} from '../providers/screenshots';

interface Props {
  projectId: string;
  onAnnotate?: (imageUrl: string, viewport: string) => void;
}

export function ScreenshotGallery({ projectId, onAnnotate }: Props) {
  const t = useT();
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);

  const fetchScreenshots = useCallback(async () => {
    setLoading(true);
    try {
      setScreenshots(await fetchProjectScreenshots(projectId));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchScreenshots();
  }, [fetchScreenshots]);

  const captureNew = async () => {
    setCapturing(true);
    try {
      await captureProjectScreenshot(projectId);
      await fetchScreenshots();
    } catch {
      // ignore
    } finally {
      setCapturing(false);
    }
  };

  const viewportLabel = (vp: string) => {
    if (vp === 'desktop') return t('screenshots.desktop');
    if (vp === 'tablet') return t('screenshots.tablet');
    if (vp === 'mobile') return t('screenshots.mobile');
    return vp;
  };

  const imageUrl = (fileName: string) =>
    `/api/projects/${projectId}/screenshots/${fileName}`;

  // Group screenshots by timestamp for display
  const grouped = groupByTimestamp(screenshots);

  return (
    <div className="screenshot-gallery">
      <div className="screenshot-gallery-header">
        <h3>{t('screenshots.title')}</h3>
        <button
          type="button"
          className="screenshot-capture-btn"
          onClick={captureNew}
          disabled={capturing}
        >
          {capturing ? '...' : t('screenshots.capture')}
        </button>
      </div>

      {loading ? (
        <div className="screenshot-gallery-empty">Loading...</div>
      ) : screenshots.length === 0 ? (
        <div className="screenshot-gallery-empty">No screenshots yet</div>
      ) : (
        <div className="screenshot-gallery-groups">
          {grouped.map((group) => (
            <div key={group.timestamp} className="screenshot-gallery-group">
              <div className="screenshot-gallery-group-time">
                {new Date(group.timestamp).toLocaleTimeString()}
              </div>
              <div className="screenshot-gallery-grid">
                {group.items.map((shot, i) => (
                  <div key={i} className="screenshot-gallery-item">
                    <button
                      type="button"
                      className="screenshot-gallery-thumb"
                      onClick={() => setLightbox(imageUrl(shot.fileName))}
                    >
                      <img
                        src={imageUrl(shot.fileName)}
                        alt={`${viewportLabel(shot.viewport)} screenshot`}
                        loading="lazy"
                      />
                    </button>
                    <div className="screenshot-gallery-meta">
                      <span className="screenshot-gallery-viewport">
                        {viewportLabel(shot.viewport)}
                      </span>
                      <span className="screenshot-gallery-size">
                        {shot.width}x{shot.height}
                      </span>
                      {onAnnotate ? (
                        <button
                          type="button"
                          className="screenshot-gallery-annotate"
                          onClick={() => onAnnotate(imageUrl(shot.fileName), shot.viewport)}
                        >
                          Annotate
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

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
    </div>
  );
}

interface ScreenshotGroup {
  timestamp: number;
  items: ScreenshotEntry[];
}

function groupByTimestamp(shots: ScreenshotEntry[]): ScreenshotGroup[] {
  const map = new Map<number, ScreenshotEntry[]>();
  for (const shot of shots) {
    const list = map.get(shot.timestamp) ?? [];
    list.push(shot);
    map.set(shot.timestamp, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([timestamp, items]) => ({ timestamp, items }));
}
