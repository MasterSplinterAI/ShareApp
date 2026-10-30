import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

const AUDIT_STORAGE_PREFIX = 'v2-superadmin-audit-reason';

export function orgKey(orgId) {
  return String(orgId ?? '');
}

function loadStored(orgId) {
  try {
    return sessionStorage.getItem(`${AUDIT_STORAGE_PREFIX}:${orgKey(orgId)}`) || '';
  } catch {
    return '';
  }
}

function persist(orgId, value) {
  try {
    const key = `${AUDIT_STORAGE_PREFIX}:${orgKey(orgId)}`;
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function useAuditReason(selectedKey) {
  const [auditReason, setAuditReason] = useState({});
  const [auditReasonError, setAuditReasonError] = useState(null);
  const auditInputRef = useRef(null);

  useEffect(() => {
    if (!selectedKey) return;
    const key = orgKey(selectedKey);
    setAuditReason((prev) => {
      if (prev[key]) return prev;
      const stored = loadStored(key);
      return stored ? { ...prev, [key]: stored } : prev;
    });
  }, [selectedKey]);

  const getAuditReason = (key) => {
    const k = orgKey(key);
    const fromDom = document.getElementById(`audit-reason-${k}`)?.value?.trim();
    return fromDom || (auditReason[k] || '').trim();
  };

  const updateAuditReason = (key, value) => {
    const k = orgKey(key);
    setAuditReason((prev) => ({ ...prev, [k]: value }));
    persist(k, value);
    if (auditReasonError === k) setAuditReasonError(null);
  };

  const requireAuditReason = (key) => {
    const reason = getAuditReason(key);
    if (reason.length >= 4) {
      setAuditReasonError(null);
      return reason;
    }
    const k = orgKey(key);
    setAuditReasonError(k);
    const el = auditInputRef.current || document.getElementById(`audit-reason-${k}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
    toast.error('Enter an audit reason (at least 4 characters).');
    return null;
  };

  return {
    auditReason,
    auditReasonError,
    auditInputRef,
    getAuditReason,
    updateAuditReason,
    requireAuditReason,
  };
}
