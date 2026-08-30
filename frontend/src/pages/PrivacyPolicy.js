import { Link } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_c2cdf81f-38d8-495b-bbbc-bf9142927afb/artifacts/pll87efh_ChatGPT%20Image%20Jan%2013%2C%202026%2C%2007_06_32%20AM.png";

const Section = ({ title, children }) => (
  <section className="space-y-2">
    <h2 className="text-xl font-semibold">{title}</h2>
    <div className="space-y-2 text-sm leading-6 text-muted-foreground">{children}</div>
  </section>
);

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background px-4 py-8 md:py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="text-center space-y-4">
          <img src={LOGO_URL} alt="Infinit Audit" className="mx-auto h-20 w-auto" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
            <p className="mt-2 text-sm text-muted-foreground">Last updated: 30 August 2026</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6 md:p-8 space-y-7">
            <Section title="1. About this policy">
              <p>
                This privacy policy explains how Infinit Audit handles personal information when you use the Infinit Audit website and application. If your employer or another organisation provides your access to Infinit Audit, that organisation may also be responsible for the information it enters into the service.
              </p>
              <p>
                Privacy enquiries can be sent to <a className="text-primary underline" href="mailto:info@infinit-audit.co.uk">info@infinit-audit.co.uk</a>.
              </p>
            </Section>

            <Section title="2. Information we collect">
              <p>We may process account information such as your name, work email address, organisation, role and access permissions.</p>
              <p>When you use the service, we may also process audit records, corrective actions, traceability records, documents, comments, signatures, photographs or other evidence that you or your organisation choose to upload.</p>
              <p>We may retain limited technical and security information needed to operate the service, such as authentication information, service logs, notification records and email-delivery records.</p>
            </Section>

            <Section title="3. Why we use personal information">
              <p>We use personal information to provide and secure user accounts, deliver audit and quality-management functionality, send service notifications, maintain records requested by your organisation, investigate technical problems, prevent misuse and improve reliability.</p>
              <p>Depending on the circumstances, the lawful basis may include performance of a contract, legitimate interests in operating and securing the service, or compliance with a legal obligation. Your organisation may rely on different lawful bases for the records it enters into Infinit Audit.</p>
            </Section>

            <Section title="4. Who information is shared with">
              <p>
                We use service providers to host and operate Infinit Audit, including providers for application hosting, database infrastructure and email delivery. They process information only as required to provide those services and are subject to their own security and data-protection obligations.
              </p>
              <p>We do not sell personal information to advertisers.</p>
            </Section>

            <Section title="5. International processing">
              <p>
                Some service providers may process information outside the United Kingdom. Where this occurs, appropriate safeguards are used where required by UK data-protection law, such as adequacy arrangements or approved contractual protections.
              </p>
            </Section>

            <Section title="6. How long information is kept">
              <p>
                Information is kept for as long as reasonably necessary to provide the service, meet the record-retention requirements of the organisation using Infinit Audit, resolve disputes, maintain security and comply with applicable legal obligations. Retention periods can therefore vary by record type and customer requirement.
              </p>
            </Section>

            <Section title="7. Security">
              <p>
                We use technical and organisational measures designed to protect information from unauthorised access, alteration, disclosure or loss. These include authenticated accounts, role-based access controls, encrypted connections, password hashing and restricted administrative access. No online service can guarantee absolute security.
              </p>
            </Section>

            <Section title="8. Browser storage and essential technologies">
              <p>
                Infinit Audit uses essential browser storage and service-worker technology for functions such as maintaining your signed-in session, remembering interface preferences and supporting permitted offline functionality. These technologies are used to operate the service rather than for advertising.
              </p>
            </Section>

            <Section title="9. Your data-protection rights">
              <p>
                Under UK data-protection law, you may have rights to request access to your personal information, ask for inaccurate information to be corrected, request deletion or restriction in certain circumstances, object to some processing, or request data portability where applicable.
              </p>
              <p>
                If your account is provided by your employer or another organisation, some requests may need to be handled by that organisation because it controls the relevant business records. You can contact us at <a className="text-primary underline" href="mailto:info@infinit-audit.co.uk">info@infinit-audit.co.uk</a> and we will help direct the request appropriately.
              </p>
              <p>
                You also have the right to raise a concern with the UK Information Commissioner&apos;s Office (ICO) if you are unhappy with how personal information has been handled.
              </p>
            </Section>

            <Section title="10. Changes to this policy">
              <p>
                We may update this policy when the service, our suppliers or legal requirements change. The current version will remain available at this page and the date above will show when it was last updated.
              </p>
            </Section>
          </CardContent>
        </Card>

        <div className="text-center">
          <Button asChild variant="outline"><Link to="/login">Return to sign in</Link></Button>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
