import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-semibold',
  {
    variants: {
      variant: {
        default: 'bg-primary-light text-primary border-primary-border',
        secondary: 'bg-surface-3 text-fg border-transparent',
        outline: 'bg-surface-2 text-muted border-line',
        success: 'bg-success-bg text-success border-success-border',
        warning: 'bg-warning-bg text-warning border-warning-border',
        destructive: 'bg-danger-bg text-danger border-danger-border',
        info: 'bg-info-bg text-info border-info-border',
        accent: 'bg-accent-bg text-accent border-accent-border',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
