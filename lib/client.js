window.__ModuleLoader__.load({
	id: "dsh-nga-sidebar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");
		//#region src/nga-sources.ts
		/** Host route serving the forum list (parsed from the NGA index page). */
		const FORUMS_ROUTE = "/dsh-nga/forums.json";
		/** Host route serving one page of threads for a board. */
		const THREADS_ROUTE = "/dsh-nga/threads.json";
		/** Host route serving one thread's posts for in-panel reading. */
		const READ_ROUTE = "/dsh-nga/read.json";
		/** Host route for the in-panel cookie form (GET status / POST uid+cid). */
		const SET_COOKIES_ROUTE = "/dsh-nga/set-cookies.json";
		/** Built-in fallback forums used when the live index parse fails or is empty.
		* fid 7 verified readable and its real name confirmed via `__F` (Sep 2026);
		* fid 604 is readable but its name is not yet confirmed. */
		const FALLBACK_FORUMS = [{
			fid: "7",
			name: "艾泽拉斯议事厅 - Hall of Azeroth"
		}, {
			fid: "604",
			name: "板块 604"
		}];
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-nga-sidebar browser half: a sidebar NGA forum panel.
		*
		* Mounting mirrors the dsh-douyin template's dual-mode pattern:
		*  - when the `betterSidebar` service is present (dsh-better-sidebar
		*    installed), the panel registers itself as a sidebar tab;
		*  - otherwise it falls back to a self-drawn right dock with a floating
		*    toggle button, so the plugin works with zero extra dependencies.
		*
		* The panel shows a forum chip row (live board list from the host proxy,
		* with a built-in fallback) and the selected board's thread list. Tapping a
		* thread opens its read.php page in a new tab — the same way the classic
		* NGA web works, and immune to frame-blocking headers. Custom boards can be
		* added by fid and persist in localStorage.
		*
		* @module
		*/
		/** Plugin id == bundle registration key. */
		const ID = "dsh-nga-sidebar";
		const STYLE_TAG_ID = `${ID}/styles`;
		const CUSTOM_FORUMS_KEY = `${ID}:custom-forums`;
		const ACTIVE_FID_KEY = `${ID}:active-fid`;
		const COOKIE_DRAFT_KEY = `${ID}:cookie-draft`;
		function readCustomForums() {
			try {
				const raw = localStorage.getItem(CUSTOM_FORUMS_KEY);
				if (!raw) return [];
				const parsed = JSON.parse(raw);
				if (!Array.isArray(parsed)) return [];
				return parsed.filter((f) => typeof f === "object" && f !== null && typeof f.fid === "string" && /^-?\d{1,6}$/.test(f.fid) && typeof f.name === "string");
			} catch {
				return [];
			}
		}
		function writeCustomForums(forums) {
			try {
				localStorage.setItem(CUSTOM_FORUMS_KEY, JSON.stringify(forums));
			} catch {}
		}
		/** Default active board (verified readable, Sep 2026). */
		const DEFAULT_ACTIVE_FID = "7";
		function readActiveFid() {
			try {
				return localStorage.getItem(ACTIVE_FID_KEY) ?? DEFAULT_ACTIVE_FID;
			} catch {
				return DEFAULT_ACTIVE_FID;
			}
		}
		function writeActiveFid(fid) {
			try {
				localStorage.setItem(ACTIVE_FID_KEY, fid);
			} catch {}
		}
		async function fetchForums(signal) {
			try {
				const res = await fetch(FORUMS_ROUTE, { signal });
				if (!res.ok) return [...FALLBACK_FORUMS];
				const data = await res.json();
				return Array.isArray(data.forums) ? data.forums : [...FALLBACK_FORUMS];
			} catch {
				return [...FALLBACK_FORUMS];
			}
		}
		async function fetchThreads(fid, page, signal) {
			try {
				const res = await fetch(`${THREADS_ROUTE}?fid=${encodeURIComponent(fid)}&page=${page}`, { signal });
				if (!res.ok) return {
					threads: [],
					error: `请求失败 (HTTP ${res.status})`
				};
				const data = await res.json();
				return {
					threads: Array.isArray(data.threads) ? data.threads : [],
					forumName: typeof data.forumName === "string" ? data.forumName : void 0,
					error: typeof data.error === "string" ? data.error : void 0,
					needCookies: data.needCookies === true
				};
			} catch {
				return {
					threads: [],
					error: "网络错误"
				};
			}
		}
		/** Fetch one page of a thread's posts for in-panel reading. */
		async function fetchRead(tid, page, signal) {
			try {
				const res = await fetch(`${READ_ROUTE}?tid=${encodeURIComponent(tid)}&page=${page}`, { signal });
				if (!res.ok) return null;
				const data = await res.json();
				return {
					title: typeof data.title === "string" ? data.title : "",
					posts: Array.isArray(data.posts) ? data.posts : [],
					page: typeof data.page === "number" ? data.page : 1,
					totalPages: typeof data.totalPages === "number" ? data.totalPages : 1,
					totalFloors: typeof data.totalFloors === "number" ? data.totalFloors : 0
				};
			} catch {
				return null;
			}
		}
		const css = `
.nga-root{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:#16161a;color:#e8e8ec;font:13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}
.nga-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #2c2c34;flex:0 0 auto}
.nga-title{font-weight:700;font-size:14px;margin:0;white-space:nowrap}
.nga-refresh{margin-left:auto;border:1px solid #3a3a44;background:#22222a;color:#e8e8ec;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:12px}
.nga-refresh:hover{background:#2e2e38}
.nga-refresh:disabled{opacity:.45;cursor:default}
.nga-forums{display:flex;flex-direction:column;gap:2px;padding:6px 8px;overflow-y:auto;flex:0 1 auto;max-height:42%;border-bottom:1px solid #2c2c34;scrollbar-width:thin}
.nga-forum-row{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:#cfcfd6;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12.5px;text-align:left;flex:0 0 auto;box-sizing:border-box}
.nga-forum-row:hover{background:#22222a}
.nga-forum-row[data-active="true"]{background:#2a3a6e;color:#fff}
.nga-fid-hint{margin-left:auto;font-size:10.5px;color:#6f6f7c;white-space:nowrap}
.nga-chip-x{width:16px;height:16px;border-radius:50%;border:1px solid #3a3a44;background:#22222a;color:#e8e8ec;font-size:10px;line-height:1;padding:0;cursor:pointer;display:grid;place-items:center;flex:0 0 auto}
.nga-chip-x:hover{background:#e5484d;border-color:#e5484d;color:#fff}
.nga-add{display:flex;gap:4px;align-items:center;padding:6px 10px;flex:0 0 auto;flex-wrap:wrap}
.nga-add input{width:64px;background:#1d1d23;border:1px solid #3a3a44;color:#e8e8ec;border-radius:6px;padding:3px 7px;font-size:12px;min-width:0}
.nga-add button{border:1px solid #3a3a44;background:#22222a;color:#e8e8ec;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:12px}
.nga-add button:hover{background:#2e2e38}
.nga-list{flex:1;min-height:0;overflow-y:auto;padding:2px 0}
.nga-thread{display:block;padding:8px 12px;border-bottom:1px solid #232329;cursor:pointer;text-decoration:none;color:inherit}
.nga-thread:hover{background:#202028}
.nga-thread-title{font-size:13px;line-height:1.45;color:#f0f0f4}
.nga-thread-meta{display:flex;gap:10px;margin-top:3px;font-size:11px;color:#8b8b98}
.nga-empty{padding:22px 14px;text-align:center;color:#8b8b98;font-size:12px}
.nga-status{padding:16px 14px;text-align:center;color:#9aa0b8;font-size:12px}
.nga-back{border:1px solid #3a3a44;background:#22222a;color:#e8e8ec;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px}
.nga-back:hover{background:#2e2e38}
.nga-forum-name{font-size:12px;color:#9aa0b8;padding:0 12px 6px}
.nga-read-title{font-size:14px;font-weight:700;line-height:1.5;padding:10px 12px;border-bottom:1px solid #2c2c34;flex:0 0 auto}
.nga-pager{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #2c2c34;flex:0 0 auto;flex-wrap:wrap}
.nga-pager .nga-back:disabled{opacity:.35;cursor:default}
.nga-pager-info{font-size:11px;color:#9aa0b8;white-space:nowrap}
.nga-floor-input{width:64px;background:#1d1d23;border:1px solid #3a3a44;color:#e8e8ec;border-radius:6px;padding:3px 7px;font-size:12px;margin-left:auto}
.nga-read-list{flex:1;min-height:0;overflow-y:auto;padding:2px 0}
.nga-post{padding:10px 12px;border-bottom:1px solid #232329}
.nga-post-head{display:flex;gap:8px;align-items:baseline;margin-bottom:5px;font-size:11px;color:#8b8b98}
.nga-post-author{color:#7ea6f0;font-weight:600}
.nga-post-content{font-size:12.5px;line-height:1.65;color:#e4e4ea;white-space:pre-wrap;word-break:break-word}
.nga-post-img{max-width:100%;border-radius:6px;display:block;margin:6px 0;background:#0d0d10}
.nga-external{color:#7ea6f0;text-decoration:none;font-size:11px}
.nga-fab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:1001;width:34px;height:54px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.14);border-right:0;background:#111;color:#3b5bdb;cursor:pointer;padding:0;border-radius:6px 0 0 6px;font-size:13px;font-weight:700}
.nga-cookie-banner{flex:0 0 auto;background:#3a2a10;color:#ffd9a0;border-bottom:1px solid #5a4018;padding:8px 12px;font-size:11.5px;line-height:1.6;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nga-banner-btn{border:1px solid #8a6a20;background:#5a4018;color:#ffd9a0;border-radius:6px;padding:2px 10px;cursor:pointer;font-size:11.5px}
.nga-banner-btn:hover{background:#7a5a20}
.nga-cookie-form{flex:1;min-height:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.nga-cookie-tip{font-size:12px;color:#9aa0b8;line-height:1.6;margin:0}
.nga-cookie-form label{font-size:11.5px;color:#cfcfd6;margin-top:4px}
.nga-cookie-input{width:100%;box-sizing:border-box;background:#1d1d23;border:1px solid #3a3a44;color:#e8e8ec;border-radius:6px;padding:7px 10px;font-size:13px}
.nga-cookie-save{margin-top:10px;background:#3b5bdb;border:1px solid #3b5bdb;color:#fff;border-radius:6px;padding:7px 12px;cursor:pointer;font-size:13px;font-weight:600}
.nga-cookie-save:hover{background:#4a6ae8}
.nga-cookie-save:disabled{opacity:.5;cursor:default}
.nga-cookie-msg{font-size:12px;margin-top:2px}
.nga-cookie-msg.ok{color:#7ecb8a}
.nga-cookie-msg.err{color:#e58a8a}
.nga-cookie-warn{font-size:11px;color:#8b8b98;line-height:1.6;margin-top:10px;border-top:1px solid #2c2c34;padding-top:8px}
.nga-fab:hover{background:#3b5bdb;color:#fff}
.nga-fab[data-open="true"]{background:#3b5bdb;color:#fff}
.nga-dock{position:fixed;top:0;right:0;bottom:0;width:min(100vw,360px);z-index:1000;display:flex;flex-direction:column;background:#16161a;border-left:1px solid #2c2c34;box-shadow:-14px 0 36px rgba(0,0,0,.25)}
.nga-dock[hidden]{display:none}
`;
		function NgaPanel() {
			const [customForums, setCustomForums] = (0, react.useState)(readCustomForums);
			const [liveForums, setLiveForums] = (0, react.useState)(null);
			const [fid, setFid] = (0, react.useState)(() => readActiveFid());
			const [page] = (0, react.useState)(1);
			const [threads, setThreads] = (0, react.useState)(null);
			const [forumName, setForumName] = (0, react.useState)(void 0);
			const [threadError, setThreadError] = (0, react.useState)(void 0);
			const [needCookies, setNeedCookies] = (0, react.useState)(false);
			const [status, setStatus] = (0, react.useState)("idle");
			const [draft, setDraft] = (0, react.useState)("");
			const [tidDraft, setTidDraft] = (0, react.useState)("");
			const [cookieView, setCookieView] = (0, react.useState)(false);
			const [cUid, setCUid] = (0, react.useState)("");
			const [cCid, setCCid] = (0, react.useState)("");
			const [cookieStatus, setCookieStatus] = (0, react.useState)("idle");
			const reloadSeqRef = (0, react.useRef)(0);
			const [readTid, setReadTid] = (0, react.useState)(null);
			const [readTitle, setReadTitle] = (0, react.useState)("");
			const [posts, setPosts] = (0, react.useState)(null);
			const [readStatus, setReadStatus] = (0, react.useState)("idle");
			const [readPage, setReadPage] = (0, react.useState)(1);
			const [totalPages, setTotalPages] = (0, react.useState)(1);
			const [totalFloors, setTotalFloors] = (0, react.useState)(0);
			const [floorJump, setFloorJump] = (0, react.useState)("");
			const readSeqRef = (0, react.useRef)(0);
			const forums = (0, react.useMemo)(() => {
				const live = liveForums ?? FALLBACK_FORUMS;
				return [...live, ...customForums.filter((c) => !live.some((f) => f.fid === c.fid))];
			}, [liveForums, customForums]);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				fetchForums(controller.signal).then((list) => {
					if (!controller.signal.aborted) setLiveForums(list);
				});
				return () => controller.abort();
			}, []);
			(0, react.useEffect)(() => {
				if (fid === "") return;
				const seq = ++reloadSeqRef.current;
				const controller = new AbortController();
				setStatus("loading");
				setThreads(null);
				setForumName(void 0);
				setThreadError(void 0);
				writeActiveFid(fid);
				fetchThreads(fid, page, controller.signal).then((result) => {
					if (controller.signal.aborted || seq !== reloadSeqRef.current) return;
					setThreads(result.threads);
					setForumName(result.forumName);
					setThreadError(result.error);
					setNeedCookies(result.needCookies === true);
					if (result.forumName !== void 0) adoptForumName(fid, result.forumName);
					setStatus("idle");
				}).catch(() => {
					if (controller.signal.aborted || seq !== reloadSeqRef.current) return;
					setStatus("error");
				});
				return () => controller.abort();
			}, [fid, page]);
			const refresh = (0, react.useCallback)(() => {
				if (fid === "") return;
				const seq = ++reloadSeqRef.current;
				const controller = new AbortController();
				setStatus("loading");
				setThreads(null);
				setThreadError(void 0);
				fetchThreads(fid, page, controller.signal).then((result) => {
					if (controller.signal.aborted || seq !== reloadSeqRef.current) return;
					setThreads(result.threads);
					setForumName(result.forumName);
					setThreadError(result.error);
					setNeedCookies(result.needCookies === true);
					if (result.forumName !== void 0) adoptForumName(fid, result.forumName);
				}).catch(() => {
					if (controller.signal.aborted || seq !== reloadSeqRef.current) return;
					setStatus("error");
				});
			}, [fid, page]);
			const addCustom = (0, react.useCallback)(() => {
				const clean = draft.trim();
				if (!/^-?\d{1,6}$/.test(clean)) return;
				if (forums.some((f) => f.fid === clean)) {
					setDraft("");
					return;
				}
				const next = [...customForums, {
					fid: clean,
					name: `自定义 ${clean}`
				}];
				setCustomForums(next);
				writeCustomForums(next);
				setDraft("");
				setFid(clean);
			}, [
				draft,
				customForums,
				forums
			]);
			/** Remove one user-added board; fall back to another board if it was active. */
			const removeCustom = (0, react.useCallback)((targetFid) => {
				const next = customForums.filter((f) => f.fid !== targetFid);
				setCustomForums(next);
				writeCustomForums(next);
				if (fid === targetFid) {
					const rest = forums.filter((f) => f.fid !== targetFid);
					if (rest.length > 0) setFid(rest[0].fid);
				}
			}, [
				customForums,
				fid,
				forums
			]);
			/** Rename a user-added board to its real name once the API reports it. */
			const adoptForumName = (0, react.useCallback)((targetFid, name) => {
				if (name === "" || name === void 0) return;
				setCustomForums((prev) => {
					const idx = prev.findIndex((f) => f.fid === targetFid && f.name === `自定义 ${targetFid}`);
					if (idx === -1) return prev;
					const next = [...prev];
					next[idx] = {
						...next[idx],
						name
					};
					writeCustomForums(next);
					return next;
				});
			}, []);
			/** Open a thread by raw tid from the input row. */
			const openTid = (0, react.useCallback)(() => {
				const clean = tidDraft.trim();
				if (!/^\d{1,12}$/.test(clean)) return;
				setTidDraft("");
				openThreadView(clean);
			}, [tidDraft]);
			/** Open the cookie settings view, prefilled from the local draft. */
			const openCookieView = (0, react.useCallback)(() => {
				try {
					const raw = localStorage.getItem(COOKIE_DRAFT_KEY);
					if (raw !== null) {
						const parsed = JSON.parse(raw);
						if (typeof parsed.uid === "string") setCUid(parsed.uid);
						if (typeof parsed.cid === "string") setCCid(parsed.cid);
					}
				} catch {}
				setCookieStatus("idle");
				setCookieView(true);
			}, []);
			/** Save uid/cid to the host (in-memory + persisted) and refresh boards. */
			const saveCookies = (0, react.useCallback)(() => {
				const uid = cUid.trim();
				const cid = cCid.trim();
				if (!/^\d{1,12}$/.test(uid) || cid === "") {
					setCookieStatus("error");
					return;
				}
				setCookieStatus("saving");
				try {
					localStorage.setItem(COOKIE_DRAFT_KEY, JSON.stringify({
						uid,
						cid
					}));
				} catch {}
				fetch(SET_COOKIES_ROUTE, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						uid,
						cid
					})
				}).then((res) => res.json()).then((data) => {
					if (data.ok === true) {
						setCookieStatus("ok");
						setNeedCookies(false);
						refresh();
					} else setCookieStatus("error");
				}).catch(() => setCookieStatus("error"));
			}, [
				cUid,
				cCid,
				refresh
			]);
			/** Open a thread inside the panel at page 1. */
			const openThreadView = (0, react.useCallback)((tid) => {
				setReadTid(tid);
				setReadTitle("");
				setPosts(null);
				setReadPage(1);
				setTotalPages(1);
				setTotalFloors(0);
				setReadStatus("loading");
				const seq = ++readSeqRef.current;
				const controller = new AbortController();
				fetchRead(tid, 1, controller.signal).then((result) => {
					if (controller.signal.aborted || seq !== readSeqRef.current) return;
					if (result === null) {
						setReadStatus("error");
						return;
					}
					setReadTitle(result.title);
					setPosts(result.posts);
					setReadPage(result.page);
					setTotalPages(result.totalPages);
					setTotalFloors(result.totalFloors);
					setReadStatus("idle");
				}).catch(() => {
					if (controller.signal.aborted || seq !== readSeqRef.current) return;
					setReadStatus("error");
				});
			}, []);
			/** Load a specific page of the open thread. */
			const loadReadPage = (0, react.useCallback)((target) => {
				if (readTid === null) return;
				const seq = ++readSeqRef.current;
				setPosts(null);
				setReadStatus("loading");
				const controller = new AbortController();
				fetchRead(readTid, target, controller.signal).then((result) => {
					if (controller.signal.aborted || seq !== readSeqRef.current) return;
					if (result === null) {
						setReadStatus("error");
						return;
					}
					setReadTitle(result.title);
					setPosts(result.posts);
					setReadPage(result.page);
					setTotalPages(result.totalPages);
					setTotalFloors(result.totalFloors);
					setReadStatus("idle");
				}).catch(() => {
					if (controller.signal.aborted || seq !== readSeqRef.current) return;
					setReadStatus("error");
				});
			}, [readTid]);
			/** Jump to the page containing a given floor number. */
			const jumpToFloor = (0, react.useCallback)((floorRaw) => {
				const floor = Number(floorRaw.trim());
				if (!Number.isFinite(floor) || floor < 0) return;
				const target = Math.floor(floor / 20) + 1;
				loadReadPage(Math.max(1, Math.min(totalPages, target)));
			}, [totalPages, loadReadPage]);
			const backToList = (0, react.useCallback)(() => {
				readSeqRef.current += 1;
				setReadTid(null);
				setPosts(null);
			}, []);
			if (readTid !== null) return (0, react.createElement)("div", { className: "nga-root" }, (0, react.createElement)("div", { className: "nga-head" }, (0, react.createElement)("button", {
				className: "nga-back",
				type: "button",
				onClick: backToList
			}, "← 返回"), (0, react.createElement)("h2", { className: "nga-title" }, "帖子"), (0, react.createElement)("a", {
				className: "nga-external",
				href: `https://bbs.nga.cn/read.php?tid=${readTid}`,
				target: "_blank",
				rel: "noopener",
				style: { marginLeft: "auto" }
			}, "网页版")), readStatus === "loading" ? (0, react.createElement)("div", { className: "nga-status" }, "加载中…") : readStatus === "error" ? (0, react.createElement)("div", { className: "nga-status" }, "加载失败，点「网页版」在浏览器里打开") : readTitle !== "" ? (0, react.createElement)("div", { className: "nga-read-title" }, readTitle) : null, readTid !== null && readStatus !== "loading" ? (0, react.createElement)("div", { className: "nga-pager" }, (0, react.createElement)("button", {
				className: "nga-back",
				type: "button",
				disabled: readPage <= 1,
				onClick: () => loadReadPage(readPage - 1)
			}, "← 上一页"), (0, react.createElement)("span", { className: "nga-pager-info" }, `第 ${readPage}/${totalPages} 页 · ${totalFloors} 楼`), (0, react.createElement)("button", {
				className: "nga-back",
				type: "button",
				disabled: readPage >= totalPages,
				onClick: () => loadReadPage(readPage + 1)
			}, "下一页 →"), (0, react.createElement)("input", {
				className: "nga-floor-input",
				value: floorJump,
				placeholder: "跳#楼层",
				"aria-label": "跳转到楼层",
				onChange: (e) => setFloorJump(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") {
						jumpToFloor(floorJump);
						setFloorJump("");
					}
				}
			})) : null, posts === null ? null : posts.length === 0 ? (0, react.createElement)("div", { className: "nga-empty" }, "这个帖子暂时没有内容") : (0, react.createElement)("div", { className: "nga-read-list" }, ...posts.map((post) => (0, react.createElement)("div", {
				key: post.pid,
				className: "nga-post"
			}, (0, react.createElement)("div", { className: "nga-post-head" }, (0, react.createElement)("span", { className: "nga-post-author" }, post.author === "" ? "匿名" : post.author), (0, react.createElement)("span", null, post.floor <= 0 ? "主楼" : `#${post.floor}`)), (0, react.createElement)("div", { className: "nga-post-content" }, post.content === "" ? "（内容为空）" : post.content), ...(post.images ?? []).map((src) => (0, react.createElement)("img", {
				key: src,
				src,
				alt: "",
				loading: "lazy",
				className: "nga-post-img"
			}))))));
			if (cookieView) return (0, react.createElement)("div", { className: "nga-root" }, (0, react.createElement)("div", { className: "nga-head" }, (0, react.createElement)("button", {
				className: "nga-back",
				type: "button",
				onClick: () => setCookieView(false)
			}, "← 返回"), (0, react.createElement)("h2", { className: "nga-title" }, "NGA 登录 Cookie")), (0, react.createElement)("div", { className: "nga-cookie-form" }, (0, react.createElement)("p", { className: "nga-cookie-tip" }, "在浏览器登录 bbs.nga.cn 后，F12 → Application → Cookies 里复制这两个值（注意是驼峰命名）："), (0, react.createElement)("label", null, "ngaPassportUid（账号 UID）"), (0, react.createElement)("input", {
				className: "nga-cookie-input",
				value: cUid,
				placeholder: "例如 12345678",
				onChange: (e) => setCUid(e.target.value)
			}), (0, react.createElement)("label", null, "ngaPassportCid（会话凭证）"), (0, react.createElement)("input", {
				className: "nga-cookie-input",
				value: cCid,
				placeholder: "浏览器里复制的 cid 值",
				onChange: (e) => setCCid(e.target.value)
			}), (0, react.createElement)("button", {
				className: "nga-cookie-save",
				type: "button",
				disabled: cookieStatus === "saving",
				onClick: saveCookies
			}, cookieStatus === "saving" ? "保存中…" : "保存"), cookieStatus === "ok" ? (0, react.createElement)("div", { className: "nga-cookie-msg ok" }, "✅ 已保存，板块数据将立即刷新") : cookieStatus === "error" ? (0, react.createElement)("div", { className: "nga-cookie-msg err" }, "❌ 保存失败，请检查 uid/cid 是否完整") : null, (0, react.createElement)("p", { className: "nga-cookie-warn" }, "⚠ 这是你的 NGA 账号凭证，仅保存在本机，不要外传。")));
			return (0, react.createElement)("div", { className: "nga-root" }, needCookies ? (0, react.createElement)("div", { className: "nga-cookie-banner" }, "⚠ 未配置 NGA 登录 Cookie，帖子可能无法加载。", (0, react.createElement)("button", {
				className: "nga-banner-btn",
				type: "button",
				onClick: openCookieView
			}, "去填写")) : null, (0, react.createElement)("div", { className: "nga-head" }, (0, react.createElement)("h2", { className: "nga-title" }, forumName !== void 0 ? forumName : "NGA"), (0, react.createElement)("button", {
				className: "nga-refresh",
				type: "button",
				onClick: refresh,
				disabled: fid === "" || status === "loading"
			}, status === "loading" ? "加载中…" : "刷新"), (0, react.createElement)("button", {
				className: "nga-refresh",
				type: "button",
				onClick: openCookieView
			}, "Cookie")), forums.length > 0 ? (0, react.createElement)("div", {
				className: "nga-forums",
				role: "tablist",
				"aria-label": "板块列表"
			}, ...forums.map((forum) => {
				const isCustom = customForums.some((f) => f.fid === forum.fid);
				return (0, react.createElement)("div", {
					key: forum.fid,
					className: "nga-forum-row",
					role: "tab",
					"aria-selected": forum.fid === fid,
					"data-active": forum.fid === fid ? true : void 0,
					title: `${forum.name} (fid=${forum.fid})`,
					onClick: () => setFid(forum.fid)
				}, (0, react.createElement)("span", null, forum.name), (0, react.createElement)("span", { className: "nga-fid-hint" }, `fid=${forum.fid}`), isCustom ? (0, react.createElement)("button", {
					className: "nga-chip-x",
					type: "button",
					title: "删除这个板块",
					"aria-label": `删除板块 ${forum.name}`,
					onClick: (e) => {
						e.stopPropagation();
						removeCustom(forum.fid);
					}
				}, "×") : null);
			})) : null, (0, react.createElement)("div", { className: "nga-add" }, (0, react.createElement)("input", {
				value: draft,
				placeholder: "加板块 fid",
				"aria-label": "自定义板块 fid",
				onChange: (e) => setDraft(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") addCustom();
				}
			}), (0, react.createElement)("button", {
				type: "button",
				onClick: addCustom
			}, "添加"), (0, react.createElement)("input", {
				value: tidDraft,
				placeholder: "打开帖子 tid",
				"aria-label": "按 tid 打开帖子",
				onChange: (e) => setTidDraft(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") openTid();
				}
			}), (0, react.createElement)("button", {
				type: "button",
				onClick: openTid
			}, "打开")), fid === "" ? (0, react.createElement)("div", { className: "nga-empty" }, "选一个板块开始浏览") : status === "error" ? (0, react.createElement)("div", { className: "nga-status" }, "加载失败，请刷新重试") : threads === null ? (0, react.createElement)("div", { className: "nga-status" }, "加载中…") : threads.length === 0 ? (0, react.createElement)("div", { className: "nga-empty" }, threadError !== void 0 ? threadError : "这个板块暂时没有帖子") : (0, react.createElement)("div", {
				className: "nga-list",
				role: "list"
			}, ...threads.map((thread) => (0, react.createElement)("a", {
				key: thread.tid,
				className: "nga-thread",
				role: "listitem",
				href: `https://bbs.nga.cn/read.php?tid=${thread.tid}`,
				target: "_blank",
				rel: "noopener",
				onClick: (e) => {
					e.preventDefault();
					openThreadView(thread.tid);
				}
			}, (0, react.createElement)("div", { className: "nga-thread-title" }, thread.title), (0, react.createElement)("div", { className: "nga-thread-meta" }, (0, react.createElement)("span", null, thread.author === "" ? "未知作者" : thread.author), (0, react.createElement)("span", null, thread.reply >= 0 ? `${thread.reply} 回复` : ""), (0, react.createElement)("span", { style: { marginLeft: "auto" } }, "阅读 ›"))))));
		}
		const inject = [];
		function apply(ctx) {
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.dataset.plugin = ID;
				tag.dataset.pluginCss = STYLE_TAG_ID;
				tag.textContent = css;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, `${ID}: styles`);
			const betterSidebar = ctx.get("betterSidebar");
			if (betterSidebar?.registerTab) {
				ctx.effect(() => betterSidebar.registerTab({
					id: "dsh-nga:forum",
					title: "NGA",
					icon: (size) => (0, react.createElement)("span", { style: {
						fontSize: size * .62,
						fontWeight: 700
					} }, "N"),
					single: true,
					component: () => (0, react.createElement)(NgaPanel)
				}), `${ID}: better-sidebar tab`);
				return;
			}
			let root = null;
			const dockHost = document.createElement("div");
			document.body.appendChild(dockHost);
			const render = (open) => {
				if (root === null) root = (0, react_dom_client.createRoot)(dockHost);
				root.render((0, react.createElement)("div", null, (0, react.createElement)("button", {
					className: "nga-fab",
					type: "button",
					"data-open": open ? true : void 0,
					title: open ? "收起 NGA" : "打开 NGA 面板",
					"aria-label": open ? "收起 NGA 面板" : "打开 NGA 面板",
					"aria-expanded": open,
					onClick: () => render(!open)
				}, "N"), open ? (0, react.createElement)("div", { className: "nga-dock" }, (0, react.createElement)(NgaPanel)) : null));
			};
			render(false);
			ctx.effect(() => {
				return () => {
					root?.unmount();
					dockHost.remove();
				};
			}, `${ID}: dock lifecycle`);
		}
		//#endregion
		exports.ID = ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map