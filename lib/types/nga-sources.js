/**
 * Shared NGA contracts used by both the host proxy and browser client.
 *
 * The host half never lets the browser pick a fetch target: the client sends
 * only a numeric `fid` / `page`, and the host builds the NGA URL itself from
 * a hard-coded base. This keeps the proxy SSRF-free by construction.
 */
/** Floors per page served by NGA read.php (`__R__ROWS_PAGE`). */
export const NGA_FLOORS_PER_PAGE = 20;
/** Host route serving the forum list (parsed from the NGA index page). */
export const FORUMS_ROUTE = '/dsh-nga/forums.json';
/** Host route serving one page of threads for a board. */
export const THREADS_ROUTE = '/dsh-nga/threads.json';
/** Host route serving one thread's posts for in-panel reading. */
export const READ_ROUTE = '/dsh-nga/read.json';
/** Host route for the in-panel cookie form (GET status / POST uid+cid). */
export const SET_COOKIES_ROUTE = '/dsh-nga/set-cookies.json';
/** NGA web origin the host proxy is allowed to fetch. */
export const NGA_ORIGIN = 'https://bbs.nga.cn';
/** Built-in fallback forums used when the live index parse fails or is empty.
 * fid 7 verified readable and its real name confirmed via `__F` (Sep 2026);
 * fid 604 is readable but its name is not yet confirmed. */
export const FALLBACK_FORUMS = [
    { fid: '7', name: '艾泽拉斯议事厅 - Hall of Azeroth' },
    { fid: '604', name: '板块 604' },
];
