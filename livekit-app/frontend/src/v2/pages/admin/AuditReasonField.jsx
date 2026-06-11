import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';
import { orgKey } from './useAuditReason';

/**
 * Reusable audit-reason input. The input id is `audit-reason-${auditKey}` so the
 * useAuditReason hook can read it from the DOM before a privileged mutation.
 */
export function AuditReasonField({ auditKey, value, onChange, error, inputRef, label }) {
  const key = orgKey(auditKey);
  const invalid = error === key;
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
      <label htmlFor={`audit-reason-${key}`} className="text-sm font-medium">
        {label || 'Audit reason'} <span className="text-destructive">*</span>
      </label>
      <p className="text-xs text-muted-foreground">
        Required before saving. Use at least 4 characters — this is written to the admin audit log.
      </p>
      <Input
        ref={inputRef}
        id={`audit-reason-${key}`}
        type="text"
        autoComplete="off"
        placeholder="e.g. Founder account — unlimited access"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        className={cn(
          invalid && 'border-destructive focus-visible:ring-destructive aria-invalid:border-destructive'
        )}
        aria-invalid={invalid}
      />
    </div>
  );
}

export default AuditReasonField;
