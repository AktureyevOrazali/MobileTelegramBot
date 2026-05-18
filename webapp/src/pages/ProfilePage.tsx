import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { AuthSession } from '../types';
import Modal from '../components/Modal';
import { formatDateTime } from '../utils/date';
import { extractErrorMessage } from '../utils/errors';
import { getRoleLabel } from '../utils/roles';
import { validatePassword, validatePasswordMatch } from '../utils/validation';

interface ProfilePageProps {
  apiClient: ApiClient;
  session: AuthSession;
  onSessionUpdate: (next: AuthSession) => void;
  onLogout: () => void;
}

const ProfilePage: React.FC<ProfilePageProps> = ({ apiClient, session, onSessionUpdate }) => {
  const user = session.user;

  const [name, setName] = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [position, setPosition] = useState(user.jobTitle || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [bio, setBio] = useState(user.bio || '');

  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd1, setNewPwd1] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [pwdSaving, setPwdSaving] = useState(false);

  const bioRef = useRef<HTMLTextAreaElement | null>(null);

  const autoHeight = () => {
    const el = bioRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    autoHeight();
  }, []);

  useEffect(() => {
    autoHeight();
  }, [bio]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 3500);
    return () => clearTimeout(t);
  }, [banner]);

  const isAdmin = useMemo(() => user.role === 'admin', [user.role]);
  const roleLabel = getRoleLabel(user.role);

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await apiClient.updateProfile({
        name: name.trim(),
        email: email.trim(),
        jobTitle: position.trim(),
        phone: phone.trim(),
        bio: bio.trim(),
      });
      onSessionUpdate({ ...session, user: { ...session.user, ...updated } });
      setName(updated.name || '');
      setEmail(updated.email || '');
      setPosition(updated.jobTitle || '');
      setPhone(updated.phone || '');
      setBio(updated.bio || '');
      setBanner('\u041f\u0440\u043e\u0444\u0438\u043b\u044c \u043e\u0431\u043d\u043e\u0432\u043b\u0451\u043d');
    } catch (e) {
      setError(extractErrorMessage(e, '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c'));
    } finally {
      setSaving(false);
    }
  };

  const openPwdModal = () => {
    setOldPwd('');
    setNewPwd1('');
    setNewPwd2('');
    setPwdErr(null);
    setPwdOpen(true);
  };

  const handleChangePassword = async () => {
    const nextError = validatePassword(newPwd1) ?? validatePasswordMatch(newPwd1, newPwd2);
    if (nextError) {
      setPwdErr(nextError);
      return;
    }

    setPwdSaving(true);
    setPwdErr(null);
    try {
      await apiClient.changePassword(oldPwd, newPwd1);
      setPwdOpen(false);
      setBanner('\u041f\u0430\u0440\u043e\u043b\u044c \u0443\u0441\u043f\u0435\u0448\u043d\u043e \u0438\u0437\u043c\u0435\u043d\u0451\u043d');
    } catch (e) {
      setPwdErr(extractErrorMessage(e, '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c'));
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div className="profile-page profile-page--app-sidebar">
      {banner && <div className="profile-banner">{banner}</div>}
      {error && <div className="profile-error">{error}</div>}

      <div className="profile-hero">
        <div className="profile-hero__avatar">
          {(user.name || 'U').charAt(0).toUpperCase()}
        </div>
        <div className="profile-hero__info">
          <h2 className="profile-hero__name">{user.name || user.login}</h2>
          <div className="profile-hero__meta">
            <span className="profile-hero__role">{roleLabel}</span>
            <span className="profile-hero__sep">&middot;</span>
            <span>{`\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u0441\u043e\u0437\u0434\u0430\u043d: ${new Date(user.createdAt).toLocaleDateString()}`}</span>
          </div>
        </div>
      </div>

      <div className="profile-content-shell">
        <div className="profile-content">
          <div className="card profile-card">
            <h3 className="profile-card__title">{'\u041b\u0438\u0447\u043d\u0430\u044f \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u044f'}</h3>

            <div className="profile-form-grid">
              <label className="profile-field">
                <span className="profile-field__label">{'\u0418\u043c\u044f \u0438 \u0444\u0430\u043c\u0438\u043b\u0438\u044f'}</span>
                <input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
              </label>

              <label className="profile-field">
                <span className="profile-field__label">{'\u042d\u043b\u0435\u043a\u0442\u0440\u043e\u043d\u043d\u0430\u044f \u043f\u043e\u0447\u0442\u0430'}</span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="name@example.com"
                />
              </label>

              <label className="profile-field">
                <span className="profile-field__label">{'\u0414\u043e\u043b\u0436\u043d\u043e\u0441\u0442\u044c'}</span>
                <input className="input" value={position} onChange={e => setPosition(e.target.value)} autoComplete="organization-title" />
              </label>

              <label className="profile-field">
                <span className="profile-field__label">{'\u0422\u0435\u043b\u0435\u0444\u043e\u043d'}</span>
                <input
                  className="input"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+7 (777) 000-00-00"
                  autoComplete="tel"
                />
              </label>
            </div>

            <label className="profile-field profile-field--full">
              <span className="profile-field__label">{'\u041e \u0441\u0435\u0431\u0435 \u0438 \u043a\u043e\u043c\u043f\u0435\u0442\u0435\u043d\u0446\u0438\u0438'}</span>
              <textarea
                ref={bioRef}
                className="textarea textarea--autogrow"
                value={bio}
                onChange={e => setBio(e.target.value)}
                rows={3}
                placeholder={'\u041e\u043f\u0438\u0448\u0438\u0442\u0435 \u0432\u0430\u0448 \u043e\u043f\u044b\u0442 \u0438 \u043a\u043e\u043c\u043f\u0435\u0442\u0435\u043d\u0446\u0438\u0438'}
              />
            </label>

            <div className="profile-card__actions">
              <button className="button" onClick={saveProfile} disabled={saving}>
                {saving ? '\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u043c\u2026' : '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f'}
              </button>
              <button className="button secondary" onClick={openPwdModal}>{'\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c'}</button>
            </div>
          </div>

          {!isAdmin && (
            <>
              <div className="card profile-card">
                <h3 className="profile-card__title">{'\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u043d\u044b\u0435 \u0440\u0430\u0437\u0434\u0435\u043b\u044b'}</h3>
                {user.sections?.length ? (
                  <div className="profile-chips">
                    {user.sections.map((section) => <span key={section} className="profile-chip">{section}</span>)}
                  </div>
                ) : (
                  <p className="profile-empty">{'\u0420\u0430\u0437\u0434\u0435\u043b\u044b \u0435\u0449\u0451 \u043d\u0435 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u044b. \u041e\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044c \u043a \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0443.'}</p>
                )}
              </div>

              <div className="card profile-card">
                <h3 className="profile-card__title">{'\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u043d\u044b\u0435 \u0411\u0418\u041d\u044b'}</h3>
                {user.bins?.length ? (
                  <div className="profile-chips">
                    {user.bins.map((assignment) => (
                      <span key={assignment.bin} className="profile-chip profile-chip--bin">
                        <span className="profile-chip__title">{assignment.bin}</span>
                        <span className="profile-chip__meta">
                          {assignment.expiresAt ? `\u0434\u043e ${formatDateTime(assignment.expiresAt)}` : '\u0431\u0435\u0441\u0441\u0440\u043e\u0447\u043d\u043e'}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="profile-empty">{'\u0411\u0418\u041d\u044b \u0435\u0449\u0451 \u043d\u0435 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u044b. \u041e\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044c \u043a \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0443.'}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)}>
        <h3>{'\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c'}</h3>

        <div className="row">
          <label>{'\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c'}</label>
          <input className="input" type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} />
        </div>

        <div className="row">
          <label>{'\u041d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c'}</label>
          <input className="input" type="password" value={newPwd1} onChange={e => setNewPwd1(e.target.value)} />
        </div>

        <div className="row">
          <label>{'\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c'}</label>
          <input className="input" type="password" value={newPwd2} onChange={e => setNewPwd2(e.target.value)} />
        </div>

        {pwdErr && <div className="alert error" style={{ marginTop: 6 }}>{pwdErr}</div>}

        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <button className="button secondary" onClick={() => setPwdOpen(false)}>{'\u041e\u0442\u043c\u0435\u043d\u0430'}</button>
          <button className="button" onClick={handleChangePassword} disabled={pwdSaving}>
            {pwdSaving ? '\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u043c\u2026' : '\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default ProfilePage;
