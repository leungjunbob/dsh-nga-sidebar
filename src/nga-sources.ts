/**
 * Shared NGA contracts used by both the host proxy and browser client.
 *
 * The host half never lets the browser pick a fetch target: the client sends
 * only a numeric `fid` / `page`, and the host builds the NGA URL itself from
 * a hard-coded base. This keeps the proxy SSRF-free by construction.
 */

/** One forum (板块). */
export interface NgaForum {
  /** NGA board id; may be negative (e.g. -7 = 综合主版). */
  fid: string
  /** Board display name. */
  name: string
}

/** One thread (帖子) row. */
export interface NgaThread {
  /** Thread id, used for read.php?tid=<tid>. */
  tid: string
  /** Thread title, HTML entities decoded. */
  title: string
  /** Author display name; empty when the row did not expose one. */
  author: string
  /** Reply count; -1 when unknown. */
  reply: number
}

/** Payload of {@link FORUMS_ROUTE}. */
export interface ForumsPayload {
  readonly forums: readonly NgaForum[]
}

/** Payload of {@link THREADS_ROUTE}. */
export interface ThreadsPayload {
  readonly fid: string
  readonly page: number
  /** Real board name from the NGA response (`__F`), when available. */
  readonly forumName?: string
  /** Human-readable fetch error (未登录/权限不足/被拦), when the board failed. */
  readonly error?: string
  /** True when no NGA login cookies are configured on the host. */
  readonly needCookies?: boolean
  readonly threads: readonly NgaThread[]
}

/** One post (主楼或回复) in a thread. */
export interface NgaPost {
  /** Post id. */
  pid: string
  /** Floor number; 1 = 主楼. */
  floor: number
  /** Author display name; empty when unknown. */
  author: string
  /** Post content, cleaned to plain text. */
  content: string
  /** Absolute image URLs extracted from `[img]...[/img]`, in order. */
  images?: readonly string[]
}

/** Payload of {@link READ_ROUTE}. */
export interface ReadPayload {
  readonly tid: string
  readonly title: string
  /** Current page of this payload (1-based). */
  readonly page: number
  /** Total pages in the thread. */
  readonly totalPages: number
  /** Total floors (including the main post, lou=0). */
  readonly totalFloors: number
  readonly posts: readonly NgaPost[]
}

/** Floors per page served by NGA read.php (`__R__ROWS_PAGE`). */
export const NGA_FLOORS_PER_PAGE = 20

/** Host route serving the forum list (parsed from the NGA index page). */
export const FORUMS_ROUTE = '/dsh-nga/forums.json'

/** Host route serving one page of threads for a board. */
export const THREADS_ROUTE = '/dsh-nga/threads.json'

/** Host route serving one thread's posts for in-panel reading. */
export const READ_ROUTE = '/dsh-nga/read.json'

/** Host route for the in-panel cookie form (GET status / POST uid+cid). */
export const SET_COOKIES_ROUTE = '/dsh-nga/set-cookies.json'

/** NGA web origin the host proxy is allowed to fetch. */
export const NGA_ORIGIN = 'https://bbs.nga.cn'

/** Built-in fallback forums used when the live index parse fails or is empty.
 * fid 7 verified readable and its real name confirmed via `__F` (Sep 2026);
 * fid 604 is readable but its name is not yet confirmed. */
export const FALLBACK_FORUMS: readonly NgaForum[] = [
  { fid: '7', name: '艾泽拉斯议事厅 - Hall of Azeroth' },
  { fid: '604', name: '板块 604' },
]
