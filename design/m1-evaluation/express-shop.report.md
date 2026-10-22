# express-shop: backend-standard

**20 steps** in 5 milestones · **20/20 steps (100%) with a check proven red → green** · 62 proven checks
Reference timeline: 20/20 steps build on their own · last step = original code: yes

## Foundations: shared utilities and domain models

Build the cross-cutting utilities (errors, config, ids, validation, logging, pagination) and the plain domain models/types used by every feature module, with no HTTP surface yet.

| Step | Checks | |
|---|---|---|
| ✅ **s01** Config and error handling<br>loadConfig() returns a typed config object with sane defaults, and each error factory (badRequest, unauthorized, forbidden, notFound, conflict) produces an HttpError with the right status code | `loadConfig returns sane defaults`<br>`error factories produce HttpError with correct status codes`<br>`errorHandler and notFoundHandler produce correct HTTP responses` |  |
| ✅ **s02** ID generation and input validation<br>uuid() and sequentialIds() each produce unique, predictable ids, and validate() turns a Zod schema failure into a 400 badRequest with field-level details | `uuid() returns unique RFC4122 UUIDs`<br>`sequentialIds(prefix) yields prefix-1, prefix-2, ... per generator`<br>`validate() parses valid input, throws 400 with details otherwise` |  |
| ✅ **s03** Request logging and pagination helpers<br>requestLogger records method/url/status/duration for a request, and paginate() slices an array into the correct page with accurate total counts | `requestLogger logs method/url/status/duration`<br>`paginate slices items and reports correct totals`<br>`paginationSchema coerces strings and applies defaults` |  |
| ✅ **s04** User and product domain models<br>toPublicUser() strips passwordHash from a User, returning an object that matches PublicUser's shape | `toPublicUser strips passwordHash` |  |
| ✅ **s05** Order model and mock payment provider<br>the order status transitions map allows paid→shipped→delivered and rejects invalid jumps, and MockPaymentProvider.charge succeeds for tok_ok and fails for tok_declined | `order transitions allow paid->shipped->delivered and reject invalid jumps`<br>`MockPaymentProvider.charge succeeds for tok_ok and fails for tok_declined` |  |

## Authentication and user accounts

Add password hashing, JWT issuing/verification, the users store, auth middleware, and the registration/login/profile HTTP endpoints.

| Step | Checks | |
|---|---|---|
| ✅ **s06** Password hashing and JWT tokens<br>hashPassword/verifyPassword round-trip correctly for a matching password and reject a wrong one; TokenService.sign produces a token that TokenService.verify decodes back to the same payload | `hashPassword/verifyPassword round-trip and reject wrong password`<br>`TokenService sign/verify round-trips payload` |  |
| ✅ **s07** Users repository<br>UsersRepository stores a user and retrieves it by id and by case-insensitive email, with count() reflecting how many users exist | `save/findById/findByEmail/count work` |  |
| ✅ **s08** Auth middleware<br>requireAuth attaches the decoded user to the request for a valid bearer token and rejects with 401 otherwise, requireRole rejects a mismatched role with 403 | `requireAuth attaches decoded user for a valid bearer token`<br>`requireAuth rejects missing/invalid token with 401`<br>`requireRole rejects a mismatched role with 403` |  |
| ✅ **s09** Users service: register, login, profile<br>register() creates the first user as admin and later users as customer with a hashed password and token, login() returns a token only for correct credentials, getProfile() returns the public user | `second registered user becomes customer; duplicate email conflicts`<br>`login works for correct creds and fails otherwise; getProfile` |  |
| ✅ **s10** Auth and profile routes<br>POST /register and POST /login return a token and user, and GET /me returns the authenticated user's profile when a valid bearer token is sent | `POST /register returns 201 with token and public user`<br>`POST /login succeeds with correct password and rejects wrong password`<br>`GET /me returns profile with valid token and 401 without it` |  |

## Product catalog

Store products, validate catalog requests, implement listing/filtering/sorting and stock reservation, then expose it all over HTTP.

| Step | Checks | |
|---|---|---|
| ✅ **s11** Products repository and request schemas<br>ProductsRepository saves and retrieves products by id, and createProductSchema/updateProductSchema/listProductsSchema accept valid payloads and reject malformed ones | `ProductsRepository saves and retrieves products by id`<br>`createProductSchema validates payload and rejects bad input`<br>`updateProductSchema partial fields; listProductsSchema defaults and sort` |  |
| ✅ **s12** Products service: list, CRUD, stock<br>list() filters by category/search, sorts by name or price, and paginates results; reserveStock() reduces stock for every order line atomically or fails without side effects if any line is short | `list() filters by category/search and sorts by price desc`<br>`list() paginates results correctly`<br>`reserveStock is atomic across lines, fails without side effects` |  |
| ✅ **s13** Product routes<br>GET /products lists and filters products for any caller, and POST /products creates a product only when called by an admin token | `GET /products lists only active products for anonymous callers`<br>`POST /products requires auth, then admin role, then creates the product`<br>`GET /products filters by category` |  |

## Shopping cart

Give each authenticated user an in-memory cart with live product pricing, then expose it over HTTP.

| Step | Checks | |
|---|---|---|
| ✅ **s14** Cart service<br>CartService.add adds an active product with quantity 1, get() returns enriched lines with a correct total based on current product prices, and setQuantity(0) removes the line | `CartService.add adds active product with quantity 1 and computes total`<br>`CartService.get() reflects current product price, not price at add time`<br>`CartService.setQuantity(0) removes the line from the cart` |  |
| ✅ **s15** Cart routes<br>GET /cart, POST /cart/items, and PUT /cart/items/:id respond correctly for an authenticated user and reject unauthenticated requests | `Cart routes require auth and support get/add/update` |  |

## Orders, payments, and the assembled app

Process checkout with payment and stock reservation, manage order status transitions, then wire every module together into a running server.

| Step | Checks | |
|---|---|---|
| ✅ **s16** Orders repository<br>OrdersRepository saves an order and retrieves it by id, and findByUser returns a user's orders sorted newest first | `save stores order, findById retrieves it`<br>`findByUser filters by user and sorts newest first`<br>`all returns every saved order` |  |
| ✅ **s17** Orders service: checkout and status transitions<br>checkout() reserves stock, charges the given card token, saves a paid order, and clears the cart; a declined card leaves stock untouched, and changeStatus() only allows transitions permitted by the status map, refunding on cancellation | `checkout() reserves stock, charges card, saves paid order, clears cart`<br>`checkout() with declined card leaves stock untouched and cart intact`<br>`changeStatus() blocks disallowed transitions and refunds on cancellation` |  |
| ✅ **s18** Order routes<br>POST /orders/checkout creates an order for the authenticated user, GET /orders/:id enforces owner-or-admin access, and PATCH /orders/:id/status updates status for valid transitions | `POST /orders requires auth (401 without token)`<br>`POST /orders with a valid token creates an order for that user`<br>`GET /orders/:id forbids non-owner, non-admin access` |  |
| ✅ **s19** Service container and app factory<br>createApp() builds a working Express app with every router mounted, logging, and error handling, wiring real services through createContainer() (with override support for tests) | `/auth and /me logs in and returns the profile`<br>`/auth and /me registers the first user as admin and the next as customer`<br>`/auth and /me rejects duplicate emails and short passwords`<br>`/auth and /me rejects wrong passwords and missing tokens`<br>`TokenService round-trips a payload and rejects tampered tokens`<br>`password hashing verifies the right password only`<br>`/cart adds items, computes totals and removes a line with quantity 0`<br>`/orders checks out the cart, decrements stock and empties the cart`<br>`/orders hides other users' orders`<br>`/orders lets a customer cancel a paid order and refunds it`<br>`/orders only lets admins ship, and enforces the status flow`<br>`/orders refuses an empty cart, too little stock and declined cards`<br>`/products lets only admins create and update products`<br>`/products lists, searches and sorts active products`<br>`/products validates input`<br>`paginate slices items and computes totals` |  |
| ✅ **s20** Server entry point<br>starting the process loads config and boots the app, and the server accepts real HTTP requests on the configured port | `server.js boots app and listens on configured PORT` |  |

## Analysis

| Stage | Time | AI calls |
|---|---|---|
| Scan and code graph | 0 s | — |
| Summaries | 236 s | 8 |
| Learning path | 87 s | 1 |
| Reference timeline | 99 s | — |
| Checks | 913 s | 19 |
| **Total** | **1335 s** | **28** |

Models: summaries `haiku`, planning `sonnet`, checks `sonnet`.
Tokens: 335867 in, 67427 out · provider estimate ≈ $1.16
