import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "./api";
import "./PublicEnquiryForm.css";

/**
 * What the capture script has been holding since the visitor first landed.
 *
 * crm-attribution.js is loaded from index.html and persists the first ad
 * click for 90 days, so this survives the visitor browsing the site and
 * coming back later -- which reading the query string here never did. If the
 * script is blocked or absent, the fields below still carry whatever is in
 * the current URL, so nothing gets worse than it was.
 */
function capturedAttribution() {
  try {
    return window.crmAttribution?.get?.() || null;
  } catch {
    return null;
  }
}

function publicTrackingPayload() {
  const params = new URLSearchParams(window.location.search);
  const pick = (...keys) => keys.map(key => params.get(key)).find(Boolean) || "";
  return {
    attribution: capturedAttribution(),
    branchId: pick("branchId", "branch_id"),
    academicYearId: pick("academicYearId", "academic_year_id"),
    academicYear: pick("academicYear", "academic_year"),
    instituteId: pick("instituteId", "institute_id"),
    sourceId: pick("sourceId", "source_id"),
    channelId: pick("channelId", "channel_id"),
    campaignId: pick("campaignId", "campaign_id"),
    utmSource: pick("utm_source"),
    utmMedium: pick("utm_medium"),
    utmCampaign: pick("utm_campaign"),
    utmTerm: pick("utm_term"),
    utmContent: pick("utm_content"),
    gclid: pick("gclid"),
    fbclid: pick("fbclid"),
    landingPage: window.location.href,
    referrer: document.referrer || "",
  };
}

function captureBrowserLocation(timeoutMs = 5000) {
  if (!navigator.geolocation) return Promise.resolve({ supported: false });
  return new Promise(resolve => {
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = window.setTimeout(() => done({ supported: true, captured: false, reason: "timeout" }), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      position => {
        window.clearTimeout(timer);
        done({
          supported: true,
          captured: true,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
        });
      },
      error => {
        window.clearTimeout(timer);
        done({ supported: true, captured: false, reason: error.code === 1 ? "permission_denied" : error.message || "unavailable" });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

function normalizeIndianPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function isValidIndianPhone(value) {
  return /^[6-9]\d{9}$/.test(normalizeIndianPhone(value));
}

function isValidEmail(value) {
  const email = String(value || "").trim();
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export default function PublicEnquiryForm({ formKey }) {
  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [payment, setPayment] = useState(null);
  const [status, setStatus] = useState({ loading: true, saving: false, error: "", success: "" });
  useEffect(() => {
    setStatus({ loading: true, saving: false, error: "", success: "" });
    api(`/public/enquiry-forms/${formKey}${window.location.search || ""}`)
      .then(result => {
        setForm(result.form);
        setValues(Object.fromEntries((result.form.fields || []).map(field => [field.fieldKey, ""])));
        setStatus({ loading: false, saving: false, error: "", success: "" });
      })
      .catch(error => setStatus({ loading: false, saving: false, error: error.message, success: "" }));
  }, [formKey]);
  const color = form?.color || "#0b7a4f";
  const fields = useMemo(() => form?.fields || [], [form]);
  const update = (fieldKey, value) => setValues(current => ({ ...current, [fieldKey]: value }));
  function validateForm() {
    const emailValue = String(values.email || values.student_email || "").trim();
    if (form?.payment?.enabled && !emailValue) return "Email is required before payment";
    if (form?.payment?.enabled && !isValidEmail(emailValue)) return "Enter a valid email address before payment";
    for (const field of fields) {
      const fieldValue = values[field.fieldKey];
      const label = field.label || field.displayName || field.fieldKey;
      if (field.required && (Array.isArray(fieldValue) ? !fieldValue.length : !String(fieldValue || "").trim())) {
        return `${label} is required`;
      }
      if (field.fieldType === "phone" && String(fieldValue || "").trim() && !isValidIndianPhone(fieldValue)) {
        return `${label} must be a valid Indian mobile number`;
      }
      if (field.fieldType === "email" && String(fieldValue || "").trim() && !isValidEmail(fieldValue)) {
        return `${label} must be a valid email address`;
      }
    }
    return "";
  }
  async function submit(event) {
    event.preventDefault();
    const error = validateForm();
    if (error) {
      setStatus(current => ({ ...current, saving: false, error }));
      return;
    }
    setStatus(current => ({ ...current, saving: true, error: "" }));
    try {
      const tracking = { ...publicTrackingPayload(), location: await captureBrowserLocation() };
      let paymentInfo = payment;
      if (form.payment?.enabled && !paymentInfo?.orderId) {
        paymentInfo = await api(`/public/enquiry-forms/${formKey}/payment-order`, { method: "POST", body: JSON.stringify({ values, tracking, website: "" }) });
        setPayment(paymentInfo);
      }
      const result = await api(`/public/enquiry-forms/${formKey}/submit`, { method: "POST", body: JSON.stringify({ values, tracking, payment: paymentInfo ? { orderId: paymentInfo.orderId, status: paymentInfo.status || "order_created" } : null, website: "" }) });
      setStatus({ loading: false, saving: false, error: "", success: result.message || form.successMessage });
      if (paymentInfo?.paymentUrl) window.setTimeout(() => { window.location.href = paymentInfo.paymentUrl; }, 700);
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
        {form.payment?.enabled && <div className="public-payment-note"><strong>Application fee</strong><span>₹{Number(form.payment.amount||0).toLocaleString("en-IN")} · {form.payment.componentType || "Payable Amount"}</span><small>After submitting, you will be taken to the secure payment page.</small></div>}
        <input className="website-field" tabIndex="-1" autoComplete="off" value="" readOnly name="website" />
        {status.error && <div className="public-form-error">{status.error}</div>}
        <button disabled={status.saving}>{status.saving ? (form.payment?.enabled ? "Creating payment..." : "Submitting...") : (form.payment?.enabled ? "Submit & pay application fee" : "Submit enquiry")}</button>
      </form>
    </section>
  </main>;
}

function PublicField({ field, value, onChange }) {
  const label = <>{field.label || field.displayName}{field.required ? " *" : ""}</>;
  const type = field.fieldType === "email" ? "email" : field.fieldType === "phone" ? "tel" : ["date", "datetime"].includes(field.fieldType) ? (field.fieldType === "datetime" ? "datetime-local" : "date") : "text";
  const pattern = field.fieldType === "phone" ? "[6-9][0-9]{9}" : undefined;
  const title = field.fieldType === "phone" ? "Enter a valid 10-digit Indian mobile number starting with 6-9" : field.fieldType === "email" ? "Enter a valid email address" : undefined;
  if (["single_select", "multi_select"].includes(field.fieldType) || field.options?.length) {
    const multiple = field.fieldType === "multi_select";
    return <label>{label}<select required={field.required} multiple={multiple} value={multiple ? (Array.isArray(value) ? value : []) : value} onChange={event => onChange(multiple ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value)}>{!multiple && <option value="">Select {String(field.label || field.displayName).toLowerCase()}</option>}{(field.options || []).map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}</select></label>;
  }
  if (field.fieldType === "textarea") return <label className="wide">{label}<textarea required={field.required} rows="4" value={value} onChange={event => onChange(event.target.value)} placeholder={field.placeholder || ""} /></label>;
  return <label>{label}<input required={field.required} type={type} inputMode={field.fieldType === "phone" ? "numeric" : undefined} maxLength={field.fieldType === "phone" ? 10 : undefined} pattern={pattern} title={title} value={value} onChange={event => onChange(field.fieldType === "phone" ? event.target.value.replace(/\D/g, "").slice(0, 10) : event.target.value)} placeholder={field.placeholder || ""} /></label>;
}
