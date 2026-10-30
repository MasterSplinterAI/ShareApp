import * as React from 'react';
import { format, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Label } from './label';

/**
 * @param {Date | null | undefined} value
 * @param {(d: Date | undefined) => void} onChange
 */
export function DatetimePicker({ value, onChange, placeholder = 'Pick date & time', disabled, className, id }) {
  const [open, setOpen] = React.useState(false);
  const d = value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;

  const hour = d ? d.getHours() : 9;
  const minute = d ? d.getMinutes() : 0;

  const applyTime = (nextDate, h, m) =>
    setMilliseconds(setSeconds(setMinutes(setHours(nextDate, h), m), 0), 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          className={cn('w-full justify-start text-left font-normal', !d && 'text-muted-foreground', className)}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {d ? format(d, 'PPp') : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={d}
          onSelect={(date) => {
            if (!date) {
              onChange?.(undefined);
              return;
            }
            const base = d ? new Date(d) : new Date();
            base.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
            onChange?.(applyTime(base, hour, minute));
          }}
          initialFocus
        />
        <div className="border-t border-border p-3 space-y-2">
          <Label className="text-xs text-muted-foreground">Time</Label>
          <div className="flex gap-2 items-center">
            <select
              className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={hour}
              disabled={!d}
              onChange={(e) => {
                const h = Number(e.target.value);
                if (!d) return;
                onChange?.(applyTime(d, h, minute));
              }}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {String(i).padStart(2, '0')}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">:</span>
            <select
              className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={minute}
              disabled={!d}
              onChange={(e) => {
                const m = Number(e.target.value);
                if (!d) return;
                onChange?.(applyTime(d, hour, m));
              }}
            >
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, '0')}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange?.(undefined)}>
              Clear
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
