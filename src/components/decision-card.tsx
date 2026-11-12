"use client";

import { useId, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  FileText,
  Check,
  ChevronRight,
  Clock3,
  CornerDownLeft,
  Layers3,
  LockKeyhole,
  Pencil,
  Send,
  Palette,
} from "lucide-react";
import { areaTone, type Area, type Decision } from "@/lib/domain";
import { deadlineLabel, fullDate, isUrgent } from "@/lib/time";

export function AreaBadge({ area }: { area: Area }) {
  const tone = areaTone(area);
  const Icon = tone === "content" ? FileText : tone === "design" ? Palette : Layers3;
  return (
    <span className={`area-badge area-${tone}`}>
      <Icon size={12} aria-hidden="true" />
      {area}
    </span>
  );
}

export type AnswerHandler = (
  decision: Decision,
  answer: string,
  custom: boolean,
) => Promise<boolean>;

function DecisionImages({ decision }: { decision: Decision }) {
  if (!decision.images.length) return null;
  return (
    <div className="decision-images" aria-label={`Images for ${decision.question}`}>
      {decision.images.map((image) => (
        <a
          key={image.id}
          href={image.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${image.filename} full size`}
        >
          {/* Private image URLs expire; refreshing the inbox renews them. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.thumbnailUrl}
            alt={image.filename}
            width={240}
            height={150}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <span>
            {image.filename}
            <ArrowUpRight size={12} aria-hidden="true" />
          </span>
        </a>
      ))}
    </div>
  );
}

function AnswerControls({
  decision,
  busy,
  onAnswer,
}: {
  decision: Decision;
  busy: boolean;
  onAnswer: AnswerHandler;
}) {
  const [custom, setCustom] = useState("");
  const id = useId();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!custom.trim() || busy) return;
    if (await onAnswer(decision, custom.trim(), true)) setCustom("");
  }
  return (
    <div className="answer-controls">
      {decision.options.length > 0 ? (
        <div className="option-list" aria-label={`Answer options for ${decision.question}`}>
          {decision.options.map((option, index) => (
            <button
              type="button"
              key={`${index}-${option}`}
              className={`option-button ${decision.answer === option && !decision.customAnswer ? "option-selected" : ""}`}
              disabled={busy}
              onClick={() => void onAnswer(decision, option, false)}
            >
              <span className="option-radio">
                {decision.answer === option && !decision.customAnswer && <Check size={11} />}
              </span>
              <span>{option}</span>
              <ChevronRight size={15} className="option-arrow" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <div className="custom-only-note">
          <CornerDownLeft size={16} />
          <span>This one’s an open question. Make it your own.</span>
        </div>
      )}
      <form className="custom-answer" onSubmit={submit}>
        <label className="sr-only" htmlFor={id}>
          Other answer for {decision.question}
        </label>
        <input
          id={id}
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          placeholder={decision.options.length ? "Or, a different answer…" : "Type your answer…"}
          maxLength={2000}
          disabled={busy}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={busy || !custom.trim()}
          aria-label={`Send custom answer for ${decision.question}`}
        >
          <span>Send</span>
          <Send size={14} />
        </button>
      </form>
      {busy && (
        <span className="saving-label" role="status">
          Saving your answer…
        </span>
      )}
    </div>
  );
}

export function DecisionCard({
  decision,
  busy,
  now,
  onAnswer,
}: {
  decision: Decision;
  busy: boolean;
  now: number;
  onAnswer: AnswerHandler;
}) {
  const id = useId();
  const urgent = isUrgent(decision.deadline, now);
  return (
    <article
      className={`decision-card ${urgent ? "decision-urgent" : ""}`}
      aria-labelledby={id}
      aria-busy={busy}
    >
      <div className="card-topline">
        <AreaBadge area={decision.area} />
        {decision.deadline ? (
          <span
            className={`deadline ${urgent ? "deadline-urgent" : ""}`}
            title={`${fullDate(decision.deadline)} · São Paulo`}
          >
            <Clock3 size={12} aria-hidden="true" />
            {deadlineLabel(decision.deadline, now)}
          </span>
        ) : (
          <span className="card-status">
            <span />
            Needs your call
          </span>
        )}
      </div>
      <h2 id={id}>{decision.question}</h2>
      {decision.context && <p className="card-context">{decision.context}</p>}
      <DecisionImages decision={decision} />
      <AnswerControls decision={decision} busy={busy} onAnswer={onAnswer} />
      <div className="card-footer">
        <span className="waiting-tag">
          <Bot size={14} aria-hidden="true" />
          {decision.waitingOn || "Your assistant"}
          <span className="waiting-label">is waiting</span>
        </span>
        {decision.deadline && (
          <time dateTime={decision.deadline} title="America/Sao_Paulo">
            {fullDate(decision.deadline)}
          </time>
        )}
        {!decision.deadline && (
          <span className="card-footer-arrow" aria-hidden="true">
            <ArrowUpRight size={15} />
          </span>
        )}
      </div>
    </article>
  );
}

export function AnsweredCard({
  decision,
  busy,
  onAnswer,
}: {
  decision: Decision;
  busy: boolean;
  onAnswer: AnswerHandler;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const locked = decision.status === "Routed";
  return (
    <article className="answered-card" aria-labelledby={id}>
      <div className="answered-card-top">
        <AreaBadge area={decision.area} />
        <span className={`answered-state ${locked ? "routed-state" : ""}`}>
          {locked ? <LockKeyhole size={12} /> : <Check size={13} />}{" "}
          {locked ? "Picked up by assistant" : "Answered"}
        </span>
      </div>
      <h3 id={id}>{decision.question}</h3>
      <DecisionImages decision={decision} />
      <div className="chosen-answer">
        <span className="chosen-icon">
          <Check size={15} />
        </span>
        <p>{decision.answer}</p>
      </div>
      <div className="answered-card-footer">
        <span>
          {decision.answeredAt ? fullDate(decision.answeredAt) : "Answer saved"}
          {decision.waitingOn && ` · ${decision.waitingOn}`}
        </span>
        {!locked && (
          <button className="text-button" disabled={busy} onClick={() => setEditing(!editing)}>
            <Pencil size={12} />
            {editing ? "Cancel" : "Change answer"}
          </button>
        )}
      </div>
      {editing && !locked && (
        <AnswerControls
          decision={decision}
          busy={busy}
          onAnswer={async (...args) => {
            const saved = await onAnswer(...args);
            if (saved) setEditing(false);
            return saved;
          }}
        />
      )}
    </article>
  );
}
