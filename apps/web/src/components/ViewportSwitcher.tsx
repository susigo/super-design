import { useT } from '../i18n';

export type ViewportSize = 'desktop' | 'tablet' | 'mobile';

export interface ViewportConfig {
  label: ViewportSize;
  width: number;
}

export const VIEWPORT_CONFIGS: ViewportConfig[] = [
  { label: 'desktop', width: 1280 },
  { label: 'tablet', width: 768 },
  { label: 'mobile', width: 375 },
];

interface Props {
  active: ViewportSize;
  onChange: (vp: ViewportSize) => void;
  streaming?: boolean;
}

export function ViewportSwitcher({ active, onChange, streaming }: Props) {
  const t = useT();
  return (
    <div className="viewport-switcher">
      {streaming ? <span className="viewport-live-dot" aria-label="Live" /> : null}
      {VIEWPORT_CONFIGS.map((vp) => (
        <button
          key={vp.label}
          type="button"
          className={`viewport-btn ${active === vp.label ? 'active' : ''}`}
          onClick={() => onChange(vp.label)}
          title={`${t(`screenshots.${vp.label}` as keyof typeof t)} (${vp.width}px)`}
          aria-pressed={active === vp.label}
        >
          <ViewportIcon viewport={vp.label} />
        </button>
      ))}
    </div>
  );
}

function ViewportIcon({ viewport }: { viewport: ViewportSize }) {
  if (viewport === 'desktop') {
    return (
      <svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="1" y="1" width="14" height="9" rx="1" />
        <line x1="5" y1="12" x2="11" y2="12" />
        <line x1="8" y1="10" x2="8" y2="12" />
      </svg>
    );
  }
  if (viewport === 'tablet') {
    return (
      <svg width="12" height="16" viewBox="0 0 12 16" fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="1" y="1" width="10" height="14" rx="1.5" />
        <circle cx="6" cy="13" r="0.7" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="1" y="1" width="8" height="14" rx="1.5" />
      <circle cx="5" cy="13" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
