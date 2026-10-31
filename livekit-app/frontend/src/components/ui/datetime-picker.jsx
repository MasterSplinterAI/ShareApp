import * as React from 'react';
import {
  addDays,
  format,
  isSameDay,
  isToday,
  isTomorrow,
  setHours,
  setMilliseconds,
  setMinutes,
  setSeconds,
  startOfToday,
} from 'date-fns';
import { Calendar as CalendarIcon, Clock, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { Calendar } from './calendar';

const MINUTE_STEPS = [0, 15, 30, 45];
const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Default to the next upcoming 30-minute slot today (or tomorrow morning if late at night). */
export function getNextRoundedScheduleDate() {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  const mins = next.getMinutes();
  if (mins < 30) {
    next.setMinutes(30);
  } else {
    next.setHours(next.getHours() + 1);
    next.setMinutes(0);
  }
  return next;
}

function applyTime(baseDate, hour24, minute) {
  return setMilliseconds(setSeconds(setMinutes(setHours(new Date(baseDate), hour24), minute), 0), 0);
}

function getShortTimezoneName() {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

/** Build 4 compact quick slot chips for the selected day (fits in a 4-col grid with zero horizontal overflow). */
function buildQuickSlots(selectedDate) {
  const base = selectedDate || startOfToday();
  const now = new Date();
  const todaySelected = isSameDay(base, now);
  const slots = [];

  for (let h = 0; h < 24; h += 1) {
    for (const m of [0, 30]) {
      const slotDate = applyTime(base, h, m);
      if (todaySelected && slotDate.getTime() <= now.getTime() + 5 * 60 * 1000) {
        continue;
      }
      if (!todaySelected && (h < 9 || h > 17)) {
        continue;
      }
      slots.push({
        hour24: h,
        minute: m,
        label: format(slotDate, 'h:mm a'),
      });
    }
  }
  return slots.slice(0, 4);
}

/**
 * Modern, mobile-first inline/expandable Date & Time picker.
 * @param {Date | null | undefined} value
 * @param {(d: Date | undefined) => void} onChange
 */
export function DatetimePicker({
  value,
  onChange,
  placeholder = 'Instant — tap to schedule date & time',
  disabled,
  className,
  id,
  defaultExpanded = false,
  alwaysOpen = false,
}) {
  const validDate =
    value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
  const [expanded, setExpanded] = React.useState(Boolean(alwaysOpen || defaultExpanded || validDate));

  React.useEffect(() => {
    if ((alwaysOpen || defaultExpanded) && !validDate) {
      onChange?.(getNextRoundedScheduleDate());
      setExpanded(true);
    }
  }, [alwaysOpen, defaultExpanded]);

  const activeDate = validDate || getNextRoundedScheduleDate();
  const hour24 = activeDate.getHours();
  const minute = activeDate.getMinutes();
  const isPm = hour24 >= 12;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const roundedMinute = MINUTE_STEPS.reduce((prev, curr) =>
    Math.abs(curr - minute) < Math.abs(prev - minute) ? curr : prev
  );
  const tzLabel = React.useMemo(() => getShortTimezoneName(), []);
  const quickSlots = React.useMemo(() => buildQuickSlots(activeDate), [activeDate]);

  const today = startOfToday();
  const tomorrow = addDays(today, 1);
  const inTwoDays = addDays(today, 2);

  const handleToggleOpen = () => {
    if (disabled) return;
    if (!expanded) {
      if (!validDate) {
        onChange?.(getNextRoundedScheduleDate());
      }
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  };

  const handleClear = (e) => {
    e?.stopPropagation?.();
    onChange?.(undefined);
    setExpanded(false);
  };

  const selectDay = (day) => {
    if (!day) return;
    const next = new Date(activeDate);
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    onChange?.(applyTime(next, hour24, roundedMinute));
  };

  const selectHour12 = (nextH12) => {
    const baseHour = nextH12 % 12;
    const nextH24 = isPm ? baseHour + 12 : baseHour;
    onChange?.(applyTime(activeDate, nextH24, roundedMinute));
  };

  const selectMinute = (nextMin) => {
    onChange?.(applyTime(activeDate, hour24, nextMin));
  };

  const selectPeriod = (wantPm) => {
    if (wantPm === isPm) return;
    const nextH24 = wantPm ? (hour24 % 12) + 12 : hour24 % 12;
    onChange?.(applyTime(activeDate, nextH24, roundedMinute));
  };

  const summaryLabel = validDate
    ? `${isToday(validDate) ? 'Today' : isTomorrow(validDate) ? 'Tomorrow' : format(validDate, 'EEE, MMM d')} · ${format(validDate, 'h:mm a')}${tzLabel ? ` ${tzLabel}` : ''}`
    : placeholder;

  const isPanelOpen = alwaysOpen || expanded;

  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      {/* Summary trigger button (hidden when alwaysOpen is true so the modal stays compact) */}
      {!alwaysOpen && (
        <div className="flex min-w-0 items-center gap-2">
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={handleToggleOpen}
            className={cn(
              'h-10 min-w-0 flex-1 justify-start text-left font-normal transition-colors',
              validDate
                ? 'border-primary/50 bg-primary/[0.04] font-medium text-foreground'
                : 'text-muted-foreground'
            )}
          >
            <CalendarIcon className={cn('mr-2 h-4 w-4 shrink-0', validDate ? 'text-primary' : 'text-muted-foreground')} />
            <span className="truncate text-xs sm:text-sm">{summaryLabel}</span>
          </Button>
          {validDate && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleClear}
              className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Clear scheduled time"
              title="Switch back to instant meeting"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {isPanelOpen && (
        <div className="min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
          {/* Quick day pills + selected summary */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-border/60 bg-muted/30 px-2.5 py-2">
            <div className="flex items-center gap-1">
              {[
                { label: 'Today', date: today },
                { label: 'Tomorrow', date: tomorrow },
                { label: format(inTwoDays, 'EEE d'), date: inTwoDays },
              ].map((preset) => {
                const active = isSameDay(activeDate, preset.date);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => selectDay(preset.date)}
                    className={cn(
                      'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground'
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            {alwaysOpen && validDate && (
              <span className="truncate text-[11px] font-medium text-primary">
                {summaryLabel}
              </span>
            )}
          </div>

          {/* Month Calendar */}
          <Calendar
            mode="single"
            selected={activeDate}
            defaultMonth={activeDate}
            disabled={{ before: today }}
            onSelect={(day) => {
              if (day) selectDay(day);
            }}
          />

          {/* Compact Time Selector */}
          <div className="border-t border-border/60 bg-muted/20 p-2.5 sm:p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" />
                Time
              </span>
              {tzLabel && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {tzLabel}
                </span>
              )}
            </div>

            {/* 4-column grid of quick time chips (never overflows horizontally) */}
            {quickSlots.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {quickSlots.map((slot) => {
                  const selected =
                    hour24 === slot.hour24 && roundedMinute === slot.minute;
                  return (
                    <button
                      key={slot.label}
                      type="button"
                      onClick={() =>
                        onChange?.(applyTime(activeDate, slot.hour24, slot.minute))
                      }
                      className={cn(
                        'truncate rounded-lg border px-1.5 py-1.5 text-[11px] font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : 'border-border/70 bg-background text-foreground hover:border-primary/40 hover:bg-muted/60'
                      )}
                    >
                      {slot.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 12-hour + minute + AM/PM controls */}
            <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1.5 sm:gap-2">
              <select
                aria-label="Hour"
                value={hour12}
                onChange={(e) => selectHour12(Number(e.target.value))}
                className="h-9 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-center text-base font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm"
              >
                {HOURS_12.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>

              <span className="text-sm font-bold text-muted-foreground">:</span>

              <select
                aria-label="Minute"
                value={roundedMinute}
                onChange={(e) => selectMinute(Number(e.target.value))}
                className="h-9 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-center text-base font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm"
              >
                {MINUTE_STEPS.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}
                  </option>
                ))}
              </select>

              <div className="inline-flex h-9 rounded-lg border border-input bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => selectPeriod(false)}
                  className={cn(
                    'rounded-md px-2 text-xs font-semibold transition-colors',
                    !isPm
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={() => selectPeriod(true)}
                  className={cn(
                    'rounded-md px-2 text-xs font-semibold transition-colors',
                    isPm
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  PM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
