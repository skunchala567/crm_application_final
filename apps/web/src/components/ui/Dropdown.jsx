import { useState, forwardRef, createContext, useContext, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

const DropdownContext = createContext();

const useDropdownContext = () => {
  const context = useContext(DropdownContext);
  if (!context) {
    throw new Error('Dropdown components must be used within Dropdown');
  }
  return context;
};

const Dropdown = ({ children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div ref={ref} className="relative">
        {children}
      </div>
    </DropdownContext.Provider>
  );
};

const DropdownTrigger = forwardRef(({ children, className, ...props }, ref) => {
  const { open, setOpen } = useDropdownContext();

  return (
    <button
      ref={ref}
      onClick={() => setOpen(!open)}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-white hover:bg-secondary-50 transition-colors',
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
    </button>
  );
});
DropdownTrigger.displayName = 'DropdownTrigger';

const DropdownContent = forwardRef(({ className, align = 'left', ...props }, ref) => {
  const { open } = useDropdownContext();

  if (!open) return null;

  const alignClass = {
    left: 'left-0',
    right: 'right-0',
    center: 'left-1/2 -translate-x-1/2',
  };

  return (
    <div
      ref={ref}
      className={cn(
        'absolute top-full mt-2 z-50 min-w-48 rounded-lg border border-border bg-white shadow-lg',
        alignClass[align],
        'animate-fadeIn',
        className
      )}
      {...props}
    />
  );
});
DropdownContent.displayName = 'DropdownContent';

const DropdownItem = forwardRef(({ className, onClick, ...props }, ref) => {
  const { setOpen } = useDropdownContext();

  return (
    <button
      ref={ref}
      onClick={(e) => {
        onClick?.(e);
        setOpen(false);
      }}
      className={cn(
        'w-full text-left px-4 py-2.5 text-sm hover:bg-secondary-50 transition-colors',
        'first:rounded-t-lg last:rounded-b-lg',
        className
      )}
      {...props}
    />
  );
});
DropdownItem.displayName = 'DropdownItem';

const DropdownSeparator = forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('h-px bg-border my-1', className)}
    {...props}
  />
));
DropdownSeparator.displayName = 'DropdownSeparator';

export {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
};
