# Jodo payment links

The settings screen implements Jodo's documented Payment Link APIs:

- Create: `POST /api/v1/integrations/pay/payment_links`
- Get: `GET /api/v1/integrations/pay/payment_links/:order_id`
- Cancel: `DELETE /api/v1/integrations/pay/payment_links/:order_id`

Jodo documentation:

- https://docs.jodo.in/pay/api/create-payment-link/
- https://docs.jodo.in/pay/api/get-payment-link/
- https://docs.jodo.in/pay/api/cancel-payment-link/

## Setup

1. Apply `database/mysql/054_jodo_payment_links.sql`.
2. Configure and enable Jodo credentials on each branch in Business Units.
3. Open **Settings → Payment Links**.
4. Select Production or UAT. Jodo provides separate credentials for each environment, so the selected branch credentials must match the environment.

All Jodo API calls run on the backend using Basic Auth. Credentials are never sent to the browser. Created links retain the Jodo `order_id`, hosted URL, payer information, component breakdown, metadata, current status, transaction and settlement references, and optional CRM lead association.

Status is refreshed server-side before financial decisions. Paid, settled, and already-cancelled links cannot be cancelled from CRM.
