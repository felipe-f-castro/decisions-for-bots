"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Inbox,
  KeyRound,
  Layers3,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/actions";
import { api, RequestError } from "@/lib/client-api";
import {
  AREAS,
  areaTone,
  sortOpen,
  type Area,
  type Decision,
  type Mutation,
  type NewDecision,
} from "@/lib/domain";
import { isUrgent, TIME_ZONE } from "@/lib/time";
import { Brand } from "./brand";
import { AddDecision } from "./add-decision";
import { AnsweredCard, DecisionCard } from "./decision-card";

type Filter = "All" | Area;
type Toast = { title: string; undo?: { id: string; mutation: Mutation } };

export function Dashboard({
  mode,
  areas = AREAS,
  initialNow,
  initialDecisions,
  initialError = "",
}: {
  mode: "demo" | "appwrite";
  areas?: readonly string[];
  initialNow: number;
  initialDecisions?: Decision[];
  initialError?: string;
}) {
  const [decisions, setDecisions] = useState<Decision[]>(initialDecisions ?? []);
  const [loading, setLoading] = useState(!initialDecisions);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(initialError);
  const [filter, setFilter] = useState<Filter>("All");
  const [addOpen, setAddOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [now, setNow] = useState(initialNow);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const mutations = useRef(new Set<string>());
  const revision = useRef(0);
  const history = useRef<HTMLDetailsElement>(null);
  const mainTitle = useRef<HTMLHeadingElement>(null);

  const refresh = useCallback(async (manual = false) => {
    if (mutations.current.size) return;
    const currentRevision = revision.current;
    if (manual) setRefreshing(true);
    try {
      const data = await api<{ decisions: Decision[] }>("/api/decisions");
      if (revision.current === currentRevision) {
        setDecisions(data.decisions);
        setError("");
      }
    } catch (failure) {
      if (revision.current === currentRevision)
        setError(failure instanceof Error ? failure.message : "We couldn’t refresh your inbox.");
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = !initialDecisions ? setTimeout(() => void refresh(), 0) : undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    const onFocus = () => {
      setNow(Date.now());
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(initialRefresh);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, initialDecisions]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!mobileMenu) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenu(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [mobileMenu]);

  async function mutate(id: string, mutation: Mutation) {
    if (mutations.current.has(id)) throw new RequestError("This answer is still saving.", 409);
    mutations.current.add(id);
    revision.current += 1;
    setBusy(new Set(mutations.current));
    setError("");
    try {
      const { decision } = await api<{ decision: Decision }>(`/api/decisions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(mutation),
      });
      setDecisions((current) => current.map((item) => (item.id === decision.id ? decision : item)));
      return decision;
    } finally {
      mutations.current.delete(id);
      revision.current += 1;
      setBusy(new Set(mutations.current));
    }
  }

  async function answer(decision: Decision, answer: string, custom: boolean) {
    try {
      const updated = await mutate(decision.id, {
        action: "answer",
        answer,
        custom,
        expectedRevision: decision.revision,
      });
      const undo: Mutation =
        decision.status === "Answered"
          ? {
              action: "answer",
              answer: decision.answer,
              custom: !!decision.customAnswer,
              expectedRevision: updated.revision,
            }
          : { action: "reopen", expectedRevision: updated.revision };
      setToast({
        title: "Answer saved. A little more momentum.",
        undo: { id: updated.id, mutation: undo },
      });
      return true;
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 409) await refresh();
      setError(failure instanceof Error ? failure.message : "We couldn’t save your answer.");
      return false;
    }
  }

  async function undo() {
    if (!toast?.undo) return;
    const { id, mutation } = toast.undo;
    setToast(null);
    try {
      await mutate(id, mutation);
      setToast({
        title:
          mutation.action === "reopen"
            ? "Back in your inbox. Take your time."
            : "Your previous answer is back.",
      });
    } catch (failure) {
      await refresh();
      setError(failure instanceof Error ? failure.message : "We couldn’t undo that answer.");
    }
  }

  async function create(input: NewDecision, files: File[] = []) {
    revision.current += 1;
    mutations.current.add("creating");
    try {
      const form = new FormData();
      form.set("decision", JSON.stringify(input));
      files.forEach((file) => form.append("images", file));
      const { decision } = await api<{ decision: Decision }>("/api/decisions", {
        method: "POST",
        body: files.length ? form : JSON.stringify(input),
      });
      setDecisions((current) => [...current, decision]);
      setFilter("All");
      setToast({ title: "Decision added. A clear next step." });
    } finally {
      mutations.current.delete("creating");
      revision.current += 1;
    }
  }

  const open = sortOpen(decisions.filter((decision) => decision.status === "Open"));
  const shown = open.filter((decision) => filter === "All" || decision.area === filter);
  const answered = decisions
    .filter((decision) => decision.status !== "Open")
    .sort(
      (a, b) => Date.parse(b.answeredAt || b.createdAt) - Date.parse(a.answeredAt || a.createdAt),
    );
  const shownAnswered = answered.filter((decision) => filter === "All" || decision.area === filter);
  const urgent = open.filter((decision) => isUrgent(decision.deadline, now)).length;
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(now));

  function chooseFilter(value: Filter) {
    setFilter(value);
    setMobileMenu(false);
  }
  function showHistory() {
    setMobileMenu(false);
    setHistoryOpen(true);
    requestAnimationFrame(() =>
      history.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to decisions
      </a>
      {mobileMenu && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}
        aria-label="Workspace navigation"
      >
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileMenu(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="workspace-label">YOUR PERSONAL WORKSPACE</div>
        <nav className="main-nav">
          <button
            className="nav-item nav-active"
            onClick={() => {
              chooseFilter("All");
              window.scrollTo({ top: 0, behavior: "smooth" });
              mainTitle.current?.focus({ preventScroll: true });
            }}
          >
            <Inbox size={18} />
            <span>Decision inbox</span>
            <span className="nav-count">{open.length}</span>
          </button>
          <button className="nav-item" onClick={showHistory}>
            <CheckCheck size={18} />
            <span>Answered</span>
            <span className="nav-neutral-count">{answered.length}</span>
          </button>
        </nav>
        <div className="areas-heading">
          areas
          <span>
            <Layers3 size={12} />
          </span>
        </div>
        <nav className="area-nav" aria-label="Filter by area">
          {areas.map((area) => (
            <button
              key={area}
              className={`nav-item area-nav-item ${filter === area ? "area-nav-active" : ""}`}
              onClick={() => chooseFilter(area)}
            >
              <span className={`area-dot dot-${areaTone(area)}`} />
              <span>{area}</span>
              <span className="area-count">
                {open.filter((decision) => decision.area === area).length}
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="momentum-note">
            <div className="note-art" aria-hidden="true">
              <svg viewBox="0 0 150 60" fill="none">
                <path
                  d="M12 53c36 0 23-38 59-33s26 30 56-6"
                  stroke="#98a996"
                  strokeWidth="1.7"
                  strokeDasharray="3 4"
                />
                <path
                  d="m117 14 11-2-1 11"
                  stroke="#637b62"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="53" r="3" fill="#879e80" />
              </svg>
              <Sparkles size={19} />
            </div>
            <strong>One decision at a time.</strong>
            <p>
              A little clarity.
              <br />A lot of forward.
            </p>
          </div>
          <div className="profile">
            <span className="avatar">YOU</span>
            <span className="profile-info">
              <strong>Your workspace</strong>
              <span>Personal workspace</span>
            </span>
            {mode !== "demo" && (
              <>
                <Link
                  href="/settings"
                  className="icon-button signout-button"
                  title="Workspace settings"
                  aria-label="Workspace settings"
                >
                  <Layers3 size={16} />
                </Link>
                <Link
                  href="/account/password"
                  className="icon-button signout-button"
                  title="Set password"
                  aria-label="Set password"
                >
                  <KeyRound size={15} />
                </Link>
              </>
            )}
            {mode !== "demo" && (
              <form action={signOut}>
                <button
                  className="icon-button signout-button"
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut size={15} />
                </button>
              </form>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <button
              className="icon-button"
              aria-label="Open navigation"
              aria-expanded={mobileMenu}
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={20} />
            </button>
            <Brand />
          </div>
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <span>Decision inbox</span>
          </div>
          <div className="topbar-right">
            <span className={`connection-pill ${mode === "demo" ? "demo-pill" : ""}`}>
              <span />
              {mode === "demo" ? "Demo mode" : "Appwrite workspace"}
            </span>
            <button
              className={`icon-button refresh-button ${refreshing ? "is-spinning" : ""}`}
              disabled={refreshing || loading}
              onClick={() => void refresh(true)}
              title="Refresh inbox"
              aria-label="Refresh inbox"
            >
              <RefreshCw size={16} />
            </button>
            <span className="topbar-divider" />
            <span className="top-avatar">YOU</span>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {mode === "demo" && (
            <div className="demo-banner" role="status">
              <strong>Demo mode</strong>
              <span>Try it freely. This inbox is public and resets when the server restarts.</span>
            </div>
          )}
          <div className="page-heading">
            <div className="heading-copy">
              <p className="date-line">
                <span className="sun-icon" aria-hidden="true">
                  ✳
                </span>
                {day}
              </p>
              <h1 ref={mainTitle} tabIndex={-1}>
                A little clarity.<span className="heading-dot"> A lot of forward.</span>
              </h1>
              <p className="page-subtitle">
                Your assistants did the legwork. The next move is yours.
              </p>
            </div>
            <button className="button button-primary add-button" onClick={() => setAddOpen(true)}>
              <Plus size={17} />
              <span>Add decision</span>
            </button>
          </div>
          <div className="inbox-overview">
            <div className="overview-icon">
              <Inbox size={19} strokeWidth={1.7} />
            </div>
            <p>
              <strong>
                {loading
                  ? "Your next moves are on their way"
                  : open.length
                    ? `${open.length} ${open.length === 1 ? "decision needs" : "decisions need"} your attention`
                    : "A clearer inbox. A clearer head."}
              </strong>
              <span>
                {loading
                  ? "Getting your inbox ready…"
                  : open.length
                    ? "A few quick calls to keep good things moving."
                    : "You’ve given everything a direction. Nice work."}
              </span>
            </p>
            {urgent > 0 && (
              <span className="urgent-pill">
                <Bell size={13} />
                {urgent} time-sensitive
              </span>
            )}
            {!loading && !urgent && (
              <span className="overview-sparkle">
                <Sparkles size={21} strokeWidth={1.3} />
              </span>
            )}
          </div>
          <div className="filter-toolbar">
            <div className="filter-chips" aria-label="Decision areas">
              <button
                className={`filter-chip ${filter === "All" ? "chip-active" : ""}`}
                onClick={() => setFilter("All")}
                aria-pressed={filter === "All"}
              >
                All decisions<span>{open.length}</span>
              </button>
              {areas.map((area) => (
                <button
                  key={area}
                  className={`filter-chip ${filter === area ? "chip-active" : ""}`}
                  onClick={() => setFilter(area)}
                  aria-pressed={filter === area}
                >
                  <span className={`area-dot dot-${areaTone(area)}`} />
                  {area}
                  <span className="chip-count">
                    {open.filter((decision) => decision.area === area).length}
                  </span>
                </button>
              ))}
            </div>
            <span className="sort-label">
              <ArrowDownWideNarrow size={14} />
              Deadline first
            </span>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <CircleHelp size={18} />
              <span>{error}</span>
              <button
                className="text-button"
                disabled={refreshing}
                onClick={() => void refresh(true)}
              >
                Retry
              </button>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="decision-grid" aria-label="Loading your decisions" aria-busy="true">
              {[1, 2, 3, 4].map((key) => (
                <div className="skeleton-card" key={key}>
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : shown.length ? (
            <section className="decision-grid" aria-label="Open decisions">
              {shown.map((decision) => (
                <DecisionCard
                  key={decision.id}
                  decision={decision}
                  busy={busy.has(decision.id)}
                  now={now}
                  onAnswer={answer}
                />
              ))}
            </section>
          ) : (
            <div className="empty-state">
              <div className="empty-illustration">
                <span />
                <CheckCheck size={35} strokeWidth={1.5} />
                <Sparkles size={19} />
              </div>
              <h2>
                {filter !== "All" && open.length
                  ? `A clear inbox for ${filter}.`
                  : "You’re all clear, friend."}
              </h2>
              <p>
                {filter !== "All" && open.length
                  ? "No open questions in this area. A little breathing room."
                  : "Every question has a direction. Your assistants can take it from here."}
              </p>
              {filter !== "All" && open.length ? (
                <button className="button button-secondary" onClick={() => setFilter("All")}>
                  See all decisions
                  <ArrowRight size={15} />
                </button>
              ) : (
                <button className="text-button" onClick={() => setAddOpen(true)}>
                  Have something in mind? Add a decision
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          )}
          <details
            id="answered-section"
            ref={history}
            className="answered-section"
            open={historyOpen}
            onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
          >
            <summary>
              <span className="answered-heading">
                <span className="answered-heading-icon">
                  <CheckCheck size={17} />
                </span>
                Answered<span className="answered-count">{shownAnswered.length}</span>
              </span>
              <span className="answered-summary-note">Good calls, all in one place.</span>
              <ChevronDown size={16} className="details-chevron" />
            </summary>
            <div className="answered-content">
              {shownAnswered.length ? (
                shownAnswered.map((decision) => (
                  <AnsweredCard
                    key={decision.id}
                    decision={decision}
                    busy={busy.has(decision.id)}
                    onAnswer={answer}
                  />
                ))
              ) : (
                <p className="answered-empty">
                  Your answered decisions will land here. Small steps count.
                </p>
              )}
            </div>
          </details>
          <footer className="workspace-footer">
            <span>
              <span className="footer-sparkle">✳</span>Your call. Your pace.
            </span>
            <span>
              {mode === "demo"
                ? "Demo data · resets when the server restarts"
                : "Stored in Appwrite"}
              <span className="footer-separator">·</span>São Paulo time
              <ArrowUpRight size={11} />
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span className="toast-check">
            <Check size={15} />
          </span>
          <span>{toast.title}</span>
          {toast.undo && <button onClick={() => void undo()}>Undo</button>}
          <button
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {addOpen && <AddDecision areas={areas} onClose={() => setAddOpen(false)} onCreate={create} />}
    </div>
  );
}
