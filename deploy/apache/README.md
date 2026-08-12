# Fixing the webhooks: routing `/api` (and root POSTs) to the Node API

## What is wrong

The CRM website and the CRM's API share one address,
`https://crm.test.marketfarmer.in`.

Apache is currently answering **every** address with the React website,
including the addresses that belong to the API. So when Meta delivers a lead
to `https://crm.test.marketfarmer.in/api/meta/webhook`, it receives a web page
instead of the API.

Meta reads that as **"delivered successfully"**, marks the lead as sent, and
never tries again. The lead is lost without any error appearing anywhere. That
is why *Recent imports* in the CRM is empty.

The same thing happens to WhatsApp: Smartping registered the bare domain
`https://crm.test.marketfarmer.in/` as its webhook URL, so incoming WhatsApp
messages arrive as `POST /`, get the React page back with HTTP 200, and are
silently dropped. That is why the WhatsApp inbox never shows replies.

Nothing is wrong with the CRM's code. The webhooks work correctly and have
been tested. Only the routing in front of them is wrong.

## What the fix does

It tells Apache two things:

1. anything starting with `/api/` goes to the CRM's API on the server;
2. a `POST` to the bare domain `/` is forwarded to the API's Smartping
   webhook endpoint (`/api/webhooks/smartping/webhook`).

Everything else keeps going to the website, exactly as now — opening
`https://crm.test.marketfarmer.in/` in a browser (a `GET`) still shows the CRM.

If Smartping's dashboard allows editing the webhook URL, the cleaner long-term
setup is to point it directly at
`https://crm.test.marketfarmer.in/api/webhooks/smartping/webhook` — the root
forward then simply becomes a harmless safety net.

## How to run it

1. Copy `install-api-proxy.sh` onto the server (any folder is fine).
2. Connect to the server and run:

   ```bash
   sudo bash install-api-proxy.sh
   ```

The script prints what it is doing at each step. It:

- checks the API is actually running, and stops with instructions if it is not
- turns on the Apache features needed (`proxy`, `proxy_http`, `rewrite`)
- **makes a dated backup of the configuration file before changing it**
- adds the routing rule
- makes sure the website's catch-all rule no longer swallows `/api`
- runs `apache2ctl configtest` and **puts the backup back if the test fails**
- reloads Apache and checks both the API and the website still answer

It is safe to run twice. It does not touch SSL, other websites on the server,
the database, or the CRM's code.

## If something goes wrong

The script prints the backup location. To undo everything:

```bash
sudo cp /etc/apache2/sites-enabled/<your-file>.backup-<date> /etc/apache2/sites-enabled/<your-file>
sudo systemctl reload apache2
```

## How to confirm it worked

```bash
curl -i https://crm.test.marketfarmer.in/api/meta/webhook
```

- **Correct:** `HTTP/1.1 403 Forbidden` — the API is refusing a webhook call
  that has no verification details, which is exactly what it should do.
- **Still broken:** `HTTP/1.1 200 OK` with `Content-Type: text/html`.

For the Smartping webhook:

```bash
curl -i -X POST -H 'Content-Type: application/json' -d '{}' https://crm.test.marketfarmer.in/
```

- **Correct:** `HTTP/1.1 400 Bad Request` with a JSON body saying
  `messageId and mobile number are required` — the API received the POST and
  rejected the empty test payload, which is exactly what it should do.
- **Still broken:** `HTTP/1.1 200 OK` with `Content-Type: text/html`.
