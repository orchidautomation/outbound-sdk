-- What replies were, by the tool's own label.
SELECT workspace_id, provider, category, replies, unread
FROM reply_mix
ORDER BY workspace_id, category;
