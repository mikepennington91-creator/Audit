import { disposalRoutesForNotice, LEGACY_DISPOSAL_ROUTES } from './disposalRoutes';

const routes = [
  { id: 'a', company_id: 'company-a', key: 'recycling', name: 'A recycling' },
  { id: 'b', company_id: 'company-b', key: 'recycling', name: 'B recycling' },
];

test('system admins can select a supported route for a legacy hold without a company', () => {
  expect(disposalRoutesForNotice(routes, {
    isSystemAdmin: true,
    companyId: '',
    fromHold: true,
  })).toEqual(LEGACY_DISPOSAL_ROUTES);
});

test('system admin routes remain scoped to the current hold company', () => {
  expect(disposalRoutesForNotice(routes, {
    isSystemAdmin: true,
    companyId: 'company-a',
    fromHold: true,
  })).toEqual([routes[0]]);
});

test('a new system admin disposal still requires a company first', () => {
  expect(disposalRoutesForNotice(routes, {
    isSystemAdmin: true,
    companyId: '',
    fromHold: false,
  })).toEqual([]);
});
