

const { useState, useCallback, useEffect, useRef } = React;



const STORAGE_KEY = "fdv_r300_korrekturen_v1";

// Supabase-Anbindung: gemeinsamer Speicher statt lokalem window.storage,
// damit Korrekturen geraeteuebergreifend und ohne Export/Import synchron bleiben.
const SUPABASE_URL = "https://vvahjifduqicgiobiyxq.supabase.co";
const SUPABASE_KEY = "sb_publishable_WOoNJ3rc-kKemZp2cYSz4g_hMgkZgWh";
const SUPABASE_HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json",
};

// Laedt alle gespeicherten Zeilen aus Supabase und baut daraus dasselbe
// "corrections"-Objekt (keyed by nr), das buildCorrections/mergeCorrections erwarten.
async function loadCorrectionsFromSupabase() {
  // Supabase liefert pro Abfrage hoechstens 1000 Zeilen -> seitenweise laden, sonst fehlen Freigaben.
  const PAGE = 1000;
  const cols = ["nr,approved,p,note,opt_tags,opt_notes,content_version", "nr,approved,p,note,opt_tags,opt_notes"];
  let colIdx = 0;
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    let res = await fetch(
      SUPABASE_URL + "/rest/v1/question_review?select=" + cols[colIdx] + "&order=nr.asc&limit=" + PAGE + "&offset=" + offset,
      { headers: SUPABASE_HEADERS }
    );
    if (!res.ok && colIdx === 0 && offset === 0) {
      // Fallback falls die Spalte content_version in der DB noch nicht existiert
      colIdx = 1;
      res = await fetch(
        SUPABASE_URL + "/rest/v1/question_review?select=" + cols[1] + "&order=nr.asc&limit=" + PAGE + "&offset=0",
        { headers: SUPABASE_HEADERS }
      );
    }
    if (!res.ok) throw new Error("Supabase Ladefehler: " + res.status);
    const part = await res.json();
    rows.push(...part);
    if (part.length < PAGE) break;
  }
  const out = {};
  rows.forEach(r => {
    out[r.nr] = {
      approved: r.approved,
      p: r.p,
      note: r.note,
      optTags: r.opt_tags,
      optNotes: r.opt_notes,
      contentVersion: r.content_version || 1,
    };
  });
  return out;
}

// Speichert die uebergebenen Korrekturen als Upsert (ein Request pro Frage-Batch).
// Gibt bei Fehlern die genaue Serverantwort zurueck, damit sie in der App sichtbar gemacht werden kann.
async function saveCorrectionsToSupabase(corrections) {
  const rows = Object.keys(corrections).map(nr => ({
    nr: parseInt(nr, 10),
    approved: corrections[nr].approved,
    p: corrections[nr].p,
    note: corrections[nr].note,
    opt_tags: corrections[nr].optTags,
    opt_notes: corrections[nr].optNotes,
    content_version: corrections[nr].contentVersion || 1,
  }));
  if (rows.length === 0) return { ok: true };
  let res = await fetch(SUPABASE_URL + "/rest/v1/question_review", {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    // Fallback ohne content_version, falls die Spalte in der DB noch nicht existiert
    const rowsWithoutVersion = rows.map(r => { const { content_version, ...rest } = r; return rest; });
    res = await fetch(SUPABASE_URL + "/rest/v1/question_review", {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify(rowsWithoutVersion),
    });
  }
  if (res.ok) return { ok: true };
  let detail = "";
  try { detail = await res.text(); } catch (e) {}
  return { ok: false, status: res.status, detail };
}

// Nur die tatsaechlichen Aenderungen pro Frage sichern (nicht den ganzen Fragenkatalog).
// So bleiben die eigenen Korrekturen auch erhalten, wenn sich INITIAL_QS spaeter aendert
// (z.B. weil eine neue Version der Datei mit anderen/weiteren Fragen erstellt wird).
function buildCorrections(qs, minNr, maxNr) {
  const out = {};
  qs.forEach(q => {
    if (minNr != null && (q.nr < minNr || q.nr > maxNr)) return;
    const touched =
      q.approved ||
      q.p !== 1 ||
      q.note.trim() !== "" ||
      Object.values(q.optTags).some(a => a.length > 0) ||
      Object.values(q.optNotes || {}).some(n => n.trim() !== "");
    if (touched) {
      out[q.nr] = {
        approved: q.approved,
        p: q.p,
        note: q.note,
        optTags: q.optTags,
        optNotes: q.optNotes,
        contentVersion: q.contentVersion || 1,
      };
    }
  });
  return out;
}

// Wenn eine Frage im Code eine hoehere contentVersion hat als der in der DB gespeicherte
// Stand, wurde ihr Text seither inhaltlich korrigiert - die alten Tags/Freigaben aus der
// DB sind dann ungueltig geworden und werden NICHT uebernommen (Frage bleibt "frisch").
// Gibt zusaetzlich zurueck, welche Fragen deswegen neu in die DB geschrieben werden muessen.
function mergeCorrections(baseQs, corrections) {
  const toResync = [];
  if (!corrections) return { merged: baseQs, toResync };
  const merged = baseQs.map(q => {
    const c = corrections[q.nr];
    const codeVersion = q.contentVersion || 1;
    if (!c) return q;
    const dbVersion = c.contentVersion || 1;
    if (dbVersion < codeVersion) {
      toResync.push(q.nr);
      return q; // Code-Stand behalten, DB-Korrektur verwerfen
    }
    return { ...q, ...c };
  });
  return { merged, toResync };
}

const C = {
  rail: "#1a3a6b", accent: "#e8860a",
  green: "#1a7a3c", red: "#b83030",
  border: "rgba(0,0,0,0.10)", muted: "#666",
};

const TAGS = [
  { id: "answer_ok",     label: "Antwort ok",                         color: "#1a5276", bg: "#eaf2f8" },
  { id: "needs_review",  label: "Korrigiert - zu pruefen",            color: "#8a5a00", bg: "#fff0d6" },
  { id: "unverified",    label: "Gegen Reglement pruefen - nicht verifiziert", color: "#ffffff", bg: "#c0392b" },
  { id: "too_hard",      label: "Zu schwierig",                       color: "#b83030", bg: "#fbeaea" },
  { id: "too_easy",      label: "Zu einfach",                         color: "#1a7a3c", bg: "#edf7f0" },
  { id: "similar_meaning", label: "Vom Sinn her zu aehnlich",         color: "#5b2d8e", bg: "#f2eafc" },
  { id: "no_relation",   label: "Steht in keinem Sinn mit dem Thema", color: "#7a4500", bg: "#fff3e0" },
  { id: "rephrase",      label: "Umformulieren noetig",               color: "#555",    bg: "#f4f5f7" },
];

const PRIO = [
  { value: 1, label: "Normal",             color: "#666",    bg: "#f4f5f7" },
  { value: 2, label: "Wichtig",            color: "#1a7a3c", bg: "#edf7f0" },
  { value: 3, label: "Pruefungskritisch",  color: "#a05000", bg: "#fff3e0" },
];

const PAGE_SIZE = 40;

const tagById   = (id) => TAGS.find(t => t.id === id);
const prioByVal = (v)  => PRIO.find(p => p.value === v);
const hasIssues = (q)  =>
  q.note.trim() !== "" ||
  Object.values(q.optTags).some(a => a.length > 0) ||
  Object.values(q.optNotes || {}).some(n => n.trim() !== "");

function TagPill({ tag, onRemove }) {
  const t = tagById(tag);
  if (!t) return null;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4,
      padding:"2px 8px", borderRadius:10, background:t.bg, color:t.color,
      fontSize:11, fontWeight:600 }}>
      {t.label}
      {onRemove && (
        <button onClick={onRemove} style={{ background:"none", border:"none",
          cursor:"pointer", color:t.color, padding:0, fontSize:13, lineHeight:1 }}>x</button>
      )}
    </span>
  );
}

function TagSelector({ selected, onChange }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:4 }}>
      {TAGS.map(t => {
        const on = selected.includes(t.id);
        return (
          <button key={t.id} onClick={() =>
            onChange(on ? selected.filter(x => x !== t.id) : [...selected, t.id])
          } style={{
            padding:"3px 10px", borderRadius:10, fontSize:11, fontWeight:600,
            cursor:"pointer",
            background: on ? t.bg : "#f0f0f0",
            color:       on ? t.color : "#888",
            border:      on ? "1.5px solid " + t.color : "1.5px solid #ddd",
          }}>{t.label}</button>
        );
      })}
    </div>
  );
}

function QuestionRow({ q, open, onToggle, onChange }) {
  const prio     = prioByVal(q.p);
  const issues   = hasIssues(q);
  const optNotes = q.optNotes || { A:"", B:"", C:"", D:"" };

  return (
    <div style={{
      borderRadius:10, marginBottom:8, overflow:"hidden",
      border:"1px solid " + (q.approved ? "#ccc" : issues ? "#e8860a" : "rgba(0,0,0,0.10)"),
      background: q.approved ? "#fafafa" : "#fff",
      opacity: q.approved ? 0.72 : 1,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10,
        padding:"11px 14px", background: open ? "#f8f9fc" : "transparent" }}>

        <div onClick={e => e.stopPropagation()} style={{ flexShrink:0 }}>
          <label style={{ display:"flex", alignItems:"center", cursor:"pointer", userSelect:"none" }}>
            <div style={{
              width:20, height:20, borderRadius:5, flexShrink:0,
              border: q.approved ? "none" : "2px solid #ccc",
              background: q.approved ? "#1a7a3c" : "#fff",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              {q.approved && <span style={{ color:"#fff", fontSize:13, lineHeight:1 }}>v</span>}
            </div>
            <input type="checkbox" checked={q.approved}
              onChange={e => onChange({ approved: e.target.checked })}
              style={{ display:"none" }} />
          </label>
        </div>

        <span style={{
          minWidth:26, height:26, borderRadius:"50%", flexShrink:0,
          background: q.approved ? "#bbb" : "#1a3a6b", color:"#fff",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:11, fontWeight:700,
        }}>{q.nr}</span>

        <span onClick={onToggle} style={{
          flex:1, fontSize:14, fontWeight:500, cursor:"pointer", userSelect:"none",
          color: q.approved ? "#666" : "#1a1a1a",
          textDecoration: q.approved ? "line-through" : "none",
        }}>{q.term}{q.multiSelect && (
          <span style={{ fontSize:10, fontWeight:700, marginLeft:8,
            background:"#5b2d8e", color:"#fff", padding:"1px 7px", borderRadius:7 }}>
            MEHRFACH
          </span>
        )}</span>

        {issues && !q.approved && (
          <span style={{ fontSize:11, background:"#fff3e0", color:"#a05000",
            padding:"2px 8px", borderRadius:8, fontWeight:600, flexShrink:0 }}>
            Korrekturen
          </span>
        )}
        <span style={{ fontSize:11, fontWeight:600, padding:"2px 9px",
          borderRadius:8, background:prio.bg, color:prio.color, flexShrink:0 }}>
          {prio.label}
        </span>
        <span onClick={onToggle} style={{ color:"#666", fontSize:13,
          flexShrink:0, cursor:"pointer", userSelect:"none" }}>
          {open ? "v" : ">"}
        </span>
      </div>

      {open && (
        <div style={{ borderTop:"1px solid rgba(0,0,0,0.10)", padding:"14px 16px 18px" }}>

          <div style={{ fontSize:14, fontWeight:600, color:"#1a1a1a",
            marginBottom:14, lineHeight:1.5 }}>
            {q.q}
          </div>

          {q.img && (
            <div style={{ marginBottom:16, textAlign:"center" }}>
              <img src={q.img} alt="Signalbild"
                style={{ maxWidth:"100%", maxHeight:220, border:"1px solid rgba(0,0,0,0.15)",
                  borderRadius:8, background:"#fff", padding:8 }} />
            </div>
          )}

          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em",
              color:"#666", marginBottom:10 }}>
              {q.multiSelect ? "ANTWORTEN (Mehrfachauswahl - mehrere richtig)" : "ANTWORTEN"}
            </div>
            {q.opts.map(opt => (
              <div key={opt.l} style={{
                marginBottom:10, padding:"10px 12px", borderRadius:9,
                background: opt.c ? "#edf7f0" : "#f8f9fa",
                border: "1px solid " + (opt.c ? "#1a7a3c" : "rgba(0,0,0,0.10)"),
              }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:8 }}>
                  <span style={{
                    minWidth:22, height:22, borderRadius:"50%", flexShrink:0,
                    background: opt.c ? "#1a7a3c" : "#ddd",
                    color: opt.c ? "#fff" : "#555",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:11, fontWeight:700,
                  }}>{opt.l}</span>
                  <span style={{ fontSize:13, lineHeight:1.5,
                    color: opt.c ? "#1a7a3c" : "#333",
                    fontWeight: opt.c ? 600 : 400, flex:1 }}>
                    {opt.img && (
                      <img src={opt.img} alt={"Antwort " + opt.l}
                        style={{ display:"block", maxWidth:160, maxHeight:120, marginBottom:6,
                          border:"1px solid rgba(0,0,0,0.15)", borderRadius:6, background:"#fff", padding:4 }} />
                    )}
                    {opt.t}
                    {opt.c && (
                      <span style={{ fontSize:11, marginLeft:6,
                        background:"#1a7a3c", color:"#fff",
                        padding:"1px 6px", borderRadius:6 }}>KORREKT</span>
                    )}
                  </span>
                </div>

                {q.optTags[opt.l].length > 0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4,
                    marginBottom:6, marginLeft:30 }}>
                    {q.optTags[opt.l].map(tag => (
                      <TagPill key={tag} tag={tag} onRemove={() => {
                        onChange({ optTags: { ...q.optTags,
                          [opt.l]: q.optTags[opt.l].filter(t => t !== tag) } });
                      }} />
                    ))}
                  </div>
                )}

                <div style={{ marginLeft:30 }}>
                  <TagSelector
                    selected={q.optTags[opt.l]}
                    onChange={newTags => onChange({ optTags: { ...q.optTags, [opt.l]: newTags } })}
                  />
                </div>

                <div style={{ marginLeft:30, marginTop:7 }}>
                  <textarea
                    value={optNotes[opt.l] || ""}
                    onChange={e => onChange({ optNotes: { ...optNotes, [opt.l]: e.target.value } })}
                    placeholder={"Notiz zu Antwort " + opt.l + " ..."}
                    rows={2}
                    style={{
                      width:"100%", padding:"6px 10px", borderRadius:7,
                      border:"1px solid rgba(0,0,0,0.10)", fontSize:12,
                      fontFamily:"inherit", resize:"vertical",
                      background: (optNotes[opt.l]||"").trim() ? "#fffde7" : "rgba(255,255,255,0.7)",
                      outline:"none", color:"#1a1a1a",
                    }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginBottom:14, padding:"10px 12px", borderRadius:8,
            background:"#f0f4fa", borderLeft:"3px solid #1a3a6b",
            fontSize:13, color:"#333", lineHeight:1.6 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#1a3a6b",
              marginBottom:4, letterSpacing:"0.05em" }}>FDV-ORIGINALTEXT</div>
            {q.fdv}
          </div>

          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#666",
              letterSpacing:"0.06em", marginBottom:7 }}>PRIORITAET</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {PRIO.map(opt => (
                <button key={opt.value} onClick={() => onChange({ p: opt.value })} style={{
                  padding:"5px 14px", borderRadius:8, fontSize:12, fontWeight:600,
                  cursor:"pointer",
                  background: q.p === opt.value ? opt.bg : "#f4f5f7",
                  color:       q.p === opt.value ? opt.color : "#888",
                  border:      q.p === opt.value ? "1.5px solid " + opt.color : "1.5px solid #ddd",
                }}>{opt.label}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize:11, fontWeight:700, color:"#666",
              letterSpacing:"0.06em", marginBottom:6 }}>GESAMTNOTIZ</div>
            <textarea value={q.note}
              onChange={e => onChange({ note: e.target.value })}
              placeholder="Allgemeine Anmerkungen, fehlende Fragen, Korrekturvorschlaege ..."
              rows={3}
              style={{
                width:"100%", padding:"9px 12px", borderRadius:8,
                border:"1px solid rgba(0,0,0,0.10)", fontSize:13,
                fontFamily:"inherit", resize:"vertical",
                background: q.note.trim() ? "#fffde7" : "#fafafa",
                outline:"none", color:"#1a1a1a",
              }} />
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [qs, setQs]           = useState([]);
  const [openSet, setOpenSet] = useState(() => new Set());
  const [manifest, setManifest] = useState(null);
  const [corr, setCorr]         = useState({});
  const [activeReg, setActiveReg] = useState(() => {
    try { return localStorage.getItem("fdv_register") || null; } catch (e) { return null; }
  });
  const [regLoading, setRegLoading] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const corrRef = useRef({});
  const loadedRegs = useRef({});   // id -> true
  const manifestRef = useRef(null);
  const [search, setSearch]           = useState("");
  const [filterOpen, setFilterOpen]   = useState(false);
  const [filterIssues, setFilterIssues] = useState(false);
  const [filterPrio, setFilterPrio]   = useState(0);

  // "idle" | "loading" | "saving" | "saved" | "error"
  const [saveState, setSaveState] = useState("loading");
  const [loadFailed, setLoadFailed] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const saveTimer = useRef(null);

  // Laedt ein einzelnes Register (Kapitel) nach Bedarf und mischt die Korrekturen aus der DB ein.
  const loadRegister = useCallback(async (id) => {
    const man = manifestRef.current;
    if (!man || loadedRegs.current[id]) return;
    const reg = man.regs.find(r => r.id === id);
    if (!reg) return;
    loadedRegs.current[id] = "loading";
    try {
      const res = await fetch("data/" + reg.file + "?v=" + reg.hash);
      if (!res.ok) throw new Error("Register " + reg.file + ": HTTP " + res.status);
      const base = await res.json();
      const { merged, toResync } = mergeCorrections(base, corrRef.current);
      loadedRegs.current[id] = true;
      setQs(prev => prev.filter(q => q.nr < reg.min || q.nr > reg.max).concat(merged)
        .sort((x, y) => x.nr - y.nr));
      setOpenSet(prev => { const s2 = new Set(prev); merged.filter(q => !q.approved).forEach(q => s2.add(q.nr)); return s2; });
      if (toResync.length > 0) {
        // Inhalt seit der letzten Speicherung korrigiert: frischen Stand in die DB zurueckschreiben
        const freshQs = merged.filter(q => toResync.includes(q.nr));
        await saveCorrectionsToSupabase(buildCorrections(freshQs));
      }
    } catch (e) {
      delete loadedRegs.current[id];
      throw e;
    }
  }, []);

  const loadAllRegisters = useCallback(async () => {
    const man = manifestRef.current;
    if (!man) return;
    setRegLoading(true);
    try { await Promise.all(man.regs.map(r => loadRegister(r.id))); } catch (e) {}
    setRegLoading(false);
  }, [loadRegister]);

  const loadFromSupabase = useCallback(async () => {
    setSaveState("loading");
    setLoadFailed(false);
    try {
      const [man, corrections] = await Promise.all([
        fetch("data/manifest.json", { cache: "no-cache" }).then(r => {
          if (!r.ok) throw new Error("Manifest: HTTP " + r.status); return r.json(); }),
        loadCorrectionsFromSupabase(),
      ]);
      corrRef.current = corrections || {};
      manifestRef.current = man;
      setCorr(corrRef.current);
      setManifest(man);
      let id = activeReg && man.regs.some(r => r.id === activeReg) ? activeReg : man.regs[0].id;
      setActiveReg(id);
      setRegLoading(true);
      await loadRegister(id);
      setRegLoading(false);
      setSaveState("idle");
      setIsDirty(false);
    } catch (e) {
      // Laden ist fehlgeschlagen: NIE mit einem Teilstand weiterarbeiten und niemals
      // automatisch speichern, sonst wuerden echte Daten in der DB ueberschrieben.
      setRegLoading(false);
      setLoadFailed(true);
      setSaveState("load_error");
    }
  }, []);

  const switchRegister = useCallback(async (id) => {
    setActiveReg(id);
    setLimit(PAGE_SIZE);
    try { localStorage.setItem("fdv_register", id); } catch (e) {}
    if (!loadedRegs.current[id]) {
      setRegLoading(true);
      try { await loadRegister(id); } catch (e) { setLoadFailed(true); setSaveState("load_error"); }
      setRegLoading(false);
    }
    window.scrollTo(0, 0);
  }, [loadRegister]);

  useEffect(() => { loadFromSupabase(); }, [loadFromSupabase]);

  const [saveErrorDetail, setSaveErrorDetail] = useState("");

  const persist = useCallback(async (currentQs) => {
    if (loadFailed) {
      // Sicherheitssperre: solange der letzte Ladevorgang fehlgeschlagen ist, NIE speichern -
      // das wuerde sonst den (moeglicherweise veralteten) lokalen Stand in die DB schreiben
      // und echte Daten ueberschreiben.
      setSaveState("load_error");
      return;
    }
    setSaveState("saving");
    try {
      const corrections = buildCorrections(currentQs);
      const result = await saveCorrectionsToSupabase(corrections);
      if (!result.ok) {
        setSaveErrorDetail("HTTP " + result.status + ": " + (result.detail || "").slice(0, 300));
        throw new Error("Speichern fehlgeschlagen");
      }
      setSaveErrorDetail("");
      setSaveState("saved");
      setLastSavedAt(new Date());
      setIsDirty(false);
    } catch (e) {
      if (!saveErrorDetail) setSaveErrorDetail(String(e && e.message ? e.message : e));
      setSaveState("error");
    }
  }, [loadFailed]);

  const updateQ = useCallback((nr, patch) => {
    setIsDirty(true);
    setQs(prev => {
      const next = prev.map(q => q.nr === nr ? { ...q, ...patch } : q);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => persist(next), 700);
      return next;
    });
    if (patch.approved === true)
      setOpenSet(prev => { const s = new Set(prev); s.delete(nr); return s; });
    else if (patch.approved === false)
      setOpenSet(prev => new Set([...prev, nr]));
  }, [persist]);

  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    persist(qs);
  }, [qs, persist]);

  const download = useCallback(() => {
    const blob = new Blob([JSON.stringify(qs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fdv_korrekturen.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [qs]);

  // Export ueber Dialog: auf dem Handy funktioniert der Blob-Download in vielen
  // Browsern/WebViews nicht. Kopieren in die Zwischenablage bzw. das native
  // Teilen-Menue funktionieren dagegen zuverlaessig.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportText, setExportText] = useState("");
  const [exportRange, setExportRange] = useState(null); // z.B. [1,50]
  const [copyState, setCopyState]   = useState("idle"); // idle | copied | error
  const exportRef = useRef(null);

  // Link-Generator fuer Claude: baut die Datenbank-Abfrage-URL mit einem
  // Zeitstempel als Anti-Cache-Parameter, damit jede erzeugte Adresse garantiert
  // neu ist und nicht an einer alten, zwischengespeicherten Antwort haengenbleibt.
  const [claudeLinkOpen, setClaudeLinkOpen] = useState(false);
  const [claudeLink, setClaudeLink] = useState("");
  const [claudeLinkCopyState, setClaudeLinkCopyState] = useState("idle");
  const claudeLinkRef = useRef(null);

  const openClaudeLink = useCallback(() => {
    const url = SUPABASE_URL + "/rest/v1/review_neu?apikey=" + SUPABASE_KEY + "&select=nr,note,opt_tags,opt_notes,approved&order=nr.desc&limit=" + (400 + (Date.now() % 100));
    setClaudeLink(url);
    setClaudeLinkCopyState("idle");
    setClaudeLinkOpen(true);
  }, []);

  const copyClaudeLink = useCallback(() => {
    if (claudeLinkRef.current) {
      claudeLinkRef.current.select();
      try {
        navigator.clipboard.writeText(claudeLink);
        setClaudeLinkCopyState("copied");
      } catch (e) {
        setClaudeLinkCopyState("error");
      }
    }
  }, [claudeLink]);

  const EXPORT_RANGES = manifest ? manifest.regs.map(r => [r.min, r.max]) : [];

  const openExport = useCallback(() => {
    loadAllRegisters();
    setExportRange(null);
    setExportText("");
    setCopyState("idle");
    setExportOpen(true);
  }, []);

  const chooseExportRange = useCallback((minNr, maxNr) => {
    setExportRange([minNr, maxNr]);
    setExportText(JSON.stringify(buildCorrections(qs, minNr, maxNr), null, 2));
    setCopyState("idle");
  }, [qs]);

  useEffect(() => {
    if (exportOpen && exportRange && exportRef.current) {
      exportRef.current.focus();
      exportRef.current.select();
    }
  }, [exportOpen, exportRange]);

  const copyExport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopyState("copied");
      return;
    } catch (e) { /* Clipboard-API evtl. nicht erlaubt - Fallback unten */ }
    try {
      exportRef.current && exportRef.current.select();
      const ok = document.execCommand("copy");
      setCopyState(ok ? "copied" : "error");
    } catch (e) {
      setCopyState("error");
    }
  }, [exportText]);

  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const shareExport = useCallback(async () => {
    try {
      await navigator.share({ title: "FDV Korrekturen", text: exportText });
    } catch (e) { /* abgebrochen oder nicht unterstuetzt - ignorieren */ }
  }, [exportText]);

  // Import: verlaesslichster Weg, Korrekturen ueber Sitzungen/neu geoeffnete
  // Dateien hinweg zu uebernehmen, unabhaengig davon ob der automatische
  // Speicher (window.storage) fuer diese Artefakt-Instanz greift.
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importState, setImportState] = useState("idle"); // idle | applied | error

  const openImport = useCallback(() => {
    setImportText("");
    setImportState("idle");
    setImportOpen(true);
  }, []);

  const applyImport = useCallback(() => {
    try {
      const corrections = JSON.parse(importText);
      setQs(prev => {
        const { merged } = mergeCorrections(prev, corrections);
        setOpenSet(new Set(merged.filter(q => !q.approved).map(q => q.nr)));
        persist(merged);
        return merged;
      });
      setImportState("applied");
    } catch (e) {
      setImportState("error");
    }
  }, [importText, persist]);

  const curReg = manifest ? manifest.regs.find(r => r.id === activeReg) : null;
  const searching = search.trim().length >= 2;
  useEffect(() => { if (searching) loadAllRegisters(); }, [searching, loadAllRegisters]);
  useEffect(() => { setLimit(PAGE_SIZE); }, [search, filterOpen, filterIssues, filterPrio]);

  const inReg = (q) => searching || !curReg || (q.nr >= curReg.min && q.nr <= curReg.max);
  const visible = qs.filter(q => {
    if (!inReg(q)) return false;
    if (search && !q.term.toLowerCase().includes(search.toLowerCase())
        && !String(q.nr).includes(search)) return false;
    if (filterOpen   && q.approved)    return false;
    if (filterIssues && !hasIssues(q)) return false;
    if (filterPrio   && q.p !== filterPrio) return false;
    return true;
  });
  const shown = visible.slice(0, limit);

  // Statistik ueber ALLE Register: geladene Fragen exakt, nicht geladene aus den DB-Korrekturen.
  const loadedByNr = {};
  qs.forEach(q => { loadedByNr[q.nr] = q; });
  const statFor = (nr) => {
    const q = loadedByNr[nr];
    if (q) return { approved: !!q.approved, issues: hasIssues(q) };
    const c = corr[nr];
    const cv = manifest.v[nr] || 1;
    if (!c || (c.contentVersion || 1) < cv) return { approved: false, issues: false };
    return { approved: !!c.approved,
      issues: (c.note || "").trim() !== "" ||
        Object.values(c.optTags || {}).some(a => a && a.length > 0) ||
        Object.values(c.optNotes || {}).some(n => (n || "").trim() !== "") };
  };
  const regStats = {};
  let totalAll = 0, totalApproved = 0, totalIssues = 0;
  if (manifest) {
    manifest.regs.forEach(r => {
      let ap = 0, is = 0;
      r.nrs.forEach(nr => { const st = statFor(nr); if (st.approved) ap++; if (st.issues) is++; });
      regStats[r.id] = { total: r.nrs.length, approved: ap, open: r.nrs.length - ap, issues: is };
      totalAll += r.nrs.length; totalApproved += ap; totalIssues += is;
    });
  }
  const totalOpen = totalAll - totalApproved;
  const curStats = (curReg && regStats[curReg.id]) || { total: 0, approved: 0, open: 0, issues: 0 };

  const toggle = (nr) => setOpenSet(prev => {
    const s = new Set(prev); s.has(nr) ? s.delete(nr) : s.add(nr); return s;
  });

  const FBtn = ({ active, bg, col, bdr, onClick, children }) => (
    <button onClick={onClick} style={{
      padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
      background: active ? bg   : "#f4f5f7",
      color:      active ? col  : "#666",
      border:     active ? "1.5px solid " + bdr : "1px solid rgba(0,0,0,0.10)",
    }}>{children}</button>
  );

  return (
    <div style={{ fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      background:"#f4f5f7", minHeight:"100vh" }}>

      <div style={{ background:"#1a3a6b", color:"#fff", padding:"14px 20px",
        display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontWeight:700, fontSize:16 }}>FDV R 300 - Frageneinstellungen</div>
          <div style={{ fontSize:12, opacity:0.75, marginTop:2 }}>
            {totalAll} Fragen - {totalApproved} geprueft OK - {totalOpen} offen - {totalIssues} mit Korrekturen
          </div>
        </div>
        <div style={{ flex:1 }} />

        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, opacity:0.9, minWidth:170, textAlign:"right", justifyContent:"flex-end" }}>
          <span style={{
            display:"inline-block", width:10, height:10, borderRadius:"50%", flexShrink:0,
            background:
              saveState === "load_error" ? "#b83030" :
              saveState === "error" ? "#b83030" :
              saveState === "loading" ? "#999" :
              saveState === "saving" ? "#e8860a" :
              isDirty ? "#e8860a" : "#2fa84f",
          }} />
          <span>
            {saveState === "loading" && "Lade gespeicherten Stand..."}
            {saveState === "load_error" && "⚠ Laden fehlgeschlagen - nicht speicherbar"}
            {saveState === "saving" && "Speichert..."}
            {saveState === "error" && "⚠ Fehler beim Speichern"}
            {(saveState === "saved" || saveState === "idle") && !isDirty && lastSavedAt &&
              ("✓ Gespeichert um " + lastSavedAt.toLocaleTimeString("de-CH", {hour:"2-digit", minute:"2-digit", second:"2-digit"}))}
            {(saveState === "saved" || saveState === "idle") && !isDirty && !lastSavedAt && "✓ Aktuell"}
            {(saveState === "saved" || saveState === "idle") && isDirty && "Ungespeicherte Änderungen..."}
          </span>
        </div>

        {saveState === "load_error" ? (
          <button onClick={loadFromSupabase} style={{
            padding:"8px 20px", borderRadius:8, border:"none", fontWeight:700,
            fontSize:13, cursor:"pointer", background:"#b83030", color:"#fff",
          }}>
            Erneut laden
          </button>
        ) : (
          <button onClick={saveNow} disabled={saveState === "saving"} style={{
            padding:"8px 20px", borderRadius:8, border:"none", fontWeight:700,
            fontSize:13, cursor: saveState === "saving" ? "default" : "pointer",
            background: saveState === "error" ? "#b83030" : "#e8860a", color:"#fff",
            opacity: saveState === "saving" ? 0.7 : 1,
          }}>
            {saveState === "error" ? "Erneut speichern" : "Jetzt speichern"}
          </button>
        )}

        <button onClick={openClaudeLink} title="Adresse für Claude generieren (immer neu, kein Cache)" style={{
          padding:"8px 16px", borderRadius:8, fontWeight:600,
          fontSize:13, cursor:"pointer", background:"transparent", color:"#fff",
          border:"1.5px solid rgba(255,255,255,0.5)",
        }}>🔗 Link für Claude</button>

        <button onClick={openImport} title="Zuvor exportierte Korrekturen einspielen" style={{
          padding:"8px 16px", borderRadius:8, fontWeight:600,
          fontSize:13, cursor:"pointer", background:"transparent", color:"#fff",
          border:"1.5px solid rgba(255,255,255,0.5)",
        }}>Import</button>

        <button onClick={openExport} title="Korrekturen zum Kopieren/Teilen anzeigen" style={{
          padding:"8px 16px", borderRadius:8, fontWeight:600,
          fontSize:13, cursor:"pointer", background:"transparent", color:"#fff",
          border:"1.5px solid rgba(255,255,255,0.5)",
        }}>Export</button>
      </div>

      {saveState === "error" && saveErrorDetail && (
        <div style={{ background:"#fbeaea", color:"#7a1f1f", padding:"8px 20px",
          fontSize:12, fontFamily:"monospace", wordBreak:"break-word",
          borderBottom:"1px solid rgba(0,0,0,0.08)" }}>
          Speicherfehler-Detail: {saveErrorDetail}
        </div>
      )}

      <div style={{ background:"#fff", borderBottom:"1px solid rgba(0,0,0,0.10)",
        padding:"10px 20px", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Suche nach Begriff oder Nr."
          style={{ padding:"7px 12px", borderRadius:8,
            border:"1px solid rgba(0,0,0,0.10)", fontSize:13,
            outline:"none", minWidth:210 }} />
        <FBtn active={filterOpen} bg="#fbeaea" col="#b83030" bdr="#b83030"
          onClick={() => setFilterOpen(v => !v)}>
          Noch offen ({curStats.open})
        </FBtn>
        <FBtn active={filterIssues} bg="#fff3e0" col="#a05000" bdr="#e8860a"
          onClick={() => setFilterIssues(v => !v)}>
          Mit Korrekturen ({curStats.issues})
        </FBtn>
        {PRIO.map(opt => (
          <FBtn key={opt.value}
            active={filterPrio === opt.value}
            bg={opt.bg} col={opt.color} bdr={opt.color}
            onClick={() => setFilterPrio(filterPrio === opt.value ? 0 : opt.value)}>
            {opt.label}
          </FBtn>
        ))}
        {(search || filterOpen || filterIssues || filterPrio > 0) && (
          <button onClick={() => { setSearch(""); setFilterOpen(false);
            setFilterIssues(false); setFilterPrio(0); }} style={{
            padding:"7px 12px", borderRadius:8, fontSize:12, cursor:"pointer",
            background:"#f4f5f7", color:"#666", border:"1px solid rgba(0,0,0,0.10)" }}>
            Zuruecksetzen
          </button>
        )}
        <div style={{ marginLeft:"auto", fontSize:12, color:"#666" }}>
          {visible.length} von {searching ? totalAll : curStats.total}
        </div>
      </div>

      {manifest && (
        <div style={{ background:"#eef1f6", borderBottom:"1px solid rgba(0,0,0,0.10)",
          padding:"8px 20px", display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {manifest.regs.map(r => {
            const st = regStats[r.id]; const on = r.id === activeReg;
            return (
              <button key={r.id} onClick={() => switchRegister(r.id)} style={{
                padding:"6px 12px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
                background: on ? "#1a3a6b" : "#fff", color: on ? "#fff" : "#1a3a6b",
                border: "1.5px solid " + (on ? "#1a3a6b" : "rgba(26,58,107,0.25)"),
              }}>
                {r.label}
                <span style={{ marginLeft:6, fontSize:11, fontWeight:700,
                  color: on ? "#cfe0ff" : (st.open === 0 ? "#1a7a3c" : "#b83030") }}>
                  {st.open === 0 ? "✓" : st.open + " offen"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ maxWidth:840, margin:"0 auto", padding:"16px 16px 40px" }}>

        {regLoading && (
          <div style={{ textAlign:"center", color:"#666", padding:30, fontSize:14 }}>Lade Fragen...</div>
        )}

        {curReg && !searching && (
          <div style={{ fontSize:11, fontWeight:700, color:"#fff",
            background:"#1a3a6b", padding:"6px 14px", borderRadius:8,
            marginBottom:10, display:"inline-block" }}>
            {curReg.title} - Fragen {curReg.min}-{curReg.max}
          </div>
        )}
        {searching && (
          <div style={{ fontSize:11, fontWeight:700, color:"#fff",
            background:"#e8860a", padding:"6px 14px", borderRadius:8,
            marginBottom:10, display:"inline-block" }}>
            Suche ueber alle Register
          </div>
        )}

        {shown.map(q => (
          <QuestionRow key={q.nr} q={q}
            open={openSet.has(q.nr)}
            onToggle={() => toggle(q.nr)}
            onChange={patch => updateQ(q.nr, patch)} />
        ))}

        {visible.length > shown.length && (
          <div style={{ textAlign:"center", margin:"16px 0" }}>
            <button onClick={() => setLimit(l => l + PAGE_SIZE)} style={{
              padding:"10px 24px", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer",
              background:"#1a3a6b", color:"#fff", border:"none" }}>
              Mehr anzeigen ({visible.length - shown.length} weitere)
            </button>
          </div>
        )}

        {visible.length === 0 && !regLoading && (
          <div style={{ textAlign:"center", color:"#666", padding:60, fontSize:15 }}>
            Keine Fragen gefunden.
          </div>
        )}

        <div style={{ marginTop:24, padding:"14px 16px", borderRadius:10,
          background:"#e8eef7", color:"#1a3a6b", fontSize:13, lineHeight:1.6 }}>
          Deine Aenderungen werden jetzt direkt in einer gemeinsamen Online-Datenbank
          gespeichert (kurz nach jeder Anpassung) - geraeteuebergreifend und dauerhaft,
          kein Export/Import mehr noetig. "Export" bleibt als Kopiermoeglichkeit erhalten,
          falls du den aktuellen Stand mal manuell weitergeben willst.
        </div>
      </div>

      {exportOpen && (
        <div onClick={() => setExportOpen(false)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:1000, padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"#fff", borderRadius:12, padding:20, width:"100%",
            maxWidth:560, maxHeight:"82vh", display:"flex", flexDirection:"column" }}>

            <div style={{ fontWeight:700, fontSize:15, color:"#1a3a6b", marginBottom:6 }}>
              Korrekturen exportieren
            </div>
            <div style={{ fontSize:12, color:"#666", marginBottom:10, lineHeight:1.5 }}>
              Der direkte Datei-Download funktioniert auf dem Handy oft nicht, und ein
              Export mit allen Fragen auf einmal kann beim Kopieren abgeschnitten werden.
              Wähle einen Bereich, kopiere ihn, schick ihn ab - dann den nächsten Bereich.
            </div>

            <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
              {EXPORT_RANGES.map(([lo, hi]) => {
                const active = exportRange && exportRange[0] === lo && exportRange[1] === hi;
                const count = qs.filter(q => q.nr >= lo && q.nr <= hi).length;
                if (count === 0) return null;
                return (
                  <button key={lo} onClick={() => chooseExportRange(lo, hi)} style={{
                    padding:"9px 16px", borderRadius:8, fontWeight:700, fontSize:13,
                    cursor:"pointer", border: active ? "none" : "1px solid rgba(0,0,0,0.15)",
                    background: active ? "#1a3a6b" : "#f4f5f7",
                    color: active ? "#fff" : "#1a3a6b" }}>
                    Export {lo}-{hi}
                  </button>
                );
              })}
            </div>

            {exportRange ? (
              <>
                <textarea ref={exportRef} readOnly value={exportText}
                  onFocus={e => e.target.select()}
                  style={{ flex:1, minHeight:220, fontFamily:"monospace", fontSize:11,
                    padding:10, borderRadius:8, border:"1px solid rgba(0,0,0,0.15)",
                    resize:"none", background:"#fafafa", color:"#1a1a1a" }} />

                <div style={{ display:"flex", gap:8, marginTop:14, flexWrap:"wrap" }}>
                  <button onClick={copyExport} style={{
                    padding:"9px 16px", borderRadius:8, border:"none", fontWeight:700,
                    fontSize:13, cursor:"pointer", color:"#fff",
                    background: copyState === "error" ? "#b83030" : "#1a7a3c" }}>
                    {copyState === "copied" ? "✓ Kopiert"
                      : copyState === "error" ? "Fehler - Text oben manuell markieren"
                      : "In Zwischenablage kopieren"}
                  </button>
                  {canShare && (
                    <button onClick={shareExport} style={{
                      padding:"9px 16px", borderRadius:8, fontWeight:600, fontSize:13,
                      cursor:"pointer", background:"#e8eef7", color:"#1a3a6b",
                      border:"1px solid rgba(0,0,0,0.10)" }}>
                      Teilen
                    </button>
                  )}
                  <button onClick={download} style={{
                    padding:"9px 16px", borderRadius:8, fontWeight:600, fontSize:13,
                    cursor:"pointer", background:"#f4f5f7", color:"#666",
                    border:"1px solid rgba(0,0,0,0.10)" }}>
                    Als Datei (Desktop)
                  </button>
                </div>
              </>
            ) : (
              <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                color:"#999", fontSize:13, minHeight:120 }}>
                Bitte zuerst einen Bereich wählen.
              </div>
            )}

            <div style={{ display:"flex", marginTop:14 }}>
              <div style={{ flex:1 }} />
              <button onClick={() => setExportOpen(false)} style={{
                padding:"9px 16px", borderRadius:8, fontWeight:600, fontSize:13,
                cursor:"pointer", background:"transparent", color:"#666",
                border:"1px solid rgba(0,0,0,0.10)" }}>
                Schliessen
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div onClick={() => setImportOpen(false)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:1000, padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"#fff", borderRadius:12, padding:20, width:"100%",
            maxWidth:560, maxHeight:"82vh", display:"flex", flexDirection:"column" }}>

            <div style={{ fontWeight:700, fontSize:15, color:"#1a3a6b", marginBottom:6 }}>
              Korrekturen importieren
            </div>
            <div style={{ fontSize:12, color:"#666", marginBottom:10, lineHeight:1.5 }}>
              Fuege hier den zuvor exportierten Korrekturen-Text ein. Er wird ueber die
              aktuelle Fragenliste gelegt - bereits vorhandene Bewertungen zu denselben
              Fragen werden dabei ueberschrieben.
            </div>

            <textarea value={importText}
              onChange={e => { setImportText(e.target.value); setImportState("idle"); }}
              placeholder="Hier den kopierten JSON-Text einfuegen ..."
              style={{ flex:1, minHeight:220, fontFamily:"monospace", fontSize:11,
                padding:10, borderRadius:8, border:"1px solid rgba(0,0,0,0.15)",
                resize:"none", background:"#fafafa", color:"#1a1a1a" }} />

            {importState === "error" && (
              <div style={{ marginTop:8, fontSize:12, color:"#b83030" }}>
                Das sieht nicht nach gueltigem JSON aus. Bitte den kompletten Text aus dem
                Export-Dialog einfuegen.
              </div>
            )}
            {importState === "applied" && (
              <div style={{ marginTop:8, fontSize:12, color:"#1a7a3c" }}>
                ✓ Korrekturen uebernommen.
              </div>
            )}

            <div style={{ display:"flex", gap:8, marginTop:14, flexWrap:"wrap" }}>
              <button onClick={applyImport} disabled={!importText.trim()} style={{
                padding:"9px 16px", borderRadius:8, border:"none", fontWeight:700,
                fontSize:13, cursor: importText.trim() ? "pointer" : "default",
                color:"#fff", background:"#1a7a3c",
                opacity: importText.trim() ? 1 : 0.5 }}>
                Anwenden
              </button>
              <div style={{ flex:1 }} />
              <button onClick={() => setImportOpen(false)} style={{
                padding:"9px 16px", borderRadius:8, fontWeight:600, fontSize:13,
                cursor:"pointer", background:"transparent", color:"#666",
                border:"1px solid rgba(0,0,0,0.10)" }}>
                Schliessen
              </button>
            </div>
          </div>
        </div>
      )}

      {claudeLinkOpen && (
        <div onClick={() => setClaudeLinkOpen(false)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:1000, padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"#fff", borderRadius:12, padding:20, width:"100%",
            maxWidth:560, display:"flex", flexDirection:"column" }}>

            <div style={{ fontWeight:700, fontSize:15, color:"#1a3a6b", marginBottom:6 }}>
              Adresse für Claude
            </div>
            <div style={{ fontSize:12, color:"#666", marginBottom:10, lineHeight:1.5 }}>
              Diese Adresse enthaelt immer eine neue, einmalige Zahl am Ende, damit Claude
              nicht an einer alten zwischengespeicherten Antwort haengen bleibt. Kopieren
              und Claude schicken.
            </div>

            <textarea ref={claudeLinkRef} readOnly value={claudeLink}
              onClick={e => e.target.select()}
              style={{ minHeight:80, fontFamily:"monospace", fontSize:11,
                padding:10, borderRadius:8, border:"1px solid rgba(0,0,0,0.15)",
                resize:"none", background:"#fafafa", color:"#1a1a1a" }} />

            {claudeLinkCopyState === "copied" && (
              <div style={{ marginTop:8, fontSize:12, color:"#1a7a3c" }}>
                ✓ In die Zwischenablage kopiert.
              </div>
            )}
            {claudeLinkCopyState === "error" && (
              <div style={{ marginTop:8, fontSize:12, color:"#b83030" }}>
                Kopieren hat nicht geklappt - bitte den Text oben manuell markieren und kopieren.
              </div>
            )}

            <div style={{ display:"flex", gap:8, marginTop:14, flexWrap:"wrap" }}>
              <button onClick={copyClaudeLink} style={{
                padding:"9px 16px", borderRadius:8, border:"none", fontWeight:700,
                fontSize:13, cursor:"pointer", color:"#fff", background:"#1a7a3c" }}>
                Kopieren
              </button>
              <button onClick={openClaudeLink} title="Neue Zahl generieren" style={{
                padding:"9px 16px", borderRadius:8, fontWeight:600, fontSize:13,
                cursor:"pointer", background:"transparent", color:"#1a3a6b",
                border:"1px solid rgba(0,0,0,0.15)" }}>
                🔄 Neu generieren
              </button>
              <div style={{ flex:1 }} />
              <button onClick={() => setClaudeLinkOpen(false)} style={{
                padding:"9px 16px", borderRadius:8, fontWeight:600, fontSize:13,
                cursor:"pointer", background:"transparent", color:"#666",
                border:"1px solid rgba(0,0,0,0.10)" }}>
                Schliessen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
