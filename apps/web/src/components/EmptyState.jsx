import { cn } from '../lib/utils';
import { Button } from './ui';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 px-4 text-center',
        className
      )}
    >
      {Icon && (
        <div className="mb-4 p-3 rounded-full bg-secondary-100">
          <Icon size={32} className="text-secondary-600" />
        </div>
      )}

      <h3 className="text-lg font-semibold text-foreground mb-1">
        {title}
      </h3>

      {description && (
        <p className="text-sm text-secondary-600 mb-6 max-w-sm">
          {description}
        </p>
      )}

      {action && (
        <Button onClick={action.onClick} size="sm">
          {action.label}
        </Button>
      )}
    </div>
  );
}

export default EmptyState;
