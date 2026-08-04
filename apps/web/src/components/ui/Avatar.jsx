import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Avatar = forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-600 text-sm font-bold text-white',
      className
    )}
    {...props}
  />
));

Avatar.displayName = 'Avatar';

const AvatarImage = forwardRef(({ className, ...props }, ref) => (
  <img
    ref={ref}
    className={cn('h-full w-full rounded-full object-cover', className)}
    {...props}
  />
));

AvatarImage.displayName = 'AvatarImage';

const AvatarFallback = forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center rounded-full bg-primary-100 text-primary-700',
      className
    )}
    {...props}
  />
));

AvatarFallback.displayName = 'AvatarFallback';

export { Avatar, AvatarImage, AvatarFallback };
