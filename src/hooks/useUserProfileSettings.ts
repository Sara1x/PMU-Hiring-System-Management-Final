import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import {
  ROLE_ACCOUNT_EMAIL,
  ROLE_DEFAULT_FULL_NAME,
  type PmuRole,
} from '../utils/roleAccounts';
import { getSession, patchSession } from '../utils/session';

/** Profile fields persisted in Firestore. */
export interface RoleUserProfileForm {
  fullName: string;
  email: string;
  role: PmuRole;
}

/**
 * `userProfiles/{email}` — one document per login email address.
 */
export function useRoleUserProfileSettings(profileRole: PmuRole) {
  const defaultFullName = ROLE_DEFAULT_FULL_NAME[profileRole];
  const canonicalEmail  = ROLE_ACCOUNT_EMAIL[profileRole];

  // Document ID is the authenticated user's email, not the role string.
  const normalizedEmail = auth.currentUser?.email?.toLowerCase().trim() ?? '';

  const [form,         setForm]         = useState<RoleUserProfileForm | null>(null);
  const [savedProfile, setSavedProfile] = useState<RoleUserProfileForm | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [toast,        setToast]        = useState<'success' | 'error' | null>(null);
  const [loadError,    setLoadError]    = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!normalizedEmail) {
      setLoadError('Not signed in.');
      setLoading(false);
      return;
    }

    const ref     = doc(db, 'userProfiles', normalizedEmail);
    const session = getSession();
    const seedName = session?.fullName ?? defaultFullName;

    (async () => {
      try {
        setLoadError(null);
        const snap = await getDoc(ref);
        if (cancelled) return;

        let initial: RoleUserProfileForm;

        if (snap.exists()) {
          const d = snap.data();
          initial = {
            fullName: (d.fullName as string) ?? seedName,
            email:    canonicalEmail,
            role:     profileRole,
          };
        } else {
          initial = {
            fullName: seedName,
            email:    canonicalEmail,
            role:     profileRole,
          };
          await setDoc(ref, {
            email:    canonicalEmail,
            fullName: initial.fullName,
            role:     profileRole,
          });
        }

        setSavedProfile(initial);
        setForm(initial);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          const fallback: RoleUserProfileForm = {
            fullName: seedName,
            email:    canonicalEmail,
            role:     profileRole,
          };
          setLoadError('Could not sync with Firebase.');
          setSavedProfile(fallback);
          setForm(fallback);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [profileRole, normalizedEmail]);

  const handleSave = useCallback(async () => {
    if (!form) return;

    const emailDocId = auth.currentUser?.email?.toLowerCase().trim() ?? '';
    if (!emailDocId) {
      setToast('error');
      return;
    }

    setSaving(true);
    setToast(null);
    try {
      const ref = doc(db, 'userProfiles', emailDocId);
      await setDoc(
        ref,
        {
          email:    canonicalEmail,
          fullName: form.fullName,
          role:     profileRole,
        },
        { merge: true },
      );
      setSavedProfile(form);
      patchSession({ fullName: form.fullName });
      setToast('success');
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      console.error(e);
      setToast('error');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }, [form, profileRole, canonicalEmail]);

  const handleCancel = useCallback(() => {
    savedProfile && setForm(savedProfile);
  }, [savedProfile]);

  const field = useCallback(
    <K extends keyof RoleUserProfileForm>(key: K, value: RoleUserProfileForm[K]) => {
      setForm(prev => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  return { form, loading, saving, toast, loadError, handleSave, handleCancel, field };
}
