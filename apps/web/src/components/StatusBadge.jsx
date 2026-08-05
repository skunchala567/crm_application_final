import { Badge } from './ui';

const statusVariantMap = {
  'new': 'info',
  'application': 'success',
  'admitted': 'success',
  'campus-visit': 'warning',
  'enrolled': 'success',
  'inactive': 'secondary',
  'rejected': 'danger',
  'pending': 'warning',
  'active': 'success',
};

export function StatusBadge({ stage, className, ...props }) {
  const variant = statusVariantMap[stage?.toLowerCase()?.replace(' ', '-')] || 'secondary';

  return (
    <Badge variant={variant} className={className} {...props}>
      {stage}
    </Badge>
  );
}

export default StatusBadge;
