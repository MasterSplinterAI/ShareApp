import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
        success:
          'border-transparent bg-emerald-100 text-emerald-800 hover:bg-emerald-100/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60',
        info: 'border-transparent bg-sky-100 text-sky-800 hover:bg-sky-100/80 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/60',
        warning:
          'border-transparent bg-amber-100 text-amber-800 hover:bg-amber-100/80 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60',
        muted:
          'border-border bg-muted text-muted-foreground hover:bg-muted/80 dark:border-border dark:bg-muted dark:text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
