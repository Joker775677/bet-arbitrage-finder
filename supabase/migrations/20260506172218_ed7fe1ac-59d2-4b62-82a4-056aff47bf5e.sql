
DO $$
BEGIN
  PERFORM cron.unschedule('surebets-ru-scan');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'surebets-ru-scan',
  '*/5 * * * *',
  $$ SELECT net.http_get(
    url := 'https://project--7571ac17-6219-4b02-914c-fc2d243c62dc.lovable.app/api/public/scan-ru',
    timeout_milliseconds := 60000
  ) AS request_id; $$
);
