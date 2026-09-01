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
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type NgaForum, type NgaPost, type NgaThread } from './nga-sources.ts';
export declare const name = "dsh-nga-sidebar";
/** The slice of the host context this plugin uses (structural — no package
 * type imports, so the plugin builds standalone without dsh devDeps). */
interface HostContext {
    webServer: {
        register(route: {
            kind: 'exact';
            path: string;
            handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
        }): () => void;
    };
    effect(callback: () => (() => void), label?: string): void;
}
export declare const inject: string[];
/**
 * NGA's guest JS challenge (ERROR 15): the block page carries JS that sets a
 * `guestJs=<timestamp>_<nonce>` cookie and reloads. The value is embedded in
 * the page itself, so the host can solve it without executing JavaScript.
 */
export declare function isChallengePage(text: string): boolean;
/** Extract the server-issued `guestJs` value from a challenge page. */
export declare function extractGuestJs(text: string): string | null;
/** Decode the numeric/hex HTML entities NGA loves (&#12304; etc). */
export declare function decodeEntities(text: string): string;
/**
 * Parse one thread.php HTML page into rows. Each row is found by its
 * `read.php?tid=` anchor; author and reply count are best-effort extras from
 * the same `<tr>` block and are empty/-1 when the markup does not expose them.
 */
export declare function parseThreads(html: string): readonly NgaThread[];
/** Extract the topic list from a thread.php JSON payload. */
export declare function parseThreadJson(payload: unknown): readonly NgaThread[];
/** Best-effort real board name from a thread.php JSON payload (`__F`). */
export declare function extractForumName(payload: unknown): string | undefined;
/** Extract absolute image URLs from `[img]...[/img]` blocks or `<img src>`. */
export declare function extractImages(raw: string): string[];
/**
 * Clean NGA post content (HTML-ish with BBCode) into readable plain text:
 * entities decoded, `<br>` → newline, tags stripped, the quoted-reply
 * header normalised ("Reply to [pid]Reply[/pid] Post by X (date)" →
 * "Reply Post by X (date)") and separated from the body.
 */
export declare function cleanContent(raw: string): string;
/** Extract the title + posts from a read.php JSON payload. */
export declare function parseReadJson(payload: unknown): {
    title: string;
    posts: NgaPost[];
    page: number;
    totalPages: number;
    totalFloors: number;
};
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
export declare function parseNgaJson(text: string): unknown;
/**
 * Walk an arbitrary parsed object and collect objects that look like boards:
 * a numeric `fid` plus a name-ish string field. Tolerant of the exact
 * bbs_index_data.js shape, which is not part of the documented contract.
 */
export declare function collectForums(node: unknown, out?: NgaForum[], seen?: Set<string>): readonly NgaForum[];
/** Parse forum links out of the NGA index HTML as a second fallback. */
export declare function parseForumsFromHtml(html: string): readonly NgaForum[];
export declare const DEBUG_ROUTE = "/dsh-nga/debug.json";
/** Map a captured 4xx body head to a human-readable reason. */
export declare function classifyError(head: string | undefined): string | undefined;
/** Salvage a uid→username map from a possibly-truncated read.php JSON. */
export declare function extractUsernames(jsonText: string): Map<string, string>;
/** Parse the noBBCode HTML page into posts (fallback for truncated JSON). */
export declare function parseReadHtml(html: string, usernames: ReadonlyMap<string, string>): {
    title: string;
    posts: NgaPost[];
    page: number;
    totalPages: number;
    totalFloors: number;
};
export declare function apply(ctx: HostContext): void;
export {};
