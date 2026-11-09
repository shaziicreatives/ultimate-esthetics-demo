// Temporary one-time Preview data copy. Remove this route and SOURCE_DB
// binding immediately after the source data has been copied successfully.
const TABLE_ORDER = [
 "doctors","users","patients","appointments","visits","visit_procedures","payments",
 "activity_log","appointment_daily_tokens","clinic_integrations","clinic_security_settings",
 "daily_token_counters","email_changes","email_verification_tokens","invoice_sequence",
 "login_attempts","password_resets","patient_notes","push_subscriptions","sessions",
 "settings","user_permissions"
];
const quote = value => '"' + String(value).replace(/"/g,'""') + '"';

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
   const existing = await env.DB.prepare(
     "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV'"
   ).first();
   if (Number(existing?.n || 0) > 0) {
     return Response.json({error:"Target Preview database is not empty; refusing to overwrite it."},{status:409});
   }

   const schema = await env.SOURCE_DB.prepare(
     "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name"
   ).all();
   const tables = schema.results || [];
   const byName = new Map(tables.map(t => [t.name,t]));
   const ordered = [...TABLE_ORDER.filter(n => byName.has(n)),
                    ...tables.map(t => t.name).filter(n => !TABLE_ORDER.includes(n))];

   // Create every table first; D1 supports FK declarations before referenced data exists.
   for (const name of ordered) {
     const ddl = byName.get(name)?.sql;
     if (ddl) await env.DB.prepare(ddl).run();
   }

   const counts = [];
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
       const statements = rows.slice(start,start+20).map(row =>
         env.DB.prepare(insertSql).bind(...cols.map(col => row[col] === undefined ? null : row[col]))
       );
       if (statements.length) await env.DB.batch(statements);
     }
     counts.push({table:name,rows:rows.length});
   }

   // Add explicit indexes after rows have been inserted.
   const indexes = await env.SOURCE_DB.prepare(
     "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
   ).all();
   for (const item of indexes.results || []) await env.DB.prepare(item.sql).run();

   const verification = {};
   for (const name of ["users","patients","doctors","appointments","visits","payments","visit_procedures","activity_log","sessions","login_attempts"]) {
     if (!byName.has(name)) continue;
     const result = await env.DB.prepare("SELECT COUNT(*) AS n FROM " + quote(name)).first();
     verification[name] = Number(result?.n || 0);
   }
   return Response.json({
     success:true,
     copied_tables:counts.length,
     copied_rows:counts.reduce((n,x)=>n+x.rows,0),
     counts,
     verification,
     next:"Apply migration 0009 to this isolated Preview database, then remove SOURCE_DB and this temporary route."
   });
 } catch (error) {
   return Response.json({error:"Preview data copy failed: "+String(error?.message||error).slice(0,400)},500);
 }
}
