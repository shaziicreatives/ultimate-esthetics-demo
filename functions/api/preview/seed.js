// One-time Preview-only copy from SOURCE_DB into the isolated Preview DB.
// Remove this route and the SOURCE_DB binding after the seed reports complete.
const TABLE_ORDER = [
 "doctors","users","patients","appointments","visits","visit_procedures","payments",
 "activity_log","appointment_daily_tokens","clinic_integrations","clinic_security_settings",
 "daily_token_counters","email_changes","email_verification_tokens","invoice_sequence",
 "login_attempts","password_resets","patient_notes","push_subscriptions","sessions",
 "settings","user_permissions"
];
const quote = value => '"' + String(value).replace(/"/g,'""') + '"';
const migration0009 = `
CREATE TABLE IF NOT EXISTS google_drive_connections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  encrypted_tokens TEXT NOT NULL,
  token_expires_at INTEGER,
  selected_drive_id TEXT,
  selected_drive_name TEXT,
  root_folder_id TEXT,
  root_folder_name TEXT,
  auto_save_invoice_pdf INTEGER NOT NULL DEFAULT 1,
  auto_save_patient_record INTEGER NOT NULL DEFAULT 1,
  auto_save_visit_record INTEGER NOT NULL DEFAULT 1,
  connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sync_at DATETIME,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS google_drive_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drive_oauth_expiry ON google_drive_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS google_drive_patient_folders (
  patient_id INTEGER PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS google_drive_visit_folders (
  visit_id INTEGER PRIMARY KEY REFERENCES visits(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS google_drive_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
  file_kind TEXT NOT NULL CHECK(file_kind IN ('invoice_pdf','patient_record_json','visit_record_json','visit_details_pdf')),
  drive_file_id TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  web_view_link TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drive_files_patient ON google_drive_files(patient_id);
CREATE INDEX IF NOT EXISTS idx_drive_files_visit ON google_drive_files(visit_id);
CREATE TABLE IF NOT EXISTS google_drive_sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
  job_kind TEXT NOT NULL CHECK(job_kind IN ('patient','visit')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','saved','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_kind, visit_id, patient_id)
);
CREATE INDEX IF NOT EXISTS idx_drive_sync_pending ON google_drive_sync_jobs(status, created_at);
CREATE TABLE IF NOT EXISTS google_drive_folder_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_email TEXT NOT NULL,
  folder_kind TEXT NOT NULL CHECK(folder_kind IN ('patient','visit')),
  patient_id INTEGER NOT NULL,
  visit_id INTEGER,
  folder_id TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drive_folder_history_patient ON google_drive_folder_history(patient_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_drive_folder_history_visit ON google_drive_folder_history(visit_id, archived_at);
`;

export async function onRequestGet({request,env}) {
 const host = new URL(request.url).hostname;
 if (host === "ultimate-esthetics-demo.pages.dev" ||
     !host.endsWith(".ultimate-esthetics-demo.pages.dev")) {
   return Response.json({error:"Preview-only route."},{status:404});
 }
 if (!env.DB || !env.SOURCE_DB) {
   return Response.json({error:"Preview DB bindings are not configured."},{status:503});
 }
 try {
   await env.DB.prepare("CREATE TABLE IF NOT EXISTS _preview_seed_status (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, copied_tables INTEGER NOT NULL DEFAULT 0, copied_rows INTEGER NOT NULL DEFAULT 0, counts_json TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
   const state = await env.DB.prepare("SELECT * FROM _preview_seed_status WHERE id=1").first();
   if (state?.state === "complete") {
     return Response.json({success:true,already_seeded:true,copied_tables:state.copied_tables,copied_rows:state.copied_rows,counts:JSON.parse(state.counts_json||"[]")});
   }
   if (state?.state === "running") {
     return Response.json({error:"Preview data copy is already running. Refresh in a moment."},{status:409});
   }
   const existing = await env.DB.prepare(
     "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV','_preview_seed_status')"
   ).first();
   if (Number(existing?.n || 0) > 0) {
     return Response.json({error:"Target Preview database already contains application tables; refusing to overwrite it."},{status:409});
   }
   await env.DB.prepare("INSERT INTO _preview_seed_status(id,state,copied_tables,copied_rows,counts_json,updated_at) VALUES(1,'running',0,0,'[]',CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET state='running',updated_at=CURRENT_TIMESTAMP").run();

   const schema = await env.SOURCE_DB.prepare(
     "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name"
   ).all();
   const tables = schema.results || [];
   const byName = new Map(tables.map(t => [t.name,t]));
   const ordered = [...TABLE_ORDER.filter(n => byName.has(n)),
                    ...tables.map(t => t.name).filter(n => !TABLE_ORDER.includes(n))];

   for (const name of ordered) {
     const ddl = byName.get(name)?.sql;
     if (ddl) await env.DB.prepare(ddl).run();
   }

   const counts = [];
   const referralUpdates = [];
   for (const name of ordered) {
     const colsResult = await env.SOURCE_DB.prepare("PRAGMA table_info(" + quote(name) + ")").all();
     const cols = (colsResult.results || []).map(c => c.name);
     if (!cols.length) continue;
     const rowsResult = await env.SOURCE_DB.prepare("SELECT * FROM " + quote(name)).all();
     const rows = rowsResult.results || [];
     const colSql = cols.map(quote).join(",");
     const placeholders = cols.map(() => "?").join(",");
     const insertSql = "INSERT INTO " + quote(name) + " (" + colSql + ") VALUES (" + placeholders + ")";
     for (let start=0; start<rows.length; start+=20) {
       const statements = rows.slice(start,start+20).map(row => {
         const values = cols.map(col => {
           if (name === "patients" && col === "referred_by_patient_id") {
             if (row[col] !== null && row[col] !== undefined) referralUpdates.push({id:row.id,ref:row[col]});
             return null;
           }
           return row[col] === undefined ? null : row[col];
         });
         return env.DB.prepare(insertSql).bind(...values);
       });
       if (statements.length) await env.DB.batch(statements);
     }
     counts.push({table:name,rows:rows.length});
   }
   for (let start=0; start<referralUpdates.length; start+=20) {
     const statements=referralUpdates.slice(start,start+20).map(x =>
       env.DB.prepare("UPDATE patients SET referred_by_patient_id=? WHERE id=?").bind(x.ref,x.id)
     );
     await env.DB.batch(statements);
   }

   const indexes = await env.SOURCE_DB.prepare(
     "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
   ).all();
   for (const item of indexes.results || []) await env.DB.prepare(item.sql).run();

   await env.DB.exec(migration0009);
   const verification = {};
   for (const name of ["users","patients","doctors","appointments","visits","payments","visit_procedures","activity_log","sessions","login_attempts","google_drive_connections","google_drive_sync_jobs"]) {
     const result = await env.DB.prepare("SELECT COUNT(*) AS n FROM " + quote(name)).first();
     verification[name] = Number(result?.n || 0);
   }
   const copiedRows=counts.reduce((n,x)=>n+x.rows,0);
   await env.DB.prepare("UPDATE _preview_seed_status SET state='complete',copied_tables=?,copied_rows=?,counts_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=1")
     .bind(counts.length,copiedRows,JSON.stringify(counts)).run();
   return Response.json({success:true,copied_tables:counts.length,copied_rows:copiedRows,counts,verification});
 } catch (error) {
   await env.DB.prepare("UPDATE _preview_seed_status SET state='failed',updated_at=CURRENT_TIMESTAMP WHERE id=1").run().catch(()=>{});
   return Response.json({error:"Preview data copy failed: "+String(error?.message||error).slice(0,400)},500);
 }
}
