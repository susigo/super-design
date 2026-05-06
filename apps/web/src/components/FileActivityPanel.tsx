import { useT } from '../i18n';
import type { AgentEvent } from '../types';

type FileChangedEvent = Extract<AgentEvent, { kind: 'file_changed' }>;

export function FileActivityPanel({ events }: { events: FileChangedEvent[] }) {
  const t = useT();
  if (events.length === 0) return null;

  return (
    <div className="file-activity-panel">
      <div className="file-activity-header">
        <span className="file-activity-icon" aria-hidden>&#x1F4C1;</span>
        <span className="file-activity-title">{t('fileActivity.title')}</span>
        <span className="file-activity-count">{events.length}</span>
      </div>
      <ul className="file-activity-list">
        {events.map((ev, i) => (
          <li key={i} className={`file-activity-item file-activity-${ev.changeKind}`}>
            <span className="file-activity-badge" aria-hidden>
              {ev.changeKind === 'create' ? '+' : ev.changeKind === 'delete' ? '−' : '~'}
            </span>
            <code className="file-activity-path">{ev.path}</code>
            <span className="file-activity-kind">
              {ev.changeKind === 'create'
                ? t('fileActivity.created')
                : ev.changeKind === 'delete'
                  ? t('fileActivity.deleted')
                  : t('fileActivity.modified')}
            </span>
            {typeof ev.size === 'number' ? (
              <span className="file-activity-size">
                {ev.size < 1024 ? `${ev.size}B` : `${Math.round(ev.size / 1024)}KB`}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
