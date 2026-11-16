-- Reply rate per client per week. Partial first and last weeks are dropped
-- so a short week does not read as a dip.
WITH weeks AS (
  SELECT week, COUNT(DISTINCT date) AS days
  FROM (SELECT DATE_TRUNC('week', date)::DATE AS week, date FROM campaign_daily)
  GROUP BY week
)
SELECT w.workspace_id, w.provider, w.week, w.sent, w.replied, w.reply_rate
FROM workspace_weekly AS w
JOIN weeks USING (week)
WHERE weeks.days = 7
ORDER BY w.workspace_id, w.week;
