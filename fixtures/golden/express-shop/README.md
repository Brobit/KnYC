# express-shop (golden fixture)

A small shop REST API, used to test the KnYC pipeline. Size: medium (~850 lines of source,
8 modules), **with tests** (Vitest + supertest).

## Architecture

```
src/server.ts                 entry point
src/app.ts                    createApp(): middlewares, routers, error handling
src/container.ts              builds and wires every service (manual dependency injection)
src/config.ts                 PORT, JWT_SECRET, JWT_EXPIRES_IN, LOG_REQUESTS

src/shared/                   errors, Zod validation helper, pagination, request logger, id generators
src/auth/                     password hashing (scrypt), JWT TokenService, requireAuth / requireRole
src/users/                    User model, repository, service (register / login / profile), /auth and /me routes
src/products/                 Product model, schemas, repository, service (search, sort, stock), /products routes
src/cart/                     CartService (per-user cart), /cart routes
src/payments/                 PaymentProvider interface + MockPaymentProvider
src/orders/                   Order model + status transitions, repository, service (checkout, cancel, ship), /orders routes
```

Dependencies flow one way: `shared` → `auth` / `users` → `products` → `cart` → `payments` → `orders`
→ `container` → `app` → `server`.

Business rules worth noticing:

- The first registered user becomes `admin`.
- Checkout reserves stock first, then charges; a failed charge puts the stock back (402).
- Orders go `paid → shipped → delivered`, or `paid → cancelled` (refund + stock back).
- Customers can only see and cancel their own orders; shipping updates are admin-only.

Data is kept in memory (repositories), so no database is needed.

## API

| Method | Path | Auth |
|---|---|---|
| GET | /health | — |
| POST | /auth/register, /auth/login | — |
| GET | /me | user |
| GET | /products?q=&category=&sort=&page=&pageSize= | — |
| GET | /products/:id | — |
| POST, PATCH | /products, /products/:id | admin |
| GET, DELETE | /cart | user |
| POST | /cart/items | user |
| PUT | /cart/items/:productId | user |
| POST, GET | /orders | user |
| GET | /orders/:id | owner or admin |
| PATCH | /orders/:id/status | owner (cancel) or admin |

Test card tokens for the mock payment provider: `tok_ok`, `tok_declined`.

## Commands

```bash
npm install
npm run build
npm test
```
