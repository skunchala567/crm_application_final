import { useState } from 'react';
import { Mail, MessageCircle, MessageSquare } from 'lucide-react';
import WhatsAppTemplatesSettings from '../WhatsAppTemplatesSettings.jsx';
import SmsTemplatesSettings from './SmsTemplatesSettings.jsx';
import EmailTemplatesSettings from './EmailTemplatesSettings.jsx';
import { usePermissions } from '../PermissionContext.jsx';

/**
 * Every message template in one place.
 *
 * The three channels were three separate settings screens, so composing the
 * same announcement across them meant hunting through the menu -- and there
 * was nowhere at all for SMS. They differ in where a template comes from
 * (WhatsApp syncs from the provider, SMS carries a DLT Content ID, email is
 * written here) but not in what an administrator is doing, so they belong
 * behind one door with a tab each.
 */
const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle, Component: WhatsAppTemplatesSettings, permission: 'whatsapp.templates.view' },
  { id: 'sms', label: 'SMS', Icon: MessageSquare, Component: SmsTemplatesSettings, permission: 'sms.templates.view' },
  { id: 'email', label: 'Email', Icon: Mail, Component: EmailTemplatesSettings, permission: 'email.templates.view' },
];

export default function MessageTemplatesSettings(props) {
  const { can } = usePermissions();
  const channels = CHANNELS.filter(item=>can(item.permission));
  const [channel, setChannel] = useState('whatsapp');
  const active = channels.find(item => item.id === channel) || channels[0];
  if(!active)return <div className="empty"><strong>No template access</strong><p>Ask an administrator for access to a message-template channel.</p></div>;
  const Active = active.Component;

  return (
    <section className="academic-config-panel embedded">
      <div className="config-tabs academic-config-tabs" role="tablist" aria-label="Message template channels">
        {channels.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={channel === id}
            className={channel === id ? 'active' : ''}
            onClick={() => setChannel(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div className="academic-tab-content" role="tabpanel">
        {/* Keyed so switching channels remounts rather than carrying one
            channel's half-filled form into another. */}
        <Active key={active.id} {...props} />
      </div>
    </section>
  );
}
