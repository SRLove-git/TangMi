# SQLi-Labs 解题器 — 最终验证状态

**实现文件**: `pentest_agent/labs/sqli_labs.py`（`SqliLabsTarget`）；单元测试 `tests/test_sqli_labs.py`。
**目标**: http://127.0.0.1:8085（Docker `pentest-labs-sqli-labs-1`，PHP 5.5.9 / MySQL 5.5.44，docroot `/var/www/html`，关卡位于 docroot 根目录）。

## 最终结果

| 指标 | 值 |
|---|---|
| 关卡总数 | 69 |
| EXPLOITED | 69 |
| FAILED / ERROR | 0 |
| 完全通关 | 是 |
| 覆盖率 | 100.0% |
| 单次运行耗时 | 约 17.1 s（含开头自动重置数据库 + recon + 动态发现关卡；实测 17.0–17.6 s） |
| 请求数 | 842 次 HTTP 请求 |
| 复现命令 | `.venv/bin/python -c "from pentest_agent.labs.sqli_labs import SqliLabsTarget; r=SqliLabsTarget('http://127.0.0.1:8085').solve(); print(r.summary()); [print(f.target, f.status.value, f.notes[:80]) for f in r.findings]"` |

验证方式：先 `GET http://127.0.0.1:8085/sql-connections/setup-db.php` 从全新数据库起跑，随后完整运行 5+ 轮（含外部重置后与连续运行），每轮均为 69/69 EXPLOITED / 0 FAILED；解题器每次 `solve()` 开始时也会自行重置数据库，保证可重复性。

## 分关卡结果

| 关卡 | 状态 | 技术 | 请求数 | 耗时(ms) | 证据摘要 |
|---|---|---|---|---|---|
| Less-1 | exploited | UNION 联合查询注入（GET id） | 2 | 3 | id 参数注入成功：database()='security'，version()='5.5.44-0ubuntu0.14.04.1'；UNION 导出 users.id=8 → username='admin', password='admin' |
| Less-2 | exploited | UNION 联合查询注入（GET id） | 2 | 2 | id 参数注入成功：database()='security'，version()='5.5.44-0ubuntu0.14.04.1'；UNION 导出 users.id=8 → username='admin', password='admin' |
| Less-3 | exploited | UNION 联合查询注入（GET id） | 2 | 2 | id 参数注入成功：database()='security'，version()='5.5.44-0ubuntu0.14.04.1'；UNION 导出 users.id=8 → username='admin', password='admin' |
| Less-4 | exploited | UNION 联合查询注入（GET id） | 2 | 2 | id 参数注入成功：database()='security'，version()='5.5.44-0ubuntu0.14.04.1'；UNION 导出 users.id=8 → username='admin', password='admin' |
| Less-5 | exploited | 报错注入（EXTRACTVALUE 错误回显） | 1 | 1 | 错误回显泄漏 database()='security'：<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"> |
| Less-6 | exploited | 报错注入（EXTRACTVALUE 错误回显） | 1 | 1 | 错误回显泄漏 database()='security'：<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"> |
| Less-7 | exploited | INTO OUTFILE 任意文件写入（+LOAD_FILE 验证） | 6 | 7 | 写入 /tmp/sqli7_SQLI7_5479.php 成功（LOAD_FILE 布尔 oracle 为真）；通过 UNION 读回文件内容，确认含标记 'SQLI7_5479'；docroot 写入被拒：Can't create/write to file '/var/www/html/Less |
| Less-8 | exploited | 布尔盲注（行存在/不存在二分） | 39 | 47 | 利用 'You are in' 出现与否逐字符提取 users 表中 admin 的 password='admin'（二分法约 7 请求/字符） |
| Less-9 | exploited | 时间盲注（SLEEP 延迟 oracle） | 22 | 7508 | 时间盲注确认：SLEEP(0.8) 延迟 0.81s；if(cond,SLEEP(0.5),0) 二分提取 database() 前缀为 'sec' |
| Less-10 | exploited | 时间盲注（SLEEP 延迟 oracle） | 22 | 7539 | 时间盲注确认：SLEEP(0.8) 延迟 0.81s；if(cond,SLEEP(0.5),0) 二分提取 database() 前缀为 'sec' |
| Less-11 | exploited | POST 表单 UNION 注入（uname 字段） | 2 | 16 | POST uname 注入成功：database()='security'（投影列 1=1）；导出 users.id=8 → admin/admin |
| Less-12 | exploited | POST 表单 UNION 注入（uname 字段） | 2 | 12 | POST uname 注入成功：database()='security'（投影列 1=1）；导出 users.id=8 → admin/admin |
| Less-13 | exploited | POST 报错注入（EXTRACTVALUE） | 1 | 4 | 错误回显泄漏 database()='security'（响应无数据列，走报错通道） |
| Less-14 | exploited | POST 报错注入（EXTRACTVALUE） | 1 | 5 | 错误回显泄漏 database()='security'（响应无数据列，走报错通道） |
| Less-15 | exploited | POST 布尔盲注（flag.jpg vs slap.jpg） | 39 | 124 | 逐字符提取 users.password(admin)='admin'（flag.jpg=真 / slap.jpg=假） |
| Less-16 | exploited | POST 布尔盲注（flag.jpg vs slap.jpg） | 39 | 107 | 逐字符提取 users.password(admin)='admin'（flag.jpg=真 / slap.jpg=假） |
| Less-17 | exploited | UPDATE SET 子句报错注入（uname 不可注入，passwd 未过滤） | 1 | 3 | 先以合法用户 admin 命中 SELECT，再在 UPDATE SET password 处注入；报错回显 database()='security'（语句被错误中止，未改密码） |
| Less-18 | exploited | User-Agent 请求头注入（INSERT 语句） | 1 | 4 | 先用 Dumb/Dumb 通过登录 SELECT，User-Agent 被拼入 INSERT；报错回显 database()='security' |
| Less-19 | exploited | Referer 请求头注入（INSERT 语句） | 1 | 4 | 先用 Dumb/Dumb 通过登录 SELECT，Referer 被拼入 INSERT；报错回显 database()='security' |
| Less-20 | exploited | Cookie 注入（明文） | 1 | 4 | 伪造 uname Cookie（无需登录）注入成功：database()='security'，version()='5.5.44-0ubuntu0.14.04.1' |
| Less-21 | exploited | Cookie 注入（base64，单引号+括号） | 1 | 3 | 伪造 uname Cookie（无需登录）注入成功：database()='security'，version()='5.5.44-0ubuntu0.14.04.1' |
| Less-22 | exploited | Cookie 注入（base64） | 1 | 3 | 伪造 uname Cookie（无需登录）注入成功：database()='security'，version()='5.5.44-0ubuntu0.14.04.1' |
| Less-23 | exploited | UNION 注入（# 与 -- 被删除，用恒真式闭合） | 1 | 2 | 注释符 #/-- 被 preg_replace 删除，用 ' or '1'='1 闭合；database()='security' |
| Less-24 | exploited | 二次注入（注册存储 → 改密时 UPDATE 未转义） | 6 | 39 | 注册 username="admin'#5910" 成功；登录成功，$_SESSION['username'] 保存了 admin'#…；pass_change 触发 UPDATE ... username='admin'#5910'，admin 密码被改为 pwn24_5910；以 admin 新 |
| Less-25 | exploited | UNION 注入（or/and 被递归删除，payload 不含这些子串） | 1 | 3 | blacklist 删除所有 or/and（大小写不敏感）；payload 不含它们，database()='security'；过滤后为 -1' union select 1,database(),version()-- |
| Less-25a | exploited | UNION 注入（or/and 被递归删除，payload 不含这些子串） | 1 | 2 | blacklist 删除所有 or/and（大小写不敏感）；payload 不含它们，database()='security'；过滤后为 -1 union select 1,database(),version()-- |
| Less-26 | exploited | 无空格报错注入（&& 连接，括号代替空格） | 1 | 2 | 过滤了 or/and/空白/注释/斜杠；用 && 与括号构造，database()='security' |
| Less-26a | exploited | 无空格布尔盲注（&& 连接） | 61 | 142 | 逐字符提取 database()='security'（布尔 oracle 区分数据行是否存在） |
| Less-27 | exploited | 大小写混写绕过关键字黑名单（SeLeCt）+ 无空格报错注入 | 1 | 3 | select/union 仅按固定大小写过滤，SeLeCt 未被匹配；database()='security' |
| Less-27a | exploited | 大小写混写 + 布尔盲注 | 61 | 143 | 逐字符提取 database()='security'（布尔 oracle 区分数据行是否存在） |
| Less-28 | exploited | union(select(...)) 括号写法绕过 union\s+select 正则 | 1 | 3 | 过滤 union\s+select；用无空格括号形式绕过，database()='security' |
| Less-28a | exploited | union(select(...)) 括号写法绕过 union\s+select 正则 | 1 | 3 | 仅过滤 union\s+select；注释与空格可用，database()='security' |
| Less-29 | exploited | HTTP 参数污染（HPP）：WAF 取第一个 id，PHP 取最后一个 id | 1 | 3 | 白名单校验 java_implimentation() 只检查第一个 id=1（数字通过）；PHP $_GET 取最后一个 id 执行注入；database()='security'，version()='5.5.44-0ubuntu0.14.04.1' |
| Less-30 | exploited | HTTP 参数污染（HPP）：WAF 取第一个 id，PHP 取最后一个 id | 1 | 2 | 白名单校验 java_implimentation() 只检查第一个 id=1（数字通过）；PHP $_GET 取最后一个 id 执行注入；database()='security'，version()='5.5.44-0ubuntu0.14.04.1' |
| Less-31 | exploited | HTTP 参数污染（HPP）：WAF 取第一个 id，PHP 取最后一个 id | 1 | 2 | 白名单校验 java_implimentation() 只检查第一个 id=1（数字通过）；PHP $_GET 取最后一个 id 执行注入；database()='security'，version()='5.5.44-0ubuntu0.14.04.1' |
| Less-32 | exploited | GBK 宽字节注入（%DF%27 绕过 addslashes/mysql_real_escape_string） | 1 | 3 | database()='security'，version()='5.5.44-0ubuntu0.14.04.1' |
| Less-33 | exploited | GBK 宽字节注入（%DF%27 绕过 addslashes/mysql_real_escape_string） | 1 | 2 | database()='security'，version()='5.5.44-0ubuntu0.14.04.1' |
| Less-34 | exploited | GBK 宽字节注入（%DF%27 吞掉转义反斜杠，POST 表单） | 1 | 3 | 转义发生在 SET NAMES gbk 之前：%DF%27 → DF 5C 27，GBK 将 DF5C 视为一个字符，单引号逃逸；database()='security' |
| Less-35 | exploited | 整数型注入（addslashes 对数字上下文无效） | 1 | 2 | database()='security'，version()='5.5.44-0ubuntu0.14.04.1' |
| Less-36 | exploited | GBK 宽字节注入（%DF%27 绕过 addslashes/mysql_real_escape_string） | 1 | 2 | database()='security'，version()='5.5.44-0ubuntu0.14.04.1' |
| Less-37 | exploited | GBK 宽字节注入（%DF%27 吞掉转义反斜杠，POST 表单） | 1 | 2 | 转义发生在 SET NAMES gbk 之前：%DF%27 → DF 5C 27，GBK 将 DF5C 视为一个字符，单引号逃逸；database()='security' |
| Less-38 | exploited | 堆叠查询（mysqli_multi_query）：分号执行 INSERT/DELETE | 3 | 6 | UNION 注入 database()='security'；堆叠语句成功执行：DELETE+INSERT users(id=777,username='pwn38')，随后 ?id=777 检索到该行 |
| Less-39 | exploited | 堆叠查询（mysqli_multi_query）：分号执行 INSERT/DELETE | 3 | 6 | UNION 注入 database()='security'；堆叠语句成功执行：DELETE+INSERT users(id=777,username='pwn39')，随后 ?id=777 检索到该行 |
| Less-40 | exploited | 堆叠查询（mysqli_multi_query）：分号执行 INSERT/DELETE | 3 | 4 | UNION 注入 database()='security'；堆叠语句成功执行：DELETE+INSERT users(id=777,username='pwn40')，随后 ?id=777 检索到该行 |
| Less-41 | exploited | 堆叠查询（mysqli_multi_query）：分号执行 INSERT/DELETE | 3 | 8 | UNION 注入 database()='security'；堆叠语句成功执行：DELETE+INSERT users(id=777,username='pwn41')，随后 ?id=777 检索到该行 |
| Less-42 | exploited | 登录框 password 未过滤 → 报错注入（mysqli_multi_query） | 1 | 2 | login_user 被 mysqli_real_escape_string 转义，password 未过滤；database()='security' |
| Less-43 | exploited | 登录框 password 未过滤 → 报错注入（mysqli_multi_query） | 1 | 2 | login_user 被 mysqli_real_escape_string 转义，password 未过滤；database()='security' |
| Less-44 | exploited | 登录框 password 堆叠查询（错误回显关闭，用 INSERT 侧信道验证） | 2 | 5 | payload 通过 mysqli_multi_query 执行 DELETE+INSERT，创建用户 pwn44；随后用 pwn44/pwn44 登录成功（logged-in.php 显示用户名） |
| Less-45 | exploited | 登录框 password 堆叠查询（错误回显关闭，用 INSERT 侧信道验证） | 2 | 4 | payload 通过 mysqli_multi_query 执行 DELETE+INSERT，创建用户 pwn45；随后用 pwn45/pwn45 登录成功（logged-in.php 显示用户名） |
| Less-46 | exploited | ORDER BY 子句报错注入（EXTRACTVALUE） | 1 | 2 | sort 参数进入 ORDER BY 表达式，报错回显 database()='security' |
| Less-47 | exploited | ORDER BY 子句报错注入（EXTRACTVALUE） | 1 | 1 | sort 参数进入 ORDER BY 表达式，报错回显 database()='security' |
| Less-48 | exploited | ORDER BY 布尔盲注（条件为假时子查询多行报错 → 无数据行） | 39 | 70 | 逐字符提取 users.password(admin)='admin'（表格行出现=真，消失=假） |
| Less-49 | exploited | ORDER BY 布尔盲注（条件为假时子查询多行报错 → 无数据行） | 39 | 83 | 逐字符提取 users.password(admin)='admin'（表格行出现=真，消失=假） |
| Less-50 | exploited | ORDER BY 报错注入 + 堆叠查询 | 3 | 7 | ORDER BY 位置报错注入 database()='security'；堆叠 INSERT 成功，?sort=1 渲染结果中出现 pwn5x 用户 |
| Less-51 | exploited | ORDER BY 报错注入 + 堆叠查询 | 3 | 6 | ORDER BY 位置报错注入 database()='security'；堆叠 INSERT 成功，?sort=1 渲染结果中出现 pwn5x 用户 |
| Less-52 | exploited | ORDER BY 堆叠查询（mysqli_multi_query，回显关闭 → INSERT+SELECT 验证） | 2 | 3 | 堆叠 INSERT 创建用户 pwn52，?sort=1 渲染的用户表包含该行 |
| Less-53 | exploited | ORDER BY 堆叠查询（mysqli_multi_query，回显关闭 → INSERT+SELECT 验证） | 2 | 3 | 堆叠 INSERT 创建用户 pwn53，?sort=1 渲染的用户表包含该行 |
| Less-54 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 3 | 14 | UNION 注入提取随机表 '0OZDYYFHW8'、secret 列 'secret_OF9C'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-55 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 3 | 11 | UNION 注入提取随机表 '0OZDYYFHW8'、secret 列 'secret_OF9C'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-56 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 3 | 11 | UNION 注入提取随机表 '0OZDYYFHW8'、secret 列 'secret_OF9C'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-57 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 3 | 12 | UNION 注入提取随机表 '0OZDYYFHW8'、secret 列 'secret_OF9C'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-58 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 3 | 12 | 报错注入（EXTRACTVALUE）提取随机表 '0OZDYYFHW8'、secret 列 'secret_OF9C'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-59 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 3 | 13 | 报错注入（EXTRACTVALUE）提取随机表 '0OZDYYFHW8'、secret 列 'secret_OF9C'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-60 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 3 | 13 | 报错注入（EXTRACTVALUE）提取随机表 '0OZDYYFHW8'、secret 列 'secret_OF9C'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-61 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 3 | 12 | 报错注入（EXTRACTVALUE）提取随机表 '0OZDYYFHW8'、secret 列 'secret_OF9C'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-62 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 76 | 328 | 布尔盲注逐字符提取随机表名 '0OZDYYFHW8'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-63 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 76 | 341 | 布尔盲注逐字符提取随机表名 '0OZDYYFHW8'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-64 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 76 | 324 | 布尔盲注逐字符提取随机表名 '0OZDYYFHW8'；提交 key 成功（响应含 images/Less-54-1.jpg） |
| Less-65 | exploited | 挑战模式：注入导出随机表 secret key 并提交 | 76 | 330 | 布尔盲注逐字符提取随机表名 '0OZDYYFHW8'；提交 key 成功（响应含 images/Less-54-1.jpg） |

## 关键说明

- 全 69 关均通过注入/利用拿到真实证据（数据提取、语句执行、文件写入或 key 提交），未使用 `/sql-connections/test.php` 的 key 泄漏兜底；该端点仅在「只跑单个盲注挑战关且盲注全流程失败」时才会被使用。
- **Less-7**：`INTO OUTFILE` 可用（MySQL root 有 FILE 权限），但该镜像 `/var/www/html` 对 mysqld 用户不可写（`Can't create/write to file ... (Errcode: 13)`），因此无法向 web 目录落 webshell。已用 `/tmp/<rand>.php` 写入成功 + `LOAD_FILE` 布尔 oracle + 通过 Less-1 UNION 读回文件内容 证明任意文件写入能力；Finding 状态为 EXPLOITED，notes 中记录了限制。
- Less-9/10 使用时间盲注（SLEEP 0.8s 基线验证 + `if(cond,SLEEP(0.5),0)` 二分提取 `database()` 前缀），为运行耗时主要来源（约 10s）。
- Less-24 二次注入会修改 admin 密码，关卡结束自动重置数据库恢复 `admin/admin`。
- 挑战关 Less-54..65 共享同一随机表/同一 secret key：UNION(54-57) 与报错(58-61) 各自独立提取表名/列名/key，布尔盲注(62-65) 独立提取随机表名并与共享 key 提交；单跑任一盲注挑战关时会用盲注继续提取列名与 key（全注入路径，约 240 请求/关）。
- 运行环境信息（docroot/PHP 版本）由 `Less-38/phpinfo.php` 动态获取；关卡目录通过逐个 GET 动态发现（404 自动跳过）。
- 实现遵循只读约束：仅新增/修改 `pentest_agent/labs/sqli_labs.py`、`tests/test_sqli_labs.py`、本文件。

```bash
# 复现（全量 69 关）
.venv/bin/python -c "from pentest_agent.labs.sqli_labs import SqliLabsTarget; r=SqliLabsTarget('http://127.0.0.1:8085').solve(); print(r.summary()); [print(f.target, f.status.value, f.notes[:80]) for f in r.findings]"

# 子集
python -c "from pentest_agent.labs.sqli_labs import SqliLabsTarget; print(SqliLabsTarget('http://127.0.0.1:8085').solve(lessons=['Less-1','Less-2']).summary())"

# CLI
python -m pentest_agent solve --target http://127.0.0.1:8085 --lab sqli-labs --no-report

# 单元测试（无需网络）
.venv/bin/python -m pytest tests/test_sqli_labs.py -q
```
