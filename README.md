# Ikafe Purchase API

## Render deployment

Deploy this repository as a **Web Service** with the root directory left blank:

- **Build command:** `npm install`
- **Start command:** `npm start`
- **Health check path:** `/api/v1/health`

Set `NODE_ENV=production`, `JWT_SECRET`, `MONGO_URI`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`, and `INITIAL_ADMIN_PASSWORD` in the Render environment. Set `CLIENT_URL` to the exact HTTPS origin of the frontend Static Site. Render supplies `PORT`.

## Email delivery

For Render, use Resend's HTTPS API rather than Gmail SMTP when SMTP reports connection timeouts. In Resend, verify a domain and create an API key, then add these Render environment variables:

```text
RESEND_API_KEY=<your Resend API key>
EMAIL_FROM=Ikafe Haven <requests@your-verified-domain.com>
ADMIN_EMAIL=<notification recipient>
```

Use a sender address on the domain verified with Resend. Keep the API key private. The backend prefers Resend when `RESEND_API_KEY` is set; otherwise, it uses the configured SMTP credentials. Redeploy after changing environment variables. Failed email attempts remain in the notification outbox and can be retried after the provider is configured.
