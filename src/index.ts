/**
 * dsh-nga-sidebar, host half: a minimal, SSRF-safe NGA proxy.
 *
 * The browser half cannot fetch bbs.nga.cn directly (CORS), so the host
 * fetches the NGA web pages server-side and returns trimmed JSON. The client
 * never supplies a URL — only a numeric `fid` and `page` — and the host
 * builds the NGA request from a hard-coded origin, so there is no
 * user-controlled fetch target. Two routes:
 *
 *  - `/dsh-nga/forums.json`  — board list (static NGA index JSON, with
 *    HTML-index and built-in fallbacks)
 *  - `/dsh-nga/threads.json` — one page of threads for one board
 *
 * Notes on NGA access (verified against the live site, Sep 2026):
 *  - the `__output=11` JSON API returns 403 "未登录" for anonymous visitors,
 *    so the threads route uses the plain HTML page (`thread.php`) instead,
 *    with a browser User-Agent — exactly what an anonymous browser sees.
 *  - boards that require login will still come back empty; the panel falls
 *    back to whatever boards are readable anonymously.
 *
 * @module dsh-nga-sidebar
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  FORUMS_ROUTE, THREADS_ROUTE, READ_ROUTE, SET_COOKIES_ROUTE, NGA_ORIGIN, FALLBACK_FORUMS,
  type ForumsPayload, type NgaForum, type NgaPost, type NgaThread,
  type ReadPayload, type ThreadsPayload,
} from './nga-sources.ts'

export const name = 'dsh-nga-sidebar'

/** The slice of the host context this plugin uses (structural — no package
 * type imports, so the plugin builds standalone without dsh devDeps). */
interface HostContext {
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler(req: IncomingMessage, res: ServerResponse): Promise<void>
    }): () => void
  }
  effect(callback: () => (() => void), label?: string): void
}

export const inject = ['webServer']

/** Static board-entry data documented in nga-api-doc (首页版面入口). */
const NGA_INDEX_DATA_URL = 'https://img4.nga.178.com/proxy/cache_attach/bbs_index_data.js'
/** NGA board page (HTML fallback for the forums route). */
const NGA_INDEX_URL = `${NGA_ORIGIN}/`
/** NGA thread list as the plain anonymous-readable HTML page. */
const NGA_THREAD_LIST_URL = (fid: string, page: number): string =>
  `${NGA_ORIGIN}/thread.php?fid=${fid}&page=${page}`
/**
 * NGA thread list as JSON. This path skips the JS guest challenge entirely
 * but requires a logged-in session (anonymous answers 403「未登录」).
 */
const NGA_THREAD_JSON_URL = (fid: string, page: number): string =>
  `${NGA_ORIGIN}/thread.php?fid=${fid}&page=${page}&__output=11`
/** NGA thread content as JSON (one page of posts). */
const NGA_READ_JSON_URL = (tid: string, page = 1): string =>
  `${NGA_ORIGIN}/read.php?tid=${tid}&page=${page}&__output=11`
/** NGA thread content as HTML — fallback when the JSON is truncated. */
const NGA_READ_HTML_URL = (tid: string, page: number): string =>
  `${NGA_ORIGIN}/read.php?tid=${tid}&page=${page}&noBBCode`

/** Anonymous browsing needs a real browser UA. */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
/** Per nga-api-doc, the app UA unlocks fields on the JSON API. */
const NGA_APP_UA = 'NGA_WP_JW'

const FETCH_TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 4 * 1024 * 1024
const MAX_PAGE = 9999
const MAX_CONCURRENT = 6
const RATE_WINDOW_MS = 10_000
const MAX_PER_WINDOW = 60

let active = 0
let windowStartedAt = 0
let callsInWindow = 0

/**
 * Process-wide NGA cookie jar. NGA 403s cookie-less anonymous requests
 * (ERROR 1: 未登录), so the host first visits the homepage to collect
 * Set-Cookie, then sends those cookies with every later request.
 */
let baseCookies = ''
let cookieReady: Promise<void> | null = null

/**
 * Cookie persistence file. Resolved from DSH_NGA_COOKIES_FILE, else a default
 * under DSH_HOME (or `~/.dsh`), so the in-panel cookie form survives restarts
 * without any batch-file edits.
 */
const COOKIE_FILE = typeof process !== 'undefined'
  ? (process.env.DSH_NGA_COOKIES_FILE ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-nga-cookies.txt'))
  : ''

/**
 * Optional logged-in session cookies. Sources, in order:
 *  - DSH_NGA_COOKIES env var (inline string)
 *  - the cookie file ({@link COOKIE_FILE}) — read at startup and written by
 *    the in-panel cookie form, so no batch-file edits are needed.
 */
const USER_COOKIES = typeof process !== 'undefined' ? (process.env.DSH_NGA_COOKIES ?? '') : ''
if (USER_COOKIES !== '') {
  baseCookies = USER_COOKIES
} else if (COOKIE_FILE !== '') {
  try {
    const text = readFileSync(COOKIE_FILE, 'utf8').trim()
    if (text !== '') baseCookies = text
  } catch {
    // Cookie file missing/unreadable — anonymous (challenge) mode only.
  }
}

/** Collect `name=value` pairs from a response's Set-Cookie headers. */
function collectSetCookies(res: Response): string[] {
  const raw: string[] = typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
    : []
  return raw.map(cookie => cookie.split(';')[0]!.trim()).filter(cookie => cookie !== '')
}

/** Merge newly-set cookies into the jar. */
function mergeCookies(newCookies: readonly string[]): void {
  if (newCookies.length === 0) return
  const jar = new Map<string, string>()
  for (const pair of `${baseCookies}; ${newCookies.join('; ')}`.split(';')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
  baseCookies = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * NGA's guest JS challenge (ERROR 15): the block page carries JS that sets a
 * `guestJs=<timestamp>_<nonce>` cookie and reloads. The value is embedded in
 * the page itself, so the host can solve it without executing JavaScript.
 */
export function isChallengePage(text: string): boolean {
  return text.includes('(ERROR: 15') || text.includes("document.cookie = 'guestJs=")
}

/** Extract the server-issued `guestJs` value from a challenge page. */
export function extractGuestJs(text: string): string | null {
  const m = /guestJs=([A-Za-z0-9_.-]+)/.exec(text)
  return m === null ? null : m[1]!
}

/** Adopt the challenge cookie into the jar; true when solved. */
function solveChallenge(text: string): boolean {
  const guest = extractGuestJs(text)
  if (guest === null) return false
  mergeCookies([`guestJs=${guest}`, 'lastpath=0'])
  return true
}

/** One raw request with the given cookie; returns status + body — challenge
 * pages are included so the challenge loop can actually see them. */
async function rawFetch(url: string, cookie: string, ua: string = BROWSER_UA): Promise<{ status: number; text: string | null }> {
  try {
    const headers: Record<string, string> = {
      'user-agent': ua,
      'referer': NGA_ORIGIN + '/',
      'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9',
    }
    if (cookie !== '') headers.cookie = cookie
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    mergeCookies(collectSetCookies(res))
    const text = await res.text()
    return { status: res.status, text: text.length <= MAX_BODY_BYTES ? text : null }
  } catch {
    return { status: 0, text: null }
  }
}

/** Visit the NGA homepage once and pass the guest JS challenge if needed. */
function ensureCookies(): Promise<void> {
  if (baseCookies !== '') return Promise.resolve()
  cookieReady ??= (async () => {
    for (let attempt = 0; attempt < 2 && baseCookies === ''; attempt += 1) {
      const { text } = await rawFetch(NGA_ORIGIN + '/', '')
      if (text !== null && isChallengePage(text)) solveChallenge(text)
    }
  })()
  return cookieReady
}

/** Fetch one NGA page, solving the guest JS challenge on demand. */
async function fetchWithChallenges(url: string, cookie: string, ua: string = BROWSER_UA): Promise<string | null> {
  await ensureCookies()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { status, text } = await rawFetch(url, cookie, ua)
    if (text === null) return null
    if (isChallengePage(text)) {
      if (!solveChallenge(text)) return null
      const sep = url.includes('?') ? '&' : '?'
      url = `${url}${sep}rand=${Math.floor(Math.random() * 1000)}`
      continue
    }
    if (status >= 400) {
      lastDiag.lastHttpError = { status, head: text.slice(0, 200) }
      return null
    }
    return text
  }
  return null
}

/** Fetch an NGA page with the shared anonymous cookie jar. */
async function fetchNga(url: string): Promise<string | null> {
  return fetchWithChallenges(url, baseCookies, BROWSER_UA)
}

/** A board id is a short signed integer — nothing else is ever accepted. */
function isValidFid(raw: string | null): raw is string {
  return raw !== null && /^-?\d{1,6}$/.test(raw)
}

function isValidPage(raw: string | null): raw is string {
  return raw !== null && /^\d{1,4}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= MAX_PAGE
}

function takeRateSlot(now = Date.now()): boolean {
  if (now - windowStartedAt >= RATE_WINDOW_MS) {
    windowStartedAt = now
    callsInWindow = 0
  }
  if (callsInWindow >= MAX_PER_WINDOW) return false
  callsInWindow += 1
  return true
}

/** Decode the numeric/hex HTML entities NGA loves (&#12304; etc). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim()
}

/**
 * Parse one thread.php HTML page into rows. Each row is found by its
 * `read.php?tid=` anchor; author and reply count are best-effort extras from
 * the same `<tr>` block and are empty/-1 when the markup does not expose them.
 */
export function parseThreads(html: string): readonly NgaThread[] {
  const rows = html.split(/<tr/i).slice(1)
  const out: NgaThread[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const m = /read\.php\?tid=(\d+)[^>]*>([\s\S]*?)<\/a>/i.exec(row)
    if (m === null) continue
    const tid = m[1]!
    if (seen.has(tid)) continue
    const title = decodeEntities(m[2]!.replace(/<[^>]+>/g, ''))
    if (title === '') continue
    seen.add(tid)
    const authorM = /<span class="author">([\s\S]*?)<\/span>/i.exec(row)
    const replyM = /<span class="r1">\s*<b>\s*(\d+)/i.exec(row)
      ?? /<td[^>]*class="[^"]*num[^"]*"[^>]*>\s*(\d+)/i.exec(row)
    out.push({
      tid,
      title,
      author: authorM === null ? '' : decodeEntities(authorM[1]!.replace(/<[^>]+>/g, '')),
      reply: replyM === null ? -1 : Number(replyM[1]!),
    })
  }
  return out
}

/** One topic record as exposed by NGA's thread.php JSON API. */
interface RawTopic {
  readonly tid?: unknown
  readonly subject?: unknown
  readonly title?: unknown
  readonly author?: unknown
  readonly authorid?: unknown
  readonly replynum?: unknown
  readonly replies?: unknown
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function asTopic(raw: unknown): NgaThread | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const t = raw as RawTopic
  const tid = str(t.tid)
  if (!/^\d+$/.test(tid)) return undefined
  const title = decodeEntities(str(t.subject !== undefined ? t.subject : t.title))
  if (title === '') return undefined
  const replyRaw = t.replynum !== undefined ? t.replynum : t.replies
  return {
    tid,
    title,
    author: decodeEntities(str(t.author !== undefined ? t.author : t.authorid)),
    reply: typeof replyRaw === 'number' && Number.isFinite(replyRaw) ? replyRaw : -1,
  }
}

/** Extract the topic list from a thread.php JSON payload. */
export function parseThreadJson(payload: unknown): readonly NgaThread[] {
  if (typeof payload !== 'object' || payload === null) return []
  const root = payload as Record<string, unknown>
  const data = (typeof root.data === 'object' && root.data !== null ? root.data : root) as Record<string, unknown>
  const topics = data.__T ?? data.topics ?? data.list
  if (!Array.isArray(topics)) return []
  const out: NgaThread[] = []
  const seen = new Set<string>()
  for (const item of topics) {
    const t = asTopic(item)
    if (t !== undefined && !seen.has(t.tid)) {
      seen.add(t.tid)
      out.push(t)
    }
  }
  return out
}

/** Best-effort real board name from a thread.php JSON payload (`__F`). */
export function extractForumName(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const root = payload as Record<string, unknown>
  const data = (typeof root.data === 'object' && root.data !== null ? root.data : root) as Record<string, unknown>
  const forum = data.__F as Record<string, unknown> | undefined
  if (typeof forum === 'object' && forum !== null) {
    const name = forum.name ?? forum.forum_name
    if (typeof name === 'string' && name.trim() !== '') return decodeEntities(name.trim())
  }
  return undefined
}

/** NGA attachment base for resolving relative `[img]` paths. */
const NGA_ATTACH_BASE = 'https://img.nga.cn/attachments/'

/** Extract absolute image URLs from `[img]...[/img]` blocks or `<img src>`. */
export function extractImages(raw: string): string[] {
  const urls: string[] = []
  const re = /\[img(?:\s*=\s*\d+)?\]([^\]]+?)\[\/img\]|<img[^>]*src=['"]([^'"]+)['"]/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const path = (m[1] ?? m[2] ?? '').trim()
    if (path === '') continue
    const resolved = path.startsWith('./') ? path.slice(2) : path
    urls.push(/^https?:/i.test(resolved) ? resolved : NGA_ATTACH_BASE + resolved)
  }
  return urls
}

/**
 * Clean NGA post content (HTML-ish with BBCode) into readable plain text:
 * entities decoded, `<br>` → newline, tags stripped, the quoted-reply
 * header normalised ("Reply to [pid]Reply[/pid] Post by X (date)" →
 * "Reply Post by X (date)") and separated from the body.
 */
export function cleanContent(raw: string): string {
  return decodeEntities(raw)
    .replace(/\[img(?:\s*=\s*\d+)?\][^\]]*\[\/img\]/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[b\]Reply to \[pid=[^\]]*\]Reply\[\/pid\] Post by /gi, 'Reply Post by ')
    .replace(/\[(?:uid|pid)=[^\]]*\]/gi, '')
    .replace(/\[\/(?:uid|pid|b)\]/gi, '')
    .replace(/\[[a-zA-Z][^\]]*\]/g, '')
    .replace(/\[\/[a-zA-Z]+\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Extract the title + posts from a read.php JSON payload. */
export function parseReadJson(payload: unknown): {
  title: string
  posts: NgaPost[]
  page: number
  totalPages: number
  totalFloors: number
} {
  const empty = { title: '', posts: [], page: 1, totalPages: 1, totalFloors: 0 }
  if (typeof payload !== 'object' || payload === null) return empty
  const root = payload as Record<string, unknown>
  const data = (typeof root.data === 'object' && root.data !== null ? root.data : root) as Record<string, unknown>
  // uid → username map (replies carry only `authorid`).
  const users = (typeof data.__U === 'object' && data.__U !== null ? data.__U : {}) as Record<string, unknown>
  const usernameOf = (uid: unknown): string => {
    const key = str(uid)
    if (key === '') return ''
    const entry = users[key] as Record<string, unknown> | undefined
    return typeof entry === 'object' && entry !== null && typeof entry.username === 'string' ? entry.username : ''
  }
  const thread = (typeof data.__T === 'object' && data.__T !== null ? data.__T : {}) as Record<string, unknown>
  let title = decodeEntities(str(thread.subject !== undefined ? thread.subject : thread.title))
  const posts: NgaPost[] = []
  const seen = new Set<string>()
  // 主楼（NGA 把主楼作为 __R 的第一条，pid=0/lou=0；__T 通常不带 content）
  const mainPid = str(thread.pid !== undefined ? thread.pid : thread.tid)
  if (mainPid !== '' && typeof thread.content === 'string' && !seen.has(mainPid)) {
    seen.add(mainPid)
    posts.push({
      pid: mainPid,
      floor: 1,
      author: decodeEntities(str(thread.author)),
      content: cleanContent(thread.content),
      images: extractImages(thread.content),
    })
  }
  // 回复（含主楼条目 pid=0/lou=0）
  const replies = data.__R
  if (Array.isArray(replies)) {
    for (const item of replies) {
      if (typeof item !== 'object' || item === null) continue
      const reply = item as Record<string, unknown>
      const pid = str(reply.pid)
      if (pid === '' || seen.has(pid)) continue
      const contentRaw = typeof reply.content === 'string' ? reply.content : ''
      if (contentRaw.trim() === '') continue
      seen.add(pid)
      const floorRaw = reply.lou ?? reply.floor
      const author = decodeEntities(str(reply.author !== undefined ? reply.author : usernameOf(reply.authorid)))
      posts.push({
        pid,
        floor: typeof floorRaw === 'number' && Number.isFinite(floorRaw) ? floorRaw : seen.size,
        author,
        content: cleanContent(contentRaw),
        images: extractImages(contentRaw),
      })
    }
  }
  const page = typeof data.__PAGE === 'number' && data.__PAGE >= 1 ? data.__PAGE : 1
  const totalFloors = typeof data.__ROWS === 'number' ? data.__ROWS : posts.length
  const floorsPerPage = typeof data.__R__ROWS_PAGE === 'number' && data.__R__ROWS_PAGE > 0 ? data.__R__ROWS_PAGE : 20
  const totalPages = Math.max(1, Math.ceil(totalFloors / floorsPerPage))
  // Some threads omit __T entirely; the title then lives on the main-post
  // (__R[0]) `subject` field.
  if (title === '' && posts.length > 0 && posts[0]!.floor <= 0) {
    const first = (Array.isArray(data.__R) ? data.__R[0] : undefined) as Record<string, unknown> | undefined
    if (first !== undefined) {
      const subj = str(first.subject !== undefined ? first.subject : first.title)
      if (subj !== '') title = decodeEntities(subj)
    }
  }
  return { title, posts, page, totalPages, totalFloors }
}

/**
 * Normalise a loose NGA JS payload into a JSON object (used only for the
 * static board-entry file). Handles the documented quirks: assignment
 * prefixes, raw tabs inside strings, unquoted object keys.
 *
 * NGA's normal `__output=11` responses are valid JSON, so the raw body is
 * parsed first. Only when that fails is the loose-payload patch applied:
 * the patch regex is NOT string-aware, so it would corrupt BBCode inside
 * content strings — it must never run on valid JSON.
 */
export function parseNgaJson(text: string): unknown {
  let body = text.trim()
  const brace = body.indexOf('{')
  if (brace > 0) body = body.slice(brace)
  if (!body.startsWith('{')) return null
  // Raw tabs inside string values (the documented `alterinfo` quirk) break
  // JSON.parse. Minified NGA JSON has no tabs between tokens, so parking them
  // on a private-use char is string-safe and runs BEFORE parsing.
  const parked = body.replace(/\t/g, '\uE000')
  try {
    return JSON.parse(parked) as unknown
  } catch {
    // Last resort for genuinely loose payloads (unquoted keys). The regex is
    // NOT string-aware, so it must never run on valid JSON — it would corrupt
    // BBCode inside content strings.
    const quoted = parked.replace(/([,{ ])([A-Za-z_$][\w$]*):/g, '$1"$2":')
    try {
      return JSON.parse(quoted) as unknown
    } catch {
      return null
    }
  }
}

/**
 * Walk an arbitrary parsed object and collect objects that look like boards:
 * a numeric `fid` plus a name-ish string field. Tolerant of the exact
 * bbs_index_data.js shape, which is not part of the documented contract.
 */
export function collectForums(node: unknown, out: NgaForum[] = [], seen = new Set<string>()): readonly NgaForum[] {
  if (Array.isArray(node)) {
    for (const item of node) collectForums(item, out, seen)
    return out
  }
  if (typeof node !== 'object' || node === null) return out
  const record = node as Record<string, unknown>
  const fidRaw = record.fid
  if (fidRaw !== undefined) {
    const fid = str(fidRaw)
    if (/^-?\d{1,6}$/.test(fid)) {
      const name = str(record.name ?? record.title ?? record.forum_name ?? record.forum)
      if (name !== '' && !seen.has(fid)) {
        seen.add(fid)
        out.push({ fid, name: decodeEntities(name) })
      }
    }
  }
  for (const value of Object.values(record)) collectForums(value, out, seen)
  return out
}

/** Parse forum links out of the NGA index HTML as a second fallback. */
export function parseForumsFromHtml(html: string): readonly NgaForum[] {
  const out: NgaForum[] = []
  const seen = new Set<string>()
  const re = /thread\.php\?fid=(-?\d+)[^>]*>([^<]{1,40})<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const fid = m[1]!
    const name = decodeEntities(m[2]!)
    if (name === '' || seen.has(fid)) continue
    seen.add(fid)
    out.push({ fid, name })
  }
  return out
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(body))
}

/** Collect a small JSON request body. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8')
      if (data.length > 4096) {
        req.destroy()
        resolve('')
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

/** Last fetch diagnostics, exposed at {@link DEBUG_ROUTE} for troubleshooting. */
let lastDiag: Record<string, unknown> = {}
export const DEBUG_ROUTE = '/dsh-nga/debug.json'

/** Map a captured 4xx body head to a human-readable reason. */
export function classifyError(head: string | undefined): string | undefined {
  if (head === undefined) return undefined
  if (head.includes('\\u672a\\u767b\\u5f55') || head.includes('未登录')) return '此板块需要登录（可能要求更高权限）'
  if (head.includes('\\u6743\\u9650\\u4e0d\\u8db3') || head.includes('权限不足')) return '账号权限不足，无法浏览此板块'
  if (head.includes('guestJs') || head.includes('(ERROR: 15')) return '被 NGA 防爬拦截，请稍后重试'
  return undefined
}

/** Fetch with GBK decoding — the noBBCode HTML is `charset=GBK`. */
async function rawFetchGbk(url: string, cookie: string, ua: string = BROWSER_UA): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      'user-agent': ua,
      'referer': NGA_ORIGIN + '/',
      'accept': 'text/html,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9',
    }
    if (cookie !== '') headers.cookie = cookie
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    mergeCookies(collectSetCookies(res))
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const text = new TextDecoder('gbk').decode(buf)
    return text.length <= MAX_BODY_BYTES ? text : null
  } catch {
    return null
  }
}

/** Salvage a uid→username map from a possibly-truncated read.php JSON. */
export function extractUsernames(jsonText: string): Map<string, string> {
  const map = new Map<string, string>()
  const idx = jsonText.indexOf('"__U"')
  if (idx === -1) return map
  const open = jsonText.indexOf('{', idx)
  if (open === -1) return map
  let depth = 0
  let end = -1
  for (let i = open; i < jsonText.length; i++) {
    const ch = jsonText[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return map
  try {
    const users = JSON.parse(jsonText.slice(open, end + 1)) as Record<string, unknown>
    for (const [key, value] of Object.entries(users)) {
      if (typeof value === 'object' && value !== null) {
        const name = (value as Record<string, unknown>).username
        if (typeof name === 'string') map.set(key, name)
      }
    }
  } catch {
    // Partial data — best effort.
  }
  return map
}

/** Parse the noBBCode HTML page into posts (fallback for truncated JSON). */
export function parseReadHtml(
  html: string,
  usernames: ReadonlyMap<string, string>,
): { title: string; posts: NgaPost[]; page: number; totalPages: number; totalFloors: number } {
  const titleM = /<h3 id='postsubject0'>([\s\S]*?)<\/h3>/i.exec(html)
  let title = titleM === null ? '' : decodeEntities(titleM[1]!.replace(/<[^>]+>/g, '')).trim()
  const posts: NgaPost[] = []
  // Slice the post list area between its markers, then split per post by the
  // `post1strowN` marker positions — a naive `</tr>` match breaks on nested
  // tables inside post content.
  const areaStart = html.indexOf('<!--postliststart-->')
  const areaEnd = html.indexOf('<!--postlistend-->', areaStart >= 0 ? areaStart : 0)
  const area = areaStart === -1
    ? html
    : areaEnd === -1
      ? html.slice(areaStart)
      : html.slice(areaStart, areaEnd)
  const markers: { index: string; pos: number }[] = []
  const markerRe = /<tr id='post1strow(\d+)'/gi
  let mm: RegExpExecArray | null
  while ((mm = markerRe.exec(area)) !== null) markers.push({ index: mm[1]!, pos: mm.index })
  for (let i = 0; i < markers.length; i++) {
    const index = markers[i]!.index
    const block = area.slice(markers[i]!.pos, i + 1 < markers.length ? markers[i + 1]!.pos : area.length)
    const contentM = new RegExp(`<(?:p|span) id='postcontent${index}'[^>]*>([\\s\\S]*?)<\\/(?:p|span)>`, 'i').exec(block)
    if (contentM === null) continue
    const contentRaw = contentM[1]!
    if (contentRaw.trim() === '') continue
    const floorM = /<a name='l(\d+)'>/i.exec(block)
    const uidM = /nuke\.php\?func=ucp&uid=(\d+)/i.exec(block)
    const uid = uidM === null ? '' : uidM[1]!
    posts.push({
      pid: `h${index}`,
      floor: floorM === null ? posts.length : Number(floorM[1]!),
      author: uid !== '' && usernames.has(uid) ? decodeEntities(usernames.get(uid)!) : '',
      content: cleanContent(contentRaw),
      images: extractImages(contentRaw),
    })
    if (title === '') {
      const subjM = new RegExp(`<h3 id='postsubject${index}'>([\\s\\S]*?)<\\/h3>`, 'i').exec(block)
      if (subjM !== null) {
        const subj = decodeEntities(subjM[1]!.replace(/<[^>]+>/g, '')).trim()
        if (subj !== '') title = subj
      }
    }
  }
  const pageM = /__PAGE\s*=\s*(\d+)/.exec(html)
  const rowsM = /__ROWS\s*=\s*(\d+)/.exec(html)
  const perM = /__CURRENT_PAGE_POSTS\s*=\s*(\d+)/.exec(html)
  const page = pageM === null ? 1 : Number(pageM[1]!)
  const totalFloors = rowsM === null ? posts.length : Number(rowsM[1]!)
  const per = perM === null ? 20 : Number(perM[1]!)
  const totalPages = per > 0 ? Math.max(1, Math.ceil(totalFloors / per)) : 1
  return { title, posts, page, totalPages, totalFloors }
}

/** Snapshot a fetch outcome without leaking the cookie values themselves. */
function describeBody(body: string | null, label: string): void {
  if (body === null) {
    lastDiag[label] = { got: false }
    return
  }
  lastDiag[label] = {
    got: true,
    bytes: body.length,
    challenge: isChallengePage(body),
    notLoggedIn: body.includes('未登录') || body.includes('\\u672a\\u767b\\u5f55') || body.includes('ERROR: 1'),
    head: body.slice(0, 120),
  }
}

export function apply(ctx: HostContext): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: DEBUG_ROUTE,
    async handler(_req, res): Promise<void> {
      sendJson(res, 200, {
        time: new Date().toISOString(),
        hasUserCookies: baseCookies !== '',
        cookieNames: baseCookies === '' ? [] : baseCookies.split(';').map(pair => pair.split('=')[0]!.trim()),
        ...lastDiag,
      })
    },
  }), 'dsh-nga:debug-route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FORUMS_ROUTE,
    async handler(_req, res): Promise<void> {
      if (!takeRateSlot() || active >= MAX_CONCURRENT) {
        sendJson(res, 429, { forums: FALLBACK_FORUMS })
        return
      }
      active += 1
      try {
        let forums: readonly NgaForum[] = []
        const staticBody = await fetchNga(NGA_INDEX_DATA_URL)
        if (staticBody !== null) {
          const parsed = parseNgaJson(staticBody)
          if (parsed !== null) forums = collectForums(parsed)
        }
        if (forums.length < 3) {
          const indexHtml = await fetchNga(NGA_INDEX_URL)
          if (indexHtml !== null) forums = parseForumsFromHtml(indexHtml)
        }
        const payload: ForumsPayload = { forums: forums.length > 0 ? forums : FALLBACK_FORUMS }
        sendJson(res, 200, payload)
      } finally {
        active -= 1
      }
    },
  }), 'dsh-nga:forums-route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: THREADS_ROUTE,
    async handler(req, res): Promise<void> {
      if (req.method !== 'GET') {
        res.setHeader('allow', 'GET')
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const query = new URL(req.url ?? '', 'http://localhost').searchParams
      const fid = query.get('fid')
      const page = query.get('page')
      if (!isValidFid(fid) || !isValidPage(page)) {
        sendJson(res, 400, { error: 'bad-fid-or-page' })
        return
      }
      if (!takeRateSlot() || active >= MAX_CONCURRENT) {
        sendJson(res, 429, { error: 'busy' })
        return
      }
      active += 1
      try {
        // Logged-in session → the JSON API path first: it skips the guest JS
        // challenge and returns real topic data (anonymous answers 未登录).
        let threads: readonly NgaThread[] = []
        let forumName: string | undefined
        if (baseCookies !== '') {
          lastDiag = { hasUserCookies: true, mode: 'json', at: new Date().toISOString() }
          const body = await fetchWithChallenges(NGA_THREAD_JSON_URL(fid, Number(page)), baseCookies, NGA_APP_UA)
          describeBody(body, 'jsonAttempt')
          if (body !== null) {
            const parsed = parseNgaJson(body)
            lastDiag.jsonParsed = parsed === null ? null : typeof parsed
            threads = parseThreadJson(parsed)
            forumName = extractForumName(parsed)
            lastDiag.jsonThreads = threads.length
          }
        } else {
          lastDiag = { hasUserCookies: false, mode: 'html', at: new Date().toISOString() }
        }
        // Fallback: anonymous HTML page with the guest-JS challenge flow.
        if (threads.length === 0) {
          const html = await fetchNga(NGA_THREAD_LIST_URL(fid, Number(page)))
          describeBody(html, 'htmlAttempt')
          if (html !== null) {
            threads = parseThreads(html)
            lastDiag.htmlThreads = threads.length
          }
        }
        const error = threads.length === 0
          ? classifyError((lastDiag.lastHttpError as { head?: string } | undefined)?.head)
          : undefined
        const payload: ThreadsPayload = { fid, page: Number(page), threads, forumName, error, needCookies: baseCookies === '' }
        sendJson(res, 200, payload)
      } finally {
        active -= 1
      }
    },
  }), 'dsh-nga:threads-route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: READ_ROUTE,
    async handler(req, res): Promise<void> {
      if (req.method !== 'GET') {
        res.setHeader('allow', 'GET')
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const query = new URL(req.url ?? '', 'http://localhost').searchParams
      const tid = query.get('tid')
      if (tid === null || !/^\d{1,12}$/.test(tid)) {
        sendJson(res, 400, { error: 'bad-tid' })
        return
      }
      const pageRaw = query.get('page')
      const page = pageRaw === null || !/^\d{1,4}$/.test(pageRaw)
        ? 1
        : Math.min(MAX_PAGE, Math.max(1, Number(pageRaw)))
      if (!takeRateSlot() || active >= MAX_CONCURRENT) {
        sendJson(res, 429, { error: 'busy' })
        return
      }
      active += 1
      try {
        const body = await fetchWithChallenges(NGA_READ_JSON_URL(tid, page), baseCookies, NGA_APP_UA)
        let parsed: { title: string; posts: NgaPost[]; page: number; totalPages: number; totalFloors: number } =
          { title: '', posts: [], page, totalPages: 1, totalFloors: 0 }
        if (body !== null) parsed = parseReadJson(parseNgaJson(body))
        // read.php JSON is sometimes truncated (documented); fall back to the
        // noBBCode HTML page, salvaging usernames from the JSON's __U.
        if (parsed.posts.length === 0) {
          const html = await rawFetchGbk(NGA_READ_HTML_URL(tid, page), baseCookies, BROWSER_UA)
          if (html !== null) {
            const usernames = body === null ? new Map<string, string>() : extractUsernames(body)
            const hp = parseReadHtml(html, usernames)
            if (hp.posts.length > 0) parsed = hp
          }
        }
        const payload: ReadPayload = {
          tid, title: parsed.title, posts: parsed.posts,
          page: parsed.page, totalPages: parsed.totalPages, totalFloors: parsed.totalFloors,
        }
        sendJson(res, 200, payload)
      } finally {
        active -= 1
      }
    },
  }), 'dsh-nga:read-route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SET_COOKIES_ROUTE,
    async handler(req, res): Promise<void> {
      if (req.method === 'GET') {
        sendJson(res, 200, { configured: baseCookies !== '' })
        return
      }
      if (req.method !== 'POST') {
        res.setHeader('allow', 'GET, POST')
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const raw = await readBody(req)
      let parsed: { uid?: unknown; cid?: unknown }
      try {
        parsed = JSON.parse(raw) as { uid?: unknown; cid?: unknown }
      } catch {
        parsed = {}
      }
      const uid = typeof parsed.uid === 'string' ? parsed.uid.trim() : ''
      const cid = typeof parsed.cid === 'string' ? parsed.cid.trim() : ''
      if (!/^\d{1,12}$/.test(uid) || cid === '' || cid.length > 128) {
        sendJson(res, 400, { ok: false, error: 'bad-uid-or-cid' })
        return
      }
      baseCookies = `ngaPassportUid=${uid}; ngaPassportCid=${cid}`
      if (COOKIE_FILE !== '') {
        try {
          writeFileSync(COOKIE_FILE, baseCookies, 'utf8')
        } catch {
          // Persistence is best-effort; the session still works this run.
        }
      }
      sendJson(res, 200, { ok: true, configured: true })
    },
  }), 'dsh-nga:set-cookies-route')
}
