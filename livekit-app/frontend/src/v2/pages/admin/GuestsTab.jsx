import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Card, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { fmtDateTime } from './formatters';

export function GuestsTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    v2Admin
      .guests(30)
      .then(setData)
      .catch(() => toast.error('Failed to load guest ledger'));
  }, []);

  return (
    <Card className="app-card overflow-hidden border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Participant ledger (30 days)</CardTitle>
        <CardDescription>{data?.notes || 'Join/leave activity from LiveKit lifecycle webhooks.'}</CardDescription>
      </CardHeader>
      <div className="overflow-x-auto border-t border-border/60">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Identity</th>
              <th className="px-4 py-3 font-medium">Room</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Left</th>
              <th className="px-4 py-3 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {(data?.participants || []).map((p, i) => (
              <tr
                key={`${p.room}-${p.identity}-${p.joined_at}-${i}`}
                className="border-b border-border/60 last:border-0"
              >
                <td className="px-4 py-3 font-medium">{p.name || '—'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{p.identity || '—'}</td>
                <td className="px-4 py-3 text-xs">{p.room}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDateTime(p.joined_at)}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {p.left_at ? fmtDateTime(p.left_at) : 'still in / unknown'}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {p.duration_minutes != null ? `${p.duration_minutes} min` : '—'}
                </td>
              </tr>
            ))}
            {data && (data.participants || []).length === 0 && (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  No participant activity in the window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default GuestsTab;
