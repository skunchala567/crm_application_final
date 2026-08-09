import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold transition-all duration-200 active:scale-[.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 whitespace-nowrap text-sm',
  {
    variants: {
      variant: {
        primary: 'bg-primary-600 text-white shadow-brand hover:bg-primary-700 active:bg-primary-800 focus-visible:ring-primary-500',
        secondary: 'bg-surface-3 text-secondary-600 border border-border hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200 focus-visible:ring-primary-500',
        ghost: 'text-secondary-700 hover:bg-primary-50 hover:text-primary-700 active:bg-primary-100 focus-visible:ring-primary-500',
        danger: 'bg-danger-bg text-danger border border-transparent hover:bg-danger hover:text-white focus-visible:ring-danger',
        success: 'bg-primary-600 text-white shadow-brand hover:bg-primary-700 active:bg-primary-800 focus-visible:ring-primary-500',
        outline: 'border border-border text-secondary-600 hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200 focus-visible:ring-primary-500',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

const Button = forwardRef(({ className, variant, size, children, ...props }, ref) => (
  <button
    className={cn(buttonVariants({ variant, size, className }))}
    ref={ref}
    {...props}
  >
    {children}
  </button>
));

Button.displayName = 'Button';

export { Button, buttonVariants };
