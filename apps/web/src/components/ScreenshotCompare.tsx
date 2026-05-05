import { useRef, useState } from 'react';

interface Props {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}

export function ScreenshotCompare({
  before,
  after,
  beforeLabel = 'Before',
  afterLabel = 'After',
}: Props) {
  const [mode, setMode] = useState<'slider' | 'side-by-side'>('slider');
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.max(0, Math.min(100, x)));
  };

  return (
    <div className="screenshot-compare">
      <div className="screenshot-compare-controls">
        <button
          type="button"
          className={mode === 'slider' ? 'active' : ''}
          onClick={() => setMode('slider')}
        >
          Slider
        </button>
        <button
          type="button"
          className={mode === 'side-by-side' ? 'active' : ''}
          onClick={() => setMode('side-by-side')}
        >
          Side by side
        </button>
      </div>

      {mode === 'slider' ? (
        <div
          ref={containerRef}
          className="screenshot-compare-slider"
          onMouseMove={handleMouseMove}
        >
          <img src={after} alt={afterLabel} className="screenshot-compare-full" />
          <div
            className="screenshot-compare-clip"
            style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
          >
            <img src={before} alt={beforeLabel} />
          </div>
          <div
            className="screenshot-compare-handle"
            style={{ left: `${sliderPos}%` }}
          >
            <div className="screenshot-compare-handle-line" />
          </div>
          <span className="screenshot-compare-label left">{beforeLabel}</span>
          <span className="screenshot-compare-label right">{afterLabel}</span>
        </div>
      ) : (
        <div className="screenshot-compare-sbs">
          <div className="screenshot-compare-sbs-pane">
            <div className="screenshot-compare-sbs-label">{beforeLabel}</div>
            <img src={before} alt={beforeLabel} />
          </div>
          <div className="screenshot-compare-sbs-pane">
            <div className="screenshot-compare-sbs-label">{afterLabel}</div>
            <img src={after} alt={afterLabel} />
          </div>
        </div>
      )}
    </div>
  );
}
