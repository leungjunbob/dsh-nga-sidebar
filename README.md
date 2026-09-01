# dsh-nga-sidebar

DSH WebUI 侧栏 NGA 论坛插件：板块列表 → 帖子列表 → **面板内直接阅读**（无需跳转网页）。浏览器侧只与本机 dsh 的宿主代理通信，由宿主抓取 bbs.nga.cn，**零 CORS、无 iframe 限制**。

> 基于 dsh-douyin 的架构改造。仅供个人学习使用，注意 NGA 用户协议，别高频抓取。

## 功能一览

- 📚 板块列表：竖排、可滚动、一行一个；加载后自动显示板块**真名**（如"艾泽拉斯议事厅""碧蓝幻想"）
- 📄 帖子列表：标题/作者/回复数；点击**在面板内阅读**
- 📖 面板内阅读：作者 + 楼层 + 正文 + **图片渲染**；引用回复排版正常
- 📑 翻页：长帖每页 20 楼，「上一页/下一页」+ 页码 + **楼层跳转**输入框
- ➕ 自定义板块：输入 fid 添加（带 × 可删），自动改真名
- 🔔 未配置 Cookie 时面板顶部显示引导横幅

## 安装

```sh
# 1) 构建插件（需要网络；pnpm 缺失时先 corepack enable 并重开终端）
cd <插件目录>
pnpm install
pnpm run build

# 2) 装进 web profile
cd <dsh 安装目录>
node apps\cli\lib\bin.js plugin --profile web add <插件目录>

# 3) 打开面板 →「Cookie」按钮配置登录 Cookie（见下）后重启 dsh web
```

重启后右侧出现竖条 **"N"** 按钮（装了 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 则注册为侧栏 Tab）。**注意：重启服务后要把浏览器 3080 标签页整个关掉重开**，客户端更新才会生效。

## 配置 NGA 登录 Cookie（必需）

### 为什么需要

NGA 反爬：匿名访问被 JS 挑战（`guestJs`）拦截，脚本模拟无法通过；JSON 接口（`__output=11`）必须登录。所以插件用**你的登录 Cookie** 走 JSON 接口取数据。

### 必要项（实测只需 2 个）

| Cookie 名 | 说明 |
|---|---|
| `ngaPassportUid` | 账号 UID |
| `ngaPassportCid` | 会话凭证（等同登录令牌） |

> ⚠️ 注意是**驼峰命名**（`ngaPassportUid`），不是 `nga_passport_uid`——名字写错会被 NGA 当作未登录。

### 步骤（二选一）

**方式 A：面板内填写（推荐，零命令行）**
打开面板 → 顶部「Cookie」按钮 → 填入 `ngaPassportUid` / `ngaPassportCid` 两个值 → 保存。宿主持久化到本地文件，重启不丢，板块立即刷新。

**方式 B：手改文件**
1. 浏览器登录 `https://bbs.nga.cn`；
2. `F12` → **Application/应用** → **Cookies** → `https://bbs.nga.cn`，复制 `ngaPassportUid` 和 `ngaPassportCid` 的值；
3. 用记事本打开（或新建）`~/.dsh/dsh-nga-cookies.txt`（宿主默认 Cookie 文件；如设置了 `DSH_NGA_COOKIES_FILE` 环境变量则写那个路径），写成一行的格式：

```
ngaPassportUid=你的uid值; ngaPassportCid=你的cid值
```

4. 重启 dsh web（无需改动任何启动脚本）。

### 有效期 & 更新

- `ngaPassportUid/Cid` 有效期**约 1 年**（或到你改密码/登出为止）
- 实际判断：面板里板块开始报「此板块需要登录」时，重新导一次 Cookie 覆盖 `nga-cookies.txt` 即可
- 也可在 `nga-cookies.txt` 里追加浏览器中的其他 NGA Cookie（`ngacn0comUserInfo*`、`lastvisit` 等），部分冷门板块更稳——**但两个必要项就已满足绝大多数场景**

## 使用说明

- **板块**：点击行切换；右侧 `fid=` 是板块 id（浏览器打开板块页，URL 里 `fid=数字` 就是）
- **添加板块**：底部输入 fid →「添加」；自加板块右上角 × 可删
- **阅读**：点帖子标题 → 面板内显示；「← 返回」回列表；右上「网页版」在新标签页打开原帖
- **翻页**：阅读页顶部「← 上一页 / 第 x/y 页 / 下一页 →」；输入楼层号回车直接跳
- **权限不足的板块**（如部分需要更高等级的）会提示原因，删掉换别的即可

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 面板顶部黄色横幅"未配置 NGA 登录 Cookie" | 宿主没读到 Cookie | 按上文配置 `nga-cookies.txt` + 重启 |
| 板块提示「此板块需要登录/权限不足」 | 该板块对当前账号门槛更高 | 换其他板块（fid=7、604 已验证可读） |
| 帖子打不开/显示加载失败 | 网络或该帖特殊 | 点「网页版」查看原帖；或 F12 看报错 |
| 点了没反应/面板还是旧的 | 浏览器页面缓存 | 整个关掉 3080 标签页重开 |
| 板块名显示"自定义 560" | 还没加载成功 | 加载成功后会自动改成真名 |

## 安全设计

- 浏览器只发 `fid`/`page`/`tid` 数字，**从不传 URL**；宿主用硬编码的 `https://bbs.nga.cn` 拼请求（SSRF 安全）
- 10s 超时、4MB 体积上限、并发 6 上限 + 60 次/10s 限流，失败静默降级
- 路由：`/dsh-nga/forums.json`、`/dsh-nga/threads.json`、`/dsh-nga/read.json`、`/dsh-nga/debug.json`（调试用，发布版建议移除）
- **Cookie 是账号凭证**：只存本机、不要外传、不要贴到任何群里；泄露后请改密码使旧会话失效

## 开发说明

```
src/nga-sources.ts    共享契约（类型/路由/默认板块）
src/index.ts          宿主代理：抓取 + 解析（parseNgaJson 处理 NGA 松散 JSON）
src/client/index.ts   浏览器面板（板块/帖子/阅读三视图）
cordis.patch.yml      挂载行
docs/NGA-PARSING-PITFALLS.md   NGA 数据解析踩坑总结（开发必读）
```

接口契约参考 [AgMonk/nga-api-doc](https://github.com/AgMonk/nga-api-doc)；NGA 改结构时调整 `src/index.ts` 的解析函数即可。

## 发布

```sh
# 1) 确保 lib/ 是最新构建（发行版应包含预构建产物，用户无需安装依赖）
pnpm run build

# 2) 初始化 git（node_modules 已被 .gitignore 排除）
git init && git add . && git commit -m "release"

# 3) 推送到 GitHub 后，用户即可一行安装：
#    dsh plugin --profile web add github:<你的用户名>/dsh-nga-sidebar
#    或发布到 npm 后：dsh plugin --profile web add dsh-nga-sidebar
```

> 发布前检查：仓库内**不应出现**任何个人路径（本地绝对路径）、账号 UID、Cookie 值；`docs/NGA-PARSING-PITFALLS.md` 的踩坑记录可以保留供他人开发参考。
