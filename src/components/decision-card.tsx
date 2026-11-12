"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  ImagePlus,
  Mic,
  Pencil,
  Send,
  Square,
  Palette,
} from "lucide-react";
import { answerSummary, areaTone, formatDuration, type Area, type Decision } from "@/lib/domain";
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

export type AnswerDraft = {
  text: string;
  custom: boolean;
  image?: File | null;
  audio?: File | null;
  alt?: string;
  audioDuration?: number | null;
};

export type AnswerHandler = (decision: Decision, draft: AnswerDraft) => Promise<boolean>;

function AnswerMediaView({ decision }: { decision: Decision }) {
  if (!decision.answerMedia.length) return null;
  return (
    <div className="answer-media-list">
      {decision.answerMedia.map((item) =>
        item.kind === "image" ? (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="answer-image"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.thumbnailUrl || item.url} alt={item.alt || item.filename} />
          </a>
        ) : (
          <div key={item.id} className="answer-audio">
            <audio controls preload="metadata" src={item.url}>
              {item.filename}
            </audio>
            {item.durationSeconds != null && (
              <span className="audio-duration">{formatDuration(item.durationSeconds)}</span>
            )}
          </div>
        ),
      )}
    </div>
  );
}

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
  const [image, setImage] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [audioPreview, setAudioPreview] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mediaError, setMediaError] = useState("");
  const id = useId();
  const altId = useId();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);
  useEffect(() => {
    return () => {
      if (audioPreview) URL.revokeObjectURL(audioPreview);
    };
  }, [audioPreview]);

  function takeImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setMediaError("Each image must be 3 MiB or smaller.");
      return;
    }
    setImage(file);
    setImagePreview(URL.createObjectURL(file));
    setAlt("");
    setMediaError("");
  }

  function takeAudio(file: File, duration: number | null) {
    if (file.size > 8 * 1024 * 1024) {
      setMediaError("Audio must be 8 MiB or smaller.");
      return;
    }
    setAudio(file);
    setAudioPreview(URL.createObjectURL(file));
    setAudioDuration(duration);
    setMediaError("");
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setMediaError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMediaError("Microphone isn’t available. Upload an audio file instead.");
      return;
    }
    try {
      const live = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = live;
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const rec = new MediaRecorder(live, preferred ? { mimeType: preferred } : undefined);
      const chunks: Blob[] = [];
      const started = Date.now();
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      rec.onstop = () => {
        live.getTracks().forEach((track) => track.stop());
        stream.current = null;
        const type = (rec.mimeType || preferred || "audio/webm").split(";")[0];
        const file = new File(
          [new Blob(chunks, { type })],
          type.includes("mp4") ? "reply.m4a" : "reply.webm",
          {
            type,
          },
        );
        if (!alive.current) return;
        takeAudio(file, (Date.now() - started) / 1000);
        setRecording(false);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      setElapsed(0);
      const timer = window.setInterval(() => {
        const seconds = (Date.now() - started) / 1000;
        if (!alive.current || rec.state !== "recording") {
          window.clearInterval(timer);
          return;
        }
        setElapsed(seconds);
        if (seconds >= 300) rec.stop();
      }, 250);
      rec.addEventListener("stop", () => window.clearInterval(timer), { once: true });
    } catch {
      setMediaError("Microphone isn’t available. Upload an audio file instead.");
      setRecording(false);
    }
  }

  const draft = { image, audio, alt, audioDuration };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = custom.trim();
    if (busy || recording || (!text && !image && !audio)) return;
    if (await onAnswer(decision, { text, custom: true, ...draft })) {
      setCustom("");
      setImage(null);
      setImagePreview("");
      setAlt("");
      setAudio(null);
      setAudioPreview("");
      setAudioDuration(null);
    }
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
              disabled={busy || recording}
              onClick={() => void onAnswer(decision, { text: option, custom: false, ...draft })}
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
          placeholder={
            decision.options.length
              ? "Or, a different answer…"
              : "Type your answer, or attach media…"
          }
          maxLength={2000}
          disabled={busy || recording}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={busy || recording || (!custom.trim() && !image && !audio)}
          aria-label={`Send custom answer for ${decision.question}`}
        >
          <span>Send</span>
          <Send size={14} />
        </button>
      </form>
      <div className="media-actions">
        <label className="button button-secondary media-file">
          <ImagePlus size={14} aria-hidden="true" />
          Add image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={takeImage}
            disabled={busy || recording}
          />
        </label>
        <label className="button button-secondary media-file">
          <Mic size={14} aria-hidden="true" />
          Upload audio
          <input
            type="file"
            accept="audio/webm,audio/mpeg,audio/mp4,audio/wav,audio/ogg,.webm,.mp3,.m4a,.wav,.ogg"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) takeAudio(file, null);
            }}
            disabled={busy || recording}
          />
        </label>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void toggleRecording()}
          disabled={busy}
          aria-pressed={recording}
        >
          {recording ? (
            <Square size={14} aria-hidden="true" />
          ) : (
            <Mic size={14} aria-hidden="true" />
          )}
          {recording ? `Stop ${formatDuration(elapsed)}` : "Record audio"}
        </button>
      </div>
      <p className="field-hint">
        One PNG, JPEG, WebP, or GIF up to 3 MiB, and one WebM, MP3, M4A, WAV, or Ogg recording up to
        8 MiB and 5 minutes. A reply can be text, media, or both.
      </p>
      {imagePreview && (
        <div className="media-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imagePreview} alt={alt || image?.name || "Selected answer image"} />
          <label htmlFor={altId}>Image description</label>
          <input
            id={altId}
            value={alt}
            maxLength={200}
            disabled={busy}
            placeholder="What is in this image?"
            onChange={(event) => setAlt(event.target.value)}
          />
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setImage(null);
              setImagePreview("");
              setAlt("");
            }}
          >
            Remove image
          </button>
        </div>
      )}
      {audioPreview && (
        <div className="answer-audio">
          <audio controls preload="metadata" src={audioPreview} />
          <span className="audio-duration">
            {audioDuration != null ? formatDuration(audioDuration) : "Audio attached"}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setAudio(null);
              setAudioPreview("");
              setAudioDuration(null);
            }}
          >
            Remove audio
          </button>
        </div>
      )}
      {recording && (
        <span className="saving-label" role="status">
          Recording {formatDuration(elapsed)}. Press stop when you’re done.
        </span>
      )}
      {mediaError && (
        <p className="form-error" role="alert">
          {mediaError}
        </p>
      )}
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
        <p>{answerSummary(decision)}</p>
      </div>
      <AnswerMediaView decision={decision} />
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
