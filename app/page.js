'use client'
import { useState, useMemo, useCallback, useEffect } from "react";
import CONTACTS_DATA from "./contacts.json";

const STATUS_CONFIG = {
  new: { label: "New", color: "#6366f1", bg: "#1e1b4b" },
  contacted: { label: "Contacted", color: "#f59e0b", bg: "#451a03" },
  interested: { label: "Interested", color: "#3b82f6", bg: "#1e3a5f" },
  booked: { label: "Apt Booked", color: "#10b981", bg: "#064e3b" },
  closed: { label: "Closed", color: "#22c55e", bg: "#052e16" },
  dead: { label: "Dead", color: "#6b7280", bg: "#1f2937" },
};

const PRIORITY_ORDER = ["booked","closed","interested","contacted","new","dead"];

function getPriorityScore(c) {
  const revMap = {
    "$20-50 Million": 9, "$10-20 Million": 8, "$5-10 Million": 7,
    "$2.5-5 Million": 6, "$1-2.5 Million": 5, "$500,000-1 Million": 4,
    "Less Than $500,000": 2,
  };
  let score = revMap[c.revenue] || 1;
  if (c.firstName) score += 2;
  if (c.phone) score += 1;
  if (c.notes) score += 1;
  return score;
}

export default function BlastBudCRM() {
  const [contacts, setContacts] = useState(() => {
    if (typeof window === 'undefined') return CONTACTS_DATA.map(c => ({ ...c }));
    try {
      const saved = localStorage.getItem('blastbud_contacts_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.length === CONTACTS_DATA.length) return parsed;
        // Merge: keep saved data, fill in any new contacts
        const savedMap = {};
        parsed.forEach(c => { savedMap[c.id] = c; });
        return CONTACTS_DATA.map(c => savedMap[c.id] ? savedMap[c.id] : { ...c });
      }
    } catch {}
    return CONTACTS_DATA.map(c => ({ ...c }));
  });
  const [hydrated, setHydrated] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterState, setFilterState] = useState("all");
  const [view, setView] = useState("list");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [notesText, setNotesText] = useState("");
  const [aptDateText, setAptDateText] = useState("");
  const [showStats, setShowStats] = useState(false);
  const [agentView, setAgentView] = useState(false);
  const [agentTask, setAgentTask] = useState("");
  const [agentLog, setAgentLog] = useState([]);
  const [agentRunning, setAgentRunning] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const saveContacts = useCallback((updated) => {
    setContacts(updated);
    try { localStorage.setItem("blastbud_contacts_v2", JSON.stringify(updated)); } catch {}
  }, []);

  const states = useMemo(() => [...new Set(contacts.map(c => c.state))].filter(Boolean).sort(), [contacts]);

  const filtered = useMemo(() => {
    let list = contacts;
    if (filterStatus !== "all") list = list.filter(c => c.status === filterStatus);
    if (filterState !== "all") list = list.filter(c => c.state === filterState);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.company.toLowerCase().includes(q) ||
        (c.firstName + " " + c.lastName).toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.state.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const si = PRIORITY_ORDER.indexOf(a.status);
      const sj = PRIORITY_ORDER.indexOf(b.status);
      if (si !== sj) return si - sj;
      return getPriorityScore(b) - getPriorityScore(a);
    });
  }, [contacts, filterStatus, filterState, search]);

  const stats = useMemo(() => {
    const counts = {};
    Object.keys(STATUS_CONFIG).forEach(s => counts[s] = 0);
    contacts.forEach(c => counts[c.status] = (counts[c.status] || 0) + 1);
    return counts;
  }, [contacts]);

  const updateStatus = (id, status) => {
    const now = new Date().toLocaleDateString();
    const updated = contacts.map(c =>
      c.id === id ? { ...c, status, lastContacted: status === "contacted" ? now : c.lastContacted } : c
    );
    saveContacts(updated);
    if (selected && selected.id === id) setSelected(updated.find(c => c.id === id));
  };

  const saveNotes = (id) => {
    const updated = contacts.map(c =>
      c.id === id ? { ...c, callNotes: notesText, aptDate: aptDateText } : c
    );
    saveContacts(updated);
    setSelected(updated.find(c => c.id === id));
  };

  const openContact = (c) => {
    setSelected(c);
    setNotesText(c.callNotes || "");
    setAptDateText(c.aptDate || "");
    setAiBrief("");
    setView("detail");
  };

  const generateBrief = async (contact) => {
    setAiLoading(true);
    setAiBrief("");
    try {
      const prompt = `You are a sharp sales caller prepping for an outreach call on behalf of BlastBud.com, a cannabis marketing platform that helps dispensaries and brands grow revenue through targeted marketing campaigns.

Generate a concise caller brief for: Company: ${contact.company}, Contact: ${contact.firstName} ${contact.lastName} (${contact.title || "Decision Maker"}), Location: ${contact.city}, ${contact.state}, Type: ${contact.businessType}, Revenue: ${contact.revenue || "Unknown"}, About: ${(contact.description || "").slice(0, 150)}.

Output exactly 3 items:
1. Who they are and what makes them distinct (1 sentence)
2. Best angle to open the conversation (1 sentence)  
3. Suggested opener line to use when they pick up (1 punchy sentence)

Be direct, specific, no fluff. Sound like a seasoned sales pro.`;

      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen2.5:72b",
          prompt: prompt,
          stream: false
        }),
      });
      const data = await res.json();
      const text = data.response || "Error generating brief.";
      setAiBrief(text);
    } catch (e) {
      setAiBrief("Failed to generate brief.");
    }
    setAiLoading(false);
  };

  const runAgent = async () => {
    if (!agentTask.trim() || agentRunning) return;
    setAgentRunning(true);
    const task = agentTask.trim();
    setAgentTask("");
    setAgentLog(prev => [...prev, { role: "user", text: task }]);

    const systemPrompt = `You are a sales CRM agent for BlastBud, a cannabis marketing platform. You have access to a contact list of ${contacts.length} cannabis businesses.

You can perform these ACTIONS by outputting JSON commands:
- {"action": "search", "query": "text"} - search contacts by name/company/city/state
- {"action": "update_status", "company": "name", "status": "new|contacted|interested|booked|closed|dead"} - update a contact status
- {"action": "add_note", "company": "name", "note": "text"} - add a call note to a contact
- {"action": "set_apt", "company": "name", "date": "date string"} - set appointment date
- {"action": "list_by_status", "status": "status_name"} - list contacts by status
- {"action": "list_by_state", "state": "ST"} - list contacts by state
- {"action": "stats"} - show pipeline stats
- {"action": "done", "summary": "what you did"} - finish the task

Current pipeline stats:
${Object.entries(stats).map(([k,v]) => k + ': ' + v).join(', ')}

Contact data sample (first 5):
${contacts.slice(0,5).map(c => c.company + ' (' + c.state + ') - ' + c.status).join('\n')}

Think step by step. For each step output ONE JSON action, then I will give you the result and you continue until done.
Always end with {"action": "done", "summary": "..."}.`;

    const messages = [{ role: "user", content: "Task: " + task }];
    let iterations = 0;
    const maxIterations = 10;

    const ollama = async (msgs) => {
      const res = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen2.5:72b",
          messages: [{ role: "system", content: systemPrompt }, ...msgs],
          stream: false
        })
      });
      const d = await res.json();
      return d.message?.content || "";
    };

    const executeAction = (cmd) => {
      try {
        const action = JSON.parse(cmd.match(/\{[^}]+\}/s)?.[0] || cmd);
        if (action.action === "search") {
          const q = action.query.toLowerCase();
          const results = contacts.filter(c =>
            c.company.toLowerCase().includes(q) ||
            c.city?.toLowerCase().includes(q) ||
            c.state?.toLowerCase().includes(q) ||
            c.firstName?.toLowerCase().includes(q) ||
            c.businessType?.toLowerCase().includes(q)
          ).slice(0, 10);
          return "Found " + results.length + " contacts: " + results.map(c => c.company + " (" + c.state + ", " + c.status + ")").join("; ");
        }
        if (action.action === "update_status") {
          const c = contacts.find(x => x.company.toLowerCase().includes(action.company.toLowerCase()));
          if (c) { updateStatus(c.id, action.status); return "Updated " + c.company + " to " + action.status; }
          return "Contact not found: " + action.company;
        }
        if (action.action === "add_note") {
          const c = contacts.find(x => x.company.toLowerCase().includes(action.company.toLowerCase()));
          if (c) {
            const updated = contacts.map(x => x.id === c.id ? { ...x, callNotes: (x.callNotes ? x.callNotes + "\n" : "") + action.note } : x);
            saveContacts(updated);
            return "Note added to " + c.company;
          }
          return "Contact not found: " + action.company;
        }
        if (action.action === "set_apt") {
          const c = contacts.find(x => x.company.toLowerCase().includes(action.company.toLowerCase()));
          if (c) {
            const updated = contacts.map(x => x.id === c.id ? { ...x, aptDate: action.date, status: "booked" } : x);
            saveContacts(updated);
            return "Appointment set for " + c.company + ": " + action.date;
          }
          return "Contact not found: " + action.company;
        }
        if (action.action === "list_by_status") {
          const results = contacts.filter(c => c.status === action.status).slice(0, 15);
          return results.length + " contacts with status '" + action.status + "': " + results.map(c => c.company + " (" + c.state + ")").join("; ");
        }
        if (action.action === "list_by_state") {
          const results = contacts.filter(c => c.state === action.state).slice(0, 15);
          return results.length + " contacts in " + action.state + ": " + results.map(c => c.company + " (" + c.status + ")").join("; ");
        }
        if (action.action === "stats") {
          return "Pipeline: " + Object.entries(stats).map(([k,v]) => k + "=" + v).join(", ");
        }
        if (action.action === "done") {
          return "DONE: " + action.summary;
        }
        return "Unknown action: " + action.action;
      } catch(e) {
        return "Parse error: " + e.message;
      }
    };

    try {
      while (iterations < maxIterations) {
        iterations++;
        const response = await ollama(messages);
        messages.push({ role: "assistant", content: response });

        const isDone = response.includes('"action": "done"') || response.includes("action: done");
        const actionResult = executeAction(response);

        setAgentLog(prev => [...prev, { role: "agent", text: response, result: actionResult }]);

        if (isDone || actionResult.startsWith("DONE:")) break;

        messages.push({ role: "user", content: "Result: " + actionResult + "\nContinue with next action or finish with done." });
      }
    } catch(e) {
      setAgentLog(prev => [...prev, { role: "error", text: "Error: " + e.message }]);
    }
    setAgentRunning(false);
  };

  const contactName = (c) => c.firstName ? (c.firstName + " " + c.lastName).trim() : null;

  if (!hydrated) {
    return (
      <div style={{ background: "#0a0a0f", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#10b981", fontFamily: "monospace", fontSize: 16 }}>
        Loading BlastBud CRM...
      </div>
    );
  }

  const S = STATUS_CONFIG;

  return (
    <div style={{ fontFamily: "monospace", background: "#0a0a0f", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* TOP BAR */}
      <div style={{ background: "#111118", borderBottom: "1px solid #1e293b", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: "linear-gradient(135deg,#10b981,#059669)", borderRadius: 8, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🌿</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#10b981", letterSpacing: "0.05em" }}>BLASTBUD CRM</div>
            <div style={{ fontSize: 10, color: "#64748b" }}>SETTER · {contacts.length} CONTACTS</div>
          </div>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company, name, city..." style={{ flex: 1, minWidth: 150, background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "6px 12px", color: "#e2e8f0", fontSize: 13, outline: "none" }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 12, cursor: "pointer" }}>
          <option value="all">All Status</option>
          {Object.entries(S).map(([k, v]) => <option key={k} value={k}>{v.label} ({stats[k] || 0})</option>)}
        </select>
        <select value={filterState} onChange={e => setFilterState(e.target.value)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 12, cursor: "pointer" }}>
          <option value="all">All States</option>
          {states.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => setShowStats(!showStats)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "6px 12px", color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>📊</button>
        <button onClick={() => setAgentView(!agentView)} style={{ background: agentView ? "#7c3aed" : "#1e293b", border: "1px solid " + (agentView ? "#7c3aed" : "#334155"), borderRadius: 6, padding: "6px 12px", color: agentView ? "#fff" : "#94a3b8", fontSize: 12, cursor: "pointer", fontWeight: agentView ? 700 : 400 }}>🤖 Agent</button>
        <span style={{ fontSize: 11, color: "#64748b" }}>{filtered.length} shown</span>
        {view === "detail" && <button onClick={() => setView("list")} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "6px 12px", color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>← List</button>}
      </div>

      {/* STATS */}
      {showStats && (
        <div style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", padding: "10px 20px", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {Object.entries(S).map(([k, v]) => (
            <div key={k} onClick={() => setFilterStatus(filterStatus === k ? "all" : k)} style={{ background: v.bg, border: "1px solid " + v.color + "40", borderRadius: 8, padding: "8px 14px", cursor: "pointer", textAlign: "center", minWidth: 70 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: v.color }}>{stats[k] || 0}</div>
              <div style={{ fontSize: 9, color: "#94a3b8" }}>{v.label}</div>
            </div>
          ))}
          <div style={{ background: "#064e3b", border: "1px solid #10b98140", borderRadius: 8, padding: "8px 14px", textAlign: "center", minWidth: 80 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#10b981" }}>${((stats.closed || 0) * 1000).toLocaleString()}</div>
            <div style={{ fontSize: 9, color: "#94a3b8" }}>Won</div>
          </div>
        </div>
      )}

      {agentView && (
        <div style={{ background: "#0a0014", borderBottom: "1px solid #4c1d95", padding: 16, maxHeight: 400, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: 700, letterSpacing: "0.05em" }}>🤖 CRM AGENT — powered by qwen2.5:72b</div>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 280, display: "flex", flexDirection: "column", gap: 8 }}>
            {agentLog.length === 0 && <div style={{ color: "#4c1d95", fontSize: 12 }}>Give the agent a task. It can search contacts, update statuses, book appointments, add notes, and more.</div>}
            {agentLog.map((msg, i) => (
              <div key={i} style={{ background: msg.role === "user" ? "#1e1b4b" : msg.role === "error" ? "#450a0a" : "#0f0f1a", border: "1px solid " + (msg.role === "user" ? "#4338ca" : msg.role === "error" ? "#7f1d1d" : "#1e293b"), borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ fontSize: 10, color: msg.role === "user" ? "#818cf8" : msg.role === "error" ? "#f87171" : "#6b7280", marginBottom: 4, fontWeight: 700 }}>{msg.role === "user" ? "YOU" : msg.role === "error" ? "ERROR" : "AGENT"}</div>
                <div style={{ fontSize: 12, color: msg.role === "user" ? "#c7d2fe" : "#e2e8f0", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{msg.text}</div>
                {msg.result && <div style={{ fontSize: 11, color: "#10b981", marginTop: 6, background: "#052e16", borderRadius: 4, padding: "4px 8px" }}>→ {msg.result}</div>}
              </div>
            ))}
            {agentRunning && <div style={{ color: "#a78bfa", fontSize: 12, animation: "pulse 1s infinite" }}>⟳ Agent thinking...</div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={agentTask}
              onChange={e => setAgentTask(e.target.value)}
              onKeyDown={e => e.key === "Enter" && runAgent()}
              placeholder='e.g. "Find all dispensaries in NY and mark them as contacted" or "Book an apt with Bayside Cannabis for April 15"'
              style={{ flex: 1, background: "#1e1b4b", border: "1px solid #4c1d95", borderRadius: 8, padding: "8px 12px", color: "#e2e8f0", fontSize: 13, outline: "none", fontFamily: "monospace" }}
            />
            <button onClick={runAgent} disabled={agentRunning || !agentTask.trim()} style={{ background: agentRunning ? "#1e293b" : "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: agentRunning ? "default" : "pointer", fontWeight: 700 }}>
              {agentRunning ? "..." : "Run"}
            </button>
            <button onClick={() => setAgentLog([])} style={{ background: "#1e293b", color: "#64748b", border: "1px solid #334155", borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>Clear</button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* LIST */}
        {view !== "detail" && (
          <div style={{ width: "100%", overflowY: "auto", maxHeight: "calc(100vh - 65px)" }}>
            {filtered.map((c) => {
              const cfg = S[c.status];
              const name = contactName(c);
              return (
                <div key={c.id} onClick={() => openContact(c)} style={{ padding: "11px 16px", borderBottom: "1px solid #1a2234", cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: cfg.color, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#f1f5f9" }}>{c.company}</div>
                      <div style={{ fontSize: 10, color: cfg.color, background: cfg.bg, borderRadius: 4, padding: "2px 5px", whiteSpace: "nowrap", flexShrink: 0 }}>{cfg.label}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>{name && <span style={{ color: "#94a3b8" }}>{name} · </span>}{c.city}, {c.state}</div>
                    <div style={{ display: "flex", gap: 10, marginTop: 2, flexWrap: "wrap" }}>
                      {c.revenue && <span style={{ fontSize: 10, color: "#10b981" }}>💰 {c.revenue}</span>}
                      {c.notes && <span style={{ fontSize: 10, color: "#f59e0b" }}>⚠️ {c.notes}</span>}
                      {c.phone && <span style={{ fontSize: 10, color: "#3b82f6" }}>📞 {c.phone}</span>}
                      {c.aptDate && <span style={{ fontSize: 10, color: "#10b981" }}>📅 {c.aptDate}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>No contacts found</div>}
          </div>
        )}

        {/* DETAIL */}
        {view === "detail" && selected && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20, background: "#0d1117", maxHeight: "calc(100vh - 65px)" }}>
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 19, color: "#f1f5f9" }}>{selected.company}</h2>
              {contactName(selected) && <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 3 }}>{contactName(selected)} · {selected.title}</div>}
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{selected.city}, {selected.state} · {selected.businessType}</div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {selected.phone && <a href={"tel:" + selected.phone} style={{ background: "#10b981", color: "#fff", borderRadius: 8, padding: "7px 14px", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>📞 Call Now</a>}
              {selected.website && <a href={"https://" + selected.website} target="_blank" rel="noreferrer" style={{ background: "#1e293b", color: "#94a3b8", borderRadius: 8, padding: "7px 14px", textDecoration: "none", fontSize: 12 }}>🌐 Site</a>}
              {selected.facebook && <a href={selected.facebook} target="_blank" rel="noreferrer" style={{ background: "#1e293b", color: "#3b82f6", borderRadius: 8, padding: "7px 14px", textDecoration: "none", fontSize: 12 }}>FB</a>}
              {selected.linkedin && <a href={selected.linkedin} target="_blank" rel="noreferrer" style={{ background: "#1e293b", color: "#60a5fa", borderRadius: 8, padding: "7px 14px", textDecoration: "none", fontSize: 12 }}>LI</a>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 16 }}>
              {[["Revenue", selected.revenue || "Unknown", "#10b981"], ["Employees", selected.employees || "Unknown", "#3b82f6"], ["Last Contact", selected.lastContacted || "Never", "#94a3b8"], ["Apt Date", selected.aptDate || "None", "#f59e0b"]].map(([l, v, col]) => (
                <div key={l} style={{ background: "#111118", borderRadius: 8, padding: "10px 12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: 9, color: "#64748b", marginBottom: 3 }}>{l}</div>
                  <div style={{ fontSize: 12, color: col, fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>

            {selected.notes && (
              <div style={{ background: "#451a03", border: "1px solid #92400e", borderRadius: 8, padding: 10, marginBottom: 14 }}>
                <span style={{ color: "#f59e0b", fontWeight: 600, fontSize: 11 }}>⚠️ NOTE: </span>
                <span style={{ color: "#fcd34d", fontSize: 12 }}>{selected.notes}</span>
              </div>
            )}

            {selected.description && (
              <div style={{ background: "#111118", border: "1px solid #1e293b", borderRadius: 8, padding: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5 }}>ABOUT</div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{selected.description}</div>
              </div>
            )}

            <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#3b82f6", fontWeight: 700 }}>🧠 AI CALLER BRIEF</div>
                <button onClick={() => generateBrief(selected)} disabled={aiLoading} style={{ background: aiLoading ? "#1e293b" : "#1d4ed8", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: aiLoading ? "default" : "pointer", fontWeight: 600 }}>
                  {aiLoading ? "Loading..." : "Generate"}
                </button>
              </div>
              {aiBrief ? <div style={{ fontSize: 12, color: "#bfdbfe", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{aiBrief}</div> : <div style={{ fontSize: 11, color: "#334155" }}>Click Generate for AI-powered caller prep with opener line.</div>}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6, fontWeight: 600 }}>STATUS</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Object.entries(S).map(([k, v]) => (
                  <button key={k} onClick={() => updateStatus(selected.id, k)} style={{ background: selected.status === k ? v.color : v.bg, color: selected.status === k ? "#fff" : v.color, border: "1px solid " + v.color + "60", borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer", fontWeight: selected.status === k ? 700 : 400 }}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5, fontWeight: 600 }}>CALL NOTES</div>
              <textarea value={notesText} onChange={e => setNotesText(e.target.value)} placeholder="Objections, next steps, key info..." rows={3} style={{ width: "100%", boxSizing: "border-box", background: "#111118", border: "1px solid #334155", borderRadius: 8, padding: 10, color: "#e2e8f0", fontSize: 12, resize: "vertical", outline: "none", fontFamily: "monospace" }} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5, fontWeight: 600 }}>APPOINTMENT DATE</div>
              <input value={aptDateText} onChange={e => setAptDateText(e.target.value)} placeholder="e.g. April 10 @ 2pm EST" style={{ width: "100%", boxSizing: "border-box", background: "#111118", border: "1px solid #334155", borderRadius: 8, padding: "8px 12px", color: "#e2e8f0", fontSize: 12, outline: "none", fontFamily: "monospace" }} />
            </div>

            <button onClick={() => saveNotes(selected.id)} style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 14, cursor: "pointer", fontWeight: 700 }}>
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
