# NGA 数据解析踩坑总结

> 本文档汇总了开发 dsh-nga-sidebar 过程中实测遇到的 NGA（bbs.nga.cn）数据接口/页面解析问题与对应解法。
> 接口契约参考：[AgMonk/nga-api-doc](https://github.com/AgMonk/nga-api-doc)（社区维护）。

## 1. 认证与反爬

| # | 坑 | 现象 | 解法 |
|---|---|---|---|
| 1.1 | JSON 接口要求登录 | `thread.php?...&__output=11` 匿名返回 **HTTP 403 `{"error":["1:未登录"]}`** | 请求带登录 Cookie；UA 用文档推荐的 `NGA_WP_JW` |
| 1.2 | Cookie 名必须驼峰 | 传 `nga_passport_uid`（下划线）部分板块返回未登录 | 必须是 `ngaPassportUid` / `ngaPassportCid`（实测这两个就够，其他都是辅助） |
| 1.3 | HTML 匿名被 JS 挑战拦截 | 首页/板块页返回 **ERROR 15** 页面，内嵌 JS 设置 `guestJs=<时间戳>_<随机串>` Cookie 后 `location.replace(路径+?rand=xxx)` | 服务端复刻：提取页面里的 `guestJs` 值 → 带上重试（带 `rand` 参数）；但若 WAF 指纹校验则模拟无效（本项目因此改走 JSON+登录 Cookie） |
| 1.4 | 部分板块权限门槛 | 返回 `{"error":["16:帐号权限不足"]}` 或未登录 | 换可读板块；插件把原因透传给 UI 显示 |

## 2. JSON 解析

| # | 坑 | 现象 | 解法 |
|---|---|---|---|
| 2.1 | 响应是 JS 包装 | 以 `window.xxx=` 等前缀开头，不是纯 JSON | 截取第一个 `{` 之后的内容再 parse |
| 2.2 | 字符串内原始 `\t` | `alterinfo` 字段含字面制表符 → `JSON.parse` 报错 | **解析前**把 `\t` 替换为私用区字符（NGA 的 JSON 是压缩格式，制表符只可能出现在字符串内，安全） |
| 2.3 | JSON 可能被截断 | `read.php` 的 JSON 响应偶尔在中间断掉（文件尾部停在 `\u` 转义中间），parse 必失败 | 失败时降级到 `read.php?tid=&noBBCode` 的 **HTML 页面**解析（见第 3 节）；用户名可从截断 JSON 前段的 `__U` 抢救 |
| 2.4 | "补引号"正则不可滥用 | 为修"字段名无引号"写的正则不是字符串感知的，会误伤正文里的 BBCode（如 `[s:ac:汗]` 中的 ` s:` 被改成 ` "s":`） | **只在合法 JSON parse 失败后才**应用修补正则，正常响应直接 parse |
| 2.5 | 主楼在回复数组里 | 主楼是 `__R` 第一条（`pid:0`/`lou:0`），`__T` 通常不带 `content` | 遍历 `__R` 即可；`lou<=0` 视为主楼 |
| 2.6 | 无 `__T` 字段的帖子 | 部分帖子响应没有 `__T` 对象 | 标题从 `__R[0].subject` 兜底 |
| 2.7 | 回复只有 authorid | `__R` 条目无 `author` 字段 | 用 `__U`（uid→username 映射表）解析名字 |

## 3. HTML 解析（noBBCode 兜底）

| # | 坑 | 现象 | 解法 |
|---|---|---|---|
| 3.1 | HTML 是 GBK 编码 | `res.text()`（UTF-8）解码中文乱码 | `arrayBuffer()` + `new TextDecoder('gbk')`（Node 需 full-icu，默认有） |
| 3.2 | 帖子块不能按 `</tr>` 配对 | 正文可含嵌套 `<table>`，懒匹配在嵌套 `</tr>` 处提前闭合 → 只有主楼被解析 | 按 `<!--postliststart-->`/`<!--postlistend-->` 圈定区域，再按 `<tr id='post1strowN'>` **标记位置切片** |
| 3.3 | 楼层/pid 标记 | 每楼有 `<a name='lN'>`（楼层）、`postauthorN` 链接里带 `uid`、`postcontentN` 是正文、`postsubjectN` 是标题 | 用这些 id 提取；pid 不存在时用 `h<序号>` 占位 |
| 3.4 | 相对图片路径 | 正文 `[img]./mon_xxx.jpg[/img]` 或 `<img src='./mon_...'>` 是相对路径 | 补全为 `https://img.nga.cn/attachments/<path>`（`__GLOBAL._ATTACH_BASE_VIEW` 指定） |
| 3.6 | 主楼 `<p>`、回复 `<span>` | 主楼正文是 `<p id='postcontent0'>`，回复楼正文是 `<span id='postcontent1'>` | 正文匹配必须兼容 `<p\|span>`（`</p\|span>` 闭合） |
| 3.7 | 纯图片楼正文残留路径 | `[img]./mon_x.jpg[/img]` 剥标签后路径文字留在正文里 | 清洗时先把整个 `[img]...[\/img]` 块删掉（图片单独渲染） |
| 3.5 | 标题/正文需反转义 | 含 `&#12304;` 等数字实体 | 统一 decodeEntities（`&#\d+;` / `&#x..;` / 常用命名字符实体） |

## 4. 其他

| # | 坑 | 现象 | 解法 |
|---|---|---|---|
| 4.1 | 板块名 | 板块真名在 `thread.php` JSON 的 `__F.name` | 列表加载后用它替换占位名 |
| 4.2 | 分页字段 | `__PAGE`（当前页）、`__ROWS`（总楼层）、`__R__ROWS_PAGE`（每页 20） | 计算 totalPages = ceil(ROWS / ROWS_PAGE)；跳楼层 = floor(楼层/20)+1 |
| 4.3 | 官方板块列表静态文件 | `https://img4.nga.178.com/proxy/cache_attach/bbs_index_data.js`（首页版面入口） | 该 CDN 域名可能连不通（实测 000），需 HTML/内置回退 |
| 4.4 | 多域名 | bbs.nga.cn / ngabbs.com / nga.178.com 功能相同 | 主站不通时可换备用域名 |

## 建议的解析安全顺序（JSON 优先、HTML 兜底）

```
1. 原始 body（剥包装前缀）→ 制表符替换 → JSON.parse
2. 失败 → 补引号正则 → 再试（最后手段）
3. 仍空 → noBBCode HTML（GBK 解码）→ 按 post1strow 切片解析
4. 用户名：JSON 的 __U（可能截断但前段完好）→ HTML 里按 uid 反查
```
