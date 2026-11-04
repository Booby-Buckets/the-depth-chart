-- Stops the every-minute arb scanner (api/arb-scan.js was removed Nov 2026). Run once in the Supabase SQL editor.
-- Only stops the job: the arb_* tables and functions stay, so no history is lost.
select cron.unschedule('tdc-arb-scan') where exists (select 1 from cron.job where jobname = 'tdc-arb-scan');
select jobname, schedule, active from cron.job order by jobname;
