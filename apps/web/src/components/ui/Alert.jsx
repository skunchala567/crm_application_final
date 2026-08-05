import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-white text-foreground border-border',
        destructive: 'border-red-200 bg-red-50 text-red-800 [&>svg]:text-red-600',
        warning: 'border-amber-200 bg-amber-50 text-amber-800 [&>svg]:text-amber-600',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-800 [&>svg]:text-emerald-600',
        info: 'border-blue-200 bg-blue-50 text-blue-800 [&>svg]:text-blue-600',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Alert = forwardRef(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(alertVariants({ variant }), className)}
    role="alert"
    {...props}
  />
));
Alert.displayName = 'Alert';

const AlertTitle = forwardRef(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('mb-1 font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription, alertVariants };
