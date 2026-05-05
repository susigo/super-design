import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Transparent BYOK metering view. Reads from /api/usage/* on the
// daemon and renders three views:
//   1. cumulative-cost area chart by day
//   2. surface-share pie (text/image/video/audio)
//   3. recent calls table
//
// All numbers come from the daemon's local SQLite (.od/app.sqlite ::
// usage_logs); no data leaves the user's machine. The daemon writes
// rows as a side-effect of chat/proxy/media calls — see usage-log.ts.

type Period = '7d' | '30d' | 'all';

interface UsageSummary {
  period: string;
  daily: Array<{ date: string; calls: number; costUsd: number }>;
  bySurface: Record<string, { count: number; costUsd: number }>;
  byProvider: Record<string, { count: number; costUsd: number }>;
  total: { count: number; costUsd: number };
}

interface UsageRecentRow {
  id: string;
  ts: number;
  surface: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  imageCount: number | null;
  costUsd: number | null;
  costSource: string;
  projectId: string | null;
}

const PIE_COLORS = ['#5b8dff', '#22c8a0', '#ffba6b', '#ff6b8a', '#a78bff'];

export function UsageTab() {
  const [period, setPeriod] = useState<Period>('30d');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [recent, setRecent] = useState<UsageRecentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, recentRes] = await Promise.all([
        fetch(`/api/usage/summary?period=${period}`),
        fetch(`/api/usage/recent?limit=50`),
      ]);
      if (!summaryRes.ok) throw new Error(`summary ${summaryRes.status}`);
      if (!recentRes.ok) throw new Error(`recent ${recentRes.status}`);
      const summaryData = (await summaryRes.json()) as UsageSummary;
      const recentData = (await recentRes.json()) as { rows: UsageRecentRow[] };
      setSummary(summaryData);
      setRecent(Array.isArray(recentData.rows) ? recentData.rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Light auto-refresh while the tab is open so freshly recorded calls
  // show up without the user clicking a button.
  useEffect(() => {
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const surfaceData = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.bySurface)
      .filter(([, v]) => v.count > 0)
      .map(([key, v]) => ({ name: key, value: v.costUsd || v.count }));
  }, [summary]);

  const handleClear = async () => {
    if (!window.confirm('清空所有用量历史?此操作不可撤销。')) return;
    setClearing(true);
    try {
      const res = await fetch('/api/usage', { method: 'DELETE' });
      if (!res.ok) throw new Error(`clear ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="settings-section">
      <div className="section-head">
        <div>
          <h3>Usage</h3>
          <p className="hint">
            BYOK transparent metering. All data is stored locally in
            <code> .od/app.sqlite</code>. OpenAI estimates exclude cached-input
            discount; Anthropic costs use provider totals.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="settings-select"
            aria-label="Time range"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
          <button
            type="button"
            className="ghost"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="empty-card" style={{ color: 'var(--text-warn, #c44)' }}>
          {error}
        </div>
      ) : null}

      {summary ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0,1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <UsageStat
              label="Total calls"
              value={summary.total.count.toString()}
            />
            <UsageStat
              label="Estimated cost"
              value={`$${summary.total.costUsd.toFixed(4)}`}
            />
            <UsageStat
              label="Surfaces"
              value={Object.keys(summary.bySurface).length.toString()}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr',
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div className="usage-chart-card" style={{ minHeight: 220 }}>
              <h4 style={{ margin: '0 0 8px' }}>Daily cost</h4>
              {summary.daily.length === 0 ? (
                <div className="empty-card">No data in range yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={summary.daily}>
                    <defs>
                      <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#5b8dff" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#5b8dff" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                    />
                    <Tooltip
                      formatter={(v) => [
                        `$${Number(v).toFixed(4)}`,
                        'Cost',
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="costUsd"
                      stroke="#5b8dff"
                      strokeWidth={2}
                      fill="url(#costFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="usage-chart-card" style={{ minHeight: 220 }}>
              <h4 style={{ margin: '0 0 8px' }}>By surface</h4>
              {surfaceData.length === 0 ? (
                <div className="empty-card">No surfaces recorded yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={surfaceData}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={70}
                      label={(d) => d.name}
                    >
                      {surfaceData.map((_entry, i) => (
                        <Cell
                          key={i}
                          fill={PIE_COLORS[i % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => Number(v).toFixed(4)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      ) : null}

      <div className="usage-recent" style={{ marginTop: 16 }}>
        <h4 style={{ margin: '0 0 8px' }}>Recent calls</h4>
        {recent.length === 0 ? (
          <div className="empty-card">No calls recorded yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="usage-table" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th align="left">When</th>
                  <th align="left">Surface</th>
                  <th align="left">Model</th>
                  <th align="right">Tokens / images</th>
                  <th align="right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td>{formatTs(r.ts)}</td>
                    <td>
                      <span className="usage-pill">{r.surface}</span>{' '}
                      <span style={{ opacity: 0.6 }}>{r.provider}</span>
                    </td>
                    <td title={r.projectId || ''}>{r.model}</td>
                    <td align="right">
                      {r.surface === 'image'
                        ? `${r.imageCount ?? 0} img`
                        : `${r.inputTokens ?? 0} in / ${r.outputTokens ?? 0} out`}
                    </td>
                    <td align="right">
                      {r.costUsd == null
                        ? '—'
                        : `$${r.costUsd.toFixed(4)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button
          type="button"
          className="ghost"
          onClick={handleClear}
          disabled={clearing}
        >
          {clearing ? 'Clearing…' : 'Clear history'}
        </button>
      </div>
    </section>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="usage-stat-card">
      <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function formatTs(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
