import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { AuthSession, Section } from '../types';
import Modal from '../components/Modal';

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

  const [sectionTitles, setSectionTitles] = useState<Record<string, string>>({});

  // ======== Модалка смены пароля ========
  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd1, setNewPwd1] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [pwdSaving, setPwdSaving] = useState(false);

  // ======== textarea: авто-высота, без ручного ресайза ========
  const bioRef = useRef<HTMLTextAreaElement | null>(null);
  const autoHeight = () => {
    const el = bioRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => { autoHeight(); }, []);        // при первом рендере
  useEffect(() => { autoHeight(); }, [bio]);     // при изменении содержимого

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 3500);
    return () => clearTimeout(t);
  }, [banner]);

  const isAdmin = useMemo(() => user.role === 'admin', [user.role]);

  useEffect(() => {
    if (isAdmin) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const availableSections: Section[] = await apiClient.fetchSections();
        if (cancelled) {
          return;
        }
        const titles = availableSections.reduce<Record<string, string>>((acc, section) => {
          acc[section.id] = section.title;
          return acc;
        }, {});
        setSectionTitles(titles);
      } catch (err) {
        console.warn('Не удалось загрузить список разделов', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiClient, isAdmin]);

  const assignedSections = useMemo(
    () => (user.sections ?? []).map((sectionId) => sectionTitles[sectionId] ?? sectionId),
    [sectionTitles, user.sections],
  );

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
      // обновим сессию, чтобы хедер и др. места сразу получили актуальные данные
      onSessionUpdate({ ...session, user: { ...session.user, ...updated } });
      setName(updated.name || '');
      setEmail(updated.email || '');
      setPosition(updated.jobTitle || '');
      setPhone(updated.phone || '');
      setBio(updated.bio || '');
      setBanner('Профиль обновлён');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? 'Не удалось сохранить профиль';
      setError(msg);
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
    if (newPwd1.trim().length < 6) {
      setPwdErr('Новый пароль должен быть не короче 6 символов.');
      return;
    }
    if (newPwd1 !== newPwd2) {
      setPwdErr('Пароли не совпадают.');
      return;
    }

    setPwdSaving(true);
    setPwdErr(null);
    try {
      await apiClient.changePassword(oldPwd, newPwd1);
      setPwdOpen(false);
      setBanner('Пароль успешно изменён');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? 'Не удалось изменить пароль';
      setPwdErr(msg);
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 48 }}>
      {banner && (<div className="badge">{banner}</div>)}
      {error && (<div className="alert">{error}</div>)}

      <div className="card" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 className="heading" style={{ marginBottom: 6 }}>Профиль оператора</h2>
            <div className="text-muted">
              Аккаунт создан: {new Date(user.createdAt).toLocaleDateString()} · Роль: {user.role === 'admin' ? 'Администратор' : user.role === 'moderator' ? 'Модератор' : 'Оператор'}
            </div>
          </div>

          {/* Кнопку "Обновить из сервера" убрали по ТЗ */}
        </div>

        <div className="profile-form-grid">
          <label className="label">
            Имя и фамилия
            <input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
          </label>

          <label className="label">
            Электронная почта
            <input
              className="input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="name@example.com"
            />
          </label>

          <label className="label">
            Должность
            <input className="input" value={position} onChange={e => setPosition(e.target.value)} autoComplete="organization-title" />
          </label>

          <label className="label">
            Телефон
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

        <label className="label">
          О себе и компетенции
          <textarea
            ref={bioRef}
            className="textarea textarea--autogrow"
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={3}
            placeholder="Опишите ваш опыт и компетенции"
          />
        </label>

        {/* Кнопка «Выйти из системы» удалена со страницы профиля по ТЗ */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="button" onClick={saveProfile} disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить изменения'}
          </button>
          <button className="button secondary" onClick={openPwdModal}>Сменить пароль</button>
        </div>
      </div>

      {/* Блоки "Назначенные разделы/БИНы" скрываем для админа */}
      {!isAdmin && (
        <>
          <div className="card">
            <h3>Назначенные разделы</h3>
            {assignedSections.length ? (
              <div className="flex-gap" style={{ flexWrap: 'wrap' }}>
                {assignedSections.map((title, index) => {
                  const sectionId = user.sections[index];
                  const key = sectionId ?? `${title}-${index}`;
                  return (
                    <span key={key} className="chip">
                      {title}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted">Разделы ещё не назначены. Обратитесь к администратору.</p>
            )}
          </div>

          <div className="card">
            <h3>Назначенные БИНы</h3>
            {user.bins?.length ? (
              <div className="flex-gap" style={{ flexWrap: 'wrap' }}>
                {user.bins.map((b) => <span key={b} className="chip">{b}</span>)}
              </div>
            ) : (
              <p className="text-muted">БИНы ещё не назначены. Обратитесь к администратору.</p>
            )}
          </div>
        </>
      )}

      {/* Модалка смены пароля (как на Админке) */}
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
