# QA Screenshots — Autonomous Run Evidence

This directory accompanies `RUN_REPORT.md`. Screenshots are captured via Chrome
browser tool during each autonomous run. The Chrome MCP returns images inline to
the conversation transcript (jpeg, 1568×698) rather than writing files to disk, so
the raw frames live in the chat log. The `.md` file next to this one for each page
describes the observed state (header text, KPIs, column headers, button labels,
data values) so the visual check is reproducible from text alone.

Pages covered per run:

| File | Page | URL |
|------|------|-----|
| `dashboard.md` | Dashboard | `/` |
| `clients.md` | Clients | `/clients` |
| `transactions.md` | Transactions | `/transactions` |
| `hours.md` | Hours Log | `/hours` |
| `team.md` | Team | `/team` |
| `users.md` | Users | `/users` |
| `portal-hours.md` | Portal — Hours tab | `/portal?token=...` |
| `portal-bonus.md` | Portal — Bonus tab | `/portal?token=...#bonus` |
