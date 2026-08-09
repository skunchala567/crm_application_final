import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Checkbox = forwardRef(
  ({ className, checked, indeterminate, ...props }, ref) => (
    <div className="relative">
      <input
        type="checkbox"
        ref={ref}
        className={cn(
          'h-4 w-4 rounded border border-border bg-white accent-primary-600 cursor-pointer',
          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        checked={checked}
        {...props}
      />
    </div>
  )
);

Checkbox.displayName = 'Checkbox';

export { Checkbox };
