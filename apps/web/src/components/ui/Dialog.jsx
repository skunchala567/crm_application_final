import { useState, forwardRef, createContext, useContext, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

const DialogContext = createContext();

const useDialogContext = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('Dialog components must be used within Dialog');
  }
  return context;
};

const Dialog = ({ open: controlledOpen, onOpenChange, children, defaultOpen = false }) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const handleOpenChange = (newOpen) => {
    if (!isControlled) {
      setInternalOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  };

  return (
    <DialogContext.Provider value={{ open, onOpenChange: handleOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
};

const DialogTrigger = forwardRef(({ onClick, children, ...props }, ref) => {
  const { onOpenChange } = useDialogContext();

  return (
    <button
      ref={ref}
      onClick={(e) => {
        onOpenChange(true);
        onClick?.(e);
      }}
      {...props}
    >
      {children}
    </button>
  );
});
DialogTrigger.displayName = 'DialogTrigger';

const DialogPortal = ({ children }) => {
  const { open } = useDialogContext();

  if (!open) return null;

  return <>{children}</>;
};

const DialogOverlay = forwardRef(({ className, onClick, ...props }, ref) => {
  const { onOpenChange } = useDialogContext();

  return (
    <div
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-black/50',
        className
      )}
      onClick={(e) => {
        if (onClick) {
          onClick(e);
        } else {
          onOpenChange(false);
        }
      }}
      {...props}
    />
  );
});
DialogOverlay.displayName = 'DialogOverlay';

const DialogContent = forwardRef(({ className, children, onEscapeKeyDown, ...props }, ref) => {
  const { onOpenChange } = useDialogContext();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onEscapeKeyDown?.(e);
        if (!e.defaultPrevented) {
          onOpenChange(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpenChange, onEscapeKeyDown]);

  return (
    <DialogPortal>
      <DialogOverlay />
      <div
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-2xl border border-border bg-card p-6 shadow-lg',
          className
        )}
        {...props}
      >
        {children}
      </div>
    </DialogPortal>
  );
});
DialogContent.displayName = 'DialogContent';

const DialogHeader = ({ className, ...props }) => (
  <div
    className={cn('flex flex-col space-y-1.5 text-center sm:text-left mb-4', className)}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6 pt-6 border-t border-border',
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = forwardRef(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn('text-xl font-bold leading-none tracking-tight text-foreground', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = forwardRef(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

const DialogClose = forwardRef(({ className, ...props }, ref) => {
  const { onOpenChange } = useDialogContext();

  return (
    <button
      ref={ref}
      onClick={() => onOpenChange(false)}
      className={cn(
        'absolute right-4 top-4 rounded-md p-1 opacity-70 hover:opacity-100 transition-opacity',
        className
      )}
      {...props}
    >
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </button>
  );
});
DialogClose.displayName = 'DialogClose';

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
};
