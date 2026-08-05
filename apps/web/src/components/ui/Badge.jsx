import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary-100 text-primary-700',
        secondary: 'bg-secondary-100 text-secondary-700',
        success: 'bg-emerald-100 text-emerald-700',
        warning: 'bg-amber-100 text-amber-700',
        danger: 'bg-red-100 text-red-700',
        info: 'bg-blue-100 text-blue-700',
        outline: 'border border-primary-300 text-primary-700',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Badge = forwardRef(({ className, variant, children, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(badgeVariants({ variant }), className)}
    {...props}
  >
    {children}
  </span>
));

Badge.displayName = 'Badge';

export { Badge, badgeVariants };
