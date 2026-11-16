-- Headline totals across every client, and where the rows came from.
SELECT
  MIN(d.date) AS first_day,
  MAX(d.date) AS last_day,
  COUNT(DISTINCT d.workspace_id) AS clients,
  COUNT(DISTINCT d.campaign_ref) AS campaigns,
  SUM(d.sent) AS sent,
  SUM(d.replied) AS replied,
  SUM(d.positive) AS positive,
  SUM(d.sent) / NULLIF(SUM(d.positive), 0) AS sends_per_positive,
  ANY_VALUE(i.demo) AS demo,
  ANY_VALUE(i.loaded_at) AS loaded_at
FROM campaign_daily AS d, load_info AS i;
