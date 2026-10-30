import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { DayBarChart } from './shared';

export function TrendsTab() {
  const [days, setDays] = useState(30);
  const [trends, setTrends] = useState(null);

  useEffect(() => {
    v2Admin
      .trends(days)
      .then(setTrends)
      .catch(() => toast.error('Failed to load trends'));
  }, [days]);

  const charts = [
    { title: 'Signups per day', rows: trends?.signupsByDay, valueKey: 'count', unit: 'signups' },
    { title: 'Meetings created per day', rows: trends?.meetingsByDay, valueKey: 'count', unit: 'meetings' },
    { title: 'Participant-minutes per day', rows: trends?.minutesByDay, valueKey: 'minutes', unit: 'min' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Window:</span>
        <select
          aria-label="Trends time window"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {charts.map((c) => (
          <Card key={c.title} className="app-card border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {trends ? (
                <DayBarChart rows={c.rows} days={days} valueKey={c.valueKey} unit={c.unit} />
              ) : (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default TrendsTab;
