import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { AuthSession } from '../types';
import Modal from '../components/Modal';
import { formatDateTime } from '../utils/date';
import { extractErrorMessage } from '../utils/errors';
import { validatePassword, validatePasswordMatch } from '../utils/validation';

interface ProfilePageProps {
  apiClient: ApiClient;
  session: AuthSession;
  onSessionUpdate: (next: AuthSession) => void;
  onLogout: () => void; // оставил проп, но кнопку на странице убрал по твоему ТЗ
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

  // ======== Password change modal ========
  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd1, setNewPwd1] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [pwdSaving, setPwdSaving] = useState(false);

  // ======== textarea auto-height ========
  const bioRef = useRef<HTMLTextAreaElement | null>(null);
  const autoHeight = () => {
    const el = bioRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => { autoHeight(); }, []);
  useEffect(() => { autoHeight(); }, [bio]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 3500);
    return () => clearTimeout(t);
  }, [banner]);

  const isAdmin = useMemo(() => user.role === 'admin', [user.role]);

  const roleLabel = user.role === 'admin' ? 'Администратор' : user.role === 'moderator' ? 'Модератор' : 'Оператор';

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
      setBanner('Профиль обновлён');
    } catch (e) {
      setError(extractErrorMessage(e, 'Не удалось сохранить профиль'));
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
    const pwdErr = validatePassword(newPwd1) ?? validatePasswordMatch(newPwd1, newPwd2);
    if (pwdErr) { setPwdErr(pwdErr); return; }

    setPwdSaving(true);
    setPwdErr(null);
    try {
      await apiClient.changePassword(oldPwd, newPwd1);
      setPwdOpen(false);
      setBanner('Пароль успешно изменён');
    } catch (e) {
      setPwdErr(extractErrorMessage(e, 'Не удалось изменить пароль'));
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div className="profile-page">
      {banner && <div className="profile-banner">{banner}</div>}
      {error && <div className="profile-error">{error}</div>}

      {/* ── Gradient hero header ── */}
      <div className="profile-hero">
        <div className="profile-hero__avatar">
          {(user.name || 'U').charAt(0).toUpperCase()}
        </div>
        <div className="profile-hero__info">
          <h2 className="profile-hero__name">{user.name || user.login}</h2>
          <div className="profile-hero__meta">
            <span className="profile-hero__role">{roleLabel}</span>
            <span className="profile-hero__sep">·</span>
            <span>Аккаунт создан: {new Date(user.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* ── Profile edit form ── */}
      <div className="card profile-card">
        <h3 className="profile-card__title">Личная информация</h3>

        <div className="profile-form-grid">
          <label className="profile-field">
            <span className="profile-field__label">Имя и фамилия</span>
            <input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
          </label>

          <label className="profile-field">
            <span className="profile-field__label">Электронная почта</span>
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
            <span className="profile-field__label">Должность</span>
            <input className="input" value={position} onChange={e => setPosition(e.target.value)} autoComplete="organization-title" />
          </label>

          <label className="profile-field">
            <span className="profile-field__label">Телефон</span>
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
          <span className="profile-field__label">О себе и компетенции</span>
          <textarea
            ref={bioRef}
            className="textarea textarea--autogrow"
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={3}
            placeholder="Опишите ваш опыт и компетенции"
          />
        </label>

        <div className="profile-card__actions">
          <button className="button" onClick={saveProfile} disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить изменения'}
          </button>
          <button className="button secondary" onClick={openPwdModal}>Сменить пароль</button>
        </div>
      </div>

      {/* ── Sections & BINs (hidden for admin) ── */}
      {!isAdmin && (
        <>
          <div className="card profile-card">
            <h3 className="profile-card__title">Назначенные разделы</h3>
            {user.sections?.length ? (
              <div className="profile-chips">
                {user.sections.map((s) => <span key={s} className="profile-chip">{s}</span>)}
              </div>
            ) : (
              <p className="profile-empty">Разделы ещё не назначены. Обратитесь к администратору.</p>
            )}
          </div>

          <div className="card profile-card">
            <h3 className="profile-card__title">Назначенные БИНы</h3>
            {user.bins?.length ? (
              <div className="profile-chips">
                {user.bins.map((assignment) => (
                  <span key={assignment.bin} className="profile-chip profile-chip--bin">
                    <span className="profile-chip__title">{assignment.bin}</span>
                    <span className="profile-chip__meta">
                      {assignment.expiresAt ? `до ${formatDateTime(assignment.expiresAt)}` : 'бессрочно'}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="profile-empty">БИНы ещё не назначены. Обратитесь к администратору.</p>
            )}
          </div>
        </>
      )}

      {/* ── Password change modal ── */}
      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)}>
        <h3>Сменить пароль</h3>

        <div className="row">
          <label>Текущий пароль</label>
          <input className="input" type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} />
        </div>

        <div className="row">
          <label>Новый пароль</label>
          <input className="input" type="password" value={newPwd1} onChange={e => setNewPwd1(e.target.value)} />
        </div>

        <div className="row">
          <label>Подтвердите пароль</label>
          <input className="input" type="password" value={newPwd2} onChange={e => setNewPwd2(e.target.value)} />
        </div>

        {pwdErr && <div className="alert error" style={{ marginTop: 6 }}>{pwdErr}</div>}

        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <button className="button secondary" onClick={() => setPwdOpen(false)}>Отмена</button>
          <button className="button" onClick={handleChangePassword} disabled={pwdSaving}>
            {pwdSaving ? 'Сохраняем…' : 'Сменить пароль'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default ProfilePage;