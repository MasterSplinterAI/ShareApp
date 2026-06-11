import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Badge } from '../../../components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { PrettyJson } from './shared';

export function AuditTab() {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    v2Admin
      .audit()
      .then((r) => setEntries(r.entries || []))
      .catch(() => toast.error('Failed to load audit log'));
  }, []);

  return (
    <Card className="app-card overflow-hidden border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Admin audit log</CardTitle>
        <CardDescription>Last 100 superadmin actions (plan/comp/billing changes etc.).</CardDescription>
      </CardHeader>
      <div className="overflow-x-auto border-t border-border/60">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Payload</th>
              <th className="px-4 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-4 py-3 font-medium">{e.actor_email}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{e.action}</Badge>
                </td>
                <td className="px-4 py-3">
                  {e.payload_json ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">view payload</summary>
                      <PrettyJson value={e.payload_json} />
                    </details>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{(e.created_at || '').slice(0, 19)}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default AuditTab;
