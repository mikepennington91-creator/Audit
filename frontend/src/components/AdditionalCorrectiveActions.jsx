import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Plus, Trash2, UserCheck } from "lucide-react";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const newAction = () => ({
  id:
    globalThis.crypto?.randomUUID?.() ||
    `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  action_required: "",
  assigned_user_id: "",
  due_date: "",
});

const today = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function AdditionalCorrectiveActions({ questionId }) {
  const runId = useMemo(() => {
    const match = window.location.pathname.match(/\/run-audit\/([^/]+)/);
    return match?.[1] || null;
  }, []);
  const [actions, setActions] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!runId || runId.startsWith("offline_")) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    Promise.all([
      axios.get(`${API}/action-assignees`),
      axios.get(
        `${API}/run-audits/${runId}/questions/${questionId}/additional-actions`,
      ),
    ])
      .then(([assigneeResponse, actionResponse]) => {
        if (cancelled) return;
        setAssignees(assigneeResponse.data || []);
        setActions(actionResponse.data?.actions || []);
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load additional corrective actions");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [questionId, runId]);

  useEffect(() => {
    if (!loaded || !runId || runId.startsWith("offline_")) return undefined;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      try {
        await axios.put(
          `${API}/run-audits/${runId}/questions/${questionId}/additional-actions`,
          { actions },
        );
      } catch (error) {
        toast.error(
          error.response?.data?.detail || "Could not save additional corrective actions",
        );
      } finally {
        setSaving(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [actions, loaded, questionId, runId]);

  const update = (id, field, value) => {
    setActions((current) =>
      current.map((action) =>
        action.id === id ? { ...action, [field]: value } : action,
      ),
    );
  };

  if (!runId || runId.startsWith("offline_")) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Additional corrective actions can be added once this audit is online.
      </p>
    );
  }

  return (
    <div className="mt-5 space-y-4" data-testid="additional-corrective-actions">
      {actions.map((action, index) => (
        <div
          key={action.id}
          className="space-y-3 rounded-lg border border-red-200 bg-background/70 p-4 dark:border-red-900"
        >
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-semibold">Corrective Action {index + 2}</h4>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-destructive hover:bg-destructive/10"
              onClick={() =>
                setActions((current) => current.filter((item) => item.id !== action.id))
              }
              aria-label={`Remove corrective action ${index + 2}`}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Action Required *</label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="What else needs to be done to correct or prevent this issue?"
              value={action.action_required}
              onChange={(event) => update(action.id, "action_required", event.target.value)}
              data-testid={`additional-action-required-${index}`}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Action Owner *</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={action.assigned_user_id}
              onChange={(event) => update(action.id, "assigned_user_id", event.target.value)}
              data-testid={`additional-action-owner-${index}`}
            >
              <option value="">Choose a registered user...</option>
              {assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>
                  {assignee.name} ({assignee.email})
                </option>
              ))}
            </select>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <UserCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Each corrective action has its own accountable owner and action reference.
            </p>
          </div>

          <div className="space-y-2 sm:max-w-xs">
            <label className="text-sm font-medium">Due Date *</label>
            <input
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              type="date"
              min={today()}
              value={action.due_date}
              onChange={(event) => update(action.id, "due_date", event.target.value)}
              data-testid={`additional-action-due-${index}`}
            />
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => setActions((current) => [...current, newAction()])}
          data-testid="add-corrective-action-btn"
        >
          <Plus className="h-4 w-4" />
          Add Corrective Action
        </button>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>
    </div>
  );
}
