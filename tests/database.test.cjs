const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('migration, RLS, atomic checkpoint, deduplication and RPC permissions', async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`);
    await db.exec(fs.readFileSync('schema.sql','utf8'));
    const migration=fs.readFileSync('supabase/migrations/202610190001_monitor.sql','utf8');
    await db.exec(migration);
    await db.exec(migration); // repeatable, no V2 data loss
    const user='00000000-0000-0000-0000-000000000001';
    const event={event_key:'a'.repeat(64),signal:'price_above',label:'test',bar_at:'2026-10-19T14:00:00Z',price:101,values:{close:101},source:'alpaca:iex',timeframe:'15Min'};
    const commit=(revision,events=[event])=>db.query('select public.commit_monitor_batch($1,$2,$3,$4,$5,$6,$7)',[user,'MU',revision,'hash',JSON.stringify({close:101}),JSON.stringify({}),JSON.stringify(events)]);
    await db.exec('SET ROLE service_role');
    await commit(0);
    await commit(1); // duplicate event, newer checkpoint => only one event
    assert.equal((await db.query('select count(*)::int n from monitor_events')).rows[0].n,1);
    await assert.rejects(commit(0),/revision conflict/);
    await assert.rejects(commit(2,[{...event,event_key:'b'.repeat(64),price:-1}]),/check constraint/);
    assert.equal((await db.query('select revision from monitor_state')).rows[0].revision,2);
    await db.exec('RESET ROLE; SET ROLE authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    assert.equal((await db.query('select count(*)::int n from monitor_events')).rows[0].n,1);
    await assert.rejects(commit(2),/permission denied/);
    await assert.rejects(db.exec('delete from monitor_events'),/permission denied/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-0000-0000-000000000002']);
    assert.equal((await db.query('select count(*)::int n from monitor_events')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from monitor_state')).rows[0].n,0);
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(db.exec('select * from monitor_events'),/permission denied/);
  }finally{await db.close()}
});
