# Warehouse Management System (React + Vite, localStorage)

No database: all data is stored in the browser's localStorage.

## Run locally (Node 18+)
    npm install
    npm run dev        # http://localhost:5173

## Tabs
- **Operations** - scan (IN/OUT), register products, waste / recount / cost / reorder level, search, full operation history
- **Dashboard** - KPIs and charts: inventory value over time, inbound vs outbound, value by category,
  top products, waste by product, operations by type, plus low-stock and idle-stock tables
- **Assistant** - chatbot that answers questions from your data
  - Built-in mode (default): works offline, free, no data leaves the browser
  - AI mode (optional): a Vercel function (`api/chat.js`) sends a data snapshot to Claude for free-form questions

## Deploy free on Vercel
1. Push this folder to GitHub, then Vercel > Add New > Project > import it. Vite is detected automatically.
2. (Optional, for AI mode) Project > Settings > Environment Variables:
   `ANTHROPIC_API_KEY` (required for AI mode), `CHAT_PASSCODE` (recommended), `ANTHROPIC_MODEL` (optional).
   Redeploy after adding them.

AI mode is a public endpoint that spends your API credits: set `CHAT_PASSCODE` and a spending limit in your Anthropic console.
To test AI mode locally use `npx vercel dev` instead of `npm run dev`.

## Notes
- Data is per browser/device. Use Export backup / Import backup to move it.
- Existing saved data keeps working; use "Reset demo data" to load the richer sample data (needed to see charts populated).
# wms-app
