import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      'flex min-h-[72px] w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[13.5px] leading-[1.45] text-fg placeholder:text-faint focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-primary-border disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };
