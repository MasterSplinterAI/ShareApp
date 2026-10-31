import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { cn } from '../../lib/utils';

function Calendar({ className, classNames, showOutsideDays = true, ...props }) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3 w-full', className)}
      classNames={{
        months: 'flex flex-col w-full',
        month: 'space-y-3 w-full',
        caption: 'flex justify-between pt-0.5 relative items-center px-1',
        caption_label: 'text-sm font-semibold text-foreground',
        nav: 'flex items-center gap-1',
        nav_button: cn(
          'h-8 w-8 bg-transparent p-0 text-muted-foreground hover:text-foreground inline-flex items-center justify-center rounded-lg border border-border/60 hover:bg-muted transition-colors'
        ),
        nav_button_previous: '',
        nav_button_next: '',
        table: 'w-full border-collapse',
        head_row: 'grid grid-cols-7 w-full mb-1',
        head_cell:
          'text-muted-foreground rounded-md font-medium text-[0.75rem] text-center py-1',
        row: 'grid grid-cols-7 w-full mt-1 gap-y-1',
        cell: 'text-center text-sm p-0 relative flex items-center justify-center focus-within:relative focus-within:z-20',
        day: cn(
          'h-9 w-9 sm:h-9 sm:w-9 p-0 font-normal rounded-lg transition-colors hover:bg-muted hover:text-foreground inline-flex items-center justify-center text-sm cursor-pointer select-none'
        ),
        day_selected:
          '!bg-primary !text-primary-foreground font-semibold shadow-sm hover:!bg-primary/90 focus:!bg-primary',
        day_today:
          'ring-2 ring-primary/70 bg-primary/10 font-semibold text-primary',
        day_outside:
          'day-outside text-muted-foreground/45 aria-selected:bg-primary/80 aria-selected:text-primary-foreground',
        day_disabled:
          'text-muted-foreground/30 opacity-40 pointer-events-none cursor-not-allowed',
        day_range_middle:
          'aria-selected:bg-accent aria-selected:text-accent-foreground',
        day_hidden: 'invisible',
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronLeft className="h-4 w-4" />,
        IconRight: () => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
