import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "./api";
import "./PublicEnquiryForm.css";

export default function PublicEnquiryForm({ formKey }) {
  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [status, setStatus] = useState({ loading: true, saving: false, error: "", success: "" });
  useEffect(() => {
    setStatus({ loading: true, saving: false, error: "", success: "" });
    api(`/public/enquiry-forms/${formKey}`)
      .then(result => {
        setForm(result.form);
        setValues(Object.fromEntries((result.form.fields || []).map(field => [field.fieldKey, ""])));
        setStatus({ loading: false, saving: false, error: "", success: "" });
      })
      .catch(error => setStatus({ loading: false, saving: false, error: error.message, success: "" }));
  }, [formKey]);
  const color = form?.color || "#4A4FB1";
  const fields = useMemo(() => form?.fields || [], [form]);
  const update = (fieldKey, value) => setValues(current => ({ ...current, [fieldKey]: value }));
  async function submit(event) {
    event.preventDefault();
    setStatus(current => ({ ...current, saving: true, error: "" }));
    try {
      const result = await api(`/public/enquiry-forms/${formKey}/submit`, { method: "POST", body: JSON.stringify({ values, website: "" }) });
      setStatus({ loading: false, saving: false, error: "", success: result.message || form.successMessage });
      if (form.redirectUrl) window.setTimeout(() => { window.location.href = form.redirectUrl; }, 900);
    } catch (error) {
      setStatus(current => ({ ...current, saving: false, error: error.message }));
    }
  }
  if (status.loading) return <main className="public-enquiry-page"><div className="public-enquiry-card loading"><Loader2 />Loading form...</div></main>;
  if (status.error && !form) return <main className="public-enquiry-page"><div className="public-enquiry-card"><h1>Form unavailable</h1><p>{status.error}</p></div></main>;
  if (status.success) return <main className="public-enquiry-page"><section className="public-enquiry-card success" style={{ "--accent": color }}><CheckCircle2 /><h1>Enquiry submitted</h1><p>{status.success}</p></section></main>;
  return <main className="public-enquiry-page" style={{ "--accent": color }}>
    <section className="public-enquiry-card">
      <header><span>{form.businessUnitName}</span><h1>{form.name}</h1>{form.description && <p>{form.description}</p>}</header>
      <form onSubmit={submit}>
        {fields.map(field => <PublicField key={field.fieldKey} field={field} value={values[field.fieldKey] ?? ""} onChange={value => update(field.fieldKey, value)} />)}
        <input className="website-field" tabIndex="-1" autoComplete="off" value="" readOnly name="website" />
        {status.error && <div className="public-form-error">{status.error}</div>}
        <button disabled={status.saving}>{status.saving ? "Submitting..." : "Submit enquiry"}</button>
      </form>
    </section>
  </main>;
}

function PublicField({ field, value, onChange }) {
  const label = <>{field.label || field.displayName}{field.required ? " *" : ""}</>;
  const type = field.fieldType === "email" ? "email" : field.fieldType === "phone" ? "tel" : ["date", "datetime"].includes(field.fieldType) ? (field.fieldType === "datetime" ? "datetime-local" : "date") : "text";
  if (["single_select", "multi_select"].includes(field.fieldType) || field.options?.length) {
    const multiple = field.fieldType === "multi_select";
    return <label>{label}<select required={field.required} multiple={multiple} value={multiple ? (Array.isArray(value) ? value : []) : value} onChange={event => onChange(multiple ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value)}>{!multiple && <option value="">Select {String(field.label || field.displayName).toLowerCase()}</option>}{(field.options || []).map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}</select></label>;
  }
  if (field.fieldType === "textarea") return <label className="wide">{label}<textarea required={field.required} rows="4" value={value} onChange={event => onChange(event.target.value)} placeholder={field.placeholder || ""} /></label>;
  return <label>{label}<input required={field.required} type={type} value={value} onChange={event => onChange(event.target.value)} placeholder={field.placeholder || ""} /></label>;
}
