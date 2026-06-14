import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin, v2Orgs } from '../../services/apiV2';

const AdminContext = createContext(null);

export function AdminProvider({ children }) {
  const [orgs, setOrgs] = useState([]);
  const [users, setUsers] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [costs, setCosts] = useState(null);
  const [costsLoadedAt, setCostsLoadedAt] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [orgDetail, setOrgDetail] = useState(null);

  const reloadOrgs = useCallback(
    () =>
      v2Admin
        .orgs()
        .then((r) => setOrgs(r.orgs || []))
        .catch(() => toast.error('Failed to load orgs')),
    []
  );

  const reloadUsers = useCallback(
    () =>
      v2Admin
        .users()
        .then((r) => setUsers(r.users || []))
        .catch(() => toast.error('Failed to load users')),
    []
  );

  const reloadCosts = useCallback(
    () =>
      v2Admin
        .costsSummary()
        .then((data) => {
          setCosts(data);
          setCostsLoadedAt(new Date());
        })
        .catch(() => toast.error('Failed to load costs')),
    []
  );

  const reloadKpis = useCallback(
    () =>
      Promise.all([v2Orgs.adminKpis().then(setKpis), v2Admin.revenue().then(setRevenue).catch(() => {})]).catch(
        () => {}
      ),
    []
  );

  const reloadOrgDetail = useCallback(() => {
    if (!selectedOrg) return Promise.resolve();
    return v2Admin
      .orgDetail(selectedOrg)
      .then(setOrgDetail)
      .catch(() => toast.error('Failed to load org detail'));
  }, [selectedOrg]);

  const refreshAll = useCallback(() => {
    reloadKpis();
    reloadOrgs();
    reloadCosts();
    reloadOrgDetail();
  }, [reloadKpis, reloadOrgs, reloadCosts, reloadOrgDetail]);

  const reloadOrgsTab = useCallback(() => {
    reloadOrgs();
    reloadKpis();
    reloadCosts();
    reloadOrgDetail();
  }, [reloadOrgs, reloadKpis, reloadCosts, reloadOrgDetail]);

  useEffect(() => {
    reloadKpis();
    reloadOrgs();
    reloadCosts();
  }, [reloadKpis, reloadOrgs, reloadCosts]);

  useEffect(() => {
    if (!selectedOrg) {
      setOrgDetail(null);
      return;
    }
    setOrgDetail(null);
    v2Admin
      .orgDetail(selectedOrg)
      .then(setOrgDetail)
      .catch(() => toast.error('Failed to load org detail'));
  }, [selectedOrg]);

  const value = useMemo(
    () => ({
      orgs,
      users,
      kpis,
      revenue,
      costs,
      costsLoadedAt,
      selectedOrg,
      setSelectedOrg,
      orgDetail,
      reloadOrgs,
      reloadUsers,
      reloadCosts,
      reloadKpis,
      reloadOrgDetail,
      refreshAll,
      reloadOrgsTab,
    }),
    [
      orgs,
      users,
      kpis,
      revenue,
      costs,
      costsLoadedAt,
      selectedOrg,
      orgDetail,
      reloadOrgs,
      reloadUsers,
      reloadCosts,
      reloadKpis,
      reloadOrgDetail,
      refreshAll,
      reloadOrgsTab,
    ]
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider');
  return ctx;
}
