"use client";

import { useEffect, useMemo, useState } from "react";

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

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "symbol", label: "Token" },
  { key: "age", label: "Age" },
  { key: "holderCount", label: "Holders" },
  { key: "pendingTaxUsd", label: "Pending tax" },
  { key: "lastPayoutAt", label: "Last payout" },
  { key: "volume24hUsd", label: "24h vol" },
];

const WATCHLIST_KEY = "stonked-watchlist";

// Client-side-only (localStorage), per-viewer — a starred list is always small and personal, so there's no
// server-side storage to design around. The Set is hydrated async on mount; `hydrated` lets callers avoid
// firing the initial watchlist fetch with an empty set before localStorage has actually been read.
function useWatchlist() {
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(WATCHLIST_KEY);
      if (saved) setWatched(new Set(JSON.parse(saved) as string[]));
    } catch {
      // Private browsing / blocked storage / corrupt value — falls back to an empty watchlist, no crash.
    }
    setHydrated(true);
  }, []);

  function toggle(mint: string) {
    setWatched((prev) => {
      const next = new Set(prev);
      if (next.has(mint)) next.delete(mint);
      else next.add(mint);
      try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...next]));
      } catch {
        // Same as above — persistence is a nice-to-have, not required for the toggle to work this session.
      }
      return next;
    });
  }

  return { watched, toggle, hydrated };
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
  const { watched, toggle: toggleWatch, hydrated: watchlistHydrated } = useWatchlist();
  const [tab, setTab] = useState<Tab>("dormant");
  const [dormant, setDormant] = useState<DormantEntry[] | null>(null);
  const [recent, setRecent] = useState<Pool[] | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("pendingTaxUsd");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [lastUpdated, setLastUpdated] = useState<string>("connecting…");

  useEffect(() => {
    if (tab === "watchlist") return;
    let cancelled = false;
    setError(null);
    const load = () => {
      if (tab === "dormant") {
        fetch("/api/dormant")
          .then((res) => res.json())
          .then((data: { entries?: DormantEntry[]; error?: string }) => {
            if (cancelled) return;
            if (data.error) setError(data.error);
            else {
              setDormant(data.entries ?? []);
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

  // Separate from the effect above since it depends on `watched` (re-fetches live whenever a star is
  // toggled while this tab is open) — folding it into the same effect would also re-fetch dormant/recent
  // on every star toggle, which is pointless work.
  useEffect(() => {
    if (tab !== "watchlist" || !watchlistHydrated) return;
    let cancelled = false;
    setError(null);
    const load = () => {
      if (watched.size === 0) {
        setWatchlist([]);
        setLastUpdated(new Date().toLocaleTimeString());
        return;
      }
      fetch(`/api/watchlist?mints=${[...watched].join(",")}`)
        .then((res) => res.json())
        .then((data: { pools?: WatchlistEntry[]; error?: string }) => {
          if (cancelled) return;
          if (data.error) setError(data.error);
          else {
            setWatchlist(data.pools ?? []);
            setLastUpdated(new Date().toLocaleTimeString());
          }
        })
        .catch((e) => !cancelled && setError(String(e)));
    };
    load();
    const interval = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tab, watched, watchlistHydrated]);

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

  const rows = tab === "dormant" ? dormant ?? [] : tab === "recent" ? recent ?? [] : watchlist ?? [];
  const filtered = rows.filter(
    (r) => !search.trim() || r.symbol.toLowerCase().includes(search.toLowerCase()) || r.mint.toLowerCase().includes(search.toLowerCase()) || r.name.toLowerCase().includes(search.toLowerCase())
  );
  const sorted = sortRows(filtered, sortKey, sortDir);
  const maxPending = Math.max(...rows.map((r) => r.pendingTaxUsd ?? 0), 1);

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
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
          <div className="stat-value">{dormant ? dormant.length.toLocaleString() : "—"}</div>
          <div className="stat-note">Scanned so far, updates continuously</div>
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
        </button>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search by symbol or mint…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="refresh-note">auto-refreshing</span>
      </div>

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
                return (
                  <>
                    <tr className="row" key={r.mint} onClick={() => !notFound && setExpanded(expanded === r.mint ? null : r.mint)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <StarButton watched={watched.has(r.mint)} onToggle={() => toggleWatch(r.mint)} />
                      </td>
                      <td>
                        <div className="token-cell">
                          <Logo imageUrl={r.imageUrl} symbol={r.symbol} />
                          <div>
                            <div className="token-name">{notFound ? shortMint(r.mint) : r.symbol}</div>
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
