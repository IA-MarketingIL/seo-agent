import { useState, useEffect } from "react";
import { supabase } from "./src/supabaseClient.js";

const ACCENT = "#0a0f1e";
const BLUE   = "#2563eb";
const GREEN  = "#059669";
const AMBER  = "#d97706";
const RED    = "#dc2626";
const PURPLE = "#7c3aed";

const ARTICLE_TYPES = [
  { value:"informational", label:"מידעי / הסברתי" },
  { value:"commercial",    label:"מסחרי / השוואתי" },
  { value:"local",         label:"מקומי / אזורי" },
  { value:"howto",         label:"מדריך מעשי" },
];
const TONES = [
  { value:"professional",  label:"מקצועי ורשמי" },
  { value:"friendly",      label:"ידידותי וקליל" },
  { value:"authoritative", label:"סמכותי ומשכנע" },
];
const STATUS_LABEL = { suggested:"מוצע", briefed:"תקציר אושר", draft:"טיוטה", scheduled:"מתוזמן", published:"פורסם" };
const STATUS_COLOR = { suggested:BLUE, briefed:AMBER, draft:"#0ea5e9", scheduled:PURPLE, published:GREEN };

const callClaude = async (msg, maxTokens = 2000) => {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: msg, maxTokens }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error("API " + res.status + ": " + (d.error || "unknown error"));
  return d.text || "";
};

const normalizeWorkerUrl=(url)=>(url||"").trim().replace(/\/$/,"");

const getPublishTarget=(client)=>{
  if(!client)return null;
  const workerUrl=normalizeWorkerUrl(client.workerUrl);
  const token=(client.token||"").trim();
  if(!workerUrl||!token)return null;
  return {workerUrl,token,name:client.name||"",domain:client.domain||""};
};

const confirmPublish=(client,articleTitle)=>{
  const target=getPublishTarget(client);
  if(!target){
    alert("חסר חיבור לאתר אצל הלקוח הזה.\nפתחי את כרטיס הלקוח → הגדרות → הזיני Worker URL ו-Auth Token, ואז בדקי חיבור.");
    return false;
  }
  return window.confirm(
    "פרסום לאתר של הלקוח:\n\n"+
    "לקוח: "+target.name+"\n"+
    "דומיין: "+(target.domain||"—")+"\n"+
    "Worker: "+target.workerUrl+"\n"+
    (articleTitle?"מאמר: "+articleTitle+"\n":"")+
    "\nהמאמר יישלח רק לחיבור של הלקוח הזה.\nלהמשיך?"
  );
};

const testWorkerConnection=async({workerUrl,token})=>{
  const base=normalizeWorkerUrl(workerUrl);
  const auth=(token||"").trim();
  if(!base)throw new Error("חסר Worker URL");
  if(!auth)throw new Error("חסר Auth Token");
  if(!/^https?:\/\//i.test(base))throw new Error("Worker URL חייב להתחיל ב-https://");

  let info=null;
  try{
    const infoRes=await fetch(base+"/seo-api/info",{method:"GET"});
    if(!infoRes.ok)throw new Error("HTTP "+infoRes.status);
    info=await infoRes.json();
  }catch(e){
    throw new Error("לא מצליח להגיע ל-Worker (בדיקת /seo-api/info): "+e.message);
  }

  try{
    const pingRes=await fetch(base+"/seo-api/ping",{
      method:"GET",
      headers:{Authorization:"Bearer "+auth},
    });
    if(pingRes.status===401)throw new Error("ה-Auth Token לא תואם ל-Worker של הלקוח");
    if(pingRes.status===404)throw new Error("ה-Worker ישן מדי — חסר endpoint /seo-api/ping. עדכני את תבנית ה-Worker");
    if(!pingRes.ok)throw new Error("בדיקת הרשאה נכשלה (HTTP "+pingRes.status+")");
    const ping=await pingRes.json();
    return {
      ok:true,
      checkedAt:new Date().toISOString(),
      domain:info?.domain||ping?.domain||"",
      articleCount:info?.articleCount??null,
      workerVersion:info?.workerVersion||ping?.workerVersion||"",
    };
  }catch(e){
    if(String(e.message||"").includes("Auth Token")||String(e.message||"").includes("endpoint"))throw e;
    throw new Error("בדיקת הרשאה נכשלה: "+e.message);
  }
};

const pushToWorker = async (client, content) => {
  const target=getPublishTarget(client);
  if(!target)throw new Error("חסר Worker URL או Auth Token אצל הלקוח");
  const res = await fetch(target.workerUrl + "/seo-api/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + target.token },
    body: JSON.stringify(content),
  });
  if (res.status===401) throw new Error("Unauthorized — הטוקן לא תואם ל-Worker של הלקוח");
  if (!res.ok) {
    let detail="";
    try{const d=await res.json();detail=d.error?": "+d.error:"";}catch{}
    throw new Error("HTTP " + res.status + detail);
  }
};

const parseJSON = (txt) => {
  let s = txt.replace(/```json[\s\S]*?```/g, m => m.slice(7,-3)).replace(/```/g,"").trim();
  const si = s.search(/[{[]/); if (si > 0) s = s.slice(si);
  const ei = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]")); if (ei !== -1) s = s.slice(0, ei+1);
  try { return JSON.parse(s); } catch {}
  let out = "", inStr = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inStr && c==='\\' && i+1<s.length) {
      const n=s[i+1]; if ("\"\\\/nrtbfu".includes(n)){out+=c+n;i+=2;continue;} out+=n;i+=2;continue;
    }
    if (c==='"') {
      if (!inStr){inStr=true;out+=c;i++;continue;}
      let j=i+1; while(j<s.length&&(s[j]===' '||s[j]==='\t'))j++;
      const nx=s[j];
      if(nx===':'||nx===','||nx==='}'||nx===']'||j>=s.length){inStr=false;out+=c;i++;continue;}
      out+='\\"';i++;continue;
    }
    if(inStr&&(c==='\n'||c==='\r')){out+='\\n';i++;continue;}
    if(inStr&&c==='\t'){out+='\\t';i++;continue;}
    out+=c;i++;
  }
  try{return JSON.parse(out);}catch{}
  // Last resort: close truncated strings/brackets (response hit max_tokens)
  let fixed=out, inStr2=false, esc2=false, braces=0, brackets=0;
  for(let i=0;i<fixed.length;i++){
    const c=fixed[i];
    if(esc2){esc2=false;continue;}
    if(c==="\\"&&inStr2){esc2=true;continue;}
    if(c==='"'){inStr2=!inStr2;continue;}
    if(inStr2)continue;
    if(c==="{")braces++; if(c==="}")braces--;
    if(c==="[")brackets++; if(c==="]")brackets--;
  }
  if(inStr2)fixed+='"';
  while(brackets>0){fixed+="]";brackets--;}
  while(braces>0){fixed+="}";braces--;}
  try{return JSON.parse(fixed);}catch(e){throw new Error("JSON parse failed: "+e.message+" | raw: "+s.slice(0,120));}
};

// Full articles: metadata as JSON + article body as plain text (avoids JSON-breaking quotes/newlines)
const parseArticleResponse = (txt) => {
  const raw = (txt || "").trim();
  const metaMatch = raw.match(/<<<META>>>\s*([\s\S]*?)\s*<<<ARTICLE>>>/i);
  const articleMatch = raw.match(/<<<ARTICLE>>>\s*([\s\S]*?)(?:\s*<<<END>>>|$)/i);
  if (metaMatch) {
    const meta = parseJSON(metaMatch[1].trim());
    const article = (articleMatch ? articleMatch[1] : "").trim();
    if (!article) throw new Error("המאמר חזר ריק — נסה שוב");
    return {
      title: meta.title || "",
      metaTitle: meta.metaTitle || meta.title || "",
      metaDescription: meta.metaDescription || "",
      slug: meta.slug || "",
      readTime: meta.readTime || "",
      keywords: meta.keywords || [],
      lsiKeywords: meta.lsiKeywords || [],
      outline: meta.outline || [],
      article,
      altTexts: meta.altTexts || [],
      internalLinkSuggestions: meta.internalLinkSuggestions || [],
      seoScore: meta.seoScore || 80,
      seoTips: meta.seoTips || [],
    };
  }
  // Fallback: old single-JSON format
  return parseJSON(raw);
};

const notesBlock=(notes)=>notes?.trim()?"\nClient feedback / corrections (MUST follow):\n"+notes.trim()+"\n":"";

const LANG_LABEL={he:"Hebrew",en:"English","he-en":"Hebrew with some English terms"};
const toDatetimeLocal=(v)=>{
  if(!v)return"";
  const s=String(v);
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s))return s.slice(0,16);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s+"T09:00";
  try{const d=new Date(s);if(isNaN(d))return"";const p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}catch{return"";}
};
const formatDateTime=(d)=>{
  if(!d)return"";
  try{
    const dt=new Date(d);
    if(isNaN(dt))return String(d);
    const hasTime=/T\d{2}:\d{2}/.test(String(d))||String(d).includes(":");
    return dt.toLocaleString("he-IL",{day:"numeric",month:"long",year:"numeric",...(hasTime?{hour:"2-digit",minute:"2-digit"}:{})});
  }catch{return String(d);}
};
const styleGuideBlock=(client)=>{
  const sg=client?.styleGuide;
  if(!sg)return"";
  let out="\n=== CLIENT STYLE GUIDE (MUST MATCH — do not invent a new brand voice) ===\n";
  out+="Language: "+(LANG_LABEL[sg.language]||sg.language||"Hebrew")+"\n";
  if(sg.toneNotes?.trim())out+="Tone: "+sg.toneNotes.trim()+"\n";
  if(sg.audienceNotes?.trim())out+="Audience: "+sg.audienceNotes.trim()+"\n";
  if(sg.writingRules?.trim())out+="Writing rules: "+sg.writingRules.trim()+"\n";
  if(sg.doNot?.trim())out+="Do NOT: "+sg.doNot.trim()+"\n";
  const samples=(sg.sampleArticles||[]).filter(s=>s?.excerpt?.trim()||s?.title?.trim()).slice(0,5);
  if(samples.length){
    out+="Sample articles from this site (match this voice):\n";
    let budget=1500;
    for(const s of samples){
      const chunk=((s.title?"Title: "+s.title+"\n":"")+(s.excerpt||"")).slice(0,Math.min(400,budget));
      if(!chunk.trim())continue;
      out+=chunk+"\n---\n";
      budget-=chunk.length;
      if(budget<=0)break;
    }
  }
  out+="Hard rule: Match the client's existing site voice and look-and-feel. Do NOT invent a new brand style.\n";
  return out;
};
const seoFocusBlock=(client)=>{
  const f=client?.seoFocus;
  if(!f)return"";
  let out="\n=== SEO TIP FOCUS (MUST FOLLOW) ===\n";
  if(f.tipNotes?.trim())out+="Focus: "+f.tipNotes.trim()+"\n";
  if(f.priorities?.trim())out+="Priorities: "+f.priorities.trim()+"\n";
  if(f.avoidTips?.trim())out+="Avoid suggesting: "+f.avoidTips.trim()+"\n";
  out+="Hard rule: Do not suggest redesigning the site, changing brand voice, colors, or navigation structure. Prefer content/meta/technical fixes that preserve the existing look and feel.\n";
  return out;
};
const articleBody=(a)=>a?.draftContent?.article||a?.publishedContent?.content||"";

// ── DATA LAYER ────────────────────────────────────────────────────────────────
// localStorage stays the synchronous source of truth for rendering; every write
// is also mirrored to Supabase (debounced) so data survives cache clears and is
// available from other devices. On boot, DB.hydrate() pulls Supabase → local.
let syncTimer = null;
function syncToSupabase(list) {
  if (!supabase) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (!list.length) return;
    const rows = list.map(c => ({ id: c.id, data: c, updated_at: new Date().toISOString() }));
    await supabase.from("seo_clients").upsert(rows);
  }, 600);
}

const DB = {
  get()   { try{return JSON.parse(localStorage.getItem("seo_v2")||"[]");}catch{return[];} },
  save(l) { localStorage.setItem("seo_v2", JSON.stringify(l)); syncToSupabase(l); },
  async hydrate() {
    if (!supabase) return;
    const { data, error } = await supabase.from("seo_clients").select("data");
    if (error || !data || data.length === 0) return;
    localStorage.setItem("seo_v2", JSON.stringify(data.map(r => r.data)));
  },
  upsert(data) {
    const list = this.get();
    const idx  = list.findIndex(c => c.domain === data.domain);
    const prev = idx >= 0 ? list[idx] : {};
    const existingArticles = prev.articles || [];
    const newOnes = (data.articles||[]).filter(na => !existingArticles.some(ea=>ea.title===na.title));
    const merged  = { ...prev, ...data, articles: [...newOnes, ...existingArticles] };
    if (idx >= 0) list[idx] = merged; else list.unshift(merged);
    this.save(list); return merged;
  },
  getById(id)      { return this.get().find(c=>c.id===id)||null; },
  update(id, upd)  { const l=this.get(),i=l.findIndex(c=>c.id===id); if(i>=0){l[i]={...l[i],...upd};this.save(l);} },
  updateArticle(clientId, articleId, upd) {
    const l=this.get(), ci=l.findIndex(c=>c.id===clientId); if(ci<0)return;
    const ai=(l[ci].articles||[]).findIndex(a=>a.id===articleId); if(ai<0)return;
    l[ci].articles[ai]={...l[ci].articles[ai],...upd}; this.save(l);
  },
  addArticle(clientId, article) {
    const l=this.get(), ci=l.findIndex(c=>c.id===clientId); if(ci<0)return;
    l[ci].articles=[article,...(l[ci].articles||[])]; this.save(l);
  },
  deleteArticle(clientId, articleId) {
    const l=this.get(), ci=l.findIndex(c=>c.id===clientId); if(ci<0)return;
    l[ci].articles=(l[ci].articles||[]).filter(a=>a.id!==articleId);
    this.save(l);
  },
};
const hasFullArticle=(a)=>!!(a?.draftContent?.article||a?.publishedContent?.content);
const uid = () => Math.random().toString(36).slice(2,10);
const getActiveClients=(activeClientId)=>activeClientId?DB.get().filter(c=>c.id===activeClientId):DB.get();

// ── UI PRIMITIVES ─────────────────────────────────────────────────────────────
function Spin({size=16,color=BLUE}){
  return <div style={{width:size,height:size,border:`2px solid #e2e8f0`,borderTop:`2px solid ${color}`,borderRadius:"50%",animation:"spin .7s linear infinite",flexShrink:0}}/>;
}
function StepRow({icon,text,status}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:9,padding:"6px 0",borderBottom:"1px solid #f1f5f9"}}>
      <span>{icon}</span>
      <span style={{flex:1,fontSize:12,color:"#334155",fontFamily:"Heebo,sans-serif"}}>{text}</span>
      {status==="loading"&&<Spin size={13}/>}
      {status==="done"&&<span style={{color:GREEN}}>✓</span>}
      {status==="error"&&<span style={{color:RED}}>✗</span>}
    </div>
  );
}
function Field({label,name,value,onChange,placeholder,as="input",options,multiline,rows=3,ltr=false}){
  const base={width:"100%",padding:"9px 12px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"Heebo,sans-serif",background:"#fff",color:ACCENT,outline:"none",boxSizing:"border-box",direction:ltr?"ltr":"rtl"};
  return(
    <div style={{marginBottom:12}}>
      {label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#374151",marginBottom:4,fontFamily:"Heebo,sans-serif"}}>{label}</label>}
      {as==="select"
        ?<select name={name} value={value} onChange={onChange} style={base}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
        :multiline
          ?<textarea name={name} value={value} onChange={onChange} placeholder={placeholder} rows={rows} style={{...base,resize:"vertical"}} onFocus={e=>e.target.style.borderColor=BLUE} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
          :<input name={name} value={value} onChange={onChange} placeholder={placeholder} style={base} onFocus={e=>e.target.style.borderColor=BLUE} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
      }
    </div>
  );
}
function NavTab({label,active,onClick,badge}){
  return(
    <button onClick={onClick} style={{padding:"0 16px",height:52,border:"none",background:"transparent",color:active?"#fff":"#64748b",borderBottom:active?`2px solid ${BLUE}`:"2px solid transparent",fontFamily:"Heebo,sans-serif",fontSize:13,fontWeight:active?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
      {label}{badge>0&&<span style={{background:BLUE,color:"#fff",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:700}}>{badge}</span>}
    </button>
  );
}
function ScoreBadge({score}){
  const c=score>=80?GREEN:score>=50?AMBER:RED;
  return(
    <div style={{display:"inline-flex",alignItems:"center",gap:8,background:c+"15",border:`1.5px solid ${c}`,borderRadius:10,padding:"6px 18px"}}>
      <span style={{fontSize:26,fontWeight:800,color:c,fontFamily:"Heebo,sans-serif"}}>{score}</span>
      <span style={{fontSize:11,color:c,fontWeight:700,fontFamily:"Heebo,sans-serif"}}>ציון SEO</span>
    </div>
  );
}
function AuditRow({label,value,status,detail,onFix}){
  const c={good:GREEN,warning:AMBER,error:RED,info:BLUE,fixed:GREEN}[status]||BLUE;
  const ic={good:"✓",warning:"⚠",error:"✗",info:"ℹ",fixed:"✓"}[status]||"•";
  return(
    <div style={{display:"flex",alignItems:"flex-start",gap:11,padding:"10px 0",borderBottom:"1px solid #f8fafc"}}>
      <div style={{width:22,height:22,background:c+"18",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:c,flexShrink:0,marginTop:1}}>{ic}</div>
      <div style={{flex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{fontSize:13,fontWeight:600,color:ACCENT,fontFamily:"Heebo,sans-serif"}}>{label}</span>
          {value&&<span style={{fontSize:12,color:c,fontWeight:600,background:c+"12",borderRadius:6,padding:"1px 8px"}}>{value}</span>}
          {status==="fixed"&&<span style={{fontSize:11,color:GREEN,fontWeight:700,background:GREEN+"12",borderRadius:6,padding:"1px 8px"}}>תוקן ✓</span>}
        </div>
        {detail&&<div style={{fontSize:12,color:"#64748b",marginTop:3,lineHeight:1.5,fontFamily:"Heebo,sans-serif"}}>{detail}</div>}
      </div>
      {onFix&&status!=="fixed"&&status!=="good"&&(
        <button onClick={onFix} style={{background:RED+"12",color:RED,border:`1px solid ${RED}30`,borderRadius:6,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0,whiteSpace:"nowrap",fontFamily:"Heebo,sans-serif"}}>🔧 תקן</button>
      )}
    </div>
  );
}
function StatusBadge({status}){
  const c=STATUS_COLOR[status]||BLUE, l=STATUS_LABEL[status]||status;
  return <span style={{background:c+"18",color:c,border:`1px solid ${c}35`,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700,fontFamily:"Heebo,sans-serif",whiteSpace:"nowrap"}}>{l}</span>;
}
function ArticleView({text}){
  return(
    <div style={{direction:"rtl",fontFamily:"Heebo,sans-serif",lineHeight:1.9}}>
      {(text||"").split("\n").map((line,i)=>{
        if(line.startsWith("### "))return<h3 key={i} style={{fontSize:16,fontWeight:700,color:ACCENT,margin:"18px 0 5px"}}>{line.slice(4)}</h3>;
        if(line.startsWith("## "))return<h2 key={i} style={{fontSize:19,fontWeight:700,color:ACCENT,margin:"26px 0 7px",borderBottom:`2px solid ${BLUE}20`,paddingBottom:4}}>{line.slice(3)}</h2>;
        if(line.trim()==="")return<div key={i} style={{height:6}}/>;
        return<p key={i} style={{fontSize:15,color:"#334155",margin:"5px 0"}}>{line}</p>;
      })}
    </div>
  );
}

// ── SITE SCANNER ──────────────────────────────────────────────────────────────
function SiteScanner({onClientSaved}){
  const [url,setUrl]=useState(""); const [bizName,setBizName]=useState("");
  const [industry,setIndustry]=useState(""); const [desc,setDesc]=useState("");
  const [steps,setSteps]=useState([]); const [scanning,setScan]=useState(false);
  const [error,setError]=useState(null);
  const upd=(idx,st)=>setSteps(s=>s.map((x,i)=>i===idx?{...x,status:st}:x));

  const scan=async()=>{
    if(!url.trim()){setError("נא להזין URL");return;}
    const u=url.trim().startsWith("http")?url.trim():"https://"+url.trim();
    setScan(true);setError(null);
    setSteps([
      {icon:"🌐",text:"סורק תוכן האתר",status:"loading"},
      {icon:"🔍",text:"מנתח פרטי העסק",status:"idle"},
      {icon:"✍",text:"לומד סגנון כתיבה",status:"idle"},
      {icon:"💡",text:"מציע מאמרים",status:"idle"},
      {icon:"🔑",text:"מחקר מילות מפתח + אודיט",status:"idle"},
    ]);
    try{
      let pageContent="";
      try{
        const r=await fetch("https://r.jina.ai/"+u,{signal:AbortSignal.timeout(9000),headers:{"Accept":"text/plain"}});
        if(r.ok)pageContent=(await r.text()).slice(0,4500);
      }catch{}
      upd(0,"done");upd(1,"loading");

      const extractPrompt=
        "You are an Israeli SEO expert. Analyze this website and return ONLY valid JSON.\n"+
        "URL: "+u+"\nBusiness name: "+(bizName||"not provided")+"\nIndustry: "+(industry||"INFER")+"\nDescription: "+(desc||"not provided")+"\n"+
        (pageContent?"\nPage content:\n"+pageContent+"\n":"")+
        "\nReturn JSON with Hebrew values:\n"+
        '{"businessName":"...","industry":"...","location":"city or region in Hebrew, empty if unknown","mainKeywords":["k1","k2","k3","k4","k5"],"existingTopics":["t1","t2","t3"],"businessDescription":"...","targetAudience":"...","competitors":["c1","c2"]}\n'+
        "Extract the geographic location from the content (city, region like 'צפון', 'מרכז', etc.). NEVER use double-quote inside string values.";

      const extractTxt=await callClaude(extractPrompt,900);
      const extracted=parseJSON(extractTxt);
      if(bizName)extracted.businessName=bizName;
      if(industry)extracted.industry=industry;
      if(desc)extracted.businessDescription=desc;
      upd(1,"done");upd(2,"loading");

      const stylePrompt=
        "Analyze this website's writing voice and propose a style guide for future SEO articles.\n"+
        "URL: "+u+"\nBusiness: "+(extracted.businessName||"")+"\nIndustry: "+(extracted.industry||"")+"\n"+
        (pageContent?"\nPage content sample:\n"+pageContent.slice(0,3500)+"\n":"")+
        "\nReturn ONLY valid JSON:\n"+
        '{"language":"he","toneNotes":"...","audienceNotes":"...","writingRules":"...","doNot":"...","sampleArticles":[{"title":"...","excerpt":"150-250 words sample in same voice","url":""}]}\n'+
        "language must be he, en, or he-en. All notes in Hebrew. Infer tone from the real site. NEVER use double-quote inside string values.";
      let styleGuide={language:"he",toneNotes:"",audienceNotes:"",writingRules:"",doNot:"",sampleArticles:[]};
      try{
        const styleTxt=await callClaude(stylePrompt,1500);
        const sg=parseJSON(styleTxt);
        styleGuide={
          language:["he","en","he-en"].includes(sg.language)?sg.language:"he",
          toneNotes:sg.toneNotes||"",
          audienceNotes:sg.audienceNotes||extracted.targetAudience||"",
          writingRules:sg.writingRules||"",
          doNot:sg.doNot||"",
          sampleArticles:Array.isArray(sg.sampleArticles)?sg.sampleArticles.slice(0,3).map(s=>({title:s.title||"",excerpt:s.excerpt||"",url:s.url||""})):[],
        };
      }catch{}
      upd(2,"done");upd(3,"loading");

      const suggestPrompt=
        "You are an Israeli SEO expert. Suggest 8 blog articles.\n"+
        "Industry: "+extracted.industry+"\nBusiness: "+extracted.businessName+"\nLocation: "+(extracted.location||"ישראל")+
        "\nDescription: "+(desc||extracted.businessDescription)+"\nTarget audience: "+extracted.targetAudience+
        "\nKeywords: "+(extracted.mainKeywords||[]).join(", ")+"\n"+
        styleGuideBlock({styleGuide})+"\n"+
        "All 8 articles must be strictly about '"+extracted.industry+"'. Mix types.\n"+
        "Include at least 2 local articles targeting: "+(extracted.location||"האזור")+"\n\n"+
        "Return ONLY valid JSON:\n"+
        '{"suggestions":[{"title":"Hebrew title","keywords":"Hebrew keywords","type":"informational","reason":"Hebrew SEO reason","priority":"high"}]}\n'+
        "Types: informational, commercial, local, howto. All values in Hebrew. NEVER use double-quote inside string values.";

      const suggestTxt=await callClaude(suggestPrompt,2000);
      const suggested=parseJSON(suggestTxt);
      upd(3,"done");upd(4,"loading");

      const loc=extracted.location||"ישראל";
      const kwPrompt=
        "You are an Israeli local SEO expert. Research keywords for this business.\n"+
        "Industry: "+extracted.industry+"\nLocation: "+loc+"\nTarget audience: "+extracted.targetAudience+"\n\n"+
        "Return 12 Hebrew SEO keywords mixing general + local variants.\n"+
        'Return ONLY valid JSON: {"keywords":[{"keyword":"מילת חיפוש","intent":"local|informational|commercial","competition":"low|medium|high","priority":8,"recommended":true,"localVariants":["kw + עיר","kw + אזור"]}]}\n'+
        "priority is 1-10 (10=highest estimated monthly search volume). Mark top 4 keywords as recommended:true. Sort by priority descending. NEVER use double-quote inside string values.";

      const auditPrompt=
        "You are a technical SEO expert. Perform a quick SEO audit.\n"+
        "URL: "+u+"\nBusiness: "+extracted.businessName+"\nIndustry: "+extracted.industry+"\n"+
        (pageContent?"\nPage content:\n"+pageContent.slice(0,1500)+"\n":"")+
        "\nReturn ONLY valid JSON with this EXACT structure:\n"+
        '{"overallScore":72,"grade":"B","summary":"קצר עד 20 מילה","checks":[{"category":"מטא-דאטה","items":[{"label":"Meta Title","status":"good","value":"val","detail":"הסבר"}]},{"category":"תוכן","items":[{"label":"איכות תוכן","status":"warning","value":"val","detail":"הסבר"}]},{"category":"טכני","items":[{"label":"מהירות","status":"good","value":"val","detail":"הסבר"}]}],"topIssues":["בעיה1","בעיה2","בעיה3"],"quickWins":["פעולה1","פעולה2","פעולה3"]}\n'+
        "Exactly 3 categories, exactly 3 items each. Keep Hebrew strings SHORT (under 15 words). NEVER use double-quote inside string values.";

      const [kwTxt,auditTxt]=await Promise.all([
        callClaude(kwPrompt,1200),
        callClaude(auditPrompt,3000),
      ]);
      const kwData=parseJSON(kwTxt);
      const auditData=parseJSON(auditTxt);
      upd(4,"done");

      let domain=u; try{domain=new URL(u).hostname;}catch{}
      const articles=(suggested.suggestions||[]).map(s=>({
        id:uid(), title:s.title, keywords:s.keywords, type:s.type||"informational",
        reason:s.reason, priority:s.priority, status:"suggested", source:"suggested",
        brief:null, notes:"", draftContent:null, scheduledDate:null, publishedAt:null, slug:"",
      }));

      const client=DB.upsert({
        id:uid(), name:extracted.businessName||domain, domain, url:u,
        workerUrl:"", token:"",
        industry:extracted.industry, location:extracted.location||"",
        mainKeywords:extracted.mainKeywords||[], targetAudience:extracted.targetAudience||"",
        businessDescription:extracted.businessDescription||"",
        competitors:extracted.competitors||[],
        scannedAt:new Date().toISOString(),
        keywordResearch:kwData.keywords||[],
        audit:auditData, articles,
        styleGuide,
      });

      onClientSaved(client.id);
    }catch(e){
      setSteps(s=>s.map(x=>x.status==="loading"?{...x,status:"error"}:x));
      setError("שגיאה: "+e.message);
    }
    setScan(false);
  };

  return(
    <div style={{display:"flex",flex:1,alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{width:"100%",maxWidth:560,background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:"36px 32px",boxShadow:"0 4px 24px #0f172a08"}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:36,marginBottom:8}}>✦</div>
          <div style={{fontSize:20,fontWeight:800,color:ACCENT,fontFamily:"Heebo,sans-serif"}}>סריקה מלאה</div>
          <div style={{fontSize:13,color:"#64748b",marginTop:6,lineHeight:1.8,fontFamily:"Heebo,sans-serif"}}>מנתח אתר, מציע מאמרים, חוקר מילות מפתח ומבצע אודיט — ויוצר כרטיס לקוח</div>
        </div>
        <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:9,padding:"9px 13px",marginBottom:18,fontSize:12,color:"#1e40af",fontFamily:"Heebo,sans-serif"}}>
          🌐 הסוכן סורק את האתר האמיתי, מזהה מיקום גיאוגרפי ובונה אסטרטגיית SEO מקומית
        </div>
        <Field label="URL האתר *" name="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.co.il"/>
        <Field label="שם העסק" name="biz" value={bizName} onChange={e=>setBizName(e.target.value)} placeholder="שם העסק"/>
        <Field label="תחום (אופציונלי)" name="ind" value={industry} onChange={e=>setIndustry(e.target.value)} placeholder="יזוהה אוטומטית"/>
        <Field label="תיאור קצר" name="desc" value={desc} onChange={e=>setDesc(e.target.value)} placeholder="תיאור קצר..." multiline/>
        {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"9px 13px",fontSize:12,color:RED,marginBottom:12}}>{error}</div>}
        <button onClick={scan} disabled={scanning||!url.trim()} style={{width:"100%",background:scanning?"#94a3b8":BLUE,color:"#fff",border:"none",borderRadius:9,padding:"13px 0",fontSize:14,fontWeight:700,cursor:scanning?"not-allowed":"pointer",fontFamily:"Heebo,sans-serif"}}>
          {scanning?<span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Spin color="#fff" size={14}/>סורק...</span>:"✦ סרוק וצור כרטיס לקוח"}
        </button>
        {steps.length>0&&<div style={{marginTop:16,background:"#f8fafc",borderRadius:9,padding:"12px 14px"}}>{steps.map((s,i)=><StepRow key={i} {...s}/>)}</div>}
      </div>
    </div>
  );
}

// ── CLIENT MANAGER ────────────────────────────────────────────────────────────
function ClientManager({onWriteArticle,initialOpenId,onSelectClient}){
  const [clients,setClients]=useState(DB.get());
  const [openId,setOpenId]=useState(initialOpenId||null);
  const [cardTab,setCardTab]=useState("articles");
  const [customDir,setCustomDir]=useState("");
  const [addingCustom,setAddingCustom]=useState(false);
  const [genBriefId,setGenBriefId]=useState(null);
  const [previewArticle,setPreviewArticle]=useState(null);
  const [regenTipsLoading,setRegenTipsLoading]=useState(false);
  const initialClient=initialOpenId?DB.getById(initialOpenId):null;
  const [focusedKeywords,setFocusedKeywords]=useState(initialClient?.focusedKeywords||[]);
  const [fixModal,setFixModal]=useState(null);
  const [versionsModal,setVersionsModal]=useState(null);
  const [reverting,setReverting]=useState(false);
  const [styleGuide,setStyleGuide]=useState(initialClient?.styleGuide||{language:"he",toneNotes:"",audienceNotes:"",writingRules:"",doNot:"",sampleArticles:[]});
  const [seoFocus,setSeoFocus]=useState(initialClient?.seoFocus||{tipNotes:"",avoidTips:"",priorities:""});
  const refresh=()=>setClients(DB.get());

  const client=openId?DB.getById(openId):null;

  // update Worker settings
  const [workerUrl,setWorkerUrl]=useState(initialClient?.workerUrl||"");
  const [token,setToken]=useState(initialClient?.token||"");
  const [connTesting,setConnTesting]=useState(false);
  const [connMsg,setConnMsg]=useState("");
  const [connOk,setConnOk]=useState(null);
  const [settingsSaved,setSettingsSaved]=useState(false);

  useEffect(()=>{
    if(initialOpenId){
      const c=DB.getById(initialOpenId);
      setOpenId(initialOpenId);
      setWorkerUrl(c?.workerUrl||"");
      setToken(c?.token||"");
      setFocusedKeywords(c?.focusedKeywords||[]);
      setStyleGuide(c?.styleGuide||{language:"he",toneNotes:"",audienceNotes:"",writingRules:"",doNot:"",sampleArticles:[]});
      setSeoFocus(c?.seoFocus||{tipNotes:"",avoidTips:"",priorities:""});
      setConnMsg("");setConnOk(null);setSettingsSaved(false);
    }
  },[initialOpenId]);

  const openCard=(id)=>{
    const c=DB.getById(id);
    setWorkerUrl(c?.workerUrl||"");
    setToken(c?.token||"");
    setFocusedKeywords(c?.focusedKeywords||[]);
    setStyleGuide(c?.styleGuide||{language:"he",toneNotes:"",audienceNotes:"",writingRules:"",doNot:"",sampleArticles:[]});
    setSeoFocus(c?.seoFocus||{tipNotes:"",avoidTips:"",priorities:""});
    setConnMsg("");setConnOk(null);setSettingsSaved(false);
    setOpenId(id); setCardTab("articles");
    onSelectClient?.(id);
  };

  const saveSettings=()=>{
    const cleanUrl=normalizeWorkerUrl(workerUrl);
    const cleanToken=(token||"").trim();
    DB.update(openId,{workerUrl:cleanUrl,token:cleanToken,publishConnection:null});
    setWorkerUrl(cleanUrl);
    setToken(cleanToken);
    setConnMsg("");setConnOk(null);
    setSettingsSaved(true);
    setTimeout(()=>setSettingsSaved(false),2000);
    refresh();
  };

  const testConnection=async()=>{
    setConnTesting(true);setConnMsg("");setConnOk(null);
    try{
      const result=await testWorkerConnection({workerUrl,token});
      DB.update(openId,{
        workerUrl:normalizeWorkerUrl(workerUrl),
        token:(token||"").trim(),
        publishConnection:{
          ok:true,
          checkedAt:result.checkedAt,
          domain:result.domain||"",
          articleCount:result.articleCount,
          workerVersion:result.workerVersion||"",
        },
      });
      setConnOk(true);
      setConnMsg(
        "החיבור תקין"+
        (result.domain?" · "+result.domain:"")+
        (result.articleCount!=null?" · "+result.articleCount+" מאמרים ב-Worker":"")+
        (result.workerVersion?" · v"+result.workerVersion:"")
      );
      refresh();
    }catch(e){
      DB.update(openId,{
        publishConnection:{ok:false,checkedAt:new Date().toISOString(),error:e.message},
      });
      setConnOk(false);
      setConnMsg(e.message);
      refresh();
    }
    setConnTesting(false);
  };

  const saveFocusedKeywords=()=>{
    DB.update(openId,{focusedKeywords});
    refresh();
  };

  const toggleKeyword=(kw)=>{
    setFocusedKeywords(prev=>
      prev.includes(kw)?prev.filter(k=>k!==kw):[...prev,kw]
    );
  };

  const generateFix=async(item)=>{
    setFixModal({item,loading:true,fix:null,fixed:false});
    try{
      const c=DB.getById(openId);
      const prompt=
        "You are an SEO technical expert. Generate a specific, actionable fix for this SEO issue.\n"+
        "Website: "+c.url+"\nBusiness: "+c.name+"\nIndustry: "+c.industry+"\n"+
        "Issue: "+item.label+"\nDetail: "+(item.detail||"")+"\nCurrent value: "+(item.value||"")+"\n"+
        styleGuideBlock(c)+seoFocusBlock(c)+
        "\n"+
        'Return ONLY valid JSON: {"fixTitle":"...","codeSnippet":"...","language":"html","instructions":"...","estimatedImpact":"low|medium|high"}\n'+
        "instructions must be in Hebrew. codeSnippet is the exact code to copy-paste. NEVER use double-quote inside string values. Do not suggest redesigning the site.";
      const txt=await callClaude(prompt,800);
      const fix=parseJSON(txt);
      setFixModal(m=>({...m,loading:false,fix}));
    }catch(e){
      setFixModal(null);
      alert("שגיאה: "+e.message);
    }
  };

  const markFixed=(item)=>{
    const c=DB.getById(openId);
    if(!c?.audit)return;
    const newAudit={
      ...c.audit,
      checks:(c.audit.checks||[]).map(cat=>({
        ...cat,
        items:(cat.items||[]).map(i=>i.label===item.label?{...i,status:"fixed"}:i),
      })),
    };
    DB.update(openId,{audit:newAudit});
    setFixModal(null);
    refresh();
  };

  const revertVersion=async(article,version)=>{
    const c=DB.getById(openId);
    if(!getPublishTarget(c)){alert("הגדר Worker URL ו-Auth Token בהגדרות הלקוח");return;}
    if(!confirmPublish(c,version.title||article.title))return;
    setReverting(true);
    try{
      const now=new Date().toISOString();
      await pushToWorker(c,{title:version.title,metaTitle:version.metaTitle,metaDescription:version.metaDescription,content:version.content,keywords:version.keywords,slug:version.slug,publishedAt:now});
      const remaining=(article.versions||[]).filter(v=>v.version!==version.version);
      const archived={...article.publishedContent,publishedAt:article.publishedAt,version:(article.versions?.length||0)+1};
      DB.updateArticle(openId,article.id,{
        publishedAt:now, slug:version.slug,
        publishedContent:{title:version.title,metaTitle:version.metaTitle,metaDescription:version.metaDescription,content:version.content,keywords:version.keywords,slug:version.slug},
        versions:[...remaining,archived],
      });
      setVersionsModal(null);
      refresh();
    }catch(e){alert("שגיאה בשחזור: "+e.message);}
    setReverting(false);
  };

  const addCustomArticle=async()=>{
    if(!customDir.trim()||!openId)return;
    setAddingCustom(true);
    try{
      const c=DB.getById(openId);
      const prompt=
        "Create an SEO article brief based on this custom direction.\n\n"+
        "Custom direction: "+customDir+"\n"+
        "Industry: "+c.industry+"\nLocation: "+(c.location||"ישראל")+"\nBusiness: "+c.name+"\nKeywords: "+(c.mainKeywords||[]).join(", ")+"\n"+
        ((c.focusedKeywords||[]).length>0?"Focused keywords to integrate: "+c.focusedKeywords.join(", ")+"\n":"")+
        styleGuideBlock(c)+"\n"+
        'Return ONLY valid JSON: {"title":"...","keywords":"...","type":"informational","brief":{"briefTitle":"...","angle":"...","outline":["...","...","..."],"primaryKeyword":"...","whyThisArticle":"..."}}\n'+
        "Keep outline to 3 short items. Write values in the client's language. NEVER use double-quote inside string values.";
      const txt=await callClaude(prompt,1500);
      const data=parseJSON(txt);
      const article={
        id:uid(), title:data.title||customDir, keywords:data.keywords||"",
        type:data.type||"informational", reason:"מאמר מותאם אישית", priority:"high",
        status:"briefed", source:"custom", brief:data.brief||null, notes:"",
        draftContent:null, scheduledDate:null, publishedAt:null, slug:"",
      };
      DB.addArticle(openId,article);
      setCustomDir("");
    }catch(e){alert("שגיאה: "+e.message);}
    setAddingCustom(false);
    refresh();
  };

  const scheduleArticle=(articleId,date)=>{
    const art=DB.getById(openId)?.articles?.find(a=>a.id===articleId);
    if(date&&!hasFullArticle(art)){
      alert("אפשר לתזמן רק אחרי שיש מאמר מלא (לא רק תקציר). לחץ 'כתוב מאמר מלא' קודם.");
      return;
    }
    const nextStatus=date?"scheduled":(hasFullArticle(art)?"draft":"briefed");
    DB.updateArticle(openId,articleId,{scheduledDate:date||null,status:nextStatus});
    refresh();
  };

  const deleteArticle=(articleId)=>{
    if(!confirm("למחוק את המאמר?"))return;
    DB.deleteArticle(openId,articleId);
    refresh();
  };

  const saveArticleNotes=(articleId,notes)=>{
    DB.updateArticle(openId,articleId,{notes});
    refresh();
  };

  const saveStyleGuide=()=>{
    DB.update(openId,{styleGuide});
    refresh();
  };

  const saveSeoFocus=()=>{
    DB.update(openId,{seoFocus});
    refresh();
  };

  const regenerateFocusedTips=async()=>{
    if(!openId)return;
    setRegenTipsLoading(true);
    try{
      const c=DB.getById(openId);
      const prompt=
        "You are an Israeli SEO consultant. Refine SEO tips for this client.\n"+
        "Business: "+c.name+" | URL: "+c.url+" | Industry: "+c.industry+"\n"+
        "Current top issues: "+JSON.stringify(c.audit?.topIssues||[])+"\n"+
        "Current quick wins: "+JSON.stringify(c.audit?.quickWins||[])+"\n"+
        styleGuideBlock(c)+seoFocusBlock(c)+
        "\nReturn ONLY valid JSON: {\"topIssues\":[\"...\",\"...\",\"...\"],\"quickWins\":[\"...\",\"...\",\"...\"],\"focusedTips\":[\"...\"]}\n"+
        "All strings in Hebrew. Keep 3-5 items each. NEVER use double-quote inside string values.";
      const txt=await callClaude(prompt,1200);
      const data=parseJSON(txt);
      const audit={...(c.audit||{}),topIssues:data.topIssues||c.audit?.topIssues,quickWins:data.quickWins||c.audit?.quickWins,focusedTips:data.focusedTips||[]};
      DB.update(openId,{audit,seoFocus});
      refresh();
    }catch(e){alert("שגיאה: "+e.message);}
    setRegenTipsLoading(false);
  };

  const regenerateBriefFromNotes=async(article)=>{
    if(!openId||!article)return;
    setGenBriefId(article.id);
    try{
      const c=DB.getById(openId);
      const prompt=
        "Create an SEO article brief.\n\n"+
        "Topic: "+article.title+"\nKeywords: "+(article.keywords||"")+
        "\nIndustry: "+(c.industry||"")+"\nLocation: "+(c.location||"")+
        "\nArticle type: "+(article.type||"informational")+
        notesBlock(article.notes)+
        ((c.focusedKeywords||[]).length>0?"\nFocused keywords: "+c.focusedKeywords.join(", ")+"\n":"")+
        styleGuideBlock(c)+
        "\nReturn ONLY valid JSON: {\"briefTitle\":\"...\",\"angle\":\"...\",\"outline\":[\"...\",\"...\",\"...\"],\"primaryKeyword\":\"...\",\"whyThisArticle\":\"...\"}\n"+
        "Keep outline to 3 short items. Write in the client's language. NEVER use double-quote inside string values.";
      const txt=await callClaude(prompt,1500);
      const b=parseJSON(txt);
      DB.updateArticle(openId,article.id,{brief:b,status:"briefed"});
      refresh();
    }catch(e){alert("שגיאה: "+e.message);}
    setGenBriefId(null);
  };

  const formatDate=(d)=>formatDateTime(d);

  // list view
  if(!openId){
    return(
      <div style={{flex:1,overflowY:"auto",padding:"28px 32px",background:"#f8fafc"}}>
        <div style={{maxWidth:900,margin:"0 auto"}}>
          <div style={{fontSize:20,fontWeight:800,color:ACCENT,fontFamily:"Heebo,sans-serif",marginBottom:20}}>לקוחות</div>
          {clients.length===0?(
            <div style={{textAlign:"center",padding:"60px 0",color:"#94a3b8",fontSize:14,fontFamily:"Heebo,sans-serif"}}>
              אין לקוחות עדיין — עבור ל"סריקה" כדי להוסיף לקוח ראשון
            </div>
          ):(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
              {clients.map(c=>{
                const total=c.articles?.length||0;
                const pub=(c.articles||[]).filter(a=>a.status==="published").length;
                const sched=(c.articles||[]).filter(a=>a.status==="scheduled").length;
                const score=c.audit?.overallScore;
                return(
                  <div key={c.id} onClick={()=>openCard(c.id)} style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",padding:"18px 20px",cursor:"pointer",transition:"box-shadow .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.boxShadow="0 4px 20px #0f172a12"}
                    onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <div>
                        <div style={{fontSize:15,fontWeight:800,color:ACCENT,fontFamily:"Heebo,sans-serif"}}>{c.name}</div>
                        <div style={{fontSize:11,color:"#94a3b8",direction:"ltr",marginTop:2}}>{c.domain}</div>
                      </div>
                      {score&&<div style={{background:score>=80?GREEN:score>=50?AMBER:RED,color:"#fff",borderRadius:8,padding:"3px 10px",fontSize:13,fontWeight:800}}>{score}</div>}
                    </div>
                    <div style={{fontSize:12,color:"#64748b",marginBottom:10,fontFamily:"Heebo,sans-serif"}}>{c.industry}{c.location?" · "+c.location:""}</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <span style={{background:BLUE+"14",color:BLUE,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>{total} מאמרים</span>
                      {sched>0&&<span style={{background:PURPLE+"14",color:PURPLE,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>{sched} מתוזמן</span>}
                      {pub>0&&<span style={{background:GREEN+"14",color:GREEN,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>{pub} פורסם</span>}
                      {c.workerUrl&&c.token?(
                        <span style={{background:(c.publishConnection?.ok?GREEN:AMBER)+"14",color:c.publishConnection?.ok?GREEN:AMBER,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>
                          {c.publishConnection?.ok?"🔗 מחובר":"⚙ חיבור מוגדר"}
                        </span>
                      ):(
                        <span style={{background:"#f1f5f9",color:"#94a3b8",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>לא מחובר לאתר</span>
                      )}
                    </div>
                    {c.scannedAt&&<div style={{fontSize:10,color:"#cbd5e1",marginTop:8,fontFamily:"Heebo,sans-serif"}}>סרוק: {formatDate(c.scannedAt)}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // single client card
  if(!client)return null;
  const articles=client.articles||[];
  const ai=client.audit;

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* card header */}
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"14px 24px",display:"flex",alignItems:"center",gap:14,flexShrink:0}}>
        <button onClick={()=>setOpenId(null)} style={{background:"#f1f5f9",border:"none",borderRadius:7,padding:"6px 13px",fontSize:12,fontWeight:700,cursor:"pointer",color:ACCENT,fontFamily:"Heebo,sans-serif"}}>← חזור</button>
        <div>
          <div style={{fontSize:17,fontWeight:800,color:ACCENT,fontFamily:"Heebo,sans-serif"}}>{client.name}</div>
          <div style={{fontSize:11,color:"#94a3b8",direction:"ltr"}}>{client.domain}{client.location?" · "+client.location:""}</div>
        </div>
        {getPublishTarget(client)?(
          <span style={{background:(client.publishConnection?.ok?GREEN:AMBER)+"14",color:client.publishConnection?.ok?GREEN:AMBER,borderRadius:20,padding:"4px 10px",fontSize:11,fontWeight:700}}>
            {client.publishConnection?.ok?"🔗 מחובר לאתר":"⚙ חיבור מוגדר"}
          </span>
        ):(
          <span style={{background:"#f1f5f9",color:"#94a3b8",borderRadius:20,padding:"4px 10px",fontSize:11,fontWeight:600}}>לא מחובר לאתר</span>
        )}
        {ai&&<div style={{marginRight:"auto",display:"flex",alignItems:"center",gap:10}}>
          <ScoreBadge score={ai.overallScore}/>
        </div>}
      </div>

      {/* inner tabs */}
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"0 24px",display:"flex",gap:2,flexShrink:0}}>
        {[["articles","📝 מאמרים"],["style","✍ סגנון כתיבה"],["keywords","🔑 מילות מפתח"],["audit","🛡 אודיט"],["settings","⚙ הגדרות"]].map(([k,l])=>(
          <button key={k} onClick={()=>setCardTab(k)} style={{padding:"10px 16px",border:"none",borderBottom:cardTab===k?`2px solid ${BLUE}`:"2px solid transparent",background:"transparent",fontSize:13,fontWeight:cardTab===k?700:400,color:cardTab===k?BLUE:"#64748b",cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>{l}</button>
        ))}
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"20px 24px",background:"#f8fafc"}}>

        {/* ── ARTICLES TAB ── */}
        {cardTab==="articles"&&(
          <div style={{maxWidth:800}}>
            {/* custom article form */}
            <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"16px 20px",marginBottom:18}}>
              <div style={{fontSize:12,fontWeight:700,color:"#94a3b8",letterSpacing:1.5,marginBottom:10,textTransform:"uppercase"}}>הוסף מאמר מותאם אישית</div>
              <Field name="dir" value={customDir} onChange={e=>setCustomDir(e.target.value)}
                placeholder="לדוגמה: רוצה מאמר על יתרונות מצלמות IP לעסקים קטנים באזור הצפון..."
                multiline rows={2}/>
              <button onClick={addCustomArticle} disabled={addingCustom||!customDir.trim()}
                style={{background:addingCustom?"#94a3b8":ACCENT,color:"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:addingCustom?"not-allowed":"pointer",fontFamily:"Heebo,sans-serif"}}>
                {addingCustom?<span style={{display:"flex",alignItems:"center",gap:6}}><Spin color="#fff" size={13}/>יוצר...</span>:"+ צור תקציר"}
              </button>
            </div>

            {/* articles list */}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {articles.length===0&&<div style={{textAlign:"center",padding:30,color:"#94a3b8",fontSize:13,fontFamily:"Heebo,sans-serif"}}>אין מאמרים עדיין</div>}
              {articles.map(a=>(
                <div key={a.id} style={{background:"#fff",borderRadius:10,border:"1px solid #e2e8f0",padding:"14px 18px"}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:700,color:ACCENT,fontFamily:"Heebo,sans-serif",marginBottom:4}}>{a.title}</div>
                      <div style={{fontSize:11,color:"#64748b",marginBottom:6}}>{a.keywords}</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                        <StatusBadge status={a.status}/>
                        {a.source==="custom"&&<span style={{background:"#fdf4ff",color:PURPLE,border:`1px solid ${PURPLE}35`,borderRadius:20,padding:"2px 9px",fontSize:10,fontWeight:700}}>מותאם</span>}
                        {a.draftContent&&<span style={{background:GREEN+"14",color:GREEN,border:`1px solid ${GREEN}35`,borderRadius:20,padding:"2px 9px",fontSize:10,fontWeight:700}}>יש טיוטה</span>}
                        {a.scheduledDate&&<span style={{fontSize:12,color:PURPLE,fontWeight:600}}>📅 {formatDate(a.scheduledDate)}</span>}
                        {a.publishedAt&&<span style={{fontSize:12,color:GREEN,fontWeight:600}}>✓ פורסם {formatDate(a.publishedAt)}</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0,alignItems:"center",flexWrap:"wrap"}}>
                      {a.status!=="published"&&hasFullArticle(a)&&(
                        <input type="datetime-local" value={toDatetimeLocal(a.scheduledDate)} onChange={e=>scheduleArticle(a.id,e.target.value)}
                          style={{padding:"5px 9px",border:"1.5px solid #e2e8f0",borderRadius:7,fontSize:12,color:ACCENT,outline:"none",direction:"ltr"}} title="תזמון ללוח פרסום"/>
                      )}
                      {a.status!=="published"&&!hasFullArticle(a)&&(
                        <span style={{fontSize:11,color:"#94a3b8",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:7,padding:"5px 9px"}}>תזמון אחרי מאמר מלא</span>
                      )}
                      {(a.draftContent||a.publishedContent)&&(
                        <button onClick={()=>setPreviewArticle(a)}
                          style={{background:"#f1f5f9",color:ACCENT,border:"1px solid #e2e8f0",borderRadius:7,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>
                          📄 צפה
                        </button>
                      )}
                      {(a.versions||[]).length>0&&a.status==="published"&&(
                        <button onClick={()=>setVersionsModal({article:a})}
                          style={{background:"#f1f5f9",color:"#64748b",border:"1px solid #e2e8f0",borderRadius:7,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>
                          🕐 היסטוריה ({a.versions.length})
                        </button>
                      )}
                      <button onClick={()=>onWriteArticle(client.id,a.id)}
                        style={{background:BLUE,color:"#fff",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>
                        {a.draftContent||a.publishedContent?"✏ ערוך מאמר":"✦ כתוב מאמר מלא"}
                      </button>
                      <button onClick={()=>deleteArticle(a.id)}
                        style={{background:"#fef2f2",color:RED,border:"1px solid #fecaca",borderRadius:7,padding:"7px 10px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                        🗑
                      </button>
                    </div>
                  </div>
                  {a.reason&&!a.brief&&(
                    <div style={{marginTop:8,fontSize:12,color:"#64748b",lineHeight:1.6,fontFamily:"Heebo,sans-serif"}}>{a.reason}</div>
                  )}
                  {a.brief&&(
                    <div style={{marginTop:10,background:"#f8fafc",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#64748b",fontFamily:"Heebo,sans-serif"}}>
                      <div style={{fontWeight:700,color:ACCENT,marginBottom:4}}>{a.brief.angle||a.brief.briefTitle}</div>
                      {(a.brief.outline||[]).map((p,i)=><div key={i}>• {p}</div>)}
                    </div>
                  )}
                  {a.status!=="published"&&(
                    <div style={{marginTop:10}}>
                      <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",letterSpacing:1,marginBottom:5,textTransform:"uppercase"}}>הערות / תיקונים</div>
                      <textarea value={a.notes||""} onChange={e=>saveArticleNotes(a.id,e.target.value)}
                        placeholder="לדוגמה: שנה 2025 ל-2026, הדגש דגם 1000, אל תזכיר מתחרים..."
                        rows={2} style={{width:"100%",padding:"8px 11px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:12,fontFamily:"Heebo,sans-serif",resize:"vertical",outline:"none",boxSizing:"border-box",direction:"rtl",background:a.notes?"#fffbeb":"#fff"}}/>
                      {a.notes?.trim()&&(
                        <button onClick={()=>regenerateBriefFromNotes(a)} disabled={genBriefId===a.id}
                          style={{marginTop:6,background:genBriefId===a.id?"#94a3b8":AMBER,color:"#fff",border:"none",borderRadius:7,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:genBriefId===a.id?"not-allowed":"pointer",fontFamily:"Heebo,sans-serif"}}>
                          {genBriefId===a.id?<span style={{display:"flex",alignItems:"center",gap:5}}><Spin color="#fff" size={11}/>מעדכן...</span>:"↻ עדכן תקציר לפי הערות"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STYLE GUIDE TAB ── */}
        {cardTab==="style"&&(
          <div style={{maxWidth:700}}>
            <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"18px 22px",marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",letterSpacing:1.5,marginBottom:12,textTransform:"uppercase"}}>סגנון כתיבה ללקוח</div>
              <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#1e40af",lineHeight:1.7}}>
                ההנחיות והדוגמאות כאן יוזרקו לכל כתיבת מאמרים — כדי לשמור על קו האתר הקיים.
              </div>
              <Field label="שפה" name="lang" value={styleGuide.language||"he"} onChange={e=>setStyleGuide(s=>({...s,language:e.target.value}))} as="select"
                options={[{value:"he",label:"עברית"},{value:"en",label:"English"},{value:"he-en",label:"עברית + מונחים באנגלית"}]}/>
              <Field label="טון כתיבה" name="toneN" value={styleGuide.toneNotes||""} onChange={e=>setStyleGuide(s=>({...s,toneNotes:e.target.value}))} multiline rows={2} placeholder="ידידותי אבל מקצועי, בלי סלנג..."/>
              <Field label="קהל יעד" name="audN" value={styleGuide.audienceNotes||""} onChange={e=>setStyleGuide(s=>({...s,audienceNotes:e.target.value}))} multiline rows={2} placeholder="בעלי מוסכים / חובבי שטח..."/>
              <Field label="כללי כתיבה" name="wr" value={styleGuide.writingRules||""} onChange={e=>setStyleGuide(s=>({...s,writingRules:e.target.value}))} multiline rows={3} placeholder="תמיד להזכיר אחריות יבואן, לא להשוות למתחרים..."/>
              <Field label="מה לא לעשות" name="dn" value={styleGuide.doNot||""} onChange={e=>setStyleGuide(s=>({...s,doNot:e.target.value}))} multiline rows={2} placeholder="אל תשתמש במילה זול, אל תבטיח הנחות..."/>
              <div style={{fontSize:12,fontWeight:700,color:"#64748b",margin:"14px 0 8px"}}>דוגמאות מאמרים מהאתר</div>
              {(styleGuide.sampleArticles||[]).map((s,i)=>(
                <div key={i} style={{border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 14px",marginBottom:10}}>
                  <Field label="כותרת" name={"st"+i} value={s.title||""} onChange={e=>{const arr=[...(styleGuide.sampleArticles||[])];arr[i]={...arr[i],title:e.target.value};setStyleGuide(g=>({...g,sampleArticles:arr}));}}/>
                  <Field label="URL (אופציונלי)" name={"su"+i} value={s.url||""} onChange={e=>{const arr=[...(styleGuide.sampleArticles||[])];arr[i]={...arr[i],url:e.target.value};setStyleGuide(g=>({...g,sampleArticles:arr}));}} ltr/>
                  <Field label="קטע לדוגמה" name={"se"+i} value={s.excerpt||""} onChange={e=>{const arr=[...(styleGuide.sampleArticles||[])];arr[i]={...arr[i],excerpt:e.target.value};setStyleGuide(g=>({...g,sampleArticles:arr}));}} multiline rows={4} placeholder="הדבק 200–800 מילים ממאמר קיים..."/>
                  <button onClick={()=>setStyleGuide(g=>({...g,sampleArticles:(g.sampleArticles||[]).filter((_,j)=>j!==i)}))}
                    style={{background:"#fef2f2",color:RED,border:"1px solid #fecaca",borderRadius:7,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>מחק דוגמה</button>
                </div>
              ))}
              {(styleGuide.sampleArticles||[]).length<5&&(
                <button onClick={()=>setStyleGuide(g=>({...g,sampleArticles:[...(g.sampleArticles||[]),{title:"",excerpt:"",url:""}]}))}
                  style={{background:"#f1f5f9",color:ACCENT,border:"1.5px solid #e2e8f0",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer",marginBottom:12}}>+ הוסף דוגמה</button>
              )}
              <button onClick={saveStyleGuide} style={{background:BLUE,color:"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:"pointer"}}>שמור סגנון</button>
            </div>
          </div>
        )}

        {/* ── KEYWORDS TAB ── */}
        {cardTab==="keywords"&&(
          <div style={{maxWidth:700}}>
            <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"18px 22px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",letterSpacing:1.5,textTransform:"uppercase"}}>
                  מחקר מילות מפתח{client.location?" — "+client.location:""}
                </div>
                {focusedKeywords.length>0&&(
                  <button onClick={saveFocusedKeywords} style={{background:BLUE,color:"#fff",border:"none",borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>
                    שמור בחירה ({focusedKeywords.length})
                  </button>
                )}
              </div>
              {focusedKeywords.length>0&&(
                <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#1e40af",fontFamily:"Heebo,sans-serif"}}>
                  ✦ {focusedKeywords.length} מילות מפתח נבחרו — ישולבו אוטומטית בכתיבת מאמרים
                </div>
              )}
              {(client.keywordResearch||[]).length===0?(
                <div style={{color:"#94a3b8",fontSize:13}}>אין נתונים — בצע סריקה מחדש</div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {[...(client.keywordResearch||[])].sort((a,b)=>(b.priority||0)-(a.priority||0)).map((k,i)=>{
                    const cc={low:GREEN,medium:AMBER,high:RED}[k.competition]||BLUE;
                    const ic={local:"📍",informational:"ℹ",commercial:"🛒"}[k.intent]||"•";
                    const pr=k.priority||0;
                    const prColor=pr>=8?GREEN:pr>=5?AMBER:"#94a3b8";
                    const isFocused=focusedKeywords.includes(k.keyword);
                    return(
                      <div key={i} onClick={()=>toggleKeyword(k.keyword)}
                        style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",borderRadius:9,cursor:"pointer",border:`1.5px solid ${isFocused?BLUE:"transparent"}`,background:isFocused?BLUE+"08":"transparent",transition:"all .15s"}}>
                        <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${isFocused?BLUE:"#d1d5db"}`,background:isFocused?BLUE:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                          {isFocused&&<span style={{color:"#fff",fontSize:11,fontWeight:800}}>✓</span>}
                        </div>
                        <span style={{fontSize:14,marginTop:1}}>{ic}</span>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                            <span style={{fontSize:13,fontWeight:700,color:ACCENT,fontFamily:"Heebo,sans-serif"}}>{k.keyword}</span>
                            {k.recommended&&<span style={{background:"#fefce8",color:"#92400e",border:"1px solid #fde68a",borderRadius:10,padding:"1px 8px",fontSize:10,fontWeight:700}}>⭐ מומלץ</span>}
                          </div>
                          {(k.localVariants||[]).length>0&&(
                            <div style={{marginTop:4,display:"flex",gap:5,flexWrap:"wrap"}}>
                              {k.localVariants.map((v,j)=><span key={j} style={{background:"#f1f5f9",borderRadius:20,padding:"1px 9px",fontSize:11,color:"#64748b"}}>{v}</span>)}
                            </div>
                          )}
                        </div>
                        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,flexShrink:0}}>
                          <span style={{background:cc+"18",color:cc,border:`1px solid ${cc}35`,borderRadius:20,padding:"2px 9px",fontSize:10,fontWeight:700,whiteSpace:"nowrap"}}>
                            {{low:"נמוך",medium:"בינוני",high:"גבוה"}[k.competition]||k.competition}
                          </span>
                          {pr>0&&<span style={{background:prColor+"15",color:prColor,borderRadius:6,padding:"1px 7px",fontSize:10,fontWeight:800}}>{pr}/10</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"16px 20px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",letterSpacing:1.5,marginBottom:10,textTransform:"uppercase"}}>מילות מפתח ראשיות</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {(client.mainKeywords||[]).map(k=><span key={k} style={{background:BLUE+"14",color:BLUE,border:`1px solid ${BLUE}35`,borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:600}}>{k}</span>)}
              </div>
            </div>
          </div>
        )}

        {/* ── AUDIT TAB ── */}
        {cardTab==="audit"&&(
          <div style={{maxWidth:700}}>
            <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"16px 20px",marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",letterSpacing:1.5,marginBottom:10,textTransform:"uppercase"}}>מיקוד לטיפים</div>
              <Field label="על מה להתמקד" name="tn" value={seoFocus.tipNotes||""} onChange={e=>setSeoFocus(f=>({...f,tipNotes:e.target.value}))} multiline rows={2} placeholder="תתמקד במהירות מובייל וב-Core Web Vitals, פחות ב-schema"/>
              <Field label="עדיפויות" name="pr" value={seoFocus.priorities||""} onChange={e=>setSeoFocus(f=>({...f,priorities:e.target.value}))} multiline rows={2} placeholder="עדיפות: meta titles, internal links, local SEO"/>
              <Field label="מה לא להציע" name="av" value={seoFocus.avoidTips||""} onChange={e=>setSeoFocus(f=>({...f,avoidTips:e.target.value}))} multiline rows={2} placeholder="אל תציע שינוי עיצוב / צבעים / מבנה ניווט"/>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={saveSeoFocus} style={{background:BLUE,color:"#fff",border:"none",borderRadius:8,padding:"9px 16px",fontSize:12,fontWeight:700,cursor:"pointer"}}>שמור מיקוד</button>
                <button onClick={regenerateFocusedTips} disabled={regenTipsLoading||!ai}
                  style={{background:regenTipsLoading||!ai?"#94a3b8":AMBER,color:"#fff",border:"none",borderRadius:8,padding:"9px 16px",fontSize:12,fontWeight:700,cursor:regenTipsLoading||!ai?"not-allowed":"pointer"}}>
                  {regenTipsLoading?<span style={{display:"flex",alignItems:"center",gap:6}}><Spin color="#fff" size={12}/>מייצר...</span>:"↻ צור טיפים ממוקדים מחדש"}
                </button>
              </div>
            </div>
            {!ai?(
              <div style={{textAlign:"center",padding:40,color:"#94a3b8",fontSize:13,fontFamily:"Heebo,sans-serif"}}>אין נתוני אודיט — בצע סריקה</div>
            ):(
              <>
                <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"16px 20px",marginBottom:14}}>
                  <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
                    <ScoreBadge score={ai.overallScore}/>
                    <div style={{background:ai.overallScore>=80?GREEN:ai.overallScore>=50?AMBER:RED,color:"#fff",width:44,height:44,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:800}}>{ai.grade}</div>
                    <div style={{flex:1,fontSize:13,color:"#334155",lineHeight:1.6,fontFamily:"Heebo,sans-serif"}}>{ai.summary}</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                    <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:9,padding:"12px 14px"}}>
                      <div style={{fontSize:10,fontWeight:700,color:RED,letterSpacing:1.5,marginBottom:8,textTransform:"uppercase"}}>בעיות דחופות</div>
                      {(ai.topIssues||[]).map((t,i)=><div key={i} style={{fontSize:12,color:"#991b1b",padding:"3px 0",lineHeight:1.5}}>• {t}</div>)}
                    </div>
                    <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:9,padding:"12px 14px"}}>
                      <div style={{fontSize:10,fontWeight:700,color:GREEN,letterSpacing:1.5,marginBottom:8,textTransform:"uppercase"}}>פעולות מהירות</div>
                      {(ai.quickWins||[]).map((t,i)=><div key={i} style={{fontSize:12,color:"#166534",padding:"3px 0",lineHeight:1.5}}>→ {t}</div>)}
                    </div>
                  </div>
                  {(ai.focusedTips||[]).length>0&&(
                    <div style={{marginTop:12,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:9,padding:"12px 14px"}}>
                      <div style={{fontSize:10,fontWeight:700,color:BLUE,letterSpacing:1.5,marginBottom:8,textTransform:"uppercase"}}>טיפים ממוקדים</div>
                      {(ai.focusedTips||[]).map((t,i)=><div key={i} style={{fontSize:12,color:"#1e40af",padding:"3px 0",lineHeight:1.5}}>✦ {t}</div>)}
                    </div>
                  )}
                </div>
                {(ai.checks||[]).map((cat,ci)=>(
                  <div key={ci} style={{background:"#fff",borderRadius:10,border:"1px solid #e2e8f0",padding:"14px 18px",marginBottom:10}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",letterSpacing:1.5,marginBottom:10,textTransform:"uppercase"}}>{cat.category}</div>
                    {(cat.items||[]).map((item,ii)=><AuditRow key={ii} label={item.label} value={item.value} status={item.status} detail={item.detail} onFix={item.status!=="good"&&item.status!=="fixed"?()=>generateFix(item):null}/>)}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {cardTab==="settings"&&(
          <div style={{maxWidth:620}}>
            <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"20px 22px",marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",letterSpacing:1.5,marginBottom:14,textTransform:"uppercase"}}>חיבור לאתר (Cloudflare Worker)</div>
              <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:9,padding:"12px 14px",marginBottom:14,fontSize:12,color:"#1e40af",lineHeight:1.8}}>
                <div style={{fontWeight:700,marginBottom:6}}>חיבור ייחודי ללקוח הזה בלבד</div>
                המאמרים של <strong>{client.name}</strong> יפורסמו רק ל־Worker שמוגדר כאן.
                לכל לקוח חייבים Worker נפרד + Auth Token נפרד — אחרת עלול להיות ערבוב בין אתרים.
              </div>
              <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:9,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#92400e",lineHeight:1.8}}>
                <div style={{fontWeight:700,marginBottom:4}}>הקמה באתר הלקוח (בהמשך):</div>
                1. פורסים את <strong>cloudflare-worker-template.js</strong> בחשבון Cloudflare של הלקוח<br/>
                2. יוצרים KV בשם <strong>SEO_ARTICLES</strong> וקושרים ל־Worker<br/>
                3. מגדירים <strong>AUTH_TOKEN</strong> ייחודי ללקוח הזה<br/>
                4. מדביקים כאן את Worker URL + אותו Token, שומרים, ולוחצים "בדיקת חיבור"
              </div>
              <Field label="Worker URL" name="wu" value={workerUrl} onChange={e=>{setWorkerUrl(e.target.value);setConnOk(null);setConnMsg("");}} placeholder="https://seo-api-client.xxx.workers.dev" ltr/>
              <Field label="Auth Token" name="tok" value={token} onChange={e=>{setToken(e.target.value);setConnOk(null);setConnMsg("");}} placeholder="סיסמה סודית ייחודית ללקוח" ltr/>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
                <button onClick={saveSettings} style={{background:BLUE,color:"#fff",border:"none",borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>שמור חיבור</button>
                <button onClick={testConnection} disabled={connTesting||!workerUrl.trim()||!token.trim()} style={{background:connTesting||!workerUrl.trim()||!token.trim()?"#94a3b8":GREEN,color:"#fff",border:"none",borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:700,cursor:connTesting||!workerUrl.trim()||!token.trim()?"not-allowed":"pointer",fontFamily:"Heebo,sans-serif"}}>
                  {connTesting?<span style={{display:"flex",alignItems:"center",gap:6}}><Spin color="#fff" size={12}/>בודק...</span>:"🔌 בדיקת חיבור"}
                </button>
                {settingsSaved&&<span style={{fontSize:12,color:GREEN,fontWeight:600}}>✓ נשמר</span>}
              </div>
              {(connMsg||client.publishConnection)&&(
                <div style={{
                  background:connOk===false||(connOk===null&&client.publishConnection?.ok===false)?"#fef2f2":"#f0fdf4",
                  border:"1px solid "+(connOk===false||(connOk===null&&client.publishConnection?.ok===false)?"#fecaca":"#bbf7d0"),
                  borderRadius:8,padding:"10px 12px",fontSize:12,lineHeight:1.7,
                  color:connOk===false||(connOk===null&&client.publishConnection?.ok===false)?RED:GREEN,
                }}>
                  {connMsg
                    ?(connOk===false?"✗ ":"✓ ")+connMsg
                    :(client.publishConnection?.ok
                      ?"✓ חיבור אחרון תקין"+ (client.publishConnection.domain?" · "+client.publishConnection.domain:"")+(client.publishConnection.checkedAt?" · "+formatDateTime(client.publishConnection.checkedAt):"")
                      :"✗ בדיקה אחרונה נכשלה"+(client.publishConnection?.error?": "+client.publishConnection.error:""))}
                </div>
              )}
              <div style={{marginTop:14,fontSize:11,color:"#94a3b8",lineHeight:1.7}}>
                לפני כל פרסום הסוכן יציג אישור עם שם הלקוח, הדומיין וכתובת ה־Worker — כדי למנוע פרסום בטעות לאתר אחר.
              </div>
            </div>
            <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"16px 20px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",letterSpacing:1.5,marginBottom:10,textTransform:"uppercase"}}>פרטי עסק</div>
              {[["תחום",client.industry],["מיקום",client.location],["קהל יעד",client.targetAudience],["סרוק",new Date(client.scannedAt).toLocaleDateString("he-IL")]].map(([l,v])=>v?(
                <div key={l} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:13}}>
                  <span style={{color:"#94a3b8",minWidth:70,fontFamily:"Heebo,sans-serif"}}>{l}</span>
                  <span style={{color:ACCENT,fontFamily:"Heebo,sans-serif"}}>{v}</span>
                </div>
              ):null)}
            </div>
          </div>
        )}
      </div>
    {/* ── FIX MODAL ── */}
    {fixModal&&(
      <div style={{position:"fixed",inset:0,background:"#0f172a90",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div style={{background:"#fff",borderRadius:16,padding:"28px 30px",maxWidth:560,width:"100%",maxHeight:"80vh",overflowY:"auto",direction:"rtl",fontFamily:"Heebo,sans-serif"}}>
          {fixModal.loading?(
            <div style={{display:"flex",alignItems:"center",gap:14,padding:"20px 0"}}><Spin size={28}/><span style={{fontSize:14,color:"#64748b"}}>מייצר תיקון...</span></div>
          ):fixModal.fix&&(
            <>
              <div style={{fontSize:17,fontWeight:800,color:ACCENT,marginBottom:12}}>🔧 {fixModal.fix.fixTitle}</div>
              {fixModal.fix.estimatedImpact&&(
                <div style={{display:"inline-block",background:{low:AMBER+"15",medium:BLUE+"15",high:GREEN+"15"}[fixModal.fix.estimatedImpact]||"#f1f5f9",color:{low:AMBER,medium:BLUE,high:GREEN}[fixModal.fix.estimatedImpact]||"#64748b",borderRadius:8,padding:"4px 13px",fontSize:12,fontWeight:700,marginBottom:14}}>
                  השפעה: {{low:"נמוכה",medium:"בינונית",high:"גבוהה"}[fixModal.fix.estimatedImpact]||fixModal.fix.estimatedImpact}
                </div>
              )}
              <p style={{fontSize:13,color:"#334155",lineHeight:1.8,marginBottom:16}}>{fixModal.fix.instructions}</p>
              {fixModal.fix.codeSnippet&&(
                <div style={{position:"relative",marginBottom:18}}>
                  <pre style={{background:"#0f172a",color:"#e2e8f0",borderRadius:10,padding:"16px 18px",fontSize:12,direction:"ltr",textAlign:"left",overflow:"auto",margin:0,whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{fixModal.fix.codeSnippet}</pre>
                  <button onClick={()=>navigator.clipboard.writeText(fixModal.fix.codeSnippet)}
                    style={{position:"absolute",top:8,left:8,background:"#334155",color:"#e2e8f0",border:"none",borderRadius:6,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>📋 העתק</button>
                </div>
              )}
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>markFixed(fixModal.item)} style={{background:GREEN,color:"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>✓ יישמתי את התיקון</button>
                <button onClick={()=>setFixModal(null)} style={{background:"#f1f5f9",color:"#64748b",border:"1.5px solid #e2e8f0",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>✕ סגור</button>
              </div>
            </>
          )}
        </div>
      </div>
    )}

    {/* ── VERSIONS MODAL ── */}
    {versionsModal&&(
      <div style={{position:"fixed",inset:0,background:"#0f172a90",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div style={{background:"#fff",borderRadius:16,padding:"26px 28px",maxWidth:600,width:"100%",maxHeight:"80vh",overflowY:"auto",direction:"rtl",fontFamily:"Heebo,sans-serif"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:16,fontWeight:800,color:ACCENT}}>🕐 היסטוריית גרסאות</div>
            <button onClick={()=>setVersionsModal(null)} style={{background:"#f1f5f9",border:"none",borderRadius:7,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",color:"#64748b"}}>✕ סגור</button>
          </div>
          <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:9,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#166534"}}>
            גרסה נוכחית: {versionsModal.article.publishedContent?.title||versionsModal.article.title} · פורסם {formatDate(versionsModal.article.publishedAt)}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[...(versionsModal.article.versions||[])].sort((a,b)=>b.version-a.version).map(v=>(
              <div key={v.version} style={{border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:ACCENT}}>{v.title}</div>
                    <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>פורסם {formatDate(v.publishedAt)}</div>
                  </div>
                  <button onClick={()=>revertVersion(versionsModal.article,v)} disabled={reverting}
                    style={{background:reverting?"#94a3b8":AMBER,color:"#fff",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:reverting?"not-allowed":"pointer",flexShrink:0}}>
                    ↩ שחזר גרסה זו
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

    {/* ── ARTICLE PREVIEW MODAL ── */}
    {previewArticle&&(
      <div style={{position:"fixed",inset:0,background:"#0f172a90",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div style={{background:"#fff",borderRadius:16,padding:"26px 28px",maxWidth:720,width:"100%",maxHeight:"85vh",overflowY:"auto",direction:"rtl",fontFamily:"Heebo,sans-serif"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:16}}>
            <div>
              <div style={{fontSize:18,fontWeight:800,color:ACCENT,marginBottom:4}}>{previewArticle.draftContent?.title||previewArticle.publishedContent?.title||previewArticle.title}</div>
              <div style={{fontSize:11,color:"#94a3b8",direction:"ltr"}}>/{previewArticle.draftContent?.slug||previewArticle.slug||""}</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{onWriteArticle(client.id,previewArticle.id);setPreviewArticle(null);}}
                style={{background:BLUE,color:"#fff",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>✏ ערוך</button>
              <button onClick={()=>setPreviewArticle(null)} style={{background:"#f1f5f9",border:"none",borderRadius:7,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",color:"#64748b"}}>✕</button>
            </div>
          </div>
          {(previewArticle.draftContent?.metaDescription||previewArticle.publishedContent?.metaDescription)&&(
            <div style={{background:"#f8fafc",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#64748b"}}>
              {previewArticle.draftContent?.metaDescription||previewArticle.publishedContent?.metaDescription}
            </div>
          )}
          <ArticleView text={articleBody(previewArticle)}/>
        </div>
      </div>
    )}
    </div>
  );
}

// ── CONTENT WRITER ────────────────────────────────────────────────────────────
function ContentWriter({clientId,articleId,onBack,activeClientId,onSaved}){
  const resolvedClientId=clientId||activeClientId||null;
  const client  = resolvedClientId ? DB.getById(resolvedClientId) : null;
  const article = (client?.articles||[]).find(a=>a.id===articleId)||null;

  const [form,setForm]=useState({
    domain:client?.domain||"", clientName:client?.name||"",
    industry:client?.industry||"", topic:article?.title||"",
    keywords:article?.keywords||"", articleType:article?.type||"informational",
    tone:"professional", wordCount:"800",
    keywords2:(client?.mainKeywords||[]).join(", "),
  });
  const set=e=>setForm(f=>({...f,[e.target.name]:e.target.value}));

  const [boundArticleId,setBoundArticleId]=useState(articleId||null);
  const [brief,setBrief]=useState(article?.brief||null);
  const [briefLoading,setBriefLoading]=useState(false);
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(article?.draftContent||null);
  const [error,setError]=useState(null);
  const [tab,setTab]=useState("article");
  const [publishing,setPublishing]=useState(false);
  const [published,setPublished]=useState(article?.status==="published");
  const [schedDate,setSchedDate]=useState(toDatetimeLocal(article?.scheduledDate||""));
  const [articleInstructions,setArticleInstructions]=useState(article?.notes||"");
  const [showInstructions,setShowInstructions]=useState(!!article?.notes?.trim());
  const [revisionNotes,setRevisionNotes]=useState(article?.revisionNotes||{content:"",keywords:"",structure:""});
  const [revising,setRevising]=useState(false);
  const [saveMsg,setSaveMsg]=useState("");

  const effectiveClientId=resolvedClientId||clientId;

  const persistArticle=(parsed,extra={})=>{
    if(!effectiveClientId){
      throw new Error("בחר לקוח בראש המסך לפני שמירה");
    }
    const payload={
      draftContent:parsed,
      title:parsed.title||form.topic,
      keywords:Array.isArray(parsed.keywords)?parsed.keywords.join(", "):(form.keywords||""),
      slug:parsed.slug||"",
      type:form.articleType||"informational",
      notes:articleInstructions.trim()||"",
      scheduledDate:extra.scheduledDate!==undefined?extra.scheduledDate:(schedDate||null),
      status:extra.status||((extra.scheduledDate??schedDate)?"scheduled":"draft"),
      ...extra,
    };
    let id=boundArticleId||articleId;
    if(id){
      DB.updateArticle(effectiveClientId,id,payload);
    }else{
      id=uid();
      DB.addArticle(effectiveClientId,{
        id,
        reason:"נכתב במסך כתיבה",
        priority:"high",
        source:"write",
        brief:brief||null,
        publishedAt:null,
        ...payload,
      });
      setBoundArticleId(id);
    }
    if(typeof onSaved==="function")onSaved(id);
    return id;
  };

  const generateBrief=async()=>{
    if(!form.topic||!form.keywords){setError("נא למלא נושא ומילות מפתח");return;}
    if(!effectiveClientId){setError("בחר לקוח בראש המסך לפני יצירת תקציר");return;}
    setBriefLoading(true);setError(null);setBrief(null);setResult(null);setSaveMsg("");
    try{
      const feedback=articleInstructions.trim()||article?.notes?.trim()||"";
      const prompt=
        "Create an SEO article brief.\n\n"+
        "Topic: "+form.topic+"\nKeywords: "+form.keywords+
        "\nIndustry: "+(form.industry||"?")+"\nLocation: "+(client?.location||"")+
        "\nArticle type: "+form.articleType+"\n"+
        notesBlock(feedback)+
        ((client?.focusedKeywords||[]).length>0?"\nFocused keywords to integrate: "+(client.focusedKeywords).join(", ")+"\n":"")+
        styleGuideBlock(client)+
        "\n"+
        'Return ONLY valid JSON: {"briefTitle":"...","angle":"...","outline":["...","...","..."],"primaryKeyword":"...","whyThisArticle":"..."}\n'+
        "Keep outline to 3 short items. Write in the client's language. NEVER use double-quote inside string values.";
      const txt=await callClaude(prompt,1500);
      const b=parseJSON(txt);
      setBrief(b);
      let id=boundArticleId||articleId;
      if(id){
        DB.updateArticle(effectiveClientId,id,{brief:b,status:"briefed",notes:feedback,title:form.topic,keywords:form.keywords,type:form.articleType});
      }else{
        id=uid();
        DB.addArticle(effectiveClientId,{
          id, title:form.topic, keywords:form.keywords, type:form.articleType||"informational",
          reason:"נכתב במסך כתיבה", priority:"high", status:"briefed", source:"write",
          brief:b, notes:feedback, draftContent:null, scheduledDate:null, publishedAt:null, slug:"",
        });
        setBoundArticleId(id);
      }
    }catch(e){setError("שגיאה: "+e.message);}
    setBriefLoading(false);
  };

  const generate=async()=>{
    if(!effectiveClientId){setError("בחר לקוח בראש המסך לפני יצירת מאמר");return;}
    setLoading(true);setError(null);setResult(null);setSaveMsg("");
    try{
      const tL=ARTICLE_TYPES.find(t=>t.value===form.articleType)?.label||"";
      const nL=TONES.find(t=>t.value===form.tone)?.label||"";
      const prompt=
        "Write a full SEO blog article.\n"+
        "Client: "+(form.clientName||"?")+" | Domain: "+(form.domain||"?")+" | Industry: "+(form.industry||"?")+" | Location: "+(client?.location||"")+"\n"+
        "Topic: "+form.topic+"\nKeywords: "+form.keywords+"\n"+
        (brief?"Preferred title: "+brief.briefTitle+"\nAngle: "+brief.angle+"\nOutline: "+(brief.outline||[]).join(" | ")+"\n":"")+
        "Type: "+tL+" | Tone: "+nL+" | Length: ~"+form.wordCount+" words\n"+
        ((client?.focusedKeywords||[]).length>0?"\nFocused keywords to prioritize: "+(client.focusedKeywords).join(", ")+"\n":"")+
        notesBlock(articleInstructions.trim()||article?.notes||"")+
        styleGuideBlock(client)+
        "\nCurrent year is 2026. Use 2026 in titles and content unless explicitly told otherwise.\n"+
        "\nOUTPUT FORMAT — follow EXACTLY (do not wrap in markdown):\n"+
        "<<<META>>>\n"+
        '{"title":"...","metaTitle":"...","metaDescription":"...","slug":"english-kebab-case","readTime":"X דקות","keywords":["k1","k2"],"lsiKeywords":["l1","l2"],"outline":[{"heading":"...","subheadings":["..."]}],"altTexts":["..."],"internalLinkSuggestions":["..."],"seoScore":85,"seoTips":["..."]}\n'+
        "<<<ARTICLE>>>\n"+
        "Full article body in markdown (## H2, ### H3, paragraphs). Plain text — NOT inside JSON.\n"+
        "<<<END>>>\n"+
        "META JSON must be short and valid. NEVER put the article body inside the META JSON. NEVER use double-quote inside META string values.";
      const txt=await callClaude(prompt,8000);
      const parsed={...parseArticleResponse(txt),generatedAt:new Date().toISOString()};
      setResult(parsed);setTab("article");
      persistArticle(parsed,{
        brief:brief||null,
        scheduledDate:schedDate||null,
        status:schedDate?"scheduled":"draft",
        notes:articleInstructions.trim()||"",
      });
      setSaveMsg(schedDate?"נשמר ותוזמן ללוח הפרסום":"נשמר בעמוד המאמרים");
    }catch(e){setError("שגיאה: "+e.message);}
    setLoading(false);
  };

  const regenerateArticle=async()=>{
    if(!result)return;
    const hasNotes=revisionNotes.content?.trim()||revisionNotes.keywords?.trim()||revisionNotes.structure?.trim();
    if(!hasNotes){setError("נא למלא לפחות הערה אחת לשיפור");return;}
    setRevising(true);setError(null);setSaveMsg("");
    try{
      const prompt=
        "Revise this SEO article according to the feedback. Keep the same brand voice.\n"+
        styleGuideBlock(client)+
        (revisionNotes.content?.trim()?"\nContent feedback: "+revisionNotes.content.trim()+"\n":"")+
        (revisionNotes.keywords?.trim()?"\nKeywords feedback: "+revisionNotes.keywords.trim()+"\n":"")+
        (revisionNotes.structure?.trim()?"\nStructure feedback: "+revisionNotes.structure.trim()+"\n":"")+
        "\nCurrent META:\n"+JSON.stringify({title:result.title,metaTitle:result.metaTitle,metaDescription:result.metaDescription,slug:result.slug,keywords:result.keywords,lsiKeywords:result.lsiKeywords,outline:result.outline,seoScore:result.seoScore,seoTips:result.seoTips})+"\n"+
        "\nCurrent ARTICLE:\n"+(result.article||"").slice(0,6000)+"\n"+
        "\nOUTPUT FORMAT — follow EXACTLY:\n<<<META>>>\n"+
        '{"title":"...","metaTitle":"...","metaDescription":"...","slug":"...","readTime":"...","keywords":[],"lsiKeywords":[],"outline":[{"heading":"...","subheadings":[]}],"altTexts":[],"internalLinkSuggestions":[],"seoScore":85,"seoTips":[]}\n'+
        "<<<ARTICLE>>>\nRevised full article body\n<<<END>>>";
      const txt=await callClaude(prompt,8000);
      const parsed={...parseArticleResponse(txt),generatedAt:new Date().toISOString()};
      setResult(parsed);setTab("article");
      persistArticle(parsed,{revisionNotes,status:schedDate?"scheduled":"draft",scheduledDate:schedDate||null});
      setSaveMsg("הגרסה המשופרת נשמרה");
    }catch(e){setError("שגיאה: "+e.message);}
    setRevising(false);
  };

  const saveDraft=()=>{
    if(!result){setError("אין מאמר לשמירה");return;}
    try{
      persistArticle(result,{status:schedDate?"scheduled":"draft",scheduledDate:schedDate||null,revisionNotes});
      setSaveMsg("המאמר נשמר בעמוד המאמרים");
      setError(null);
    }catch(e){setError(e.message);}
  };

  const saveAndSchedule=()=>{
    if(!result){setError("אין מאמר לתזמון");return;}
    if(!schedDate){setError("בחר תאריך ושעה לתזמון");return;}
    try{
      persistArticle(result,{status:"scheduled",scheduledDate:schedDate,revisionNotes});
      setSaveMsg("המאמר נשמר ותוזמן ללוח הפרסום");
      setError(null);
    }catch(e){setError(e.message);}
  };

  const publishArticle=async()=>{
    if(!client){setError("בחר לקוח לפני פרסום");return;}
    if(!getPublishTarget(client)){setError("הגדר Worker URL ו-Auth Token בהגדרות הלקוח, ואז בדקי חיבור");return;}
    if(!result)return;
    if(!confirmPublish(client,result.title||form.topic))return;
    setPublishing(true);setError(null);
    try{
      const id=persistArticle(result,{status:schedDate?"scheduled":"draft",scheduledDate:schedDate||null});
      const now=new Date().toISOString();
      const content={title:result.title,metaTitle:result.metaTitle,metaDescription:result.metaDescription,content:result.article,keywords:result.keywords,slug:result.slug};
      await pushToWorker(client,{...content,publishedAt:now});
      setPublished(true);
      const prev=DB.getById(effectiveClientId)?.articles?.find(a=>a.id===id);
      const prevVersions=prev?.versions||[];
      const nextVersions=prev?.publishedContent
        ? [...prevVersions,{...prev.publishedContent,publishedAt:prev.publishedAt,version:prevVersions.length+1}]
        : prevVersions;
      DB.updateArticle(effectiveClientId,id,{status:"published",publishedAt:now,slug:result.slug,publishedContent:content,draftContent:result,versions:nextVersions});
      setSaveMsg("פורסם לאתר של "+(client.name||"הלקוח"));
      if(typeof onSaved==="function")onSaved(id);
    }catch(e){setError("שגיאת פרסום: "+e.message);}
    setPublishing(false);
  };

  const exportReport=()=>{
    if(!result)return;
    const date=new Date().toLocaleDateString("he-IL");
    const w=window.open("","_blank");
    w.document.write("<!DOCTYPE html><html dir='rtl'><head><meta charset='UTF-8'><title>SEO Report</title><link href='https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&display=swap' rel='stylesheet'><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Heebo,sans-serif;direction:rtl;color:#0a0f1e}.cover{background:#0a0f1e;color:#fff;padding:48px}.cover h1{font-size:22px;font-weight:800;margin-bottom:6px}.cover p{font-size:13px;color:#94a3b8;margin-top:3px}.body{padding:36px 48px;max-width:800px;margin:0 auto}.sec{margin-bottom:26px}.st{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#2563eb;margin-bottom:10px}.box{background:#f8fafc;border-right:4px solid #0a0f1e;padding:13px 17px;border-radius:7px;margin-bottom:9px}.bl{font-size:10px;font-weight:700;color:#64748b;margin-bottom:3px}.bv{font-size:13px;color:#0a0f1e;line-height:1.5}.art h2{font-size:17px;font-weight:700;color:#0a0f1e;margin:20px 0 7px}.art h3{font-size:14px;font-weight:700;color:#1e40af;margin:13px 0 5px}.art p{font-size:13px;line-height:1.9;color:#334155;margin-bottom:6px}.tip{background:#eff6ff;border-right:3px solid #2563eb;padding:9px 13px;border-radius:6px;margin-bottom:7px;font-size:13px;color:#1e40af}.foot{margin-top:36px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;display:flex;justify-content:space-between}@media print{.cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>"+
      "<div class='cover'><h1>"+result.title+"</h1><p>"+(form.clientName?form.clientName+" | ":"")+form.domain+"</p><p>"+date+"</p></div>"+
      "<div class='body'><div class='sec'><div class='st'>Meta</div>"+
      "<div class='box'><div class='bl'>Title</div><div class='bv'>"+result.metaTitle+"</div></div>"+
      "<div class='box'><div class='bl'>Description</div><div class='bv'>"+result.metaDescription+"</div></div>"+
      "<div class='box'><div class='bl'>Slug</div><div class='bv' style='direction:ltr'>/"+result.slug+"</div></div></div>"+
      "<div class='sec'><div class='st'>Article</div><div class='art'>"+
      (result.article||"").split("\n").map(l=>l.startsWith("### ")?"<h3>"+l.slice(4)+"</h3>":l.startsWith("## ")?"<h2>"+l.slice(3)+"</h2>":l.trim()===""?"<br>":"<p>"+l+"</p>").join("")+
      "</div></div><div class='sec'><div class='st'>SEO Tips</div>"+(result.seoTips||[]).map(t=>"<div class='tip'>"+t+"</div>").join("")+
      "</div><div class='foot'><span>SEO Agent</span><span>"+date+"</span></div></div></body></html>");
    w.document.close(); setTimeout(()=>w.print(),500);
  };

  const tabs=[{key:"article",label:"📝 מאמר"},{key:"meta",label:"🏷 מטא"},{key:"keywords",label:"🔑 מילות מפתח"},{key:"outline",label:"📋 מבנה"},{key:"tips",label:"💡 טיפים"}];

  return(
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      {/* sidebar */}
      <div style={{width:300,background:"#fff",borderLeft:"1px solid #e8ecf0",display:"flex",flexDirection:"column",overflowY:"auto",flexShrink:0}}>
        {onBack&&<button onClick={onBack} style={{margin:"12px 14px 0",background:"#f1f5f9",border:"none",borderRadius:7,padding:"7px 13px",fontSize:12,fontWeight:700,cursor:"pointer",color:ACCENT,fontFamily:"Heebo,sans-serif",textAlign:"right"}}>← חזור ללקוח</button>}
        {client&&(
          <div style={{padding:"12px 14px",background:"#f0fdf4",borderBottom:"1px solid #bbf7d0",margin:"10px 14px 0",borderRadius:9}}>
            <div style={{fontSize:13,fontWeight:700,color:GREEN}}>{client.name}</div>
            <div style={{fontSize:11,color:"#166534",marginTop:2}}>{client.industry}{client.location?" · "+client.location:""}</div>
          </div>
        )}
        <div style={{padding:"14px",flex:1}}>
          <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",letterSpacing:1.5,marginBottom:12,textTransform:"uppercase"}}>פרטי המאמר</div>
          <Field label="נושא *" name="topic" value={form.topic} onChange={set} placeholder="כיצד לבחור..."/>
          <Field label="מילות מפתח *" name="keywords" value={form.keywords} onChange={set} placeholder="מילה1, מילה2..."/>
          <Field label="סוג" name="articleType" value={form.articleType} onChange={set} as="select" options={ARTICLE_TYPES}/>
          <Field label="טון" name="tone" value={form.tone} onChange={set} as="select" options={TONES}/>
          <Field label="אורך" name="wordCount" value={form.wordCount} onChange={set} as="select" options={[{value:"500",label:"קצר ~500"},{value:"800",label:"סטנדרטי ~800"},{value:"1200",label:"ארוך ~1200"},{value:"1800",label:"מעמיק ~1800"}]}/>
          {!article&&<><Field label="לקוח" name="clientName" value={form.clientName} onChange={set} placeholder="שם העסק"/><Field label="דומיין" name="domain" value={form.domain} onChange={set} placeholder="example.co.il"/><Field label="תחום" name="industry" value={form.industry} onChange={set} placeholder="תחום עיסוק"/></>}
          {!effectiveClientId&&(
            <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#92400e",lineHeight:1.6}}>
              בחר לקוח בראש המסך כדי לשמור ולתזמן מאמרים
            </div>
          )}
          {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:7,padding:"8px 12px",fontSize:12,color:RED,marginBottom:9}}>{error}</div>}
          {saveMsg&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:7,padding:"8px 12px",fontSize:12,color:GREEN,marginBottom:9}}>✓ {saveMsg}</div>}
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",letterSpacing:1,marginBottom:4,textTransform:"uppercase"}}>הערות / תיקונים</div>
            <textarea value={articleInstructions} onChange={e=>setArticleInstructions(e.target.value)}
              placeholder="לדוגמה: שנה 2026, הדגש דגם מסוים, אל תזכיר מתחרים..."
              rows={2} style={{width:"100%",padding:"8px 11px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:12,fontFamily:"Heebo,sans-serif",resize:"vertical",outline:"none",boxSizing:"border-box",direction:"rtl"}}/>
          </div>
          {result&&(
            <div style={{marginBottom:12}}>
              <label style={{display:"block",fontSize:11,fontWeight:600,color:"#64748b",marginBottom:4}}>תאריך ושעת פרסום</label>
              <input type="datetime-local" value={schedDate} onChange={e=>setSchedDate(e.target.value)}
                style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,color:ACCENT,outline:"none",direction:"ltr",boxSizing:"border-box",marginBottom:8}}/>
              <button onClick={saveDraft} style={{width:"100%",background:ACCENT,color:"#fff",border:"none",borderRadius:8,padding:"10px 0",fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:6}}>💾 שמור מאמר</button>
              <button onClick={saveAndSchedule} style={{width:"100%",background:PURPLE,color:"#fff",border:"none",borderRadius:8,padding:"10px 0",fontSize:13,fontWeight:700,cursor:"pointer"}}>📅 שמור ותזמן</button>
            </div>
          )}
          {!brief?(
            <button onClick={generateBrief} disabled={briefLoading||loading} style={{width:"100%",background:briefLoading?"#94a3b8":ACCENT,color:"#fff",border:"none",borderRadius:9,padding:"12px 0",fontSize:14,fontWeight:700,cursor:briefLoading?"not-allowed":"pointer",fontFamily:"Heebo,sans-serif"}}>
              {briefLoading?<span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Spin color="#fff"/>מכין תקציר...</span>:"📋 צור תקציר"}
            </button>
          ):(
            <button onClick={()=>{setBrief(null);setResult(null);setPublished(false);setSaveMsg("");}} style={{width:"100%",background:"#f1f5f9",color:ACCENT,border:"1.5px solid #e2e8f0",borderRadius:9,padding:"12px 0",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>← שנה כיוון</button>
          )}
        </div>
      </div>

      {/* main area */}
      <div style={{flex:1,padding:"22px 26px",overflowY:"auto"}}>
        {!brief&&!briefLoading&&!result&&!loading&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:12,textAlign:"center"}}>
            <div style={{fontSize:44,opacity:.2}}>✦</div>
            <div style={{fontSize:17,fontWeight:700,color:"#cbd5e1"}}>כתיבת תוכן SEO</div>
            <div style={{fontSize:13,color:"#94a3b8",maxWidth:300,lineHeight:1.8}}>הזן נושא ומילות מפתח ולחץ 'צור תקציר'</div>
          </div>
        )}
        {briefLoading&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,padding:"60px 0"}}><Spin size={40}/><div style={{color:"#64748b",fontSize:14,fontFamily:"Heebo,sans-serif"}}>מכין תקציר...</div></div>}
        {brief&&!result&&!loading&&!briefLoading&&(
          <div style={{animation:"fadeIn .35s ease",maxWidth:620}}>
            <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",letterSpacing:1.5,marginBottom:14,textTransform:"uppercase"}}>תקציר לאישור</div>
            <div style={{background:"#fff",borderRadius:14,border:"1.5px solid #e2e8f0",borderTop:`3px solid ${BLUE}`,padding:"22px 24px",marginBottom:14}}>
              <div style={{fontSize:18,fontWeight:800,color:ACCENT,marginBottom:8,lineHeight:1.4}}>{brief.briefTitle}</div>
              <div style={{fontSize:13,color:BLUE,fontWeight:600,marginBottom:16,background:"#eff6ff",borderRadius:7,padding:"6px 12px",display:"inline-block"}}>{brief.angle}</div>
              <div style={{marginBottom:16}}>
                {(brief.outline||[]).map((p,i)=>(
                  <div key={i} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:"1px solid #f1f5f9"}}>
                    <span style={{color:BLUE,fontWeight:700,fontSize:12,flexShrink:0}}>{i+1}</span>
                    <span style={{fontSize:13,color:"#334155",lineHeight:1.5}}>{p}</span>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16,alignItems:"flex-end"}}>
                <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"7px 13px"}}>
                  <div style={{fontSize:10,fontWeight:700,color:"#166534",marginBottom:2}}>מילת מפתח ראשית</div>
                  <div style={{fontSize:13,color:GREEN,fontWeight:700}}>{brief.primaryKeyword}</div>
                </div>
                <div style={{flex:1,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"7px 13px"}}>
                  <div style={{fontSize:10,fontWeight:700,color:"#64748b",marginBottom:2}}>למה המאמר הזה?</div>
                  <div style={{fontSize:12,color:"#334155",lineHeight:1.5}}>{brief.whyThisArticle}</div>
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <button onClick={()=>setShowInstructions(!showInstructions)}
                  style={{background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer",color:"#64748b",fontFamily:"Heebo,sans-serif",display:"flex",alignItems:"center",gap:6}}>
                  📌 הנחיות נוספות {showInstructions?"▲":"▼"}
                </button>
                {showInstructions&&(
                  <textarea value={articleInstructions} onChange={e=>setArticleInstructions(e.target.value)}
                    placeholder="הוסף כיוון מיוחד: תדגיש פתרונות לעסקים קטנים, אל תזכיר מתחרים, הוסף קריאה לפעולה לרכישת מוצר X..."
                    rows={2} style={{marginTop:8,width:"100%",padding:"9px 12px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"Heebo,sans-serif",resize:"vertical",outline:"none",boxSizing:"border-box",direction:"rtl"}}/>
                )}
              </div>
              <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <div>
                  <label style={{display:"block",fontSize:11,fontWeight:600,color:"#64748b",marginBottom:4,fontFamily:"Heebo,sans-serif"}}>תאריך ושעת פרסום</label>
                  <input type="datetime-local" value={schedDate} onChange={e=>setSchedDate(e.target.value)}
                    style={{padding:"7px 10px",border:"1.5px solid #e2e8f0",borderRadius:7,fontSize:13,color:ACCENT,outline:"none",direction:"ltr"}}/>
                </div>
                <button onClick={generate} style={{flex:1,background:ACCENT,color:"#fff",border:"none",borderRadius:9,padding:"12px 0",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"Heebo,sans-serif",minWidth:160}}>
                  ✦ אשר וצור מאמר
                </button>
                <button onClick={()=>{setBrief(null);setResult(null);}} style={{background:"#f1f5f9",color:"#64748b",border:"1.5px solid #e2e8f0",borderRadius:9,padding:"12px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>← שנה</button>
              </div>
            </div>
          </div>
        )}
        {loading&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,padding:"60px 0"}}><Spin size={40}/><div style={{color:"#64748b",fontSize:14,fontFamily:"Heebo,sans-serif"}}>Claude כותב את המאמר...</div></div>}
        {result&&!loading&&(
          <div style={{animation:"fadeIn .35s ease"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18,gap:10,flexWrap:"wrap"}}>
              <div>
                <h2 style={{fontSize:19,fontWeight:800,color:ACCENT,margin:0}}>{result.title}</h2>
                <div style={{fontSize:11,color:"#64748b",marginTop:2,direction:"ltr",textAlign:"right"}}>/{result.slug}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <ScoreBadge score={result.seoScore}/>
                <span style={{fontSize:12,color:"#64748b"}}>⏱ {result.readTime}</span>
                <button onClick={saveDraft} style={{background:ACCENT,color:"#fff",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>💾 שמור מאמר</button>
                <button onClick={saveAndSchedule} style={{background:PURPLE,color:"#fff",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>📅 שמור ותזמן</button>
                <button onClick={exportReport} style={{background:BLUE,color:"#fff",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"Heebo,sans-serif"}}>⬇ ייצוא</button>
                {getPublishTarget(client)&&!published&&(
                  <button onClick={publishArticle} disabled={publishing} style={{background:publishing?"#94a3b8":GREEN,color:"#fff",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:publishing?"not-allowed":"pointer",fontFamily:"Heebo,sans-serif"}}>
                    {publishing?<span style={{display:"flex",alignItems:"center",gap:6}}><Spin color="#fff" size={12}/>מפרסם...</span>:"🌐 פרסם לאתר"}
                  </button>
                )}
                {!getPublishTarget(client)&&!published&&(
                  <span style={{background:"#fffbeb",border:"1px solid #fde68a",color:"#92400e",borderRadius:7,padding:"7px 12px",fontSize:11,fontWeight:600}}>חסר חיבור לאתר בהגדרות הלקוח</span>
                )}
                {published&&<span style={{background:"#f0fdf4",border:"1px solid #bbf7d0",color:GREEN,borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700}}>✓ פורסם!</span>}
              </div>
            </div>
            {saveMsg&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:GREEN,fontWeight:600}}>✓ {saveMsg}</div>}
            {!effectiveClientId&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:"#92400e"}}>בחר לקוח בראש המסך כדי לשמור ולתזמן את המאמר</div>}
            <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap",marginBottom:16,background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 14px"}}>
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:600,color:"#64748b",marginBottom:4}}>תאריך ושעת פרסום</label>
                <input type="datetime-local" value={schedDate} onChange={e=>setSchedDate(e.target.value)}
                  style={{padding:"7px 10px",border:"1.5px solid #e2e8f0",borderRadius:7,fontSize:13,color:ACCENT,outline:"none",direction:"ltr"}}/>
              </div>
              <button onClick={saveDraft} style={{background:ACCENT,color:"#fff",border:"none",borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:700,cursor:"pointer"}}>💾 שמור בעמוד מאמרים</button>
              <button onClick={saveAndSchedule} style={{background:PURPLE,color:"#fff",border:"none",borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:700,cursor:"pointer"}}>📅 שמור ותזמן ללוח</button>
            </div>
            <div style={{display:"flex",gap:3,background:"#f1f5f9",borderRadius:8,padding:3,marginBottom:18,width:"fit-content"}}>
              {tabs.map(t=><button key={t.key} onClick={()=>setTab(t.key)} style={{padding:"6px 13px",borderRadius:6,border:"none",fontFamily:"Heebo,sans-serif",fontSize:12,fontWeight:600,cursor:"pointer",background:tab===t.key?ACCENT:"transparent",color:tab===t.key?"#fff":"#64748b"}}>{t.label}</button>)}
            </div>
            {tab==="article"&&<div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"22px 26px"}}><ArticleView text={result.article}/></div>}
            {tab==="meta"&&(
              <div style={{display:"flex",flexDirection:"column",gap:11}}>
                {[{l:"Meta Title",v:result.metaTitle,n:(result.metaTitle?.length||0)+" תווים"},{l:"Meta Description",v:result.metaDescription,n:(result.metaDescription?.length||0)+" תווים"},{l:"Slug",v:"/"+result.slug,ltr:true}].map(item=>(
                  <div key={item.l} style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",borderRight:`4px solid ${ACCENT}`,padding:"13px 17px"}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#64748b",marginBottom:4,letterSpacing:1}}>{item.l}</div>
                    <div style={{fontSize:14,color:ACCENT,fontWeight:600,direction:item.ltr?"ltr":"rtl",textAlign:"right"}}>{item.v}</div>
                    {item.n&&<div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>{item.n}</div>}
                  </div>
                ))}
                <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",borderRight:`4px solid ${BLUE}`,padding:"13px 17px"}}>
                  <div style={{fontSize:10,fontWeight:700,color:"#64748b",marginBottom:8,letterSpacing:1}}>קישורים פנימיים</div>
                  {(result.internalLinkSuggestions||[]).map((t,i)=><div key={i} style={{padding:"6px 10px",background:"#eff6ff",borderRadius:6,marginBottom:5,fontSize:13,color:"#1e40af"}}>🔗 {t}</div>)}
                </div>
              </div>
            )}
            {tab==="keywords"&&(
              <div style={{display:"flex",flexDirection:"column",gap:11}}>
                {[{label:"מילות מפתח עיקריות",items:result.keywords||[],color:ACCENT},{label:"LSI Keywords",items:result.lsiKeywords||[],color:BLUE}].map(sec=>(
                  <div key={sec.label} style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"16px 20px"}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#64748b",marginBottom:9,letterSpacing:1}}>{sec.label}</div>
                    {sec.items.map(k=><span key={k} style={{background:sec.color+"14",color:sec.color,border:`1px solid ${sec.color}35`,borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:600,display:"inline-block",margin:"2px 3px"}}>{k}</span>)}
                  </div>
                ))}
              </div>
            )}
            {tab==="outline"&&(
              <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"16px 20px"}}>
                <div style={{fontSize:10,fontWeight:700,color:"#64748b",marginBottom:12,letterSpacing:1}}>מבנה המאמר</div>
                {(result.outline||[]).map((item,i)=>(
                  <div key={i} style={{borderRight:`3px solid ${ACCENT}`,paddingRight:14,marginBottom:14}}>
                    <div style={{fontWeight:700,fontSize:14,color:ACCENT,marginBottom:5}}>H2 · {item.heading}</div>
                    {(item.subheadings||[]).map((s,j)=><div key={j} style={{borderRight:"2px solid #e2e8f0",paddingRight:12,marginBottom:3,fontSize:12,color:"#64748b"}}>H3 · {s}</div>)}
                  </div>
                ))}
              </div>
            )}
            {tab==="tips"&&(
              <div style={{display:"flex",flexDirection:"column",gap:9}}>
                {(result.seoTips||[]).map((tip,i)=>(
                  <div key={i} style={{background:"#fff",borderRadius:9,border:"1px solid #e2e8f0",borderRight:`4px solid ${BLUE}`,padding:"11px 15px",display:"flex",gap:10}}>
                    <span style={{color:BLUE,fontWeight:800,fontSize:14,flexShrink:0}}>{i+1}</span>
                    <span style={{fontSize:13,color:"#334155",lineHeight:1.7}}>{tip}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Post-generation revision */}
            <div style={{marginTop:22,background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",padding:"18px 20px"}}>
              <div style={{fontSize:13,fontWeight:800,color:ACCENT,marginBottom:12}}>↻ שפר את המאמר</div>
              <Field label="הערות לתוכן" name="rc" value={revisionNotes.content||""} onChange={e=>setRevisionNotes(n=>({...n,content:e.target.value}))} multiline rows={2} placeholder="שנה פסקה 2, הוסף דוגמה..."/>
              <Field label="הערות למילות מפתח" name="rk" value={revisionNotes.keywords||""} onChange={e=>setRevisionNotes(n=>({...n,keywords:e.target.value}))} multiline rows={2} placeholder="הוסף 'טרקטורונים חדרה', הסר..."/>
              <Field label="הערות למבנה" name="rs" value={revisionNotes.structure||""} onChange={e=>setRevisionNotes(n=>({...n,structure:e.target.value}))} multiline rows={2} placeholder="הוסף H2 על תחזוקה, הסר סעיף על..."/>
              <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:4}}>
                <button onClick={saveDraft} style={{background:ACCENT,color:"#fff",border:"none",borderRadius:9,padding:"12px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>💾 שמור מאמר</button>
                <button onClick={saveAndSchedule} style={{background:PURPLE,color:"#fff",border:"none",borderRadius:9,padding:"12px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>📅 שמור ותזמן</button>
                <button onClick={regenerateArticle} disabled={revising}
                  style={{background:revising?"#94a3b8":AMBER,color:"#fff",border:"none",borderRadius:9,padding:"12px 18px",fontSize:13,fontWeight:700,cursor:revising?"not-allowed":"pointer"}}>
                  {revising?<span style={{display:"flex",alignItems:"center",gap:6}}><Spin color="#fff"/>משפר...</span>:"↻ שפר מאמר לפי הערות"}
                </button>
              </div>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:8}}>שמירה מעבירה לעמוד המאמרים. תזמון דורש תאריך ושעה למעלה ומעביר גם ללוח הפרסום.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ARTICLES LIBRARY ──────────────────────────────────────────────────────────
function ArticlesLibrary({activeClientId,onWriteArticle}){
  const clients=getActiveClients(activeClientId);
  const [preview,setPreview]=useState(null);
  const [,setTick]=useState(0);
  const refresh=()=>setTick(t=>t+1);
  const rows=[];
  clients.forEach(c=>{
    (c.articles||[]).forEach(a=>{
      if(!hasFullArticle(a))return;
      rows.push({clientId:c.id,clientName:c.name,article:a});
    });
  });
  rows.sort((a,b)=>{
    const da=a.article.draftContent?.generatedAt||a.article.publishedAt||a.article.scheduledDate||"";
    const db=b.article.draftContent?.generatedAt||b.article.publishedAt||b.article.scheduledDate||"";
    return new Date(db)-new Date(da);
  });

  const remove=(clientId,articleId)=>{
    if(!confirm("למחוק את המאמר?"))return;
    DB.deleteArticle(clientId,articleId);
    setPreview(null);
    refresh();
  };

  return(
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px",background:"#f8fafc"}}>
      <div style={{maxWidth:960,margin:"0 auto"}}>
        <div style={{fontSize:20,fontWeight:800,color:ACCENT,marginBottom:6}}>מאמרים</div>
        <div style={{fontSize:13,color:"#64748b",marginBottom:18,lineHeight:1.6}}>
          כל המאמרים המלאים שנשמרו במערכת — גם טיוטות שעדיין לא תוזמנו ללוח הפרסום.
          {activeClientId?" · מסונן לפי: "+(DB.getById(activeClientId)?.name||""):""}
        </div>
        {rows.length===0?(
          <div style={{textAlign:"center",padding:"60px 0",color:"#94a3b8",fontSize:13}}>אין מאמרים מלאים עדיין — צור מאמר במסך הכתיבה</div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {rows.map(({clientId,clientName,article:a})=>(
              <div key={clientId+"-"+a.id} style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",padding:"14px 18px"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:15,fontWeight:800,color:ACCENT,marginBottom:4}}>{a.draftContent?.title||a.publishedContent?.title||a.title}</div>
                    <div style={{fontSize:12,color:"#64748b",marginBottom:8}}>{clientName}{a.keywords?" · "+a.keywords:""}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                      <StatusBadge status={a.status}/>
                      {a.scheduledDate&&<span style={{fontSize:12,color:PURPLE,fontWeight:600}}>📅 {formatDateTime(a.scheduledDate)}</span>}
                      {a.draftContent?.generatedAt&&<span style={{fontSize:11,color:"#94a3b8"}}>נשמר {formatDateTime(a.draftContent.generatedAt)}</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button onClick={()=>setPreview({clientId,article:a})} style={{background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:7,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>📄 צפה</button>
                    <button onClick={()=>onWriteArticle(clientId,a.id)} style={{background:BLUE,color:"#fff",border:"none",borderRadius:7,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>✏ ערוך</button>
                    {a.status!=="published"&&(
                      <input type="datetime-local" value={toDatetimeLocal(a.scheduledDate)} onChange={e=>{
                        const v=e.target.value;
                        DB.updateArticle(clientId,a.id,{scheduledDate:v||null,status:v?"scheduled":"draft"});
                        refresh();
                      }} style={{padding:"5px 9px",border:"1.5px solid #e2e8f0",borderRadius:7,fontSize:12,direction:"ltr"}} title="תזמן ללוח פרסום"/>
                    )}
                    <button onClick={()=>remove(clientId,a.id)} style={{background:"#fef2f2",color:RED,border:"1px solid #fecaca",borderRadius:7,padding:"7px 10px",fontSize:12,fontWeight:700,cursor:"pointer"}}>🗑</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {preview&&(
        <div style={{position:"fixed",inset:0,background:"#0f172a90",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"#fff",borderRadius:16,padding:"26px 28px",maxWidth:720,width:"100%",maxHeight:"85vh",overflowY:"auto",direction:"rtl"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,gap:10}}>
              <div style={{fontSize:18,fontWeight:800,color:ACCENT}}>{preview.article.draftContent?.title||preview.article.title}</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{onWriteArticle(preview.clientId,preview.article.id);setPreview(null);}} style={{background:BLUE,color:"#fff",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>✏ ערוך</button>
                <button onClick={()=>setPreview(null)} style={{background:"#f1f5f9",border:"none",borderRadius:7,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>✕</button>
              </div>
            </div>
            <ArticleView text={articleBody(preview.article)}/>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CALENDAR ──────────────────────────────────────────────────────────────────
function Calendar({activeClientId,onWriteArticle}){
  const clients=getActiveClients(activeClientId);
  const [preview,setPreview]=useState(null);
  const [,setTick]=useState(0);
  const refresh=()=>setTick(t=>t+1);
  const rows=[];
  clients.forEach(c=>{
    (c.articles||[]).forEach(a=>{
      // Only full articles that are scheduled or published appear on the calendar
      if(!hasFullArticle(a))return;
      if(!(a.scheduledDate||a.publishedAt))return;
      rows.push({
        date:a.publishedAt||a.scheduledDate,
        client:c.name, domain:c.domain, clientId:c.id,
        articleId:a.id, title:a.title, status:a.status, slug:a.slug||a.draftContent?.slug,
        article:a,
      });
    });
  });
  rows.sort((a,b)=>{
    if(a.status==="published"&&b.status!=="published")return 1;
    if(a.status!=="published"&&b.status==="published")return -1;
    return new Date(a.date)-new Date(b.date);
  });

  const fmt=(d)=>formatDateTime(d);

  const removeFromCalendar=(clientId,articleId,hardDelete)=>{
    if(hardDelete){
      if(!confirm("למחוק את המאמר לגמרי מהמערכת?"))return;
      DB.deleteArticle(clientId,articleId);
    }else{
      if(!confirm("להסיר מהלוח? המאמר יישאר בעמוד המאמרים כטיוטה."))return;
      DB.updateArticle(clientId,articleId,{scheduledDate:null,status:"draft"});
    }
    setPreview(null);
    refresh();
  };

  return(
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px",background:"#f8fafc"}}>
      <div style={{maxWidth:960,margin:"0 auto"}}>
        <div style={{fontSize:20,fontWeight:800,color:ACCENT,fontFamily:"Heebo,sans-serif",marginBottom:8}}>לוח פרסום</div>
        {activeClientId&&<div style={{fontSize:13,color:"#64748b",marginBottom:16}}>מציג רק: {DB.getById(activeClientId)?.name}</div>}
        {rows.length===0?(
          <div style={{textAlign:"center",padding:"60px 0",color:"#94a3b8",fontSize:13,fontFamily:"Heebo,sans-serif"}}>
            אין מאמרים מתוזמנים — צור מאמר מלא ואז קבע תאריך פרסום
          </div>
        ):(
          <div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"170px 1fr 110px 90px 160px",background:ACCENT,color:"#fff",padding:"10px 18px",gap:12,fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",fontFamily:"Heebo,sans-serif"}}>
              <div>תאריך</div><div>מאמר</div><div>לקוח</div><div>סטטוס</div><div></div>
            </div>
            {rows.map((r,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"170px 1fr 110px 90px 160px",padding:"12px 18px",gap:12,borderBottom:"1px solid #f1f5f9",alignItems:"center",background:i%2===0?"#fff":"#fafafa"}}>
                <div style={{fontSize:12,color:"#64748b",fontFamily:"Heebo,sans-serif"}}>{fmt(r.date)}</div>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:ACCENT,fontFamily:"Heebo,sans-serif",lineHeight:1.4}}>{r.title}</div>
                  {r.slug&&<div style={{fontSize:10,color:"#94a3b8",direction:"ltr",marginTop:2}}>/{r.slug}</div>}
                </div>
                <div style={{fontSize:12,color:"#64748b",fontFamily:"Heebo,sans-serif"}}>{r.client}</div>
                <div><StatusBadge status={r.status}/></div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button onClick={()=>setPreview(r)} style={{background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:700,cursor:"pointer",color:ACCENT}}>👁</button>
                  <button onClick={()=>onWriteArticle?.(r.clientId,r.articleId)} style={{background:BLUE,color:"#fff",border:"none",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>✏</button>
                  {r.status!=="published"&&(
                    <button onClick={()=>removeFromCalendar(r.clientId,r.articleId,false)} style={{background:"#fff7ed",color:AMBER,border:"1px solid #fed7aa",borderRadius:6,padding:"5px 8px",fontSize:11,fontWeight:700,cursor:"pointer"}} title="הסר מלוח">✕</button>
                  )}
                  <button onClick={()=>removeFromCalendar(r.clientId,r.articleId,true)} style={{background:"#fef2f2",color:RED,border:"1px solid #fecaca",borderRadius:6,padding:"5px 8px",fontSize:11,fontWeight:700,cursor:"pointer"}} title="מחק לגמרי">🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {preview&&(
        <div style={{position:"fixed",inset:0,background:"#0f172a90",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"#fff",borderRadius:16,padding:"26px 28px",maxWidth:720,width:"100%",maxHeight:"85vh",overflowY:"auto",direction:"rtl",fontFamily:"Heebo,sans-serif"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:16}}>
              <div>
                <div style={{fontSize:18,fontWeight:800,color:ACCENT}}>{preview.article.draftContent?.title||preview.title}</div>
                <div style={{fontSize:12,color:"#64748b",marginTop:4}}>{preview.client} · {fmt(preview.date)}</div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{onWriteArticle?.(preview.clientId,preview.articleId);setPreview(null);}}
                  style={{background:BLUE,color:"#fff",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>✏ ערוך</button>
                <button onClick={()=>setPreview(null)} style={{background:"#f1f5f9",border:"none",borderRadius:7,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",color:"#64748b"}}>✕</button>
              </div>
            </div>
            {articleBody(preview.article)?(
              <ArticleView text={articleBody(preview.article)}/>
            ):(
              <div style={{color:"#94a3b8",fontSize:13}}>אין טיוטת מאמר מלאה עדיין — רק תקציר/תזמון.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function SEOAgent(){
  const [page,setPage]=useState("scan");
  const [writeProps,setWriteProps]=useState(null);
  const [openClientId,setOpenClientId]=useState(null);
  const [activeClientId,setActiveClientId]=useState(null);
  const [ready,setReady]=useState(!supabase); // no Supabase configured → skip hydration wait
  const [,setTick]=useState(0);
  const refreshNav=()=>setTick(t=>t+1);

  useEffect(()=>{
    if(!supabase)return;
    DB.hydrate().finally(()=>setReady(true));
  },[]);

  const goWrite=(clientId,articleId)=>{
    if(clientId)setActiveClientId(clientId);
    setWriteProps({clientId,articleId});
    setPage("write");
  };
  const goClients=(clientId)=>{
    if(clientId){setOpenClientId(clientId);setActiveClientId(clientId);}
    setPage("clients");
  };

  const scopedClients=getActiveClients(activeClientId);
  const totalScheduled=scopedClients.reduce((s,c)=>s+(c.articles||[]).filter(a=>a.status==="scheduled"&&hasFullArticle(a)).length,0);
  const totalDrafts=scopedClients.reduce((s,c)=>s+(c.articles||[]).filter(a=>hasFullArticle(a)).length,0);
  const activeClient=activeClientId?DB.getById(activeClientId):null;
  const allClients=DB.get();

  if(!ready){
    return(
      <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f1f5f9"}}>
        <Spin size={32}/>
      </div>
    );
  }

  return(
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&display=swap');
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
        input,select,button,textarea{font-family:Heebo,sans-serif}
      `}</style>
      <div style={{minHeight:"100vh",background:"#f1f5f9",direction:"rtl",fontFamily:"Heebo,sans-serif",display:"flex",flexDirection:"column"}}>
        <div style={{background:ACCENT,color:"#fff",padding:"0 24px",display:"flex",alignItems:"center",height:52,flexShrink:0,gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginLeft:8}}>
            <div style={{width:30,height:30,background:BLUE,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>✦</div>
            <div>
              <div style={{fontWeight:800,fontSize:14}}>סוכן SEO{activeClient?" · "+activeClient.name:""}</div>
              <div style={{fontSize:10,color:"#64748b"}}>כלי קידום אורגני</div>
            </div>
          </div>
          <select value={activeClientId||""} onChange={e=>{
            const id=e.target.value||null;
            setActiveClientId(id);
            if(id){setOpenClientId(id);refreshNav();}
          }} style={{background:"#1e293b",color:"#fff",border:"1px solid #334155",borderRadius:8,padding:"6px 10px",fontSize:12,maxWidth:200,outline:"none"}}>
            <option value="">כל הלקוחות</option>
            {allClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{display:"flex",gap:2,flex:1}}>
            {[
              {key:"scan",    label:"🔍 סריקה"},
              {key:"clients", label:"👥 לקוחות", badge:scopedClients.length},
              {key:"write",   label:"✦ כתיבה"},
              {key:"articles",label:"📄 מאמרים", badge:totalDrafts},
              {key:"calendar",label:"📅 לוח פרסום", badge:totalScheduled},
            ].map(n=><NavTab key={n.key} label={n.label} active={page===n.key} onClick={()=>{
              if(n.key==="clients"&&activeClientId)setOpenClientId(activeClientId);
              setPage(n.key);
            }} badge={n.badge}/>)}
          </div>
        </div>
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          {page==="scan"    && <SiteScanner onClientSaved={id=>{setOpenClientId(id);setActiveClientId(id);setPage("clients");}}/>}
          {page==="clients" && <ClientManager onWriteArticle={goWrite} initialOpenId={openClientId} onSelectClient={id=>setActiveClientId(id)}/>}
          {page==="write"   && <ContentWriter clientId={writeProps?.clientId} articleId={writeProps?.articleId} activeClientId={activeClientId} onBack={()=>goClients(writeProps?.clientId||activeClientId)} onSaved={()=>refreshNav()}/>}
          {page==="articles"&& <ArticlesLibrary activeClientId={activeClientId} onWriteArticle={goWrite}/>}
          {page==="calendar"&& <Calendar activeClientId={activeClientId} onWriteArticle={goWrite}/>}
        </div>
      </div>
    </>
  );
}
