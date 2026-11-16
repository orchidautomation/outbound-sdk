-- Views over the loaded tables. Run after every load; each one is safe to
-- re-create. Rates follow outbound-sdk's rule: a count the tool does not
-- report is NULL, never 0, so SUM over it stays NULL and so does the rate.

-- One row per campaign per day, with its names.
CREATE OR REPLACE VIEW campaign_daily AS
SELECT
  m.provider,
  m.workspace_id,
  c.ref AS campaign_ref,
  c.name AS campaign,
  c.channel,
  m.date,
  m.sent,
  m.delivered,
  m.opened,
  m.replied,
  m.positive,
  m.bounced,
  m.connections_sent,
  m.connections_accepted
FROM daily_metrics AS m
JOIN campaigns AS c ON c.ref = m.scope_ref
WHERE m.scope = 'campaign';

-- Totals and rates per campaign over everything loaded.
CREATE OR REPLACE VIEW campaign_summary AS
SELECT
  provider,
  workspace_id,
  campaign_ref,
  campaign,
  channel,
  SUM(sent) AS sent,
  SUM(delivered) AS delivered,
  SUM(opened) AS opened,
  SUM(replied) AS replied,
  SUM(positive) AS positive,
  SUM(bounced) AS bounced,
  SUM(opened) / NULLIF(SUM(delivered), 0) AS open_rate,
  SUM(replied) / NULLIF(SUM(delivered), 0) AS reply_rate,
  SUM(positive) / NULLIF(SUM(replied), 0) AS positive_share,
  SUM(bounced) / NULLIF(SUM(sent), 0) AS bounce_rate,
  SUM(sent) / NULLIF(SUM(positive), 0) AS sends_per_positive
FROM campaign_daily
GROUP BY ALL;

-- The last 14 loaded days against the 14 before them, per campaign.
CREATE OR REPLACE VIEW campaign_change AS
WITH bounds AS (SELECT MAX(date) AS last_day FROM campaign_daily),
windows AS (
  SELECT
    d.*,
    CASE
      WHEN d.date > b.last_day - INTERVAL 14 DAY THEN 'recent'
      WHEN d.date > b.last_day - INTERVAL 28 DAY THEN 'prior'
    END AS period
  FROM campaign_daily AS d, bounds AS b
)
SELECT
  provider,
  workspace_id,
  campaign_ref,
  campaign,
  SUM(replied) FILTER (period = 'recent')
    / NULLIF(SUM(delivered) FILTER (period = 'recent'), 0) AS reply_rate_recent,
  SUM(replied) FILTER (period = 'prior')
    / NULLIF(SUM(delivered) FILTER (period = 'prior'), 0) AS reply_rate_prior,
  SUM(replied) FILTER (period = 'recent') AS replied_recent,
  SUM(replied) FILTER (period = 'prior') AS replied_prior,
  SUM(bounced) FILTER (period = 'recent')
    / NULLIF(SUM(sent) FILTER (period = 'recent'), 0) AS bounce_rate_recent,
  SUM(bounced) FILTER (period = 'prior')
    / NULLIF(SUM(sent) FILTER (period = 'prior'), 0) AS bounce_rate_prior
FROM windows
WHERE period IS NOT NULL
GROUP BY ALL;

-- One row per workspace per week (weeks start Monday).
CREATE OR REPLACE VIEW workspace_weekly AS
SELECT
  provider,
  workspace_id,
  DATE_TRUNC('week', date)::DATE AS week,
  SUM(sent) AS sent,
  SUM(replied) AS replied,
  SUM(positive) AS positive,
  SUM(bounced) AS bounced,
  SUM(replied) / NULLIF(SUM(delivered), 0) AS reply_rate
FROM campaign_daily
GROUP BY ALL;

-- Reply categories, as the tool labelled them.
CREATE OR REPLACE VIEW reply_mix AS
SELECT
  provider,
  workspace_id,
  COALESCE(category, 'uncategorized') AS category,
  COUNT(*) AS replies,
  COUNT(*) FILTER (unread) AS unread
FROM replies
GROUP BY ALL;

-- Each sender's volume and outcomes next to its warmup and status.
CREATE OR REPLACE VIEW sender_health AS
SELECT
  s.provider,
  s.workspace_id,
  s.ref AS sender_ref,
  COALESCE(s.address, s.name) AS sender,
  s.kind,
  s.status,
  s.warmup_score,
  SUM(m.sent) AS sent,
  SUM(m.replied) / NULLIF(SUM(m.delivered), 0) AS reply_rate,
  SUM(m.bounced) / NULLIF(SUM(m.sent), 0) AS bounce_rate
FROM senders AS s
LEFT JOIN daily_metrics AS m
  ON m.scope = 'sender' AND m.scope_ref = s.ref
GROUP BY ALL;
