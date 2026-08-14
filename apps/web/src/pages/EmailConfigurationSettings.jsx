import { useEffect, useState } from 'react';
import { CheckCircle2, Mail, Server } from 'lucide-react';
import { api } from '../api';

const initial = { enabled: true, smtpHost: '', smtpPort: 587, encryption: 'tls', smtpUsername: '', smtpPassword: '', fromName: '', fromEmail: '', replyToEmail: '', hasPassword: false };

export default function EmailConfigurationSettings({ onMessage }) {
  const [form, setForm] = useState(initial);
  const [testTo, setTestTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const load = () => api.get('/email/configuration').then(result => setForm({ ...initial, ...(result.data || {}), smtpPassword: '' })).catch(err => setError(err.message)).finally(() => setLoading(false));
  useEffect(load, []);

  const run = async action => {
    setBusy(action); setError('');
    try {
      if (action === 'save') {
        await api.put('/email/configuration', form);
        onMessage?.({ type: 'success', text: 'SMTP configuration saved' });
        await load();
      } else if (action === 'test') {
        await api.post('/email/configuration/test', {});
        onMessage?.({ type: 'success', text: 'SMTP connection and authentication succeeded' });
      } else {
        if (!testTo.trim()) throw new Error('Enter a test recipient email');
        await api.post('/email/configuration/test-email', { to: testTo.trim() });
        onMessage?.({ type: 'success', text: `Test email sent to ${testTo}` });
      }
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  if (loading) return <div className="p-8 text-secondary-500">Loading email configuration…</div>;
  return <main className="p-6 md:p-9 max-w-5xl mx-auto space-y-6">
    <header className="flex items-start gap-3"><span className="p-2.5 rounded-xl bg-primary-50 text-primary-600"><Server size={22}/></span><div><h1 className="text-2xl font-bold">Email Configuration</h1><p className="text-sm text-secondary-600 mt-1">Connect the CRM to your organization’s SMTP mail server.</p></div></header>
    {error && <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>}
    <section className="bg-white border border-secondary-200 rounded-xl p-6 space-y-5 shadow-sm">
      <label className="flex items-center gap-3 font-semibold"><input type="checkbox" checked={form.enabled} onChange={e=>set('enabled',e.target.checked)}/> Enable Email</label>
      <div className="grid md:grid-cols-2 gap-5">
        <Field label="SMTP Host *"><input value={form.smtpHost} onChange={e=>set('smtpHost',e.target.value)} placeholder="smtp.office365.com"/></Field>
        <Field label="SMTP Port *"><input type="number" min="1" max="65535" value={form.smtpPort} onChange={e=>set('smtpPort',Number(e.target.value))}/></Field>
        <Field label="Encryption *"><select value={form.encryption} onChange={e=>set('encryption',e.target.value)}><option value="none">None</option><option value="ssl">SSL</option><option value="tls">TLS / STARTTLS</option></select></Field>
        <Field label="SMTP Username *"><input value={form.smtpUsername} onChange={e=>set('smtpUsername',e.target.value)} autoComplete="off"/></Field>
        <Field label={`SMTP Password / App Password ${form.hasPassword?'(saved)':'*'}`}><input type="password" value={form.smtpPassword} onChange={e=>set('smtpPassword',e.target.value)} placeholder={form.hasPassword?'Leave blank to keep saved password':'Enter password'} autoComplete="new-password"/><small>For security, a saved password is never returned to this page.</small></Field>
        <Field label="From Name"><input value={form.fromName} onChange={e=>set('fromName',e.target.value)} placeholder="Admissions Team"/></Field>
        <Field label="From Email *"><input type="email" value={form.fromEmail} onChange={e=>set('fromEmail',e.target.value)}/></Field>
        <Field label="Reply-To Email"><input type="email" value={form.replyToEmail} onChange={e=>set('replyToEmail',e.target.value)}/></Field>
      </div>
      <footer className="flex flex-wrap gap-3 justify-end border-t pt-5"><button className="btn btn-outline" disabled={Boolean(busy)||!form.configured} onClick={()=>run('test')}>{busy==='test'?'Testing…':'Test Connection'}</button><button className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>run('save')}>{busy==='save'?'Saving…':'Save Configuration'}</button></footer>
    </section>
    <section className="bg-white border border-secondary-200 rounded-xl p-6 shadow-sm"><div className="flex items-center gap-2 mb-4"><Mail size={19}/><h2 className="font-bold">Send Test Email</h2></div><div className="flex gap-3"><input className="flex-1" type="email" value={testTo} onChange={e=>setTestTo(e.target.value)} placeholder="recipient@example.com"/><button className="btn btn-outline" disabled={Boolean(busy)||!form.configured} onClick={()=>run('send')}>{busy==='send'?'Sending…':<><CheckCircle2 size={16}/> Send Test Email</>}</button></div></section>
  </main>;
}

function Field({ label, children }) { return <label className="space-y-1.5 text-sm font-semibold text-secondary-800"><span>{label}</span>{children}</label>; }
