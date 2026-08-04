import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Textarea = forwardRef(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      'flex min-h-[80px] w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:border-transparent disabled:bg-secondary-50 disabled:text-secondary-400 disabled:cursor-not-allowed resize-none',
      className
    )}
    ref={ref}
    {...props}
  />
));

Textarea.displayName = 'Textarea';

export { Textarea };
