import { Link } from "react-router-dom";
import { Check, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

const LOGO_URL = "https://customer-assets.emergentagent.com/job_c2cdf81f-38d8-495b-bbbc-bf9142927afb/artifacts/pll87efh_ChatGPT%20Image%20Jan%2013%2C%202026%2C%2007_06_32%20AM.png";

const plans = [
  {
    name: "Starter",
    price: "£79",
    suffix: "/month",
    description: "For smaller teams moving quality records away from paper and spreadsheets.",
    features: ["1 site", "Up to 5 users", "Audits & schedules", "Actions & corrective actions", "Quality records", "Standard reporting"],
  },
  {
    name: "Professional",
    price: "£149",
    suffix: "/month",
    description: "For food manufacturers that need a joined-up quality and compliance system.",
    featured: true,
    features: ["1 site", "Up to 15 users", "Everything in Starter", "Hold & disposal", "Traceability", "Document control", "Advanced reporting"],
  },
  {
    name: "Multi-Site",
    price: "£249",
    suffix: "/month",
    description: "For organisations managing quality across more than one location.",
    features: ["First 2 sites included", "Up to 30 users", "Everything in Professional", "Cross-site administration", "Additional sites £99/month", "Priority support"],
  },
  {
    name: "Enterprise",
    price: "Let's talk",
    suffix: "",
    description: "For larger groups with specific security, support, deployment or integration requirements.",
    features: ["Custom sites & users", "Custom onboarding", "Security review support", "Integration planning", "Data migration planning", "Commercial SLA options"],
  },
];

const Pricing = () => (
  <div className="min-h-screen bg-background">
    <header className="sticky top-0 z-50 border-b bg-card/95 shadow-sm backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4 md:px-6">
        <Link to="/"><img src={LOGO_URL} alt="Infinit Audit" className="h-16 w-auto md:h-20" /></Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="hidden sm:inline-flex" asChild><Link to="/">Home</Link></Button>
          <Button variant="ghost" className="hidden sm:inline-flex" asChild><Link to="/privacy">Privacy</Link></Button>
          <Button asChild><Link to="/login">Sign in</Link></Button>
        </div>
      </div>
    </header>

    <main>
      <section className="mx-auto max-w-5xl px-4 pt-16 pb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Simple, scalable pricing</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight">Quality management without enterprise-sized complexity</h1>
        <p className="mx-auto mt-5 max-w-3xl text-lg text-muted-foreground">
          Audits, actions, quality incidents, traceability and controlled records in one system. Prices exclude VAT where applicable.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">Annual billing is available at the equivalent of 10 months when paid in advance.</p>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <Card key={plan.name} className={plan.featured ? "border-primary shadow-lg relative" : "relative"}>
            {plan.featured && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">Most popular</span>}
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <div className="pt-2">
                <span className="text-3xl font-bold">{plan.price}</span>
                <span className="text-sm text-muted-foreground">{plan.suffix}</span>
              </div>
              <p className="text-sm leading-6 text-muted-foreground min-h-20">{plan.description}</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <ul className="space-y-3 text-sm">
                {plan.features.map((feature) => <li key={feature} className="flex gap-2"><Check className="h-4 w-4 text-primary mt-0.5 shrink-0" /><span>{feature}</span></li>)}
              </ul>
              <Button className="w-full" variant={plan.featured ? "default" : "outline"} asChild>
                <a href="mailto:info@infinit-audit.co.uk?subject=Infinit%20Audit%20pricing%20enquiry">Contact us <ArrowRight className="ml-2 h-4 w-4" /></a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="border-y bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-12 grid gap-8 md:grid-cols-3">
          <div><h2 className="font-semibold">Photographs included</h2><p className="mt-2 text-sm text-muted-foreground">Evidence images are automatically resized and compressed before upload to reduce storage and improve mobile performance.</p></div>
          <div><h2 className="font-semibold">Your organisation stays separate</h2><p className="mt-2 text-sm text-muted-foreground">Accounts and business records are scoped to the organisation they belong to, with role and feature-based access controls.</p></div>
          <div><h2 className="font-semibold">Scale when you need it</h2><p className="mt-2 text-sm text-muted-foreground">Plans can grow with additional sites, users, storage and commercial support requirements.</p></div>
        </div>
      </section>

      <footer className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground flex flex-col sm:flex-row gap-3 justify-between">
        <span>© 2026 Infinit Audit</span>
        <div className="flex gap-4"><Link to="/privacy" className="hover:text-foreground">Privacy</Link><Link to="/login" className="hover:text-foreground">Sign in</Link></div>
      </footer>
    </main>
  </div>
);

export default Pricing;
