
DO $$
BEGIN
  PERFORM cron.unschedule('surebets-auto-scan');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'surebets-auto-scan',
  '*/2 * * * *',
  $$ SELECT net.http_get(url := 'https://project--7571ac17-6219-4b02-914c-fc2d243c62dc.lovable.app/api/public/scan') AS request_id; $$
);
