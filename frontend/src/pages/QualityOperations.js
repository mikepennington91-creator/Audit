import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  AlertTriangle,
  BarChart3,
  Camera,
  CheckCircle2,
  Download,
  FileCheck2,
  Factory,
  Link2,
  PackageCheck,
  Plus,
  Save,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TABS = ["records", "suppliers", "documents", "insights", "management"];
const today = () => new Date().toISOString().slice(0, 10);
const emptyEvent = {
  event_type: "quality_incident",
  title: "",
  description: "",
  occurred_date: today(),
  severity: "medium",
  location: "",
  product_name: "",
  batch_code: "",
  supplier_id: "",
  owner_user_id: "",
  due_date: "",
  immediate_action: "",
  root_cause_category: "",
  root_cause: "",
  corrective_action: "",
  evidence: [],
};
const emptySupplier = {
  name: "",
  category: "",
  contact_name: "",
  contact_email: "",
  risk_rating: "medium",
  approval_status: "pending",
  questionnaire_status: "not_sent",
  performance_score: "",
  last_audit_date: "",
  audit_result: "",
  approval_expiry: "",
  next_review_date: "",
  notes: "",
  certificates: [],
};

const statusClass = (value) => {
  if (["approved", "closed", "acknowledged", "low"].includes(value))
    return "bg-emerald-600 text-white";
  if (["critical", "rejected", "suspended", "overdue"].includes(value))
    return "bg-red-600 text-white";
  if (["high", "conditional", "awaiting_review"].includes(value))
    return "bg-amber-500 text-black";
  return "";
};

const readable = (value) =>
  String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const QualityOperations = () => {
  const { user, isAdmin, hasFeature } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState(
    TABS.includes(requestedTab) ? requestedTab : "records",
  );
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [signoffs, setSignoffs] = useState([]);
  const [users, setUsers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [actions, setActions] = useState([]);
  const [insights, setInsights] = useState(null);
  const [management, setManagement] = useState(null);
  const [reportSchedule, setReportSchedule] = useState({
    enabled: false,
    frequency: "monthly",
    recipient_user_ids: [],
    weekday: 0,
    month_day: 1,
    report_days: 30,
  });
  const [selected, setSelected] = useState(null);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [supplierForm, setSupplierForm] = useState(emptySupplier);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [signoffForm, setSignoffForm] = useState({
    template_id: "",
    user_ids: [],
    due_date: today(),
    message: "",
  });
  const [saving, setSaving] = useState(false);
  const photoInput = useRef(null);
  const canEdit = hasFeature("quality_edit");

  const load = async () => {
    setLoading(true);
    try {
      const requests = [
        axios.get(`${API}/quality-events`),
        axios.get(`${API}/suppliers`),
        axios.get(`${API}/document-signoffs`),
        axios.get(`${API}/quality-insights`),
      ];
      if (isAdmin())
        requests.push(
          axios.get(`${API}/users`),
          axios.get(`${API}/management-report?days=30`),
          axios.get(`${API}/management-report/schedule`),
        );
      if (hasFeature("documents"))
        requests.push(axios.get(`${API}/documents/summary`));
      if (hasFeature("actions"))
        requests.push(axios.get(`${API}/actions?limit=500`));
      const responses = await Promise.all(requests);
      setEvents(responses[0].data);
      setSuppliers(responses[1].data);
      setSignoffs(responses[2].data);
      setInsights(responses[3].data);
      let index = 4;
      if (isAdmin()) {
        setUsers(responses[index++].data);
        setManagement(responses[index++].data);
        setReportSchedule(responses[index++].data);
      }
      if (hasFeature("documents"))
        setTemplates(responses[index++].data.templates || []);
      if (hasFeature("actions"))
        setActions(
          responses[index++]?.data?.items || responses[index - 1]?.data || [],
        );
      const eventId = searchParams.get("event");
      if (eventId) {
        const detail = await axios.get(`${API}/quality-events/${eventId}`);
        setSelected(detail.data);
      }
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not load quality operations",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const changeTab = (next) => {
    setTab(next);
    setSearchParams(next === "records" ? {} : { tab: next });
  };

  const openEvent = async (id) => {
    try {
      const response = await axios.get(`${API}/quality-events/${id}`);
      setSelected(response.data);
      setSearchParams({ event: id });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not open record");
    }
  };

  const submitEvent = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await axios.post(`${API}/quality-events`, {
        ...eventForm,
        supplier_id: eventForm.supplier_id || null,
        owner_user_id: eventForm.owner_user_id || (isAdmin() ? null : user.id),
        due_date: eventForm.due_date || null,
      });
      toast.success("Quality record created");
      setEventForm({ ...emptyEvent, occurred_date: today() });
      await load();
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not create quality record",
      );
    } finally {
      setSaving(false);
    }
  };

  const submitSupplier = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...supplierForm,
        approval_expiry: supplierForm.approval_expiry || null,
        next_review_date: supplierForm.next_review_date || null,
        last_audit_date: supplierForm.last_audit_date || null,
        audit_result: supplierForm.audit_result || null,
        performance_score:
          supplierForm.performance_score === ""
            ? null
            : Number(supplierForm.performance_score),
      };
      if (editingSupplier) {
        const change_reason = window.prompt(
          "Explain why this supplier record is being changed:",
        );
        if (!change_reason) return;
        await axios.put(`${API}/suppliers/${editingSupplier.id}`, {
          ...payload,
          change_reason,
        });
        toast.success("Supplier updated");
      } else {
        await axios.post(`${API}/suppliers`, payload);
        toast.success("Supplier added");
      }
      setSupplierForm(emptySupplier);
      setEditingSupplier(null);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not add supplier");
    } finally {
      setSaving(false);
    }
  };

  const submitSignoffs = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/document-signoffs`,
        signoffForm,
      );
      toast.success(
        `${response.data.count} acknowledgement${response.data.count === 1 ? "" : "s"} assigned`,
      );
      setSignoffForm({
        template_id: "",
        user_ids: [],
        due_date: today(),
        message: "",
      });
      await load();
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not assign acknowledgements",
      );
    } finally {
      setSaving(false);
    }
  };

  const acknowledge = async (record) => {
    const declaration = window.prompt(
      `Confirm that you have read and understood ${record.document_title} version ${record.document_version}:`,
    );
    if (!declaration) return;
    try {
      await axios.put(`${API}/document-signoffs/${record.id}/acknowledge`, {
        declaration,
      });
      toast.success("Acknowledgement recorded");
      await load();
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not record acknowledgement",
      );
    }
  };

  const updateSelected = async () => {
    const change_note = window.prompt("Explain what you have updated:");
    if (!change_note) return;
    setSaving(true);
    try {
      const response = await axios.put(`${API}/quality-events/${selected.id}`, {
        immediate_action: selected.immediate_action || null,
        root_cause_category: selected.root_cause_category || null,
        root_cause: selected.root_cause || null,
        corrective_action: selected.corrective_action || null,
        evidence: selected.evidence || [],
        change_note,
      });
      setSelected(response.data);
      toast.success("Investigation saved");
      await load();
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not save investigation",
      );
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status) => {
    const comment = window.prompt(
      `Enter the reason for changing this record to ${readable(status)}:`,
    );
    if (!comment) return;
    try {
      const response = await axios.put(
        `${API}/quality-events/${selected.id}/status`,
        { status, comment },
      );
      setSelected(response.data);
      toast.success("Status updated");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not update status");
    }
  };

  const linkAction = async (actionId) => {
    if (!actionId) return;
    try {
      await axios.post(`${API}/quality-events/${selected.id}/actions`, {
        action_id: actionId,
      });
      toast.success("Corrective action linked");
      await openEvent(selected.id);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not link action");
    }
  };

  const evidenceDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Unreadable image"));
      };
      image.src = objectUrl;
    });

  const addEvidence = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Select an image file");
    try {
      const image = await evidenceDataUrl(file);
      setSelected((current) => ({
        ...current,
        evidence: [...(current.evidence || []), image],
      }));
    } catch (error) {
      toast.error("Could not prepare that image");
    }
  };

  const downloadManagement = async () => {
    try {
      const response = await axios.get(`${API}/management-report/pdf?days=30`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Infinit_Audit_Management_Report_${today()}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not generate management report",
      );
    }
  };

  const saveReportSchedule = async () => {
    if (!reportSchedule.recipient_user_ids?.length)
      return toast.error("Select at least one report recipient");
    setSaving(true);
    try {
      const response = await axios.put(
        `${API}/management-report/schedule`,
        reportSchedule,
      );
      setReportSchedule(response.data);
      toast.success("Automatic management reports scheduled");
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not save report schedule",
      );
    } finally {
      setSaving(false);
    }
  };

  const selectedIsOwner = selected?.owner_user_id === user?.id;
  const activeSignoffs = useMemo(
    () => signoffs.filter((item) => item.status !== "acknowledged"),
    [signoffs],
  );

  if (selected)
    return (
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <Button
              variant="ghost"
              className="px-0 mb-2"
              onClick={() => {
                setSelected(null);
                setSearchParams({});
              }}
            >
              ← Back to quality records
            </Button>
            <h1 className="text-3xl font-bold">{selected.title}</h1>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge>{readable(selected.event_type)}</Badge>
              <Badge className={statusClass(selected.severity)}>
                {readable(selected.severity)}
              </Badge>
              <Badge className={statusClass(selected.status)}>
                {readable(selected.status)}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(selectedIsOwner || isAdmin()) &&
              !["closed", "cancelled"].includes(selected.status) && (
                <Button
                  variant="outline"
                  onClick={() => setStatus("awaiting_review")}
                >
                  Submit for Review
                </Button>
              )}
            {isAdmin() && selected.status === "awaiting_review" && (
              <Button onClick={() => setStatus("closed")}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Approve & Close
              </Button>
            )}
          </div>
        </div>
        <div className="grid xl:grid-cols-[1fr_360px] gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Investigation and corrective action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Description</Label>
                <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-3">
                  {selected.description}
                </p>
              </div>
              {[
                ["immediate_action", "Immediate containment / action"],
                ["root_cause_category", "Root-cause category"],
                ["root_cause", "Root-cause investigation"],
                ["corrective_action", "Corrective and preventive action"],
              ].map(([key, label]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  {key === "root_cause_category" ? (
                    <Input
                      value={selected[key] || ""}
                      disabled={!selectedIsOwner && !isAdmin()}
                      onChange={(e) =>
                        setSelected({ ...selected, [key]: e.target.value })
                      }
                    />
                  ) : (
                    <Textarea
                      rows={4}
                      value={selected[key] || ""}
                      disabled={!selectedIsOwner && !isAdmin()}
                      onChange={(e) =>
                        setSelected({ ...selected, [key]: e.target.value })
                      }
                    />
                  )}
                </div>
              ))}
              {(selectedIsOwner || isAdmin()) &&
                !["closed", "cancelled"].includes(selected.status) && (
                  <Button onClick={updateSelected} disabled={saving}>
                    <Save className="w-4 h-4 mr-2" />
                    Save Investigation
                  </Button>
                )}
            </CardContent>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Record details</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {[
                  ["Occurred", selected.occurred_date],
                  ["Location", selected.location],
                  ["Product", selected.product_name],
                  ["Batch", selected.batch_code],
                  ["Supplier", selected.supplier_name],
                  ["Owner", selected.owner_user_name],
                  ["Due", selected.due_date],
                  ["Raised by", selected.created_by_name],
                ].map(([label, value]) => (
                  <div className="flex justify-between gap-4" key={label}>
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-right">{value || "-"}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Evidence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <input
                  ref={photoInput}
                  className="hidden"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    addEvidence(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {(selectedIsOwner || isAdmin()) && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => photoInput.current?.click()}
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Take or Add Photo
                  </Button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {(selected.evidence || []).map((image, index) => (
                    <div className="relative" key={index}>
                      <img
                        className="w-full aspect-square object-cover rounded-md"
                        src={image}
                        alt={`Evidence ${index + 1}`}
                      />
                      {(selectedIsOwner || isAdmin()) && (
                        <button
                          className="absolute top-1 right-1 bg-black/70 text-white rounded-full p-1"
                          onClick={() =>
                            setSelected({
                              ...selected,
                              evidence: selected.evidence.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Linked corrective actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(selected.linked_action_ids || []).map((id) => (
                  <Button
                    asChild
                    variant="outline"
                    className="w-full justify-start"
                    key={id}
                  >
                    <Link to={`/actions?action=${id}`}>
                      <Link2 className="w-4 h-4 mr-2" />
                      Open linked action
                    </Link>
                  </Button>
                ))}
                {(selectedIsOwner || isAdmin()) && (
                  <select
                    className="w-full h-10 border rounded-md bg-background px-3"
                    defaultValue=""
                    onChange={(e) => {
                      linkAction(e.target.value);
                      e.target.value = "";
                    }}
                  >
                    <option value="">Link an action…</option>
                    {actions
                      .filter(
                        (action) =>
                          !(selected.linked_action_ids || []).includes(
                            action.id,
                          ),
                      )
                      .map((action) => (
                        <option key={action.id} value={action.id}>
                          {action.title || action.non_conformance}
                        </option>
                      ))}
                  </select>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(selected.history || [])
                  .slice()
                  .reverse()
                  .map((item, index) => (
                    <div className="border-l-2 pl-3 text-sm" key={index}>
                      <p className="font-medium">{readable(item.event)}</p>
                      <p className="text-muted-foreground">
                        {item.user_name} · {item.at}
                      </p>
                      {item.comment && <p>{item.comment}</p>}
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Quality Operations
        </h1>
        <p className="text-muted-foreground mt-1">
          Incidents, complaints, non-conformances, suppliers, document sign-offs
          and management oversight.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:flex gap-2">
        {TABS.filter((item) => isAdmin() || !["management"].includes(item)).map(
          (item) => (
            <Button
              key={item}
              variant={tab === item ? "default" : "outline"}
              className="min-h-10 whitespace-normal"
              onClick={() => changeTab(item)}
            >
              {readable(item)}
            </Button>
          ),
        )}
      </div>
      {loading && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Loading quality operations…
          </CardContent>
        </Card>
      )}

      {!loading && tab === "records" && (
        <div
          className={`grid ${canEdit ? "xl:grid-cols-[390px_1fr]" : ""} gap-5`}
        >
          {canEdit && (
            <Card>
              <CardHeader>
                <CardTitle>Raise a quality record</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={submitEvent}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Record type</Label>
                      <select
                        className="w-full h-10 border rounded-md bg-background px-3"
                        value={eventForm.event_type}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            event_type: e.target.value,
                          })
                        }
                      >
                        {[
                          "quality_incident",
                          "incident",
                          "complaint",
                          "ncr",
                          "foreign_body",
                          "ccp_failure",
                        ].map((item) => (
                          <option value={item} key={item}>
                            {readable(item)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label>Severity</Label>
                      <select
                        className="w-full h-10 border rounded-md bg-background px-3"
                        value={eventForm.severity}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            severity: e.target.value,
                          })
                        }
                      >
                        {["low", "medium", "high", "critical"].map((item) => (
                          <option value={item} key={item}>
                            {readable(item)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <Label>Title</Label>
                    <Input
                      required
                      value={eventForm.title}
                      onChange={(e) =>
                        setEventForm({ ...eventForm, title: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      required
                      rows={4}
                      value={eventForm.description}
                      onChange={(e) =>
                        setEventForm({
                          ...eventForm,
                          description: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Occurred</Label>
                      <Input
                        required
                        type="date"
                        value={eventForm.occurred_date}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            occurred_date: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Due date</Label>
                      <Input
                        type="date"
                        value={eventForm.due_date}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            due_date: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Product</Label>
                      <Input
                        value={eventForm.product_name}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            product_name: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Batch</Label>
                      <Input
                        value={eventForm.batch_code}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            batch_code: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Location</Label>
                    <Input
                      value={eventForm.location}
                      onChange={(e) =>
                        setEventForm({ ...eventForm, location: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>Immediate action</Label>
                    <Textarea
                      value={eventForm.immediate_action}
                      onChange={(e) =>
                        setEventForm({
                          ...eventForm,
                          immediate_action: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Owner</Label>
                    <select
                      className="w-full h-10 border rounded-md bg-background px-3"
                      value={eventForm.owner_user_id}
                      onChange={(e) =>
                        setEventForm({
                          ...eventForm,
                          owner_user_id: e.target.value,
                        })
                      }
                    >
                      <option value="">Unassigned</option>
                      {users.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Supplier</Label>
                    <select
                      className="w-full h-10 border rounded-md bg-background px-3"
                      value={eventForm.supplier_id}
                      onChange={(e) =>
                        setEventForm({
                          ...eventForm,
                          supplier_id: e.target.value,
                        })
                      }
                    >
                      <option value="">Not supplier related</option>
                      {suppliers.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button className="w-full" disabled={saving}>
                    <Plus className="w-4 h-4 mr-2" />
                    Raise Record
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Quality records</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {events.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openEvent(item.id)}
                  className="w-full text-left rounded-lg border p-4 hover:bg-muted transition-colors"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <p className="font-semibold">{item.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {readable(item.event_type)} · {item.occurred_date} ·{" "}
                        {item.owner_user_name || "Unassigned"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Badge className={statusClass(item.severity)}>
                        {readable(item.severity)}
                      </Badge>
                      <Badge className={statusClass(item.status)}>
                        {readable(item.status)}
                      </Badge>
                    </div>
                  </div>
                </button>
              ))}
              {!events.length && (
                <p className="text-muted-foreground">
                  No quality records have been raised.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && tab === "suppliers" && (
        <div
          className={`grid ${canEdit ? "xl:grid-cols-[390px_1fr]" : ""} gap-5`}
        >
          {canEdit && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {editingSupplier
                    ? "Update supplier"
                    : "Add approved supplier"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={submitSupplier}>
                  <div>
                    <Label>Supplier name</Label>
                    <Input
                      required
                      value={supplierForm.name}
                      onChange={(e) =>
                        setSupplierForm({
                          ...supplierForm,
                          name: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Material / service category</Label>
                    <Input
                      required
                      value={supplierForm.category}
                      onChange={(e) =>
                        setSupplierForm({
                          ...supplierForm,
                          category: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Risk</Label>
                      <select
                        className="w-full h-10 border rounded-md bg-background px-3"
                        value={supplierForm.risk_rating}
                        onChange={(e) =>
                          setSupplierForm({
                            ...supplierForm,
                            risk_rating: e.target.value,
                          })
                        }
                      >
                        {["low", "medium", "high", "critical"].map((item) => (
                          <option value={item} key={item}>
                            {readable(item)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label>Status</Label>
                      <select
                        className="w-full h-10 border rounded-md bg-background px-3"
                        value={supplierForm.approval_status}
                        onChange={(e) =>
                          setSupplierForm({
                            ...supplierForm,
                            approval_status: e.target.value,
                          })
                        }
                      >
                        {[
                          "pending",
                          "approved",
                          "conditional",
                          "suspended",
                          "rejected",
                        ].map((item) => (
                          <option value={item} key={item}>
                            {readable(item)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <Label>Questionnaire status</Label>
                    <select
                      className="w-full h-10 border rounded-md bg-background px-3"
                      value={supplierForm.questionnaire_status}
                      onChange={(e) => setSupplierForm({ ...supplierForm, questionnaire_status: e.target.value })}
                    >
                      {["not_sent", "sent", "returned", "approved", "rejected"].map((item) => <option value={item} key={item}>{readable(item)}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Performance score (%)</Label>
                      <Input type="number" min="0" max="100" value={supplierForm.performance_score} onChange={(e) => setSupplierForm({ ...supplierForm, performance_score: e.target.value })} />
                    </div>
                    <div>
                      <Label>Last supplier audit</Label>
                      <Input type="date" value={supplierForm.last_audit_date} onChange={(e) => setSupplierForm({ ...supplierForm, last_audit_date: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label>Supplier audit result</Label>
                    <select className="w-full h-10 border rounded-md bg-background px-3" value={supplierForm.audit_result} onChange={(e) => setSupplierForm({ ...supplierForm, audit_result: e.target.value })}>
                      <option value="">Not recorded</option>
                      {["pass", "conditional", "fail"].map((item) => <option value={item} key={item}>{readable(item)}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Approval expiry</Label>
                      <Input
                        type="date"
                        value={supplierForm.approval_expiry}
                        onChange={(e) =>
                          setSupplierForm({
                            ...supplierForm,
                            approval_expiry: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Next review</Label>
                      <Input
                        type="date"
                        value={supplierForm.next_review_date}
                        onChange={(e) =>
                          setSupplierForm({
                            ...supplierForm,
                            next_review_date: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Contact</Label>
                    <Input
                      value={supplierForm.contact_name}
                      onChange={(e) =>
                        setSupplierForm({
                          ...supplierForm,
                          contact_name: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={supplierForm.contact_email}
                      onChange={(e) =>
                        setSupplierForm({
                          ...supplierForm,
                          contact_email: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center">
                      <Label>Certificates</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setSupplierForm({
                            ...supplierForm,
                            certificates: [
                              ...(supplierForm.certificates || []),
                              { name: "", reference: "", expiry_date: "" },
                            ],
                          })
                        }
                      >
                        Add certificate
                      </Button>
                    </div>
                    <div className="space-y-2 mt-2">
                      {(supplierForm.certificates || []).map(
                        (certificate, index) => (
                          <div
                            className="grid grid-cols-[1fr_1fr_auto] gap-2"
                            key={index}
                          >
                            <Input
                              required
                              placeholder="Certificate"
                              value={certificate.name || ""}
                              onChange={(e) =>
                                setSupplierForm({
                                  ...supplierForm,
                                  certificates: supplierForm.certificates.map(
                                    (item, i) =>
                                      i === index
                                        ? { ...item, name: e.target.value }
                                        : item,
                                  ),
                                })
                              }
                            />
                            <Input
                              type="date"
                              aria-label="Certificate expiry"
                              value={certificate.expiry_date || ""}
                              onChange={(e) =>
                                setSupplierForm({
                                  ...supplierForm,
                                  certificates: supplierForm.certificates.map(
                                    (item, i) =>
                                      i === index
                                        ? {
                                            ...item,
                                            expiry_date: e.target.value,
                                          }
                                        : item,
                                  ),
                                })
                              }
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                setSupplierForm({
                                  ...supplierForm,
                                  certificates:
                                    supplierForm.certificates.filter(
                                      (_, i) => i !== index,
                                    ),
                                })
                              }
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea
                      value={supplierForm.notes}
                      onChange={(e) =>
                        setSupplierForm({
                          ...supplierForm,
                          notes: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button className="flex-1" disabled={saving}>
                      <PackageCheck className="w-4 h-4 mr-2" />
                      {editingSupplier ? "Save Supplier" : "Add Supplier"}
                    </Button>
                    {editingSupplier && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingSupplier(null);
                          setSupplierForm(emptySupplier);
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Supplier approval register</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {suppliers.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    if (!canEdit) return;
                    setEditingSupplier(item);
                    setSupplierForm({
                      ...emptySupplier,
                      ...item,
                      approval_expiry: item.approval_expiry || "",
                      next_review_date: item.next_review_date || "",
                      certificates: item.certificates || [],
                    });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="w-full text-left rounded-lg border p-4 hover:bg-muted"
                >
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <p className="font-semibold">{item.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.category} · Review{" "}
                        {item.next_review_date || "not set"}
                      </p>
                      {item.expired_certificate_count > 0 && (
                        <p className="text-sm text-red-600 mt-1">
                          {item.expired_certificate_count} expired
                          certificate(s)
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Badge className={statusClass(item.risk_rating)}>
                        {readable(item.risk_rating)} risk
                      </Badge>
                      <Badge className={statusClass(item.approval_status)}>
                        {readable(item.approval_status)}
                      </Badge>
                    </div>
                  </div>
                </button>
              ))}
              {!suppliers.length && (
                <p className="text-muted-foreground">
                  No suppliers have been added.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && tab === "documents" && (
        <div
          className={`grid ${isAdmin() ? "xl:grid-cols-[390px_1fr]" : ""} gap-5`}
        >
          {isAdmin() && (
            <Card>
              <CardHeader>
                <CardTitle>Require document sign-off</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={submitSignoffs}>
                  <div>
                    <Label>Controlled document</Label>
                    <select
                      required
                      className="w-full h-10 border rounded-md bg-background px-3"
                      value={signoffForm.template_id}
                      onChange={(e) =>
                        setSignoffForm({
                          ...signoffForm,
                          template_id: e.target.value,
                        })
                      }
                    >
                      <option value="">Select document</option>
                      {templates.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.title} · v{item.version}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Employees</Label>
                    <div className="max-h-52 overflow-auto rounded-md border p-2 space-y-1">
                      {users.map((item) => (
                        <label
                          key={item.id}
                          className="flex items-center gap-2 p-2 hover:bg-muted rounded"
                        >
                          <input
                            type="checkbox"
                            checked={signoffForm.user_ids.includes(item.id)}
                            onChange={(e) =>
                              setSignoffForm({
                                ...signoffForm,
                                user_ids: e.target.checked
                                  ? [...signoffForm.user_ids, item.id]
                                  : signoffForm.user_ids.filter(
                                      (id) => id !== item.id,
                                    ),
                              })
                            }
                          />
                          {item.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Due date</Label>
                    <Input
                      type="date"
                      required
                      value={signoffForm.due_date}
                      onChange={(e) =>
                        setSignoffForm({
                          ...signoffForm,
                          due_date: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Message</Label>
                    <Textarea
                      value={signoffForm.message}
                      onChange={(e) =>
                        setSignoffForm({
                          ...signoffForm,
                          message: e.target.value,
                        })
                      }
                    />
                  </div>
                  <Button
                    className="w-full"
                    disabled={saving || !signoffForm.user_ids.length}
                  >
                    <FileCheck2 className="w-4 h-4 mr-2" />
                    Assign Sign-offs
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>
                {isAdmin()
                  ? "Document acknowledgement register"
                  : "My document acknowledgements"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {signoffs.map((item) => (
                <div key={item.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {item.document_title} · version {item.document_version}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {item.user_name} · due {item.due_date}
                      </p>
                    </div>
                    <Badge className={statusClass(item.status)}>
                      {readable(item.status)}
                    </Badge>
                  </div>
                  {item.user_id === user.id &&
                    item.status !== "acknowledged" && (
                      <Button
                        size="sm"
                        className="mt-3"
                        onClick={() => acknowledge(item)}
                      >
                        Read & Acknowledge
                      </Button>
                    )}
                </div>
              ))}
              {!signoffs.length && (
                <p className="text-muted-foreground">
                  No document acknowledgements.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && tab === "insights" && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {Object.entries(insights?.counts || {}).map(([key, value]) => (
              <Card key={key}>
                <CardContent className="pt-6">
                  <p className="text-3xl font-bold">{value}</p>
                  <p className="text-sm text-muted-foreground">
                    {readable(key)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            {[
              ["Root causes", "root_causes"],
              ["Recurring audit findings", "recurring_findings"],
              ["Record types", "event_types"],
              ["Affected products", "affected_products"],
            ].map(([label, key]) => (
              <Card key={key}>
                <CardHeader>
                  <CardTitle>{label}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(insights?.[key] || []).map((item) => (
                    <div
                      className="flex justify-between border-b py-2"
                      key={item.name}
                    >
                      <span>{item.name}</span>
                      <Badge variant="outline">{item.count}</Badge>
                    </div>
                  ))}
                  {!(insights?.[key] || []).length && (
                    <p className="text-muted-foreground">No trend data yet.</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === "management" && isAdmin() && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">
                30-day management overview
              </h2>
              <p className="text-muted-foreground">
                A concise, audit-ready summary for technical and
                senior-management review.
              </p>
            </div>
            <Button onClick={downloadManagement}>
              <Download className="w-4 h-4 mr-2" />
              Download Management PDF
            </Button>
          </div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {Object.entries(management?.counts || {}).map(([key, value]) => (
              <Card key={key}>
                <CardContent className="pt-6">
                  <p className="text-3xl font-bold">
                    {key === "audit_pass_rate" ? `${value}%` : value}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {readable(key)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Automatic management report</CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={reportSchedule.enabled || false}
                    onChange={(e) =>
                      setReportSchedule({
                        ...reportSchedule,
                        enabled: e.target.checked,
                      })
                    }
                  />
                  Email this report automatically
                </label>
                <div>
                  <Label>Frequency</Label>
                  <select
                    className="w-full h-10 border rounded-md bg-background px-3"
                    value={reportSchedule.frequency}
                    onChange={(e) =>
                      setReportSchedule({
                        ...reportSchedule,
                        frequency: e.target.value,
                      })
                    }
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                {reportSchedule.frequency === "weekly" ? (
                  <div>
                    <Label>Send on</Label>
                    <select
                      className="w-full h-10 border rounded-md bg-background px-3"
                      value={reportSchedule.weekday}
                      onChange={(e) =>
                        setReportSchedule({
                          ...reportSchedule,
                          weekday: Number(e.target.value),
                        })
                      }
                    >
                      {[
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                        "Sunday",
                      ].map((day, index) => (
                        <option value={index} key={day}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <Label>Day of month</Label>
                    <Input
                      type="number"
                      min="1"
                      max="28"
                      value={reportSchedule.month_day}
                      onChange={(e) =>
                        setReportSchedule({
                          ...reportSchedule,
                          month_day: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                )}
                <div>
                  <Label>Report period (days)</Label>
                  <Input
                    type="number"
                    min="7"
                    max="366"
                    value={reportSchedule.report_days}
                    onChange={(e) =>
                      setReportSchedule({
                        ...reportSchedule,
                        report_days: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <Label>Recipients</Label>
                <div className="mt-1 max-h-64 overflow-auto rounded-md border p-2 space-y-1">
                  {users.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-center gap-2 p-2 hover:bg-muted rounded"
                    >
                      <input
                        type="checkbox"
                        checked={(
                          reportSchedule.recipient_user_ids || []
                        ).includes(item.id)}
                        onChange={(e) =>
                          setReportSchedule({
                            ...reportSchedule,
                            recipient_user_ids: e.target.checked
                              ? [
                                  ...(reportSchedule.recipient_user_ids || []),
                                  item.id,
                                ]
                              : (
                                  reportSchedule.recipient_user_ids || []
                                ).filter((id) => id !== item.id),
                          })
                        }
                      />
                      {item.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        {item.email}
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  className="w-full mt-3"
                  onClick={saveReportSchedule}
                  disabled={saving}
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Automatic Report
                </Button>
                {reportSchedule.last_sent_at && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Last sent {reportSchedule.last_sent_at}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default QualityOperations;
