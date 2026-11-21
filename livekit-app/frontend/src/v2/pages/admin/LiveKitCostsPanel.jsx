import { useEffect, useState } from 'react';
import { v2Admin } from '../../../services/apiV2';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { fmtCents, fmtUsd } from './formatters';

const currentMonth = () => new Date().toISOString().slice(0,7);
const previousMonth = () => {
  const date = new Date();
  date.setUTCDate(0);
  return date.toISOString().slice(0,7);
};
const labels = { applied: 'Recorded in OpsHub', covered: 'Already recorded', pending: 'Queued for OpsHub',
  needs_reconciliation: 'Needs reconciliation', dead_letter: 'Sync failed', unknown: 'Receipt unavailable' };
const errorMessage = error => error?.response?.data?.error || error?.message || 'LiveKit costs could not be loaded';

export function LiveKitCostsPanel() {
  const [month,setMonth] = useState(currentMonth);
  const [data,setData] = useState(null);
  const [request,setRequest] = useState(0);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [importing,setImporting] = useState(false);
  const [draft,setDraft] = useState(null);
  const invoice = data?.invoices.find(row => row.billingMonth === month);

  useEffect(() => {
    let active = true;
    const load = () => v2Admin.liveKitCosts(month).then(result => {
      if (active) setData(result);
    }).catch(error => {
      if (active) setError(errorMessage(error));
    });
    void load();
    const timer = setInterval(load,15000);
    return () => { active = false; clearInterval(timer); };
  },[month,request]);

  async function run(action) {
    setError('');
    setBusy(true);
    try { await action(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  function review(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setDraft({
      invoiceNumber: values.get('invoiceNumber').trim(),
      billingMonth: values.get('billingMonth'),
      issuedOn: values.get('issuedOn'),
      totalUsd: values.get('totalUsd'),
      file: values.get('invoice'),
    });
  }

  function submit() {
    void run(async () => {
      const form = new FormData();
      const { file, ...fields } = draft;
      for (const [key,value] of Object.entries(fields)) form.append(key,value);
      form.append('invoice',file);
      form.append('confirmed','true');
      await v2Admin.importLiveKitInvoice(form);
      setMonth(fields.billingMonth);
      setDraft(null);
      setImporting(false);
      setRequest(value => value + 1);
    });
  }

  function download(row) {
    void run(async () => {
      const file = await v2Admin.liveKitInvoicePdf(row.billingMonth);
      const objectUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = row.invoiceNumber + '.pdf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl),1000);
    });
  }

  return (
    <Card className="app-card border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">LiveKit costs</CardTitle>
        <CardDescription>Meeting usage estimates and reviewed monthly invoices.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="livekit-month">Service month</Label>
            <Input id="livekit-month" type="month" value={month} max={currentMonth()} min="2000-01"
              onChange={event => { if (event.target.value) { setMonth(event.target.value); setError(''); } }} />
          </div>
          <Button variant="outline" type="button" onClick={() => { setImporting(value => !value); setDraft(null); }}>
            {importing ? 'Close invoice import' : 'Import monthly invoice'}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <p className="text-sm text-muted-foreground">Estimated LiveKit meeting usage</p>
            <p className="text-2xl font-semibold">{data?.estimate.month === month && data.estimate.meetings ? fmtUsd(data.estimate.amountUsd) : '—'}</p>
            <p className="text-xs text-muted-foreground">{data?.estimate.month === month
              ? data.estimate.meetings + ' metered meetings · UTC rollup month' : 'Loading estimates…'}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-sm text-muted-foreground">Actual invoice total</p>
            <p className="text-2xl font-semibold">{invoice ? fmtCents(invoice.amountMinor) : '—'}</p>
            <p className="text-xs text-muted-foreground">{invoice ? labels[invoice.syncStatus] || invoice.syncStatus : 'No invoice imported for this month'}</p>
          </div>
        </div>
        {importing && (
          <div className="rounded-lg border p-4">
            <form onSubmit={review} className={draft ? 'hidden' : 'grid gap-3 sm:grid-cols-2'}>
              <div className="space-y-2"><Label htmlFor="livekit-invoice-id">Invoice number</Label>
                <Input id="livekit-invoice-id" name="invoiceNumber" required maxLength={30} /></div>
              <div className="space-y-2"><Label htmlFor="livekit-invoice-month">Invoice service month</Label>
                <Input id="livekit-invoice-month" name="billingMonth" type="month" max={previousMonth()} defaultValue={month < currentMonth() ? month : previousMonth()} required /></div>
              <div className="space-y-2"><Label htmlFor="livekit-invoice-issued">Issue date</Label>
                <Input id="livekit-invoice-issued" name="issuedOn" type="date" max={new Date().toISOString().slice(0,10)} required /></div>
              <div className="space-y-2"><Label htmlFor="livekit-invoice-total">Invoice total in USD</Label>
                <Input id="livekit-invoice-total" name="totalUsd" inputMode="decimal" placeholder="42.91" pattern="[0-9]{1,8}(\\.[0-9]{1,2})?" required /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="livekit-invoice-pdf">Original LiveKit invoice PDF</Label>
                <Input id="livekit-invoice-pdf" name="invoice" type="file" accept="application/pdf,.pdf" required /></div>
              <div><Button type="submit" variant="outline">Review invoice</Button></div>
            </form>
            {draft && (
              <div className="space-y-3">
                <h3 className="font-semibold">Review LiveKit invoice</h3>
                <p className="text-sm">{draft.invoiceNumber} · {draft.billingMonth} · issued {draft.issuedOn} · {fmtUsd(draft.totalUsd)}</p>
                <p className="text-sm text-muted-foreground">Confirm these details against {draft.file.name}. The reviewed invoice will be queued for OpsHub.</p>
                <div className="flex gap-2">
                  <Button type="button" onClick={submit} disabled={busy}>Confirm and import</Button>
                  <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={busy}>Edit details</Button>
                </div>
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {Boolean(data?.invoices.length) && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b bg-muted/30">
                <th className="p-2">Month</th><th className="p-2">Invoice</th><th className="p-2">Actual USD</th>
                <th className="p-2">OpsHub status</th><th className="p-2">Actions</th>
              </tr></thead>
              <tbody>{data.invoices.map(row => (
                <tr key={row.billingMonth} className="border-b last:border-0">
                  <td className="p-2">{row.billingMonth}</td><td className="p-2">{row.invoiceNumber}</td>
                  <td className="p-2">{fmtCents(row.amountMinor)}</td>
                  <td className="p-2">
                    <Badge variant={row.syncStatus === 'needs_reconciliation' ? 'destructive' : 'secondary'}>{labels[row.syncStatus] || row.syncStatus}</Badge>
                    {row.reason && <p className="mt-1 text-xs text-muted-foreground">{row.reason}</p>}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => download(row)}>PDF</Button>
                    {['dead_letter','needs_reconciliation'].includes(row.syncStatus) &&
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => {
                        await v2Admin.retryLiveKitInvoice(row.billingMonth);
                        setRequest(value => value + 1);
                      })}>Retry sync</Button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
