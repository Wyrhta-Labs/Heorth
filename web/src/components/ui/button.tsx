import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control border-[1.5px] border-transparent text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-on-primary hover:bg-primary-hover',
        outline: 'border-line-strong bg-transparent text-muted hover:border-muted hover:bg-surface-2 hover:text-fg',
        secondary: 'bg-surface-3 text-fg hover:bg-line',
        ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
        destructive: 'bg-danger-bg border-danger-border text-danger hover:border-danger',
        warning: 'bg-warning-bg border-warning-border text-warning hover:border-warning',
        success: 'bg-success text-on-primary hover:brightness-95',
        link: 'border-0 px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-[30px] px-[11px] text-xs',
        lg: 'h-10 px-6',
        icon: 'h-9 w-9 [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = 'Button';

export { Button, buttonVariants };
