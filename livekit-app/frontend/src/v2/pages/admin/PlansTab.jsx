import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';
import { fmtCents } from './formatters';
import { useAuditReason, orgKey } from './useAuditReason';

const NUMERIC_FIELDS = [
  'monthly_price_cents',
  'included_meeting_minutes',
  'included_translation_minutes',
  'overage_meeting_cents_per_min',
  'overage_translation_cents_per_min',
];

const EDITABLE_FIELDS = ['name', ...NUMERIC_FIELDS, 'stripe_price_id'];

export function PlansTab() {
  const [plans, setPlans] = useState([]);
  const [edits, setEdits] = useState({});
  const [savingId, setSavingId] = useState(null);
  const { auditReason, auditReasonError, updateAuditReason, requireAuditReason } = useAuditReason(null);

  const reload = () =>
    v2Admin
      .plans()
      .then((r) => {
        setPlans(r.plans || []);
        setEdits({});
      })
      .catch(() => toast.error('Failed to load plans'));

  useEffect(() => {
    reload();
  }, []);

  const fieldValue = (plan, field) => {
    const rowEdits = edits[plan.id] || {};
    return rowEdits[field] ?? plan[field] ?? (NUMERIC_FIELDS.includes(field) ? 0 : '');
  };

  const setField = (planId, field, value) => {
    setEdits((prev) => ({ ...prev, [planId]: { ...prev[planId], [field]: value } }));
  };

  const savePlan = async (plan) => {
    const reason = requireAuditReason(plan.id);
    if (!reason) return;
    const body = { reason };
    EDITABLE_FIELDS.forEach((field) => {
      const raw = fieldValue(plan, field);
      body[field] = NUMERIC_FIELDS.includes(field) ? Math.max(0, Number(raw) || 0) : raw;
    });
    setSavingId(plan.id);
    try {
      await v2Admin.patchPlan(plan.id, body);
      toast.success(`Plan “${plan.id}” saved`);
      await reload();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save plan');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card className="app-card overflow-hidden border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Plans</CardTitle>
        <CardDescription>
          Edit pricing and entitlements per plan. Each save requires an audit reason (4+ chars) and is written to the
          admin audit log. Prices and overage rates are in cents.
        </CardDescription>
      </CardHeader>
      <div className="overflow-x-auto border-t border-border/60">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium">Plan</th>
              <th className="px-3 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Price (¢/mo)</th>
              <th className="px-3 py-3 font-medium">Incl. meeting min</th>
              <th className="px-3 py-3 font-medium">Incl. translation min</th>
              <th className="px-3 py-3 font-medium">Overage meeting ¢/min</th>
              <th className="px-3 py-3 font-medium">Overage transl. ¢/min</th>
              <th className="px-3 py-3 font-medium">Stripe price ID</th>
              <th className="px-3 py-3 font-medium">Audit reason</th>
              <th className="px-3 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => {
              const key = orgKey(plan.id);
              const invalid = auditReasonError === key;
              return (
                <tr key={plan.id} className="border-b border-border/60 last:border-0 align-top">
                  <td className="px-3 py-3 font-medium whitespace-nowrap">
                    {plan.id}
                    <div className="text-xs font-normal text-muted-foreground">
                      {fmtCents(plan.monthly_price_cents)}/mo
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Input
                      aria-label={`${plan.id} name`}
                      className="h-9 w-32"
                      value={fieldValue(plan, 'name')}
                      onChange={(e) => setField(plan.id, 'name', e.target.value)}
                    />
                  </td>
                  {NUMERIC_FIELDS.map((field) => (
                    <td key={field} className="px-3 py-3">
                      <Input
                        aria-label={`${plan.id} ${field}`}
                        type="number"
                        min={0}
                        className="h-9 w-28 tabular-nums"
                        value={fieldValue(plan, field)}
                        onChange={(e) => setField(plan.id, field, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-3">
                    <Input
                      aria-label={`${plan.id} stripe price id`}
                      className="h-9 w-40"
                      placeholder="price_…"
                      value={fieldValue(plan, 'stripe_price_id')}
                      onChange={(e) => setField(plan.id, 'stripe_price_id', e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <Input
                      id={`audit-reason-${key}`}
                      aria-label={`${plan.id} audit reason`}
                      autoComplete="off"
                      placeholder="Reason (4+ chars)"
                      className={cn(
                        'h-9 w-44',
                        invalid && 'border-destructive focus-visible:ring-destructive aria-invalid:border-destructive'
                      )}
                      aria-invalid={invalid}
                      value={auditReason[key] ?? ''}
                      onChange={(e) => updateAuditReason(plan.id, e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingId === plan.id}
                      onClick={() => savePlan(plan)}
                    >
                      {savingId === plan.id ? 'Saving…' : 'Save'}
                    </Button>
                  </td>
                </tr>
              );
            })}
            {plans.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={10}>
                  No plans configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default PlansTab;
