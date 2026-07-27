import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCheck, MessageCircle, RefreshCw, Search, Send, UserRound, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import "./WhatsAppInbox.css";
import "./WhatsAppInboxFullScreen.css";

const cleanPhone = (value) => String(value || "").replace(/\D/g, "").slice(-10);
const time = (value) =>
  value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";

export default function WhatsAppInbox() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [leadDetails, setLeadDetails] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const selectedIdRef = useRef(null);
  const messageRequestRef = useRef(0);

  const selected = conversations.find((item) => Number(item.id) === Number(selectedId));
  const filtered = useMemo(() => {
    const term = query.toLowerCase().trim();
    return conversations.filter((item) => !term || [item.contact_name, item.student_name, item.mobile, item.last_message].some((value) => String(value || "").toLowerCase().includes(term)));
  }, [conversations, query]);
  const unreadTotal = conversations.reduce((sum, item) => sum + Number(item.unread_count || 0), 0);

  async function loadConversations(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await api("/hub/smartping/conversations?limit=100");
      setConversations(result.data || []);
      setSelectedId((currentId) => currentId ?? result.data?.[0]?.id ?? null);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(conversationId, markRead = true) {
    if (!conversationId) return;
    const requestId = ++messageRequestRef.current;
    try {
      const result = await api(`/hub/smartping/conversations/${conversationId}/messages?limit=100`);
      if (requestId !== messageRequestRef.current || Number(conversationId) !== Number(selectedIdRef.current)) return;
      setMessages(result.data || []);
      if (markRead) {
        await api(`/hub/smartping/conversations/${conversationId}/read`, { method: "PUT" });
        setConversations((current) => current.map((item) => Number(item.id) === Number(conversationId) ? { ...item, unread_count: 0 } : item));
        window.dispatchEvent(new CustomEvent("crm:whatsapp-read"));
      }
    } catch (error) {
      setNotice(error.message);
    }
  }

  useEffect(() => {
    loadConversations();
    const timer = window.setInterval(() => loadConversations(true), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    selectedIdRef.current = selectedId;
    setProfileOpen(false);
    setMessages([]);
    loadMessages(selectedId);
    const timer = window.setInterval(() => loadMessages(selectedId, false), 5000);
    return () => {
      window.clearInterval(timer);
      messageRequestRef.current += 1;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selected?.lead_id) {
      setLeadDetails(null);
      return;
    }
    api(`/leads/${selected.lead_id}`)
      .then((result) => setLeadDetails(result.data))
      .catch(() => setLeadDetails(null));
  }, [selected?.lead_id]);

  async function sendReply(event) {
    event.preventDefault();
    if (!reply.trim() || !selected) return;
    setSending(true);
    try {
      await api.post(`/hub/integrations/${selected.integration_id}/smartping/send`, {
        phoneNumber: selected.mobile,
        message: reply.trim(),
        leadId: selected.lead_id || null,
        userName: selected.contact_name || selected.student_name || "WhatsApp contact",
        source: "CRM Inbox",
        clientRequestId: globalThis.crypto?.randomUUID?.() || `inbox-${Date.now()}`,
      });
      setReply("");
      await loadMessages(selected.id, false);
      await loadConversations(true);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="wa-inbox-page">
      <header className="wa-inbox-head">
        <button className="icon-btn" onClick={() => navigate("/leads")}><ArrowLeft /></button>
        <div><span className="eyebrow">Communications</span><h1>WhatsApp Inbox</h1><p>View incoming enquiries and reply from connected WhatsApp accounts.</p></div>
        <span className="wa-inbox-unread"><MessageCircle />{unreadTotal} unread</span>
        <button className="secondary" onClick={() => loadConversations()}><RefreshCw /> Refresh</button>
      </header>
      {notice && <div className="wa-inbox-alert">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      <section className="wa-inbox-layout">
        <aside className="wa-inbox-list">
          <div className="wa-inbox-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, number or message" /></div>
          <div className="wa-inbox-list-title"><strong>Conversations</strong><span>{filtered.length}</span></div>
          <div className="wa-conversation-scroll">
            {filtered.map((item) => <button key={item.id} className={`${Number(item.id) === Number(selectedId) ? "active" : ""} ${Number(item.unread_count) ? "unread" : ""}`} onClick={() => setSelectedId(item.id)}>
              <span className="wa-inbox-avatar">{String(item.contact_name || item.student_name || item.mobile).charAt(0).toUpperCase()}</span>
              <span><strong>{item.contact_name || item.student_name || item.mobile}</strong><small>{item.last_message || "No messages"}</small><em>{item.integration_name}</em></span>
              <span className="wa-conversation-meta"><time>{time(item.last_message_time)}</time>{Number(item.unread_count) > 0 && <b>{Number(item.unread_count) > 99 ? "99+" : item.unread_count}</b>}</span>
            </button>)}
            {!filtered.length && <div className="wa-inbox-empty">{loading ? "Loading conversations…" : "No conversations found"}</div>}
          </div>
        </aside>
        <section className="wa-inbox-chat">
          {selected ? <>
            <header><span className="wa-inbox-avatar">{String(selected.contact_name || selected.student_name || selected.mobile).charAt(0).toUpperCase()}</span><div><strong>{selected.contact_name || selected.student_name || selected.mobile}</strong><small>+91 {cleanPhone(selected.mobile)} · {selected.integration_name}</small></div><span className="wa-sync-state"><CheckCheck /> Synced</span><button type="button" className="wa-profile-toggle" title="View lead details" aria-label="View lead details" onClick={() => setProfileOpen(true)}><UserRound /></button></header>
            <div className="wa-inbox-messages">
              {messages.map((message) => <article key={message.id} className={String(message.direction).toLowerCase()}>
                {message.media_url && <a href={message.media_url} target="_blank" rel="noreferrer">View attachment</a>}
                <p>{message.message || message.caption || `[${message.type}]`}</p>
                <small>{time(message.created_at)} · {message.status}</small>
              </article>)}
              {!messages.length && <div className="wa-inbox-empty">No messages in this conversation</div>}
            </div>
            <form className="wa-inbox-composer" onSubmit={sendReply}><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Type a reply to this contact…" /><button className="primary" disabled={sending || !reply.trim()}><Send />{sending ? "Sending…" : "Send"}</button></form>
          </> : <div className="wa-inbox-placeholder"><MessageCircle /><strong>Select a conversation</strong><span>Incoming and outgoing messages will appear here.</span></div>}
        </section>
        {profileOpen && <button type="button" className="wa-profile-backdrop" aria-label="Close lead details" onClick={() => setProfileOpen(false)} />}
        <aside className={`wa-inbox-profile ${profileOpen ? "open" : ""}`}>
          {selected && <><button type="button" className="wa-profile-close" aria-label="Close lead details" onClick={() => setProfileOpen(false)}><X /></button><div className="wa-profile-identity"><span className="wa-inbox-avatar">{String(selected.contact_name || selected.student_name || selected.mobile).charAt(0).toUpperCase()}</span><strong>{leadDetails?.studentName || selected.contact_name || selected.student_name || selected.mobile}</strong><small>+91 {cleanPhone(selected.mobile)}</small></div>
            <div className="wa-lead-summary">
              <div><span>Lead number</span><strong>{leadDetails?.leadId || selected.lead_number || "Not linked"}</strong></div>
              <div><span>Stage</span><strong>{leadDetails?.stage || selected.stage_name || "—"}</strong></div>
              <div><span>Sub-stage</span><strong>{leadDetails?.substage || "—"}</strong></div>
              <div><span>Branch</span><strong>{leadDetails?.branch || selected.branch_name || "—"}</strong></div>
              <div><span>Class</span><strong>{leadDetails?.applyingClass || "—"}</strong></div>
              <div><span>Curriculum</span><strong>{leadDetails?.curriculum || "—"}</strong></div>
              <div><span>Owner</span><strong>{leadDetails?.owner || "—"}</strong></div>
              <div><span>Lead score</span><strong>{leadDetails?.leadScore ?? "—"}</strong></div>
              <div><span>Source</span><strong>{leadDetails?.source || "—"}</strong></div>
              <div><span>Account</span><strong>{selected.integration_name}</strong></div>
              <div><span>Next follow-up</span><strong>{time(leadDetails?.nextFollowupAt)}</strong></div>
              <div><span>Last active</span><strong>{time(selected.last_message_time)}</strong></div>
            </div>
            <details className="wa-profile-section" open><summary>Lead activity <small>{leadDetails?.activities?.length || 0}</small></summary><div className="wa-profile-history">{leadDetails?.activities?.length ? leadDetails.activities.map((item) => <article key={item.id}><strong>{item.summary}</strong><span>{item.actorName}</span><time>{time(item.occurredAt)}</time>{item.commentText && <p>{item.commentText}</p>}</article>) : <p className="wa-profile-none">No lead activity available.</p>}</div></details>
            <details className="wa-profile-section"><summary>Comments and notes <small>{leadDetails?.comments?.length || 0}</small></summary><div className="wa-profile-history">{leadDetails?.comments?.length ? leadDetails.comments.map((item) => <article key={item.id}><strong>{item.counsellorName}</strong><p>{item.commentText}</p><time>{time(item.createdAt)}</time></article>) : <p className="wa-profile-none">No comments available.</p>}</div></details>
            <details className="wa-profile-section"><summary>Source history <small>{leadDetails?.sourceHistory?.length || 0}</small></summary><div className="wa-profile-history">{leadDetails?.sourceHistory?.length ? leadDetails.sourceHistory.map((item) => <article key={item.id}><strong>{item.isPrimary ? "Primary source" : "Secondary source"} · {item.source}</strong><span>{item.academicYear} · {item.channel} · {item.campaign}</span><time>{item.addedBy} · {time(item.createdAt)}</time></article>) : <p className="wa-profile-none">No source history available.</p>}</div></details>
            {selected.lead_id && <button className="secondary" onClick={() => navigate(`/leads?openLead=${selected.lead_id}`)}>Open complete lead details</button>}
          </>}
        </aside>
      </section>
    </main>
  );
}
