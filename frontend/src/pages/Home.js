import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ClipboardCheck, FileText, ListChecks, PackageCheck, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

const LOGO_URL = "https://customer-assets.emergentagent.com/job_c2cdf81f-38d8-495b-bbbc-bf9142927afb/artifacts/pll87efh_ChatGPT%20Image%20Jan%2013%2C%202026%2C%2007_06_32%20AM.png";

const features = [
  { icon: ClipboardCheck, title: "Audits & schedules", text: "Build repeatable audits, schedule recurring checks and keep a clear history of completion and findings." },
  { icon: ListChecks, title: "Actions & corrective actions", text: "Raise, assign, review and close actions with responsibility, due dates and supporting evidence." },
  { icon: PackageCheck, title: "Quality operations", text: "Record quality incidents, holds, disposal decisions and supporting photographs in one controlled system." },
  { icon: FileText, title: "Documents & records", text: "Create controlled forms, complete production records and bring quality paperwork into the same platform." },
  { icon: ShieldCheck, title: "Traceability & compliance", text: "Keep traceability records, release status and compliance information connected to the wider quality system." },
  { icon: Sparkles, title: "Built for practical QA teams", text: "A focused system designed to replace disconnected spreadsheets, paper forms and separate action trackers." },
];

const Home = () => (
  <div className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <Link to="/" aria-label="Infinit Audit home"><img src={LOGO_URL} alt="Infinit Audit" className="h-14 w-auto" /></Link>
        <nav className="hidden items-center gap-6 text-sm md:flex">
          <a href="#features" className="text-muted-foreground hover:text-foreground">Features</a>
          <Link to="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</Link>
          <Link to="/privacy" className="text-muted-foreground hover:text-foreground">Privacy</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild><Link to="/pricing">Pricing</Link></Button>
          <Button asChild><Link to="/login">Log in</Link></Button>
        </div>
      </div>
    </header>

    <main>
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 md:px-6 lg:grid-cols-[1.1fr_.9fr] lg:py-28">
          <div className="flex flex-col justify-center">
            <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-primary" /> Quality management, without the paperwork maze</div>
            <h1 className="max-w-4xl text-5xl font-bold tracking-tight sm:text-6xl">Your quality system.<br/><span className="text-primary">Connected.</span></h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">Infinit Audit brings audits, corrective actions, quality incidents, traceability and controlled records together in one straightforward platform for quality and manufacturing teams.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild><Link to="/pricing">View pricing <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              <Button size="lg" variant="outline" asChild><Link to="/login">Existing customer login</Link></Button>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["Secure accounts", "Company-scoped data", "Mobile-friendly", "Evidence photographs"].map(item => <span key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" />{item}</span>)}
            </div>
          </div>

          <Card className="self-center border-primary/20 shadow-xl">
            <CardHeader><p className="text-sm font-semibold text-primary">ONE QUALITY WORKSPACE</p><CardTitle className="text-2xl">From finding to close-out</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {[
                ["01", "Identify", "Record the audit finding, incident or quality issue."],
                ["02", "Assign", "Give the action to the right person or department with a due date."],
                ["03", "Evidence", "Attach notes and photographs to show what happened and what changed."],
                ["04", "Review", "Keep the record, action and close-out visible in one place."],
              ].map(([n,title,text]) => <div key={n} className="flex gap-4 rounded-lg border bg-muted/30 p-4"><div className="text-sm font-bold text-primary">{n}</div><div><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{text}</p></div></div>)}
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="features" className="border-y bg-muted/25">
        <div className="mx-auto max-w-7xl px-4 py-20 md:px-6">
          <div className="max-w-3xl"><p className="text-sm font-semibold uppercase tracking-wider text-primary">What Infinit Audit offers</p><h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">The day-to-day quality tools in one place</h2><p className="mt-4 text-muted-foreground">Designed around the work quality teams actually need to complete, review and evidence.</p></div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({icon:Icon,title,text}) => <Card key={title}><CardHeader><div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"><Icon className="h-5 w-5 text-primary" /></div><CardTitle className="text-xl">{title}</CardTitle></CardHeader><CardContent><p className="text-sm leading-6 text-muted-foreground">{text}</p></CardContent></Card>)}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 md:px-6">
        <div className="grid gap-8 rounded-2xl border bg-card p-8 md:grid-cols-[1fr_auto] md:items-center md:p-12">
          <div><p className="text-sm font-semibold uppercase tracking-wider text-primary">Simple pricing</p><h2 className="mt-2 text-3xl font-bold">Start from £79 per month</h2><p className="mt-3 max-w-2xl text-muted-foreground">Choose from Starter, Professional, Multi-Site and Enterprise options. Professional brings together the wider quality, traceability and document-control toolset.</p></div>
          <Button size="lg" asChild><Link to="/pricing">See plans & pricing <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-12 text-center md:px-6">
          <h2 className="text-3xl font-bold">Already using Infinit Audit?</h2><p className="text-muted-foreground">Sign in to your organisation's secure workspace.</p><div><Button size="lg" asChild><Link to="/login">Log in to Infinit Audit</Link></Button></div>
        </div>
      </section>
    </main>

    <footer className="border-t bg-card">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6">
        <img src={LOGO_URL} alt="Infinit Audit" className="h-10 w-auto object-contain object-left" />
        <div className="flex gap-5"><Link to="/pricing">Pricing</Link><Link to="/privacy">Privacy</Link><Link to="/login">Login</Link></div>
      </div>
    </footer>
  </div>
);
export default Home;
