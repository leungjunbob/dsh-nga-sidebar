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
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  FORUMS_ROUTE, THREADS_ROUTE, READ_ROUTE, SET_COOKIES_ROUTE, FALLBACK_FORUMS,
  type NgaForum, type NgaPost, type NgaThread,
} from '../nga-sources.ts'

/** Plugin id == bundle registration key. */
export const ID = 'dsh-nga-sidebar'

const STYLE_TAG_ID = `${ID}/styles`
const CUSTOM_FORUMS_KEY = `${ID}:custom-forums`
const ACTIVE_FID_KEY = `${ID}:active-fid`
const COOKIE_DRAFT_KEY = `${ID}:cookie-draft`

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

function readCustomForums(): NgaForum[] {
  try {
    const raw = localStorage.getItem(CUSTOM_FORUMS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((f): f is NgaForum =>
      typeof f === 'object' && f !== null
      && typeof (f as NgaForum).fid === 'string' && /^-?\d{1,6}$/.test((f as NgaForum).fid)
      && typeof (f as NgaForum).name === 'string')
  } catch {
    return []
  }
}

function writeCustomForums(forums: readonly NgaForum[]): void {
  try { localStorage.setItem(CUSTOM_FORUMS_KEY, JSON.stringify(forums)) } catch { /* non-fatal */ }
}

/** Default active board (verified readable, Sep 2026). */
const DEFAULT_ACTIVE_FID = '7'

function readActiveFid(): string {
  try { return localStorage.getItem(ACTIVE_FID_KEY) ?? DEFAULT_ACTIVE_FID } catch { return DEFAULT_ACTIVE_FID }
}

function writeActiveFid(fid: string): void {
  try { localStorage.setItem(ACTIVE_FID_KEY, fid) } catch { /* non-fatal */ }
}

/* ------------------------------------------------------------------ */
/* Host proxy calls                                                    */
/* ------------------------------------------------------------------ */

async function fetchForums(signal: AbortSignal): Promise<NgaForum[]> {
  try {
    const res = await fetch(FORUMS_ROUTE, { signal })
    if (!res.ok) return [...FALLBACK_FORUMS]
    const data = await res.json() as { forums?: unknown }
    return Array.isArray(data.forums) ? data.forums as NgaForum[] : [...FALLBACK_FORUMS]
  } catch {
    return [...FALLBACK_FORUMS]
  }
}

async function fetchThreads(fid: string, page: number, signal: AbortSignal): Promise<{ threads: NgaThread[]; forumName?: string; error?: string; needCookies?: boolean; hasNext?: boolean }> {
  try {
    const res = await fetch(`${THREADS_ROUTE}?fid=${encodeURIComponent(fid)}&page=${page}`, { signal })
    if (!res.ok) return { threads: [], error: `请求失败 (HTTP ${res.status})` }
    const data = await res.json() as { threads?: unknown; forumName?: unknown; error?: unknown; needCookies?: unknown; hasNext?: unknown }
    return {
      threads: Array.isArray(data.threads) ? data.threads as NgaThread[] : [],
      forumName: typeof data.forumName === 'string' ? data.forumName : undefined,
      error: typeof data.error === 'string' ? data.error : undefined,
      needCookies: data.needCookies === true,
      hasNext: data.hasNext === true,
    }
  } catch {
    return { threads: [], error: '网络错误' }
  }
}

/** One page of a thread fetched for in-panel reading. */
interface ReadPage {
  title: string
  posts: NgaPost[]
  page: number
  totalPages: number
  totalFloors: number
}

/** Fetch one page of a thread's posts for in-panel reading. */
async function fetchRead(tid: string, page: number, signal: AbortSignal): Promise<ReadPage | null> {
  try {
    const res = await fetch(`${READ_ROUTE}?tid=${encodeURIComponent(tid)}&page=${page}`, { signal })
    if (!res.ok) return null
    const data = await res.json() as {
      title?: unknown; posts?: unknown; page?: unknown; totalPages?: unknown; totalFloors?: unknown
    }
    return {
      title: typeof data.title === 'string' ? data.title : '',
      posts: Array.isArray(data.posts) ? data.posts as NgaPost[] : [],
      page: typeof data.page === 'number' ? data.page : 1,
      totalPages: typeof data.totalPages === 'number' ? data.totalPages : 1,
      totalFloors: typeof data.totalFloors === 'number' ? data.totalFloors : 0,
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Styles — minimal dark panel, theme-neutral                         */
/* ------------------------------------------------------------------ */

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
.nga-list-wrap{flex:1;min-height:0;display:flex;flex-direction:column}
.nga-list-wrap>.nga-pager{flex:0 0 auto;border-bottom:0;border-top:1px solid #2c2c34}
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
`

/* ------------------------------------------------------------------ */
/* Panel component                                                     */
/* ------------------------------------------------------------------ */

function openExternal(tid: string): void {
  window.open(`https://bbs.nga.cn/read.php?tid=${tid}`, '_blank', 'noopener')
}

function NgaPanel(): React.ReactElement {
  const [customForums, setCustomForums] = useState<NgaForum[]>(readCustomForums)
  const [liveForums, setLiveForums] = useState<NgaForum[] | null>(null)
  const [fid, setFid] = useState<string>(() => readActiveFid())
  const [page, setPage] = useState(1)
  /**
   * Whether the current board has a page after this one. NGA's thread list
   * does not report a total, so the host tells us whether the last row was a
   * full page — the only reliable signal that a next page may exist.
   */
  const [hasNext, setHasNext] = useState(false)
  const [threads, setThreads] = useState<NgaThread[] | null>(null)
  const [forumName, setForumName] = useState<string | undefined>(undefined)
  const [threadError, setThreadError] = useState<string | undefined>(undefined)
  const [needCookies, setNeedCookies] = useState(false)
  const [status, setStatus] = useState<'loading' | 'error' | 'idle'>('idle')
  const [draft, setDraft] = useState('')
  const [tidDraft, setTidDraft] = useState('')
  // Cookie 设置视图
  const [cookieView, setCookieView] = useState(false)
  const [cUid, setCUid] = useState('')
  const [cCid, setCCid] = useState('')
  const [cookieStatus, setCookieStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const reloadSeqRef = useRef(0)

  // In-panel thread reading view.
  const [readTid, setReadTid] = useState<string | null>(null)
  const [readTitle, setReadTitle] = useState('')
  const [posts, setPosts] = useState<NgaPost[] | null>(null)
  const [readStatus, setReadStatus] = useState<'loading' | 'error' | 'idle'>('idle')
  const [readPage, setReadPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalFloors, setTotalFloors] = useState(0)
  const [floorJump, setFloorJump] = useState('')
  const readSeqRef = useRef(0)

  const forums = useMemo<NgaForum[]>(() => {
    const live = liveForums ?? FALLBACK_FORUMS
    return [...live, ...customForums.filter(c => !live.some(f => f.fid === c.fid))]
  }, [liveForums, customForums])

  // Load the live forum list once on mount.
  useEffect(() => {
    const controller = new AbortController()
    void fetchForums(controller.signal).then(list => { if (!controller.signal.aborted) setLiveForums(list) })
    return () => controller.abort()
  }, [])

  // Load threads whenever the selected board changes.
  useEffect(() => {
    if (fid === '') return
    const seq = ++reloadSeqRef.current
    const controller = new AbortController()
    setStatus('loading')
    setThreads(null)
    setForumName(undefined)
    setThreadError(undefined)
    writeActiveFid(fid)
    void fetchThreads(fid, page, controller.signal).then(result => {
      if (controller.signal.aborted || seq !== reloadSeqRef.current) return
      setThreads(result.threads)
      setForumName(result.forumName)
      setThreadError(result.error)
      setNeedCookies(result.needCookies === true)
      setHasNext(result.hasNext === true)
      if (result.forumName !== undefined) adoptForumName(fid, result.forumName)
      setStatus('idle')
    }).catch(() => {
      if (controller.signal.aborted || seq !== reloadSeqRef.current) return
      setStatus('error')
    })
    return () => controller.abort()
  }, [fid, page])

  /** Switch board, always starting from the first page. */
  const selectForum = useCallback((nextFid: string): void => {
    setPage(1)
    setHasNext(false)
    setFid(nextFid)
  }, [])

  const refresh = useCallback((): void => {    if (fid === '') return
    const seq = ++reloadSeqRef.current
    const controller = new AbortController()
    setStatus('loading')
    setThreads(null)
    setThreadError(undefined)
    void fetchThreads(fid, page, controller.signal).then(result => {
      if (controller.signal.aborted || seq !== reloadSeqRef.current) return
      setThreads(result.threads)
      setForumName(result.forumName)
      setThreadError(result.error)
      setNeedCookies(result.needCookies === true)
      setHasNext(result.hasNext === true)
      if (result.forumName !== undefined) adoptForumName(fid, result.forumName)
    }).catch(() => {
      if (controller.signal.aborted || seq !== reloadSeqRef.current) return
      setStatus('error')
    })
  }, [fid, page])

  const addCustom = useCallback((): void => {
    const clean = draft.trim()
    if (!/^-?\d{1,6}$/.test(clean)) return
    if (forums.some(f => f.fid === clean)) { setDraft(''); return }
    const next = [...customForums, { fid: clean, name: `自定义 ${clean}` }]
    setCustomForums(next)
    writeCustomForums(next)
    setDraft('')
    setFid(clean)
  }, [draft, customForums, forums])

  /** Remove one user-added board; fall back to another board if it was active. */
  const removeCustom = useCallback((targetFid: string): void => {
    const next = customForums.filter(f => f.fid !== targetFid)
    setCustomForums(next)
    writeCustomForums(next)
    if (fid === targetFid) {
      const rest = forums.filter(f => f.fid !== targetFid)
      if (rest.length > 0) setFid(rest[0]!.fid)
    }
  }, [customForums, fid, forums])

  /** Rename a user-added board to its real name once the API reports it. */
  const adoptForumName = useCallback((targetFid: string, name: string): void => {
    if (name === '' || name === undefined) return
    setCustomForums(prev => {
      const idx = prev.findIndex(f => f.fid === targetFid && f.name === `自定义 ${targetFid}`)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = { ...next[idx]!, name }
      writeCustomForums(next)
      return next
    })
  }, [])

  /** Open a thread by raw tid from the input row. */
  const openTid = useCallback((): void => {
    const clean = tidDraft.trim()
    if (!/^\d{1,12}$/.test(clean)) return
    setTidDraft('')
    openThreadView(clean)
  }, [tidDraft])

  /** Open the cookie settings view, prefilled from the local draft. */
  const openCookieView = useCallback((): void => {
    try {
      const raw = localStorage.getItem(COOKIE_DRAFT_KEY)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as { uid?: unknown; cid?: unknown }
        if (typeof parsed.uid === 'string') setCUid(parsed.uid)
        if (typeof parsed.cid === 'string') setCCid(parsed.cid)
      }
    } catch { /* ignore */ }
    setCookieStatus('idle')
    setCookieView(true)
  }, [])

  /** Save uid/cid to the host (in-memory + persisted) and refresh boards. */
  const saveCookies = useCallback((): void => {
    const uid = cUid.trim()
    const cid = cCid.trim()
    if (!/^\d{1,12}$/.test(uid) || cid === '') { setCookieStatus('error'); return }
    setCookieStatus('saving')
    try { localStorage.setItem(COOKIE_DRAFT_KEY, JSON.stringify({ uid, cid })) } catch { /* ignore */ }
    void fetch(SET_COOKIES_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid, cid }),
    }).then(res => res.json()).then((data: { ok?: unknown }) => {
      if (data.ok === true) {
        setCookieStatus('ok')
        setNeedCookies(false)
        refresh()
      } else {
        setCookieStatus('error')
      }
    }).catch(() => setCookieStatus('error'))
  }, [cUid, cCid, refresh])

  /** Open a thread inside the panel at page 1. */
  const openThreadView = useCallback((tid: string): void => {
    setReadTid(tid)
    setReadTitle('')
    setPosts(null)
    setReadPage(1)
    setTotalPages(1)
    setTotalFloors(0)
    setReadStatus('loading')
    const seq = ++readSeqRef.current
    const controller = new AbortController()
    void fetchRead(tid, 1, controller.signal).then(result => {
      if (controller.signal.aborted || seq !== readSeqRef.current) return
      if (result === null) { setReadStatus('error'); return }
      setReadTitle(result.title)
      setPosts(result.posts)
      setReadPage(result.page)
      setTotalPages(result.totalPages)
      setTotalFloors(result.totalFloors)
      setReadStatus('idle')
    }).catch(() => {
      if (controller.signal.aborted || seq !== readSeqRef.current) return
      setReadStatus('error')
    })
  }, [])

  /** Load a specific page of the open thread. */
  const loadReadPage = useCallback((target: number): void => {
    if (readTid === null) return
    const seq = ++readSeqRef.current
    setPosts(null)
    setReadStatus('loading')
    const controller = new AbortController()
    void fetchRead(readTid, target, controller.signal).then(result => {
      if (controller.signal.aborted || seq !== readSeqRef.current) return
      if (result === null) { setReadStatus('error'); return }
      setReadTitle(result.title)
      setPosts(result.posts)
      setReadPage(result.page)
      setTotalPages(result.totalPages)
      setTotalFloors(result.totalFloors)
      setReadStatus('idle')
    }).catch(() => {
      if (controller.signal.aborted || seq !== readSeqRef.current) return
      setReadStatus('error')
    })
  }, [readTid])

  /** Jump to the page containing a given floor number. */
  const jumpToFloor = useCallback((floorRaw: string): void => {
    const floor = Number(floorRaw.trim())
    if (!Number.isFinite(floor) || floor < 0) return
    const target = Math.floor(floor / 20) + 1
    loadReadPage(Math.max(1, Math.min(totalPages, target)))
  }, [totalPages, loadReadPage])

  const backToList = useCallback((): void => {
    readSeqRef.current += 1
    setReadTid(null)
    setPosts(null)
  }, [])

  // ── 帖子阅读视图 ────────────────────────────────────────────────
  if (readTid !== null) {
    return createElement('div', { className: 'nga-root' },
      createElement('div', { className: 'nga-head' },
        createElement('button', { className: 'nga-back', type: 'button', onClick: backToList }, '← 返回'),
        createElement('h2', { className: 'nga-title' }, '帖子'),
        createElement('a', {
          className: 'nga-external', href: `https://bbs.nga.cn/read.php?tid=${readTid}`,
          target: '_blank', rel: 'noopener', style: { marginLeft: 'auto' },
        }, '网页版'),
      ),
      readStatus === 'loading'
        ? createElement('div', { className: 'nga-status' }, '加载中…')
        : readStatus === 'error'
          ? createElement('div', { className: 'nga-status' }, '加载失败，点「网页版」在浏览器里打开')
          : readTitle !== ''
            ? createElement('div', { className: 'nga-read-title' }, readTitle)
            : null,
      // 翻页 + 楼层跳转栏
      readTid !== null && readStatus !== 'loading'
        ? createElement('div', { className: 'nga-pager' },
            createElement('button', {
              className: 'nga-back', type: 'button',
              disabled: readPage <= 1,
              onClick: () => loadReadPage(readPage - 1),
            }, '← 上一页'),
            createElement('span', { className: 'nga-pager-info' }, `第 ${readPage}/${totalPages} 页 · ${totalFloors} 楼`),
            createElement('button', {
              className: 'nga-back', type: 'button',
              disabled: readPage >= totalPages,
              onClick: () => loadReadPage(readPage + 1),
            }, '下一页 →'),
            createElement('input', {
              className: 'nga-floor-input',
              value: floorJump,
              placeholder: '跳#楼层',
              'aria-label': '跳转到楼层',
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFloorJump(e.target.value),
              onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') { jumpToFloor(floorJump); setFloorJump('') }
              },
            }),
          )
        : null,
      posts === null
        ? null
        : posts.length === 0
          ? createElement('div', { className: 'nga-empty' }, '这个帖子暂时没有内容')
          : createElement('div', { className: 'nga-read-list' },
            ...posts.map(post => createElement('div', { key: post.pid, className: 'nga-post' },
              createElement('div', { className: 'nga-post-head' },
                createElement('span', { className: 'nga-post-author' }, post.author === '' ? '匿名' : post.author),
                createElement('span', null, post.floor <= 0 ? '主楼' : `#${post.floor}`),
              ),
              createElement('div', { className: 'nga-post-content' },
                post.content === '' ? '（内容为空）' : post.content,
              ),
              ...(post.images ?? []).map(src => createElement('img', {
                key: src,
                src,
                alt: '',
                loading: 'lazy',
                className: 'nga-post-img',
              })),
            )),
          ),
    )
  }

  // ── Cookie 设置视图 ─────────────────────────────────────────────
  if (cookieView) {
    return createElement('div', { className: 'nga-root' },
      createElement('div', { className: 'nga-head' },
        createElement('button', { className: 'nga-back', type: 'button', onClick: () => setCookieView(false) }, '← 返回'),
        createElement('h2', { className: 'nga-title' }, 'NGA 登录 Cookie'),
      ),
      createElement('div', { className: 'nga-cookie-form' },
        createElement('p', { className: 'nga-cookie-tip' },
          '在浏览器登录 bbs.nga.cn 后，F12 → Application → Cookies 里复制这两个值（注意是驼峰命名）：'),
        createElement('label', null, 'ngaPassportUid（账号 UID）'),
        createElement('input', {
          className: 'nga-cookie-input',
          value: cUid,
          placeholder: '例如 12345678',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCUid(e.target.value),
        }),
        createElement('label', null, 'ngaPassportCid（会话凭证）'),
        createElement('input', {
          className: 'nga-cookie-input',
          value: cCid,
          placeholder: '浏览器里复制的 cid 值',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCCid(e.target.value),
        }),
        createElement('button', {
          className: 'nga-cookie-save', type: 'button',
          disabled: cookieStatus === 'saving',
          onClick: saveCookies,
        }, cookieStatus === 'saving' ? '保存中…' : '保存'),
        cookieStatus === 'ok'
          ? createElement('div', { className: 'nga-cookie-msg ok' }, '✅ 已保存，板块数据将立即刷新')
          : cookieStatus === 'error'
            ? createElement('div', { className: 'nga-cookie-msg err' }, '❌ 保存失败，请检查 uid/cid 是否完整')
            : null,
        createElement('p', { className: 'nga-cookie-warn' },
          '⚠ 这是你的 NGA 账号凭证，仅保存在本机，不要外传。'),
      ),
    )
  }

  // ── 板块/帖子列表视图 ───────────────────────────────────────────
  return createElement('div', { className: 'nga-root' },
    needCookies
      ? createElement('div', { className: 'nga-cookie-banner' },
          '⚠ 未配置 NGA 登录 Cookie，帖子可能无法加载。',
          createElement('button', { className: 'nga-banner-btn', type: 'button', onClick: openCookieView }, '去填写'),
        )
      : null,
    createElement('div', { className: 'nga-head' },
      createElement('h2', { className: 'nga-title' }, forumName !== undefined ? forumName : 'NGA'),
      createElement('button', {
        className: 'nga-refresh', type: 'button', onClick: refresh,
        disabled: fid === '' || status === 'loading',
      }, status === 'loading' ? '加载中…' : '刷新'),
      createElement('button', { className: 'nga-refresh', type: 'button', onClick: openCookieView }, 'Cookie'),
    ),
    forums.length > 0
      ? createElement('div', { className: 'nga-forums', role: 'tablist', 'aria-label': '板块列表' },
        ...forums.map(forum => {
          const isCustom = customForums.some(f => f.fid === forum.fid)
          return createElement('div', {
            key: forum.fid,
            className: 'nga-forum-row',
            role: 'tab',
            'aria-selected': forum.fid === fid,
            'data-active': forum.fid === fid ? true : undefined,
            title: `${forum.name} (fid=${forum.fid})`,
            onClick: () => selectForum(forum.fid),
          },
            createElement('span', null, forum.name),
            createElement('span', { className: 'nga-fid-hint' }, `fid=${forum.fid}`),
            isCustom
              ? createElement('button', {
                  className: 'nga-chip-x',
                  type: 'button',
                  title: '删除这个板块',
                  'aria-label': `删除板块 ${forum.name}`,
                  onClick: (e: React.MouseEvent) => { e.stopPropagation(); removeCustom(forum.fid) },
                }, '×')
              : null,
          )
        }),
      )
      : null,
    createElement('div', { className: 'nga-add' },
      createElement('input', {
        value: draft,
        placeholder: '加板块 fid',
        'aria-label': '自定义板块 fid',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') addCustom() },
      }),
      createElement('button', { type: 'button', onClick: addCustom }, '添加'),
      createElement('input', {
        value: tidDraft,
        placeholder: '打开帖子 tid',
        'aria-label': '按 tid 打开帖子',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTidDraft(e.target.value),
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') openTid() },
      }),
      createElement('button', { type: 'button', onClick: openTid }, '打开'),
    ),
    fid === ''
      ? createElement('div', { className: 'nga-empty' }, '选一个板块开始浏览')
      : status === 'error'
        ? createElement('div', { className: 'nga-status' }, '加载失败，请刷新重试')
        : threads === null
          ? createElement('div', { className: 'nga-status' }, '加载中…')
          : threads.length === 0
            ? createElement('div', { className: 'nga-empty' },
              threadError !== undefined ? threadError : '这个板块暂时没有帖子')
            : createElement('div', { className: 'nga-list-wrap' },
              createElement('div', { className: 'nga-list', role: 'list' },
                ...threads.map(thread => createElement('a', {
                  key: thread.tid,
                  className: 'nga-thread',
                  role: 'listitem',
                  href: `https://bbs.nga.cn/read.php?tid=${thread.tid}`,
                  target: '_blank',
                  rel: 'noopener',
                  onClick: (e: React.MouseEvent) => { e.preventDefault(); openThreadView(thread.tid) },
                },
                  createElement('div', { className: 'nga-thread-title' }, thread.title),
                  createElement('div', { className: 'nga-thread-meta' },
                    createElement('span', null, thread.author === '' ? '未知作者' : thread.author),
                    createElement('span', null, thread.reply >= 0 ? `${thread.reply} 回复` : ''),
                    createElement('span', { style: { marginLeft: 'auto' } }, '阅读 ›'),
                  ),
                )),
              ),
              // Board paging: NGA reports no page count, so 下一页 shows only
              // when the host confirmed the following page has topics.
              createElement('div', { className: 'nga-pager' },
                createElement('button', {
                  className: 'nga-back',
                  type: 'button',
                  disabled: page <= 1 || status === 'loading',
                  onClick: () => { setPage(p => Math.max(1, p - 1)) },
                }, '← 上一页'),
                createElement('span', { className: 'nga-pager-info' }, `第 ${page} 页`),
                createElement('button', {
                  className: 'nga-back',
                  type: 'button',
                  disabled: !hasNext || status === 'loading',
                  onClick: () => { setPage(p => p + 1) },
                }, '下一页 →'),
              ),
            ),
  )
}

/* ------------------------------------------------------------------ */
/* Mounting: sidebar tab (better-sidebar) or fallback dock.            */
/* ------------------------------------------------------------------ */

export const inject: string[] = []

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = ID
    tag.dataset.pluginCss = STYLE_TAG_ID
    tag.textContent = css
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, `${ID}: styles`)

  const betterSidebar = ctx.get('betterSidebar') as { registerTab?: (descriptor: unknown) => () => void } | undefined

  if (betterSidebar?.registerTab) {
    ctx.effect(() => betterSidebar.registerTab!({
      id: 'dsh-nga:forum',
      title: 'NGA',
      icon: (size: number) => createElement('span', { style: { fontSize: size * 0.62, fontWeight: 700 } }, 'N'),
      single: true,
      component: () => createElement(NgaPanel),
    }), `${ID}: better-sidebar tab`)
    return
  }

  // Fallback dock: floating toggle + right panel.
  let root: Root | null = null
  const dockHost = document.createElement('div')
  document.body.appendChild(dockHost)

  const render = (open: boolean): void => {
    if (root === null) root = createRoot(dockHost)
    root.render(createElement('div', null,
      createElement('button', {
        className: 'nga-fab',
        type: 'button',
        'data-open': open ? true : undefined,
        title: open ? '收起 NGA' : '打开 NGA 面板',
        'aria-label': open ? '收起 NGA 面板' : '打开 NGA 面板',
        'aria-expanded': open,
        onClick: () => render(!open),
      }, 'N'),
      open ? createElement('div', { className: 'nga-dock' }, createElement(NgaPanel)) : null,
    ))
  }
  render(false)

  ctx.effect(() => {
    return () => {
      root?.unmount()
      dockHost.remove()
    }
  }, `${ID}: dock lifecycle`)
}
