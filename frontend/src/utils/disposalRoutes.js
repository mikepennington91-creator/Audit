export const LEGACY_DISPOSAL_ROUTES = [
  { id: 'legacy-sugarich', key: 'sugarich', name: 'SugaRich', color_hex: '#FACC15', text_color: '#000000' },
  { id: 'legacy-return-to-supplier', key: 'return_to_supplier', name: 'Return to Supplier', color_hex: '#16A34A', text_color: '#FFFFFF' },
  { id: 'legacy-general-waste', key: 'general_waste', name: 'General Waste', color_hex: '#DC2626', text_color: '#FFFFFF' },
  { id: 'legacy-recycling', key: 'recycling', name: 'Recycling', color_hex: '#7E22CE', text_color: '#FFFFFF' },
];

export const disposalRoutesForNotice = (routes, { isSystemAdmin, companyId, fromHold }) => {
  // Holds created before tenant-scoped routes were introduced have no company ID.
  // The API intentionally supports these four historical route keys, so expose the
  // matching controlled options instead of leaving the route selector disabled.
  if (fromHold && !companyId) return LEGACY_DISPOSAL_ROUTES;
  if (!isSystemAdmin) return routes;
  if (!companyId) return [];
  return routes.filter((route) => route.company_id === companyId);
};
