-- Senders, worst bounce rate first. LinkedIn seats have no bounce count.
SELECT workspace_id, provider, sender, kind, status, warmup_score, sent,
  reply_rate, bounce_rate
FROM sender_health
ORDER BY bounce_rate DESC NULLS LAST, sent DESC;
