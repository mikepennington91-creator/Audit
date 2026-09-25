import { Link } from "react-router-dom";
import { ArrowRight, FileText, ShieldCheck, Database, HardDrive, Siren, Users, ClipboardCheck, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";

const documents = [
  { title: "Terms of Service", summary: "Commercial SaaS terms covering accounts, customer data, fees, acceptable use, support and termination.", file: "terms-of-service.md", icon: Scale },
  { title: "Data Processing Agreement", summary: "UK GDPR processor terms covering instructions, security, subprocessors, breaches, transfers and deletion.", file: "data-processing-agreement.md", icon: ShieldCheck },
  { title: "Security Model", summary: "Authentication, tenant isolation, access control, logging, hosting and security testing requirements.", file: "security-model.md", icon: ShieldCheck },
  { title: "Subprocessor Register", summary: "Register and review requirements for Supabase, Render, Vercel, email and optional AI processing.", file: "subprocessors.md", icon: Users },
  { title: "Data Retention & Deletion", summary: "Retention, offboarding, account records, evidence and backup deletion rules.", file: "data-retention-deletion.md", icon: Database },
  { title: "Backup & Restore", summary: "Backup controls, restore testing and disaster-recovery expectations.", file: "backup-restore.md", icon: HardDrive },
  { title: "Incident Response", summary: "Security and data-incident severity, containment, assessment, notification and review process.", file: "incident-response.md", icon: Siren },
  { title: "Photograph Storage Standard", summary: "Image optimisation, private object storage, capacity and legacy-image migration standard.", file: "photo-storage.md", icon: FileText },
  { title: "Commercial Launch Checklist", summary: "Pre-launch legal, security, operational, billing and infrastructure actions.", file: "commercial-launch-checklist.md", icon: ClipboardCheck },
];

const CommercialDocuments = () => (
  <div className="space-y-6">
    <div>
      <p className="text-sm font-semibold uppercase tracking-wider text-primary">Master administration</p>
      <h1 className="text-3xl font-bold mt-1">Commercial & Legal</h1>
      <p className="text-muted-foreground mt-2 max-w-3xl">
        Working commercial documents for Infinit Audit. This area is restricted to the system administrator while the documents are being reviewed.
      </p>
    </div>
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      Draft documents must be completed and legally reviewed before they are published as customer-facing contractual terms.
    </div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {documents.map(({ title, summary, file, icon: Icon }) => (
        <Card key={file}>
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2"><Icon className="h-5 w-5 text-primary" /></div>
              <CardTitle className="text-lg">{title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground min-h-16">{summary}</p>
            <Button className="mt-4 w-full" variant="outline" asChild>
              <Link to={`/system/commercial-documents/${file}`}>Review document <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  </div>
);
export default CommercialDocuments;
