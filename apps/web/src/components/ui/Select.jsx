import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

const Select = forwardRef(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        'flex h-10 w-full appearance-none rounded-md border border-border bg-white px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:border-transparent disabled:bg-secondary-50 disabled:text-secondary-400 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-500 pointer-events-none" />
  </div>
));

Select.displayName = 'Select';

export { Select };
