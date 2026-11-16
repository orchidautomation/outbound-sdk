-- Every campaign, with the last 14 days set against the 14 before them.
SELECT
  s.workspace_id,
  s.provider,
  s.campaign,
  s.channel,
  s.sent,
  s.positive,
  s.reply_rate,
  s.bounce_rate,
  s.sends_per_positive,
  c.replied_prior,
  c.replied_recent,
  c.reply_rate_prior,
  c.reply_rate_recent,
  c.bounce_rate_prior,
  c.bounce_rate_recent
FROM campaign_summary AS s
JOIN campaign_change AS c USING (campaign_ref)
ORDER BY s.workspace_id, s.sent DESC;
