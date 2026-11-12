"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import { AREAS, type NewDecision } from "@/lib/domain";
import { saoPauloToISO } from "@/lib/time";

export function AddDecision({
  onClose,
  onCreate,
  areas = AREAS,
}: {
  onClose: () => void;
  onCreate: (decision: NewDecision, files?: File[]) => Promise<void>;
  areas?: readonly string[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => modal?.close();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError("");
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await onCreate(
        {
          question: String(form.get("question") || "").trim(),
          context: String(form.get("context") || "").trim(),
          options: String(form.get("options") || "")
            .split(/\r?\n/)
            .map((option) => option.trim())
            .filter(Boolean),
          area: String(form.get("area")) as NewDecision["area"],
          waitingOn: String(form.get("waitingOn") || "").trim(),
          deadline: saoPauloToISO(String(form.get("deadline") || "")),
          imageUrls: String(form.get("imageUrl") || "").trim()
            ? [String(form.get("imageUrl")).trim()]
            : [],
        },
        form
          .getAll("images")
          .filter((file): file is File => typeof file !== "string" && file.size > 0),
      );
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "We couldn’t add this decision. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="add-dialog"
      aria-labelledby="add-title"
      onCancel={(event) => {
        if (saving) event.preventDefault();
        else onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-heading">
          <span className="dialog-icon">
            <Plus size={21} />
          </span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close add decision"
            disabled={saving}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="add-title">One more thing to decide.</h2>
        <p className="dialog-description">A clear question is a good place to start.</p>
        <form onSubmit={submit} className="add-form">
          <label htmlFor="new-question">
            The question <span>*</span>
          </label>
          <input
            id="new-question"
            name="question"
            placeholder="What needs a decision?"
            required
            maxLength={240}
            autoFocus
          />
          <label htmlFor="new-context">
            A little context <span className="optional">optional</span>
          </label>
          <textarea
            id="new-context"
            name="context"
            placeholder="What would help you make the call?"
            rows={2}
            maxLength={4000}
          />
          <label htmlFor="new-options">
            Answer options <span className="optional">one per line</span>
          </label>
          <textarea
            id="new-options"
            name="options"
            placeholder={"Go with the first idea\nTry something different"}
            rows={3}
            maxLength={4019}
          />
          <p className="field-hint">
            Leave blank for an open question. A custom answer is always welcome.
          </p>
          <div className="form-row">
            <div>
              <label htmlFor="new-area">
                Area <span>*</span>
              </label>
              <select
                id="new-area"
                name="area"
                defaultValue={areas.includes("Other") ? "Other" : AREAS[0]}
              >
                {areas.map((area) => (
                  <option key={area}>{area}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="new-waiting">
                Waiting on <span className="optional">assistant</span>
              </label>
              <input
                id="new-waiting"
                name="waitingOn"
                placeholder="e.g. Design assistant"
                maxLength={100}
              />
            </div>
          </div>
          <label htmlFor="new-deadline">
            Deadline <span className="optional">optional</span>
          </label>
          <input id="new-deadline" name="deadline" type="datetime-local" />
          <p className="field-hint">All times are in São Paulo (America/Sao_Paulo).</p>
          <label htmlFor="new-image">
            Image URL <span className="optional">optional</span>
          </label>
          <input
            id="new-image"
            name="imageUrl"
            type="url"
            maxLength={2048}
            placeholder="https://example.com/design.png"
          />
          <p className="field-hint">
            Use a public PNG, JPEG, WebP, or GIF link. Images are copied into private storage when
            Appwrite is configured.
          </p>
          <label htmlFor="new-images">
            Upload images <span className="optional">optional</span>
          </label>
          <input
            id="new-images"
            name="images"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
          />
          <p className="field-hint">
            Up to 10 images total. Each image up to 3 MiB; combined uploads under 4 MiB.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add decision"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
