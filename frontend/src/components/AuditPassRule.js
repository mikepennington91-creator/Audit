export default function AuditPassRule({ audit }) {
  if (audit.scoring_mode === 'non_conformances') {
    const maximum = audit.max_non_conformances ?? 0;
    return <span className="text-right">Pass: {maximum} or fewer non-conformances</span>;
  }
  if (audit.pass_rate == null) return null;
  return <span className="text-right">Pass rate: {audit.pass_rate}%</span>;
}
