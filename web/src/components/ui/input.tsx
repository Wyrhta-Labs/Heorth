import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[13.5px] text-fg transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-faint focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-primary-border disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
