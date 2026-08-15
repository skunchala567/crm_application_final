import { useState } from 'react';
import { CreditCard, ExternalLink, Zap } from 'lucide-react';
import PaymentFormsPage from './PaymentFormsPage.jsx';
import PaymentCollectionsPage from './PaymentCollectionsPage.jsx';
import EnquiryFormsSettings from './EnquiryFormsSettings.jsx';
import { usePermissions } from '../PermissionContext';

/**
 * Payments in one place: the forms that ask for money, and what came back.
 *
 * These were two sidebar entries, but they are two halves of one job -- you
 * publish a form, then you look at what it collected -- so switching between
 * them meant leaving the section and coming back. A tab each keeps both a
 * click apart.
 */
const TABS = [
  { id: 'forms', label: 'Payment Forms', Icon: Zap, Component: PaymentFormsPage, permission: 'payments.forms.view' },
  { id: 'collections', label: 'Collections', Icon: CreditCard, Component: PaymentCollectionsPage, permission: 'payments.collections.view' },
  /* Enquiry forms live here rather than under Business Units: a public form
     that takes an application fee is payment work, not unit configuration. */
  { id: 'enquiry', label: 'Enquiry Forms', Icon: ExternalLink, Component: EnquiryFormsSettings, permission: 'payments.enquiry_forms.view' },
];

export default function PaymentsSettings(props) {
  const { can } = usePermissions();
  /* A tab per thing the user may actually open. The three used to share one
     permission, so a branch manager could not be given Collections without
     also being given the public form builder; now that they are separate keys,
     a tab the server would refuse is not offered. */
  const tabs = TABS.filter(item => can(item.permission));
  const [tab, setTab] = useState(tabs[0]?.id || 'forms');
  const active = tabs.find(item => item.id === tab) || tabs[0];

  if (!active) {
    return <div className="empty"><strong>No payments access</strong><p>Ask an administrator for access to payment forms, collections or enquiry forms.</p></div>;
  }
  const Active = active.Component;

  return (
    <section className="academic-config-panel embedded">
      <div className="config-tabs academic-config-tabs" role="tablist" aria-label="Payments">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div className="academic-tab-content" role="tabpanel">
        {/* Keyed so switching tabs remounts rather than carrying one screen's
            filters or half-filled form into the other. */}
        <Active key={active.id} {...props} />
      </div>
    </section>
  );
}
