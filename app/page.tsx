"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface Pool {
  mint: string;
  name: string;
  symbol: string;
  imageUrl?: string;
  createdAt: string;
  quoteSymbol: string;
  volume24hUsd: number;
  isRewardLaunch: boolean;
  holderCount: number | null;
  pendingTaxUsd: number | null;
  lastPayoutAt: string | null;
}

interface DormantEntry {
  mint: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  createdAt: string;
  lastPayoutAt: string | null;
  volume24hUsd: number;
  pendingTaxUsd: number;
  pendingUsd: number;
  holderCount: number;
  quoteSymbol: string;
  checkedAt: string;
}

interface Holder {
  address: string;
  amountRaw: string;
  decimals: number;
  owner: string | null;
}

// The watchlist API returns full pool shape (StonkfunPool fields) plus the same fee-tracking fields Pool
// already has — Pool's fields are a subset, so extending it is enough for every render/sort path below to
// just work. `notFound` flags a starred mint stonk.fun no longer has a pool for, so the row can say so
// instead of rendering nonsense (epoch-zero age, etc.) from the placeholder record the API sends back.
interface WatchlistEntry extends Pool {
  notFound?: boolean;
}

type Tab = "dormant" | "recent" | "watchlist";
type SortKey = "symbol" | "age" | "holderCount" | "pendingTaxUsd" | "lastPayoutAt" | "volume24hUsd";

function ageMs(iso: string): number {
  return Date.now() - new Date(iso).getTime();
}
function ageStr(iso: string): string {
  const mins = ageMs(iso) / 60000;
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = mins / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}
function fmtUsd(n: number | null | undefined): string {
  // Loose null check deliberately covers undefined too — the upstream stonk.fun API can omit a field
  // entirely instead of nulling it (see scan.ts's normalization comment); a strict `=== null` check here
  // let an undefined slip through to .toLocaleString(), throwing during render and taking down the page
  // (a real crash, traced live: clicking "Recent launches" showed Next.js's client-exception error page).
  if (n == null) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 4 : 2 });
}
function tokenInitial(symbol: string): string {
  return (symbol || "?").charAt(0).toUpperCase();
}
function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

// Confirmed live against the mint's own on-chain Token-2022 metadata (name "Stonked Wojak", symbol
// STONKED) whose metadata JSON's external_url/twitter/telegram all point back at this exact site — not
// just taken on faith.
const STONKED_MINT = "CLrYstF4Fpae8JuiBnw4gGFWYBrCktyVuv1t6S5GhNTG";

function StonkedTokenPill() {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard
      ?.writeText(STONKED_MINT)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard API can be unavailable (insecure context, permission denied) — the address is still
        // shown and selectable by hand, so this isn't a hard failure.
      });
  }
  return (
    <button className="live-pill stonked-ca" title="Click to copy the official $STONKED contract address" onClick={copy}>
      <span className="live-dot" />
      <span>$STONKED: {shortMint(STONKED_MINT)}</span>
      <span className="stonked-ca-copy">{copied ? "copied ✓" : "copy"}</span>
    </button>
  );
}

function sortRows<T extends { symbol: string; createdAt: string; holderCount: number | null; pendingTaxUsd: number | null; lastPayoutAt: string | null; volume24hUsd: number }>(
  rows: T[],
  key: SortKey,
  dir: 1 | -1
): T[] {
  return [...rows].sort((a, b) => {
    if (key === "symbol") return dir * a.symbol.localeCompare(b.symbol);
    if (key === "age") return dir * (ageMs(a.createdAt) - ageMs(b.createdAt));
    if (key === "lastPayoutAt") {
      const av = a.lastPayoutAt ? new Date(a.lastPayoutAt).getTime() : -Infinity;
      const bv = b.lastPayoutAt ? new Date(b.lastPayoutAt).getTime() : -Infinity;
      return dir * (av - bv);
    }
    return dir * ((a[key] ?? 0) - (b[key] ?? 0));
  });
}

function Logo({ imageUrl, symbol }: { imageUrl?: string; symbol: string }) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) return <div className="logo-fallback">{tokenInitial(symbol)}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="logo" src={imageUrl} alt="" onError={() => setFailed(true)} />;
}

function StarButton({ watched, onToggle }: { watched: boolean; onToggle: () => void }) {
  return (
    <button
      className={`star-btn ${watched ? "on" : ""}`}
      title={watched ? "Remove from watchlist" : "Add to watchlist"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {watched ? "★" : "☆"}
    </button>
  );
}

// Only ever shown on the Watchlist tab, on a row whose lastPayoutAt has moved past the baseline recorded
// when the user starred it — i.e. a payout that landed *after* they started watching, not just "this token
// has ever paid out". Click acknowledges it (moves the baseline up), clearing the alert.
function PayoutAlertBadge({ payoutAt, onAcknowledge }: { payoutAt: string | null; onAcknowledge: () => void }) {
  return (
    <button
      className="payout-alert"
      title={`New payout ${ageStr(payoutAt as string)} ago — click to dismiss`}
      onClick={(e) => {
        e.stopPropagation();
        onAcknowledge();
      }}
    >
      🔔 New payout
    </button>
  );
}

function PendingCell({ value, max }: { value: number | null | undefined; max: number }) {
  if (value == null) return <span className="faint">—</span>;
  const pct = Math.max(4, Math.round((value / max) * 100));
  return (
    <div className="pending-wrap">
      <span className="pending-amt">{fmtUsd(value)}</span>
      <div className="pending-bar-track">
        <div className="pending-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function HolderList({ mint }: { mint: string }) {
  const [holders, setHolders] = useState<Holder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/holders?mint=${mint}`)
      .then((res) => res.json())
      .then((data: { holders?: Holder[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setHolders(data.holders ?? []);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [mint]);

  if (error) return <div className="state-msg error">Couldn't load holders: {error}</div>;
  if (!holders) return <div className="state-msg">Loading top holders…</div>;
  if (holders.length === 0) return <div className="state-msg">No holder accounts found.</div>;

  return (
    <div className="holders-wrap">
      <div className="holders-title">Top holders</div>
      {holders.map((h) => (
        <div className="holder-line" key={h.address}>
          <span className="holder-addr">{h.owner ?? h.address}</span>
          <span className="holder-amt">{(Number(h.amountRaw) / 10 ** h.decimals).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
      ))}
    </div>
  );
}

interface HarvestEvent {
  signature: string;
  blockTime: string | null;
  type: "harvest" | "withdraw";
  triggeredBy: string | null;
}

// Real, on-chain fee-sweep events — deliberately separate from (and not to be confused with) whatever
// stonk.fun's own lastPayoutAt/payoutCount reports, since live testing in this project found those don't
// always correspond to a discoverable on-chain event at all. "harvest" is permissionless (any wallet can
// trigger it, usually as a side effect of unrelated trading — it does NOT mean that wallet is stonk.fun's
// own distributor); "withdraw" requires the mint's actual withdraw-withheld authority to sign, so it's a
// stronger (though still not conclusive) signal that whoever runs that authority did something.
function HarvestActivity({ mint }: { mint: string }) {
  const [events, setEvents] = useState<HarvestEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/harvest?mint=${mint}`)
      .then((res) => res.json())
      .then((data: { events?: HarvestEvent[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setEvents(data.events ?? []);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [mint]);

  if (error) return <div className="state-msg error">Couldn&rsquo;t load harvest activity: {error}</div>;
  if (!events) return <div className="state-msg">Scanning recent on-chain activity…</div>;
  if (events.length === 0) return <div className="state-msg">No harvest/withdraw activity found in this token&rsquo;s last 20 transactions.</div>;

  return (
    <div className="holders-wrap">
      <div className="holders-title">On-chain fee-harvest activity (not stonk.fun&rsquo;s reported payouts)</div>
      {events.map((e) => (
        <div className="holder-line" key={e.signature}>
          <span className="holder-addr">
            <span className={`badge ${e.type === "withdraw" ? "yes" : "no"}`}>{e.type === "withdraw" ? "withdraw" : "harvest"}</span>{" "}
            {e.blockTime ? `${ageStr(e.blockTime)} ago` : "unknown time"} by {e.triggeredBy ? shortMint(e.triggeredBy) : "unknown"}
          </span>
          <a className="holder-amt" href={`https://solscan.io/tx/${e.signature}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            view ↗
          </a>
        </div>
      ))}
    </div>
  );
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "symbol", label: "Token" },
  { key: "age", label: "Age" },
  { key: "holderCount", label: "Holders" },
  { key: "pendingTaxUsd", label: "Pending tax" },
  { key: "lastPayoutAt", label: "Last payout" },
  { key: "volume24hUsd", label: "24h vol" },
];

const WATCHLIST_KEY = "stonked-watchlist";

// Per mint: when it was starred, and the lastPayoutAt value that was true AT THAT MOMENT (or whenever the
// user last acknowledged an alert for it). Any lastPayoutAt strictly newer than baselinePayoutAt means a
// payout landed *since* the user started watching — exactly the "only alert on new activity" behavior
// requested, as opposed to flagging every reward-launch token that has ever paid out.
interface WatchMeta {
  addedAt: number;
  baselinePayoutAt: string | null;
}

// Client-side-only (localStorage), per-viewer — a starred list is always small and personal, so there's no
// server-side storage to design around. Hydrated async on mount; `hydrated` lets callers avoid firing the
// initial watchlist fetch before localStorage has actually been read.
function useWatchlist() {
  const [meta, setMeta] = useState<Record<string, WatchMeta>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(WATCHLIST_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migrate the original format (a plain array of mints, no payout tracking) transparently —
        // existing starred tokens keep working, they just start with no baseline (an unknown null),
        // so their very next reported payout will read as "new" once.
        if (Array.isArray(parsed)) {
          const migrated: Record<string, WatchMeta> = {};
          for (const mint of parsed as string[]) migrated[mint] = { addedAt: Date.now(), baselinePayoutAt: null };
          setMeta(migrated);
        } else {
          setMeta(parsed as Record<string, WatchMeta>);
        }
      }
    } catch {
      // Private browsing / blocked storage / corrupt value — falls back to an empty watchlist, no crash.
    }
    setHydrated(true);
  }, []);

  function persist(next: Record<string, WatchMeta>) {
    setMeta(next);
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    } catch {
      // Same as above — persistence is a nice-to-have, not required for the toggle to work this session.
    }
  }

  function toggle(mint: string, currentLastPayoutAt: string | null = null) {
    setMeta((prev) => {
      const next = { ...prev };
      if (next[mint]) delete next[mint];
      else next[mint] = { addedAt: Date.now(), baselinePayoutAt: currentLastPayoutAt };
      try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      } catch {
        // Same as above.
      }
      return next;
    });
  }

  // Clears a mint's "new payout" alert by moving its baseline up to the payout it just alerted on.
  function acknowledge(mint: string, payoutAt: string | null) {
    setMeta((prev) => {
      if (!prev[mint]) return prev;
      const next = { ...prev, [mint]: { ...prev[mint], baselinePayoutAt: payoutAt } };
      try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      } catch {
        // Same as above.
      }
      return next;
    });
  }

  const watched = useMemo(() => new Set(Object.keys(meta)), [meta]);

  return { watched, meta, toggle, acknowledge, hydrated };
}

/** True if `b` represents a strictly later payout than `a` — a null `a` (never paid out, or unknown
 * baseline) counts as "always before" so the very first observed payout still reads as new. */
function isNewerPayout(a: string | null, b: string | null): boolean {
  if (!b) return false;
  if (!a) return true;
  return new Date(b).getTime() > new Date(a).getTime();
}

type Theme = "system" | "light" | "dark";
const THEME_KEY = "stonked-theme";

function useTheme() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY) as Theme | null;
      if (saved === "light" || saved === "dark" || saved === "system") setTheme(saved);
    } catch {
      // Private browsing / blocked storage — falls back to "system" for this session, no crash.
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Same as above — persistence is a nice-to-have, not required for the toggle to work this session.
    }
  }, [theme]);

  return [theme, setTheme] as const;
}

export default function Home() {
  const [theme, setTheme] = useTheme();
  const { watched, meta: watchMeta, toggle: toggleWatch, acknowledge: acknowledgePayout, hydrated: watchlistHydrated } = useWatchlist();
  const [tab, setTab] = useState<Tab>("dormant");
  const [dormant, setDormant] = useState<DormantEntry[] | null>(null);
  const [dormantTotalCount, setDormantTotalCount] = useState<number | null>(null);
  const [recent, setRecent] = useState<Pool[] | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("pendingTaxUsd");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [lastUpdated, setLastUpdated] = useState<string>("connecting…");
  const [manualMint, setManualMint] = useState("");
  const [manualMintError, setManualMintError] = useState<string | null>(null);

  // Dormant and Recent only ever show tokens the background scanner has already discovered or that
  // launched in the last 4 hours — there was previously no way to track a specific token by mint address
  // if it fell outside both of those (e.g. anything more than a few hours old that the dormant sweep
  // hasn't reached yet, which in practice is most of stonk.fun's full history at any given moment). This
  // lets the watchlist be seeded directly, independent of whether the token shows up anywhere else in the app.
  function addMintToWatchlist() {
    const mint = manualMint.trim();
    if (!mint) return;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      setManualMintError("Doesn't look like a Solana address.");
      return;
    }
    if (watched.has(mint)) {
      setManualMintError("Already on your watchlist.");
      return;
    }
    toggleWatch(mint, null);
    setManualMint("");
    setManualMintError(null);
  }

  useEffect(() => {
    setError(null);
    if (tab === "watchlist") return;
    let cancelled = false;
    const load = () => {
      if (tab === "dormant") {
        fetch("/api/dormant")
          .then((res) => res.json())
          .then((data: { entries?: DormantEntry[]; totalCount?: number; error?: string }) => {
            if (cancelled) return;
            if (data.error) setError(data.error);
            else {
              setDormant(data.entries ?? []);
              setDormantTotalCount(data.totalCount ?? null);
              setLastUpdated(new Date().toLocaleTimeString());
            }
          })
          .catch((e) => !cancelled && setError(String(e)));
      } else {
        fetch("/api/recent")
          .then((res) => res.json())
          .then((data: { pools?: Pool[]; error?: string }) => {
            if (cancelled) return;
            if (data.error) setError(data.error);
            else {
              setRecent(data.pools ?? []);
              setLastUpdated(new Date().toLocaleTimeString());
            }
          })
          .catch((e) => !cancelled && setError(String(e)));
      }
    };
    load();
    const interval = setInterval(load, tab === "recent" ? 20_000 : 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tab]);

  // Tracked in a ref (not just the `tab` state) so the interval below — created once per `watched` change,
  // not per tab switch — always checks which tab is *currently* showing rather than whichever tab was
  // active when the effect last re-ran.
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  // Separate from the effect above since it depends on `watched` (re-fetches live whenever a star is
  // toggled) — folding it into the same effect would also re-fetch dormant/recent on every star toggle,
  // which is pointless work. Runs regardless of which tab is active (not gated on tab === "watchlist") so
  // the "🔔 new payout" count on the tab button itself stays live even while looking at Dormant/Recent —
  // that's the whole point of an alert: you shouldn't have to already be on the tab to see it.
  useEffect(() => {
    if (!watchlistHydrated) return;
    let cancelled = false;
    const load = () => {
      if (watched.size === 0) {
        setWatchlist([]);
        return;
      }
      fetch(`/api/watchlist?mints=${[...watched].join(",")}`)
        .then((res) => res.json())
        .then((data: { pools?: WatchlistEntry[]; error?: string }) => {
          if (cancelled) return;
          if (data.error) {
            if (tabRef.current === "watchlist") setError(data.error);
          } else {
            setWatchlist(data.pools ?? []);
            if (tabRef.current === "watchlist") setLastUpdated(new Date().toLocaleTimeString());
          }
        })
        .catch((e) => !cancelled && tabRef.current === "watchlist" && setError(String(e)));
    };
    load();
    const interval = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [watched, watchlistHydrated]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1) as 1 | -1);
    else {
      setSortKey(key);
      setSortDir(key === "symbol" ? 1 : -1);
    }
  }

  const totalPending = useMemo(() => (dormant ?? []).reduce((s, d) => s + (d.pendingTaxUsd || 0), 0), [dormant]);
  const oldestStuck = useMemo(() => {
    if (!dormant || dormant.length === 0) return null;
    return dormant.reduce((a, b) => (ageMs(a.createdAt) > ageMs(b.createdAt) ? a : b));
  }, [dormant]);

  // Mints whose live lastPayoutAt has moved past the baseline recorded when starred (or last
  // acknowledged) — a payout that landed since the user started watching, not merely "has ever paid out".
  const watchlistAlerts = useMemo(() => {
    if (!watchlist) return new Set<string>();
    return new Set(watchlist.filter((w) => watchMeta[w.mint] && isNewerPayout(watchMeta[w.mint].baselinePayoutAt, w.lastPayoutAt)).map((w) => w.mint));
  }, [watchlist, watchMeta]);

  // Desktop (Windows/Mac/Linux) OS notifications via the browser's Notification API — separate from the
  // in-page bell badge above. "default" means the browser hasn't been asked yet; asking requires a user
  // gesture (the button below), it can't happen automatically on load.
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifPermission(Notification.permission);
  }, []);
  function requestNotifPermission() {
    if (typeof Notification === "undefined") return;
    Notification.requestPermission().then((p) => setNotifPermission(p));
  }

  // Fires a real OS notification once per newly-detected alert, not once per poll — `notifiedRef` tracks
  // which mints have already fired one, and a mint is removed from it as soon as its alert clears (via
  // acknowledgement) so a *future* new payout on the same mint notifies again.
  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const mint of watchlistAlerts) {
      if (notifiedRef.current.has(mint)) continue;
      notifiedRef.current.add(mint);
      const entry = (watchlist ?? []).find((w) => w.mint === mint);
      if (!entry) continue;
      try {
        const n = new Notification(`💰 New payout — ${entry.symbol}`, {
          body: `${entry.symbol} just paid out ${fmtUsd(entry.pendingTaxUsd)} in tracked fees since you starred it.`,
          icon: "/logo-64.png",
          tag: `payout-${mint}`,
        });
        n.onclick = () => window.focus();
      } catch {
        // Some browsers throw if permission was revoked between the check above and construction — the
        // in-page bell badge still covers the alert either way.
      }
    }
    for (const mint of notifiedRef.current) {
      if (!watchlistAlerts.has(mint)) notifiedRef.current.delete(mint);
    }
  }, [watchlistAlerts, watchlist]);

  const rows = tab === "dormant" ? dormant ?? [] : tab === "recent" ? recent ?? [] : watchlist ?? [];
  const filtered = rows.filter(
    (r) => !search.trim() || r.symbol.toLowerCase().includes(search.toLowerCase()) || r.mint.toLowerCase().includes(search.toLowerCase()) || r.name.toLowerCase().includes(search.toLowerCase())
  );
  const sorted = sortRows(filtered, sortKey, sortDir);
  // Not a spread into Math.max — with thousands of rows (the dormant list alone has grown past 22,000)
  // that throws "Maximum call stack size exceeded" in some browsers, which was silently breaking the
  // whole table render (confirmed live: a real user reported pending-tax/holder columns just not
  // showing, traced back to this).
  const maxPending = rows.reduce((m, r) => Math.max(m, r.pendingTaxUsd ?? 0), 1);

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src="/logo-64.png" alt="Stonked" />
          <div>
            <div className="brand-name">Stonked</div>
            <div className="brand-sub">
              Live surveillance of stonk.fun&rsquo;s full token history — dormant tokens with real, unclaimed fee revenue piling up, and everything
              launched in the last 4 hours. Not limited to any one launchpad&rsquo;s own tokens.
            </div>
            <StonkedTokenPill />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {notifPermission === "default" && (
            <button className="theme-toggle" title="Get a Windows/desktop notification when a starred token pays out" onClick={requestNotifPermission}>
              🔔 Enable payout alerts
            </button>
          )}
          {notifPermission === "granted" && (
            <span className="live-pill" title="Desktop notifications are on for new watchlist payouts">
              🔔 Alerts on
            </span>
          )}
          {notifPermission === "denied" && (
            <span className="live-pill" title="Notifications were blocked — re-enable them in your browser's site settings">
              🔔 Alerts blocked
            </span>
          )}
          <button
            className="theme-toggle"
            title={`Theme: ${theme} (click to change)`}
            onClick={() => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}
          >
            {theme === "light" ? "☀️ Light" : theme === "dark" ? "🌙 Dark" : "🖥️ Auto"}
          </button>
          <div className="live-pill">
            <span className="live-dot" />
            <span>updated {lastUpdated}</span>
          </div>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Unclaimed fees tracked</div>
          <div className="stat-value accent">{fmtUsd(totalPending)}</div>
          <div className="stat-note">Across dormant reward-launch tokens</div>
        </div>
        <div className="stat">
          <div className="stat-label">Dormant tokens found</div>
          <div className="stat-value">{dormantTotalCount != null ? dormantTotalCount.toLocaleString() : dormant ? dormant.length.toLocaleString() : "—"}</div>
          <div className="stat-note">{dormant && dormantTotalCount != null && dormantTotalCount > dormant.length ? `Showing top ${dormant.length.toLocaleString()} by pending fees` : "Scanned so far, updates continuously"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Launched, last 4h</div>
          <div className="stat-value">{recent ? recent.length.toLocaleString() : "—"}</div>
          <div className="stat-note">Across every stonk.fun launch</div>
        </div>
        <div className="stat">
          <div className="stat-label">Oldest stuck token</div>
          <div className="stat-value">{oldestStuck ? ageStr(oldestStuck.createdAt) : "—"}</div>
          <div className="stat-note">Since last fee sweep</div>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "dormant" ? "active" : ""}`} onClick={() => setTab("dormant")}>
          Dormant fees <span className="count">{dormant ? `(${dormant.length})` : ""}</span>
        </button>
        <button className={`tab ${tab === "recent" ? "active" : ""}`} onClick={() => setTab("recent")}>
          Recent launches <span className="count">{recent ? `(${recent.length})` : ""}</span>
        </button>
        <button className={`tab ${tab === "watchlist" ? "active" : ""}`} onClick={() => setTab("watchlist")}>
          ★ Watchlist <span className="count">{`(${watched.size})`}</span>
          {watchlistAlerts.size > 0 && <span className="tab-alert-dot">🔔 {watchlistAlerts.size}</span>}
        </button>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search by symbol or mint…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {tab !== "watchlist" && (
          <button
            className="theme-toggle"
            title="Toggle chronological sort order"
            onClick={() => {
              if (sortKey === "age") setSortDir((d) => (d === 1 ? -1 : 1) as 1 | -1);
              else {
                setSortKey("age");
                setSortDir(1); // newest first — the sensible default entry point for this toggle
              }
            }}
          >
            {sortKey === "age" && sortDir === -1 ? "⬆ Oldest first" : "⬇ Newest first"}
          </button>
        )}
        <span className="refresh-note">auto-refreshing</span>
      </div>

      {tab === "watchlist" && (
        <div className="toolbar" style={{ marginTop: -6 }}>
          <input
            className="search"
            placeholder="Paste a mint address to track it directly — works for any StonkFun token, even ones not shown in Dormant or Recent…"
            value={manualMint}
            onChange={(e) => {
              setManualMint(e.target.value);
              setManualMintError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && addMintToWatchlist()}
          />
          <button className="theme-toggle" onClick={addMintToWatchlist}>
            ★ Add
          </button>
          {manualMintError && <span className="state-msg error" style={{ padding: 0, fontSize: 11.5 }}>{manualMintError}</span>}
        </div>
      )}

      <div className="panel">
        {error && <div className="state-msg error">{error}</div>}
        {!error && (
          <table>
            <thead>
              <tr>
                <th></th>
                {COLUMNS.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sortKey === c.key ? (sortDir === 1 ? " ▴" : " ▾") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="state-msg">
                    {tab === "dormant"
                      ? dormant === null
                        ? "Loading…"
                        : "No dormant tokens match yet — the background scanner is still working through stonk.fun's full history."
                      : tab === "recent"
                        ? recent === null
                          ? "Loading…"
                          : "Nothing launched in the last 4 hours."
                        : watched.size === 0
                          ? "Nothing starred yet — click the ☆ next to any token to add it here."
                          : watchlist === null
                            ? "Loading…"
                            : "No starred tokens matched."}
                  </td>
                </tr>
              )}
              {sorted.map((r) => {
                const notFound = tab === "watchlist" && "notFound" in r && (r as WatchlistEntry).notFound;
                const hasAlert = tab === "watchlist" && !notFound && watchlistAlerts.has(r.mint);
                return (
                  <>
                    <tr className={`row ${hasAlert ? "row-alert" : ""}`} key={r.mint} onClick={() => !notFound && setExpanded(expanded === r.mint ? null : r.mint)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <StarButton watched={watched.has(r.mint)} onToggle={() => toggleWatch(r.mint, r.lastPayoutAt)} />
                      </td>
                      <td>
                        <div className="token-cell">
                          <Logo imageUrl={r.imageUrl} symbol={r.symbol} />
                          <div>
                            <div className="token-name">
                              {notFound ? shortMint(r.mint) : r.symbol}
                              {hasAlert && <PayoutAlertBadge payoutAt={r.lastPayoutAt} onAcknowledge={() => acknowledgePayout(r.mint, r.lastPayoutAt)} />}
                            </div>
                            <a className="token-mint" href={`https://www.stonkfun.xyz/token/${r.mint}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                              {shortMint(r.mint)}
                            </a>
                          </div>
                        </div>
                      </td>
                      {notFound ? (
                        <td colSpan={5} className="state-msg">
                          No longer found on stonk.fun — the pool may have been removed.
                        </td>
                      ) : (
                        <>
                          <td>{tab === "dormant" ? <span className="age-dim">{ageStr(r.createdAt)}</span> : <span className="badge fresh">{ageStr(r.createdAt)}</span>}</td>
                          <td>{r.holderCount == null ? <span className="faint">—</span> : r.holderCount.toLocaleString()}</td>
                          <td>
                            <PendingCell value={r.pendingTaxUsd} max={maxPending} />
                          </td>
                          <td>{r.lastPayoutAt ? `${ageStr(r.lastPayoutAt)} ago` : "isRewardLaunch" in r && !r.isRewardLaunch ? <span className="faint">—</span> : "never"}</td>
                          <td>{fmtUsd(r.volume24hUsd)}</td>
                        </>
                      )}
                    </tr>
                    {!notFound && expanded === r.mint && (
                      <tr className="holders-row" key={`${r.mint}-holders`}>
                        <td colSpan={7}>
                          <HolderList mint={r.mint} />
                          <HarvestActivity mint={r.mint} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="footer-note">
        Data from stonk.fun&rsquo;s own public API + Solana RPC. Not affiliated with stonk.fun.
      </div>
    </div>
  );
}
